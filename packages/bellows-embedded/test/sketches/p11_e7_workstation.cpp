/* Size-report sketch for examples/07_Workstation.
 *
 * The whole piece, driven for a bar and a half so every part fires at
 * least once and the send bus, the delay, the EQ and the limiter are all
 * on a reachable path. A sixteenth at 96 bpm is 750 samples, so 96 blocks
 * of 128 is a little over two bars. */
#include "harness.h"

#include "../../examples/07_Workstation/workstation.h"

static workstation::Piece piece;

extern "C" volatile int g_int;
volatile int g_int = 0;

extern "C" int main() {
  piece.Init(kSampleRate, 96);
  for (int b = 0; b < 96; ++b) piece(g_l, g_r, 0, kBlock);
  /* Trained() and Voices() exist to be checked on a board, so keep them
   * reachable here rather than letting the linker decide they are dead. */
  g_int = (piece.Trained() ? 1 : 0) + piece.Voices() + piece.Bar();
  Sink(g_l, g_r, kBlock);
  return 0;
}
