/* Transcription of src/engines/drums.ts. Kick, Snare, Hat.
 *
 * Each is a standalone voice class with no base class and no virtuals,
 * so including this header and using only Kick leaves Snare and Hat
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

}  // namespace bellows
