/* Size-report sketch for examples/20_Instruments.
 *
 * Every patch in the book constructed and driven, which is the honest way
 * to size a patch library: the image a user flashes holds all of them, and
 * the cheapest patch in it is not the number they need.
 *
 * Each is given a note and rendered, so the engines, the chorus, the voice
 * pools and the modal tables are all on a reachable path. `check-header.sh`
 * could not see any of this, because it instantiates nothing. */
#include "harness.h"

#include "../../examples/20_Instruments/acid.h"
#include "../../examples/20_Instruments/bells.h"
#include "../../examples/20_Instruments/choir.h"
#include "../../examples/20_Instruments/clarinet.h"
#include "../../examples/20_Instruments/eightoheight.h"
#include "../../examples/20_Instruments/epiano.h"
#include "../../examples/20_Instruments/glass.h"
#include "../../examples/20_Instruments/guitar.h"
#include "../../examples/20_Instruments/junopad.h"
#include "../../examples/20_Instruments/marimba.h"
#include "../../examples/20_Instruments/westcoast.h"

static bellows::Rng rng;
static player::Player play;

static epiano::Patch p_epiano;
static acid::Patch p_acid;
static junopad::Patch p_junopad;
static westcoast::Patch p_westcoast;
static guitar::Patch p_guitar;
static bells::Patch p_bells;
static marimba::Patch p_marimba;
static glass::Patch p_glass;
static clarinet::Patch p_clarinet;
static choir::Patch p_choir;
static eightoheight::Patch p_808;

extern "C" volatile int g_int;
volatile int g_int = 0;

template <class P>
static void Drive(P& p, float hz) {
  p.Init(kSampleRate, &rng);
  p.NoteOn(0, hz, 0.8f);
  for (int b = 0; b < 8; ++b) p(g_l, g_r, 0, kBlock);
  p.NoteOff(0);
  p(g_l, g_r, 0, kBlock);
}

extern "C" int main() {
  rng.Init("instruments");
  play.Init();

  Drive(p_epiano, 220.0f);
  Drive(p_acid, 110.0f);
  Drive(p_junopad, 220.0f);
  Drive(p_westcoast, 330.0f);
  Drive(p_guitar, 220.0f);
  Drive(p_bells, 440.0f);
  Drive(p_marimba, 440.0f);
  Drive(p_glass, 440.0f);
  Drive(p_clarinet, 220.0f);
  Drive(p_choir, 220.0f);
  Drive(p_808, 0.0f);

  /* Keep the note source reachable: it holds the scale, the tuning and
   * five euclidean patterns, and it is part of what the example costs. */
  g_int = static_cast<int>(play.Hz(play.Chord(1))) + play.Octave() +
          (play.Kick(0) ? 1 : 0) + play.MelodyDegree(0, 0);
  Sink(g_l, g_r, kBlock);
  return 0;
}
