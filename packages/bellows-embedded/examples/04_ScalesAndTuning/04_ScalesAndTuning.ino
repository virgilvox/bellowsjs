/*
 * 04_ScalesAndTuning: one phrase, two divisions of the octave.
 *
 * Plays a sixteen note phrase in D dorian, first in ordinary 12-EDO and
 * then in 19-EDO, alternating forever. The phrase is stored as scale
 * degrees, so nothing about it changes between the two passes: only the
 * tuning and the interval table do.
 *
 * WHAT TO LISTEN FOR
 *   The thirds. 19-EDO's minor third is 315.8 cents against a pure 6:5 of
 *   315.64, so it is very nearly just and sounds settled where the 12-EDO
 *   minor third at 300 cents sounds tense. The fifths go the other way:
 *   19-EDO's is 7 cents flat and slightly restless. The octaves are
 *   identical, exactly 2:1 in both.
 *
 *   The LED on pin 13 is lit for the 19-EDO pass, so you can tell the two
 *   apart without counting.
 *
 * WHY THIS EXAMPLE EXISTS
 *   Retuning normally means rewriting a note handler. Here it is a
 *   different Tuning object and a scale table restated in that tuning's
 *   steps. Read scalestuning.h before changing anything: it explains why
 *   the 19-EDO scale is [0,3,5,8,11,14,16] and not the semitone table,
 *   which is the one mistake this subject reliably produces.
 *
 * TRY NEXT
 *   Tuning::InitJi takes a list of ratios, so a 5-limit just intonation
 *   scale is one call. Tuning::InitCents takes a cents table, which is
 *   what a Scala .scl file is. Neither needs anything else to change.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   Headphones in the jack.
 */

#include <Audio.h>

#include <Bellows.h>
#include "bellows/platform/teensy.h"
#include "scalestuning.h"

static scalestuning::Player player;

static bellows::BellowsAudioStream<scalestuning::Player> node(player);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  codec.enable();
  codec.volume(0.6f);
  pinMode(LED_BUILTIN, OUTPUT);
  player.Init(bellows::TeensySampleRate(), 96);

  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(12);
}

void loop() {
  digitalWrite(LED_BUILTIN, player.Nineteen() ? HIGH : LOW);
  delay(20);
}
