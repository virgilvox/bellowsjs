/* Per-module cost: the theory layer, integer paths only.
 * Scales, chords and tuning reached by enum. The string tables live in a
 * separate section of each header that nothing here refers to, so no note
 * or chord name characters are linked in. Compare s9m_seq: neither of
 * these touches an audio buffer or a sample rate. */
#include "harness.h"
#include "bellows/theory/chords.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"
static bellows::Scale scale;
static bellows::Tuning<19> edo19;
extern "C" volatile int g_int;
volatile int g_int = 0;
extern "C" int main() {
  scale.Init(62, bellows::kScaleDorian);
  edo19.InitEdo(19, 440.0f, 69);

  /* A degree walked through a non-12 tuning: the reason this layer is
   * here rather than a midiToFreq helper. */
  float hz = bellows::DegreeFreq(edo19, 58, scale.Intervals(), scale.Length(), 4);

  bellows::Chord c = bellows::MakeChord(2, bellows::kChordMin7);
  int midi[8];
  int n = c.Midi(4, midi, 8);

  bellows::Chord tri[7];
  int t = bellows::DiatonicTriads(scale, tri, 7);

  int pcs[4] = {0, 4, 7, 11};
  int root; bellows::ChordType ty;
  bool ok = bellows::DetectChord(pcs, 4, &root, &ty);

  g_int = n + t + (ok ? root + static_cast<int>(ty) : 0) + scale.Quantize(65);
  g_sink = hz;
  return 0;
}
