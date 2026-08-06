/* Transcription of src/fx/plate.ts.
 *
 * Dattorro plate reverb (Jon Dattorro, "Effect Design Part 1:
 * Reverberator and Other Filters", JAES 1997, Fig. 1). Signal path:
 * predelay, one pole bandwidth filter, four input diffusers
 * (coefficients 0.75, 0.75, 0.625, 0.625), then the figure-eight tank.
 * Each tank branch is a modulated allpass (decay diffusion 1 = 0.7,
 * excursion about 8 samples), a delay, a one pole damping filter, the
 * decay gain, a second allpass (decay diffusion 2 = 0.5), and a final
 * delay whose output crosses into the other branch. Left and right
 * outputs sum seven taps each out of the tank buffers at the paper's
 * sample offsets.
 *
 * All lengths and tap offsets are quoted at the paper's 29761 Hz rate and
 * scaled to the actual sample rate at construction, exactly as in the JS.
 * The scaling is done in integer arithmetic against a rounded sample
 * rate, so the constexpr sizing function and the runtime carve agree to
 * the sample; every audio rate anyone runs this at is an integer anyway.
 *
 * Memory is the whole story here. Thirteen delay elements, each sized to
 * exactly what it reads. They used to be rounded up to a power of two,
 * matching the JS DelayLine, which cost 264 KB at 48 kHz; the lengths are
 * odd and mutually prime by design, which is close to the worst case for
 * that rounding, so exact sizing is worth more here than anywhere else in
 * the library.
 *
 * That is more than the internal SRAM of most parts this library targets,
 * so PlateExt takes one caller-supplied float buffer and carves the
 * thirteen elements out of it. The caller decides where that buffer
 * lives: EXTMEM on a Teensy 4.1, DSY_SDRAM_BSS on a Daisy, plain .bss on
 * anything with room. Plate<kSampleRate, kMaxPredelayMs> owns its storage
 * for the cases where that fits, and the predelay ceiling is a template
 * parameter because at 48 kHz it alone is 46.9 KB: dropping it from 250 ms
 * to 50 ms takes the total from 189.1 KB to 151.6 KB, and the tank on its
 * own is 142.2 KB. Those were 64 KB, 216 KB and 200 KB while the elements
 * were rounded up to a power of two.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/lfo.h"

namespace bellows {
namespace plate_detail {

/* The paper's reference sample rate. */
inline constexpr uint32_t kRefRate = 29761;
/* Peak read position excursion in samples at kRefRate, at mod_depth 1. */
inline constexpr uint32_t kExcursion = 8;
inline constexpr float kModDepthMax = 2.0f;

/* Input diffuser lengths and coefficients, in paper order. */
inline constexpr uint32_t kDiffLen[4] = {142, 107, 379, 277};
inline constexpr float kDiffG[4] = {0.75f, 0.75f, 0.625f, 0.625f};

/* Tank element lengths at kRefRate. */
inline constexpr uint32_t kApA1 = 672, kDelA1 = 4453, kApA2 = 1800, kDelA2 = 3720;
inline constexpr uint32_t kApB1 = 908, kDelB1 = 4217, kApB2 = 2656, kDelB2 = 3163;
inline constexpr float kDecayDiff1 = 0.7f;
inline constexpr float kDecayDiff2 = 0.5f;

/* Left output tap offsets at kRefRate: B1, B1, apB2, B2, A1, apA2, A2. */
inline constexpr uint32_t kTapsL[7] = {266, 2974, 1913, 1996, 1990, 187, 1066};
/* Right output tap offsets at kRefRate: A1, A1, apA2, A2, B1, apB2, B2. */
inline constexpr uint32_t kTapsR[7] = {353, 3627, 1228, 2673, 2111, 335, 121};

/* A length quoted at kRefRate, rounded to the nearest sample at sr. */
inline constexpr uint32_t Scale(uint32_t n, uint32_t sr) {
  const uint32_t v = (n * sr + kRefRate / 2u) / kRefRate;
  return v < 1u ? 1u : v;
}

/* Read-position headroom the two modulated allpasses need: full positive
 * excursion at the maximum mod depth, plus room for the cubic reader's
 * four point window. */
inline constexpr uint32_t ExcExtra(uint32_t sr) {
  return (2u * kExcursion * sr + kRefRate - 1u) / kRefRate + 8u;
}

/* Buffer a single element claims. The +4 mirrors DelayLine<N>, which
 * keeps four samples of slack past the longest read. Exact, not rounded:
 * the thirteen Dattorro lengths are odd numbers chosen to be mutually
 * prime, which is close to the worst case for power-of-two rounding. */
