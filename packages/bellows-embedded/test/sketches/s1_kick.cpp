#include "harness.h"
#include "bellows/engines/drums.h"
static bellows::Kick kick;
extern "C" int main() {
  kick.Init(kSampleRate);
  kick.NoteOn(50.0f, 0.9f);
  kick.Process(g_l, g_r, 0, kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
