/* Size-report sketch for examples/04_ScalesAndTuning.
 *
 * Renders both passes of the phrase, so the 12-EDO and 19-EDO paths and
 * the whole theory layer this example reaches are all linked in. */
#include "harness.h"

#include "../../examples/04_ScalesAndTuning/scalestuning.h"

static scalestuning::Player player;

extern "C" int main() {
  player.Init(kSampleRate, 96);
  /* Long enough that the phrase completes and flips tuning at least once. */
  for (int b = 0; b < 256; ++b) player(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
