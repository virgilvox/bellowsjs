#include "harness.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/va.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/eq.h"
static bellows::Rng rng;
static bellows::Kick kick;
static bellows::Snare snare;
static bellows::Hat hat;
static bellows::Pluck<20, 48000> pluck;
static bellows::Va va;
static bellows::StereoDelay<500, 48000> delay;
static bellows::Eq3 eq;
extern "C" int main() {
  rng.Init("all");
  kick.Init(kSampleRate); snare.Init(kSampleRate, &rng); hat.Init(kSampleRate);
  pluck.Init(kSampleRate, &rng); va.Init(kSampleRate, &rng);
  delay.Init(kSampleRate); eq.Init(kSampleRate);
  kick.NoteOn(50,0.9f); snare.NoteOn(180,0.8f); hat.NoteOn(300,0.6f);
  pluck.NoteOn(220,0.9f); va.NoteOn(330,0.9f);
  kick.Process(g_l,g_r,0,kBlock); snare.Process(g_l,g_r,0,kBlock); hat.Process(g_l,g_r,0,kBlock);
  pluck.Process(g_l,g_r,0,kBlock); va.Process(g_l,g_r,0,kBlock);
  delay.Process(g_l,g_r,0,kBlock); eq.Process(g_l,g_r,0,kBlock);
  Sink(g_l, g_r, kBlock);
  return 0;
}
