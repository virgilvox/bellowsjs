/* Transcription of src/fx/reverb.ts.
 *
 * Feedback delay network reverb. Eight delay lines feed back through the
 * Householder reflection H = I - (2/N) v v^T with v = ones, which is
 * orthogonal (energy preserving) and applies in O(N): every line output
 * loses twice the mean of all outputs.
 *
 * Line lengths come from a millisecond table scaled by the size param and
 * snapped to the nearest prime, so the lengths stay mutually prime and
 * echo periods never align. Loop gain per line follows the RT60 rule
 * g_i = 10^(-3 L_i / (rt60 sr)), so every path loses 60 dB in the
 * configured decay time regardless of its length. Per line one pole
 * lowpasses shorten the decay of highs (damp, in Hz), slow sine Lfos
 * wobble the read positions a few samples (chorus) to break up metallic
 * ringing, and four serial allpasses diffuse the input.
 *
 * Memory. The JS sizes the eight lines from its maxSize create option
 * (default 3) and fixes the predelay ceiling at 250 ms. Here both are
 * caller choices, as the plate's predelay ceiling is: FdnExt carves every
 * element out of one caller buffer, sized by
 * fdn_detail::TotalSamples(sample_rate, max_size_pct, predelay_ms), where
 * max_size_pct is the largest size in hundredths (300 is the JS default).
 * At 48 kHz that is 54624 floats, 218496 bytes, for the JS defaults, and
 * 17673 floats, 70692 bytes, for size up to 1 with a 50 ms predelay. The
 * sizing is integer arithmetic against a rounded sample rate, so the
 * constexpr sizing function and the runtime carve agree to the sample.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/lfo.h"

namespace bellows {
namespace fdn_detail {

inline constexpr int kLines = 8;
/* Base line lengths in milliseconds at size 1, snapped to primes in samples. */
inline constexpr float kBaseMs[kLines] = {23.9f, 26.6f, 29.8f, 32.8f, 36.6f, 40.7f, 44.9f, 49.6f};
/* The same in tenths of a millisecond, for the integer sizing. */
inline constexpr uint32_t kBaseTenthMs[kLines] = {239, 266, 298, 328, 366, 407, 449, 496};
/* Input diffuser lengths in tenths of a millisecond (3.1, 4.3, 5.9, 7.9 ms). */
inline constexpr uint32_t kDiffTenthMs[4] = {31, 43, 59, 79};
inline constexpr float kDiffG = 0.625f;
/* Read position modulation depth in samples at chorus 1. */
inline constexpr float kModSamples = 5.0f;
/* Per line modulation rates in Hz, spread so wobbles never phase lock. */
inline constexpr float kModHz[kLines] = {0.53f, 0.71f, 0.89f, 1.07f, 1.19f, 0.61f, 0.97f, 1.31f};
inline constexpr float kSizeMin = 0.25f;

inline constexpr bool IsPrime(uint32_t n) {
  if (n < 2u) return false;
  if (n % 2u == 0u) return n == 2u;
  for (uint32_t d = 3u; d * d <= n; d += 2u) {
    if (n % d == 0u) return false;
  }
  return true;
}

/* Nearest prime to an already rounded m (ties resolve downward), as the JS
 * nearestPrime does after its Math.round. Control rate only. */
inline constexpr uint32_t NearestPrime(uint32_t m) {
  if (m < 2u) m = 2u;
  if (IsPrime(m)) return m;
  for (uint32_t k = 1u;; ++k) {
    if (k < m && m - k >= 2u && IsPrime(m - k)) return m - k;
    if (IsPrime(m + k)) return m + k;
  }
}

/* Diffuser i's length at this rate: nearestPrime((ms / 1000) * sr). The
 * rounding is integer here and double in the JS; the two were checked from
 * 8 kHz to 192 kHz in 50 Hz steps and never disagree. */
inline constexpr uint32_t DiffLen(int i, uint32_t sr) {
  return NearestPrime(static_cast<uint32_t>((static_cast<uint64_t>(kDiffTenthMs[i]) * sr + 5000u) / 10000u));
}

/* Line i's capacity, the JS ceil((ms / 1000) * sr * maxSize) + 64, which is
 * also the JS DelayLine's maxDelay. The double in the JS lands one sample
 * higher where the product is an exact integer (26.6 ms at 15 kHz is 399.0
 * here and 399.00000000000006 there); that only moves a length clamp the
 * prime search never reaches, since it binds 55 samples above the target. */
inline constexpr uint32_t LineCap(int i, uint32_t sr, uint32_t max_size_pct) {
  return static_cast<uint32_t>(
             (static_cast<uint64_t>(kBaseTenthMs[i]) * sr * max_size_pct + 999999u) / 1000000u) +
         64u;
}

/* Predelay line capacity, the JS ceil(0.25 * sr) + 8 at a 250 ms ceiling. */
inline constexpr uint32_t PreCap(uint32_t sr, uint32_t predelay_ms) {
  return static_cast<uint32_t>((static_cast<uint64_t>(sr) * predelay_ms + 999u) / 1000u) + 8u;
}

