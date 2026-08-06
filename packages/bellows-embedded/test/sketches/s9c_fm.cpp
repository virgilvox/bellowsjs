/* Per-module cost: the 6-operator FM voice.
 * Uses SineOsc only, so it never reaches the BLEP residual tables. That
 * is rule 7 visible as a number: compare against s9e_westcoast. */
#include "harness.h"
#include "bellows/engines/fm.h"
static bellows::Fm voice;
extern "C" int main() {
  bellows::Fm::Params p;
  p.ops = 6.0f; p.algorithm = 3.0f; p.feedback = 0.4f;
  voice.Init(kSampleRate, p);
  voice.NoteOn(220.0f, 0.85f);
  voice.Process(g_l, g_r, 0, kBlock);
  voice.NoteOff();
  Sink(g_l, g_r, kBlock);
  return 0;
}
