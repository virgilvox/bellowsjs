/* Profile: 808-style kit, 4 voices per pad, EQ + 250 ms delay. */
#include "harness.h"
#include "bellows/engines/drums.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/eq.h"
#include "bellows/voicepool.h"
static bellows::Rng rng;
static bellows::VoicePool<bellows::Kick, 4> kick;
static bellows::VoicePool<bellows::Hat, 4> hat;
static bellows::StereoDelay<250, 48000> delay;
static bellows::Eq3 eq;
extern "C" int main() {
  rng.Init("drums");
  for (int i = 0; i < 4; ++i) { kick.at(i).Init(kSampleRate); hat.at(i).Init(kSampleRate); }
  delay.Init(kSampleRate); eq.Init(kSampleRate);
  kick.NoteOn(1, 50, 0.9f, 0); hat.NoteOn(2, 300, 0.6f, 0);
  kick.Process(g_l,g_r,0,kBlock); hat.Process(g_l,g_r,0,kBlock);
  delay.Process(g_l,g_r,0,kBlock); eq.Process(g_l,g_r,0,kBlock);
  Sink(g_l,g_r,kBlock); return 0;
}