/* Buffer one element claims: what it reads, plus the four samples of slack
 * DelayLineExt keeps past its longest read. */
inline constexpr uint32_t Cap(uint32_t need) { return need + 4u; }

/* Total float count FdnExt::Init carves. Init walks the elements in exactly
 * this order: the eight lines, the four diffusers, the predelay line. */
inline constexpr uint32_t TotalSamples(uint32_t sr, uint32_t max_size_pct, uint32_t predelay_ms) {
  uint32_t t = 0;
  for (int i = 0; i < kLines; ++i) t += Cap(LineCap(i, sr, max_size_pct));
  for (int i = 0; i < 4; ++i) t += Cap(DiffLen(i, sr));
  t += Cap(PreCap(sr, predelay_ms));
  return t;
}

/* Schroeder allpass on a delay line, used for input diffusion. */
class Allpass {
 public:
  void Init(float* buf, uint32_t cap, uint32_t len, float g) {
    dl_.Init(buf, cap);
    len_ = len;
    g_ = g;
  }

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

}  // namespace fdn_detail

/*
 * The FDN over caller-supplied storage. Init carves the buffer and returns
 * false if it is too short or the rate is unusable, in which case Process
 * is a no-op rather than a fault.
 */
class FdnExt {
 public:
  struct Params {
    float size = 1.0f;
    float decay = 2.0f;
    float damp = 6000.0f;
    float chorus = 0.3f;
    float predelay = 0.01f;
    float mix = 0.35f;
  };

  /*
   * max_size_pct sizes the lines, in hundredths of the size param.
   * max_size, when given, is where the size param clamps (the JS maxSize);
   * it is the carve's max_size_pct / 100 otherwise. A max_size past the
   * carve is not an overrun: each length also stops at what its line holds.
   */
  bool Init(float sample_rate, float* buf, uint32_t buf_len, uint32_t max_size_pct,
            uint32_t predelay_ms, const Params& p, float max_size = 0.0f) {
    namespace fd = fdn_detail;
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    ready_ = false;
    /* Every length below is scaled by this integer rate, so refuse a rate
     * the cast cannot take, as PlateExt does. */
    constexpr float kSampleRateMax = 16777216.0f;
    if (!(sample_rate > 0.0f) || sample_rate > kSampleRateMax) return false;
    const uint32_t sr_i = static_cast<uint32_t>(sample_rate + 0.5f);
    if (buf == nullptr || buf_len < fd::TotalSamples(sr_i, max_size_pct, predelay_ms)) return false;
    max_size_ = max_size > 0.0f ? max_size : static_cast<float>(max_size_pct) * 0.01f;
    max_predelay_ = static_cast<float>(predelay_ms) * 0.001f;

    /* Same walk, same order, as TotalSamples. */
    uint32_t off = 0;
    for (int k = 0; k < fd::kLines; ++k) {
      const uint32_t cap = fd::Cap(fd::LineCap(k, sr_i, max_size_pct));
      line_[k].Init(buf + off, cap);
      off += cap;
      damp_[k].Init(sr_);
      lfo_[k].Init(sr_);
      lfo_[k].SetFreq(fd::kModHz[k]);
      lfo_[k].Reset(static_cast<float>(k) / static_cast<float>(fd::kLines));
    }
    for (int k = 0; k < 4; ++k) {
      const uint32_t len = fd::DiffLen(k, sr_i);
      diff_[k].Init(buf + off, fd::Cap(len), len, fd::kDiffG);
      off += fd::Cap(len);
    }
    pre_.Init(buf + off, fd::Cap(fd::PreCap(sr_i, predelay_ms)));
    pre_sm_.Init(sr_, 0.05f);

    ready_ = true;
    size_set_ = -1.0f;
    decay_set_ = -1.0f;
    SetParams(p);
    pre_sm_.Snap(p_.predelay * sr_);
    return true;
  }

