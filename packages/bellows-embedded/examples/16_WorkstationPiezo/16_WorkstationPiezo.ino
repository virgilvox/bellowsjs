/*
 * 16_WorkstationPiezo: 07_Workstation through a piezo disc.
 *
 * The workstation patch unchanged, wrapped in the 15_Piezo voicing chain
 * and sent to MQS on pins 10 and 12.
 *
 * WIRING
 *   Teensy 4.x: pin 10 ---[ piezo disc ]--- pin 12
 *   Teensy 3.x: pin  6 ---[ piezo disc ]--- pin  9
 *
 *   Across the two pins, NOT from a pin to ground. Voiced renders the
 *   signal on one channel and its exact inverse on the other, so the disc
 *   sees 6.6 V peak to peak instead of 3.3. That is 6 dB for free.
 *   To ground works and is 6 dB quieter; nothing breaks either way.
 *
 * WHAT TO EXPECT, because the physics is not negotiable
 *   The voicing removes everything below 1.2 kHz, because a 27 mm disc is
 *   about a megaohm at 100 Hz and passes essentially nothing there. The
 *   workstation's kick is at 50 Hz and its bass line runs 110 to 262 Hz,
 *   so on a disc you will hear almost none of either. What is left is the
 *   hat, the snare's noise, and the upper partials of the plucked melody,
 *   which sits at 440 to 1397 Hz and therefore speaks mostly through its
 *   harmonics.
 *
 *   That is the disc, not the patch, and the fix is gain rather than
 *   arrangement: see kDrive below, which was worth 12 dB where moving the
 *   notes was worth less than nothing.
 */

#include <Audio.h>

#include <Bellows.h>
#include "bellows/platform/teensy.h"
#include "../07_Workstation/workstation.h"
#include "../15_Piezo/piezo.h"

/*
 * Drive into the limiter, and it is the only control here that changed
 * the loudness at all.
 *
 * Measured through this exact chain, as energy above 2 kHz, which is what
 * a disc turns into sound rather than broadband RMS:
 *
 *   drive  1   -33.7 dB     the limiter never engages once
 *   drive  4   -24.8 dB
 *   drive  8   -22.6 dB
 *   drive 12   -21.5 dB
 *   drive 16   -20.7 dB     +13 dB, and limiting hard
 *
 * Two things that sounded obvious and measured as wrong. Transposing the
 * piece up an octave to put its fundamentals nearer the disc's resonance
 * made it QUIETER, by 1.1 dB at +1 and 2.2 dB at +2, because a plucked
 * string carries less energy and decays faster the higher it is pitched.
 * And moving the highpass around barely mattered: 800 Hz to 3200 Hz spans
 * 0.7 dB in the radiated band, so the 1200 Hz default is already doing its
 * job and the bass was never the thing holding the level down.
 */
static constexpr float kDrive = 12.0f;

static workstation::Piece piece;
static piezo::Voiced<workstation::Piece> voiced(piece);
static bellows::BellowsAudioStream<piezo::Voiced<workstation::Piece>> node(voiced);

/* MQS: Medium Quality Sound, pins 10 and 12, no external parts at all. A
 * sigma-delta output filtered by the disc itself, which for a transducer
 * that rolls off above its resonance is a better match than it sounds. */
#if defined(__IMXRT1062__)
/* MQS on pins 10 and 12, Teensy 4.x only. */
static AudioOutputMQS out;
#else
/* PWM on pins 6 and 9. Same reasoning as 15_Piezo: driving a disc you can
 * usually omit the RC filter, because the disc's own capacitance and its
 * rolloff do the filtering and there is nothing downstream to offend.
 *
 * Without this the sketch named a 4.x-only class unconditionally and the
 * 3.x builds came back "failed" rather than "does not fit", which reads
 * like a defect in the library and was a missing #if here. */
static AudioOutputPWM out;
#endif

static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  Serial.begin(115200);

  const float sr = bellows::TeensySampleRate();
  piece.Init(sr, 96);

  piezo::Voicing v;
  /* Measure yours: 15_Piezo has a sweep mode that steps a tone across the
   * band so you can hear which frequency is loudest. This is the default
   * for a bare 27 mm brass disc. Mounting it lowers the resonance. */
  v.resonance_hz = 4000.0f;
  v.drive = kDrive;
  voiced.Init(sr, v);


  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(24);
  if (!piece.Trained()) Serial.println("workstation: markov table full, melody is truncated");
  Serial.println("07_Workstation -> piezo on pins 10 and 12");
  Serial.print("sample rate ");
  Serial.println(sr);
}

void loop() {
  /* The sequencer runs inside the audio callback, so the loop only
   * reports. AudioProcessorUsageMax is the number Milestone 1 exists to
   * collect, and this is the heaviest sketch in the set. */
  delay(2000);
  Serial.print("bar ");
  Serial.print(piece.Bar() + 1);
  Serial.print("/4  voices ");
  Serial.print(piece.Voices());
  Serial.print("  cpu ");
  Serial.print(AudioProcessorUsage(), 1);
  Serial.print("%  peak ");
  Serial.print(AudioProcessorUsageMax(), 1);
  Serial.print("%  mem ");
  Serial.print(AudioMemoryUsageMax());
  Serial.println();
}
