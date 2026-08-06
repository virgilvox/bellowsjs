/* Transcription of src/theory/tuning.ts. Tuning and DegreeFreq.
 *
 * A tuning maps note indices to frequencies and is periodic: `size`
 * degrees span one period, usually an octave. 12-EDO at A4 = 440 is the
 * default, never an assumption. Every pitch in the library is supposed to
 * pass through a tuning on its way to a voice, which is what lets a patch
 * run in 19-EDO, in a Werckmeister temperament, or in a five-note just
 * scale without a single engine knowing about it.
 *
 * The representation is a cents table, exactly as in the JS.
 * degree_cents[d] is the offset in cents of degree d above the reference
 * index, one period spans period_cents, and
 *
 *   FreqOf(ref_index + k * size + d)
 *     = ref_freq * 2 ^ ((k * period_cents + degree_cents[d]) / 1200)
 *
 * so the whole thing is an integer divide, a table read, and one Exp2.
 *
 * Entries may be NaN to mark an unmapped key, which is what a Scala .kbm
 * file expresses with a hole in its mapping; FreqOf returns NaN for those
 * indices and IsMapped tells you in advance. Fractional indices
 * interpolate linearly in cents between the neighbouring integers, and
 * that is the piece that makes pitch bend, glide, and vibrato behave
 * through an unequal tuning: bending a fifth up one step travels the real
 * width of that step, not a nominal 100 cents.
 *
 * kMaxDegrees is a template parameter because the table has to be fixed
 * size on an MCU, and it is the only thing the caller has to decide.
 * Tuning<12> is 68 bytes, Tuning<31> is 144. Nothing here allocates, and
 * nothing here knows about sample rates or audio buffers.
 *
 * One deliberate difference from the JS: transposition mutates in place
 * instead of returning a new tuning, since copying a table to change one
 * float would be a strange thing to ask an embedded target to do. Copy
 * the object first if you want both.
 */
#pragma once
#include <math.h>
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"

namespace bellows {
namespace tuning_detail {

/*
 * Base-two logarithm for the ratio-to-cents conversion, accurate to about
 * a thousandth of a cent and identical under every build flag.
 *
 * The rest of the library goes through fm:: precisely so one flag can
 * trade accuracy for cycles, and for a filter coefficient or an envelope
 * that is the right trade. It is the wrong trade here. This runs once,
 * when a tuning is built, and its result is the definition of a pitch: an
 * error of a few cents in fm::Exp2 on the way out is inaudible, but the
 * same error baked into the table is a note that is permanently, audibly
 * wrong. So the setup path pays for its own logarithm, which is also the
 * reason not to reach for libm here: log2f would drag a kilobyte and a
 * half of newlib into any sketch that mentions a just ratio.
 *
 * Method: pull the exponent out of the float, halve the mantissa when it
 * is above sqrt 2 so the remainder lands in [0.707, 1.414], then three
 * terms of the atanh series ln(m) = 2 (s + s^3/3 + s^5/5 + ...) with
 * s = (m - 1) / (m + 1), where |s| stays under 0.172 and the series has
 * long since fallen below float precision. Expects a normalized positive
 * float, which every callable ratio is.
 */
inline float Log2Ratio(float x) {
  union {
    float f;
    int32_t i;
  } u;
  u.f = x;
  int e = ((u.i >> 23) & 0xff) - 127;
  u.i = (u.i & 0x007fffff) | 0x3f800000; /* mantissa into [1, 2) */
  float m = u.f;
  if (m > 1.41421356f) {
    m *= 0.5f;
    ++e;
  }
  const float s = (m - 1.0f) / (m + 1.0f);
  const float s2 = s * s;
  const float ln = 2.0f * s * (1.0f + s2 * (0.333333333f + s2 * (0.2f + s2 * 0.142857143f)));
  return static_cast<float>(e) + ln * 1.44269504088896f;
}

/* Ratio to cents, the one conversion just intonation needs. */
inline float RatioToCents(float ratio) { return 1200.0f * Log2Ratio(ratio); }

}  // namespace tuning_detail

template <int kMaxDegrees = 12>
class Tuning {
 public:
  static_assert(kMaxDegrees >= 1, "Tuning needs room for at least one degree");

