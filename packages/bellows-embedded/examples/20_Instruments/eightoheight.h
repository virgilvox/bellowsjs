/* 20_Instruments patch: the long-decay drum machine kit.
 *
 * 02_DrumMachine already shows the Bank and the euclidean patterns. This
 * one is here for the sound rather than the architecture, and for one
 * number in particular.
 *
 * The famous analogue kick is a bridged-T oscillator that is only just
 * damped enough to stop, so it rings for the best part of a second and
 * spends most of that time below 60 Hz. Everything people say about that
 * machine having "weight" is that decay figure. Take it from 0.4 to 1.1
 * and the same synthesis is a different instrument. It is also the one
 * setting most likely to disappear entirely on a small speaker or a piezo,
 * which is why 15_Piezo throws away everything under 1.2 kHz rather than
 * pretending.
 *
 * The pitch sweep is the other half. A drum head's tension drops as it
 * moves, so the pitch falls fast at the start of the hit; pitch_decay is
 * how fast, and short values give the click that lets a kick cut through
 * on a small speaker even when the body of it is inaudible there.
 *
 * The snare is noise plus two detuned tones, and `tone` balances them. The
 * hat is six square oscillators at inharmonic ratios through a highpass,
 * which is the standard trick and sounds nothing like noise because the
 * ratios are fixed rather than random.
 *
 * The kit tunes from the noteOn frequency, so it is playable up and down
 * the keyboard rather than being three fixed samples.
 */
#pragma once

#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"

#include "player.h"

namespace eightoheight {

/* Output trim, measured rather than guessed.
 *
 * The engines have no common loudness reference and nothing forces them to
 * agree: a struck wooden bar and a sustained reed are 30 dB apart on the
 * same settings, and an untrimmed patch library is one where changing
 * instrument means reaching for the volume. This number brings the patch to
 * the same RMS as the others through the shell's fader, taken from an
 * offline render of the actual part it plays. The master limiter catches
 * what is left, which on the plucked and struck patches is the transient. */
inline constexpr float kTrim = 0.29f;

inline constexpr player::Kind kKind = player::Kind::kPercussion;

/* Pad indices, in the order the player fires them. */
enum Pad { kKick = 0, kSnare, kHat, kPadCount };

class Patch {
 public:
  void Init(float sample_rate, bellows::Rng* rng) {
    bellows::Kick::Params k;
    k.click_tune = 7.0f;
    k.pitch_decay = 0.045f;  /* the click, and how fast the head detunes */
    k.decay = 1.1f;          /* the whole argument of this patch */
    k.drive = 2.6f;
    kick_.Init(sample_rate, k);

    bellows::Snare::Params s;
    s.tone = 0.36f;          /* toward the noise rather than the shells */
    s.decay = 0.24f;
    s.snap = 0.22f;
    snare_.Init(sample_rate, rng, s);

    bellows::Hat::Params h;
    h.decay = 0.055f;        /* closed. Open is anything past about 0.25 */
    h.tone = 1.0f;
    hat_.Init(sample_rate, h);
  }

  /* Pitched by pad rather than by note, which is what a kit is. The
   * frequency is the tuning, so these are not fixed samples. */
  void NoteOn(int pad, float, float vel) {
    switch (pad) {
      case kKick: kick_.NoteOn(48.0f, vel); break;
      case kSnare: snare_.NoteOn(185.0f, vel); break;
      case kHat: hat_.NoteOn(330.0f, vel); break;
      default: break;
    }
  }

  void NoteOff(int) {}

  void operator()(float* l, float* r, int from, int to) {
    kick_.Process(l, r, from, to);
    snare_.Process(l, r, from, to);
    hat_.Process(l, r, from, to);
  }

 private:
  bellows::Kick kick_;
  bellows::Snare snare_;
  bellows::Hat hat_;
};

}  // namespace eightoheight
