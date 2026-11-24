/* Transcription of src/fx/delay.ts: the clean stereo delay, the tape
 * echo and the four tap multitap.
 *
 * The JS sizes each from its maxSeconds create option (4, 2 and 2
 * seconds by default). Here the maximum is a template parameter in
 * milliseconds, so the caller pays for the delay range they asked for and
 * nothing more. Each Ext class takes caller-placed storage for
 * SDRAM/PSRAM, and TapeDelaySamples / MultitapSamples say how much. */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/lfo.h"

namespace bellows {

class StereoDelayExt {
 public:
  struct Params {
    float time_l = 0.35f;
    float time_r = 0.5f;
    float feedback = 0.4f;
    float cross_feedback = 0.0f;
    float damping = 8000.0f;
    float mix = 0.35f;
  };

  /*
   * bufL and bufR are any length; they no longer have to be a power of two.
   * max_sec is the longest delay the caller asked for; pass 0 to use
   * whatever the buffer holds.
   *
   * The explicit maximum is kept even though StereoDelay now sizes its ring
   * to exactly what was asked, because this entry point also takes a
   * caller-supplied buffer of any size. It used to matter more: rings were
   * rounded up to a power of two, so a 250 ms request at 44100 got a 16384
   * sample ring holding 371 ms, and clamping at the ring would have handed
   * back 50 percent more delay than was asked for and disagreed with the
   * TypeScript, which clamps at exactly its maxSeconds.
   */
  void Init(float sample_rate, float* buf_l, float* buf_r, uint32_t cap,
            const Params& p, float max_sec = 0.0f) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    const float ring_sec = static_cast<float>(cap - 4) / sample_rate;
    max_sec_ = (max_sec > 0.0f && max_sec < ring_sec) ? max_sec : ring_sec;
    line_l_.Init(buf_l, cap);
    line_r_.Init(buf_r, cap);
    damp_l_.Init(sample_rate);
    damp_r_.Init(sample_rate);
    sm_l_.Init(sample_rate, 0.15f);
    sm_r_.Init(sample_rate, 0.15f);
    SetParams(p);
    sm_l_.Snap(p_.time_l * sample_rate);
    sm_r_.Snap(p_.time_r * sample_rate);
  }

  void SetParams(const Params& p) {
    p_ = p;
    if (p_.time_l > max_sec_) p_.time_l = max_sec_;
    if (p_.time_r > max_sec_) p_.time_r = max_sec_;
    sm_l_.SetTarget(p_.time_l * sr_);
    sm_r_.SetTarget(p_.time_r * sr_);
    damp_l_.SetLowpass(p_.damping);
    damp_r_.SetLowpass(p_.damping);
  }

  void Process(float* l, float* r, int from, int to) {
    float fb = p_.feedback;
    float x = p_.cross_feedback;
    float mix = p_.mix;
    float dry = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      float dl = sm_l_.Process();
      float dr = sm_r_.Process();
      float wet_l = line_l_.ReadCubic(dl - 1.0f);
      float wet_r = line_r_.ReadCubic(dr - 1.0f);
      float fb_l = damp_l_.Process(fb * ((1.0f - x) * wet_l + x * wet_r));
      float fb_r = damp_r_.Process(fb * ((1.0f - x) * wet_r + x * wet_l));
      line_l_.Write(l[i] + fb_l);
      line_r_.Write(r[i] + fb_r);
      l[i] = dry * l[i] + mix * wet_l;
      r[i] = dry * r[i] + mix * wet_r;
    }
  }

  void Reset() {
    line_l_.Clear();
    line_r_.Clear();
    damp_l_.Reset();
    damp_r_.Reset();
  }

 private:
  float sr_ = 48000.0f, max_sec_ = 1.0f;
  Params p_;
  DelayLineExt line_l_, line_r_;
  OnePole damp_l_, damp_r_;
  Smoother sm_l_, sm_r_;
};

/* Owning form: kMaxMs of delay per side, in .bss. */
template <uint32_t kMaxMs = 500, uint32_t kSampleRate = BELLOWS_SAMPLE_RATE>
class StereoDelay : public StereoDelayExt {
 public:
  static constexpr uint32_t kCap = (kMaxMs * kSampleRate) / 1000 + 4;

