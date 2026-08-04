/* Per-module cost: the event-scheduling kernel over a voice pool.
 * The kernel's job is the block-splitting loop: render up to the next
 * event frame, apply the event, render on, so a note lands on the exact
 * sample. Events carry uint32 frames rather than float seconds, because
 * a float second stops resolving single samples at 48 kHz after about
 * 87 seconds of uptime. */
#include "harness.h"
#include "bellows/engines/drums.h"
#include "bellows/kernel.h"
static bellows::Kernel<bellows::Kick, 4, 32, 4> kernel;
extern "C" int main() {
  kernel.Init(kSampleRate);
  kernel.InitVoices(kSampleRate);
  /* Two notes inside one block, so the splitter actually splits. */
  kernel.PushNoteOn(0, 50.0f, 0.9f, 0);
  kernel.PushNoteOn(1, 60.0f, 0.7f, 64);
  kernel.PushNoteOff(0, 96);
  kernel.Process(g_l, g_r, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
