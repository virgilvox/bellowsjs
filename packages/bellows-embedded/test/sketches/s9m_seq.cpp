/* Per-module cost: the generative sequencing layer.
 * Euclid stores its pattern as a bitmask, the CA computes a generation in
 * place with no scratch row, and the L-system borrows its rule strings by
 * pointer so literals stay in flash. None of it allocates. */
#include "harness.h"
#include "bellows/seq/arp.h"
#include "bellows/seq/automata.h"
#include "bellows/seq/euclid.h"
#include "bellows/seq/lsystem.h"
#include "bellows/seq/tempomap.h"
static bellows::Rng rng;
static bellows::Euclid<16> euclid;
static bellows::Arp<16> arp;
static bellows::ElementaryCa<32> ca;
static bellows::LSystem<128, 8> lsys;
static bellows::TempoMap<8> tempo;
extern "C" volatile int g_int;
volatile int g_int = 0;
extern "C" int main() {
  rng.Init("seq");
  euclid.Generate(5, 16, 2);
  int hits = 0;
  for (int i = 0; i < 16; ++i) hits += euclid.Process() ? 1 : 0;

  float notes[3] = {60.0f, 64.0f, 67.0f};
  arp.Init();
  arp.SetNotes(notes, 3);
  float first = arp.Next(rng);

  ca.Init(30);
  uint8_t row[16];
  int steps = ca.Rhythm(row, 16);

  lsys.Init();
  lsys.SetAxiom("A");
  lsys.AddRule('A', "AB");
  lsys.AddRule('B', "A");
  lsys.Grow(6);

  tempo.Init(120.0);
  tempo.RampTo(8.0, 240.0);
  double sec = tempo.BeatToSeconds(6.0);

  g_int = hits + steps + lsys.Length() + static_cast<int>(sec);
  g_sink = first;
  return 0;
}