  void Init(float sample_rate) {
    Params p;
    Init(sample_rate, p);
  }
  void Init(float sample_rate, const Params& p) {
    /* Clamp at the kMaxMs that was asked for. The ring is now sized to
     * exactly that, so the two agree, but the explicit limit stays because
     * StereoDelayExt is also reachable with a caller-sized buffer. */
    StereoDelayExt::Init(sample_rate, l_, r_, kCap, p, kMaxMs * 0.001f);
  }

 private:
  float l_[kCap];
  float r_[kCap];
};

namespace delay_detail {

/* ceil of a non-negative float, usable in a constant expression. */
inline constexpr uint32_t CeilU(float x) {
  const uint32_t t = static_cast<uint32_t>(x);
  return static_cast<float>(t) < x ? t + 1u : t;
}

/* A length the JS quotes in samples at 44100, as Math.round(n * (sr /
 * 44100)), floored at 1. Integer arithmetic against an integer rate;
 * checked against the JS double from 8 kHz to 192 kHz in 50 Hz steps for
 * every length the multitap uses, with no disagreement. */
inline constexpr uint32_t Scale44k(uint32_t n, uint32_t sr) {
  const uint32_t v = static_cast<uint32_t>((static_cast<uint64_t>(n) * sr + 22050u) / 44100u);
  return v < 1u ? 1u : v;
}

/* Wow and flutter depth in seconds at a setting of 1. */
inline constexpr float kWowDepthSec = 0.004f;
inline constexpr float kFlutterDepthSec = 0.0004f;

/* Seed of rng('fx/tapeDelay/hiss'), the fixed stream the JS tape delay
 * draws its hiss from, hashed at compile time for the reason kLfoDefaultSeed
 * is. Node, same generator: xmur3('fx/tapeDelay/hiss')() is 0x5bc28b25. */
inline constexpr uint32_t kTapeHissSeed = Xmur3("fx/tapeDelay/hiss");
static_assert(kTapeHissSeed == 0x5bc28b25u, "the tape hiss stream is rng('fx/tapeDelay/hiss')");

/* Multitap diffuser lengths in samples at 44100, slightly different per side. */
inline constexpr uint32_t kMtApL[2] = {113, 173};
inline constexpr uint32_t kMtApR[2] = {127, 181};

/* One tape channel: delay line plus the filters that live in its loop. */
class TapeHead {
 public:
  void Init(float sample_rate, float* buf, uint32_t cap) {
    line_.Init(buf, cap);
    tone_.Init(sample_rate);
    bump_.Init(sample_rate);
    bump_.SetMode(SvfMode::kBell);
    /* Head bump: gentle low mid emphasis every trip around the loop. */
    bump_.Set(90.0f, 0.7f, 3.0f);
  }

  void SetTone(float hz) { tone_.SetLowpass(hz); }

  /* Read the wet tap, run the feedback path, write. Returns the wet sample. */
  inline float Tick(float x, float read_pos, float fb, float drive, float hiss) {
    const float wet = line_.ReadCubic(read_pos);
    float f = tone_.Process(fb * wet);
    f = bump_.Process(f);
    f = fm::Tanh(drive * (f + hiss)) / drive;
    line_.Write(x + f);
    return wet;
  }

  void Reset() {
    line_.Clear();
    tone_.Reset();
    bump_.Reset();
  }

 private:
  DelayLineExt line_;
  OnePole tone_;
  Svf bump_;
};

/* Schroeder allpass, H(z) = (-g + z^-D) / (1 - g z^-D), with a gain the
 * multitap's diffusion param sets live. */
class Allpass {
 public:
  void Init(float* buf, uint32_t cap, uint32_t len) {
    dl_.Init(buf, cap);
    len_ = len;
  }

  void SetGain(float g) { g_ = g; }

  inline float Process(float x) {
    const float z = dl_.ReadInt(static_cast<int32_t>(len_) - 1);
    const float v = x + g_ * z;
    dl_.Write(v);
    return z - g_ * v;
  }

  void Reset() { dl_.Clear(); }

 private:
  DelayLineExt dl_;
  uint32_t len_ = 1;
  float g_ = 0.0f;
};

}  // namespace delay_detail

