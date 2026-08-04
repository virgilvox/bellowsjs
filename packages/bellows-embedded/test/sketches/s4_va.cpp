#include "harness.h"
#include "bellows/engines/va.h"
static bellows::Rng rng;
static bellows::Va va;
extern "C" int main() {
  rng.Init("va");
  va.Init(kSampleRate, &rng);
  va.NoteOn(220.0f, 0.9f);
  va.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
