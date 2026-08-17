/*
 * 10_AudioShield: bellows through the Teensy Audio Shield (SGTL5000).
 *
 * The reference output path. If you own one shield and one Teensy this is
 * the sketch to start from, because the codec removes every variable the
 * other output examples have to argue about: it is a real 16 bit stereo
 * DAC with a headphone amplifier and a line output, so what you hear is
 * the library rather than the driver.
 *
 * BOARDS
 *   Builds for Teensy 3.2, 3.5, 3.6, 4.0, 4.1 and MicroMod. The shield
 *   comes in two revisions and they are not pin compatible with every
 *   board: Rev D is the 3.x shield, Rev C/D differ for Teensy 4.x. Buy the
 *   revision sold for your board and stack it; no wiring beyond that.
 *
 * WIRING
 *   Stack the shield. Headphones in the jack, or line out to a mixer.
 *   Nothing else. The shield takes I2S on the pins it takes and the audio
 *   library configures them; you do not choose them.
 *
 * WHAT IS VERIFIED
 *   That this builds and links as firmware for the boards listed above.
 *   NOTHING HERE HAS BEEN FLASHED TO A BOARD AND LISTENED TO. See
 *   examples/README.md, which says the same thing once rather than in
 *   every file, and docs/HANDOFF.md, which has said it since the port
 *   started. Assume the first bring-up finds something.
 *
 * THE ONE KNOB THAT MATTERS
 *   codec.volume() drives the headphone amplifier, not the DAC. Leave it
 *   near 0.5 and change the level in the patch instead: turning the
 *   headphone amp up to compensate for a quiet render amplifies the
 *   codec's noise floor along with the music.
 */

#include <Audio.h>

#include <Bellows.h>
#include "bellows/platform/teensy.h"
#include "audioshield.h"

static audioshield::Patch patch;
static bellows::BellowsAudioStream<audioshield::Patch> node(patch);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {

  codec.enable();
  codec.volume(0.5f);

  /* Take the rate from the audio library rather than writing 44100: the
   * SAI clock does not land exactly there, and every envelope coefficient
   * in the patch is derived from this number. */
  patch.Init(bellows::TeensySampleRate());

  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(12);
}

void loop() {
  static int n = 0;
  patch.Strike(n++, 0.8f);
  delay(400);
}