inline constexpr uint32_t Cap(uint32_t need) { return need + 4u; }

/* Total float count PlateExt::Init carves at this rate and predelay
 * ceiling. Init walks the elements in exactly this order. */
inline constexpr uint32_t TotalSamples(uint32_t sr, uint32_t predelay_ms) {
  uint32_t t = Cap((sr * predelay_ms) / 1000u + 8u);
  for (int i = 0; i < 4; ++i) t += Cap(Scale(kDiffLen[i], sr));
  const uint32_t exc = ExcExtra(sr);
  t += Cap(Scale(kApA1, sr) + exc);
  t += Cap(Scale(kDelA1, sr));
  t += Cap(Scale(kApA2, sr));
  t += Cap(Scale(kDelA2, sr));
  t += Cap(Scale(kApB1, sr) + exc);
  t += Cap(Scale(kDelB1, sr));
  t += Cap(Scale(kApB2, sr));
  t += Cap(Scale(kDelB2, sr));
  return t;
}

/* Schroeder allpass whose internal delay buffer can be tapped, which the
 * plate's output accumulators need. Tap(o) reads the internal node
 * delayed o samples, taken after the current sample's write. */
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

  /* Modulated read position, for the tank's first diffusers. */
  inline float ProcessMod(float x, float excursion) {
    const float z = dl_.ReadCubic(static_cast<float>(len_) - 1.0f + excursion);
    const float v = x + g_ * z;
    dl_.Write(v);
    return z - g_ * v;
  }

  inline float Tap(uint32_t offset) const {
    return dl_.ReadInt(static_cast<int32_t>(offset));
  }

  void Reset() { dl_.Clear(); }

 private:
  DelayLineExt dl_;
  uint32_t len_ = 1;
  float g_ = 0.0f;
};

/* Plain tank delay: write then read the full length, plus output taps. */
class TankDelay {
 public:
  void Init(float* buf, uint32_t cap, uint32_t len) {
    dl_.Init(buf, cap);
    len_ = len;
  }

  inline float Process(float x) {
    dl_.Write(x);
    return dl_.ReadInt(static_cast<int32_t>(len_));
  }

  inline float Tap(uint32_t offset) const {
    return dl_.ReadInt(static_cast<int32_t>(offset));
  }

  void Reset() { dl_.Clear(); }

 private:
  DelayLineExt dl_;
  uint32_t len_ = 1;
};

}  // namespace plate_detail

/*
 * The plate over caller-supplied storage. Init carves the buffer and
 * returns false if it is too short, in which case Process is a no-op
 * rather than a fault. Size the buffer with
 * plate_detail::TotalSamples(sample_rate, predelay_ms), or just use
 * Plate<> below and let the template do it.
 */
class PlateExt {
 public:
  struct Params {
    float decay = 0.5f;
    float damping = 0.3f;
    float bandwidth = 0.9995f;
    float predelay = 0.0f;
    float mod_depth = 1.0f;
    float mix = 0.35f;
  };

  bool Init(float sample_rate, float* buf, uint32_t buf_len, uint32_t predelay_ms) {
    Params d;
    return Init(sample_rate, buf, buf_len, predelay_ms, d);
  }

