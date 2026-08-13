/* 20_Instruments patch: plucked string.
 *
 * Karplus-Strong, which is the cheapest convincing physical model there
 * is: fill a delay line one period long with noise, then read it out and
 * feed it back through a gentle lowpass. The noise is the pluck, the delay
 * length is the pitch, and the lowpass is why the sound gets darker as it
 * decays, exactly as a real string does because its high partials lose
 * energy fastest.
 *
 * Two things here are not the textbook version and both matter.
 *
 * The delay is read with cubic interpolation at a fractional length. An
 * integer-rounded loop is in tune at the bottom of the range and 28 cents
 * flat by E7, because the rounding error is a fixed number of samples and
 * a sample is a bigger fraction of a short period. There is a test that
 * holds every pitched engine to 2 cents specifically to keep that fixed.
 *
 * pick_pos is a comb filter on the excitation, standing in for where along
 * the string you struck it. Near the bridge (small values) is thin and
 * bright; a quarter of the way along is the guitar sound. It is one delay
 * and a subtraction and it does more for realism than anything else in
 * the patch.
 *
 * The 110 Hz floor is a memory decision, not a musical one. The delay line
 * has to hold one period of the LOWEST note, so a 20 Hz floor is 9.6 KB
 * per voice at 48 kHz and a 110 Hz floor is a fifth of that. Four voices
 * of the first is 38 KB; a Teensy 3.2 has 64 KB with the audio library
 * already in it. Pluck::MinFreq() reports what you actually got.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace guitar {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 3.40f;

inline constexpr player::Kind kKind = player::Kind::kChord;
inline constexpr int kVoices = 4;

using String = bellows::Pluck<110>;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    String::Params p;
    p.damp = 0.28f;       /* how fast the top comes off. Higher is duller */
    p.pick_pos = 0.24f;   /* about where a plectrum lands */
    p.excite_type = 0.0f; /* noise burst rather than an impulse */
    p.decay = 3.2f;
    p.level = 0.75f;
    for (int i = 0; i < kVoices; ++i) pool_.at(i).Init(sample_rate, rng, p);
  }

  /* A string has no key to lift, so NoteOff is deliberately a palm mute
   * rather than a release, and the player does not use it. The pool frees
   * a voice as soon as it has decayed. */
  void NoteOn(int id, float hz, float vel) { pool_.NoteOn(id, hz, vel, frame_); }
  void NoteOff(int id) { pool_.NoteOff(id); }

  void operator()(float* l, float* r, int from, int to) {
    pool_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  bellows::VoicePool<String, kVoices> pool_;
  uint32_t frame_ = 0;
};

}  // namespace guitar
