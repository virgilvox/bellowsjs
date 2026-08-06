#include "harness.h"
#include "bellows/engines/drums.h"
static bellows::Rng rng;
static bellows::Kick kick;
static bellows::Snare snare;
static bellows::Hat hat;
extern "C" int main() {
  rng.Init("kit");
  kick.Init(kSampleRate);
  snare.Init(kSampleRate, &rng);
  hat.Init(kSampleRate);
  kick.NoteOn(50.0f, 0.9f); snare.NoteOn(180.0f, 0.8f); hat.NoteOn(300.0f, 0.6f);
  kick.Process(g_l, g_r, 0, kBlock);
  snare.Process(g_l, g_r, 0, kBlock);
  hat.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