/*
 * Floats per side TapeDelayExt needs for max_sec of nominal delay at this
 * rate: the JS ring, ceil((max + wow + flutter) * sr) + 8, plus the four
 * samples of slack DelayLineExt keeps past its longest read.
 */
inline constexpr uint32_t TapeDelaySamples(uint32_t sample_rate, float max_sec) {
  return delay_detail::CeilU((max_sec + delay_detail::kWowDepthSec + delay_detail::kFlutterDepthSec) *
                             static_cast<float>(sample_rate)) +
         8u + 4u;
}

/*
 * The tape echo: one transport (a 0.3 s time smoother and a shared wow and
 * flutter pair moving both read heads), and per side a loop of tone
 * lowpass, head bump bell, tanh saturation and optional hiss. Feedback runs
 * to 1.1, so with saturation the loop can sustain itself, as tape does.
 */
class TapeDelayExt {
 public:
  struct Params {
    float time = 0.35f;
    float feedback = 0.45f;
    float wow = 0.3f;
    float flutter = 0.15f;
    float saturation = 0.4f;
    float tone = 4500.0f;
    float hiss = 0.0f;
    float mix = 0.35f;
  };

  /*
   * buf_l and buf_r hold cap floats each; size them with TapeDelaySamples.
   * max_sec is the longest time the caller asked for, the JS maxSeconds;
   * pass 0 to use whatever the buffer holds once the wow and flutter
   * excursion is taken out of it.
   */
  void Init(float sample_rate, float* buf_l, float* buf_r, uint32_t cap, const Params& p,
            float max_sec = 0.0f) {
    namespace dd = delay_detail;
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    /* The inverse of TapeDelaySamples. */
    const float ring_sec = static_cast<float>(cap > 12u ? cap - 12u : 0u) / sr_ -
                           (dd::kWowDepthSec + dd::kFlutterDepthSec);
    max_sec_ = (max_sec > 0.0f && max_sec <= ring_sec) ? max_sec : ring_sec;
    head_l_.Init(sr_, buf_l, cap);
    head_r_.Init(sr_, buf_r, cap);
    /* Tape time changes slew slowly, that is most of the charm. */
    sm_.Init(sr_, 0.3f);
    wow_.Init(sr_);
    wow_.SetFreq(0.5f);
    flutter_.Init(sr_);
    flutter_.SetFreq(6.0f);
    noise_.Init(dd::kTapeHissSeed);
    SetParams(p);
    sm_.Snap(p_.time * sr_);
  }

  void SetParams(const Params& p) {
    namespace dd = delay_detail;
    p_ = p;
    p_.time = Clamp(p_.time, 0.005f, max_sec_);
    sm_.SetTarget(p_.time * sr_);
    p_.feedback = Clamp(p_.feedback, 0.0f, 1.1f);
    wow_depth_ = Clamp(p_.wow, 0.0f, 1.0f) * dd::kWowDepthSec * sr_;
    flutter_depth_ = Clamp(p_.flutter, 0.0f, 1.0f) * dd::kFlutterDepthSec * sr_;
    drive_ = 1.0f + 4.0f * Clamp(p_.saturation, 0.0f, 1.0f);
    const float tone = Clamp(p_.tone, 500.0f, 15000.0f);
    head_l_.SetTone(tone);
    head_r_.SetTone(tone);
    hiss_level_ = Clamp(p_.hiss, 0.0f, 1.0f) * 0.002f;
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
  }

  void Process(float* l, float* r, int from, int to) {
    const float fb = p_.feedback;
    const float drive = drive_;
    const float mix = p_.mix;
    const float dry = 1.0f - mix;
    /* The stream is only drawn from while hiss is on, as in the JS, so
     * turning it on later picks the stream up where it was left. */
    const bool hiss_on = hiss_level_ > 0.0f;
    for (int i = from; i < to; ++i) {
      const float d = sm_.Process();
      /* Both channels share the transport, so one wow and flutter pair. */
      const float w = wow_.Process() * wow_depth_;
      const float pos = d - 1.0f + (w + flutter_.Process() * flutter_depth_);
      const float h_l = hiss_on ? noise_.Bipolar() * hiss_level_ : 0.0f;
      const float h_r = hiss_on ? noise_.Bipolar() * hiss_level_ : 0.0f;
      const float wet_l = head_l_.Tick(l[i], pos, fb, drive, h_l);
      const float wet_r = head_r_.Tick(r[i], pos, fb, drive, h_r);
      l[i] = dry * l[i] + mix * wet_l;
      r[i] = dry * r[i] + mix * wet_r;
    }
  }

