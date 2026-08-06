/* Per-module cost: the waveguide tube voice, sized for its lowest note.
 * Tube<80> reaches down to 80 Hz and so needs a 2 KB bore; Tube<20> is
 * 8 KB. The template parameter is the whole memory story, exactly as in
 * pluck.h, which is what rule 4 asks for. */
#include "harness.h"
#include "bellows/engines/tube.h"
static bellows::Rng rng;
static bellows::Tube<80> voice;
extern "C" int main() {
  rng.Init("tube");
  bellows::Tube<80>::Params p;
  p.breath = 0.5f;
  voice.Init(kSampleRate, &rng, p);
  voice.NoteOn(220.0f, 0.85f);
  voice.Process(g_l, g_r, 0, kBlock);
  voice.Glide(330.0f);              /* true legato retune, no retrigger */
  voice.Process(g_l, g_r, 0, kBlock);
  voice.NoteOff();
  Sink(g_l, g_r, kBlock);
  return 0;
}
