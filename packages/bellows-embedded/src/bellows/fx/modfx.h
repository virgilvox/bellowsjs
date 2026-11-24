/* Transcription of src/fx/modfx.ts: Chorus, Flanger, Phaser, Tremolo,
 * AutoPan, RingMod.
 *
 * All are stereo in-place effects. Sweep positions come from Lfo
 * instances offset in phase for stereo width; the delay based ones read a
 * DelayLine with cubic interpolation.
 *
 * Six independent classes, no base class, no virtuals, no registry. The
 * two that need delay memory take their sample rate as a template
 * parameter so the line is sized at compile time and the caller pays for
 * the one they use: Phaser, Tremolo, AutoPan and RingMod carry no buffers
 * at all. The frequency shifter is in fx/freqshift.h.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/lfo.h"

namespace bellows {

namespace detail {

/* The ring modulator's carrier. This is SineOsc from dsp/oscillators.h in
 * all but name, and it is repeated here on purpose: that header also
 * declares BlepOsc, which pulls in the 16 KB of BLEP residual tables, and
 * nothing in this file wants them. Six lines beats making every sketch
 * that only uses a tremolo carry that include. It also goes through
 * fm::Sin, so the whole file honours one math switch. */
class SineCarrier {
 public:
  void Init(float sample_rate) { sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE)); }
  /* Fixed point phase for the same reason Lfo uses it: see the note on
   * PhaseIncrement in config.h. The carrier runs at audio rate here, so a
   * drifting accumulator costs more than it does on a control rate Lfo. */
  void SetFreq(float hz) { inc_ = PhaseIncrement(Clamp(hz / sr_, 0.0f, 0.5f)); }
  void Reset(float phase = 0.0f) { phase_ = PhaseFromCycles(phase); }
  inline float Process() {
    const float y = fm::Sin(kTwoPi * (static_cast<float>(phase_) * kPhaseToUnit));
    phase_ += inc_;
    return y;
  }

 private:
  float sr_ = 48000.0f;
  uint32_t phase_ = 0u, inc_ = 0u;
};

}  // namespace detail

/* ------------------------------------------------------------------ */
/* Chorus                                                              */
/* ------------------------------------------------------------------ */

inline constexpr int kChorusTaps = 3;
/* Tap centers sit inside the 5..30 ms window with 5 ms of sweep room
 * each way, which is what sets the 31 ms line length. */
inline constexpr float kChorusCenterMs[kChorusTaps] = {10.0f, 17.5f, 25.0f};
inline constexpr float kChorusModMs = 5.0f;

/*
 * Three modulated delay taps per channel, averaged. Each tap has its own
 * sine Lfo; taps are spread a third of a cycle apart and the right
 * channel runs a quarter cycle (90 degrees) ahead of the left for stereo
 * width.
 */
template <int kSampleRate = BELLOWS_SAMPLE_RATE>
class Chorus {
 public:
  static constexpr uint32_t kLineSamples = (31u * kSampleRate + 999u) / 1000u;

  struct Params {
    float rate = 0.5f;
    float depth = 0.5f;
    float mix = 0.5f;
    float feedback = 0.0f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    line_l_.Init();
    line_r_.Init();
    mod_scale_ = kChorusModMs * 0.001f * sample_rate;
    for (int t = 0; t < kChorusTaps; ++t) {
      centers_[t] = kChorusCenterMs[t] * 0.001f * sample_rate;
      lfo_l_[t].Init(sample_rate);
      lfo_r_[t].Init(sample_rate);
      lfo_l_[t].Reset(static_cast<float>(t) / kChorusTaps);
      lfo_r_[t].Reset(static_cast<float>(t) / kChorusTaps + 0.25f);
    }
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.depth = Clamp(p_.depth, 0.0f, 1.0f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    p_.feedback = Clamp(p_.feedback, 0.0f, 0.5f);
    const float hz = Clamp(p_.rate, 0.0f, 20.0f);
    for (int t = 0; t < kChorusTaps; ++t) {
      lfo_l_[t].SetFreq(hz);
      lfo_r_[t].SetFreq(hz);
    }
    mod_amp_ = p_.depth * mod_scale_;
  }

  void Process(float* l, float* r, int from, int to) {
    const float dry = 1.0f - p_.mix;
    const float wet = p_.mix / kChorusTaps;
    const float fb = p_.feedback;
    for (int i = from; i < to; ++i) {
      const float xl = l[i];
      const float xr = r[i];
      line_l_.Write(xl + fb * fb_l_);
      line_r_.Write(xr + fb * fb_r_);
      float wl = 0.0f;
      float wr = 0.0f;
      for (int t = 0; t < kChorusTaps; ++t) {
        wl += line_l_.ReadCubic(centers_[t] + mod_amp_ * lfo_l_[t].Process());
        wr += line_r_.ReadCubic(centers_[t] + mod_amp_ * lfo_r_[t].Process());
      }
      fb_l_ = wl / kChorusTaps;
      fb_r_ = wr / kChorusTaps;
      l[i] = dry * xl + wet * wl;
      r[i] = dry * xr + wet * wr;
    }
  }