  /* Clears the tape and restarts the transport. The hiss stream runs on,
   * as the JS one does. */
  void Reset() {
    head_l_.Reset();
    head_r_.Reset();
    wow_.Reset();
    flutter_.Reset();
    sm_.Snap(p_.time * sr_);
  }

 private:
  float sr_ = 48000.0f, max_sec_ = 1.0f;
  float wow_depth_ = 0.0f, flutter_depth_ = 0.0f, drive_ = 1.0f, hiss_level_ = 0.0f;
  Params p_;
  delay_detail::TapeHead head_l_, head_r_;
  Smoother sm_;
  Lfo wow_, flutter_;
  Rng noise_;
};

/* Owning form: kMaxMs of nominal delay per side, in .bss. */
template <uint32_t kMaxMs = 500, uint32_t kSampleRate = BELLOWS_SAMPLE_RATE>
class TapeDelay : public TapeDelayExt {
 public:
  static constexpr uint32_t kCap = TapeDelaySamples(kSampleRate, kMaxMs * 0.001f);

  void Init(float sample_rate) {
    Params p;
    Init(sample_rate, p);
  }
  void Init(float sample_rate, const Params& p) {
    TapeDelayExt::Init(sample_rate, l_, r_, kCap, p, kMaxMs * 0.001f);
  }

 private:
  float l_[kCap];
  float r_[kCap];
};

/*
 * Floats per side MultitapExt needs for max_sec at this rate: the JS line,
 * ceil(max * sr) + 8, and the longer side's two diffusers (the right), each
 * with the four samples of slack DelayLineExt keeps.
 */
inline constexpr uint32_t MultitapSamples(uint32_t sample_rate, float max_sec) {
  return delay_detail::CeilU(max_sec * static_cast<float>(sample_rate)) + 8u + 4u +
         delay_detail::Scale44k(delay_detail::kMtApR[0], sample_rate) + 4u +
         delay_detail::Scale44k(delay_detail::kMtApR[1], sample_rate) + 4u;
}

/*
 * Four taps off one line per side, no feedback, summed and diffused
 * through two Schroeder allpasses whose gain is the diffusion param.
 */
class MultitapExt {
 public:
  static constexpr int kTaps = 4;

  struct Params {
    float time[kTaps] = {0.125f, 0.25f, 0.375f, 0.5f};
    float level[kTaps] = {1.0f, 0.8f, 0.6f, 0.45f};
    float diffusion = 0.4f;
    float mix = 0.5f;
  };

