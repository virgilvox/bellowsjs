/* Profile: 8-voice VA polysynth, EQ + 250 ms delay. */
#include "harness.h"
#include "bellows/engines/va.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/eq.h"
#include "bellows/voicepool.h"
static bellows::Rng rng;
static bellows::VoicePool<bellows::Va, 8> poly;
static bellows::StereoDelay<250, 48000> delay;
static bellows::Eq3 eq;
extern "C" int main() {
  rng.Init("poly");
  for (int i = 0; i < 8; ++i) poly.at(i).Init(kSampleRate, &rng);
  delay.Init(kSampleRate); eq.Init(kSampleRate);
  poly.NoteOn(1, 220, 0.9f, 0);
  poly.Process(g_l,g_r,0,kBlock);
  delay.Process(g_l,g_r,0,kBlock); eq.Process(g_l,g_r,0,kBlock);
  Sink(g_l,g_r,kBlock); return 0;
}
