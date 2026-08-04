/* Per-module cost: the formant / vowel voice. */
#include "harness.h"
#include "bellows/engines/formant.h"
static bellows::Rng rng;
static bellows::Formant voice;
extern "C" int main() {
  rng.Init("formant");
  bellows::Formant::Params p;
  p.vowel = 2.5f; p.breath = 0.2f; p.vibrato_depth = 0.3f;
  voice.Init(kSampleRate, &rng, p);
  voice.NoteOn(196.0f, 0.9f);
  voice.Process(g_l, g_r, 0, kBlock);
  voice.NoteOff();
  Sink(g_l, g_r, kBlock);
  return 0;
}
