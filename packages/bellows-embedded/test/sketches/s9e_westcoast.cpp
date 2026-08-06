/* Per-module cost: the west coast fold-and-LPG voice.
 * Large because BlepOsc drags in the 16 KB Kaiser-sinc BLEP tables. */
#include "harness.h"
#include "bellows/engines/westcoast.h"
static bellows::WestCoast voice;
extern "C" int main() {
  bellows::WestCoast::Params p;
  p.fold_amount = 0.6f; p.fold_stages = 3.0f; p.lpg_decay = 0.8f;
  voice.Init(kSampleRate, p);
  voice.NoteOn(110.0f, 0.9f);
  voice.Process(g_l, g_r, 0, kBlock);
  voice.NoteOff();
  Sink(g_l, g_r, kBlock);
  return 0;
}
