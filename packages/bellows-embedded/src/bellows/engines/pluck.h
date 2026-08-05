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

  /* MinFreq() divides by kMaxPeriod - 4, which is the truncated integer
   * kSampleRate / kMinFreqHz and reaches zero as soon as kMinFreqHz exceeds
   * kSampleRate. DelayLine<kMaxPeriod> does not catch that: kMaxPeriod is
   * still 4 there, so its own static_assert passes. Measured on
   * Pluck<60000, 48000>: it compiled, MinFreq() returned inf, and
   * NoteOn(440, 1) then faulted through ReadCubic on x86-64. The bound is
   * kSampleRate / 8 rather than 1 because sr_ / 8 is the Nyquist guard
   * NoteOn clamps against, so above it the playable range is empty at the
   * design rate even when the arithmetic stays finite. */
  static_assert(kMinFreqHz > 0 && kSampleRate > 0,
                "Pluck kMinFreqHz and kSampleRate must both be positive");
  static_assert(kSampleRate / kMinFreqHz >= 8,
                "Pluck kMinFreqHz must be at most kSampleRate / 8");

  void Init(float sample_rate, Rng* rng) { Params d; Init(sample_rate, rng, d); }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    /* A rate that is NaN, infinite, zero or negative poisons everything
     * derived from it: sr_ / 8 is the Nyquist guard NoteOn clamps against,
     * so Init(0) forces freq_ to 0 and UpdateLoop's sr_ / freq_ becomes
     * 0 / 0, and a NaN read position reaches the delay line. The delay
     * line's clamps hold that in bounds now, but a voice tuned to NaN is
     * still not something a caller can use. Fall back to the rate the
     * template was sized for, which is the only rate this instance is
     * known to be consistent at. Init() has no way to report the swap, so
     * the caller reads it back through MinFreq() the same way it would
     * after any other rate. */
    sr_ = (sample_rate > 0.0f && isfinite(sample_rate)) ? sample_rate
                                                        : static_cast<float>(kSampleRate);
    rng_ = rng;
    p_ = p;
    delay_.Init();
    track_coef_ = fm::Exp(-1.0f / (0.05f * sr_));
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
   * kMaxPeriod - 4 is the truncated integer kSampleRate / kMinFreqHz: the
   * period of the lowest note at the design rate, which is exactly why
   * dividing sr_ by it gives kMinFreqHz back when sr_ == kSampleRate. It is
   * NOT the delay line's usable range, which is four samples longer:
   * DelayLine<kMaxPeriod>::kCap is kMaxPeriod + 4, so max_ = kCap - 4 is
   * kMaxPeriod (measured 2404 for Pluck<20, 48000>, against the 2400 used
   * here). The bound stays at the shorter figure deliberately; the four
   * samples of slack are what the cubic read reaches past its clamp.
   *
   * At sr_ == kSampleRate this returns kMinFreqHz exactly only when
   * kMinFreqHz divides kSampleRate, because that division truncates.
   * Measured: Pluck<7, 48000> at Init(48000) returns 7.000146 Hz, since
   * 48000 / 7 truncates to 6857. Every instantiation that ships or is
   * tested divides exactly (48000/20, 48000/80, 44100/20), so the parity
   * row and the golden render are unmoved. Above the design rate the note
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

  /* The pitch the voice actually settled on after NoteOn clamped it, which
   * is not the pitch that was asked for whenever the request fell outside
   * [MinFreq(), sr_ / 8]. A caller has no other way to read it back, and it
   * is the one number that says whether the loop the voice is running fits
   * the buffer: sr_ / Freq() is the period in samples. */
  float Freq() const { return freq_; }

  void NoteOn(float freq, float vel) {
    float lo = MinFreq();
    float hi = sr_ / 8.0f;
    /* `!(freq > lo)` rather than `freq < lo` so a NaN request lands on lo.
     * Both comparisons are false for NaN, so the plain form passed it
     * through and freq_ became NaN, which UpdateLoop turned into a NaN
     * read_delay_. For finite freq the two forms pick the same branch,
     * including freq == lo. */
    freq_ = !(freq > lo) ? lo : (freq > hi ? hi : freq);
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
