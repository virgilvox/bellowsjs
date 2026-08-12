/* Shared patch for the output examples 10 through 14.
 *
 * A plucked chord arriving one note at a time. It exists to give the
 * output examples something with real dynamic range to push through a
 * converter: a kick tells you the wiring works, a decaying string tells
 * you whether the noise floor and the headroom are where you think.
 *
 * WHY THIS FILE IS FULL OF BOARD CONDITIONALS
 *
 * A Karplus-Strong string IS its delay line, and the line has to be long
 * enough for the lowest note it will ever play: at 48 kHz a 20 Hz floor is
 * 2404 samples, which is 9.6 KB of float per voice. Four voices is 38 KB,
 * and a Teensy 3.2 has 64 KB in total with the audio library already in
 * it. Measured, before this file knew what board it was on: `.bss' will
 * not fit in region `RAM', overflowed by 61540 bytes.
 *
 * So the floor is a template parameter, and choosing it is the single most
 * consequential decision in an embedded bellows patch. Raising it from
 * 20 Hz to 100 Hz costs five times less RAM per voice and costs nothing
 * else, as long as no note goes below it. The chord here bottoms out at
 * 110 Hz, so 100 is free on the small boards.
 *
 * This is not a workaround, it is the design: every buffer-owning class in
 * the library takes its size at compile time so the sketch decides, and
 * the library never allocates.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"

namespace audioshield {

/* Lowest note the strings must be able to play, and how many of them.
 *
 *   Teensy 4.x     512 KB    the full range, four voices, nothing to think about
 *   Teensy 3.5/3.6 256 KB    the same, with room to spare
 *   Teensy 3.2      64 KB    a 100 Hz floor and two voices fits with room
 *   Teensy LC        8 KB    does not fit at all, see examples/README.md
 */
#if !defined(AUDIOSHIELD_MIN_HZ)
#if defined(__IMXRT1062__) || defined(__MK64FX512__) || defined(__MK66FX1M0__)
#define AUDIOSHIELD_MIN_HZ 20
#define AUDIOSHIELD_VOICES 4
#else
#define AUDIOSHIELD_MIN_HZ 100
#define AUDIOSHIELD_VOICES 2
#endif
#endif

/* Overridable so the size-report sketch can pin a configuration. Without
 * that, the freestanding build defines none of the board macros, silently
 * takes the small branch, and the reported cost would be for a patch no
 * Teensy 4.1 sketch ever compiles. */
inline constexpr int kMinHz = AUDIOSHIELD_MIN_HZ;
inline constexpr int kVoices = AUDIOSHIELD_VOICES;

using String = bellows::Pluck<kMinHz>;

/* A minor 7th, which spreads across the octave without any note masking
 * another, so a fault in one voice is audible rather than hidden. The
 * lowest note is 110 Hz, comfortably above the 100 Hz floor above; drop
 * a note below kMinHz and Pluck clamps it, which sounds like the chord
 * silently changing shape. */
inline constexpr float kChordHz[4] = {110.0f, 130.81f, 164.81f, 196.0f};

class Patch {
 public:
  void Init(float sample_rate) {
    /* One seeded stream per voice, forked from a named root. Two boards
     * running this sketch produce the same excitation burst in the same
     * voice on the same note, which is what makes "does this board sound
     * different" a question with an answer. */
    rng_.Init("audioshield");
    String::Params p;
    p.damp = 0.3f;      /* a touch brighter than the 0.35 default */
    p.decay = 3.0f;     /* and ringing longer, so the tail is audible */
    p.pick_pos = 0.22f;
    for (int i = 0; i < kVoices; ++i) {
      voice_rng_[i].Init(rng_.NextU32());
      pluck_[i].Init(sample_rate, &voice_rng_[i], p);
    }
  }

  /* Round robin, so a fast pattern overlaps its own tails instead of
   * cutting them. */
  void Strike(int index, float vel) {
    const int i = index % kVoices;
    pluck_[i].NoteOn(kChordHz[index % 4], vel);
  }

  /* Voices ADD into the range, so the caller owns clearing the block. */
  void operator()(float* l, float* r, int from, int to) {
    for (int i = 0; i < kVoices; ++i) pluck_[i].Process(l, r, from, to);
  }

 private:
  bellows::Rng rng_;
  bellows::Rng voice_rng_[kVoices];
  String pluck_[kVoices];
};

}  // namespace audioshield
