/* Profile: everything transcribed. 8 VA + 8 pluck (80 Hz floor) + full
 * kit at 4 each + 250 ms delay + EQ. */
#include "harness.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/va.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/eq.h"
#include "bellows/voicepool.h"
static bellows::Rng rng;
static bellows::VoicePool<bellows::Va, 8> poly;
static bellows::VoicePool<bellows::Pluck<80, 48000>, 8> plucks;
static bellows::VoicePool<bellows::Kick, 4> kick;
static bellows::VoicePool<bellows::Hat, 4> hat;
static bellows::StereoDelay<250, 48000> delay;
static bellows::Eq3 eq;
extern "C" int main() {
  rng.Init("ws");
  for (int i = 0; i < 8; ++i) { poly.at(i).Init(kSampleRate, &rng); plucks.at(i).Init(kSampleRate, &rng); }
  for (int i = 0; i < 4; ++i) { kick.at(i).Init(kSampleRate); hat.at(i).Init(kSampleRate); }
  delay.Init(kSampleRate); eq.Init(kSampleRate);
  poly.NoteOn(1,220,0.9f,0); plucks.NoteOn(2,330,0.9f,0); kick.NoteOn(3,50,0.9f,0); hat.NoteOn(4,300,0.6f,0);
  poly.Process(g_l,g_r,0,kBlock); plucks.Process(g_l,g_r,0,kBlock);
  kick.Process(g_l,g_r,0,kBlock); hat.Process(g_l,g_r,0,kBlock);
  delay.Process(g_l,g_r,0,kBlock); eq.Process(g_l,g_r,0,kBlock);
  Sink(g_l,g_r,kBlock); return 0;
}
