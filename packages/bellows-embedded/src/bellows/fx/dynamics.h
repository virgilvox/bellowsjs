/* Transcription of src/fx/dynamics.ts: Compressor, Limiter, Gate.
 *
 * All three are stereo in-place effects driven by one mono sidechain,
 * max(|l|, |r|), so the stereo image does not wander when one channel
 * dips. Level detection runs in the dB domain: rectified sample to dB
 * with a -96 dB floor, then asymmetric one-pole smoothing.
 *
 * Each class stands alone with no shared base and no virtuals, so a
 * sketch that only gates never links the limiter's sliding-window code
 * or its lookahead buffers.
 *
 * The transient shaper from the same TypeScript file is not ported here.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/oversample.h"

namespace bellows {

/* Detector floor. Everything quieter than this reads as -96 dB. */
inline constexpr float kDynFloorDb = -96.0f;
inline constexpr float kDynFloorLin = 1.58489319e-5f; /* 10^(-96/20) */
/* 20 log10 x = 6.0206 log2 x, and log2 is the cheap one in fm::. */
inline constexpr float kDynLog2ToDb = 6.020599913279624f;

/* Rectified sample to dB with a -96 dB floor. */
inline float LevelDb(float x) {
  return x > kDynFloorLin ? kDynLog2ToDb * fm::Log2(x) : kDynFloorDb;
}

/* One-pole coefficient reaching 63 percent of a step in time_sec. */
inline float OnePoleCoef(float time_sec, float sample_rate) {
  return time_sec <= 0.0f ? 1.0f : 1.0f - fm::Exp(-1.0f / (time_sec * sample_rate));
}

/* ------------------------------------------------------------------ */
/* Compressor                                                          */
/* ------------------------------------------------------------------ */

/* Averaging time of the crest factor trackers, per Giannoulis et al. */
inline constexpr float kCompCrestTc = 0.2f;

/*
 * Feedforward stereo-linked compressor. The sidechain level is smoothed
 * in dB with attack/release ballistics, then a quadratic soft knee static
 * curve computes the gain.
 *
 * Program-dependent release: two release constants, the configured time
 * and a quarter of it, blended by the sidechain crest factor. Peak and
 * RMS power are tracked with the same 200 ms one-pole (Giannoulis et al.,
 * "Digital Dynamic Range Compressor Design", JAES 2012). A steady sine
 * has crest^2 = 2 and gets the full release time; percussive material
 * with crest^2 >= 8 gets the quarter time; values between blend linearly.
 *
 * Lookahead delays the audio path while the detector reads the undelayed
 * input, so the gain is already down when a step transient reaches the
 * output. kMaxLookaheadMs sizes those two delay lines and nothing else,
 * which is why it is a template parameter: the JS pays for its 10 ms
 * ceiling whether the user asks for lookahead or not.
 */
template <int kMaxLookaheadMs = 10, int kSampleRate = BELLOWS_SAMPLE_RATE>
class Compressor {
 public:
  static constexpr uint32_t kMaxLookSamples =
      (static_cast<uint32_t>(kMaxLookaheadMs) * kSampleRate) / 1000u;

