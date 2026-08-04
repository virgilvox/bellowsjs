/* Transcription of src/dsp/waveshaper.ts.
 *
 * Memoryless shaping primitives. Free functions so they inline into a
 * per-sample loop, usually behind an oversampler. TableShaper evaluates
 * an arbitrary transfer curve over [-1, 1]; the caller owns the table, so
 * it can live in flash. */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"

namespace bellows {

/* tanh saturation normalized so an input of 1 maps to 1 at any drive.
 * Low drive approaches identity, high drive approaches a hard clip. */
inline float TanhShape(float x, float drive) {
  if (drive < 1e-6f) return x;
  return fm::Tanh(x * drive) / fm::Tanh(drive);
}

/* Cubic soft clip: 1.5x - 0.5x^3 inside [-1, 1], flat outside.
 * Continuous first derivative at the clip points, small-signal gain 1.5. */
inline float SoftClip(float x) {
  if (x <= -1.0f) return -1.0f;
  if (x >= 1.0f) return 1.0f;
  return x * (1.5f - 0.5f * x * x);
}

inline float HardClip(float x) { return x < -1.0f ? -1.0f : (x > 1.0f ? 1.0f : x); }

/* Triangle wavefolder. Scales by gain, then reflects anything outside
 * [-1, 1] back into range, repeatedly. Identity while |x * gain| <= 1. */
inline float Foldback(float x, float gain) {
  float t = x * gain + 1.0f;
  t = t - 4.0f * floorf(t * 0.25f); /* positive modulo 4 */
  return t < 2.0f ? t - 1.0f : 3.0f - t;
}

/* Table-driven shaper: x in [-1, 1] linearly interpolated, clamped
 * outside. The table is not owned, so pass a constexpr array in flash. */
class TableShaper {
 public:
  void Init(const float* table, int len) {
    table_ = table;
    last_ = len - 1;
  }

  inline float Process(float x) const {
    float t = (x + 1.0f) * 0.5f * static_cast<float>(last_);
    if (t <= 0.0f) return table_[0];
    if (t >= static_cast<float>(last_)) return table_[last_];
    int i = static_cast<int>(t);
    float f = t - static_cast<float>(i);
    float a = table_[i];
    return a + f * (table_[i + 1] - a);
  }

 private:
  const float* table_ = nullptr;
  int last_ = 0;
};

}  // namespace bellows
