/* 20_Instruments patch: vowel choir.
 *
 * Formant synthesis. What makes a sung "ah" different from a sung "ee" is
 * not the pitch and not the waveform: it is which frequency BANDS are
 * loud, and those bands stay where they are when the pitch moves. That is
 * the definition of a formant and it is why you can recognise a vowel sung
 * high or low by the same voice.
 *
 * So the model is a buzzy source through a bank of fixed resonators. The
 * tables here are the bass register measurements from Csound's standard
 * formant data, five vowels by five formants, each with a frequency, a
 * bandwidth and a level.
 *
 * The vowel parameter morphs continuously between adjacent vowels, and
 * HOW it morphs is the part worth knowing: frequency interpolates in the
 * log domain and bandwidth linearly. Interpolating frequency linearly
 * walks through pitches that are not between the two vowels in any way a
 * listener agrees with, because hearing is logarithmic. Getting that wrong
 * is the difference between a vowel gliding and a filter sweeping.
 *
 * Vibrato is what stops it sounding like a machine, and it is drawn from
 * the rng at note-on rather than per sample so a retrigger cannot
 * diverge from the browser's stream.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/formant.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace choir {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 1.30f;

inline constexpr player::Kind kKind = player::Kind::kChord;
inline constexpr int kVoices = 3;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    bellows::Formant::Params p;
    p.vowel = 0.6f;           /* between "a" and "e" */
    p.breath = 0.14f;
    p.vibrato_rate = 4.6f;
    p.vibrato_depth = 0.3f;
    p.shape = 0.35f;
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
  bellows::VoicePool<bellows::Formant, kVoices> pool_;
  uint32_t frame_ = 0;
};

}  // namespace choir
