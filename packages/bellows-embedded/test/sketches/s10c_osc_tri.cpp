/* One BlepOsc, one shape at the call site: the BLEP table is unreachable.
 *
 * These four exist so the per-call flash figures in docs/HARDWARE.md come
 * out of the size report like every other number in it, rather than out of
 * a scratch file nobody can rerun. */
#include "harness.h"
#include "bellows/dsp/oscillators.h"
static bellows::BlepOsc osc;
extern "C" int main() {
  osc.Init(kSampleRate);
  osc.SetShape(bellows::BlepShape::kSaw);
  osc.SetFreq(220.0f);
  for (int i = 0; i < kBlock; ++i) {
    g_l[i] = osc.ProcessTriangle();
    g_r[i] = g_l[i];
  }
  Sink(g_l, g_r, kBlock);
  return 0;
}
