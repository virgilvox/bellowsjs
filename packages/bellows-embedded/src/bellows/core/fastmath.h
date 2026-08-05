/*
 * Transcendental approximations, selected by BELLOWS_FAST_MATH.
 *
 * The bellows DSP calls sin, cos, tanh, exp and pow through this header
 * rather than <math.h> directly, so one flag switches the whole library
 * between exact libm and cheap polynomials.
 *
 * Measured on Cortex-M7 with newlib, one call site each for
 * sinf/cosf/tanhf/powf/expf: libm 5056 bytes of flash, these 196 bytes.
 * newlib's sinf also drags in __kernel_rem_pio2f and the soft double
 * helpers, which is most of that difference.
 *
 * Accuracy over the ranges the DSP actually drives, MEASURED against libm
 * by test/parity/fastmath_test.cpp rather than asserted here:
 *
 *   Sin, Cos     3.6e-6 absolute      (four cycles of phase)
 *   Tanh         9.6e-5 absolute      (clamped past |x| = 5)
 *   Exp2         1.7e-5 absolute      over the fraction, 8.8e-6 relative wide
 *   Log2         1.9e-6 absolute      over the mantissa
 *   Pow          1.4e-5 relative      base 0.05 to 20, exponent -6 to 6
 *   CentsRatio   0.015 cents          across four octaves
 *
 * Those numbers are the gate, and the gate is checked in CI. An earlier
 * draft of this file shipped a minimax cubic for Log2 that was wrong by
 * 0.302, putting log2(1.5) 213 cents out and, through Pow, moving a
 * formant frequency by 6.5 percent. Nothing caught it, because a wrong
 * polynomial still compiles, still runs fast, and still produces sound.
 * If you change an approximation here, run the gate.
 */
#pragma once
#include <math.h>

#include "bellows/config.h"

