/*
 * 06_FirstSteps: the four rungs below 01_OneKick.
 *
 * 01 is described as the smallest useful program, and it is, but it is
 * already an engine: Kick is an oscillator, two envelopes, a pitch sweep
 * and a saturator behind one NoteOn. If it does not make a sound on your
 * board there are half a dozen places to look.
 *
 * These four are the primitives it is made of, one at a time, each in its
 * own header:
 *
 *   tone.h      one oscillator. No note, no envelope. It just runs.
 *   envelope.h  the same oscillator, gated. A tone becomes a note.
 *   filter.h    a second envelope on a resonant ladder. A note becomes a
 *               sound, and this is 03_PolySynth without the voice pool.
 *   motion.h    two LFOs, on cutoff and on pitch. It stops sounding like a
 *               sample.
 *
 * The sketch plays each for four seconds and moves on, so one flash walks
 * the whole ladder. Which one you are hearing goes to Serial.
 *
 * All four are linked into this image at once, which is the point of the
 * Bank: dispatch is a runtime index through compile-time-generated
 * compares, so there is no vtable and no registry, and the linker still
 * sees four concrete types. See bellows/bank.h and the note in
 * docs/HANDOFF.md about why a string-keyed registry costs 30 KB.
 *
 * BOARDS
 *   All of them, including a Teensy LC. This is the cheapest example here
 *   and the only one with no delay line anywhere in it.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   Headphones in the jack.
 *
 * WHAT IS VERIFIED
 *   Each header compiles standalone, all four link as one image, and each
 *   was rendered offline and measured for level and pitch. Nothing here
 *   has been flashed to a board. See examples/README.md.
 */

#include <Audio.h>

#include "bellows/bank.h"
#include "bellows/platform/teensy.h"

#include "envelope.h"
#include "filter.h"
#include "motion.h"
#include "tone.h"

/* Declaration order is dispatch order, and it is the order of the ladder. */
enum Step { kTone = 0, kEnvelope, kFilter, kMotion, kStepCount };

static const char* kStepName[kStepCount] = {
    "1 tone     : one oscillator, no envelope",
    "2 envelope : the same oscillator, gated",
    "3 filter   : a resonant ladder with its own envelope",
    "4 motion   : two LFOs, on cutoff and on pitch",
};

/*
 * The Bank holds one of each and renders whichever index is selected.
 * A plain switch would work as well here; this is what the rest of the
 * library uses, and it is what 02_DrumMachine is demonstrating.
 */
static bellows::Bank<firststeps::Tone, firststeps::Envelope, firststeps::Filter,
                     firststeps::Motion>
    steps;

class Ladder {
 public:
  void Init(float sample_rate) {
    steps.ForEach([sample_rate](auto& s) { s.Init(sample_rate); });
  }
  void Select(int i) { which_ = i; }
  int Selected() const { return which_; }
  void operator()(float* l, float* r, int from, int to) {
    steps.With(which_, [l, r, from, to](auto& s) { s(l, r, from, to); });
  }

 private:
  int which_ = 0;
};

static Ladder ladder;

static bellows::BellowsAudioStream<Ladder> node(ladder);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  Serial.begin(115200);
  codec.enable();
  codec.volume(0.5f);
  ladder.Init(bellows::TeensySampleRate());

  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(12);
}

void loop() {
  for (int i = 0; i < kStepCount; ++i) {
    ladder.Select(i);
    Serial.println(kStepName[i]);
    delay(4000);
  }
}