  /* The JS recomputes the lengths only on a size change and the gains on a
   * size or decay change; so does this, since the prime search is the one
   * costly step and the rest is idempotent. */
  void SetParams(const Params& p) {
    p_ = p;
    p_.size = Clamp(p_.size, fdn_detail::kSizeMin, max_size_);
    p_.decay = Clamp(p_.decay, 0.1f, 20.0f);
    const float hz = Clamp(p_.damp, 500.0f, 20000.0f);
    for (int k = 0; k < fdn_detail::kLines; ++k) damp_[k].SetLowpass(hz);
    mod_depth_ = Clamp(p_.chorus, 0.0f, 1.0f) * fdn_detail::kModSamples;
    p_.predelay = Clamp(p_.predelay, 0.0f, max_predelay_);
    pre_sm_.SetTarget(p_.predelay * sr_);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    if (!ready_) return;
    bool gains = p_.decay != decay_set_;
    if (p_.size != size_set_) {
      UpdateLengths();
      size_set_ = p_.size;
      gains = true;
    }
    if (gains) {
      UpdateGains();
      decay_set_ = p_.decay;
    }
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    const float mix = p_.mix;
    const float dry = 1.0f - mix;
    float s[fdn_detail::kLines];
    for (int i = from; i < to; ++i) {
      pre_.Write(0.5f * (l[i] + r[i]));
      float x = pre_.ReadLinear(pre_sm_.Process());
      x = diff_[3].Process(diff_[2].Process(diff_[1].Process(diff_[0].Process(x))));
      /* Read every line, damp and scale, then reflect and write back.
       * Alternating signs across the L and R sums decorrelate the outputs. */
      float wl = 0.0f;
      float wr = 0.0f;
      for (int k = 0; k < fdn_detail::kLines; ++k) {
        /* The Lfos stand still while chorus is 0, as in the JS. */
        const float mod = mod_depth_ == 0.0f ? 0.0f : mod_depth_ * lfo_[k].Process();
        const float out = line_[k].ReadCubic(len_f_[k] - 1.0f + mod);
        s[k] = damp_[k].Process(out) * gain_[k];
        if (k & 1) wr += (k & 2) ? -out : out;
        else wl += (k & 2) ? -out : out;
      }
      /* Householder reflection for v = ones: s -= (2 / N) sum(s). */
      float sum = 0.0f;
      for (int k = 0; k < fdn_detail::kLines; ++k) sum += s[k];
      sum *= 2.0f / static_cast<float>(fdn_detail::kLines);
      for (int k = 0; k < fdn_detail::kLines; ++k) line_[k].Write(s[k] - sum + x);
      l[i] = dry * l[i] + mix * 0.35f * wl;
      r[i] = dry * r[i] + mix * 0.35f * wr;
    }
  }

  void Reset() {
    if (!ready_) return;
    for (int k = 0; k < fdn_detail::kLines; ++k) {
      line_[k].Clear();
      damp_[k].Reset();
      lfo_[k].Reset(static_cast<float>(k) / static_cast<float>(fdn_detail::kLines));
    }
    for (int k = 0; k < 4; ++k) diff_[k].Reset();
    pre_.Clear();
    pre_sm_.Snap(p_.predelay * sr_);
  }

 private:
  void UpdateLengths() {
    for (int k = 0; k < fdn_detail::kLines; ++k) {
      const float target = (fdn_detail::kBaseMs[k] / 1000.0f) * sr_ * p_.size;
      /* Math.round, then the prime search. */
      const uint32_t n = fdn_detail::NearestPrime(static_cast<uint32_t>(target + 0.5f));
      /* Room for the chorus excursion and the cubic window, as in the JS. */
      const uint32_t max = line_[k].MaxDelay();
      const uint32_t lim = max > 9u ? max - 9u : 0u;
      len_[k] = n < lim ? n : lim;
      len_f_[k] = static_cast<float>(len_[k]);
    }
  }

  void UpdateGains() {
    for (int k = 0; k < fdn_detail::kLines; ++k) {
      gain_[k] = fm::Pow(10.0f, (-3.0f * len_f_[k]) / (p_.decay * sr_));
    }
  }

  Params p_;
  DelayLineExt line_[fdn_detail::kLines];
  OnePole damp_[fdn_detail::kLines];
  Lfo lfo_[fdn_detail::kLines];
  fdn_detail::Allpass diff_[4];
  DelayLineExt pre_;
  Smoother pre_sm_;
  uint32_t len_[fdn_detail::kLines] = {};
  float len_f_[fdn_detail::kLines] = {};
  float gain_[fdn_detail::kLines] = {};
  float sr_ = 48000.0f, max_size_ = 3.0f, max_predelay_ = 0.25f;
  float mod_depth_ = 0.0f;
  float size_set_ = -1.0f, decay_set_ = -1.0f;
  bool ready_ = false;
};

/*
 * Owning form. kMaxSizePct is the largest size in hundredths and
 * kMaxPredelayMs the predelay ceiling; the defaults are the JS ones.
 */
template <int kSampleRate = BELLOWS_SAMPLE_RATE, int kMaxSizePct = 300, int kMaxPredelayMs = 250>
class Fdn : public FdnExt {
 public:
  static constexpr uint32_t kStoreSamples = fdn_detail::TotalSamples(
      static_cast<uint32_t>(kSampleRate), static_cast<uint32_t>(kMaxSizePct),
      static_cast<uint32_t>(kMaxPredelayMs));

  bool Init(float sample_rate) {
    Params d;
    return Init(sample_rate, d);
  }

  bool Init(float sample_rate, const Params& p) {
    return FdnExt::Init(sample_rate, store_, kStoreSamples, kMaxSizePct, kMaxPredelayMs, p);
  }

 private:
  float store_[kStoreSamples];
};

}  // namespace bellows