  struct Params {
    float threshold_db = -18.0f;
    float ratio = 4.0f;
    float knee_db = 6.0f;
    float attack = 0.01f;
    float release = 0.2f;
    /* -1 selects auto makeup: half the static reduction of a 0 dBFS
     * signal. Any other value is a literal dB offset. */
    float makeup_db = 0.0f;
    float lookahead = 0.0f;
    float mix = 1.0f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = sample_rate;
    dl_l_.Init();
    dl_r_.Init();
    crest_a_ = fm::Exp(-1.0f / (kCompCrestTc * sample_rate));
    env_ = kDynFloorDb;
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.threshold_db = Clamp(p_.threshold_db, -60.0f, 0.0f);
    p_.ratio = Clamp(p_.ratio, 1.0f, 20.0f);
    p_.knee_db = Clamp(p_.knee_db, 0.0f, 24.0f);
    p_.makeup_db = Clamp(p_.makeup_db, -1.0f, 24.0f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    const float max_look = static_cast<float>(kMaxLookaheadMs) * 0.001f;
    a_coef_ = OnePoleCoef(Clamp(p_.attack, 0.0001f, 0.5f), sr_);
    const float rel = Clamp(p_.release, 0.01f, 2.0f);
    r_coef_slow_ = OnePoleCoef(rel, sr_);
    r_coef_fast_ = OnePoleCoef(rel * 0.25f, sr_);
    look_ = static_cast<int32_t>(Clamp(p_.lookahead, 0.0f, max_look) * sr_ + 0.5f);
    if (look_ > static_cast<int32_t>(kMaxLookSamples)) {
      look_ = static_cast<int32_t>(kMaxLookSamples);
    }
    /* Auto makeup compensates half the reduction a 0 dBFS signal gets. */
    auto_makeup_db_ =
        p_.makeup_db <= -0.999f ? -0.5f * StaticGainDb(0.0f) : p_.makeup_db;
  }

  /* Current lookahead delay in samples. */
  int32_t Latency() const { return look_; }

  void Process(float* l, float* r, int from, int to) {
    const float mix = p_.mix;
    const float dry_amt = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      const float xl = l[i];
      const float xr = r[i];
      const float al = xl < 0.0f ? -xl : xl;
      const float ar = xr < 0.0f ? -xr : xr;
      const float s = al > ar ? al : ar;

      /* Crest factor tracking for program-dependent release. */
      const float s2 = s * s;
      rms_sq_ = crest_a_ * rms_sq_ + (1.0f - crest_a_) * s2;
      const float pk = crest_a_ * peak_sq_ + (1.0f - crest_a_) * s2;
      peak_sq_ = s2 > pk ? s2 : pk;
      const float crest_sq = peak_sq_ / (rms_sq_ > 1e-12f ? rms_sq_ : 1e-12f);
      const float w = Clamp((crest_sq - 2.0f) / 6.0f, 0.0f, 1.0f);

      const float s_db = LevelDb(s);
      if (s_db > env_) {
        env_ += a_coef_ * (s_db - env_);
      } else {
        const float r_coef = r_coef_slow_ + w * (r_coef_fast_ - r_coef_slow_);
        env_ += r_coef * (s_db - env_);
      }

      const float gain = fm::DbToGain(StaticGainDb(env_) + auto_makeup_db_);

      dl_l_.Write(xl);
      dl_r_.Write(xr);
      /* Parallel compression: the dry term is the delayed input, so both
       * paths stay aligned whatever the lookahead. */
      const float g = dry_amt + mix * gain;
      l[i] = dl_l_.ReadInt(look_) * g;
      r[i] = dl_r_.ReadInt(look_) * g;
    }
  }

  void Reset() {
    dl_l_.Clear();
    dl_r_.Clear();
    env_ = kDynFloorDb;
    peak_sq_ = 0.0f;
    rms_sq_ = 0.0f;
  }

 private:
  /* Gain in dB the static curve applies at sidechain level lvl. The
   * quadratic soft knee interpolates over [threshold - knee/2, threshold
   * + knee/2]; outside it the curve is the usual two-segment line. */
  float StaticGainDb(float lvl) const {
    const float over = lvl - p_.threshold_db;
    const float knee = p_.knee_db;
    const float mag = over < 0.0f ? -over : over;
    if (knee > 0.0f && 2.0f * mag <= knee) {
      const float t = over + knee * 0.5f;
      return ((1.0f / p_.ratio - 1.0f) * t * t) / (2.0f * knee);
    }
    return over > 0.0f ? (1.0f / p_.ratio - 1.0f) * over : 0.0f;
  }

