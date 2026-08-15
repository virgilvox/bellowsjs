/* Transcription of src/engines/harmonic.ts.
 *
 * Harmonic plus noise, DDSP style: a 64 partial sine bank whose amplitudes
 * come from a parametric spectral envelope, plus filtered noise, both under
 * one loudness contour.
 *
 * The envelope is a spectral tilt (brightness), an even/odd harmonic
 * balance, and a fixed frequency lowpass rolloff whose corner moves with
 * formant_shift, so shifting it against f0 reads as a formant moving rather
 * than as plain brightness. Noise is white through an Svf bandpass tracking
 * f0 * noise_color, mixed in by noise_mix. f0 glides in the log domain with
 * the portamento param when a new NoteOn arrives on a voice that is still
 * sounding.
 *
 * The sine bank runs on one phase accumulator and the angle addition
 * recurrence sin((k+1)t) = sin(kt)cos(t) + cos(kt)sin(t), so a sample costs
 * two trig calls whatever the partial count.
 *
 * SetControlFrame is the frame driven path, the render target for an
 * external (for example neural) controller: it bypasses the Adsr and the
 * parametric spectrum and drives f0, loudness and the partial amplitudes
 * directly.
 *
 * PHASE
 *
 * The JS accumulates cycles in a double. Here the accumulator is the uint32
 * counter from config.h, so the increment is exact for the life of a note
 * and the wrap is the unsigned overflow rather than a compare. A float
 * accumulator, which is what mirroring the JS line literally would give,
 * loses part of every increment as it approaches 1.0 and loses it in one
 * direction, so the error grows with the note instead of averaging out.
 * Measured on this engine's parity row, both ways, everything else equal:
 * the float accumulator reads 6.42e-4 / 1.19e-3 and the fixed point counter
 * 3.63e-5 / 3.98e-5, so it is worth 18 times on the relative RMS and 30 on
 * the worst sample. That is the same result the rest of the library got
 * from the same change (chorus 3.97e-2 to 2.02e-4, plate 2.44e-3 to
 * 1.34e-5, formant 7.85e-4 to 1.39e-5).
 *
 * The increment is recomputed every sample rather than on a pitch change,
 * because the glide moves f0 every sample and the JS re-derives it every
 * sample too. That is one divide and one multiply-and-round per sample,
 * against 64 multiply-adds for the partial loop.
 *
 * What is left is f0 itself. Both sides carry pitch as log2 and take it
 * back with a power of two, and in float that round trip is about 4e-7
 * relative, so the two oscillators sit about 0.0007 cents apart and the
 * phase between them opens linearly with the note: roughly 2e-4 radians at
 * the fundamental by the end of the 0.37 s parity render, and k times that
 * at partial k. Keeping the log in double would close it and is exactly the
 * trade config.h refuses, since a double in this loop is 6.08x on a single
 * precision FPU.
 *
 * CONTROL RATE
 *
 * The spectral envelope and the noise filter are rebuilt every 64 samples
 * and the amplitudes then hold. The JS holds them the same way, with no
 * crossfade across the divider, so none is added here. Interpolating a
 * frame of 64 amplitudes over the block instead would be audible on a fast
 * brightness sweep and would land in the parity row rather than being a
 * free improvement.
 *
 * MEMORY
 *
 * Two tables of 64 floats per voice, 512 bytes: the live amplitudes and the
 * frame driven ones. The second could be dropped to halve that, but only by
 * dropping SetControlFrame, which is the documented reason the JS class is
 * exported on its own. A voice allocates nothing else.
 */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/noise.h"

namespace bellows {

inline constexpr int kHarmonicMaxPartials = 64;

class Harmonic {
 public:
  struct Params {
    float brightness = 0.5f;
    float even_odd = 0.5f;
    float formant_shift = 1.0f;
    float noise_mix = 0.1f;
    float noise_color = 2.0f;
    float portamento = 0.0f;
    float attack = 0.01f;
    float release = 0.3f;
    float level = 0.8f;
  };

  void Init(float sample_rate, Rng* rng) {
    Params d;
    Init(sample_rate, rng, d);
  }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    noise_.Init(sample_rate, NoiseColor::kWhite, rng);
    noise_bp_.Init(sample_rate);
    noise_bp_.SetMode(SvfMode::kBp);
    env_.Init(sample_rate);
    /* 5 ms of loudness smoothing, the frame path's whole contour. */
    loud_coef_ = 1.0f - fm::Exp(-1.0f / (0.005f * sr_));
    log_f0_ = fm::Log2(440.0f);
    log_target_ = log_f0_;
  }

