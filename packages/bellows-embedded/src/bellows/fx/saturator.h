/* Transcription of src/fx/saturator.ts.
 *
 * Drive into a selectable waveshaping curve, with the nonlinearity run
 * above the host rate through an Oversampler so the harmonics it makes
 * past Nyquist are filtered out instead of folding back.
 *
 * Curves: tanh (normalized, hard-clip limit at high drive), cubic soft
 * clip, triangle wavefolder, and a fixed Chebyshev polynomial mix of
 * harmonics 1 through 5.
 *
 * Output compensation is automatic: on every parameter change the unit
 * measures the RMS a half-scale sine keeps through the curve and scales
 * the wet path so the level stays put. output_db sits on top of that,
 * and tone is a tilt around 700 Hz built from a complementary one-pole
 * pair (lowpass plus its residual highpass), up to +/-6 dB of tilt at the
 * extremes with exact unity at 0.
 *
 * kOversample is a template parameter because this is the most expensive
 * effect in the library and almost all of the cost is the oversampling:
 * 493 ns per sample in the JS profile, top of the table, against roughly
 * 40 ns for the shaping itself. 4 matches the JS exactly. 2 halves the
 * filter work and still pushes the first aliasing image above 24 kHz for
 * anything but the most extreme drive. 1 removes the Oversampler, both
 * dry-path delay lines and both block scratch buffers from the object
 * entirely, leaving a plain memoryless shaper: cheapest, aliases, and
 * perfectly usable on bass or on material that is already band limited.
 *
 * The JS builds a 2048-point Chebyshev table into RAM per instance. Here
 * the polynomial is evaluated directly by its recurrence, five multiply-
 * adds instead of 8 KB of flash that every sketch including this header
 * would pay for whether or not it ever selects that curve. Direct
 * evaluation is also more accurate than the interpolated table. The input
 * is clamped to [-1, 1] first, which is what the table's out-of-range
 * clamping did implicitly and which the Chebyshev recurrence needs, since
 * T5 runs away fast outside that interval.
 *
 * At factors 2 and 4 the round trip delays the wet path (16 or 24
 * samples), so the dry path for mix runs through delay lines of the same
 * length and parallel blends stay phase aligned. The figure is kLatency.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/oversample.h"
#include "bellows/dsp/waveshaper.h"

namespace bellows {

enum class SatCurve { kTanh = 0, kSoft = 1, kFold = 2, kCheby = 3 };

/* Chebyshev weights for harmonics 1 through 5 of the cheby curve. */
inline constexpr float kSatChebyCoeffs[5] = {0.5f, 0.25f, 0.15f, 0.08f, 0.04f};
/* Tilt pivot and range of the tone control. */
inline constexpr float kSatTiltPivotHz = 700.0f;
inline constexpr float kSatTiltRangeDb = 6.0f;
/* Reference level the auto compensation holds constant through the curve. */
inline constexpr float kSatCompRef = 0.5f;

namespace detail {

/* Everything that exists only when the unit actually oversamples. At
 * kOversample 1 this specializes to nothing, so the delay lines and the
 * two block-sized scratch buffers vanish along with the filters. */
template <bool kOn, int kFactor, int kBlock, uint32_t kLat>
struct SatOsState {
  Oversampler<kFactor, kBlock> os_l, os_r;
  DelayLine<kLat + 4> dl_l, dl_r;
  float dry_l[kBlock] = {};
  float dry_r[kBlock] = {};
  void Init() {
    os_l.Init();
    os_r.Init();
    dl_l.Init();
    dl_r.Init();
  }
  void Reset() {
    os_l.Reset();
    os_r.Reset();
    dl_l.Clear();
    dl_r.Clear();
  }
};

template <int kFactor, int kBlock, uint32_t kLat>
struct SatOsState<false, kFactor, kBlock, kLat> {
  void Init() {}
  void Reset() {}
};

}  // namespace detail

template <int kOversample = 4, int kMaxBlock = BELLOWS_BLOCK_SIZE>
class Saturator {
 public:
  static_assert(kOversample == 1 || kOversample == 2 || kOversample == 4,
                "Saturator kOversample must be 1, 2 or 4");
  static_assert(kMaxBlock >= 1, "Saturator kMaxBlock must be at least 1");

  /* Wet-path delay in samples; the dry path is delayed to match. */
  static constexpr uint32_t kLatency =
      (kOversample == 4) ? 24u : ((kOversample == 2) ? 16u : 0u);

  struct Params {
    float drive = 2.0f;
    SatCurve curve = SatCurve::kTanh;
    float tone = 0.0f;
    float output_db = 0.0f;
    float mix = 1.0f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    tilt_l_.Init(sample_rate);
    tilt_r_.Init(sample_rate);
    tilt_l_.SetLowpass(kSatTiltPivotHz);
    tilt_r_.SetLowpass(kSatTiltPivotHz);
    state_.Init();
    SetParams(p);
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.drive = Clamp(p_.drive, 0.1f, 20.0f);
    p_.tone = Clamp(p_.tone, -1.0f, 1.0f);
    p_.output_db = Clamp(p_.output_db, -24.0f, 24.0f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    g_lo_ = fm::DbToGain(-p_.tone * kSatTiltRangeDb);
    g_hi_ = fm::DbToGain(p_.tone * kSatTiltRangeDb);
    out_gain_ = fm::DbToGain(p_.output_db);
    UpdateComp();
  }