  /* 12-EDO, A4 = 440 at index 69, so an untouched Tuning is standard MIDI
   * tuning and FreqOf(midi) is the usual 440 * 2^((m - 69) / 12). */
  Tuning() { InitEdo(kMaxDegrees < 12 ? kMaxDegrees : 12); }

  /* Equal divisions of the octave. InitEdo(12) is standard MIDI tuning,
   * InitEdo(19) and InitEdo(31) are the meantone-flavoured ones worth
   * hearing. n is clamped to [1, kMaxDegrees]. */
  void InitEdo(int n, float ref_freq = 440.0f, int ref_index = 69) {
    n = ClampI(n, 1, kMaxDegrees);
    for (int i = 0; i < n; ++i) degree_cents_[i] = 1200.0f * static_cast<float>(i) / static_cast<float>(n);
    size_ = n;
    period_cents_ = 1200.0f;
    SetReference(ref_freq, ref_index);
  }

  /* Just intonation from frequency ratios. ratios[0] is normally 1, the
   * base degree; period is the repetition ratio, 2 for an octave. A
   * non-positive ratio maps that degree to NaN rather than failing the
   * whole tuning, so one bad entry in a table costs one key. */
  void InitJi(const float* ratios, int count, float base_freq = 440.0f, int base_index = 69,
              float period = 2.0f) {
    if (ratios == nullptr || count < 1) {
      InitEdo(kMaxDegrees < 12 ? kMaxDegrees : 12, base_freq, base_index);
      return;
    }
    count = ClampI(count, 1, kMaxDegrees);
    for (int i = 0; i < count; ++i) {
      const float r = ratios[i];
      degree_cents_[i] = (r > 0.0f) ? tuning_detail::RatioToCents(r) : NAN;
    }
    size_ = count;
    period_cents_ = (period > 1.0f) ? tuning_detail::RatioToCents(period) : 1200.0f;
    SetReference(base_freq, base_index);
  }

  /* From a cents table, the form a Scala .scl file reduces to. cents[i] is
   * the offset of degree i above the reference index and period is the
   * width of one repetition in cents. NaN entries mark unmapped keys and
   * are passed through untouched. */
  void InitCents(const float* cents, int count, float period = 1200.0f, float ref_freq = 440.0f,
                 int ref_index = 69) {
    if (cents == nullptr || count < 1) {
      InitEdo(kMaxDegrees < 12 ? kMaxDegrees : 12, ref_freq, ref_index);
      return;
    }
    count = ClampI(count, 1, kMaxDegrees);
    for (int i = 0; i < count; ++i) degree_cents_[i] = cents[i];
    size_ = count;
    period_cents_ = (period > 0.0f) ? period : 1200.0f;
    SetReference(ref_freq, ref_index);
  }

  /* Value-returning factories, for the one-liner at the top of a sketch.
   * They cost a copy of the table, so prefer the Init forms inside a
   * loop or a constructor. */
  static Tuning Edo(int n, float ref_freq = 440.0f, int ref_index = 69) {
    Tuning t;
    t.InitEdo(n, ref_freq, ref_index);
    return t;
  }

  static Tuning Ji(const float* ratios, int count, float base_freq = 440.0f, int base_index = 69,
                   float period = 2.0f) {
    Tuning t;
    t.InitJi(ratios, count, base_freq, base_index, period);
    return t;
  }

  static Tuning FromCents(const float* cents, int count, float period = 1200.0f,
                          float ref_freq = 440.0f, int ref_index = 69) {
    Tuning t;
    t.InitCents(cents, count, period, ref_freq, ref_index);
    return t;
  }

  int Size() const { return size_; }
  float PeriodCents() const { return period_cents_; }
  float RefFreq() const { return ref_freq_; }
  int RefIndex() const { return ref_index_; }
  float DegreeCents(int d) const { return degree_cents_[ClampI(d, 0, size_ - 1)]; }

  /* Cents of a note index relative to the reference:
   * FreqOf(i) = RefFreq() * 2 ^ (CentsOf(i) / 1200). */
  float CentsOf(int index) const { return CentsAt(index); }

