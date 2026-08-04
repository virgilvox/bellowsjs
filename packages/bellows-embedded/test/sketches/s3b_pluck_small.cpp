#include "harness.h"
#include "bellows/engines/pluck.h"
static bellows::Rng rng;
static bellows::Pluck<80, 48000> pluck;   // 80 Hz floor instead of 20
extern "C" int main() {
  rng.Init("pluck");
  pluck.Init(kSampleRate, &rng);
  pluck.NoteOn(220.0f, 0.9f);
  pluck.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
