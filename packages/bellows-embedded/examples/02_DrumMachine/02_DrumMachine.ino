/*
 * 02_DrumMachine: a three piece kit driven by euclidean patterns.
 *
 * The sequencer runs inside the audio callback, not in loop(), which is
 * the important structural point. loop() on an Arduino is preempted by
 * every interrupt in the system and its timing is worth several
 * milliseconds of jitter; the audio block clock is exact. Machine::Step
 * is called from the render, and the render splits each block at the step
 * boundary so a hit lands on the sample it was scheduled for.
 *
 * All the logic is in drummachine.h so the size-report sketch
 * (test/sketches/p5_e2_drummachine.cpp) measures this same code.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   Headphones in the jack. Optional: a pot on A0 for tempo.
 */

#include <Audio.h>

#include "bellows/platform/teensy.h"
#include "drummachine.h"

static drummachine::Machine machine;

static bellows::BellowsAudioStream<drummachine::Machine> node(machine);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

static const int kTempoPin = A0;

void setup() {
  AudioMemory(12);
  codec.enable();
  codec.volume(0.6f);
  machine.Init(bellows::TeensySampleRate(), 120);
}

void loop() {
  /* Tempo is the one thing safe to change from loop(): it only affects
   * how many samples the next step waits, and a torn read costs at worst
   * one step of the wrong length. Nothing here allocates or blocks. */
  int raw = analogRead(kTempoPin);          /* 0..1023 */
  unsigned bpm = 60u + (static_cast<unsigned>(raw) * 120u) / 1023u;  /* 60..180 */
  machine.SetTempo(bpm);
  delay(50);
}
