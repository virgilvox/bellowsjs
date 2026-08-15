/*
 * 20_Instruments: ten instruments, one program.
 *
 * A patch library rather than a lesson. Each header in this folder is one
 * instrument, self contained, with its parameters written out and a
 * comment saying what makes it that instrument rather than another one:
 *
 *   epiano.h       FM electric piano, the DX tine
 *   acid.h         resonant mono bass, the filter IS the instrument
 *   junopad.h      chorused polysynth pad
 *   westcoast.h    wavefolder and low pass gate, no filter at all
 *   guitar.h       Karplus-Strong plucked string
 *   bells.h        modal, bell partials with the minor third at 2.4
 *   marimba.h      modal, wood. The same engine, four numbers different
 *   glass.h        modal, sparse partials that keep their brightness
 *   clarinet.h     waveguide with a reed, driven rather than struck
 *   choir.h        formant vowels, morphed in the log domain
 *   eightoheight.h the long-decay kit
 *
 * They share `player.h`, which holds the scale, the tuning, the chord
 * progression and the rhythms, so switching patch compares INSTRUMENTS and
 * not the parts they happen to be playing. That is the same argument
 * 10_AudioShield makes for the output examples sharing one chord.
 *
 * The sketch plays each for four bars and moves on. All eleven are linked
 * into this one image, which is the honest way to size it: the matrix row
 * in examples/README.md is the whole book, not the cheapest patch in it.
 *
 * Dispatch is bellows::Bank, a runtime index resolved through
 * compile-time-generated compares. No vtable, no registry, no string
 * lookup. docs/HANDOFF.md records what a string-keyed registry of five
 * engines costs instead: 30488 bytes of flash against 3760 direct, because
 * naming every engine forces the linker to keep every engine.
 *
 * BOARDS
 *   See the matrix in examples/README.md. It is a build log rather than a
 *   reading of data sheets, and nothing here says any board is fast
 *   enough: no bellows program has been run on hardware.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   Headphones in the jack.
 *
 * WHAT IS VERIFIED
 *   Every header compiles standalone, all of them link as one image, and
 *   each patch was rendered offline and measured for level, for non-finite
 *   samples and for pitch. Nothing here has been flashed to a board.
 */

#include <Audio.h>

#include "bellows/bank.h"
#include "bellows/fx/dynamics.h"
#include "bellows/platform/teensy.h"

#include "acid.h"
#include "bells.h"
#include "choir.h"
#include "clarinet.h"
#include "eightoheight.h"
#include "epiano.h"
#include "glass.h"
#include "guitar.h"
#include "junopad.h"
#include "marimba.h"
#include "player.h"
#include "westcoast.h"

/* Declaration order is dispatch order and is the order of the tour. */
enum Instrument {
  kEpiano = 0, kAcid, kJunoPad, kWestCoast, kGuitar,
  kBells, kMarimba, kGlass, kClarinet, kChoir, kEightOhEight,
  kInstrumentCount
};

static const char* kName[kInstrumentCount] = {
    "epiano", "acid", "junopad", "westcoast", "guitar",
    "bells", "marimba", "glass", "clarinet", "choir", "808",
};

/* Per patch output trim, measured. See the note at the top of any patch
 * header: the engines have no common loudness reference, so without this
 * changing instrument means reaching for the volume. */
static const float kTrims[kInstrumentCount] = {
    epiano::kTrim, acid::kTrim, junopad::kTrim, westcoast::kTrim, guitar::kTrim,
    bells::kTrim, marimba::kTrim, glass::kTrim, clarinet::kTrim, choir::kTrim,
    eightoheight::kTrim,
};

static const player::Kind kKinds[kInstrumentCount] = {
    epiano::kKind, acid::kKind, junopad::kKind, westcoast::kKind, guitar::kKind,
    bells::kKind, marimba::kKind, glass::kKind, clarinet::kKind, choir::kKind,
    eightoheight::kKind,
};

static bellows::Bank<epiano::Patch, acid::Patch, junopad::Patch, westcoast::Patch,
                     guitar::Patch, bells::Patch, marimba::Patch, glass::Patch,
                     clarinet::Patch, choir::Patch, eightoheight::Patch>
    book;

/*
 * The shell: one sequencer, one patch sounding at a time, block split at
 * the step boundary so a note lands on the sample rather than on the block
 * edge. Everything musical comes from `player`.
 */
class Book {
 public:
  void Init(float sample_rate) {
    sr_ = sample_rate;
    rng_.Init("instruments");
    play_.Init();
    book.ForEach([this, sample_rate](auto& patch) { patch.Init(sample_rate, &rng_); });

    /* The trims put every patch at about the same RMS. The limiter is for
     * what a trim cannot fix: a plucked chord and a kick are transients
     * with a crest factor above 30 dB, so the peak that matters is one
     * sample long and pulling the whole patch down to fit it would leave
     * it inaudible. */
    bellows::Limiter<>::Params lim;
    lim.ceiling_db = -1.0f;
    lim.release = 0.06f;
    limiter_.Init(sample_rate, lim);

    SetTempo(96);
  }

