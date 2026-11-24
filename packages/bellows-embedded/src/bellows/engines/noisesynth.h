/* Transcription of src/engines/noisesynth.ts.
 *
 * A NoiseGen with a selectable color runs through an Svf whose cutoff is
 * swept by its own Adsr, then an amp Adsr. Meant for percussion and
 * texture layers.
 *
 *   color        NoiseColor, the JS index order: white, pink, brown,
 *                velvet, crackle
 *   filter_mode  lowpass, bandpass, highpass, the JS index order (which
 *                is not SvfMode's, hence its own enum)
 *   env_amount   filter envelope depth in octaves above the base cutoff
 *   key_track    cutoff scales with (note / 220) ^ key_track
 *
 * Filter coefficients update every kControlInterval samples on a per
 * sample counter, so block splits do not change the output. The voice
 * takes one Rng and draws its noise from it: the JS forks 'noise' off the
 * voice stream, so pass the stream labelled "<voice>::noise" to land on
 * the browser's noise. */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/noise.h"

namespace bellows {

enum class NoiseFilterMode { kLp, kBp, kHp };

class NoiseSynth {
 public:
  struct Params {
    NoiseColor color = NoiseColor::kWhite;
    NoiseFilterMode filter_mode = NoiseFilterMode::kLp;
    float cutoff = 2000.0f;
    float resonance = 0.1f;
    float env_amount = 0.0f;
    float key_track = 0.0f;
    float attack = 0.002f;
    float decay = 0.15f;
    float sustain = 0.3f;
    float release = 0.1f;
    float f_attack = 0.001f;
    float f_decay = 0.12f;
    float f_sustain = 0.0f;
    float f_release = 0.1f;
    float pan = 0.0f;
  };

  void Init(float sample_rate, Rng* rng) { Params d; Init(sample_rate, rng, d); }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    noise_.Init(sr_, NoiseColor::kWhite, rng);
    color_ = NoiseColor::kWhite;
    svf_.Init(sr_);
    amp_.Init(sr_);
    filt_.Init(sr_);
    Apply();
  }

  /* Live change, as setParam does in the JS. The envelopes and the pan
   * follow at once; cutoff, resonance and the tracking wait for the next
   * control tick, and a new color clears the noise filter state. */
  void SetParams(const Params& p) { p_ = p; Apply(); }

  void NoteOn(float freq, float vel) {
    freq_ = freq;
    vel_ = vel;
    svf_.Reset();
    amp_.Reset();
    amp_.Trigger();
    filt_.Reset();
    filt_.Trigger();
    ctrl_ = 0;
  }

  void NoteOff() {
    amp_.Release();
    filt_.Release();
  }

  void Process(float* l, float* r, int from, int to) {
    if (!amp_.Active()) return;
    for (int i = from; i < to; ++i) {
      if (ctrl_ <= 0) {
        UpdateControl();
        ctrl_ = kControlInterval;
      }
      --ctrl_;
      filt_.Process();
      float y = svf_.Process(noise_.Process()) * amp_.Process() * vel_;
      l[i] += y * gain_l_;
      r[i] += y * gain_r_;
    }
  }

  bool Active() const { return amp_.Active(); }

 private:
  static constexpr int kControlInterval = 16;

  void Apply() {
    if (p_.color != color_) {
      color_ = p_.color;
      noise_.SetColor(color_);
    }
    switch (p_.filter_mode) {
      case NoiseFilterMode::kLp: svf_.SetMode(SvfMode::kLp); break;
      case NoiseFilterMode::kBp: svf_.SetMode(SvfMode::kBp); break;
      case NoiseFilterMode::kHp: svf_.SetMode(SvfMode::kHp); break;
    }
    amp_.Set(p_.attack, p_.decay, p_.sustain, p_.release);
    filt_.Set(p_.f_attack, p_.f_decay, p_.f_sustain, p_.f_release);
    float angle = (Clamp(p_.pan, -1.0f, 1.0f) + 1.0f) * kPi * 0.25f;
    gain_l_ = fm::Cos(angle);
    gain_r_ = fm::Sin(angle);
  }

  /* Reads the filter envelope before this sample advances it, in the JS order. */
  void UpdateControl() {
    float track = fm::Pow(freq_ / 220.0f, p_.key_track);
    float oct = p_.env_amount * filt_.Level();
    float cut = Clamp(p_.cutoff * track * fm::Exp2(oct), 20.0f, sr_ * 0.45f);
    svf_.Set(cut, 0.5f + p_.resonance * 9.5f);
  }

  float sr_ = 48000.0f, freq_ = 220.0f, vel_ = 1.0f;
  float gain_l_ = 0.70710678f, gain_r_ = 0.70710678f;
  int ctrl_ = 0;
  Params p_;
  NoiseColor color_ = NoiseColor::kWhite;
  NoiseGen noise_;
  Svf svf_;
  Adsr amp_, filt_;
};

}  // namespace bellows