  bool Init(float sample_rate, float* buf, uint32_t buf_len, uint32_t predelay_ms,
            const Params& p) {
    namespace pd = plate_detail;
    sr_ = sample_rate;
    max_predelay_ = static_cast<float>(predelay_ms) * 0.001f;
    ready_ = false;
    /* Every one of the thirteen lengths below is scaled by this integer
     * rate, so a rate that is not finite and positive does not just detune
     * the tank, it makes the cast undefined: UBSan reports "nan is outside
     * the range of representable values of type 'unsigned int'" here for
     * Init(NAN), and a negative rate is undefined for the same reason. Init
     * already has a failure path for a buffer that cannot hold the carve
     * and Process() is already a no-op on !ready_, so refuse the rate the
     * same way rather than inventing a substitute the caller cannot see.
     * kSampleRateMax is the cast ceiling, not a DSP limit: it is exactly
     * representable in float and is 16777216, far above any audio rate,
     * and TotalSamples would overflow uint32_t long before it. */
    constexpr float kSampleRateMax = 16777216.0f;
    if (!(sample_rate > 0.0f) || sample_rate > kSampleRateMax) return false;
    const uint32_t sr_i = static_cast<uint32_t>(sample_rate + 0.5f);
    if (buf == nullptr || buf_len < pd::TotalSamples(sr_i, predelay_ms)) return false;

    /* Same walk, same order, as TotalSamples. */
    uint32_t off = 0;
    const uint32_t pre_need = (sr_i * predelay_ms) / 1000u + 8u;
    pre_.Init(buf + off, pd::Cap(pre_need));
    off += pd::Cap(pre_need);
    for (int i = 0; i < 4; ++i) {
      const uint32_t len = pd::Scale(pd::kDiffLen[i], sr_i);
      diff_[i].Init(buf + off, pd::Cap(len), len, pd::kDiffG[i]);
      off += pd::Cap(len);
    }
    const uint32_t exc = pd::ExcExtra(sr_i);
    off += InitAllpass(ap_a1_, buf + off, pd::Scale(pd::kApA1, sr_i), exc, pd::kDecayDiff1);
    off += InitDelay(del_a1_, buf + off, pd::Scale(pd::kDelA1, sr_i));
    off += InitAllpass(ap_a2_, buf + off, pd::Scale(pd::kApA2, sr_i), 0, pd::kDecayDiff2);
    off += InitDelay(del_a2_, buf + off, pd::Scale(pd::kDelA2, sr_i));
    off += InitAllpass(ap_b1_, buf + off, pd::Scale(pd::kApB1, sr_i), exc, pd::kDecayDiff1);
    off += InitDelay(del_b1_, buf + off, pd::Scale(pd::kDelB1, sr_i));
    off += InitAllpass(ap_b2_, buf + off, pd::Scale(pd::kApB2, sr_i), 0, pd::kDecayDiff2);
    off += InitDelay(del_b2_, buf + off, pd::Scale(pd::kDelB2, sr_i));

    for (int i = 0; i < 7; ++i) {
      taps_l_[i] = pd::Scale(pd::kTapsL[i], sr_i);
      taps_r_[i] = pd::Scale(pd::kTapsR[i], sr_i);
    }
    exc_scale_ = static_cast<float>(pd::kExcursion) * sample_rate /
                 static_cast<float>(pd::kRefRate);

    pre_sm_.Init(sample_rate, 0.05f);
    lfo_a_.Init(sample_rate);
    lfo_a_.SetFreq(1.0f);
    lfo_b_.Init(sample_rate);
    lfo_b_.SetFreq(0.7f);
    lfo_b_.Reset(0.25f);

    ready_ = true;
    SetParams(p);
    pre_sm_.Snap(p_.predelay * sample_rate);
    return true;
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.decay = Clamp(p_.decay, 0.0f, 0.98f);
    p_.damping = Clamp(p_.damping, 0.0f, 0.99f);
    p_.bandwidth = Clamp(p_.bandwidth, 0.0f, 1.0f);
    p_.predelay = Clamp(p_.predelay, 0.0f, max_predelay_);
    p_.mod_depth = Clamp(p_.mod_depth, 0.0f, plate_detail::kModDepthMax);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    exc_depth_ = p_.mod_depth * exc_scale_;
    pre_sm_.SetTarget(p_.predelay * sr_);
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    const float decay = p_.decay;
    const float damp = p_.damping;
    const float bw = p_.bandwidth;
    const float mix = p_.mix;
    const float dry = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      pre_.Write(0.5f * (l[i] + r[i]));
      float x = pre_.ReadLinear(pre_sm_.Process());
      bw_state_ += bw * (x - bw_state_);
      x = bw_state_;
      x = diff_[3].Process(diff_[2].Process(diff_[1].Process(diff_[0].Process(x))));

      const float exc_a = exc_depth_ == 0.0f ? 0.0f : exc_depth_ * lfo_a_.Process();
      const float exc_b = exc_depth_ == 0.0f ? 0.0f : exc_depth_ * lfo_b_.Process();

      /* Branch A, fed by the diffused input plus branch B's far end. */
      float a = x + decay * fb_b_;
      a = ap_a1_.ProcessMod(a, exc_a);
      const float d_a = del_a1_.Process(a);
      damp_a_ += (1.0f - damp) * (d_a - damp_a_);
      const float out_a = del_a2_.Process(ap_a2_.Process(damp_a_ * decay));

      /* Branch B, fed by the diffused input plus branch A's far end from
       * the previous sample, keeping the figure eight symmetric. */
      float b = x + decay * fb_a_;
      b = ap_b1_.ProcessMod(b, exc_b);
      const float d_b = del_b1_.Process(b);
      damp_b_ += (1.0f - damp) * (d_b - damp_b_);
      const float out_b = del_b2_.Process(ap_b2_.Process(damp_b_ * decay));

      fb_a_ = out_a;
      fb_b_ = out_b;

      const float yl = 0.6f * (del_b1_.Tap(taps_l_[0]) + del_b1_.Tap(taps_l_[1]) -
                               ap_b2_.Tap(taps_l_[2]) + del_b2_.Tap(taps_l_[3]) -
                               del_a1_.Tap(taps_l_[4]) - ap_a2_.Tap(taps_l_[5]) -
                               del_a2_.Tap(taps_l_[6]));
      const float yr = 0.6f * (del_a1_.Tap(taps_r_[0]) + del_a1_.Tap(taps_r_[1]) -
                               ap_a2_.Tap(taps_r_[2]) + del_a2_.Tap(taps_r_[3]) -
                               del_b1_.Tap(taps_r_[4]) - ap_b2_.Tap(taps_r_[5]) -
                               del_b2_.Tap(taps_r_[6]));

      l[i] = dry * l[i] + mix * yl;
      r[i] = dry * r[i] + mix * yr;
    }
  }

  void Reset() {
    if (!ready_) return;
    pre_.Clear();
    pre_sm_.Snap(p_.predelay * sr_);
    for (int i = 0; i < 4; ++i) diff_[i].Reset();
    ap_a1_.Reset();
    del_a1_.Reset();
    ap_a2_.Reset();
    del_a2_.Reset();
    ap_b1_.Reset();
    del_b1_.Reset();
    ap_b2_.Reset();
    del_b2_.Reset();
    lfo_a_.Reset();
    lfo_b_.Reset(0.25f);
    bw_state_ = 0.0f;
    damp_a_ = 0.0f;
    damp_b_ = 0.0f;
    fb_a_ = 0.0f;
    fb_b_ = 0.0f;
  }

 private:
  /* Both return the capacity claimed, so the carve reads as a running
   * sum instead of a repeated cap expression. */
  static uint32_t InitAllpass(plate_detail::Allpass& ap, float* at, uint32_t len,
                              uint32_t extra, float g) {
    const uint32_t cap = plate_detail::Cap(len + extra);
    ap.Init(at, cap, len, g);
    return cap;
  }

  static uint32_t InitDelay(plate_detail::TankDelay& d, float* at, uint32_t len) {
    const uint32_t cap = plate_detail::Cap(len);
    d.Init(at, cap, len);
    return cap;
  }

  Params p_;
  DelayLineExt pre_;
  Smoother pre_sm_;
  plate_detail::Allpass diff_[4];
  plate_detail::Allpass ap_a1_, ap_a2_, ap_b1_, ap_b2_;
  plate_detail::TankDelay del_a1_, del_a2_, del_b1_, del_b2_;
  Lfo lfo_a_, lfo_b_;
  uint32_t taps_l_[7] = {}, taps_r_[7] = {};
  float sr_ = 48000.0f, max_predelay_ = 0.25f;
  float exc_scale_ = 0.0f, exc_depth_ = 0.0f;
  float bw_state_ = 0.0f, damp_a_ = 0.0f, damp_b_ = 0.0f;
  float fb_a_ = 0.0f, fb_b_ = 0.0f;
  bool ready_ = false;
};

/*
 * Owning form. kStoreSamples is the exact carve and there is no rounding
 * left to waste: each element takes what it reads plus the four samples of
 * slack the cubic read needs. At 48 kHz with the default 250 ms predelay
 * that is 48407 floats, 193628 bytes, against 67584 floats and 270336
 * bytes when every element was rounded up to a power of two. (The
 * s9k_plate sketch reports less, 156728, because it is Plate<48000, 50>:
 * a 50 ms predelay ceiling rather than the default 250.)
 */
template <int kSampleRate = BELLOWS_SAMPLE_RATE, int kMaxPredelayMs = 250>
class Plate : public PlateExt {
 public:
  static constexpr uint32_t kStoreSamples =
      plate_detail::TotalSamples(kSampleRate, kMaxPredelayMs);

  bool Init(float sample_rate) {
    Params d;
    return Init(sample_rate, d);
  }

  bool Init(float sample_rate, const Params& p) {
    return PlateExt::Init(sample_rate, store_, kStoreSamples, kMaxPredelayMs, p);
  }

 private:
  float store_[kStoreSamples];
};

}  // namespace bellows
