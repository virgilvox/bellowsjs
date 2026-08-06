/* Shared logic for the 04_ScalesAndTuning example.
 *
 * This is the example that explains why the library exists. Almost every
 * embedded audio library hands you oscillators and filters and then
 * assumes twelve equal semitones per octave, usually by hard-coding
 * 440 * 2^((n - 69) / 12) somewhere in a note handler. Here pitch is not
 * a formula, it is a layer: a Scale says which degrees of a key are in
 * play, and a Tuning says what frequency each degree actually is. The
 * phrase below is written once, as scale degrees, and played in two
 * different divisions of the octave without changing a note of it.
 *
 * THE ONE THING TO UNDERSTAND HERE
 *
 * An interval table is expressed in steps of the tuning it is meant for,
 * not in semitones. src/theory/tuning.ts says so directly: "intervals
 * lists tuning steps above the root, e.g. [0, 2, 4, 5, 7, 9, 11] for
 * major in edo(12)". In 12-EDO a step is a semitone and the two readings
 * happen to coincide, which is why the distinction is easy to miss.
 *
 * They stop coinciding immediately in 19-EDO. A whole tone there is 3
 * steps and a diatonic semitone is 2, so dorian is not [0,2,3,5,7,9,10]
 * but [0,3,5,8,11,14,16]. Feed the semitone table to a 19-EDO tuning and
 * every interval comes out too small: degree 2 would be 189 cents, a
 * whole tone, where the scale wants a 316 cent minor third. The octave
 * would still be right, because degrees wrap by the tuning's period, so
 * the result sounds plausibly in tune and is completely wrong. That is
 * the classic microtonal bug and it is worth seeing named.
 *
 * So bellows::Scale, whose tables are the 12-EDO ones from scales.ts,
 * supplies the intervals for the 12-EDO pass, and the 19-EDO pass uses an
 * explicit table restated in 19-EDO steps.
 *
 * WHY 19-EDO IS WORTH HEARING
 *
 * Its major third is 6 steps, 378.95 cents, about 7 cents flat of a pure
 * 5:4 at 386.31. The 12-EDO major third is 400 cents, about 14 cents
 * sharp. So 19-EDO triads beat about half as fast and noticeably calmer.
 * The price is a fifth of 11 steps, 694.74 cents, about 7 cents flat of
 * a pure 701.96, and a chromatic scale with a genuinely different shape:
 * a sharp and its enharmonic flat are no longer the same pitch.
 *
 * Nothing here allocates and none of it touches an audio buffer: theory
 * is a pure layer over integers and floats, as in the TypeScript. */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

namespace scalestuning {

/* Degrees of the current scale, not note numbers. Values past the scale
 * length wrap and transpose by one period, so this spans two octaves and
 * is meaningful in any tuning. */
inline constexpr int kPhrase[] = {0, 2, 4, 6, 7, 6, 4, 2, 0, 4, 7, 11, 7, 4, 2, 0};
inline constexpr int kPhraseLen = static_cast<int>(sizeof(kPhrase) / sizeof(kPhrase[0]));

/* Dorian restated in 19-EDO steps: W H W W W H W, with W = 3 and H = 2.
 * Compare bellows::kScaleDorian, which is the same mode in semitones. */
inline constexpr uint8_t kDorian19[] = {0, 3, 5, 8, 11, 14, 16};
inline constexpr int kDorian19Len = 7;

using Tuning19 = bellows::Tuning<19>;

class Player {
 public:
  void Init(float sample_rate, unsigned bpm) {
    rng_.Init("scalestuning");
    sr_ = sample_rate;
    SetTempo(bpm);

    bellows::Pluck<>::Params p;
    p.damp = 0.3f;       /* rings long enough to judge the intonation */
    p.pick_pos = 0.24f;
    p.decay = 3.0f;
    pluck_.Init(sample_rate, &rng_, p);

    /* D dorian, reached by enum so no scale-name strings are linked in. */
    scale_.Init(62, bellows::kScaleDorian);

    /* Both tunings anchor A4 = 440 at index 69, so what you hear between
     * the two passes is the tuning and not a transposition. */
    edo12_.InitEdo(12, 440.0f, 69);
    edo19_.InitEdo(19, 440.0f, 69);
  }

  void SetTempo(unsigned bpm) {
    float notes_per_sec = (static_cast<float>(bpm) / 60.0f) * 2.0f;  /* eighths */
    samples_per_note_ = static_cast<int>(sr_ / notes_per_sec + 0.5f);
    if (samples_per_note_ < 1) samples_per_note_ = 1;
  }

  void UseNineteen(bool on) { nineteen_ = on; }
  bool Nineteen() const { return nineteen_; }
  int Position() const { return step_; }

  /* Frequency of one degree in whichever tuning is selected.
   *
   * The root index differs between the two because a tuning index is a
   * step of that tuning, not a MIDI note. D4 is index 62 in 12-EDO. The
   * same note in 19-EDO is index 58, because A4 is index 69 in both and
   * D sits a fifth below A, which is 11 steps of 19-EDO. */
  float DegreeHz(int degree) const {
    if (nineteen_) {
      return bellows::DegreeFreq(edo19_, 58, kDorian19, kDorian19Len, degree);
    }
    return bellows::DegreeFreq(edo12_, 62, scale_.Intervals(), scale_.Length(), degree);
  }

  void Step() {
    pluck_.NoteOn(DegreeHz(kPhrase[step_]), 0.85f);
    if (++step_ >= kPhraseLen) {
      step_ = 0;
      nineteen_ = !nineteen_;  /* repeat the phrase in the other tuning */
    }
  }

  void operator()(float* l, float* r, int from, int to) {
    int i = from;
    while (i < to) {
      if (countdown_ <= 0) {
        Step();
        countdown_ = samples_per_note_;
      }
      int span = to - i;
      if (span > countdown_) span = countdown_;
      pluck_.Process(l, r, i, i + span);
      i += span;
      countdown_ -= span;
    }
  }

 private:
  bellows::Rng rng_;
  bellows::Pluck<> pluck_;
  bellows::Scale scale_;
  bellows::Tuning12 edo12_;
  Tuning19 edo19_;
  float sr_ = 48000.0f;
  int samples_per_note_ = 1;
  int countdown_ = 0;
  int step_ = 0;
  bool nineteen_ = false;
};

}  // namespace scalestuning