  void Reset() {
    line_l_.Clear();
    line_r_.Clear();
    fb_l_ = 0.0f;
    fb_r_ = 0.0f;
    for (int t = 0; t < kChorusTaps; ++t) {
      lfo_l_[t].Reset(static_cast<float>(t) / kChorusTaps);
      lfo_r_[t].Reset(static_cast<float>(t) / kChorusTaps + 0.25f);
    }
  }

 private:
  Params p_;
  DelayLine<kLineSamples> line_l_, line_r_;
  Lfo lfo_l_[kChorusTaps], lfo_r_[kChorusTaps];
  float centers_[kChorusTaps] = {};
  /* Sweep amplitude in samples at depth 1. */
  float mod_scale_ = 0.0f, mod_amp_ = 0.0f;
  float fb_l_ = 0.0f, fb_r_ = 0.0f;
};

/* ------------------------------------------------------------------ */
/* Flanger                                                             */
/* ------------------------------------------------------------------ */

inline constexpr float kFlangerMinMs = 0.5f;
inline constexpr float kFlangerMaxMs = 10.0f;

/*
 * Single short modulated delay per channel with feedback. One shared Lfo
 * sweeps both channels. manual places the center delay inside the
 * 0.5..10 ms window, depth scales the sweep, and the swept delay is
 * clamped back into the window.
 */
template <int kSampleRate = BELLOWS_SAMPLE_RATE>
class Flanger {
 public:
  static constexpr uint32_t kLineSamples = (11u * kSampleRate + 999u) / 1000u;

  struct Params {
    float rate = 0.25f;
    float depth = 0.7f;
    float manual = 0.25f;
    float feedback = 0.4f;
    float mix = 0.5f;
    bool invert = false;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    line_l_.Init();
    line_r_.Init();
    lfo_.Init(sample_rate);
    ms_to_samples_ = 0.001f * sample_rate;
    min_s_ = kFlangerMinMs * ms_to_samples_;
    max_s_ = kFlangerMaxMs * ms_to_samples_;
    lfo_.Reset();
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.depth = Clamp(p_.depth, 0.0f, 1.0f);
    p_.manual = Clamp(p_.manual, 0.0f, 1.0f);
    p_.feedback = Clamp(p_.feedback, 0.0f, 0.9f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    lfo_.SetFreq(Clamp(p_.rate, 0.0f, 20.0f));
    amp_s_ = p_.depth * 0.5f * (kFlangerMaxMs - kFlangerMinMs) * ms_to_samples_;
    center_s_ =
        (kFlangerMinMs + p_.manual * (kFlangerMaxMs - kFlangerMinMs)) * ms_to_samples_;
  }

  void Process(float* l, float* r, int from, int to) {
    const float dry = 1.0f - p_.mix;
    const float sign = p_.invert ? -p_.mix : p_.mix;
    const float fb = p_.feedback;
    for (int i = from; i < to; ++i) {
      float d = center_s_ + amp_s_ * lfo_.Process();
      d = Clamp(d, min_s_, max_s_);
      const float xl = l[i];
      const float xr = r[i];
      line_l_.Write(xl + fb * fb_l_);
      line_r_.Write(xr + fb * fb_r_);
      const float yl = line_l_.ReadCubic(d);
      const float yr = line_r_.ReadCubic(d);
      fb_l_ = yl;
      fb_r_ = yr;
      l[i] = dry * xl + sign * yl;
      r[i] = dry * xr + sign * yr;
    }
  }

  void Reset() {
    line_l_.Clear();
    line_r_.Clear();
    fb_l_ = 0.0f;
    fb_r_ = 0.0f;
    lfo_.Reset();
  }

