/* Transcription of src/engines/formant.ts.
 *
 * Source-filter vocal synth: a BLEP saw or pulse source with sine
 * vibrato, mixed with breath noise, through five parallel Svf bandpass
 * formant filters.
 *
 * Vowel tables give frequency, bandwidth, and level for the vowels
 * a e i o u of a bass voice. Values are the bass rows of the "Formant
 * Values" appendix of the Csound manual (the widely copied CLM/Csound
 * formant data). The vowel param 0..4 morphs continuously between
 * adjacent vowels: frequency interpolates in the log domain, bandwidth
 * and level linearly. Levels are stored in dB relative to the first
 * formant, exactly as the appendix prints them, and converted on the
 * control path.
 *
 * The Svf bandpass peaks at gain q, so each formant output is scaled by
 * level / q to land at its table level.
 *
 * The vibrato Lfo takes no rng: only the sample and hold shape draws,
 * and this one is a sine, so passing nullptr keeps the JS behaviour of
 * a forked stream that is never consumed.
 */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/lfo.h"
#include "bellows/dsp/noise.h"
#include "bellows/dsp/oscillators.h"

namespace bellows {

inline constexpr int kFormantCount = 5;
inline constexpr int kFormantVowels = 5;

/* Bass a, e, i, o, u. Row per vowel, column per formant. */
inline constexpr float kFormantFreq[kFormantVowels][kFormantCount] = {
    {600.0f, 1040.0f, 2250.0f, 2450.0f, 2750.0f},
    {400.0f, 1620.0f, 2400.0f, 2800.0f, 3100.0f},
    {250.0f, 1750.0f, 2600.0f, 3050.0f, 3340.0f},
    {400.0f, 750.0f, 2400.0f, 2600.0f, 2900.0f},
    {350.0f, 600.0f, 2400.0f, 2675.0f, 2950.0f},
};

/* Level in dB relative to the first formant. */
inline constexpr float kFormantDb[kFormantVowels][kFormantCount] = {
    {0.0f, -7.0f, -9.0f, -9.0f, -20.0f},
    {0.0f, -12.0f, -9.0f, -12.0f, -18.0f},
    {0.0f, -30.0f, -16.0f, -22.0f, -28.0f},
    {0.0f, -11.0f, -21.0f, -20.0f, -40.0f},
    {0.0f, -20.0f, -32.0f, -28.0f, -36.0f},
};

inline constexpr float kFormantBw[kFormantVowels][kFormantCount] = {
    {60.0f, 70.0f, 110.0f, 120.0f, 130.0f},
    {40.0f, 80.0f, 100.0f, 120.0f, 120.0f},
    {60.0f, 90.0f, 100.0f, 120.0f, 120.0f},
    {40.0f, 80.0f, 100.0f, 120.0f, 120.0f},
    {40.0f, 80.0f, 100.0f, 120.0f, 120.0f},
};

class Formant {
 public:
  struct Params {
    float vowel = 0.0f;
    float breath = 0.1f;
    float vibrato_rate = 5.0f;
    float vibrato_depth = 0.25f;
    float shape = 0.0f;
    float level = 1.0f;
  };

  void Init(float sample_rate, Rng* rng) {
    Params d;
    Init(sample_rate, rng, d);
  }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    osc_.Init(sample_rate);
    noise_.Init(sample_rate, NoiseColor::kWhite, rng);
    vibrato_.Init(sample_rate, nullptr);
    vibrato_.SetShape(LfoShape::kSine);
    env_.Init(sample_rate);
    env_.Set(0.02f, 0.08f, 0.85f, 0.25f);
    for (int k = 0; k < kFormantCount; ++k) {
      filters_[k].Init(sample_rate);
      filters_[k].SetMode(SvfMode::kBp);
    }
    UpdateFormants();
  }

  void SetParams(const Params& p) {
    p_ = p;
    if (live_) {
      osc_.SetShape(p_.shape < 0.5f ? BlepShape::kSaw : BlepShape::kSquare);
      UpdateFormants();
    }
  }

  void NoteOn(float freq, float vel) {
    f0_ = Clamp(freq, 20.0f, sr_ * 0.35f);
    vel_ = Clamp(vel, 0.0f, 1.0f);
    live_ = true;
    osc_.SetShape(p_.shape < 0.5f ? BlepShape::kSaw : BlepShape::kSquare);
    osc_.SetPulseWidth(0.3f);
    osc_.Reset(0.0f);
    vibrato_.Reset(0.0f);
    vibrato_.SetFreq(p_.vibrato_rate);
    for (int k = 0; k < kFormantCount; ++k) filters_[k].Reset();
    env_.Reset();
    env_.Trigger();
    ctrl_ = 0;
    UpdateFormants();
  }

  void NoteOff() { env_.Release(); }

  void Process(float* l, float* r, int from, int to) {
    if (!live_) return;
    float breath = Clamp(p_.breath, 0.0f, 1.0f);
    float level = p_.level * vel_;
    float depth = p_.vibrato_depth;
    for (int i = from; i < to; ++i) {
      if (ctrl_ <= 0) {
        vibrato_.SetFreq(p_.vibrato_rate);
        ctrl_ = kCtrl;
      }
      --ctrl_;

      float vib = vibrato_.Process() * depth;
      osc_.SetFreq(f0_ * fm::SemisRatio(vib));
      float src = osc_.Process() * (1.0f - breath) + noise_.Process() * breath;

      float y = 0.0f;
      for (int k = 0; k < kFormantCount; ++k) y += filters_[k].Process(src) * scales_[k];

      float o = y * env_.Process() * level;
      l[i] += o;
      r[i] += o;
    }
    if (!env_.Active()) live_ = false;
  }

  bool Active() const { return live_; }

 private:
  /* Filter and vibrato depth refresh divider. */
  static constexpr int kCtrl = 32;

  /* Morph the five filters between the vowel tables adjacent to the
   * vowel param. */
  void UpdateFormants() {
    float v = Clamp(p_.vowel, 0.0f, static_cast<float>(kFormantVowels - 1));
    int i0 = static_cast<int>(v);
    if (i0 > kFormantVowels - 2) i0 = kFormantVowels - 2;
    float frac = v - static_cast<float>(i0);
    for (int k = 0; k < kFormantCount; ++k) {
      float fa = kFormantFreq[i0][k];
      float fb = kFormantFreq[i0 + 1][k];
      float f = fa * fm::Pow(fb / fa, frac);
      float bw = kFormantBw[i0][k] + (kFormantBw[i0 + 1][k] - kFormantBw[i0][k]) * frac;
      float la = fm::DbToGain(kFormantDb[i0][k]);
      float lb = fm::DbToGain(kFormantDb[i0 + 1][k]);
      float lvl = la + (lb - la) * frac;
      float q = f / bw;
      if (q < 0.5f) q = 0.5f;
      filters_[k].Set(f, q);
      scales_[k] = lvl / q;
    }
  }

  float sr_ = 48000.0f;
  Params p_;
  BlepOsc osc_;
  NoiseGen noise_;
  Lfo vibrato_;
  Adsr env_;
  Svf filters_[kFormantCount];
  float scales_[kFormantCount] = {};

  float f0_ = 220.0f, vel_ = 1.0f;
  bool live_ = false;
  int ctrl_ = 0;
};

}  // namespace bellows
