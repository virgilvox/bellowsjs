/* 20_Instruments patch: acid bass.
 *
 * One oscillator, one filter, and the filter is the instrument. A 303 has
 * no second oscillator, no chorus and no reverb, and it has been the sound
 * of a genre for forty years because of what its envelope does to a
 * resonant lowpass: a fast, deep sweep on every note, deep enough that the
 * filter's own resonant peak is the loudest thing in the sound for the
 * first tenth of a second.
 *
 * So the numbers here are lopsided on purpose. Resonance sits at 0.88,
 * which is close enough to self-oscillation that the peak sings. The
 * filter envelope decays in 180 ms while the amplitude envelope takes
 * 400, so the brightness is gone long before the note is. env_amount is
 * most of the range rather than a seasoning.
 *
 * Accent is velocity, and it moves the filter rather than the volume,
 * which is `vel_filter`. That is the one control that makes a line of
 * sixteenths sound played rather than typed, and it is why the player
 * gives this patch a euclidean rhythm instead of a straight run.
 */
#pragma once

#include "bellows/engines/va.h"

#include "player.h"

namespace acid {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 1.54f;

inline constexpr player::Kind kKind = player::Kind::kBass;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    bellows::Va::Params p;
    p.shape = 0.0f;        /* saw. A square here is the other classic */
    p.detune = 0.0f;       /* one oscillator, as the original has */
    p.sub = 0.0f;
    p.cutoff = 320.0f;     /* where the sweep lands, not where it starts */
    p.resonance = 0.88f;   /* close enough to sing */
    p.env_amount = 0.85f;  /* most of the range: this is the sound */
    p.attack = 0.002f;
    p.decay = 0.4f;
    p.sustain = 0.0f;
    p.release = 0.06f;
    p.f_attack = 0.001f;
    p.f_decay = 0.18f;     /* brightness gone well before the note is */
    p.f_sustain = 0.0f;
    p.f_release = 0.05f;
    p.vel_level = 0.2f;
    p.vel_filter = 0.8f;   /* accent moves the filter, not the volume */
    voice_.Init(sample_rate, rng, p);
  }

  /* Monophonic, like the machine. A new note simply retriggers. */
  void NoteOn(int, float hz, float vel) { voice_.NoteOn(hz, vel); }
  void NoteOff(int) { voice_.NoteOff(); }

  void operator()(float* l, float* r, int from, int to) { voice_.Process(l, r, from, to); }

 private:
  bellows::Va voice_;
};

}  // namespace acid
