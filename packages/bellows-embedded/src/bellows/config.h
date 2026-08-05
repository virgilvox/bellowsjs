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
inline constexpr float kPhaseScale = 4294967296.0f;          /* 2^32 */

/*
 * Cycles per sample to a phase increment.
 *
 * All of this is single precision on purpose. An earlier revision computed
 * it in double on the grounds that a setter is not the audio path, which
 * was wrong twice over: engines/formant.h calls SetFreq once per sample to
 * apply vibrato, so it IS the audio path there; and on a single-precision
 * part the double pulled in soft-float, costing 2560 bytes of flash on the
 * modfx sketch for Cortex-M4 against 208 for Cortex-M7. The double bought
 * nothing anyway. Multiplying a float by 2^32 only moves the exponent, so
 * the product is exact, and adding 0.5 rounds where a fractional part can
 * still exist (below 2^24) and is a harmless no-op above it, where the
 * product is already an even integer.
 */
inline uint32_t PhaseIncrement(float cycles_per_sample) {
  if (!(cycles_per_sample > 0.0f)) return 0u;
  /* 0.5 cycles per sample is Nyquist and every caller clamps there, so the
   * increment cannot exceed 2^31. Saturating at 0xFFFFFFFF would be the one
   * value the wrap detector cannot see, because adding it can never carry. */
  const float clamped = cycles_per_sample > 0.5f ? 0.5f : cycles_per_sample;
  return static_cast<uint32_t>(clamped * kPhaseScale + 0.5f);
}

/*
 * A cycle position to a phase counter, mirroring the JS phase - floor(phase).
 *
 * A tiny negative input rounds its fraction up to exactly 1.0f, and the
 * guard sends that to 0. That is the right answer rather than a lost case:
 * the counter is modulo one cycle, so a whole cycle and none of one are the
 * same position, and the two differ by less than the counter can represent.
 */
inline uint32_t PhaseFromCycles(float phase) {
  const float frac = phase - floorf(phase);
  if (!(frac > 0.0f) || frac >= 1.0f) return 0u;
  return static_cast<uint32_t>(frac * kPhaseScale);
}

}  // namespace bellows
