/* Size-report sketch for examples/01_OneKick.
 *
 * Compiles the example's actual logic, not a copy of it, so the number in
 * the example's header comment cannot drift away from the truth. */
#include "harness.h"

#include "../../examples/01_OneKick/onekick.h"

static onekick::Voice voice;

extern "C" int main() {
  voice.Init(kSampleRate);
  voice.Trigger(50.0f, 0.9f);
  voice(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