  Params p_;
  DelayLine<kMaxLookSamples> dl_l_, dl_r_;
  float sr_ = 48000.0f;
  float crest_a_ = 0.0f;
  float a_coef_ = 1.0f, r_coef_slow_ = 1.0f, r_coef_fast_ = 1.0f;
  float auto_makeup_db_ = 0.0f;
  int32_t look_ = 0;
  float env_ = kDynFloorDb, peak_sq_ = 0.0f, rms_sq_ = 0.0f;
};

/* ------------------------------------------------------------------ */
/* Limiter                                                             */
/* ------------------------------------------------------------------ */

namespace detail {

/* The true-peak detector's oversamplers, present only when asked for.
 * They are by far the largest thing in the limiter (6 KB of scratch at a
 * 128 sample block), so the default build must not carry them. */
template <bool kOn, int kBlock>
struct LimiterTruePeak {
  Oversampler<4, kBlock> os_l, os_r;
  void Init() {
    os_l.Init();
    os_r.Init();
  }
  void Reset() {
    os_l.Reset();
    os_r.Reset();
  }
};

template <int kBlock>
struct LimiterTruePeak<false, kBlock> {
  void Init() {}
  void Reset() {}
};

}  // namespace detail

/*
 * Lookahead brickwall limiter. Per sample the required gain reduction in
 * dB (with exponential release applied) feeds a sliding maximum over the
 * lookahead window, and that maximum is box-averaged over the same window
 * length. Every term of the average covers the sample leaving the delay
 * line, so the averaged reduction is always at least the reduction that
 * sample needs: the output never exceeds the ceiling, and the attack is a
 * smooth ramp instead of a step.
 *
 * The lookahead is fixed at 5 ms, so the window sizes are compile-time
 * constants derived from kSampleRate. Run the unit at a different rate
 * and the buffers still work, the lookahead is just no longer exactly
 * 5 ms; kLatency is always the truth in samples.
 *
 * kTruePeak raises the detector with a 4x oversampled peak estimate. The
 * raw sample peak is always included as well, so the sample-domain
 * guarantee holds either way. It is a template parameter and not a
 * runtime flag because the two Oversamplers dwarf everything else in the
 * object and a runtime flag would force the linker to keep them.
 *
 * The JS deque holds monotonically increasing absolute sample indices in
 * a Float64Array. Here they are uint32 and the expiry test is written as
 * an unsigned difference, which stays correct across the counter's wrap.
 */
template <int kSampleRate = BELLOWS_SAMPLE_RATE, bool kTruePeak = false,
          int kMaxBlock = BELLOWS_BLOCK_SIZE>
class Limiter {
 public:
  /* Fixed 5 ms lookahead, rounded up, in samples at kSampleRate. */
  static constexpr int32_t kLatency = (5 * kSampleRate + 999) / 1000;
  static constexpr int32_t kWin = kLatency + 1;
  static constexpr int32_t kDqCap = kWin + 1;

  struct Params {
    float ceiling_db = -0.3f;
    float release = 0.05f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = sample_rate;
    dl_l_.Init();
    dl_r_.Init();
    tp_.Init();
    Reset();
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.ceiling_db = Clamp(p_.ceiling_db, -24.0f, 0.0f);
    ceil_lin_ = fm::DbToGain(p_.ceiling_db);
    rel_mul_ = fm::Exp(-1.0f / (Clamp(p_.release, 0.001f, 1.0f) * sr_));
  }

  void Process(float* l, float* r, int from, int to) {
    if constexpr (kTruePeak) {
      /* The oversampler works a bounded block at a time, so split. */
      for (int start = from; start < to; start += kMaxBlock) {
        int end = start + kMaxBlock;
        if (end > to) end = to;
        Chunk(l, r, start, end);
      }
    } else {
      Chunk(l, r, from, to);
    }
  }

  void Reset() {
    dl_l_.Clear();
    dl_r_.Clear();
    tp_.Reset();
    head_ = 0;
    tail_ = 0;
    size_ = 0;
    for (int32_t i = 0; i < kWin; ++i) avg_ring_[i] = 0.0f;
    avg_sum_ = 0.0f;
    avg_pos_ = 0;
    n_ = 0;
    renv_ = 0.0f;
  }