  /* Params are read by Control() at the next divider tick, so there is
   * nothing to recompute here. */
  void SetParams(const Params& p) { p_ = p; }

  void NoteOn(float freq, float vel) {
    const float f = Clamp(freq, 16.0f, sr_ * 0.45f);
    vel_ = Clamp(vel, 0.0f, 1.0f);
    log_target_ = fm::Log2(f);
    const float port = Clamp(p_.portamento, 0.0f, 4.0f);
    if (live_ && port > 0.0f) {
      /* Legato glide from the current pitch; a fresh voice snaps. */
      glide_coef_ = 1.0f - fm::Exp(-1.0f / (port * sr_));
    } else {
      log_f0_ = log_target_;
      glide_coef_ = 1.0f;
      phase_ = 0u;
      noise_bp_.Reset();
    }
    frame_mode_ = false;
    frame_gate_off_ = false;
    frame_amp_count_ = 0;
    env_.Set(Clamp(p_.attack, 0.001f, 4.0f), 0.1f, 0.85f, Clamp(p_.release, 0.01f, 8.0f));
    env_.Trigger();
    ctrl_ = 0;
    live_ = true;
  }

  void NoteOff() {
    if (frame_mode_) {
      frame_gate_off_ = true;
      loud_target_ = 0.0f;
    } else {
      env_.Release();
    }
  }

  /*
   * Frame driven control. Call once per control frame, at any rate:
   *
   *   f0         fundamental in Hz
   *   loudness   linear amplitude 0..1, smoothed internally over 5 ms
   *   harmonics  optional linear amplitudes for partials 1..count
   *              (count <= 64), copied rather than retained; once given
   *              they replace the parametric spectral envelope and stay in
   *              force until the next frame that supplies harmonics or the
   *              next NoteOn
   *
   * The first call switches the voice into frame mode: the Adsr and the
   * velocity are bypassed and loudness is the whole contour. NoteOff then
   * ends the voice once loudness has faded. A later NoteOn returns it to
   * normal envelope operation.
   *
   * Passing a pointer with count 0 clears the frame spectrum and falls back
   * to the parametric one, which is what an empty array does in the JS.
   */
  void SetControlFrame(float f0, float loudness, const float* harmonics = nullptr,
                       int count = 0) {
    if (!frame_mode_) {
      frame_mode_ = true;
      frame_gate_off_ = false;
      live_ = true;
    }
    log_target_ = fm::Log2(Clamp(f0, 16.0f, sr_ * 0.45f));
    const float port = Clamp(p_.portamento, 0.0f, 4.0f);
    glide_coef_ = port > 0.0f ? 1.0f - fm::Exp(-1.0f / (port * sr_)) : 1.0f;
    loud_target_ = Clamp(loudness, 0.0f, 1.0f);
    if (harmonics != nullptr) {
      const int n = ClampI(count, 0, kHarmonicMaxPartials);
      for (int k = 0; k < n; ++k) frame_amps_[k] = harmonics[k];
      frame_amp_count_ = n;
    }
    ctrl_ = 0;
  }

  void Process(float* l, float* r, int from, int to) {
    if (!live_) return;
    const float level = p_.level;
    const float n_mix = Clamp(p_.noise_mix, 0.0f, 1.0f);
    for (int i = from; i < to; ++i) {
      log_f0_ += glide_coef_ * (log_target_ - log_f0_);
      const float f0 = fm::Exp2(log_f0_);
      if (ctrl_ <= 0) {
        Control(f0);
        ctrl_ = kCtrl;
      }
      --ctrl_;

      phase_ += PhaseIncrement(f0 / sr_);
      const float t = kTwoPi * (static_cast<float>(phase_) * kPhaseToUnit);
      const float c1 = fm::Cos(t);
      const float s1 = fm::Sin(t);
      float sk = s1;
      float ck = c1;
      float harm = amps_[0] * s1;
      const int count = harm_count_;
      for (int k = 1; k < count; ++k) {
        const float s2 = sk * c1 + ck * s1;
        ck = ck * c1 - sk * s1;
        sk = s2;
        harm += amps_[k] * sk;
      }

      const float nz = noise_bp_.Process(noise_.Process());
      const float dry = harm * (1.0f - n_mix) + nz * n_mix;

      float gain;
      if (frame_mode_) {
        loud_ += loud_coef_ * (loud_target_ - loud_);
        gain = loud_;
      } else {
        gain = env_.Process() * vel_;
      }
      const float o = dry * gain * level;
      l[i] += o;
      r[i] += o;
    }
    if (frame_mode_) {
      if (frame_gate_off_ && loud_ < kSilence) live_ = false;
    } else if (!env_.Active()) {
      live_ = false;
    }
  }

