/* One BlepOsc driven through the runtime switch, with the shape genuinely
 * unknown at compile time.
 *
 * The volatile is the whole point. Given a constant SetShape the compiler
 * constant-folds Process() down to the one branch and drops the other
 * table, which makes a naive "runtime" sketch measure the same thing as
 * the fixed-shape one. A shape that arrives through volatile storage is
 * what a real program has: a preset, a MIDI byte, a knob. */
#include "harness.h"
#include "bellows/dsp/oscillators.h"
static bellows::BlepOsc osc;
extern "C" volatile int g_shape_sel;
extern "C" int main() {
  osc.Init(kSampleRate);
  osc.SetShape(static_cast<bellows::BlepShape>(g_shape_sel));
  osc.SetFreq(220.0f);
  for (int i = 0; i < kBlock; ++i) {
    g_l[i] = osc.Process();
    g_r[i] = g_l[i];
  }
  Sink(g_l, g_r, kBlock);
  return 0;
}
