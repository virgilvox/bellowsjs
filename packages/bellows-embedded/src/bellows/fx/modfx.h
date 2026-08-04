/* Transcription of src/fx/modfx.ts: Chorus, Flanger, Tremolo, AutoPan,
 * RingMod.
 *
 * All are stereo in-place effects. Sweep positions come from Lfo
 * instances offset in phase for stereo width; the delay based ones read a
 * DelayLine with cubic interpolation.
 *
 * Five independent classes, no base class, no virtuals, no registry. The
 * two that need delay memory take their sample rate as a template
 * parameter so the line is sized at compile time and the caller pays for
 * the one they use: Tremolo, AutoPan and RingMod carry no buffers at all
 * and cost a few dozen bytes each.
 *
 * The phaser and the frequency shifter from the same TypeScript file are
 * not ported here.
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
  void Init(float sample_rate) { sr_ = sample_rate; }
  void SetFreq(float hz) { dt_ = Clamp(hz / sr_, 0.0f, 0.5f); }
  void Reset(float phase = 0.0f) { phase_ = phase - floorf(phase); }
  inline float Process() {
    const float y = fm::Sin(kTwoPi * phase_);
    phase_ += dt_;
    if (phase_ >= 1.0f) phase_ -= 1.0f;
    return y;
  }

 private:
  float sr_ = 48000.0f, phase_ = 0.0f, dt_ = 0.0f;
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
/* Tremolo                                                             */
/* ------------------------------------------------------------------ */

/*
 * Lfo on amplitude. Gain stays at 1 when the Lfo is at its peak and dips
 * to 1 - depth at the trough. phase offsets the right channel Lfo in
 * cycles (0.5 gives anti-phase stereo tremolo). Pass an Rng if the shape
 * is sample and hold, so the stream stays forkable.
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
