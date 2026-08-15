/* Size-report sketch for examples/21_Presets.
 *
 * The whole preset table, selected one row at a time and rendered, which
 * is the only honest way to size it. The image a user flashes holds all
 * eleven engines, their eleven param tables and the three shared inserts,
 * and the cheapest preset in the book is not the number they need. That is
 * the argument presets.h makes in its header comment, so this file is what
 * makes it checkable: select every preset, so `--gc-sections` can drop
 * nothing, and report what that costs.
 *
 * Unlike p14 and p15 this includes the example's real logic header, so the
 * number comes from the code the reader is reading.
 *
 * The bars are short on purpose. Every preset gets one Select and a few
 * blocks, which is enough to put its Load, its params row and its insert
 * on a reachable path; playing four full bars each would be 200 times the
 * host compile time and the same symbol set.
 */
#include "harness.h"

#include "../../examples/21_Presets/presets.h"

static presets::Tour tour;

extern "C" volatile int g_int;
volatile int g_int = 0;

extern "C" int main() {
  tour.Init(kSampleRate, 96);

  int reached = 0;
  for (int i = 0; i < bellows::kInstrumentPresetCount; ++i) {
    tour.Select(i);
    /* Enough blocks to cross a step boundary at 96 bpm, so the sequencer,
     * the scale, the tuning and the note path are all reached and not just
     * the voice construction. A sixteenth at 96 bpm is 750 samples. */
    for (int b = 0; b < 8; ++b) tour(g_l, g_r, 0, kBlock);
    if (tour.Loaded()) ++reached;
  }

  /* Loaded() and PlateReady() exist to be checked on a board, and Current()
   * is what the sketch prints. Keep all three reachable rather than letting
   * the linker decide the reporting path is dead. */
  g_int = reached + (tour.PlateReady() ? 1 : 0) + tour.Selected() + tour.Bar() +
          static_cast<int>(tour.Current().engine);
  Sink(g_l, g_r, kBlock);
  return 0;
}
