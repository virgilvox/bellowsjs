#include "harness.h"
extern "C" volatile float g_sink;
volatile float g_sink = 0.0f;
float g_l[kBlock];
float g_r[kBlock];

extern "C" volatile int g_shape_sel = 0;
