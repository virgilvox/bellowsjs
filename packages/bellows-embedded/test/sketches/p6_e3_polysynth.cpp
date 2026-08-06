/* Size-report sketch for examples/03_PolySynth.
 *
 * Eight voices held at once so the pool is fully occupied and the steal
 * path is reachable, then rendered long enough for the LFO to move. */
#include "harness.h"

#include "../../examples/03_PolySynth/polysynth.h"

static polysynth::Synth synth;

static const int kChord[] = {45, 52, 57, 60, 64, 67, 71, 76};

extern "C" int main() {
  synth.Init(kSampleRate);
  for (int i = 0; i < 8; ++i) {
    /* 12-EDO by hand: the tuning layer is example 04's subject. */
    float hz = 440.0f * bellows::fm::Exp2((static_cast<float>(kChord[i]) - 69.0f) / 12.0f);
    synth.NoteOn(kChord[i], hz, 0.7f);
  }
  for (int b = 0; b < 16; ++b) synth(g_l, g_r, 0, kBlock);
  for (int i = 0; i < 8; ++i) synth.NoteOff(kChord[i]);
  synth(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
