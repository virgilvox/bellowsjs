/* Per-module cost: the Dattorro figure-eight plate reverb.
 * RAM here is the tank, and the tank is why PlateExt exists: at 48 kHz
 * with 250 ms of predelay the owning form is 264 KB, which does not fit
 * Daisy's DTCM. This uses the 50 ms configuration, the practical owning
 * size on a Teensy 4.1. For anything larger, hand PlateExt a buffer in
 * EXTMEM or DSY_SDRAM_BSS. */
#include "harness.h"
#include "bellows/fx/plate.h"
static bellows::Plate<48000, 50> plate;
extern "C" int main() {
  bellows::Plate<48000, 50>::Params p;
  p.decay = 0.85f; p.damping = 0.4f; p.mix = 0.4f;
  if (!plate.Init(kSampleRate, p)) return 1;
  plate.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