  bool Active() const { return live_; }

 private:
  /* Spectral envelope and noise filter refresh divider. */
  static constexpr int kCtrl = 64;
  static constexpr float kSilence = 1e-4f;

  /* Rebuild partial amplitudes and the noise filter for the current f0. */
  void Control(float f0) {
    const float nyq = sr_ * 0.45f;
    /*
     * Partials that fit under 0.45 fs. The JS floors a double and clamps
     * after; the cast is done inside the range test instead, because
     * casting a float that is out of int range is undefined rather than
     * merely wrong. At the 16 Hz floor NoteOn clamps to, the quotient is
     * 1240 at 44.1 kHz, and a NaN one satisfies neither test. Written this
     * way a NaN takes the one partial path, which is the policy Clamp() in
     * config.h settled on for the same reason.
     */
    const float fits = nyq / f0;
    harm_count_ = fits >= static_cast<float>(kHarmonicMaxPartials)
                      ? kHarmonicMaxPartials
                      : (fits >= 1.0f ? static_cast<int>(fits) : 1);

    if (frame_mode_ && frame_amp_count_ > 0) {
      float sum = 0.0f;
      for (int k = 0; k < kHarmonicMaxPartials; ++k) {
        const float a = (k < frame_amp_count_ && k < harm_count_) ? frame_amps_[k] : 0.0f;
        amps_[k] = a;
        sum += a < 0.0f ? -a : a;
      }
      /* Only normalize a frame that would clip; a quiet one keeps its own
       * loudness, which is the controller's business and not this class's. */
      if (sum > 1.0f) {
        const float norm = 1.0f / sum;
        for (int k = 0; k < harm_count_; ++k) amps_[k] *= norm;
      }
    } else {
      const float tilt = 2.5f * (1.0f - Clamp(p_.brightness, 0.0f, 1.0f));
      const float eo = Clamp(p_.even_odd, 0.0f, 1.0f);
      const float even_gain = eo <= 0.5f ? eo * 2.0f : 1.0f;
      const float odd_gain = eo >= 0.5f ? (1.0f - eo) * 2.0f : 1.0f;
      const float corner = 3500.0f * Clamp(p_.formant_shift, 0.25f, 4.0f);
      float sum = 0.0f;
      for (int k = 0; k < kHarmonicMaxPartials; ++k) {
        if (k >= harm_count_) {
          amps_[k] = 0.0f;
          continue;
        }
        const int h = k + 1;
        const float hf = static_cast<float>(h);
        float a = fm::Pow(hf, -tilt);
        a *= (h % 2 == 0) ? even_gain : odd_gain;
        const float rel = (hf * f0) / corner;
        a /= 1.0f + rel * rel * rel * rel;
        amps_[k] = a;
        sum += a;
      }
      const float norm = 1.0f / (sum > 1.0f ? sum : 1.0f);
      for (int k = 0; k < harm_count_; ++k) amps_[k] *= norm;
    }

    const float bp_hz = Clamp(f0 * Clamp(p_.noise_color, 0.25f, 16.0f), 40.0f, nyq);
    noise_bp_.Set(bp_hz, 1.5f);
  }

  float sr_ = 48000.0f;
  Params p_;
  NoiseGen noise_;
  Svf noise_bp_;
  Adsr env_;

  float amps_[kHarmonicMaxPartials] = {};
  float frame_amps_[kHarmonicMaxPartials] = {};
  int frame_amp_count_ = 0;

  uint32_t phase_ = 0u;
  float log_f0_ = 8.78135971352466f; /* log2(440) */
  float log_target_ = 8.78135971352466f;
  float glide_coef_ = 1.0f;
  int harm_count_ = 0;
  int ctrl_ = 0;

  float vel_ = 1.0f;
  bool live_ = false;

  /* Frame driven mode. */
  bool frame_mode_ = false;
  bool frame_gate_off_ = false;
  float loud_ = 0.0f, loud_target_ = 0.0f, loud_coef_ = 1.0f;
};

}  // namespace bellows
