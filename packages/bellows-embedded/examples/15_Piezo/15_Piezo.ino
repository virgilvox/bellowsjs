/*
 * 15_Piezo: getting the most out of a piezo disc as a loudspeaker.
 *
 * A piezo disc costs about thirty cents, needs no amplifier, and is the
 * cheapest way to make a Teensy audible. It is also a capacitor with a
 * sharp resonance and no bass whatsoever, so the difference between a
 * patch that sounds like a wasp and one that sounds like an instrument is
 * almost entirely in how you drive it. piezo.h is that difference and has
 * the reasoning; this file is the wiring and the two modes.
 *
 * BOARDS
 *   Builds for Teensy 3.2, 3.5, 3.6, 4.0, 4.1 and MicroMod. Teensy 4.x
 *   uses MQS on pins 10 and 12; the 3.x boards use PWM on pins 6 and 9.
 *   Both are selected below by the board macros, so the sketch is the same
 *   either way.
 *
 * WIRING, AND THE ONE THING THAT MATTERS
 *
 *   Teensy 4.x:   pin 10 ---[ piezo disc ]--- pin 12
 *   Teensy 3.x:   pin  6 ---[ piezo disc ]--- pin  9
 *
 *   Across the two pins, NOT from one pin to ground. The sketch renders
 *   the signal on one channel and its exact inverse on the other, so the
 *   disc sees both pins swinging in opposite directions and gets twice
 *   the voltage: 6.6 V peak to peak instead of 3.3. That is 6 dB, free,
 *   and it is the single largest improvement available here.
 *
 *   To ground instead works and is 6 dB quieter. Nothing breaks.
 *
 *   No series resistor is needed for a disc this size, and no capacitor:
 *   a piezo is already a capacitor and passes no DC. Do not put one in
 *   series "for safety"; it makes the bass problem worse.
 *
 * A NOTE ON LOUDNESS
 *   The disc will be loud and thin. That is what the part is. If you want
 *   it louder still, glue it to something: a disc lying loose moves almost
 *   nothing, and the same disc on a biscuit tin lid or a stretched
 *   membrane is dramatically louder and drops its resonance, which you
 *   then want to re-measure with SWEEP mode below.
 *
 * TWO MODES
 *   SWEEP  steps a tone from 800 Hz to 8 kHz, a semitone at a time,
 *          printing each frequency. Listen for the loudest, and put that
 *          number in Voicing::resonance_hz. Takes about twenty seconds.
 *   PLAY   the plucked chord from the other output examples, voiced for
 *          the disc.
 *
 * WHAT IS VERIFIED
 *   That this builds and links for the boards listed above. Nothing here
 *   has been flashed to a board, and the piezo advice is engineering
 *   reasoning about a capacitive transducer rather than a measurement.
 *   See examples/README.md.
 */

#include <Audio.h>

#include "bellows/platform/teensy.h"
#include "../10_AudioShield/audioshield.h"
#include "bellows/dsp/oscillators.h"
#include "piezo.h"

/* Set to true to hunt for your disc's resonance, false to play. */
static constexpr bool kSweep = false;

/* One source, not two.
 *
 * The first version of this sketch had a node for the chord and a node for
 * the sweep and connected both to the output. The Teensy Audio Library
 * does not mix on a shared destination input: one input takes one
 * connection, and a second AudioConnection to the same port is not an
 * addition. Mixing needs an AudioMixer4, or, as here, one source that
 * knows which of its two generators is running. That also halves the
 * voicing chain, since there is now one of it rather than two.
 */
struct Source {
  audioshield::Patch chord;
  bellows::BlepOsc osc;
  bool sweeping = false;

  void Init(float sr) {
    chord.Init(sr);
    osc.Init(sr);
    osc.SetShape(bellows::BlepShape::kSine);
  }

  void operator()(float* l, float* r, int from, int to) {
    if (sweeping) {
      for (int n = from; n < to; ++n) {
        const float s = 0.9f * osc.Process();
        l[n] += s;
        r[n] += s;
      }
    } else {
      chord(l, r, from, to);
    }
  }
};

static Source source;
static piezo::Voiced<Source> voiced(source);
static bellows::BellowsAudioStream<piezo::Voiced<Source>> node(voiced);

#if defined(__IMXRT1062__)
/* MQS: Medium Quality Sound, pins 10 and 12, no external parts at all.
 * It is a sigma-delta output filtered by the disc itself, which for a
 * transducer that rolls off above its resonance is a better match than it
 * sounds. Teensy 4.x only. */
static AudioOutputMQS out;
#else
/* PWM on pins 6 and 9. The audio library's own documentation asks for an
 * RC filter for a line output; driving a piezo you can usually omit it,
 * because the disc's own capacitance plus its rolloff does the filtering
 * and there is nothing downstream to offend. */
static AudioOutputPWM out;
#endif

static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  const float sr = bellows::TeensySampleRate();

  source.Init(sr);

  piezo::Voicing v;
  /* Measure yours with kSweep and change this one number. Everything else
   * in Voicing is a reasonable default for a bare 27 mm disc. */
  v.resonance_hz = 4000.0f;
  voiced.Init(sr, v);


  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(12);
  Serial.begin(115200);
}

void loop() {
  if (kSweep) {
    /* 800 Hz up to 8 kHz, a semitone at a time. */
    source.sweeping = true;
    for (int semi = 0; semi <= 40; ++semi) {
      const float hz = 800.0f * powf(2.0f, semi / 12.0f);
      source.osc.SetFreq(hz);
      Serial.println(hz);
      delay(400);
    }
    source.sweeping = false;
    delay(1500);
  } else {
    static int n = 0;
    source.chord.Strike(n++, 0.9f);
    delay(400);
  }
}
