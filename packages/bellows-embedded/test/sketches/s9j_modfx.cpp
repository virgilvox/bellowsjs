/* Per-module cost: the five modulation effects.
 * modfx.h deliberately does not include dsp/oscillators.h for RingMod's
 * carrier, so a tremolo-only sketch never pays for the BLEP tables. */
#include "harness.h"
#include "bellows/fx/modfx.h"
static bellows::Chorus<48000> chorus;
static bellows::Flanger<48000> flanger;
static bellows::Tremolo trem;
static bellows::AutoPan pan;
static bellows::RingMod ring;
extern "C" int main() {
  chorus.Init(kSampleRate); flanger.Init(kSampleRate);
  trem.Init(kSampleRate); pan.Init(kSampleRate); ring.Init(kSampleRate);
  chorus.Process(g_l, g_r, 0, kBlock);
  flanger.Process(g_l, g_r, 0, kBlock);
  trem.Process(g_l, g_r, 0, kBlock);
  pan.Process(g_l, g_r, 0, kBlock);
  ring.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
