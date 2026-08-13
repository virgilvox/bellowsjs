/* Size-report sketch for examples/06_FirstSteps.
 *
 * All four rungs constructed and driven, because the point of the example
 * is that they are all in one image. Each is rendered long enough to pass
 * a step boundary so the envelopes and the LFOs are on a reachable path
 * rather than being dead-stripped. */
#include "harness.h"

#include "../../examples/06_FirstSteps/envelope.h"
#include "../../examples/06_FirstSteps/filter.h"
#include "../../examples/06_FirstSteps/motion.h"
#include "../../examples/06_FirstSteps/tone.h"

static firststeps::Tone s1;
static firststeps::Envelope s2;
static firststeps::Filter s3;
static firststeps::Motion s4;

extern "C" int main() {
  s1.Init(kSampleRate);
  s2.Init(kSampleRate);
  s3.Init(kSampleRate);
  s4.Init(kSampleRate);
  /* A beat at 120 bpm is 24000 samples, so 200 blocks crosses one. */
  for (int b = 0; b < 200; ++b) {
    s1(g_l, g_r, 0, kBlock);
    s2(g_l, g_r, 0, kBlock);
    s3(g_l, g_r, 0, kBlock);
    s4(g_l, g_r, 0, kBlock);
  }
  Sink(g_l, g_r, kBlock);
  return 0;
}
