/* Transcription of src/dsp/lfo.ts.
 *
 * Bipolar output in [-1, 1]. Control rate signals do not need band
 * limiting, so shapes are naive. Sample and hold draws from an injected
 * Rng; pass one to place the LFO in a stream you can fork and follow.
 * Passing none is a supported shape, not a broken one: the LFO then owns
 * a stream seeded 'lfo/sh', which is exactly what the TypeScript
 * constructor does with `rng ?? makeRng('lfo/sh')`, and every modfx class
 * in the JS builds its Lfos that way. */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"

namespace bellows {

enum class LfoShape { kSine, kTriangle, kSaw, kSquare, kSampleHold };

/* Seed of the JS default stream, hashed at compile time. A constexpr
 * variable rather than Xmur3("lfo/sh") at the call site, so the hash loop
 * cannot land in a sketch that only ever defaults its LFOs: measured on
 * Cortex-M7 by ./tools/size-report.sh, folding it here saved 80 bytes of
 * flash on s9j_modfx and 88 on s9k_plate against calling Xmur3 from
 * Init() with the literal. Node, same generator:
 * xmur3('lfo/sh')() is 0x3ffd21a2. */
inline constexpr uint32_t kLfoDefaultSeed = Xmur3("lfo/sh");
static_assert(kLfoDefaultSeed == 0x3ffd21a2u, "the default LFO stream is rng('lfo/sh')");

class Lfo {
 public:
  void Init(float sample_rate, Rng* rng = nullptr) {
    sr_ = sample_rate;
    /* A null Rng used to mean held_ = 0 forever, so kSampleHold produced a
     * constant and Tremolo (whose Init defaults the Rng to nullptr) went
     * silent as a modulator: a fixed gain of 1 - depth/2, and AutoPan a
     * fixed centre pan. The JS has no such state, because its constructor
     * substitutes rng('lfo/sh'). Substituting the same stream here makes
     * the defaulted C++ LFO agree with the defaulted JS one instead of
     * disagreeing quietly. Own it per instance rather than sharing one
     * static: the JS gives every defaulted Lfo its own generator from the
     * same seed, so two of them (Tremolo's left and right) draw the same
     * sequence, and a shared one would interleave them into two different
     * ones. Four bytes of state per LFO. */
    if (rng == nullptr) {
      own_.Init(kLfoDefaultSeed);
      rng_ = &own_;
    } else {
      rng_ = rng;
    }
    held_ = rng_->Bipolar();
  }

  void SetFreq(float hz) { inc_ = PhaseIncrement(Clamp(hz / sr_, 0.0f, 0.5f)); }
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
    /* Init always leaves rng_ non-null; the test is for the object that
     * was never initialised at all, which has no sample rate either. */
    if (phase_ < prev && rng_) held_ = rng_->Bipolar();
    return y;
  }

 private:
  float sr_ = 48000.0f, held_ = 0.0f;
  uint32_t phase_ = 0u, inc_ = 0u;
  LfoShape shape_ = LfoShape::kSine;
  Rng* rng_ = nullptr;
  /* Used only when Init() is handed no Rng. */
  Rng own_;
};

}  // namespace bellows
