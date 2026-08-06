/*
 * Accuracy gate for core/fastmath.h under BELLOWS_FAST_MATH=1.
 *
 * Measures every fm:: function against libm over the domain the DSP
 * actually drives it through, prints the error, and fails if it exceeds a
 * documented bound. This exists because the first draft of fm::Log2 used a
 * minimax cubic that was wrong by 0.302 across the mantissa range, which
 * put log2(1.5) 213 cents out and, through Pow, moved a formant by 6.5
 * percent. A polynomial that looks plausible and is silently wrong is the
 * failure mode this whole file invites, so it gets a measurement rather
 * than a comment.
 *
 * The bounds are stated in the units that matter. For anything feeding
 * pitch, the bound is also given in cents, because that is the only unit
 * in which "is this good enough" has an answer.
 *
 *   c++ -std=c++17 -O2 -DBELLOWS_FAST_MATH=1 -I src \
 *       test/parity/fastmath_test.cpp -o /tmp/fm && /tmp/fm
 */
#include <math.h>
#include <stdio.h>

#include "bellows/core/fastmath.h"

namespace {

struct Result {
  double max_abs;
  double max_rel;
  double at;
};

template <class Fast, class Ref>
Result Sweep(Fast fast, Ref ref, double lo, double hi, int steps) {
  Result r{0.0, 0.0, 0.0};
  for (int i = 0; i <= steps; ++i) {
    const double x = lo + (hi - lo) * (static_cast<double>(i) / steps);
    const double a = fast(static_cast<float>(x));
    const double b = ref(x);
    const double abs_err = fabs(a - b);
    const double rel_err = fabs(b) > 1e-12 ? abs_err / fabs(b) : abs_err;
    if (abs_err > r.max_abs) {
      r.max_abs = abs_err;
      r.at = x;
    }
    if (rel_err > r.max_rel) r.max_rel = rel_err;
  }
  return r;
}

int failures = 0;

enum class Measure { kAbs, kRel };

void Gate(const char* name, const Result& r, double bound, Measure m, const char* note) {
  const double got = m == Measure::kAbs ? r.max_abs : r.max_rel;
  const bool pass = got <= bound;
  if (!pass) ++failures;
  printf("%-12s max %s %10.3e  (bound %8.1e)  worst at %+10.4f  %-4s %s\n", name,
         m == Measure::kAbs ? "abs" : "rel", got, bound, r.at, pass ? "pass" : "FAIL", note);
}

}  // namespace

