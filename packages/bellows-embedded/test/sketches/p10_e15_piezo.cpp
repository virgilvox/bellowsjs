/* Size-report sketch for examples/15_Piezo.
 *
 * The voicing chain on top of the shared chord patch, so the row shows
 * what the piezo treatment costs over 09_e10_chord rather than in
 * isolation: two cascaded highpasses, a bell and a limiter. */
#define AUDIOSHIELD_MIN_HZ 20
#define AUDIOSHIELD_VOICES 4

#include "harness.h"

#include "../../examples/10_AudioShield/audioshield.h"
#include "../../examples/15_Piezo/piezo.h"

static audioshield::Patch patch;
static piezo::Voiced<audioshield::Patch> voiced(patch);

extern "C" int main() {
  patch.Init(kSampleRate);
  voiced.Init(kSampleRate);
  patch.Strike(0, 0.8f);
  voiced(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