 private:
  Params p_;
  DelayLine<kLineSamples> line_l_, line_r_;
  Lfo lfo_;
  float ms_to_samples_ = 48.0f, min_s_ = 24.0f, max_s_ = 480.0f;
  float center_s_ = 24.0f, amp_s_ = 0.0f;
  float fb_l_ = 0.0f, fb_r_ = 0.0f;
};

/* ------------------------------------------------------------------ */
/* Phaser                                                              */
/* ------------------------------------------------------------------ */

inline constexpr int kPhaserMaxPairs = 8;

/*
 * Cascade of first-order allpass pairs. The stages param counts pairs
 * (4..8, rounded); each pair contributes one notch when wet and dry are
 * mixed. All sections share one coefficient derived from an Lfo-swept
 * center frequency moving exponentially between freqlo and freqhi. The
 * right channel Lfo runs spread cycles ahead of the left.
 *
 * The JS resets the two Lfos whenever spread is set and clears the allpass
 * state whenever the rounded stages count changes. SetParams takes the
 * whole struct, so it does the first when spread differs from the value
 * it had and the second when the count differs, which is what a control
 * moving produces either way (see Tremolo's phase for the same choice).
 */
class Phaser {
 public:
  struct Params {
    float rate = 0.3f;
    float freqlo = 300.0f;
    float freqhi = 3000.0f;
    float feedback = 0.3f;
    float stages = 6.0f;
    float spread = 0.25f;
    float mix = 0.5f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    max_f_ = 0.49f * sr_;
    lfo_l_.Init(sr_);
    lfo_r_.Init(sr_);
    pairs_ = 6;
    SetParams(p);
    /* Unconditional, so a re-initialised object starts from silence and a
     * known phase however SetParams decided about its guards. */
    Reset();
  }

  void SetParams(const Params& p) {
    const float old_spread = p_.spread;
    p_ = p;
    p_.feedback = Clamp(p_.feedback, 0.0f, 0.9f);
    p_.spread = Clamp(p_.spread, 0.0f, 1.0f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    const float hz = Clamp(p_.rate, 0.0f, 20.0f);
    lfo_l_.SetFreq(hz);
    lfo_r_.SetFreq(hz);
    freq_lo_ = Clamp(p_.freqlo, 10.0f, max_f_);
    const float hi_set = Clamp(p_.freqhi, 10.0f, max_f_);
    const float hi = hi_set > freq_lo_ * 1.01f ? hi_set : freq_lo_ * 1.01f;
    log_ratio_ = fm::Log(hi / freq_lo_);
    /* Math.round, then clamp to 4..8. Clamping first gives the same count
     * and keeps a NaN out of the cast. */
    const int pairs =
        static_cast<int>(Clamp(p_.stages, 4.0f, static_cast<float>(kPhaserMaxPairs)) + 0.5f);
    if (pairs != pairs_) {
      pairs_ = pairs;
      ClearAllpass();
    }
    if (p_.spread != old_spread) {
      lfo_l_.Reset(0.0f);
      lfo_r_.Reset(p_.spread);
    }
  }

  void Process(float* l, float* r, int from, int to) {
    const float mix = p_.mix;
    const float dry = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      const float xl = l[i];
      const float xr = r[i];
      const float yl = Tick(xl, lfo_l_.Process(), x1_l_, y1_l_, fb_l_);
      const float yr = Tick(xr, lfo_r_.Process(), x1_r_, y1_r_, fb_r_);
      fb_l_ = yl;
      fb_r_ = yr;
      l[i] = dry * xl + mix * yl;
      r[i] = dry * xr + mix * yr;
    }
  }

  void Reset() {
    ClearAllpass();
    fb_l_ = 0.0f;
    fb_r_ = 0.0f;
    lfo_l_.Reset(0.0f);
    lfo_r_.Reset(p_.spread);
  }

 private:
  /* One sample through one channel's allpass chain. */
  inline float Tick(float x, float lfo, float* x1, float* y1, float fb_prev) {
    const float u = 0.5f * (lfo + 1.0f);
    float f = freq_lo_ * fm::Exp(log_ratio_ * u);
    if (f > max_f_) f = max_f_;
    const float t = fm::Tan((kPi * f) / sr_);
    const float a = (t - 1.0f) / (t + 1.0f);
    float v = x + p_.feedback * fb_prev;
    const int n = pairs_ * 2;
    for (int s = 0; s < n; ++s) {
      const float y = a * v + x1[s] - a * y1[s];
      x1[s] = v;
      y1[s] = y;
      v = y;
    }
    return v;
  }

  void ClearAllpass() {
    for (int s = 0; s < kPhaserMaxPairs * 2; ++s) {
      x1_l_[s] = 0.0f;
      y1_l_[s] = 0.0f;
      x1_r_[s] = 0.0f;
      y1_r_[s] = 0.0f;
    }
  }

  Params p_;
  Lfo lfo_l_, lfo_r_;
  float sr_ = 48000.0f, max_f_ = 23520.0f;
  float freq_lo_ = 300.0f, log_ratio_ = 2.30258509f;
  int pairs_ = 6;
  float x1_l_[kPhaserMaxPairs * 2] = {}, y1_l_[kPhaserMaxPairs * 2] = {};
  float x1_r_[kPhaserMaxPairs * 2] = {}, y1_r_[kPhaserMaxPairs * 2] = {};
  float fb_l_ = 0.0f, fb_r_ = 0.0f;
};

/* ------------------------------------------------------------------ */
/* Tremolo                                                             */
/* ------------------------------------------------------------------ */

/*
 * Lfo on amplitude. Gain stays at 1 when the Lfo is at its peak and dips
 * to 1 - depth at the trough. phase offsets the right channel Lfo in
 * cycles (0.5 gives anti-phase stereo tremolo). Pass an Rng to put the
 * sample and hold shape in a stream you can fork and follow; leave it out
 * and each Lfo owns an 'lfo/sh' stream, which is what the JS does.
 */
class Tremolo {
 public:
  struct Params {
    float rate = 4.0f;
    float depth = 0.8f;
    LfoShape shape = LfoShape::kSine;
    float phase = 0.0f;
  };