  void SetTempo(unsigned bpm) {
    const float steps_per_sec = (static_cast<float>(bpm) / 60.0f) * 4.0f;
    samples_per_step_ = static_cast<int>(sr_ / steps_per_sec + 0.5f);
    if (samples_per_step_ < 1) samples_per_step_ = 1;
  }

  void Select(int i) {
    if (i == which_) return;
    /* Release whatever the outgoing patch is holding, or a pad sustains
     * under the next instrument for the rest of the tour. */
    AllOff();
    which_ = i;
    step_ = 0;
  }

  int Selected() const { return which_; }
  int Bar() const { return (step_ / player::kSteps) % player::kBars; }

  void Step() {
    const int s = step_ % player::kSteps;
    const int bar = Bar();

    switch (kKinds[which_]) {
      case player::Kind::kChord:
        /* One voicing a bar, held until the next one. */
        if (s == 0) {
          AllOff();
          int deg[3];
          const int n = play_.ChordDegrees(bar, deg);
          for (int i = 0; i < n; ++i) {
            book.With(which_, [&](auto& p) { p.NoteOn(deg[i], play_.Hz(deg[i]), 0.62f); });
            held_[i] = deg[i];
          }
          held_count_ = n;
        }
        break;

      case player::Kind::kMelody: {
        const int d = play_.MelodyDegree(bar, s);
        if (d != player::kRest) {
          book.With(which_, [&](auto& p) { p.NoteOn(d, play_.Hz(d), 0.7f); });
        }
        break;
      }

      case player::Kind::kBass: {
        const int d = play_.BassDegree(bar, s);
        if (d != player::kRest) {
          /* Accent every fourth step, which is what moves the filter. */
          const float vel = (s % 4 == 0) ? 0.95f : 0.55f;
          book.With(which_, [&](auto& p) { p.NoteOn(d, play_.Hz(d), vel); });
        }
        break;
      }

      case player::Kind::kPercussion:
        if (play_.Kick(s)) book.With(which_, [](auto& p) { p.NoteOn(0, 0.0f, 0.95f); });
        if (play_.Snare(s)) book.With(which_, [](auto& p) { p.NoteOn(1, 0.0f, 0.75f); });
        if (play_.Hat(s)) book.With(which_, [](auto& p) { p.NoteOn(2, 0.0f, 0.45f); });
        break;
    }
    ++step_;
  }

  void operator()(float* l, float* r, int from, int to) {
    int i = from;
    while (i < to) {
      if (countdown_ <= 0) {
        Step();
        countdown_ = samples_per_step_;
      }
      int span = to - i;
      if (span > countdown_) span = countdown_;
      if (span > kMaxBlock) span = kMaxBlock;
      /* Patches ADD, so a patch is rendered into the scratch and trimmed
       * on the way out rather than being asked to know how loud it should
       * be relative to ten others it has never heard of. */
      for (int k = 0; k < span; ++k) {
        scratch_l_[k] = 0.0f;
        scratch_r_[k] = 0.0f;
      }
      book.With(which_, [this, span](auto& p) { p(scratch_l_, scratch_r_, 0, span); });
      const float g = kTrims[which_];
      for (int k = 0; k < span; ++k) {
        l[i + k] += g * scratch_l_[k];
        r[i + k] += g * scratch_r_[k];
      }
      limiter_.Process(l, r, i, i + span);
      i += span;
      countdown_ -= span;
    }
  }

 private:
  void AllOff() {
    for (int i = 0; i < held_count_; ++i) {
      const int id = held_[i];
      book.With(which_, [id](auto& p) { p.NoteOff(id); });
    }
    held_count_ = 0;
  }

  static constexpr int kMaxBlock = BELLOWS_BLOCK_SIZE;

  bellows::Rng rng_;
  player::Player play_;
  bellows::Limiter<> limiter_;
  float scratch_l_[kMaxBlock] = {};
  float scratch_r_[kMaxBlock] = {};
  float sr_ = 48000.0f;
  int samples_per_step_ = 1;
  int countdown_ = 0;
  int step_ = 0;
  int which_ = 0;
  int held_[3] = {0, 0, 0};
  int held_count_ = 0;
};

static Book bk;

static bellows::BellowsAudioStream<Book> node(bk);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  Serial.begin(115200);
  codec.enable();
  codec.volume(0.6f);
  bk.Init(bellows::TeensySampleRate());

  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(20);
}

void loop() {
  for (int i = 0; i < kInstrumentCount; ++i) {
    bk.Select(i);
    Serial.print("patch ");
    Serial.print(i + 1);
    Serial.print("/");
    Serial.print(static_cast<int>(kInstrumentCount));
    Serial.print("  ");
    Serial.print(kName[i]);
    Serial.print("   cpu ");
    Serial.print(AudioProcessorUsageMax(), 1);
    Serial.println("%");
    AudioProcessorUsageMaxReset();
    /* Four bars of sixteenths at 96 bpm is exactly 10 seconds. */
    delay(10000);
  }
}
