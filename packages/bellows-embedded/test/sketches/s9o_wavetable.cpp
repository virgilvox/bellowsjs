/* One wavetable voice. Most of what this reports is the mipmap in flash,
 * which is the point: the table is 65536 bytes at the shipped length of 512
 * points and 327680 at the 2048 the TypeScript uses. See the note at the
 * top of bellows/engines/wavetable.h for the measured cost of each. */
#include "harness.h"
#include "bellows/engines/wavetable.h"
static bellows::Wavetable wt;
extern "C" int main() {
  wt.Init(kSampleRate);
  wt.NoteOn(220.0f, 0.9f);
  wt.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