namespace bellows {
namespace fm {

#if BELLOWS_FAST_MATH

/* Sine. Wrap to [-pi, pi), fold the outer quadrants into [-pi/2, pi/2]
 * (exact for sine, since sin(pi - x) = sin(x)), then a degree 9 odd
 * Taylor polynomial. The first dropped term at the endpoint is
 * (pi/2)^11 / 11! = 3.7e-6.
 *
 * A Bhaskara quadratic pair with one refinement pass was tried first: it
 * is cheaper but lands at 1.1e-3, which is only 59 dB below full scale.
 * That is fine for an LFO and not fine for an FM carrier, and this file
 * feeds both, so it pays for the extra three multiply-adds. */
inline float SinPi(float x) {
  const float inv2pi = 0.15915494309189535f;
  float k = x * inv2pi;
  k -= floorf(k + 0.5f);
  x = k * kTwoPi; /* now in [-pi, pi) */
  const float half_pi = 1.57079632679490f;
  if (x > half_pi) x = kPi - x;
  else if (x < -half_pi) x = -kPi - x;
  const float x2 = x * x;
  return x * (1.0f +
              x2 * (-0.166666666666667f +
                    x2 * (0.00833333333333333f +
                          x2 * (-0.000198412698412698f + x2 * 2.75573192239859e-6f))));
}

inline float Sin(float x) { return SinPi(x); }
inline float Cos(float x) { return SinPi(x + 1.57079632679490f); }

/* Pade 7/6 tanh. A Pade 3/2 was tried first and peaks at 2.4e-2 error
 * around |x| = 1.6, right in the knee where a ladder filter spends its
 * time, so it changed the sound of resonance rather than just rounding
 * it. This form holds about 1e-5 out to |x| = 4. Past 5 the function is
 * flat to within 1e-4 of the limit, so it clamps. */
inline float Tanh(float x) {
  if (x < -5.0f) return -1.0f;
  if (x > 5.0f) return 1.0f;
  const float x2 = x * x;
  const float num = x * (135135.0f + x2 * (17325.0f + x2 * (378.0f + x2)));
  const float den = 135135.0f + x2 * (62370.0f + x2 * (3150.0f + x2 * 28.0f));
  const float y = num / den;
  return y < -1.0f ? -1.0f : (y > 1.0f ? 1.0f : y);
}

/* 2^x by splitting into integer and fractional parts: the integer part is
 * an exponent-field add, the fraction a truncated Taylor series in f,
 * whose coefficients are (ln 2)^k / k!. Degree 6, so the first dropped
 * term is (ln 2)^7 / 5040 = 1.5e-5, which is 0.02 cents when this is used
 * for pitch. Degree 4 was tried first and is 1.5e-3, about 1.8 cents:
 * audible on a tuning, so the extra two multiply-adds are worth it. */
inline float Exp2(float x) {
  if (x < -126.0f) return 0.0f;
  if (x > 126.0f) return 3.4e38f;
  float xi = floorf(x);
  float f = x - xi;
  float p =
      1.0f +
      f * (0.693147180559945f +
           f * (0.240226506959101f +
                f * (0.0555041086648216f +
                     f * (0.00961812910762848f +
                          f * (0.00133335581464284f + f * 0.000154035303933816f)))));
  union {
    float f;
    int32_t i;
  } u;
  u.i = static_cast<int32_t>((static_cast<int>(xi) + 127) << 23);
  return p * u.f;
}

inline float Exp(float x) { return Exp2(x * 1.44269504088896f); }

/* log2(x): the exponent field gives the integer part exactly, and the
 * mantissa goes through the atanh series
 *
 *   log2(m) = (2 / ln 2) * (t + t^3/3 + t^5/5 + ...),  t = (m - 1)/(m + 1)
 *
 * For m in [1, 2) the argument t stays inside [0, 1/3], so the series
 * converges fast: truncating after t^9 leaves about 2e-6, which is
 * 0.002 cents.
 *
 * A minimax cubic in m was tried first and was badly wrong: 0.302 absolute
 * error at the top of the mantissa range, log2(1.5) returning 0.407 instead
 * of 0.585, a 213 cent pitch error. Worse, Pow is Exp2(Log2(b) * e), so
 * every Pow call inherited it, which moved a formant by 6.5 percent and a
 * modal strike duration by 8 percent. Hence the series and hence
 * fastmath_test.cpp, which measures every function in this file against
 * libm and fails on regression. */
inline float Log2(float x) {
  if (x <= 0.0f) return -126.0f;
  union {
    float f;
    int32_t i;
  } u;
  u.f = x;
  float e = static_cast<float>(((u.i >> 23) & 0xff) - 127);
  u.i = (u.i & 0x007fffff) | 0x3f800000; /* mantissa in [1, 2) */
  float m = u.f;
  float t = (m - 1.0f) / (m + 1.0f);
  float t2 = t * t;
  float s =
      t * (1.0f +
           t2 * (0.333333333333333f +
                 t2 * (0.2f + t2 * (0.142857142857143f + t2 * 0.111111111111111f))));
  return e + 2.885390081777927f * s;
}

inline float Pow(float base, float e) { return Exp2(Log2(base) * e); }
/* Natural log rides on Log2, so it inherits that gate and adds only a
 * multiply. The libm branch below keeps logf rather than doing the same,
 * because at BELLOWS_FAST_MATH=0 every call site has to land on exactly the
 * bits libm would have produced. */
inline float Log(float x) { return Log2(x) * 0.693147180559945f; }
/* tan as sin/cos. Safe here only because every caller stays away from the
 * pole: dsp/filters.h clamps its cutoff to 0.49 of the sample rate, so the
 * argument tops out at 1.539 and cos never gets closer to zero than 0.031. */
inline float Tan(float x) {
  float c = Cos(x);
  return c == 0.0f ? 1e9f : Sin(x) / c;
}
/* atan2 by the standard octant reduction plus a cubic in the ratio of the
 * smaller magnitude to the larger, which is the Hastings form:
 *
 *   atan(z) = z * (c1 + z2 (c3 + z2 (c5 + z2 (c7 + z2 c9)))),  z in [0, 1]
 *
 * about 1e-7 radians over the whole circle. The obvious cheaper choice, the
 * Hastings cubic z (pi/4 - (z-1)(0.2447 + 0.0663 z)), measures 1.5e-3 and
 * is NOT good enough here, which the gate caught. engines/pluck.h divides
 * the result by w = 2 pi f / sr to turn the loop filter's phase shift into
 * a fractional delay length, so the angular error is amplified by 1/w: at a
 * 20 Hz fundamental 1.5e-3 radians becomes 0.58 samples of loop length,
 * which is an audible detune on the lowest notes. The odd polynomial costs
 * four more multiply-adds and measures 1.2e-5 radians, worst at the octant
 * boundary. Through the same 1/w that is 0.003 cents on a 20 Hz pluck,
 * against the 0.15 cents CentsRatio is allowed. It earns its place on
 * size:
 * newlib's atan2f drags in __ieee754_atan2f and atanf for 764 bytes, and
 * with BELLOWS_FAST_MATH=1 it was the last libm symbol left in a pluck. */
inline float Atan2(float y, float x) {
  const float ax = x < 0.0f ? -x : x;
  const float ay = y < 0.0f ? -y : y;
  if (ax == 0.0f && ay == 0.0f) return 0.0f;
  const float hi = ax > ay ? ax : ay;
  const float lo = ax > ay ? ay : ax;
  const float z = lo / hi;
  const float z2 = z * z;
  float a =
      z * (0.999866f +
           z2 * (-0.330299f + z2 * (0.180141f + z2 * (-0.085133f + z2 * 0.0208351f))));
  if (ay > ax) a = 1.57079632679490f - a;
  if (x < 0.0f) a = 3.14159265358979f - a;
  return y < 0.0f ? -a : a;
}
inline float Sqrt(float x) { return sqrtf(x); } /* single instruction on any FPU */

#else

inline float Sin(float x) { return sinf(x); }
inline float Cos(float x) { return cosf(x); }
inline float Tanh(float x) { return tanhf(x); }
inline float Exp(float x) { return expf(x); }
inline float Exp2(float x) { return exp2f(x); }
inline float Log2(float x) { return log2f(x); }
inline float Pow(float base, float e) { return powf(base, e); }
inline float Log(float x) { return logf(x); }
inline float Tan(float x) { return tanf(x); }
inline float Atan2(float y, float x) { return atan2f(y, x); }
inline float Sqrt(float x) { return sqrtf(x); }

#endif

/* Semitone and cent ratios, the two conversions the engines do most. */
inline float CentsRatio(float cents) { return Exp2(cents * (1.0f / 1200.0f)); }
inline float SemisRatio(float semis) { return Exp2(semis * (1.0f / 12.0f)); }

/* Decibel conversions, matching dbToGain/gainToDb in the JS. */
inline float DbToGain(float db) { return Exp2(db * (1.0f / 6.020599913279624f)); }

}  // namespace fm
}  // namespace bellows
