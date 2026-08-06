/* Shared test harness. Each sketch renders one block into a volatile
 * sink so nothing can be optimized away, then returns. No libc startup,
 * no Arduino core: the numbers are the DSP and nothing else. */
#pragma once
#include <stdint.h>

extern "C" volatile float g_sink;

inline void Sink(const float* l, const float* r, int n) {
  float s = 0.0f;
  for (int i = 0; i < n; ++i) s += l[i] + r[i];
  g_sink = s;
}

constexpr float kSampleRate = 48000.0f;
constexpr int kBlock = 128;

extern float g_l[kBlock];
extern float g_r[kBlock];
