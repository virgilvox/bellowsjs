/* 20_Instruments patch: marimba.
 *
 * The same engine as bells.h with one number changed, and that is the
 * argument for modal synthesis in a sentence. Material 4 is wood: five
 * modes at 1, 2.572, 4.644, 6.984, 9.723, and a decay_base of 0.12
 * against the bell's 1.8.
 *
 * Fifteen times shorter is not a tweak, it is the difference between metal
 * and wood. Metal is stiff and lossless and rings for seconds; a wooden bar
 * dumps its energy into the air and into whatever it is resting on, so it
 * is over in a couple of hundred milliseconds. Everything else people
 * describe as the "warmth" of a marimba follows from that plus the upper
 * modes dying faster still: 0.35, 0.18, 0.1 of an already short base, so
 * within one note it becomes almost a sine.
 *
 * Compare this file against bells.h and glass.h side by side. Three
 * instruments, one engine, and what separates them is a table of ratios
 * and decay times that lives in engines/modal.h and costs nothing per
 * voice.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/modal.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace marimba {

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

inline constexpr player::Kind kKind = player::Kind::kMelody;
inline constexpr int kVoices = 3;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    bellows::Modal::Params p;
    p.material = 4.0f;         /* wood: fast, and faster in the upper modes */
    p.decay = 2.4f;
    p.brightness = 0.5f;
    p.strike_hardness = 0.62f;  /* a mallet with some weight behind it */
    p.level = 1.0f;
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

}  // namespace marimba
