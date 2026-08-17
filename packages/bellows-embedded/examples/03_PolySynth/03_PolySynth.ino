/*
 * 03_PolySynth: eight voice VA polysynth with a swept filter.
 *
 * Holds a chord and lets the LFO walk the cutoff across it, so the
 * resonance is audible without any playing. Swap the arpeggio in loop()
 * for MIDI input and this becomes example 05.
 *
 * Note ids. VoicePool identifies a sounding note by an integer the caller
 * picks, and NoteOff(id) releases whichever voice is holding it. Using
 * the MIDI note number is the obvious choice and is what example 05 does.
 * Here the chord degrees double as ids.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   Headphones in the jack.
 */

#include <Audio.h>

#include <Bellows.h>
#include "bellows/platform/teensy.h"
#include "polysynth.h"

static polysynth::Synth synth;

static bellows::BellowsAudioStream<polysynth::Synth> node(synth);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

/* An A minor 9 spread over two octaves, as MIDI note numbers. */
static const int kChord[] = {45, 52, 57, 60, 64, 67, 71, 76};
static const int kChordSize = sizeof(kChord) / sizeof(kChord[0]);

/* Equal-tempered MIDI to Hz. Example 04 replaces this one line with the
 * tuning layer, which is the point of that example. */
static float MidiToHz(int note) {
  return 440.0f * powf(2.0f, (static_cast<float>(note) - 69.0f) / 12.0f);
}

void setup() {
  codec.enable();
  codec.volume(0.6f);
  synth.Init(bellows::TeensySampleRate());

  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(16);
}

void loop() {
  for (int i = 0; i < kChordSize; ++i) {
    synth.NoteOn(kChord[i], MidiToHz(kChord[i]), 0.7f);
    delay(180);
  }
  delay(2500);
  for (int i = 0; i < kChordSize; ++i) synth.NoteOff(kChord[i]);
  delay(1500);
}