  /*
   * buf_l and buf_r hold cap floats each, the line and that side's two
   * diffusers; size them with MultitapSamples. max_sec is the longest tap
   * time the caller asked for, the JS maxSeconds; pass 0 to use whatever
   * the shorter line holds. Returns false, and Process does nothing, when
   * the rate is unusable or cap cannot hold the diffusers and a line.
   */
  bool Init(float sample_rate, float* buf_l, float* buf_r, uint32_t cap, const Params& p,
            float max_sec = 0.0f) {
    namespace dd = delay_detail;
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    ready_ = false;
    /* The diffuser lengths are scaled by this integer rate, so refuse a
     * rate the cast cannot take, as PlateExt does. */
    constexpr float kSampleRateMax = 16777216.0f;
    if (!(sample_rate > 0.0f) || sample_rate > kSampleRateMax) return false;
    if (buf_l == nullptr || buf_r == nullptr) return false;
    const uint32_t sr_i = static_cast<uint32_t>(sample_rate + 0.5f);
    uint32_t used_l = 0, used_r = 0;
    for (int k = 0; k < 2; ++k) {
      used_l += dd::Scale44k(dd::kMtApL[k], sr_i) + 4u;
      used_r += dd::Scale44k(dd::kMtApR[k], sr_i) + 4u;
    }
    /* A line shorter than the JS margin of 8 plus the slack holds nothing. */
    if (cap < used_r + 16u) return false;

    uint32_t off_l = 0, off_r = 0;
    for (int k = 0; k < 2; ++k) {
      const uint32_t len_l = dd::Scale44k(dd::kMtApL[k], sr_i);
      const uint32_t len_r = dd::Scale44k(dd::kMtApR[k], sr_i);
      ap_l_[k].Init(buf_l + off_l, len_l + 4u, len_l);
      ap_r_[k].Init(buf_r + off_r, len_r + 4u, len_r);
      off_l += len_l + 4u;
      off_r += len_r + 4u;
    }
    line_l_.Init(buf_l + used_l, cap - used_l);
    line_r_.Init(buf_r + used_r, cap - used_r);
    /* The inverse of MultitapSamples, on the shorter (right) line. */
    const float ring_sec = static_cast<float>(cap - used_r - 12u) / sr_;
    max_sec_ = (max_sec > 0.0f && max_sec <= ring_sec) ? max_sec : ring_sec;
    for (int k = 0; k < kTaps; ++k) sm_[k].Init(sr_, 0.1f);
    ready_ = true;
    SetParams(p);
    for (int k = 0; k < kTaps; ++k) sm_[k].Snap(p_.time[k] * sr_);
    return true;
  }

  void SetParams(const Params& p) {
    p_ = p;
    for (int k = 0; k < kTaps; ++k) {
      p_.time[k] = Clamp(p_.time[k], 0.001f, max_sec_);
      sm_[k].SetTarget(p_.time[k] * sr_);
      p_.level[k] = Clamp(p_.level[k], 0.0f, 1.0f);
    }
    const float g = Clamp(p_.diffusion, 0.0f, 1.0f) * 0.7f;
    for (int k = 0; k < 2; ++k) {
      ap_l_[k].SetGain(g);
      ap_r_[k].SetGain(g);
    }
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    const float mix = p_.mix;
    const float dry = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      /* Write first: no feedback, so taps read the current history directly. */
      line_l_.Write(l[i]);
      line_r_.Write(r[i]);
      float wet_l = 0.0f;
      float wet_r = 0.0f;
      for (int k = 0; k < kTaps; ++k) {
        const float d = sm_[k].Process();
        const float lv = p_.level[k];
        wet_l += lv * line_l_.ReadCubic(d);
        wet_r += lv * line_r_.ReadCubic(d);
      }
      wet_l = ap_l_[1].Process(ap_l_[0].Process(wet_l));
      wet_r = ap_r_[1].Process(ap_r_[0].Process(wet_r));
      l[i] = dry * l[i] + mix * wet_l;
      r[i] = dry * r[i] + mix * wet_r;
    }
  }

  void Reset() {
    if (!ready_) return;
    line_l_.Clear();
    line_r_.Clear();
    for (int k = 0; k < 2; ++k) {
      ap_l_[k].Reset();
      ap_r_[k].Reset();
    }
    for (int k = 0; k < kTaps; ++k) sm_[k].Snap(p_.time[k] * sr_);
  }

 private:
  float sr_ = 48000.0f, max_sec_ = 1.0f;
  Params p_;
  DelayLineExt line_l_, line_r_;
  delay_detail::Allpass ap_l_[2], ap_r_[2];
  Smoother sm_[kTaps];
  bool ready_ = false;
};

/* Owning form: kMaxMs of tap time per side, in .bss. */
template <uint32_t kMaxMs = 500, uint32_t kSampleRate = BELLOWS_SAMPLE_RATE>
class Multitap : public MultitapExt {
 public:
  static constexpr uint32_t kCap = MultitapSamples(kSampleRate, kMaxMs * 0.001f);

  bool Init(float sample_rate) {
    Params p;
    return Init(sample_rate, p);
  }
  bool Init(float sample_rate, const Params& p) {
    return MultitapExt::Init(sample_rate, l_, r_, kCap, p, kMaxMs * 0.001f);
  }

 private:
  float l_[kCap];
  float r_[kCap];
};

}  // namespace bellows
