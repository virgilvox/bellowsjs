/*
 * 12_DacOut: bellows out of the Teensy 3.x built-in DAC. No shield, no
 * breakout, one wire and a capacitor.
 *
 * BOARDS, AND THIS ONE IS NOT A PREFERENCE
 *   Teensy 3.1, 3.2, 3.5, 3.6 only. Teensy 4.0, 4.1 and MicroMod have NO
 *   digital to analogue converter at all: the DAC was dropped when the
 *   part changed from Kinetis to i.MX RT. There is no pin to move the wire
 *   to and no library setting that brings it back. On a 4.x board use
 *   13_MqsOut, which is the nearest equivalent, or an I2S breakout.
 *
 *   The #error below is deliberate. AudioOutputAnalog does not exist in
 *   the 4.x audio library, so without it you get a template error deep in
 *   a header instead of the one sentence that explains the problem.
 *
 * WIRING
 *   Teensy 3.1/3.2:  A14 is the DAC pin, mono.
 *   Teensy 3.5/3.6:  A21 and A22, stereo, and AudioOutputAnalogStereo.
 *
 *   DAC pin ---||--- amplifier or powered speaker input
 *              10uF, + towards the Teensy
 *        GND ---------- amplifier ground
 *
 *   The capacitor is not optional. The DAC idles at half its reference
 *   rather than at zero, so a direct connection feeds about 1.6 V of DC
 *   into whatever you plugged in. Into a small speaker that is a constant
 *   current through the coil, which gets warm and sounds bad; into a line
 *   input it is merely wrong.
 *
 * WHAT YOU GIVE UP
 *   12 bits, against 16 through a codec. That is a noise floor about 24 dB
 *   higher, and it is audible as hiss in quiet passages. It is the right
 *   trade for a prototype, an alarm, or anything that is loud most of the
 *   time. It is the wrong trade for a reverb tail.
 *
 * WHAT IS VERIFIED
 *   That this builds and links for Teensy 3.2, 3.5 and 3.6. Nothing here
 *   has been flashed to a board. See examples/README.md.
 */

#include <Audio.h>

#if defined(__IMXRT1062__)
#error "Teensy 4.x has no DAC. Use 13_MqsOut, or an I2S breakout (11_I2SAmp)."
#endif

#include "bellows/platform/teensy.h"
#include "../10_AudioShield/audioshield.h"

static audioshield::Patch patch;
static bellows::BellowsAudioStream<audioshield::Patch> node(patch);

/* Teensy 3.5 and 3.6 have two DAC pins and can run the pair; 3.1 and 3.2
 * have one, so the stereo render is summed by taking the left channel and
 * nothing else. Mixing to mono in the graph would cost another audio
 * block and a mixer node for a patch that is already centred. */
#if defined(__MK64FX512__) || defined(__MK66FX1M0__)
static AudioOutputAnalogStereo out;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);
#else
static AudioOutputAnalog out;
static AudioConnection patchL(node, 0, out, 0);
#endif

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
