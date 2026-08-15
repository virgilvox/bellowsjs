/* Size-report sketch for examples/17_WorkstationI2S.
 *
 * The workstation piece summed to mono, which is what that example is: the
 * full patch with nothing filtered out, folded to one signal so the
 * amplifier's SD pin stops mattering.
 *
 * It carries the same caveat as p14: 17 has no logic header, so the fold
 * below is a copy of the six lines in the `.ino` rather than the same
 * source. See the note in p14_e16_workstationpiezo.cpp.
 *
 * WHAT MAKES THIS DIFFER FROM p11_e7_workstation AT ALL
 *
 * `Compose()`, almost entirely. 17 draws a seed at power up and redraws
 * the arrangement, 07 does not call it, and `--gc-sections` drops what
 * nothing reaches, so 07's row does not pay for the mode picker, the
 * progression, the five euclidean rhythms or the motif generator.
 *
 * Priced by building twice rather than by subtracting this row from 07's,
 * because the two differ in two ways and a difference attributed to the
 * wrong one is the mistake docs/HARDWARE.md warns about. Copy this file,
 * delete the `Compose` call, and size both: `Compose` is 480 B, and
 * everything else about this sketch comes to MINUS 32 B against p11, since
 * calling through `Mono` changes how the render loop inlines. The row is
 * 448 B over 07 as the sum of those, not as the cost of the fold.
 */
#include "harness.h"

#include "../../examples/07_Workstation/workstation.h"

static workstation::Piece piece;

/* The sketch's fold, transcribed. */
struct Mono {
  void operator()(float* l, float* r, int from, int to) {
    piece(l, r, from, to);
    for (int i = from; i < to; ++i) {
      const float m = 0.5f * (l[i] + r[i]);
      l[i] = m;
      r[i] = m;
    }
  }
};

static Mono mono;

extern "C" volatile int g_int;
volatile int g_int = 0;

extern "C" int main() {
  piece.Init(kSampleRate, 96);
  /* Not a constant in the sketch: it comes from a floating ADC there. A
   * literal here would let the compiler fold the arrangement at compile
   * time, so it is laundered through the volatile sink. */
  piece.Compose(static_cast<uint32_t>(g_int) + 1u);

  for (int b = 0; b < 96; ++b) mono(g_l, g_r, 0, kBlock);

  g_int = (piece.Trained() ? 1 : 0) + piece.Voices() + piece.Bar();
  Sink(g_l, g_r, kBlock);
  return 0;
}
