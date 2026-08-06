/* Size-report sketch for examples/05_MidiInstrument.
 *
 * Drives the instrument through real MIDI byte sequences so the parser,
 * the pool and the bend and CC paths are all reachable. */
#include "harness.h"

#include "../../examples/05_MidiInstrument/midiinstrument.h"

static midiinstrument::Instrument instrument;

/* Note on, note on, pitch bend up, CC74, note off, all notes off. */
static const uint8_t kStream[] = {
    0x90, 60, 100,   /* note on  C4  */
    0x90, 64, 90,    /* note on  E4  */
    0x90, 67, 80,    /* note on  G4  */
    0xe0, 0x00, 0x50, /* pitch bend  */
    0xb0, 74, 96,    /* CC74 brightness */
    0x80, 60, 0,     /* note off C4 */
    0x90, 64, 0,     /* note on velocity 0, which is a note off */
    0xb0, 123, 0,    /* all notes off */
};

extern "C" int main() {
  instrument.Init(kSampleRate);
  for (unsigned i = 0; i + 2 < sizeof(kStream); i += 3) {
    instrument.HandleBytes(&kStream[i], 3);
    instrument(g_l, g_r, 0, kBlock);
  }
  Sink(g_l, g_r, kBlock);
  return 0;
}
