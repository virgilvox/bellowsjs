/* Per-module cost: the modal resonator bank.
 * The strike pulse is evaluated as it is consumed rather than buffered,
 * which is why RAM here is modes and filter state and nothing else. */
#include "harness.h"
#include "bellows/engines/modal.h"
static bellows::Rng rng;
static bellows::Modal voice;
extern "C" int main() {
  rng.Init("modal");
  bellows::Modal::Params p;
  p.material = 2.0f; p.decay = 3.0f; p.strike_hardness = 0.7f;
  voice.Init(kSampleRate, &rng, p);
  voice.NoteOn(330.0f, 0.9f);
  voice.Process(g_l, g_r, 0, kBlock);
  voice.NoteOff();
  Sink(g_l, g_r, kBlock);
  return 0;
}
