/*
 * 13_BareOutput: sound out of a bare Teensy. No shield, no breakout, no
 * converter chip. Two resistors and two capacitors per channel.
 *
 * This is the example for "I have a Teensy and some headphones". It is
 * also the one to reach for with an analog amplifier module: a PAM8403 or
 * an LM386 board takes a line level input, not I2S, so it hangs off this
 * output rather than off 11_I2SAmp.
 *
 * WHICH OUTPUT, AND WHY IT DIFFERS BY BOARD
 *   Teensy 4.x has no DAC, so it uses MQS on pins 10 and 12. MQS is a
 *   sigma-delta modulator in the flexIO hardware; the audio is in there at
 *   full rate with the quantisation noise pushed up above the band, which
 *   is why a plain RC filter recovers it cleanly.
 *   Teensy 3.x uses PWM on pins 6 and 9. Same idea, cruder: the noise is
 *   not shaped, so the filter matters more and the result is noisier.
 *   If your 3.x board has a DAC pin free, 12_DacOut sounds better than
 *   this does. This example exists for when it does not.
 *
 * WIRING, per channel
 *
 *   pin ---[ 470R ]---+---[ 470R ]---+--- output
 *                     |              |
 *                  100nF          100nF
 *                     |              |
 *                    GND            GND
 *
 *   Teensy 4.x: pins 10 (left) and 12 (right).
 *   Teensy 3.x: pins 6 (left) and 9 (right).
 *   Output goes to headphones, or to an amplifier module's input, with
 *   grounds joined.
 *
 *   Two RC sections rather than one. A single 470R/100nF corner sits at
 *   3.4 kHz, which is inside the audio band and audibly dull, and one pole
 *   leaves a lot of carrier behind; two gentler sections placed the same
 *   way roll off faster above the band while staying flatter inside it.
 *   This is the network Paul Stoffregen documents for AudioOutputPWM and
 *   it is the one to copy.
 *
 * HEADPHONES DIRECTLY
 *   Works, quietly, and is not kind to the pin: 32 ohm headphones through
 *   940 ohms of series resistance is a heavy divider. It is fine for
 *   checking that a patch makes the right noise. For listening, put an
 *   amplifier after the filter.
 *
 * WHAT IS VERIFIED
 *   That this builds and links for Teensy 3.2, 3.5, 3.6, 4.0, 4.1 and
 *   MicroMod. Nothing here has been flashed to a board. See
 *   examples/README.md.
 */

#include <Audio.h>

#include <Bellows.h>
#include "bellows/platform/teensy.h"
#include "../10_AudioShield/audioshield.h"

static audioshield::Patch patch;
static bellows::BellowsAudioStream<audioshield::Patch> node(patch);

#if defined(__IMXRT1062__)
static AudioOutputMQS out;   /* pins 10 and 12 */
#else
static AudioOutputPWM out;   /* pins 6 and 9 */
#endif

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