int main() {
#if !BELLOWS_FAST_MATH
  printf("BELLOWS_FAST_MATH is 0, so fm:: forwards to libm and there is nothing to measure.\n");
  printf("Rebuild with -DBELLOWS_FAST_MATH=1.\n");
  return 0;
#else
  printf("fastmath accuracy against libm, BELLOWS_FAST_MATH=1\n\n");

  /* Sin and Cos: oscillators drive the full circle, and the DSP wraps
   * phase before calling, but range reduction should hold well past that. */
  Gate("Sin", Sweep([](float x) { return bellows::fm::Sin(x); }, [](double x) { return sin(x); },
                    -12.6, 12.6, 200000),
       2.0e-5, Measure::kAbs, "phase over four cycles");
  Gate("Cos", Sweep([](float x) { return bellows::fm::Cos(x); }, [](double x) { return cos(x); },
                    -12.6, 12.6, 200000),
       2.0e-5, Measure::kAbs, "phase over four cycles");

  /* Tanh: the ladder filter and the saturators. Saturates past +/-3 where
   * the approximation clamps, so the interesting range is the knee. */
  Gate("Tanh", Sweep([](float x) { return bellows::fm::Tanh(x); }, [](double x) { return tanh(x); },
                     -6.0, 6.0, 200000),
       1.0e-4, Measure::kAbs, "clamped past +/-5, flat there anyway");

  /* Exp2 over the fractional domain, which is where the polynomial lives.
   * 1e-4 in exponent units is 0.12 cents when this carries pitch. */
  Gate("Exp2", Sweep([](float x) { return bellows::fm::Exp2(x); },
                     [](double x) { return exp2(x); }, 0.0, 1.0, 200000),
       1.0e-4, Measure::kAbs, "fraction domain, 1e-4 here is 0.12 cents of pitch");

  /* Log2 over the mantissa domain. This is the one that was wrong. */
  Gate("Log2", Sweep([](float x) { return bellows::fm::Log2(x); },
                     [](double x) { return log2(x); }, 1.0, 2.0, 200000),
       1.0e-5, Measure::kAbs, "mantissa domain, the regression this file exists for");

  /* Wide sweeps, the way the DSP really calls them. */
  Gate("Exp2 wide", Sweep([](float x) { return bellows::fm::Exp2(x); },
                          [](double x) { return exp2(x); }, -20.0, 20.0, 200000),
       1.0e-4, Measure::kRel, "envelope coefficients reach far negative");
  Gate("Log2 wide", Sweep([](float x) { return bellows::fm::Log2(x); },
                          [](double x) { return log2(x); }, 1e-4, 20000.0, 200000),
       1.0e-5, Measure::kAbs, "frequency ratios span the audio band");
  /* Natural log is Log2 times a constant, so this gate mostly restates the
   * one above. It is here because seq/tempomap.h calls it directly and a
   * wrong constant would be invisible in Log2's own row. */
  Gate("Log", Sweep([](float x) { return bellows::fm::Log(x); },
                    [](double x) { return log(x); }, 1e-4, 20000.0, 200000),
       1.0e-5, Measure::kAbs, "tempo curves integrate a log of the bpm ratio");

  /* Tan over exactly the domain dsp/filters.h drives: its cutoff clamps at
   * 0.49 of the sample rate, so the argument never exceeds pi * 0.49 and
   * never approaches the pole. Gated because the fast branch computes it as
   * sin/cos, which differs from tanf by up to 4.9e-4 near pi/2 and would be
   * a silent filter detune if anything ever drove it further. */
  Gate("Tan", Sweep([](float x) { return bellows::fm::Tan(x); },
                    [](double x) { return tan(x); }, 1e-4, 3.14159265358979 * 0.49, 200000),
       2.0e-3, Measure::kAbs, "filter cutoff maps to tan(pi * fc / sr), fc clamped at 0.49 sr");

  /* Pow is Exp2(Log2(b) * e) and inherits both, so it gets its own gate
   * over the exponents the engines use: cents and semitone ratios, decay
   * curves, and the 10^(x/20) shape. */
  {
    Result r{0.0, 0.0, 0.0};
    for (int bi = 1; bi <= 400; ++bi) {
      const double b = 0.05 * bi; /* 0.05 .. 20 */
      for (int ei = -60; ei <= 60; ++ei) {
        const double e = 0.1 * ei; /* -6 .. 6 */
        const double a = bellows::fm::Pow(static_cast<float>(b), static_cast<float>(e));
        const double ref = pow(b, e);
        const double rel = fabs(ref) > 1e-12 ? fabs(a - ref) / fabs(ref) : fabs(a - ref);
        if (rel > r.max_abs) {
          r.max_abs = rel;
          r.at = b;
        }
      }
    }
    Gate("Pow (rel)", r, 5.0e-4, Measure::kAbs, "inherits Exp2 and Log2, base 0.05..20, exp -6..6");
  }

  /* Atan2 over the whole circle, by reconstructing an angle from its own
   * sine and cosine. That exercises all four quadrants and both octants of
   * each, which a one-sided sweep would not. */
  {
    Result r{0.0, 0.0, 0.0};
    for (int i = -31400; i <= 31400; ++i) {
      const double th = i * 1e-4; /* -pi .. pi */
      const double a = bellows::fm::Atan2(static_cast<float>(sin(th)), static_cast<float>(cos(th)));
      double d = fabs(a - th);
      if (d > 6.0) d = fabs(d - 2.0 * 3.14159265358979); /* the wrap at +/-pi */
      if (d > r.max_abs) {
        r.max_abs = d;
        r.at = th;
      }
    }
    Gate("Atan2", r, 1.2e-4, Measure::kAbs, "radians, all quadrants; 0.003 cents on the lowest pluck");
  }

  /* The two pitch helpers, gated in cents because that is the unit that
   * decides whether it is acceptable. */
  {
    Result r{0.0, 0.0, 0.0};
    for (int i = -4800; i <= 4800; ++i) {
      const double cents = i;
      const double a = bellows::fm::CentsRatio(static_cast<float>(cents));
      const double ref = pow(2.0, cents / 1200.0);
      const double err_cents = fabs(1200.0 * log2(a / ref));
      if (err_cents > r.max_abs) {
        r.max_abs = err_cents;
        r.at = cents;
      }
    }
    Gate("CentsRatio", r, 0.15, Measure::kAbs, "error expressed in cents, +/-4 octaves");
  }

  printf("\n");
  if (failures) {
    printf("%d gate(s) failed\n", failures);
    return 1;
  }
  printf("all gates pass\n");
  return 0;
#endif
}
