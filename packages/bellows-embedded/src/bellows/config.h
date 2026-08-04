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

}  // namespace bellows
