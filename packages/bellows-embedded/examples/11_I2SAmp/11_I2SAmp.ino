/*
 * 11_I2SAmp: bellows into an I2S breakout, with no codec to configure.
 *
 * The cheap path. A MAX98357A is a three dollar board that takes I2S in
 * and drives a speaker out, amplifier included, so a Teensy plus one
 * breakout plus a speaker is a complete instrument. A PCM5102A or a
 * UDA1334A is the same wiring with a line output instead of an amplifier.
 *
 * None of them have a control interface, which is why this sketch has no
 * codec object and no I2C: AudioOutputI2S just clocks samples out and the
 * breakout converts them. There is nothing to enable and no volume to set,
 * so the level in the patch is the level you get.
 *
 * BOARDS
 *   Builds for Teensy 3.2, 3.5, 3.6, 4.0, 4.1 and MicroMod.
 *
 * WIRING (Teensy 4.x)
 *   Teensy 7  (OUT1A / TX)  -> breakout DIN / SD / DATA
 *   Teensy 21 (BCLK)        -> breakout BCLK / SCK / BCK
 *   Teensy 20 (LRCLK)       -> breakout LRC / WS / LCK
 *   Teensy 3.3V             -> breakout VIN   (see the note below)
 *   Teensy GND              -> breakout GND
 *   speaker across the breakout's + and - (MAX98357A only)
 *
 * WIRING (Teensy 3.x)
 *   Data is pin 22, BCLK is pin 9, LRCLK is pin 23. The pins differ per
 *   generation and the audio library owns them; do not pick your own. If
 *   in doubt, the audio library's design tool is authoritative for the
 *   board you have.
 *
 * POWER, WHICH IS THE PART THAT BITES
 *   A MAX98357A at any real volume pulls far more than the Teensy's 3.3V
 *   regulator wants to give: it is a 3W amplifier and its supply should
 *   come from 5V with its own path back to the supply, not from the
 *   Teensy's regulator. A brownout here does not look like a power
 *   problem, it looks like the audio glitching on loud notes, and you will
 *   spend an hour blaming this library.
 *
 * MONO, WHICH IS THE OTHER PART
 *   The MAX98357A is a MONO amplifier. Left unwired its SD_MODE pin makes
 *   it average left and right, which is usually what you want and is what
 *   this sketch assumes: the patch renders stereo and the breakout sums
 *   it. If you tie SD_MODE for left-only, a patch that pans anywhere but
 *   centre will sound wrong for a reason that is not in this code.
 *
 * WHAT IS VERIFIED
 *   That this builds and links for the boards listed above. Nothing here
 *   has been flashed to a board. See examples/README.md.
 */

#include <Audio.h>

#include <Bellows.h>
#include "bellows/platform/teensy.h"
#include "../10_AudioShield/audioshield.h"

static audioshield::Patch patch;
static bellows::BellowsAudioStream<audioshield::Patch> node(patch);

/* No AudioControlSGTL5000 and no codec.enable(). That absence is the whole
 * difference between this sketch and 10_AudioShield. */
static AudioOutputI2S out;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
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
