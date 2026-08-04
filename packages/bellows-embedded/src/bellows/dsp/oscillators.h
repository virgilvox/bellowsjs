/* Transcription of src/dsp/oscillators.ts. The Kaiser-sinc BLEP/BLAMP
 * residual tables live in flash (blep_tables.h, 16 KB of const f32)
 * instead of being built into RAM at module load as the JS does. */
#pragma once
#include <math.h>
#include "bellows/dsp/blep_tables.h"

namespace bellows {

enum class BlepShape { kSaw, kSquare, kTriangle, kSine };

class BlepOsc {
 public:
  void Init(float sample_rate) { sr_ = sample_rate; }
  void SetShape(BlepShape s) { shape_ = s; }
  void SetFreq(float hz) {
    float d = hz / sr_;
    dt_ = d < 0.0f ? 0.0f : (d > 0.49f ? 0.49f : d);
  }
  void SetPulseWidth(float pw) { pw_ = pw < 0.01f ? 0.01f : (pw > 0.99f ? 0.99f : pw); }
  void Reset(float phase = 0.0f) { phase_ = phase - floorf(phase); }

  inline float Process() {
    float t = phase_;
    float dt = dt_;
    float y = 0.0f;
    switch (shape_) {
      case BlepShape::kSaw:
        y = 2.0f * t - 1.0f;
        if (dt > 0.0f) y += SumBlep(t, -2.0f);
        break;
      case BlepShape::kSquare:
        y = t < pw_ ? 1.0f : -1.0f;
        if (dt > 0.0f) {
          y += SumBlep(t, 2.0f);
          y += SumBlep(t - pw_, -2.0f);
        }
        break;
      case BlepShape::kTriangle:
        y = t < 0.5f ? 4.0f * t - 1.0f : 3.0f - 4.0f * t;
        if (dt > 0.0f) {
          float mu = 8.0f * dt;
          y += SumBlamp(t, mu);
          y += SumBlamp(t - 0.5f, -mu);
        }
        break;
      case BlepShape::kSine:
        y = sinf(6.28318530717959f * t);
        break;
    }
    phase_ += dt;
    if (phase_ >= 1.0f) phase_ -= 1.0f;
    return y;
  }

 private:
  static inline float BlepResidual(float d) {
    float pos = (d + kBlepKernelHalf) * kBlepTableRes;
    int i = static_cast<int>(floorf(pos));
    if (i < 0 || i >= kBlepTableLen - 1) return 0.0f;
    float f = pos - static_cast<float>(i);
    float v = kBlepStep[i] + (kBlepStep[i + 1] - kBlepStep[i]) * f;
    return v - (d >= 0.0f ? 1.0f : 0.0f);
  }

  static inline float BlampResidual(float d) {
    float pos = (d + kBlepKernelHalf) * kBlepTableRes;
    int i = static_cast<int>(floorf(pos));
    if (i < 0 || i >= kBlepTableLen - 1) return 0.0f;
    float f = pos - static_cast<float>(i);
    return kBlepRamp[i] + (kBlepRamp[i + 1] - kBlepRamp[i]) * f;
  }

  inline float SumBlep(float x, float height) const {
    float dt = dt_;
    float w = kBlepKernelHalf * dt;
    int lo = static_cast<int>(ceilf(x - w));
    int hi = static_cast<int>(floorf(x + w));
    float y = 0.0f;
    for (int m = lo; m <= hi; ++m) y += height * BlepResidual((x - static_cast<float>(m)) / dt);
    return y;
  }

  inline float SumBlamp(float x, float mu) const {
    float dt = dt_;
    float w = kBlepKernelHalf * dt;
    int lo = static_cast<int>(ceilf(x - w));
    int hi = static_cast<int>(floorf(x + w));
    float y = 0.0f;
    for (int m = lo; m <= hi; ++m) y += mu * BlampResidual((x - static_cast<float>(m)) / dt);
    return y;
  }

  float sr_ = 48000.0f, phase_ = 0.0f, dt_ = 0.0f, pw_ = 0.5f;
  BlepShape shape_ = BlepShape::kSaw;
};

class SineOsc {
 public:
  void Init(float sample_rate) { sr_ = sample_rate; }
  void SetFreq(float hz) {
    float d = hz / sr_;
    dt_ = d < 0.0f ? 0.0f : (d > 0.5f ? 0.5f : d);
  }
  void Reset(float phase = 0.0f) { phase_ = phase - floorf(phase); }
  inline float Process() {
    float y = sinf(6.28318530717959f * phase_);
    phase_ += dt_;
    if (phase_ >= 1.0f) phase_ -= 1.0f;
    return y;
  }
  inline float ProcessPm(float pm) {
    float y = sinf(6.28318530717959f * phase_ + pm);
    phase_ += dt_;
    if (phase_ >= 1.0f) phase_ -= 1.0f;
    return y;
  }

 private:
  float sr_ = 48000.0f, phase_ = 0.0f, dt_ = 0.0f;
};

}  // namespace bellows