  /* Fractional indices interpolate linearly in cents, which is what makes
   * a pitch bend land in the right place in an unequal tuning. */
  float CentsOf(float index) const {
    const float fi = floorf(index);
    const int i0 = static_cast<int>(fi);
    const float t = index - fi;
    const float c0 = CentsAt(i0);
    if (t == 0.0f) return c0;
    return c0 + t * (CentsAt(i0 + 1) - c0);
  }

  /* Frequency in Hz of a note index. NaN for an unmapped index. */
  float FreqOf(int index) const { return FreqFromCents(CentsAt(index)); }
  float FreqOf(float index) const { return FreqFromCents(CentsOf(index)); }

  /* Alias for FreqOf. For 12-EDO the index is the MIDI note number. */
  float MidiToFreq(int midi) const { return FreqOf(midi); }
  float MidiToFreq(float midi) const { return FreqOf(midi); }

  /* False when the degree this index lands on is a hole in the mapping. */
  bool IsMapped(int index) const {
    const float c = CentsAt(index);
    return c == c; /* NaN is the only value not equal to itself. */
  }

  /* Raise every pitch by the given cents. */
  void TransposeCents(float cents) {
    if (cents == cents) ref_freq_ *= fm::CentsRatio(cents);
  }

  /* Multiply every pitch by the given ratio. */
  void TransposeRatio(float ratio) {
    if (ratio > 0.0f) ref_freq_ *= ratio;
  }

  /* Make each index sound like index + steps did before, by sliding the
   * reference rather than rewriting the table. */
  void TransposeSteps(int steps) { ref_index_ -= steps; }

 private:
  void SetReference(float ref_freq, int ref_index) {
    ref_freq_ = (ref_freq > 0.0f) ? ref_freq : 440.0f;
    ref_index_ = ref_index;
  }

  /* Floor division, kept private so this header depends on nothing but
   * config and fastmath. C truncates toward zero, and an index below the
   * reference needs the floor to land in the period below. */
  static int FloorDivInt(int a, int b) {
    const int q = a / b;
    return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q;
  }

  float CentsAt(int index) const {
    const int rel = index - ref_index_;
    const int oct = FloorDivInt(rel, size_);
    const int deg = rel - oct * size_;
    return static_cast<float>(oct) * period_cents_ + degree_cents_[deg];
  }

  /* Guard the NaN before it reaches Exp2: the fast-math path converts the
   * integer part of its argument with a cast, and casting NaN to int is
   * undefined. */
  float FreqFromCents(float cents) const {
    if (cents != cents) return NAN;
    return ref_freq_ * fm::CentsRatio(cents);
  }

  float degree_cents_[kMaxDegrees];
  float period_cents_ = 1200.0f;
  float ref_freq_ = 440.0f;
  int size_ = 1;
  int ref_index_ = 69;
};

/* Standard MIDI tuning, and the type most sketches want. */
using Tuning12 = Tuning<12>;

/* Scale degree to frequency through a tuning. intervals lists tuning
 * steps above the root, for example {0, 2, 4, 5, 7, 9, 11} for major in
 * 12-EDO, or {0, 3, 6, 9, 12, 15, 18} for the same shape in 19. Degrees
 * outside [0, count) wrap and shift by whole periods, so degree -1 is the
 * top interval one period down; octave shifts by whole periods too.
 *
 * Templated on the interval element type so it takes the uint8_t table a
 * Scale hands out, an int8_t table, or a plain int array, without this
 * header having to know that scales.h exists. */
template <class TuningT, class IntervalT>
inline float DegreeFreq(const TuningT& tuning, int root_index, const IntervalT* intervals,
                        int count, int degree, int octave = 0) {
  if (intervals == nullptr || count < 1) return NAN;
  const int q = degree / count;
  const int wrap = (degree % count != 0 && degree < 0) ? q - 1 : q;
  const int step = static_cast<int>(intervals[degree - wrap * count]);
  return tuning.FreqOf(root_index + (octave + wrap) * tuning.Size() + step);
}

}  // namespace bellows
