/* Transcription of src/dsp/lfo.ts.
 *
 * Bipolar output in [-1, 1]. Control rate signals do not need band
 * limiting, so shapes are naive. Sample and hold draws from an injected
 * Rng; pass one so the stream stays deterministic and forkable. */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"

namespace bellows {

enum class LfoShape { kSine, kTriangle, kSaw, kSquare, kSampleHold };

class Lfo {
 public:
  void Init(float sample_rate, Rng* rng = nullptr) {
    sr_ = sample_rate;
    rng_ = rng;
    held_ = rng_ ? rng_->Bipolar() : 0.0f;
  }

  /* Clamped in double to match the JS, which computes dt from two doubles
   * before the phase ever sees it. See PhaseIncrement in config.h for why
   * a double here does not reach the audio path. */
  void SetFreq(float hz) {
    const double dt = static_cast<double>(hz) / static_cast<double>(sr_);
    inc_ = PhaseIncrement(dt < 0.0 ? 0.0 : (dt > 0.5 ? 0.5 : dt));
  }
  void SetShape(LfoShape s) { shape_ = s; }

  /* Sets phase (fractional part is used). Does not draw from the rng. */
  void Reset(float phase = 0.0f) { phase_ = PhaseFromCycles(phase); }

  inline float Process() {
    const float t = static_cast<float>(phase_) * kPhaseToUnit;
    float y = 0.0f;
    switch (shape_) {
      case LfoShape::kSine: y = fm::Sin(kTwoPi * t); break;
      case LfoShape::kTriangle: y = t < 0.5f ? 4.0f * t - 1.0f : 3.0f - 4.0f * t; break;
      case LfoShape::kSaw: y = 2.0f * t - 1.0f; break;
      case LfoShape::kSquare: y = t < 0.5f ? 1.0f : -1.0f; break;
      case LfoShape::kSampleHold: y = held_; break;
    }
    /* The wrap is the unsigned overflow, so a cycle boundary is exactly
     * where the counter passes its own previous value. */
    const uint32_t prev = phase_;
    phase_ += inc_;
    if (phase_ < prev && rng_) held_ = rng_->Bipolar();
    return y;
  }

 private:
  float sr_ = 48000.0f, held_ = 0.0f;
  uint32_t phase_ = 0u, inc_ = 0u;
  LfoShape shape_ = LfoShape::kSine;
  Rng* rng_ = nullptr;
};

}  // namespace bellows
