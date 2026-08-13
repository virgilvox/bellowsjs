/* 20_Instruments patch: glass.
 *
 * The third material, and the one that shows what the decay table is for.
 * Glass is 1, 2.32, 4.25, 6.63, 9.38: sparse, widely spaced, and nearly
 * undamped up high. Its upper modes hold 0.75, 0.5, 0.35 of the base
 * decay, where wood's hold 0.35, 0.18, 0.1.
 *
 * That is the whole difference between a wine glass and a marimba bar and
 * it is four numbers. A glass keeps its brightness most of the way through
 * the note, which is why a rubbed rim sings a clean high tone and a struck
 * bar cannot.
 *
 * Sparse partials are also why this reads as a pitched instrument at all
 * despite being inharmonic. Five modes with big gaps between them do not
 * fuse into a single perceived pitch the way a harmonic series does; you
 * hear the fundamental and then you hear the others as ringing. Give it a
 * long decay and a light strike and it becomes an ambient texture rather
 * than a note, which is what this patch is set for.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/modal.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace glass {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 1.22f;

inline constexpr player::Kind kKind = player::Kind::kMelody;
inline constexpr int kVoices = 3;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    bellows::Modal::Params p;
    p.material = 3.0f;         /* glass: sparse, and it keeps its top */
    p.decay = 6.0f;
    p.brightness = 0.8f;
    p.strike_hardness = 0.5f;  /* struck, not stroked, so it speaks at all */
    p.level = 0.9f;
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

}  // namespace glass
