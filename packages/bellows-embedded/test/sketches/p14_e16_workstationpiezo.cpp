/* Size-report sketch for examples/16_WorkstationPiezo.
 *
 * The workstation piece wrapped in the 15_Piezo voicing chain, which is
 * what that example is: 07_Workstation's patch unchanged, plus two
 * cascaded highpasses, a resonance bell and a limiter, and no other
 * program of its own.
 *
 * WHY THIS ONE RECONSTRUCTS THE CHAIN INSTEAD OF INCLUDING IT
 *
 * Every other row here includes the example's logic header, so the number
 * comes from the code the reader is reading. 16 has no logic header: it is
 * an `.ino` and nothing else, because its program is one declaration
 * (`piezo::Voiced<workstation::Piece>`) over two headers that already
 * exist. So this file names that same type over those same two headers.
 * What is NOT shared is the declaration itself and the Voicing values in
 * setup(), and a divergence there is a divergence this row cannot see.
 * The alternative, splitting a two line header out of the sketch, buys
 * exactness in one composition and costs a folder its readability; if 16
 * ever grows a program worth the name, take the header.
 *
 * The Voicing is set to the sketch's, not to the default: kDrive is 12
 * there, and the limiter's threshold is derived from Init, so leaving it
 * at 1 would measure a chain the example never compiles. The value does
 * not move the size, but relying on that is how the audioshield row got
 * pinned in p9_e10_chord.
 */
#include "harness.h"

#include "../../examples/07_Workstation/workstation.h"
#include "../../examples/15_Piezo/piezo.h"

static workstation::Piece piece;
static piezo::Voiced<workstation::Piece> voiced(piece);

extern "C" volatile int g_int;
volatile int g_int = 0;

extern "C" int main() {
  piece.Init(kSampleRate, 96);

  piezo::Voicing v;
  v.resonance_hz = 4000.0f;
  v.drive = 12.0f;
  voiced.Init(kSampleRate, v);

  /* The same bar and a half p11_e7_workstation renders, so the two rows
   * differ by the voicing chain and by nothing else. */
  for (int b = 0; b < 96; ++b) voiced(g_l, g_r, 0, kBlock);

  g_int = (piece.Trained() ? 1 : 0) + piece.Voices() + piece.Bar();
  Sink(g_l, g_r, kBlock);
  return 0;
}
