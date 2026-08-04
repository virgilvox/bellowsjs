/* Transcription of src/engines/va.ts: two BLEP oscillators plus a square
 * sub, ladder or SVF lowpass with its own ADSR, amp ADSR, control-rate
 * drift walk. */
#pragma once
#include <math.h>
#include "bellows/core/prng.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/oscillators.h"

namespace bellows {

class Va {
 public:
  struct Params {
    float shape = 0.0f;
    float detune = 7.0f;
    float sub = 0.0f;
    float cutoff = 9000.0f;
    float resonance = 0.2f;
    float filter_type = 0.0f;
    float env_amount = 0.0f;
    float attack = 0.005f, decay = 0.1f, sustain = 0.8f, release = 0.2f;
    float f_attack = 0.003f, f_decay = 0.15f, f_sustain = 0.5f, f_release = 0.2f;
    float drift = 0.0f;
    float pan = 0.0f;
    float vel_level = 0.5f;
    float vel_filter = 0.0f;
  };

  void Init(float sample_rate, Rng* rng) {
    Params d;
    Init(sample_rate, rng, d);
  }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = sample_rate;
    rng_ = rng;
    p_ = p;
    osc1_.Init(sample_rate);
    osc2_.Init(sample_rate);
    sub_.Init(sample_rate);
    sub_.SetShape(BlepShape::kSquare);
    ladder_.Init(sample_rate);
    svf_.Init(sample_rate);
    svf_.SetMode(SvfMode::kLp);
    amp_env_.Init(sample_rate);
    filt_env_.Init(sample_rate);
    Apply();
  }

  void SetParams(const Params& p) { p_ = p; Apply(); }

  void NoteOn(float freq, float vel) {
    freq_ = freq;
    vel_ = vel;
    amp_vel_gain_ = 1.0f - p_.vel_level * (1.0f - vel);
    d1_ = d2_ = 0.0f;
    osc1_.Reset(0.0f);
    osc2_.Reset(rng_->Next());
    sub_.Reset(0.0f);
    ladder_.Reset();
    svf_.Reset();
    amp_env_.Reset();
    amp_env_.Trigger();
    filt_env_.Reset();
    filt_env_.Trigger();
    ctrl_ = 0;
  }

  void NoteOff() {
    amp_env_.Release();
    filt_env_.Release();
  }

  void Process(float* l, float* r, int from, int to) {
    if (!amp_env_.Active()) return;
    bool use_ladder = p_.filter_type < 0.5f;
    float sub = p_.sub;
    for (int i = from; i < to; ++i) {
      if (ctrl_ <= 0) {
        UpdateControl();
        ctrl_ = 16;
      }
      --ctrl_;
      filt_env_.Process();
      float y = (osc1_.Process() + osc2_.Process()) * 0.5f + sub * sub_.Process();
      y = use_ladder ? ladder_.Process(y) : svf_.Process(y);
      y *= amp_env_.Process() * amp_vel_gain_;
      l[i] += y * gain_l_;
      r[i] += y * gain_r_;
    }
  }

  bool Active() const { return amp_env_.Active(); }

 private:
  static float CentsRatio(float c) { return powf(2.0f, c / 1200.0f); }

  void Apply() {
    int si = static_cast<int>(p_.shape + 0.5f);
    if (si < 0) si = 0;
    if (si > 3) si = 3;
    BlepShape s = static_cast<BlepShape>(si);
    osc1_.SetShape(s);
    osc2_.SetShape(s);
    amp_env_.Set(p_.attack, p_.decay, p_.sustain, p_.release);
    filt_env_.Set(p_.f_attack, p_.f_decay, p_.f_sustain, p_.f_release);
    float pan = p_.pan < -1.0f ? -1.0f : (p_.pan > 1.0f ? 1.0f : p_.pan);
    float angle = ((pan + 1.0f) * 3.14159265358979f) / 4.0f;
    gain_l_ = cosf(angle);
    gain_r_ = sinf(angle);
  }

  void UpdateControl() {
    if (p_.drift > 0.0f) {
      d1_ = d1_ * 0.999f + (rng_->Next() - 0.5f) * 0.05f;
      d2_ = d2_ * 0.999f + (rng_->Next() - 0.5f) * 0.05f;
    }
    float half = p_.detune * 0.5f;
    float dc1 = d1_ * p_.drift * 15.0f;
    float dc2 = d2_ * p_.drift * 15.0f;
    osc1_.SetFreq(freq_ * CentsRatio(-half + dc1));
    osc2_.SetFreq(freq_ * CentsRatio(half + dc2));
    sub_.SetFreq(freq_ * 0.5f);
    float oct = p_.env_amount * filt_env_.Level() + p_.vel_filter * vel_;
    float cut = p_.cutoff * powf(2.0f, oct);
    float lim = sr_ * 0.45f;
    if (cut < 20.0f) cut = 20.0f;
    if (cut > lim) cut = lim;
    if (p_.filter_type < 0.5f) ladder_.Set(cut, p_.resonance);
    else svf_.Set(cut, 0.5f + p_.resonance * 9.5f);
  }

  float sr_ = 48000.0f;
  Rng* rng_ = nullptr;
  Params p_;
  BlepOsc osc1_, osc2_, sub_;
  LadderFilter ladder_;
  Svf svf_;
  Adsr amp_env_, filt_env_;
  float freq_ = 440.0f, vel_ = 1.0f, amp_vel_gain_ = 1.0f;
  float d1_ = 0.0f, d2_ = 0.0f;
  int ctrl_ = 0;
  float gain_l_ = 0.70710678f, gain_r_ = 0.70710678f;
};

}  // namespace bellows
