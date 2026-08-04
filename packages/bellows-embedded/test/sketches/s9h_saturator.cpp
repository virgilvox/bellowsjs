/* Per-module cost: the saturator at JS-parity 4x oversampling.
 * The oversampling factor is a template parameter rather than a runtime
 * field: at <1> the Oversampler, both dry delay lines and both scratch
 * buffers cease to exist rather than sitting unused. */
#include "harness.h"
#include "bellows/fx/saturator.h"
static bellows::Saturator<4, kBlock> sat;
extern "C" int main() {
  bellows::Saturator<4, kBlock>::Params p;
  p.drive = 4.0f; p.curve = bellows::SatCurve::kCheby; p.tone = 0.3f;
  sat.Init(kSampleRate, p);
  sat.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