  void Init(float sample_rate, Rng* rng = nullptr) {
    Params d;
    Init(sample_rate, d, rng);
  }

  void Init(float sample_rate, const Params& p, Rng* rng = nullptr) {
    lfo_l_.Init(sample_rate, rng);
    lfo_r_.Init(sample_rate, rng);
    SetParams(p);
    /* Unconditional, so re-initialising a used object starts from a known
     * phase however SetParams decided about the guard below. */
    Reset();
  }

  void SetParams(const Params& p) {
    const float old_phase = p_.phase;
    p_ = p;
    p_.depth = Clamp(p_.depth, 0.0f, 1.0f);
    p_.phase = Clamp(p_.phase, 0.0f, 1.0f);
    const float hz = Clamp(p_.rate, 0.0f, 100.0f);
    lfo_l_.SetFreq(hz);
    lfo_r_.SetFreq(hz);
    lfo_l_.SetShape(p_.shape);
    lfo_r_.SetShape(p_.shape);
    /* Only a phase change realigns the two Lfos, matching the JS where
     * the reset lives in the phase branch of setParam. */
    if (p_.phase != old_phase) {
      lfo_l_.Reset(0.0f);
      lfo_r_.Reset(p_.phase);
    }
  }

  void Process(float* l, float* r, int from, int to) {
    const float half = 0.5f * p_.depth;
    for (int i = from; i < to; ++i) {
      l[i] *= 1.0f - half * (1.0f - lfo_l_.Process());
      r[i] *= 1.0f - half * (1.0f - lfo_r_.Process());
    }
  }

  void Reset() {
    lfo_l_.Reset(0.0f);
    lfo_r_.Reset(p_.phase);
  }

 private:
  Params p_;
  Lfo lfo_l_, lfo_r_;
};

/* ------------------------------------------------------------------ */
/* AutoPan                                                             */
/* ------------------------------------------------------------------ */

/*
 * Equal-power pan swept by one Lfo. Left gain cos(theta), right gain
 * sin(theta) with theta in [0, pi/2], so total power is constant and the
 * center position sits 3 dB down per channel.
 */
class AutoPan {
 public:
  struct Params {
    float rate = 1.0f;
    float depth = 1.0f;
    LfoShape shape = LfoShape::kSine;
  };

  void Init(float sample_rate, Rng* rng = nullptr) {
    Params d;
    Init(sample_rate, d, rng);
  }

  void Init(float sample_rate, const Params& p, Rng* rng = nullptr) {
    lfo_.Init(sample_rate, rng);
    lfo_.Reset();
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.depth = Clamp(p_.depth, 0.0f, 1.0f);
    lfo_.SetFreq(Clamp(p_.rate, 0.0f, 100.0f));
    lfo_.SetShape(p_.shape);
  }

  void Process(float* l, float* r, int from, int to) {
    const float quarter_pi = 0.25f * kPi;
    for (int i = from; i < to; ++i) {
      const float theta = (p_.depth * lfo_.Process() + 1.0f) * quarter_pi;
      l[i] *= fm::Cos(theta);
      r[i] *= fm::Sin(theta);
    }
  }

  void Reset() { lfo_.Reset(); }

 private:
  Params p_;
  Lfo lfo_;
};

/* ------------------------------------------------------------------ */
/* Ring modulator                                                      */
/* ------------------------------------------------------------------ */

/* Input times a sine carrier. Both channels share one carrier. */
class RingMod {
 public:
  struct Params {
    float freq = 440.0f;
    float mix = 1.0f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    carrier_.Init(sample_rate);
    carrier_.Reset();
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    carrier_.SetFreq(Clamp(p_.freq, 0.0f, 20000.0f));
  }

  void Process(float* l, float* r, int from, int to) {
    const float mix = p_.mix;
    const float dry = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      const float c = carrier_.Process();
      l[i] = dry * l[i] + mix * l[i] * c;
      r[i] = dry * r[i] + mix * r[i] * c;
    }
  }

  void Reset() { carrier_.Reset(); }

 private:
  Params p_;
  detail::SineCarrier carrier_;
};

}  // namespace bellows
