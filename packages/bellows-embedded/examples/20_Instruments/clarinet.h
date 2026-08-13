/* 20_Instruments patch: clarinet.
 *
 * A waveguide, which is the other family of physical model. The string in
 * guitar.h is a delay line excited once and left to decay; a wind
 * instrument is a delay line driven CONTINUOUSLY by a nonlinear element at
 * one end, and that difference is the whole of why one dies away and the
 * other holds a note for as long as you have breath.
 *
 * The nonlinear element is the reed. Breath pressure pushes it toward the
 * mouthpiece, the pressure wave returning up the bore pushes it back, and
 * the reed's response to that sum is a curve rather than a line. A linear
 * reed would just move air. The curve is what turns steady pressure into
 * oscillation, and it is the same mechanism as a bow on a string.
 *
 * A clarinet is a cylinder closed at the reed, which is why it produces
 * mainly ODD harmonics and why it sounds hollow rather than bright. That
 * falls out of the tube geometry here rather than being filtered in.
 *
 * `breath` is the knob to turn and it is not a volume. Below a threshold
 * the reed never starts and you get air; just above it the tone is pure
 * and quiet; push it and the reed slams and the sound gets raucous. Real
 * players call that last part overblowing.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/tube.h"

#include "player.h"

namespace clarinet {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 0.41f;

inline constexpr player::Kind kKind = player::Kind::kMelody;

using Bore = bellows::Tube<110>;

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    Bore::Params p;
    p.breath = 0.82f;   /* over the threshold, under the slam */
    p.noise = 0.09f;    /* the air you hear around the tone */
    p.level = 0.6f;
    p.glide = 0.02f;
    voice_.Init(sample_rate, rng, p);
  }

  /* Monophonic, as the instrument is: one bore, one note. */
  void NoteOn(int, float hz, float vel) { voice_.NoteOn(hz, vel); }
  void NoteOff(int) { voice_.NoteOff(); }

  void operator()(float* l, float* r, int from, int to) { voice_.Process(l, r, from, to); }

 private:
  Bore voice_;
};

}  // namespace clarinet
