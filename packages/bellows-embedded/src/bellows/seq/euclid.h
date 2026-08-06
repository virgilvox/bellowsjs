/* Transcription of src/seq/euclid.ts.
 *
 * Euclidean rhythms via Bjorklund's algorithm: distribute `pulses` onsets
 * as evenly as possible over `steps` slots. This is the true recursive
 * bucket pairing (repeatedly zip the shorter group list into the longer),
 * not the naive floor accumulator, so E(3, 8) is the tresillo
 * [1,0,0,1,0,0,1,0] and E(5, 8) the cinquillo [1,0,1,1,0,1,1,0]. The two
 * agree for E(3, 8) and disagree by E(5, 8), which is why the accumulator
 * shortcut is not used here.
 *
 * The JS builds arrays of arrays and concatenates them. That is out of
 * the question on a microcontroller, so this version exploits an
 * invariant the JS never names: at every round of the pairing, all groups
 * in `a` hold identical contents and all groups in `b` hold identical
 * contents. It starts true ([1] and [0]), and each round forms every new
 * a-group as (A ++ B) and takes the leftovers from one list only, so it
 * stays true. The whole state is therefore two bit patterns and two
 * counts, and the pattern flattens to na copies of A followed by nb
 * copies of B. No allocation, no recursion, and the output is bit for bit
 * what the JS returns.
 *
 * Rotation is folded into the write, not applied as a second pass: the
 * JS rotates left, so flat[j] lands at index (j - rotation) mod steps.
 *
 * The pattern is stored as a bitmask rather than one byte per step, so
 * Euclid<64> costs 8 bytes of state plus the cursor.
 */
#pragma once
#include <stdint.h>

namespace bellows {

template <int kMaxSteps = 32>
class Euclid {
 public:
  static_assert(kMaxSteps >= 1, "Euclid needs room for at least one step");
  static constexpr int kCapacity = kMaxSteps;

  /* Empty pattern: Length() is 0 and Process() returns false forever. */
  void Init() {
    len_ = 0;
    pulses_ = 0;
    pos_ = 0;
    for (int i = 0; i < kWords; ++i) bits_[i] = 0;
  }

  void Init(int pulses, int steps) { Init(); Generate(pulses, steps, 0); }

  bool Generate(int pulses, int steps) { return Generate(pulses, steps, 0); }

  /* Build E(pulses, steps) rotated left by `rotation`.
   *
   * Where the JS throws a RangeError this returns false and leaves the
   * previous pattern and cursor untouched: steps outside [1, kMaxSteps],
   * or pulses outside [0, steps]. Nothing is clamped silently, because a
   * silently shortened rhythm is worse than an obvious no-op. */
  bool Generate(int pulses, int steps, int rotation) {
    if (steps < 1 || steps > kMaxSteps) return false;
    if (pulses < 0 || pulses > steps) return false;

    int rot = rotation % steps;
    if (rot < 0) rot += steps;

    for (int i = 0; i < kWords; ++i) bits_[i] = 0;
    len_ = steps;
    pulses_ = pulses;
    if (pos_ >= len_) pos_ = 0;

    if (pulses == 0) return true;
    if (pulses == steps) {
      for (int i = 0; i < steps; ++i) SetBit(bits_, i, true);
      return true;
    }

    /* a starts as `pulses` groups of [1], b as the rest as groups of [0]. */
    uint32_t ga[kWords] = {};
    uint32_t gb[kWords] = {};
    uint32_t tmp[kWords] = {};
    SetBit(ga, 0, true);
    int la = 1, na = pulses;
    int lb = 1, nb = steps - pulses;

    while (nb > 1) {
      const int n = na < nb ? na : nb;
      const int lp = la + lb;
      for (int i = 0; i < la; ++i) SetBit(tmp, i, GetBit(ga, i));
      for (int i = 0; i < lb; ++i) SetBit(tmp, la + i, GetBit(gb, i));
      if (na > n) {
        /* Leftovers come from a, so the new remainder is the old A. */
        for (int i = 0; i < kWords; ++i) gb[i] = ga[i];
        lb = la;
        nb = na - n;
      } else {
        nb = nb - n;
      }
      for (int i = 0; i < kWords; ++i) ga[i] = tmp[i];
      la = lp;
      na = n;
    }

    int j = 0;
    for (int g = 0; g < na; ++g) {
      for (int i = 0; i < la; ++i) Place(GetBit(ga, i), j++, rot, steps);
    }
    for (int g = 0; g < nb; ++g) {
      for (int i = 0; i < lb; ++i) Place(GetBit(gb, i), j++, rot, steps);
    }
    return true;
  }

  /* Gate at `i`. The index wraps in both directions, so a sequencer can
   * hand this a free-running counter. Returns false for an empty map. */
  bool At(int i) const {
    if (len_ == 0) return false;
    i %= len_;
    if (i < 0) i += len_;
    return GetBit(bits_, i);
  }

  /* Gate at the cursor, then advance one step. */
  bool Process() {
    if (len_ == 0) return false;
    const bool v = GetBit(bits_, pos_);
    ++pos_;
    if (pos_ >= len_) pos_ = 0;
    return v;
  }

  void Reset() { pos_ = 0; }
  int Position() const { return pos_; }
  int Length() const { return len_; }
  int Pulses() const { return pulses_; }

 private:
  static constexpr int kWords = (kMaxSteps + 31) / 32;

  static void SetBit(uint32_t* w, int i, bool v) {
    const uint32_t m = 1u << (i & 31);
    if (v) w[i >> 5] |= m;
    else w[i >> 5] &= ~m;
  }

  static bool GetBit(const uint32_t* w, int i) {
    return ((w[i >> 5] >> (i & 31)) & 1u) != 0u;
  }

  /* flat position j of the unrotated pattern, written where a left
   * rotation by `rot` puts it. */
  void Place(bool v, int j, int rot, int steps) {
    int d = j - rot;
    if (d < 0) d += steps;
    SetBit(bits_, d, v);
  }

  uint32_t bits_[kWords] = {};
  int len_ = 0;
  int pulses_ = 0;
  int pos_ = 0;
};

}  // namespace bellows
