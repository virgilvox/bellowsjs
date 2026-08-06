/* Size-report sketch for examples/02_DrumMachine.
 *
 * Renders enough blocks that the sequencer actually fires every pad, so
 * none of the three engines is stripped as unreachable. */
#include "harness.h"

#include "../../examples/02_DrumMachine/drummachine.h"

static drummachine::Machine machine;

extern "C" int main() {
  machine.Init(kSampleRate, 120);
  for (int b = 0; b < 64; ++b) machine(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
