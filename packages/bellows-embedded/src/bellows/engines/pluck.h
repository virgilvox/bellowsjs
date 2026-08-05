/* Transcription of src/engines/pluck.ts.
 *
 * The delay line length is the one thing that must be sized at compile
 * time on an MCU: kMinFreq sets the buffer, and the caller pays only for
 * the range they need. Pluck<> at 20 Hz is 16 KB; Pluck<80> is 4 KB. */
#pragma once
#include <math.h>
#include "bellows/core/prng.h"
#include "bellows/dsp/delayline.h"
#include "bellows/core/fastmath.h"

namespace bellows {

template <int kMinFreqHz = 20, int kSampleRate = 48000>
class Pluck {
 public:
  struct Params {
    float damp = 0.35f;
    float pick_pos = 0.28f;
    float excite_type = 0.0f;
    float decay = 2.5f;
    float level = 0.9f;
  };

  static constexpr uint32_t kMaxPeriod = kSampleRate / kMinFreqHz + 4;

  void Init(float sample_rate, Rng* rng) { Params d; Init(sample_rate, rng, d); }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = sample_rate;
    rng_ = rng;
    p_ = p;
    delay_.Init();
    track_coef_ = fm::Exp(-1.0f / (0.05f * sample_rate));
  }

  /*
   * The lowest note this instance can actually hold, which is kMinFreqHz
   * only when Init() was handed the rate the class was sized for.
   *
   * kMaxPeriod comes from the TEMPLATE kSampleRate; the period a note needs
   * is sr_ / freq, from the RUNTIME rate. Nothing in the type system makes
   * the two agree, and both docs/HARDWARE.md and platform/README.md tell a
   * caller to read the rate back from the SDK rather than assume it, which
   * is exactly the path that produces a mismatch. Pluck<20, 48000> holds
   * 2400 usable samples, so Init(192000) plus NoteOn(20) wants a
   * 9600-sample period, and before this clamp existed it wrote 4792 floats
   * past excite_[]: a real heap-buffer-overflow, ASan-confirmed, not a
   * clamp.
   *
   * kMaxPeriod - 4 is the delay line's own usable range (DelayLine sets
   * max_ = cap - 4), and at sr_ == kSampleRate it evaluates to exactly
   * kMinFreqHz, so nothing moves at the design rate. Above it the note
   * clamps sharp, which is what the delay line's read clamp already did on
   * its own: the loop and the excitation now hit the same limit instead of
   * one clamping while the other ran off the end.
   *
   * Public because a caller running at a rate the template did not choose
   * has no other way to learn what its real bottom note is.
   */
  float MinFreq() const {
    float cap = sr_ / static_cast<float>(kMaxPeriod - 4);
    float lo = static_cast<float>(kMinFreqHz);
    return cap > lo ? cap : lo;
  }

  void NoteOn(float freq, float vel) {
    float lo = MinFreq();
    float hi = sr_ / 8.0f;
    freq_ = freq < lo ? lo : (freq > hi ? hi : freq);
    gate_ = true;
    live_ = true;
    delay_.Clear();
    lp_state_ = 0.0f;
    UpdateLoop();

    float n = sr_ / freq_;
    int len = static_cast<int>(n + 0.5f);
    if (len < 2) len = 2;
    /* The clamp above makes this unreachable, but the argument for that runs
     * through a float division and a truncation. The comb tail below has
     * carried the same guard since it was written; the fill loop should not
     * be the one place the bound is only argued rather than enforced. */
    if (len > static_cast<int>(kExciteLen)) len = kExciteLen;
    float type = p_.excite_type < 0.0f ? 0.0f : (p_.excite_type > 1.0f ? 1.0f : p_.excite_type);
    float v = vel < 0.0f ? 0.0f : (vel > 1.0f ? 1.0f : vel);
    float amp = 0.6f * v;
    for (int i = 0; i < len; ++i) {
      float noise = rng_->Bipolar();
      float imp = i == 0 ? 1.0f : (i == 1 ? 0.4f : 0.0f);
      excite_[i] = ((1.0f - type) * noise + type * imp * 1.6f) * amp;
    }
    float pp = p_.pick_pos < 0.0f ? 0.0f : (p_.pick_pos > 0.95f ? 0.95f : p_.pick_pos);
    int comb_d = static_cast<int>(pp * n + 0.5f);
    int total = len;
    if (comb_d >= 1) {
      total = len + comb_d;
      if (total > static_cast<int>(kExciteLen)) total = kExciteLen;
      for (int i = len; i < total; ++i) excite_[i] = 0.0f;
      for (int i = total - 1; i >= comb_d; --i) excite_[i] -= excite_[i - comb_d];
    }
    excite_len_ = total;
    excite_pos_ = 0;
    tracker_ = amp > 0.01f ? amp : 0.01f;
  }

  void NoteOff() {
    gate_ = false;
    UpdateLoop();
  }

  void Process(float* l, float* r, int from, int to) {
    if (!live_) return;
    float level = p_.level;
    for (int i = from; i < to; ++i) {
      float y = delay_.ReadCubic(read_delay_);
      lp_state_ = lp_a_ * y + lp_b_ * lp_state_;
      float s = lp_state_ * gs_;
      if (excite_pos_ < excite_len_) s += excite_[excite_pos_++];
      delay_.Write(s);
      float o = s * level;
      l[i] += o;
      r[i] += o;
      float as = fabsf(s);
      tracker_ = as > tracker_ ? as : tracker_ * track_coef_;
    }
    if (tracker_ < 1e-4f && excite_pos_ >= excite_len_) live_ = false;
  }

  bool Active() const { return live_; }

 private:
  static constexpr uint32_t kExciteLen = 2 * kMaxPeriod;

  static float OnePolePhaseDelay(float a, float w) {
    float b = 1.0f - a;
    return fm::Atan2(b * fm::Sin(w), 1.0f - b * fm::Cos(w)) / w;
  }

  void UpdateLoop() {
    float n = sr_ / freq_;
    float d = p_.damp < 0.0f ? 0.0f : (p_.damp > 1.0f ? 1.0f : p_.damp);
    float fc = 18000.0f * fm::Pow(800.0f / 18000.0f, d);
    float lim = sr_ * 0.45f;
    if (fc > lim) fc = lim;
    float a = 1.0f - fm::Exp((-6.28318530717959f * fc) / sr_);
    lp_a_ = a;
    lp_b_ = 1.0f - a;
    float w = (6.28318530717959f * freq_) / sr_;
    float pd = OnePolePhaseDelay(a, w);
    read_delay_ = n - 1.0f - pd;
    if (read_delay_ < 1.0f) read_delay_ = 1.0f;
    float dec = p_.decay < 0.05f ? 0.05f : (p_.decay > 20.0f ? 20.0f : p_.decay);
    float t60 = gate_ ? dec : (dec < 0.18f ? dec : 0.18f);
    gs_ = fm::Pow(10.0f, -3.0f / (t60 * freq_));
  }

  float sr_ = 48000.0f;
  Rng* rng_ = nullptr;
  Params p_;
  DelayLine<kMaxPeriod> delay_;
  float excite_[kExciteLen];
  int excite_len_ = 0, excite_pos_ = 0;
  float read_delay_ = 2.0f, lp_a_ = 1.0f, lp_b_ = 0.0f, lp_state_ = 0.0f;
  float gs_ = 0.0f, freq_ = 440.0f, tracker_ = 0.0f, track_coef_ = 0.0f;
  bool gate_ = false, live_ = false;
};

}  // namespace bellows
