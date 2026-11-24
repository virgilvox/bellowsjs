/* Transcription of src/fx/freqshift.ts: FreqShift, a single sideband
 * frequency shifter.
 *
 * Each channel is split into a quadrature pair (dsp/hilbert.h) and
 * heterodyned with a quadrature oscillator: wet = i*cos(wt) + q*sin(wt).
 * That keeps one sideband and cancels the other, so a positive shift moves
 * every component up by the same number of Hz and a negative shift moves
 * it down, unlike ring modulation, which keeps both sidebands. Both
 * channels share one oscillator.
 *
 * No buffers and no template parameters: the same size at every rate. */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/hilbert.h"

namespace bellows {

class FreqShift {
 public:
  struct Params {
    /* Hz, negative shifts down; held inside 0.45 of the rate either way. */
    float shift = 0.0f;
    float mix = 1.0f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    Reset();
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    const float lim = 0.45f * sr_;
    p_.shift = Clamp(p_.shift, -lim, lim);
    /* The oscillator phase is a fixed point counter (see PhaseIncrement in
     * config.h), so a downward shift is the same increment subtracted,
     * which the unsigned wrap turns into the JS phase - floor(phase). */
    const float cps = p_.shift / sr_;
    inc_ = cps >= 0.0f ? PhaseIncrement(cps) : 0u - PhaseIncrement(-cps);
  }

  void Process(float* l, float* r, int from, int to) {
    const float mix = p_.mix;
    const float dry = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      const float th = kTwoPi * (static_cast<float>(phase_) * kPhaseToUnit);
      const float c = fm::Cos(th);
      const float s = fm::Sin(th);
      phase_ += inc_;
      const float xl = l[i];
      const float xr = r[i];
      h_l_.Process(xl);
      h_r_.Process(xr);
      l[i] = dry * xl + mix * (h_l_.I() * c + h_l_.Q() * s);
      r[i] = dry * xr + mix * (h_r_.I() * c + h_r_.Q() * s);
    }
  }

  void Reset() {
    h_l_.Reset();
    h_r_.Reset();
    phase_ = 0u;
  }

 private:
  Params p_;
  HilbertPair h_l_, h_r_;
  float sr_ = 48000.0f;
  uint32_t phase_ = 0u, inc_ = 0u;
};

}  // namespace bellows
