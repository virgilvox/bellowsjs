/* Transcription of src/engines/drums.ts. Kick, Snare, Hat, Clap, Tom.
 *
 * Each is a standalone voice class with no base class and no virtuals,
 * so including this header and using only Kick leaves the other four
 * unreferenced and the linker drops them. Params are a plain struct, not
 * a string-keyed map. */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/noise.h"
#include "bellows/dsp/oscillators.h"
#include "bellows/dsp/waveshaper.h"

namespace bellows {

class Kick {
 public:
  struct Params {
    float click_tune = 6.0f;
    float pitch_decay = 0.05f;
    float decay = 0.4f;
    float drive = 2.0f;
  };

  void Init(float sample_rate) { Params d; Init(sample_rate, d); }

  void Init(float sample_rate, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    amp_.Init(sample_rate);
    pitch_.Init(sample_rate);
    Apply();
  }

  void SetParams(const Params& p) { p_ = p; Apply(); }

  void NoteOn(float freq, float vel) {
    base_ = freq;
    vel_ = vel;
    phase_ = 0.0f;
    Apply();
    amp_.Trigger();
    pitch_.Trigger();
  }

  void NoteOff() { amp_.SetTime(0.03f); }

  void Process(float* l, float* r, int from, int to) {
    if (!Active()) return;
    float span = p_.click_tune - 1.0f;
    for (int i = from; i < to; ++i) {
      float f = base_ * (1.0f + span * pitch_.Process());
      phase_ += f / sr_;
      if (phase_ >= 1.0f) phase_ -= 1.0f;
      float y = TanhShape(fm::Sin(kTwoPi * phase_), p_.drive) * amp_.Process() * vel_;
      l[i] += y * 0.70710678f;
      r[i] += y * 0.70710678f;
    }
  }

  bool Active() const { return amp_.Level() > 1e-4f; }

 private:
  void Apply() {
    amp_.SetTime(p_.decay);
    pitch_.SetTime(p_.pitch_decay);
  }
  float sr_ = 48000.0f, base_ = 50.0f, vel_ = 1.0f, phase_ = 0.0f;
  Params p_;
  ExpDecay amp_, pitch_;
};

class Snare {
 public:
  struct Params {
    float tone = 0.5f;
    float decay = 0.18f;
    float snap = 0.15f;
  };

  void Init(float sample_rate, Rng* rng) { Params d; Init(sample_rate, rng, d); }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    p_ = p;
    osc1_.Init(sample_rate);
    osc1_.SetShape(BlepShape::kTriangle);
    osc2_.Init(sample_rate);
    osc2_.SetShape(BlepShape::kTriangle);
    noise_.Init(sample_rate, NoiseColor::kWhite, rng);
    hp_.Init(sample_rate);
    hp_.SetMode(SvfMode::kHp);
    hp_.Set(1800.0f, 0.7071f);
    body_.Init(sample_rate);
    snap_.Init(sample_rate);
    Apply();
  }

  /* Live change, as setParam does in the JS: both decay times follow at once. */
  void SetParams(const Params& p) { p_ = p; Apply(); }

  void NoteOn(float freq, float vel) {
    vel_ = vel;
    osc1_.SetFreq(freq);
    osc2_.SetFreq(freq * 1.6f);
    osc1_.Reset(0.0f);
    osc2_.Reset(0.25f);
    hp_.Reset();
    Apply();
    body_.Trigger();
    snap_.Trigger();
  }

  void NoteOff() {
    body_.SetTime(0.03f);
    snap_.SetTime(0.03f);
  }

  void Process(float* l, float* r, int from, int to) {
    if (!Active()) return;
    /* Equal-power crossfade between shell and noise, as in the JS. */
    float bg = fm::Cos((p_.tone * kPi) * 0.5f) * vel_;
    float ng = fm::Sin((p_.tone * kPi) * 0.5f) * vel_;
    for (int i = from; i < to; ++i) {
      float body = (osc1_.ProcessTriangle() + osc2_.ProcessTriangle()) * 0.5f * body_.Process();
      float nz = hp_.Process(noise_.Process()) * snap_.Process();
      float y = body * bg + nz * ng;
      l[i] += y * 0.70710678f;
      r[i] += y * 0.70710678f;
    }
  }

  bool Active() const { return body_.Level() > 1e-4f || snap_.Level() > 1e-4f; }

