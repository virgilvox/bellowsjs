/* 20_Instruments patch: tubular bells.
 *
 * Modal synthesis, which is the most direct kind of physical modelling
 * there is: an object that rings is a bank of resonators, so build the
 * bank. Each mode is a frequency ratio against the fundamental, a gain,
 * and its own decay time, and a struck object is that bank hit with a
 * short burst.
 *
 * A bell is the case that makes the method obvious, because a bell's
 * partials are not harmonic and cannot be produced by any oscillator that
 * assumes they are. The shipped bell material is 1, 2, 2.4, 3, 4.5, 5.33.
 * That 2.4 is the "minor third" partial that gives a large bell its
 * unsettled quality, and it is not 2.5 or 2.25 or anything a harmonic
 * series contains. Change it to 2.5 and the bell becomes a chime.
 *
 * Per mode decay is what makes it sound struck rather than played. The
 * fundamental rings for the full decay time and the upper modes fade at
 * 0.8, 0.7, 0.55 of it, so the sound gets purer as it dies. An object
 * whose partials all decayed together would sound like a filtered
 * oscillator.
 *
 * strike_hardness is the excitation, and it is the mallet. Soft misses the
 * upper modes entirely; hard puts energy into all of them at once.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/modal.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace bells {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 0.80f;

inline constexpr player::Kind kKind = player::Kind::kMelody;
inline constexpr int kVoices = 3;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    bellows::Modal::Params p;
    p.material = 2.0f;         /* bell: 1, 2, 2.4, 3, 4.5, 5.33 */
    p.decay = 4.5f;
    p.brightness = 0.62f;
    p.strike_hardness = 0.7f;  /* a hard mallet, so the upper modes speak */
    p.level = 0.55f;
    for (int i = 0; i < kVoices; ++i) pool_.at(i).Init(sample_rate, rng, p);
  }

  void NoteOn(int id, float hz, float vel) { pool_.NoteOn(id, hz, vel, frame_); }
  void NoteOff(int id) { pool_.NoteOff(id); }

  void operator()(float* l, float* r, int from, int to) {
    pool_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  bellows::VoicePool<bellows::Modal, kVoices> pool_;
  uint32_t frame_ = 0;
};

}  // namespace bells
