/* Shared logic for the 02_DrumMachine example.
 *
 * Three drum voices behind a compile-time Bank, each pad driven by its own
 * euclidean pattern. This is the example that shows what replaces the
 * registry: pads are selected by a runtime integer, exactly as they would
 * be by string id in the TypeScript, but Bank resolves that integer
 * through a chain of compile-time-generated compares, so the linker still
 * sees three concrete types and can drop anything they do not reach.
 *
 * Euclidean rhythms are Bjorklund's algorithm, the same one in
 * src/seq/euclid.ts: spread k pulses as evenly as possible over n steps.
 * E(3,8) is the tresillo, E(5,8) the cinquillo, E(2,5) a common clave
 * fragment. The C++ Euclid stores the pattern as a bitmask rather than an
 * array of bools, so a 16 step pattern is two bytes plus a cursor.
 *
 * MEASURED COST, Cortex-M7, -Os, --gc-sections: see the report row for
 * p5_e2_drummachine. The kit is dominated by Snare and Hat, which use
 * BlepOsc and therefore pull in the band-limited step tables; the kick on
 * its own is 3760 B. */
#pragma once

#include "bellows/bank.h"
#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"
#include "bellows/seq/euclid.h"

namespace drummachine {

/* Pad indices into the bank. Declaration order is the dispatch order. */
enum Pad { kKick = 0, kSnare = 1, kHat = 2, kPadCount = 3 };

class Machine {
 public:
  void Init(float sample_rate, unsigned bpm) {
    rng_.Init("drummachine");
    sr_ = sample_rate;
    SetTempo(bpm);

    kit_.head.Init(sample_rate);                 /* Kick  */
    kit_.tail.head.Init(sample_rate, &rng_);     /* Snare, needs noise */
    kit_.tail.tail.head.Init(sample_rate);       /* Hat   */

    /* Three patterns that lock together over 16 steps. The kick lands on
     * a 5-in-16 euclidean spread, the snare answers on the backbeat, and
     * the hat fills with 11 of 16 rotated by 1 so it never doubles the
     * kick's downbeat. */
    pattern_[kKick].Generate(5, 16);
    pattern_[kSnare].Generate(4, 16, 4);
    pattern_[kHat].Generate(11, 16, 1);

    /* Tuning per pad, in Hz. Drum engines tune from the noteOn frequency,
     * so a kit is playable up and down the keyboard. */
    hz_[kKick] = 50.0f;
    hz_[kSnare] = 190.0f;
    hz_[kHat] = 330.0f;
    vel_[kKick] = 0.95f;
    vel_[kSnare] = 0.8f;
    vel_[kHat] = 0.5f;
  }

  void SetTempo(unsigned bpm) {
    /* Sixteenth notes: four steps per beat. */
    float steps_per_sec = (static_cast<float>(bpm) / 60.0f) * 4.0f;
    samples_per_step_ = static_cast<int>(sr_ / steps_per_sec + 0.5f);
    if (samples_per_step_ < 1) samples_per_step_ = 1;
  }

  /* Advance the sequencer one step and fire whichever pads are on. */
  void Step() {
    for (int pad = 0; pad < kPadCount; ++pad) {
      if (!pattern_[pad].Process()) continue;
      const float f = hz_[pad];
      const float v = vel_[pad];
      /* Runtime index into a compile-time bank. No vtable, no table of
       * function pointers, no string compare. */
      kit_.With(pad, [f, v](auto& voice) { voice.NoteOn(f, v); });
    }
  }

  /* Render one block, splitting it wherever a sequencer step falls so a
   * hit lands on the exact sample rather than the block boundary. This is
   * the same block-splitting idea the kernel uses. */
  void operator()(float* l, float* r, int from, int to) {
    int i = from;
    while (i < to) {
      if (countdown_ <= 0) {
        Step();
        countdown_ = samples_per_step_;
      }
      int span = to - i;
      if (span > countdown_) span = countdown_;
      kit_.ForEach([l, r, i, span](auto& voice) { voice.Process(l, r, i, i + span); });
      i += span;
      countdown_ -= span;
    }
  }

 private:
  bellows::Rng rng_;
  bellows::Bank<bellows::Kick, bellows::Snare, bellows::Hat> kit_;
  bellows::Euclid<16> pattern_[kPadCount];
  float hz_[kPadCount] = {0.0f, 0.0f, 0.0f};
  float vel_[kPadCount] = {0.0f, 0.0f, 0.0f};
  float sr_ = 48000.0f;
  int samples_per_step_ = 1;
  int countdown_ = 0;
};

}  // namespace drummachine
