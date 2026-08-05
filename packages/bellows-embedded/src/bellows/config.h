/*
 * Build-time configuration.
 *
 * Every option has a safe default, so a sketch that sets nothing gets
 * behaviour matching the TypeScript library. Override with -D flags
 * (PlatformIO build_flags) or by defining before including any bellows
 * header.
 *
 * BELLOWS_FAST_MATH
 *   0 (default) uses libm sinf/cosf/tanhf/expf/powf.
 *   1 uses the polynomial approximations in core/fastmath.h. Measured on
 *   Cortex-M7: the five libm calls pull in 5056 bytes of flash, the
 *   polynomials 196 bytes, and the polynomials are several times faster.
 *   Costs accuracy, so renders stop matching the JS bit for bit. Turn it
 *   on when flash or cycles are tight and the sound is what matters.
 *
 * BELLOWS_SAMPLE_RATE
 *   Default rate used by the template defaults that need to size buffers
 *   at compile time (delay lines, pluck loops). Runtime Init() still takes
 *   the real rate; this only sizes storage.
 *
 * BELLOWS_BLOCK_SIZE
 *   Default block length for the kernel. 128 matches the AudioWorklet
 *   quantum and the Teensy Audio Library block.
 */
#pragma once

#include <math.h>
#include <stdint.h>

#ifndef BELLOWS_FAST_MATH
#define BELLOWS_FAST_MATH 0
#endif

#ifndef BELLOWS_SAMPLE_RATE
#define BELLOWS_SAMPLE_RATE 48000
#endif

#ifndef BELLOWS_BLOCK_SIZE
#define BELLOWS_BLOCK_SIZE 128
#endif

namespace bellows {

inline constexpr float kPi = 3.14159265358979f;
inline constexpr float kTwoPi = 6.28318530717959f;
inline constexpr float kSqrtHalf = 0.70710678118655f;
/* ln 3: the Adsr attack curve crosses 1.0 at exactly the attack time. */
inline constexpr float kLn3 = 1.09861228866811f;
/* ln 100: decay and release cover 99 percent of their span in the set time. */
inline constexpr float kLn100 = 4.60517018598809f;
/* ln 1000: ExpDecay covers 60 dB in the set time. */
inline constexpr float kLn1000 = 6.90775527898214f;

/* Branch-free clamp used everywhere in place of the JS clamp(). */
inline constexpr float Clamp(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

inline constexpr int ClampI(int v, int lo, int hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/*
 * Fixed point phase, for anything that accumulates a position in a cycle.
 *
 * A float accumulator loses part of every increment to rounding as it
 * approaches 1.0, and the loss is systematic rather than random, so the
 * error grows with the length of the note instead of averaging out. The
 * TypeScript accumulates in double, where the same rounding is about 2^29
 * times smaller, so a float accumulator here reads as a slow timing
 * divergence from the reference rather than as anything wrong on its own.
 * Measured, that was the whole of the chorus parity gap: 4e-2 with the
 * modulation running against 6.3e-6 with it switched off.
 *
 * A uint32 counter over one cycle removes it. The wrap is the natural
 * unsigned overflow, so it costs neither a compare nor a branch, the
 * increment is exact for the life of the note, and the only residual
 * against the double reference is the one-time rounding of the increment,
 * which is half of 2^-32 of a cycle.
 */
inline constexpr float kPhaseToUnit = 2.32830643653870e-10f; /* 1 / 2^32 */
inline constexpr double kPhaseScale = 4294967296.0;          /* 2^32 */

/*
 * Cycles per sample to a phase increment. Computes in double because it
 * runs from a setter and never from the audio path, so the cost does not
 * reach an inner loop even on a single precision part, and because
 * rounding rather than truncating halves the residual bias.
 */
inline uint32_t PhaseIncrement(double cycles_per_sample) {
  if (!(cycles_per_sample > 0.0)) return 0u;
  const double scaled = cycles_per_sample * kPhaseScale + 0.5;
  return scaled >= kPhaseScale ? 0xFFFFFFFFu : static_cast<uint32_t>(scaled);
}

/*
 * A cycle position to a phase counter, mirroring the JS phase - floor(phase).
 * The guard catches a tiny negative input whose fraction rounds up to a
 * whole cycle, which would otherwise convert out of range.
 */
inline uint32_t PhaseFromCycles(float phase) {
  const float frac = phase - floorf(phase);
  if (!(frac > 0.0f) || frac >= 1.0f) return 0u;
  return static_cast<uint32_t>(static_cast<double>(frac) * kPhaseScale);
}

}  // namespace bellows
