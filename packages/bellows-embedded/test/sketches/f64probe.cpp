#include "harness.h"
#ifdef USE_DOUBLE
typedef double S;
#else
typedef float S;
#endif
static S state[64];
static S coef[64];
extern "C" int main() {
  for (int k = 0; k < 64; ++k) { coef[k] = (S)k * (S)0.017; state[k] = 0; }
  for (int i = 0; i < kBlock; ++i) {
    S acc = 0;
    for (int k = 0; k < 64; ++k) { state[k] = state[k] * coef[k] + (S)0.5; acc += state[k]; }
    g_l[i] = (float)acc;
  }
  Sink(g_l, g_r, kBlock);
  return 0;
}
