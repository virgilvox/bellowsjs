/* 20_Instruments patch: FM electric piano.
 *
 * The sound the DX7 sold a million of, and the reason it did is one
 * arrangement of two operators: a carrier at the fundamental and a
 * modulator a long way above it, with the modulator's envelope decaying
 * much faster than the carrier's. That gives a bright metallic strike that
 * dies away in a fraction of a second over a soft sustained body, which is
 * exactly what a tine and a pickup do and nothing like what a filter
 * sweep does.
 *
 * The numbers that matter here are the ratios. Ratio 1 is the
 * fundamental; ratio 14 is the tine, high and deliberately not a whole
 * multiple of anything you would call harmonic, which is why it reads as a
 * strike rather than as a note. Move it to 2 and this becomes an organ.
 *
 * Brightness scales the modulator depth, so it is the velocity knob a real
 * one has: hit it harder and the tine speaks louder before it dies. That
 * is wired to velocity through vel, not to a parameter, because it is a
 * property of playing rather than of the patch.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/fm.h"
#include "bellows/voicepool.h"

#include "player.h"

namespace epiano {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 0.47f;

inline constexpr player::Kind kKind = player::Kind::kChord;
inline constexpr int kVoices = 4;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng*) {
    bellows::Fm::Params p;
    p.ops = 4.0f;
    p.algorithm = 5.0f;   /* two carrier and modulator pairs */
    p.feedback = 0.12f;   /* a little grit on the strike */
    p.brightness = 0.62f;
    p.attack = 0.002f;
    p.decay = 1.6f;
    p.sustain = 0.28f;
    p.release = 0.5f;
    /* The tine: fast attack, fast decay, nothing held. */
    p.m_attack = 0.001f;
    p.m_decay = 0.16f;
    p.m_sustain = 0.0f;
    p.m_release = 0.12f;
    p.ratio[0] = 1.0f;
    p.ratio[1] = 14.0f;   /* the tine, high and inharmonic on purpose */
    p.ratio[2] = 1.0f;
    p.ratio[3] = 1.0f;
    p.level[0] = 1.0f;
    p.level[1] = 0.42f;
    p.level[2] = 0.5f;
    p.level[3] = 0.22f;
    for (int i = 0; i < kVoices; ++i) pool_.at(i).Init(sample_rate, p);
  }

  void NoteOn(int id, float hz, float vel) { pool_.NoteOn(id, hz, vel, frame_); }
  void NoteOff(int id) { pool_.NoteOff(id); }

  void operator()(float* l, float* r, int from, int to) {
    pool_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  bellows::VoicePool<bellows::Fm, kVoices> pool_;
  uint32_t frame_ = 0;
};

}  // namespace epiano
