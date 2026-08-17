/*
 * 07_Workstation: five engines, a sequencer and a send, from one seed.
 *
 * The other examples each teach one thing. This one is what they add up
 * to: a kit on euclidean rhythms, a bass line, a plucked melody whose
 * notes come out of a Markov chain rather than an array, a tempo-synced
 * stereo delay on a send, an EQ and a limiter on the master. Nothing is
 * stored except a sixteen note motif, and nothing is random except in the
 * sense that it comes from a named stream, so two boards running this
 * play the same piece.
 *
 * It loops four bars of A minor at 96 bpm and never repeats a bar exactly,
 * because the melody is drawn rather than read.
 *
 * BOARDS
 *   Teensy 4.0, 4.1 and MicroMod with room to spare; 3.5 and 3.6 at 91.4
 *   and 91.5 percent of RAM, which fits and leaves nothing. Not 3.2 and
 *   not LC: the 500 ms stereo delay line is 187 KB on its own, which is
 *   more than a 3.2 has in total. Those are build results from
 *   examples/build-matrix.sh. Whether a 120 MHz 3.5 keeps up is a
 *   different question and is unmeasured.
 *
 *   There is deliberately no #error for the two that do not fit. 12_DacOut
 *   uses one because a Teensy 4.x has no DAC at all and never will, which
 *   is categorical. Not enough RAM is a quantity, and "region RAM
 *   overflowed by N bytes" tells you how much you would have to give up.
 *   That is why the matrix shows RAM here and n/a there.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   Headphones in the jack. For any other way of getting sound out, see
 *   examples 11 to 15 and examples/OUTPUTS.md: this sketch's node is
 *   wired the same way theirs are.
 *
 * WHAT IS VERIFIED
 *   The header compiles standalone, links as firmware for the boards
 *   above, and the piece was rendered offline and measured: two Pieces
 *   with the same seed produce 0 differing samples over 30 seconds, every
 *   melody and bass pitch lands in A minor, the kick onsets fall on
 *   E(5,16), and the left delay tap shows an autocorrelation of 0.57 at
 *   the dotted eighth against 0.03 to 0.08 at neighbouring lags. Nothing
 *   here has been flashed to a board. See examples/README.md.
 *
 * PORTING
 *   To a Daisy Seed: swap bellows/platform/teensy.h for
 *   bellows/platform/daisy.h and start the audio through DaisyAudio<T>
 *   instead of an AudioStream node. The header below does not change.
 */

#include <Audio.h>

#include <Bellows.h>
#include "bellows/platform/teensy.h"
#include "workstation.h"

static workstation::Piece piece;

static bellows::BellowsAudioStream<workstation::Piece> node(piece);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  Serial.begin(115200);
  /* More blocks than the smaller examples, because five parts and a send
   * bus is more work per callback than one voice is. */
  piece.Init(bellows::TeensySampleRate(), 96);
  /* AudioMemory LAST, and this ordering is load bearing.
   *
   * BellowsAudioStream::update() returns early only while allocate() is
   * null, which is to say only until AudioMemory() runs. After that the
   * audio interrupt renders whatever it is pointed at, so anything
   * initialised below this line can be rendered before it is ready. A
   * delay line that has not been given its buffer reads through a null
   * pointer, which on an IMXRT1062 is executable memory rather than a
   * trap page. */
  AudioMemory(24);
  codec.enable();
  codec.volume(0.6f);

  /* Train() is the one call here that can fail: the motif is bigger than
   * the chain's table only if you edit it, and a chain that dropped
   * transitions plays a smaller chain with no other symptom. */
  if (!piece.Trained()) Serial.println("workstation: markov table full, melody is truncated");
}

void loop() {
  /* The sequencer runs inside the audio callback, so the loop has nothing
   * to do but report. AudioProcessorUsageMax is the number Milestone 1
   * exists to collect: this is the heaviest sketch in the set. */
  delay(2000);
  Serial.print("bar ");
  Serial.print(piece.Bar() + 1);
  Serial.print("/4  voices ");
  Serial.print(piece.Voices());
  Serial.print("  cpu ");
  Serial.print(AudioProcessorUsage(), 1);
  Serial.print("%  peak ");
  Serial.print(AudioProcessorUsageMax(), 1);
  Serial.println("%");
}
