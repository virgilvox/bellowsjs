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
  /* Argument order is (frame, note_id, hz, vel), and it matters: written
   * the other way round this asked for note 50 at 0.9 Hz with velocity 0
   * at frame 0, and a note-off at frame 0 for a note id that was never
   * on. It compiled because float to uint16_t is a legal implicit
   * conversion in a call, and nothing ran it. The same three events are
   * now driven and asserted by CheckKernelSchedule in
   * test/safety/memsafety.cpp, which is what makes them checkable; this
   * sketch is still only a size measurement.
   *
   * Two notes inside one block, 40 frames apart, so the splitter renders
   * three spans rather than one, and a note-off later in the same block
   * for the note id that is actually sounding. */
  kernel.PushNoteOn(0, 50, 55.0f, 0.9f);
  kernel.PushNoteOn(40, 60, 110.0f, 0.7f);
  kernel.PushNoteOff(96, 50);
  kernel.Process(g_l, g_r, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
