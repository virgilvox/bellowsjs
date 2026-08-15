/*
 * 01_OneKick: the minimum bellows program.
 *
 * One kick drum retriggering twice a second through the Teensy Audio
 * Library. Everything that makes a sound lives in onekick.h; this file is
 * only the board glue, which is the split the library is designed for.
 *
 * MEASURED COST, Cortex-M7, arm-none-eabi-g++ 11.3, -Os, --gc-sections,
 * library only (no Arduino core, no audio library):
 *
 *     flash 3776 B    RAM 1100 B
 *
 * For scale: the same kick reached by string id through a five-engine
 * registry costs 30296 B of flash and 30828 B of RAM. That is the entire
 * argument for how this library is put together.
 *
 * WIRING (Teensy 4.x plus the Audio Shield)
 *   Teensy 4.0/4.1 with a Rev D audio shield, headphones in the jack.
 *   Nothing else is required.
 *
 * PORTING
 *   On a Daisy Seed, replace the AudioStream plumbing with:
 *     #include "bellows/platform/daisy.h"
 *     bellows::DaisyAudio<onekick::Voice>::Start(hw, voice);
 *   The Voice class itself does not change. That port is done and built in
 *   examples/daisy_onekick, which includes this folder's onekick.h rather
 *   than copying it, so the claim is checked by the compiler.
 */

#include <Audio.h>

#include "bellows/platform/teensy.h"
#include "onekick.h"

static onekick::Voice voice;

/* The adapter is the only virtual call in the whole program: the audio
 * library dispatches update() through AudioStream's vtable 344 times a
 * second. Nothing below it is virtual. */
static bellows::BellowsAudioStream<onekick::Voice> node(voice);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {

  /* Take the rate from the audio library rather than writing 44100 by
   * hand: the SAI clock does not land exactly there, and every envelope
   * coefficient in the voice is derived from this number. */
  voice.Init(bellows::TeensySampleRate());
  /* AudioMemory LAST, and this ordering is load bearing.
   *
   * BellowsAudioStream::update() returns early only while allocate() is
   * null, which is to say only until AudioMemory() runs. After that the
   * audio interrupt renders whatever it is pointed at, so anything
   * initialised below this line can be rendered before it is ready. A
   * delay line that has not been given its buffer reads through a null
   * pointer, which on an IMXRT1062 is executable memory rather than a
   * trap page. */
  AudioMemory(12);
  codec.enable();
  codec.volume(0.6f);
}

void loop() {
  voice.Trigger(50.0f, 0.9f);
  delay(500);
}
