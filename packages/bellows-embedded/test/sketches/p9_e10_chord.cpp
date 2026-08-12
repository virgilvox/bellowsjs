/* Size-report sketch for the patch shared by examples 10 through 15.
 *
 * Pinned to the four-voice, 20 Hz configuration, which is what a Teensy
 * 4.x or 3.5/3.6 sketch compiles. The header picks that from board macros
 * that a freestanding build does not define, so without these two defines
 * this would silently measure the two-voice small-board patch and report a
 * number no example on the big boards ever pays. */
#define AUDIOSHIELD_MIN_HZ 20
#define AUDIOSHIELD_VOICES 4

#include "harness.h"

#include "../../examples/10_AudioShield/audioshield.h"

static audioshield::Patch patch;

extern "C" int main() {
  patch.Init(kSampleRate);
  patch.Strike(0, 0.8f);
  patch(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