 private:
  void Chunk(float* l, float* r, int from, int to) {
    const float* up_l = nullptr;
    const float* up_r = nullptr;
    if constexpr (kTruePeak) {
      up_l = tp_.os_l.Up(l, from, to);
      up_r = tp_.os_r.Up(r, from, to);
    }
    for (int i = from; i < to; ++i) {
      const float xl = l[i];
      const float xr = r[i];
      const float al = xl < 0.0f ? -xl : xl;
      const float ar = xr < 0.0f ? -xr : xr;
      float det = al > ar ? al : ar;
      if constexpr (kTruePeak) {
        const int b = (i - from) * 4;
        for (int k = 0; k < 4; ++k) {
          const float ul = up_l[b + k] < 0.0f ? -up_l[b + k] : up_l[b + k];
          if (ul > det) det = ul;
          const float ur = up_r[b + k] < 0.0f ? -up_r[b + k] : up_r[b + k];
          if (ur > det) det = ur;
        }
      }
      dl_l_.Write(xl);
      dl_r_.Write(xr);

      /* Required reduction in dB with exponential release toward zero. */
      const float need = det > ceil_lin_ ? LevelDb(det) - p_.ceiling_db : 0.0f;
      float renv = renv_ * rel_mul_;
      if (need > renv) renv = need;
      renv_ = renv;

      /* Sliding maximum over the last kWin reduction values. */
      while (size_ > 0 && dq_val_[Prev(tail_)] <= renv) {
        tail_ = Prev(tail_);
        --size_;
      }
      dq_val_[tail_] = renv;
      dq_idx_[tail_] = n_;
      tail_ = Next(tail_);
      ++size_;
      if (static_cast<uint32_t>(n_ - dq_idx_[head_]) >= static_cast<uint32_t>(kWin)) {
        head_ = Next(head_);
        --size_;
      }
      const float m = dq_val_[head_];

      /* Box average of that maximum over the same window length. */
      avg_sum_ += m - avg_ring_[avg_pos_];
      avg_ring_[avg_pos_] = m;
      ++avg_pos_;
      if (avg_pos_ == kWin) {
        avg_pos_ = 0;
        /* The incremental add-and-subtract is exact in the JS double but
         * drifts in float32 over minutes of audio. Rebuilding the sum
         * once per window costs one extra add per sample amortized and
         * pins the error at zero. */
        float s = 0.0f;
        for (int32_t k = 0; k < kWin; ++k) s += avg_ring_[k];
        avg_sum_ = s;
      }
      float red = avg_sum_ / static_cast<float>(kWin);
      if (red < 0.0f) red = 0.0f;

      const float g = fm::DbToGain(-red);
      l[i] = dl_l_.ReadInt(kLatency) * g;
      r[i] = dl_r_.ReadInt(kLatency) * g;
      ++n_;
    }
  }

  static constexpr int32_t Next(int32_t i) { return i + 1 == kDqCap ? 0 : i + 1; }
  static constexpr int32_t Prev(int32_t i) { return i == 0 ? kDqCap - 1 : i - 1; }

  Params p_;
  DelayLine<static_cast<uint32_t>(kLatency)> dl_l_, dl_r_;
  detail::LimiterTruePeak<kTruePeak, kMaxBlock> tp_;
  float dq_val_[kDqCap] = {};
  uint32_t dq_idx_[kDqCap] = {};
  float avg_ring_[kWin] = {};
  int32_t head_ = 0, tail_ = 0, size_ = 0, avg_pos_ = 0;
  float avg_sum_ = 0.0f;
  uint32_t n_ = 0;
  float sr_ = 48000.0f, ceil_lin_ = 1.0f, rel_mul_ = 0.0f, renv_ = 0.0f;
};

/* ------------------------------------------------------------------ */
/* Gate                                                                */
/* ------------------------------------------------------------------ */