 private:
  void Apply() {
    body_.SetTime(p_.decay);
    snap_.SetTime(p_.snap);
  }
  Params p_;
  float vel_ = 1.0f;
  BlepOsc osc1_, osc2_;
  NoiseGen noise_;
  Svf hp_;
  ExpDecay body_, snap_;
};

class Hat {
 public:
  struct Params {
    float decay = 0.08f;
    float tone = 1.0f;
  };

  void Init(float sample_rate) { Params d; Init(sample_rate, d); }

  void Init(float sample_rate, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    for (int i = 0; i < 6; ++i) {
      oscs_[i].Init(sample_rate);
      oscs_[i].SetShape(BlepShape::kSquare);
    }
    hp_.Init(sample_rate);
    hp_.SetMode(SvfMode::kHp);
    amp_.Init(sample_rate);
    Apply();
  }

  /* Live change, as setParam does in the JS: decay and the highpass follow at once. */
  void SetParams(const Params& p) { p_ = p; Apply(); }

  void NoteOn(float freq, float vel) {
    vel_ = vel;
    for (int i = 0; i < 6; ++i) {
      oscs_[i].SetFreq(freq * kRatios[i]);
      oscs_[i].Reset(0.0f);
    }
    hp_.Reset();
    Apply();
    amp_.Trigger();
  }

  void NoteOff() { amp_.SetTime(0.03f); }

  void Process(float* l, float* r, int from, int to) {
    if (!Active()) return;
    for (int i = from; i < to; ++i) {
      float m = 0.0f;
      for (int o = 0; o < 6; ++o) m += oscs_[o].ProcessSquare();
      float y = hp_.Process(m / 6.0f) * amp_.Process() * vel_;
      l[i] += y * 0.70710678f;
      r[i] += y * 0.70710678f;
    }
  }

  bool Active() const { return amp_.Level() > 1e-4f; }

 private:
  static constexpr float kRatios[6] = {1.0f, 1.4831f, 1.8004f, 2.5459f, 2.6303f, 3.8971f};
  void Apply() {
    amp_.SetTime(p_.decay);
    float cut = 7000.0f * p_.tone;
    float lim = sr_ * 0.45f;
    hp_.Set(cut < lim ? cut : lim, 0.7071f);
  }
  float sr_ = 48000.0f, vel_ = 1.0f;
  Params p_;
  BlepOsc oscs_[6];
  Svf hp_;
  ExpDecay amp_;
};

/*
 * Three bursts of bandpassed white noise, spread apart in time. The first
 * two decay in 6 ms and the third carries the decay param's tail. tone is
 * the bandpass center when played at 220 Hz and tracks the note from there.
 *
 * The burst time is latched at NoteOn and moved forward from the current
 * count on each retrigger, as in the JS, so changing spread mid-burst can
 * never put the target behind the counter and strand the voice active.
 * decay is read when the third burst fires, so a change after that point
 * waits for the next note, which is also what the JS does.
 */
class Clap {
 public:
  struct Params {
    float decay = 0.25f;
    float spread = 0.012f;
    float tone = 1200.0f;
  };

