/* Parametric EQ, ported from src/fx/eq.ts.
 *
 * The TypeScript is six bands in series: band 0 a low shelf, bands 1
 * through 4 bells, band 5 a high shelf, one Svf per channel per band.
 * Eq6 is that, with the same modes, default frequencies and default Qs,
 * so it is the one parity checks against the source of truth.
 *
 * A band whose gain is exactly 0 dB is skipped, matching the JS. The Svf
 * bell and shelf modes are exact identities at 0 dB anyway, so skipping
 * changes nothing audible and makes 0 gain a bit-transparent bypass.
 * Re-enabling a band clears its filter state so stale integrator energy
 * cannot click in.
 *
 * Eq3 is a deliberate reduction, NOT a port: low shelf, one bell, high
 * shelf, at different default frequencies. It exists because six bands is
 * more tone control than a pedal usually needs and each band costs two
 * Svfs. Do not expect it to match the browser, because it is a different
 * filter. An earlier version of this file was a three band design
 * carrying a "from src/fx/eq.ts" comment, which is the kind of quiet
 * divergence a port accumulates if nobody diffs it.
 */
#pragma once
#include "bellows/config.h"
#include "bellows/dsp/filters.h"

namespace bellows {

/* Transcribed from BAND_MODES, BAND_FREQS and BAND_QS in eq.ts. */
inline constexpr int kEqBands = 6;
inline constexpr float kEqBandFreq[kEqBands] = {80.0f, 250.0f, 800.0f, 2500.0f, 6000.0f, 12000.0f};
inline constexpr float kEqBandQ[kEqBands] = {0.707f, 1.0f, 1.0f, 1.0f, 1.0f, 0.707f};

inline SvfMode EqBandMode(int i) {
  if (i == 0) return SvfMode::kLowShelf;
  if (i == kEqBands - 1) return SvfMode::kHighShelf;
  return SvfMode::kBell;
}

/** One band: a stereo pair of Svfs sharing frequency, gain and q. */
class EqBand {
 public:
  void Init(float sample_rate, SvfMode mode, float freq, float q) {
    for (int c = 0; c < 2; ++c) {
      svf_[c].Init(sample_rate);
      svf_[c].SetMode(mode);
    }
    freq_ = freq;
    q_ = q;
    gain_db_ = 0.0f;
    enabled_ = true;
    Update();
  }

  void Set(float freq, float gain_db, float q, bool enabled) {
    const bool was_active = enabled_ && gain_db_ != 0.0f;
    freq_ = freq;
    gain_db_ = gain_db;
    q_ = q;
    enabled_ = enabled;
    const bool now_active = enabled_ && gain_db_ != 0.0f;
    if (now_active && !was_active) Reset();
    Update();
  }

  bool Bypassed() const { return !enabled_ || gain_db_ == 0.0f; }

  inline float Process(int ch, float x) { return svf_[ch].Process(x); }

  void Reset() {
    svf_[0].Reset();
    svf_[1].Reset();
  }

 private:
  void Update() {
    for (int c = 0; c < 2; ++c) svf_[c].Set(freq_, q_, gain_db_);
  }
  Svf svf_[2];
  float freq_ = 1000.0f, gain_db_ = 0.0f, q_ = 1.0f;
  bool enabled_ = true;
};

/** Six band parametric EQ. The faithful port. */
class Eq6 {
 public:
  struct Band {
    float freq;
    float gain_db;
    float q;
    bool enabled;
  };

  struct Params {
    Band band[kEqBands] = {
        {80.0f, 0.0f, 0.707f, true},   {250.0f, 0.0f, 1.0f, true},
        {800.0f, 0.0f, 1.0f, true},    {2500.0f, 0.0f, 1.0f, true},
        {6000.0f, 0.0f, 1.0f, true},   {12000.0f, 0.0f, 0.707f, true},
    };
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    for (int i = 0; i < kEqBands; ++i) {
      bands_[i].Init(sample_rate, EqBandMode(i), kEqBandFreq[i], kEqBandQ[i]);
    }
    SetParams(p);
  }

  void SetParams(const Params& p) {
    for (int i = 0; i < kEqBands; ++i) {
      bands_[i].Set(p.band[i].freq, p.band[i].gain_db, p.band[i].q, p.band[i].enabled);
    }
  }

  /* Bands run in series, and the JS runs each band over the whole span
   * before moving to the next, so the traversal order is band-major here
   * too. It is also the cache-friendly order. */
  void Process(float* l, float* r, int from, int to) {
    for (int i = 0; i < kEqBands; ++i) {
      if (bands_[i].Bypassed()) continue;
      for (int n = from; n < to; ++n) {
        l[n] = bands_[i].Process(0, l[n]);
        r[n] = bands_[i].Process(1, r[n]);
      }
    }
  }

  void Reset() {
    for (int i = 0; i < kEqBands; ++i) bands_[i].Reset();
  }

 private:
  EqBand bands_[kEqBands];
};

/** Three band reduction. See the header comment: not a port. */
class Eq3 {
 public:
  struct Params {
    float low_freq = 120.0f, low_gain = 0.0f;
    float mid_freq = 1000.0f, mid_gain = 0.0f, mid_q = 0.7f;
    float high_freq = 6000.0f, high_gain = 0.0f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    low_.Init(sample_rate, SvfMode::kLowShelf, p.low_freq, 0.7071f);
    mid_.Init(sample_rate, SvfMode::kBell, p.mid_freq, p.mid_q);
    high_.Init(sample_rate, SvfMode::kHighShelf, p.high_freq, 0.7071f);
    SetParams(p);
  }

  void SetParams(const Params& p) {
    low_.Set(p.low_freq, p.low_gain, 0.7071f, true);
    mid_.Set(p.mid_freq, p.mid_gain, p.mid_q, true);
    high_.Set(p.high_freq, p.high_gain, 0.7071f, true);
  }

  void Process(float* l, float* r, int from, int to) {
    for (int n = from; n < to; ++n) {
      float xl = l[n];
      float xr = r[n];
      if (!low_.Bypassed()) {
        xl = low_.Process(0, xl);
        xr = low_.Process(1, xr);
      }
      if (!mid_.Bypassed()) {
        xl = mid_.Process(0, xl);
        xr = mid_.Process(1, xr);
      }
      if (!high_.Bypassed()) {
        xl = high_.Process(0, xl);
        xr = high_.Process(1, xr);
      }
      l[n] = xl;
      r[n] = xr;
    }
  }

  void Reset() {
    low_.Reset();
    mid_.Reset();
    high_.Reset();
  }

 private:
  EqBand low_, mid_, high_;
};

}  // namespace bellows