namespace detail {

/* The EnvelopeFollower from src/dsp/envelopes.ts. It lives here rather
 * than in dsp/envelopes.h because the gate is the only thing in the
 * embedded port that wants one, and a header should not hand every
 * includer code it does not use. */
class EnvFollow {
 public:
  void Init(float sample_rate, float attack_sec, float release_sec) {
    a_ = OnePoleCoef(attack_sec, sample_rate);
    r_ = OnePoleCoef(release_sec, sample_rate);
    y_ = 0.0f;
  }
  inline float Process(float x) {
    const float v = x < 0.0f ? -x : x;
    y_ += (v > y_ ? a_ : r_) * (v - y_);
    return y_;
  }
  void Reset() { y_ = 0.0f; }

 private:
  float a_ = 1.0f, r_ = 1.0f, y_ = 0.0f;
};

}  // namespace detail

/* Open threshold sits at the threshold param, close 3 dB below it. */
inline constexpr float kGateHysteresisDb = 3.0f;

/*
 * Noise gate with hysteresis. The detector is a fast fixed envelope
 * follower; the gate opens when its level crosses the threshold and only
 * closes once it has stayed below threshold - 3 dB for the hold time.
 * Levels inside the band keep the current state and top the hold timer
 * up. Gain moves between the range floor and unity with separate attack
 * and release one-poles.
 *
 * No delay lines and no template parameters: this one is the same size at
 * every sample rate.
 */
class Gate {
 public:
  struct Params {
    float threshold_db = -40.0f;
    float attack = 0.001f;
    float hold = 0.05f;
    float release = 0.1f;
    /* Attenuation floor when closed. */
    float range_db = -60.0f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = sample_rate;
    det_.Init(sample_rate, 0.0002f, 0.002f);
    SetParams(p);
    g_ = floor_lin_;
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.threshold_db = Clamp(p_.threshold_db, -80.0f, 0.0f);
    open_db_ = p_.threshold_db;
    close_db_ = open_db_ - kGateHysteresisDb;
    a_coef_ = OnePoleCoef(Clamp(p_.attack, 0.0001f, 0.1f), sr_);
    r_coef_ = OnePoleCoef(Clamp(p_.release, 0.001f, 2.0f), sr_);
    hold_samples_ = static_cast<int32_t>(Clamp(p_.hold, 0.0f, 1.0f) * sr_ + 0.5f);
    floor_lin_ = fm::DbToGain(Clamp(p_.range_db, -80.0f, 0.0f));
  }

  void Process(float* l, float* r, int from, int to) {
    for (int i = from; i < to; ++i) {
      const float al = l[i] < 0.0f ? -l[i] : l[i];
      const float ar = r[i] < 0.0f ? -r[i] : r[i];
      const float det_db = LevelDb(det_.Process(al > ar ? al : ar));
      if (det_db >= open_db_) {
        open_ = true;
        hold_left_ = hold_samples_;
      } else if (open_) {
        if (det_db >= close_db_) {
          /* Hysteresis band: stay open, keep the hold timer topped up. */
          hold_left_ = hold_samples_;
        } else if (hold_left_ > 0) {
          --hold_left_;
        } else {
          open_ = false;
        }
      }
      const float target = open_ ? 1.0f : floor_lin_;
      g_ += (open_ ? a_coef_ : r_coef_) * (target - g_);
      l[i] *= g_;
      r[i] *= g_;
    }
  }

  void Reset() {
    det_.Reset();
    open_ = false;
    hold_left_ = 0;
    g_ = floor_lin_;
  }

 private:
  Params p_;
  detail::EnvFollow det_;
  float sr_ = 48000.0f;
  float open_db_ = -40.0f, close_db_ = -43.0f;
  float a_coef_ = 1.0f, r_coef_ = 1.0f, floor_lin_ = 0.001f, g_ = 0.0f;
  int32_t hold_samples_ = 0, hold_left_ = 0;
  bool open_ = false;
};

}  // namespace bellows
