/* 20_Instruments patch: west coast complex oscillator.
 *
 * The other tradition. East coast synthesis starts with a harmonically
 * rich waveform and takes things away with a filter; west coast starts
 * with a sine and MAKES harmonics, by folding the waveform back on itself
 * every time it exceeds a threshold. There is no filter in this patch at
 * all.
 *
 * Folding is loud in a way subtraction is not. Each fold adds a corner to
 * the waveform, and a corner is a whole series of harmonics, so driving
 * the folder harder does not make the sound louder so much as denser. The
 * fold envelope is therefore the main gesture: fold_env moves the drive
 * across the note, so a struck note starts dense and thins out, which is
 * how a real physical resonator behaves and is what a filter sweep is
 * imitating from the other direction.
 *
 * The low pass gate is the other half of the idea, and it is not a VCA. A
 * vactrol responds slowly and unevenly, and it closes brightness and
 * volume TOGETHER, so quiet also means dull. That coupling is why this
 * sounds like something being struck rather than something being turned
 * down, and lpg_decay is the knob that decides whether it is a bongo or a
 * bass.
 *
 * The fold chain runs at 4x internally with an antialiasing filter, added
 * after an audit found it folding at 1x and aliasing loudly. It is the
 * most expensive patch here for that reason.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/westcoast.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace westcoast {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 1.81f;

inline constexpr player::Kind kKind = player::Kind::kMelody;
inline constexpr int kVoices = 2;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng*) {
    bellows::WestCoast::Params p;
    p.fold_amount = 0.55f;   /* how hard the sine is driven into the folds */
    p.fold_stages = 3.0f;    /* how many times it can turn back */
    p.fold_env = 0.65f;      /* dense on the strike, thinner as it decays */
    p.lpg_color = 0.6f;      /* vactrol: quiet and dull arrive together */
    p.lpg_decay = 0.42f;
    p.level = 0.7f;
    for (int i = 0; i < kVoices; ++i) pool_.at(i).Init(sample_rate, p);
  }

  void NoteOn(int id, float hz, float vel) { pool_.NoteOn(id, hz, vel, frame_); }
  void NoteOff(int id) { pool_.NoteOff(id); }

  void operator()(float* l, float* r, int from, int to) {
    pool_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  bellows::VoicePool<bellows::WestCoast, kVoices> pool_;
  uint32_t frame_ = 0;
};

}  // namespace westcoast
