/* Per-module cost: compressor, limiter and gate together.
 * The limiter's true-peak detector is a template parameter and is off
 * here; turning it on adds about 6 KB of oversampler scratch. */
#include "harness.h"
#include "bellows/fx/dynamics.h"
static bellows::Compressor<10, 48000> comp;
static bellows::Limiter<48000, false, kBlock> lim;
static bellows::Gate gate;
extern "C" int main() {
  bellows::Compressor<10, 48000>::Params cp;
  cp.threshold_db = -20.0f; cp.ratio = 6.0f; cp.lookahead = 0.005f;
  comp.Init(kSampleRate, cp);
  lim.Init(kSampleRate);
  gate.Init(kSampleRate);
  gate.Process(g_l, g_r, 0, kBlock);
  comp.Process(g_l, g_r, 0, kBlock);
  lim.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