  void Init(float sample_rate, Rng* rng) { Params d; Init(sample_rate, rng, d); }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    noise_.Init(sr_, NoiseColor::kWhite, rng);
    bp_.Init(sr_);
    bp_.SetMode(SvfMode::kBp);
    env_.Init(sr_);
    Apply();
  }

  /* Live change, as setParam does in the JS: the bandpass follows at once. */
  void SetParams(const Params& p) { p_ = p; Apply(); }

  void NoteOn(float freq, float vel) {
    base_ = freq;
    vel_ = vel;
    t_ = 0;
    bp_.Reset();
    Apply();
    env_.SetTime(kBurstTime);
    env_.Trigger();
    burst_ = 1;
    next_burst_ = SpreadSamples();
  }

  void NoteOff() { env_.SetTime(0.03f); }

  void Process(float* l, float* r, int from, int to) {
    if (!Active()) return;
    for (int i = from; i < to; ++i) {
      if (burst_ > 0 && burst_ < 3 && t_ >= next_burst_) {
        /* Retrigger; the third burst carries the long tail. */
        env_.SetTime(burst_ == 2 ? p_.decay : kBurstTime);
        env_.Trigger();
        ++burst_;
        next_burst_ = t_ + SpreadSamples();
      }
      ++t_;
      float y = bp_.Process(noise_.Process()) * env_.Process() * vel_;
      l[i] += y * 0.70710678f;
      r[i] += y * 0.70710678f;
    }
  }

  bool Active() const { return env_.Level() > 1e-4f || (burst_ > 0 && burst_ < 3); }

 private:
  /* Decay of the first two bursts, seconds. */
  static constexpr float kBurstTime = 0.006f;

  void Apply() {
    float f = p_.tone * (base_ / 220.0f);
    float lim = sr_ * 0.45f;
    bp_.Set(f < lim ? f : lim, 2.0f);
  }

  /* Math.max(1, Math.round(spread * sampleRate)). The low test is negated
   * so a NaN takes it, and the ceiling keeps the cast defined. */
  int32_t SpreadSamples() const {
    float s = p_.spread * sr_ + 0.5f;
    if (!(s >= 1.0f)) return 1;
    return s > 1.0e9f ? 1000000000 : static_cast<int32_t>(s);
  }

  float sr_ = 48000.0f, base_ = 220.0f, vel_ = 1.0f;
  Params p_;
  NoiseGen noise_;
  Svf bp_;
  ExpDecay env_;
  int32_t t_ = 0, next_burst_ = 0;
  int burst_ = 0;
};

/*
 * A sine whose pitch starts 2.5 times the note and sweeps down to it, plus
 * a 20 ms burst of lowpassed noise for the stick. noise sets the level of
 * that burst.
 */
class Tom {
 public:
  struct Params {
    float decay = 0.35f;
    float sweep = 0.08f;
    float noise = 0.15f;
  };

  void Init(float sample_rate, Rng* rng) { Params d; Init(sample_rate, rng, d); }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    noise_.Init(sr_, NoiseColor::kWhite, rng);
    lp_.Init(sr_);
    lp_.SetMode(SvfMode::kLp);
    lp_.Set(3000.0f, 0.7071f);
    amp_.Init(sr_);
    pitch_.Init(sr_);
    noise_env_.Init(sr_);
    noise_env_.SetTime(kNoiseTime);
    Apply();
  }

  /* Live change, as setParam does in the JS: both decay times follow at once. */
  void SetParams(const Params& p) { p_ = p; Apply(); }

  void NoteOn(float freq, float vel) {
    base_ = freq;
    vel_ = vel;
    phase_ = 0u;
    lp_.Reset();
    Apply();
    noise_env_.SetTime(kNoiseTime);
    amp_.Trigger();
    pitch_.Trigger();
    noise_env_.Trigger();
  }

  void NoteOff() {
    amp_.SetTime(0.03f);
    noise_env_.SetTime(0.03f);
  }

  void Process(float* l, float* r, int from, int to) {
    if (!Active()) return;
    const float nz_level = p_.noise;
    for (int i = from; i < to; ++i) {
      float f = base_ * (1.0f + kSweepSpan * pitch_.Process());
      /* Advance, then read, in the JS order. */
      phase_ += PhaseIncrement(f / sr_);
      float body = fm::Sin(kTwoPi * (static_cast<float>(phase_) * kPhaseToUnit)) * amp_.Process();
      float nz = lp_.Process(noise_.Process()) * noise_env_.Process() * nz_level;
      float y = (body + nz) * vel_;
      l[i] += y * 0.70710678f;
      r[i] += y * 0.70710678f;
    }
  }

  bool Active() const { return amp_.Level() > 1e-4f || noise_env_.Level() > 1e-4f; }

 private:
  /* The pitch starts this far above the note, as a multiplier minus 1. */
  static constexpr float kSweepSpan = 1.5f;
  static constexpr float kNoiseTime = 0.02f;

  void Apply() {
    amp_.SetTime(p_.decay);
    pitch_.SetTime(p_.sweep);
  }

  float sr_ = 48000.0f, base_ = 100.0f, vel_ = 1.0f;
  /* Fixed point, as config.h argues for any accumulated cycle position.
   * Against the JS it measures the same as Kick's float accumulator,
   * because the float pitch envelope dominates either way; it is here so
   * a long tail does not drift. */
  uint32_t phase_ = 0u;
  Params p_;
  NoiseGen noise_;
  Svf lp_;
  ExpDecay amp_, pitch_, noise_env_;
};

}  // namespace bellows
