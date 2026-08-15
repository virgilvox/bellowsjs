/* Transcription of src/engines/additive.ts.
 *
 * A bank of sine partials, each with its own level, detune and
 * exponential decay, summed and gated by one amp ADSR. Partial k runs at
 * f0 * k * sqrt(1 + B k^2) * 2^(cents/1200): the square root is the
 * inharmonicity stretch that pushes upper partials sharp the way a stiff
 * string or a struck bar does, and B = 0 gives an exactly harmonic
 * spectrum. Partial k decays with time constant decay * rolloff^(k - 1),
 * so with rolloff below 1 the top of the spectrum dies first and the tone
 * darkens as it rings. morph crossfades every level from the partial
 * frame to the target frame, 0 for A and 1 for B.
 *
 * The sum is divided by the summed levels (floored at 1) so a dense
 * spectrum does not clip, and partials at or above 0.45 of the sample
 * rate are dropped whenever the bank is rebuilt, which is what bounds the
 * count from above. The scan stops at the first partial over the limit
 * rather than skipping it, matching the JS break, so a detune that would
 * bring a later partial back under the limit does not resurrect it.
 *
 * PHASE IS A UINT32 COUNTER PER PARTIAL, which is the one place this file
 * departs from the JS by design. The JS keeps a Float64Array of phases;
 * the same array in float would lose part of every increment to rounding
 * as it approached 1.0, systematically rather than randomly, so the error
 * would grow with the length of the note (see the note on PhaseIncrement
 * in config.h, and the three parity rows it moved). A counter is 4 bytes
 * per partial against 8 for the double it replaces, the wrap is the
 * unsigned overflow so the inner loop needs no compare, and the increment
 * is exact for the life of the note.
 *
 * The template parameter bounds the bank so nothing allocates. 32 is the
 * default because that is the JS MAX_PARTIALS and the default spectrum is
 * a 32-partial sawtooth (1/n); the densest shipped preset, CHURCH ORGAN,
 * names 12 ranks. A smaller instantiation is legal and cheaper, and it
 * changes the sound rather than only the size: the level sum that
 * normalizes the output only counts the partials that exist, so
 * Additive<12> on default params is louder than Additive<32>, exactly as
 * the JS would be if its MAX_PARTIALS were 12.
 *
 * State is 20 bytes per partial plus a 12-byte Params entry, so the
 * default is 1.1 KB per voice with everything included.
 *
 * What is left against the double reference is a frequency offset, and
 * it was worth measuring rather than assuming. The parity row reads
 * 1.3e-4 rel rms over 16384 frames and 3.5e-5 over 4096, a factor of 3.7
 * for a factor of 4 in length, so the error grows with the note instead
 * of sitting at a rounding floor. Its source is the one rounding the
 * counter cannot remove: hz / sr_ below is a float divide, about 6e-8
 * relative, and at 16384 frames the 32nd partial has run 2614 cycles, so
 * 6e-8 of that is 1.6e-4 cycles of phase by the end. Rounding it in the
 * increment is what config.h predicts is left over, and here it is.
 *
 * The other suspect, the per partial decay, is a repeated multiply of a
 * float coefficient and so drifts by roughly the number of samples times
 * half an ulp. It turns out not to matter: with dec_state_ held in double
 * the row read 1.30e-4, the same to three figures, so the multiply is not
 * what this row is measuring and the state stays in float at 4 bytes.
 *
 * There are two parity rows because the engine's default record leaves
 * four things at zero. 'additive' is the defaults, a 32-partial sawtooth;
 * 'additive_morph' turns on the stretch, the cents conversion, the frame
 * morph and, at inharm 1/64, the Nyquist cut at partial 26, none of which
 * the first row touches at all.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/envelopes.h"

namespace bellows {

/* Partials must stay below this fraction of the sample rate. */
inline constexpr float kAdditiveFreqLimit = 0.45f;

template <int kMaxPartials = 32>
class Additive {
 public:
  /*
   * The three per partial rows are arrays rather than partial1..partial32
   * fields, so Params carries a constructor where the rest of the library
   * carries defaulted fields: a default member initializer cannot write
   * 1/n across an array whose length is a template parameter. It runs at
   * compile time when the caller writes `Additive<>::Params p;` at
   * namespace scope, and it allocates nothing either way.
   */
  struct Params {
    float morph = 0.0f;
    float inharm = 0.0f;
    float decay = 2.0f;
    float rolloff = 0.8f;
    float attack = 0.002f;
    float release = 0.3f;
    float gain = 1.0f;
    /* Frame A: a sawtooth, 1/n. Frame B: a pure sine. */
    float partial[kMaxPartials];
    float target[kMaxPartials];
    /* Per partial detune in cents. */
    float detune[kMaxPartials];