  void Process(float* l, float* r, int from, int to) {
    if constexpr (kOversample == 1) {
      /* No latency to compensate, so dry and wet are the same sample and
       * the whole effect fuses into one pass with no scratch at all. */
      const float mix = p_.mix;
      const float dry_amt = 1.0f - mix;
      for (int i = from; i < to; ++i) {
        const float xl = l[i];
        const float xr = r[i];
        const float sl = ShapeOne(xl);
        const float sr = ShapeOne(xr);
        const float lp_l = tilt_l_.Process(sl);
        const float lp_r = tilt_r_.Process(sr);
        const float wet_l = (g_lo_ * lp_l + g_hi_ * (sl - lp_l)) * comp_;
        const float wet_r = (g_lo_ * lp_r + g_hi_ * (sr - lp_r)) * comp_;
        l[i] = (xl * dry_amt + wet_l * mix) * out_gain_;
        r[i] = (xr * dry_amt + wet_r * mix) * out_gain_;
      }
    } else {
      for (int start = from; start < to; start += kMaxBlock) {
        int end = start + kMaxBlock;
        if (end > to) end = to;
        Chunk(l, r, start, end);
      }
    }
  }

  void Reset() {
    state_.Reset();
    tilt_l_.Reset();
    tilt_r_.Reset();
  }

 private:
  /* Oversampler<1, ...> does not exist, so feed the storage template a
   * legal factor it will never instantiate at kOversample 1. */
  static constexpr int kOsFactor = (kOversample == 1) ? 2 : kOversample;

  inline float ShapeOne(float x) const {
    switch (p_.curve) {
      case SatCurve::kTanh:
        return TanhShape(x, p_.drive);
      case SatCurve::kSoft:
        return SoftClip(x * p_.drive);
      case SatCurve::kFold:
        return Foldback(x, p_.drive);
      case SatCurve::kCheby:
      default:
        return Cheby(Clamp(x * p_.drive, -1.0f, 1.0f));
    }
  }

  /* Sum of the first five Chebyshev polynomials of the first kind by the
   * T(n+1) = 2x T(n) - T(n-1) recurrence. */
  static inline float Cheby(float x) {
    float t_prev = 1.0f;
    float t_cur = x;
    float y = 0.0f;
    for (int k = 0; k < 5; ++k) {
      y += kSatChebyCoeffs[k] * t_cur;
      const float t_next = 2.0f * x * t_cur - t_prev;
      t_prev = t_cur;
      t_cur = t_next;
    }
    return y;
  }

  /* Measure the RMS a half-scale sine keeps through the current curve and
   * set the wet gain that restores it. Off the audio path, parameter
   * changes only. */
  void UpdateComp() {
    float acc = 0.0f;
    for (int k = 0; k < 64; ++k) {
      const float y = ShapeOne(kSatCompRef * fm::Sin(kTwoPi * static_cast<float>(k) / 64.0f));
      acc += y * y;
    }
    const float rms_out = fm::Sqrt(acc / 64.0f);
    const float rms_in = kSatCompRef * kSqrtHalf;
    comp_ = Clamp(rms_in / (rms_out > 1e-4f ? rms_out : 1e-4f), 0.05f, 8.0f);
  }

  void Chunk(float* l, float* r, int from, int to) {
    if constexpr (kOversample != 1) {
      const int n = to - from;
      const int hi = n * kOversample;
      for (int j = 0; j < n; ++j) {
        state_.dry_l[j] = l[from + j];
        state_.dry_r[j] = r[from + j];
      }

      float* up = state_.os_l.Up(l, from, to);
      for (int k = 0; k < hi; ++k) up[k] = ShapeOne(up[k]);
      state_.os_l.Down(up, l, from, to);

      up = state_.os_r.Up(r, from, to);
      for (int k = 0; k < hi; ++k) up[k] = ShapeOne(up[k]);
      state_.os_r.Down(up, r, from, to);

      const float mix = p_.mix;
      const float dry_amt = 1.0f - mix;
      const int32_t look = static_cast<int32_t>(kLatency);
      for (int j = 0; j < n; ++j) {
        const int i = from + j;
        const float lp_l = tilt_l_.Process(l[i]);
        const float wet_l = (g_lo_ * lp_l + g_hi_ * (l[i] - lp_l)) * comp_;
        state_.dl_l.Write(state_.dry_l[j]);
        l[i] = (state_.dl_l.ReadInt(look) * dry_amt + wet_l * mix) * out_gain_;
        const float lp_r = tilt_r_.Process(r[i]);
        const float wet_r = (g_lo_ * lp_r + g_hi_ * (r[i] - lp_r)) * comp_;
        state_.dl_r.Write(state_.dry_r[j]);
        r[i] = (state_.dl_r.ReadInt(look) * dry_amt + wet_r * mix) * out_gain_;
      }
    }
  }

  Params p_;
  OnePole tilt_l_, tilt_r_;
  detail::SatOsState<(kOversample != 1), kOsFactor, kMaxBlock, kLatency> state_;
  float comp_ = 1.0f, g_lo_ = 1.0f, g_hi_ = 1.0f, out_gain_ = 1.0f;
};

}  // namespace bellows
