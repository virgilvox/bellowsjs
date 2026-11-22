/* math.h for the WebAssembly build: declarations only. The definitions are musl's libm, linked from
 * Rust's wasm32 compiler-builtins (see tools/wasm/README.md). sqrt, fabs, floor, ceil, trunc and
 * nearbyint compile to single wasm instructions. */
#pragma once
#ifdef __cplusplus
extern "C" {
#endif
#define NAN __builtin_nanf("")
#define INFINITY __builtin_inff()
#define HUGE_VAL __builtin_huge_val()
#define HUGE_VALF __builtin_huge_valf()
#define isnan(x) __builtin_isnan(x)
#define isinf(x) __builtin_isinf(x)
#define isfinite(x) __builtin_isfinite(x)
#define signbit(x) __builtin_signbit(x)
#define M_PI 3.14159265358979323846
#define M_LN2 0.69314718055994530942
#define M_SQRT2 1.41421356237309504880
#define BW_MATH1(n) double n(double); float n##f(float);
#define BW_MATH2(n) double n(double, double); float n##f(float, float);
BW_MATH1(sin) BW_MATH1(cos) BW_MATH1(tan) BW_MATH1(asin) BW_MATH1(acos) BW_MATH1(atan)
BW_MATH1(sinh) BW_MATH1(cosh) BW_MATH1(tanh) BW_MATH1(exp) BW_MATH1(exp2) BW_MATH1(expm1)
BW_MATH1(log) BW_MATH1(log2) BW_MATH1(log10) BW_MATH1(log1p) BW_MATH1(cbrt)
BW_MATH1(round) BW_MATH1(rint) BW_MATH2(atan2) BW_MATH2(pow) BW_MATH2(fmod) BW_MATH2(hypot)
long lround(double); long lroundf(float); long lrint(double); long lrintf(float);
#undef BW_MATH1
#undef BW_MATH2
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline float fabsf(float x) { return __builtin_fabsf(x); }
static inline double floor(double x) { return __builtin_floor(x); }
static inline float floorf(float x) { return __builtin_floorf(x); }
static inline double ceil(double x) { return __builtin_ceil(x); }
static inline float ceilf(float x) { return __builtin_ceilf(x); }
static inline double trunc(double x) { return __builtin_trunc(x); }
static inline float truncf(float x) { return __builtin_truncf(x); }
static inline double copysign(double a, double b) { return __builtin_copysign(a, b); }
static inline float copysignf(float a, float b) { return __builtin_copysignf(a, b); }
static inline double fmin(double a, double b) { return __builtin_fmin(a, b); }
static inline float fminf(float a, float b) { return __builtin_fminf(a, b); }
static inline double fmax(double a, double b) { return __builtin_fmax(a, b); }
static inline float fmaxf(float a, float b) { return __builtin_fmaxf(a, b); }
#ifdef __cplusplus
}
#endif
