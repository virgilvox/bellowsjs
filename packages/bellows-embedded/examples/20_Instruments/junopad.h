/* 20_Instruments patch: chorused polysynth pad.
 *
 * The Juno trick, which is not a synthesis trick at all. The voice is
 * ordinary: one saw, a gentle lowpass, a slow attack. What made those
 * machines sound twice their size is a bucket-brigade chorus across the
 * whole output, so a single oscillator arrives at your ears twice with a
 * slowly varying delay between the copies, and the interference does the
 * widening.
 *
 * That is why the chorus is on the patch rather than on a send. It is not
 * an effect applied to this sound, it IS the sound, and turning mix to 0
 * leaves a thin four-voice pad that nobody would have bought.
 *
 * The sub oscillator is doing the other half of the work. A pad with no
 * bottom sits on top of a mix instead of in it, and one square an octave
 * down at 0.45 is cheaper than a second full oscillator and mostly
 * indistinguishable underneath a chorus.
 *
 * Slow attack means voices overlap, so the pool is four and steals from
 * the oldest released voice first. Drop it to two and the chords tear.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/fx/modfx.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace junopad {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 0.49f;

inline constexpr player::Kind kKind = player::Kind::kChord;
inline constexpr int kVoices = 4;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    bellows::Va::Params p;
    p.shape = 0.08f;      /* saw with a hint of the square in it */
    p.detune = 11.0f;
    p.sub = 0.45f;        /* the octave below, which is the body */
    p.cutoff = 2400.0f;
    p.resonance = 0.12f;  /* almost none: the chorus is the character */
    p.env_amount = 0.25f;
    p.attack = 0.45f;     /* slow enough that chords bloom */
    p.decay = 0.6f;
    p.sustain = 0.8f;
    p.release = 1.4f;
    p.f_attack = 0.6f;
    p.f_decay = 1.0f;
    p.f_sustain = 0.6f;
    p.f_release = 1.2f;
    for (int i = 0; i < kVoices; ++i) pool_.at(i).Init(sample_rate, rng, p);

    bellows::Chorus<>::Params c;
    c.rate = 0.62f;
    c.depth = 0.55f;
    c.mix = 0.5f;         /* the whole point. At 0 this is a thin pad */
    c.feedback = 0.1f;
    chorus_.Init(sample_rate, c);
  }

  void NoteOn(int id, float hz, float vel) { pool_.NoteOn(id, hz, vel, frame_); }
  void NoteOff(int id) { pool_.NoteOff(id); }

  void operator()(float* l, float* r, int from, int to) {
    pool_.Process(l, r, from, to);
    /* In place across the whole patch, which is where a Juno's chorus is:
     * after the voice mix, not per voice. */
    chorus_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  bellows::VoicePool<bellows::Va, kVoices> pool_;
  bellows::Chorus<> chorus_;
  uint32_t frame_ = 0;
};

}  // namespace junopad