    constexpr Params() : partial{}, target{}, detune{} {
      for (int n = 0; n < kMaxPartials; ++n) {
        partial[n] = 1.0f / static_cast<float>(n + 1);
        target[n] = n == 0 ? 1.0f : 0.0f;
        detune[n] = 0.0f;
      }
    }
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    env_.Init(sample_rate);
    Apply();
  }

  /* Applied immediately, running or not, the same as the JS setParam. */
  void SetParams(const Params& p) {
    p_ = p;
    Apply();
  }

  void NoteOn(float freq, float vel) {
    freq_ = freq;
    vel_ = vel;
    for (int n = 0; n < kMaxPartials; ++n) {
      phase_[n] = 0u;
      dec_state_[n] = 1.0f;
    }
    env_.Reset();
    env_.Trigger();
    Apply();
  }

  void NoteOff() { env_.Release(); }

  void Process(float* l, float* r, int from, int to) {
    if (!env_.Active()) return;
    const int count = count_;
    const float norm = norm_ * kSqrtHalf;
    for (int i = from; i < to; ++i) {
      float acc = 0.0f;
      for (int n = 0; n < count; ++n) {
        phase_[n] += inc_[n];
        const float d = dec_state_[n];
        dec_state_[n] = d * dec_coef_[n];
        acc += level_[n] * d *
               fm::Sin(kTwoPi * (static_cast<float>(phase_[n]) * kPhaseToUnit));
      }
      const float y = acc * norm * env_.Process();
      l[i] += y;
      r[i] += y;
    }
  }

  bool Active() const { return env_.Active(); }

 private:
  /*
   * Frequencies, decay coefficients, morphed levels and the normalizer.
   *
   * Called from Init, SetParams and NoteOn, which is where the JS calls
   * apply(), so the partial count and the levels are always consistent
   * with the frequency the voice is playing.
   */
  void Apply() {
    env_.Set(p_.attack, 0.01f, 1.0f, p_.release);

    const float limit = sr_ * kAdditiveFreqLimit;
    const float b = p_.inharm;
    int count = 0;
    for (int n = 0; n < kMaxPartials; ++n) {
      const float k = static_cast<float>(n + 1);
      const float stretch = fm::Sqrt(1.0f + b * k * k);
      const float hz = freq_ * k * stretch * fm::CentsRatio(p_.detune[n]);
      /* A NaN freq fails this test and reaches PhaseIncrement, which
       * guards it: the increment comes back 0 rather than an undefined
       * cast. Nothing here indexes on a float, so that is the whole of
       * the exposure. */
      if (hz >= limit) break;
      inc_[n] = PhaseIncrement(hz / sr_);
      const float tau = p_.decay * fm::Pow(p_.rolloff, static_cast<float>(n));
      dec_coef_[n] = fm::Exp(-1.0f / (tau * sr_));
      count = n + 1;
    }
    count_ = count;

    const float morph = Clamp(p_.morph, 0.0f, 1.0f);
    float sum = 0.0f;
    for (int n = 0; n < count; ++n) {
      const float a = p_.partial[n];
      const float lvl = a + (p_.target[n] - a) * morph;
      level_[n] = lvl;
      sum += lvl;
    }
    /* Math.max(1, sum) in the JS, written so a NaN sum takes the 1 branch
     * instead of poisoning every sample the voice will ever emit. */
    norm_ = (p_.gain / (sum > 1.0f ? sum : 1.0f)) * vel_;
  }

  float sr_ = 48000.0f;
  Params p_;
  Adsr env_;

  uint32_t phase_[kMaxPartials] = {};
  uint32_t inc_[kMaxPartials] = {};
  float level_[kMaxPartials] = {};
  float dec_state_[kMaxPartials] = {};
  float dec_coef_[kMaxPartials] = {};
  int count_ = 0;

  float norm_ = 1.0f, freq_ = 220.0f, vel_ = 1.0f;
};

}  // namespace bellows
