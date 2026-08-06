/* Transcription of src/seq/arp.ts.
 *
 * Arpeggiator over MIDI note numbers. SetNotes expands the held notes
 * across the octave span and rebuilds the traversal cycle; Next() pulls
 * one note at a time so the scheduler keeps control of timing. 'updown'
 * and 'downup' never repeat the endpoints, so [a,b,c] plays a b c b a b
 * c b, and they degenerate correctly at one and two notes.
 *
 * The JS rebuilds two arrays on every setNotes. Here both are fixed:
 * pool_ holds the expanded notes and cycle_ holds indices into it, one
 * byte each, so the mode is a table lookup rather than a branch per step.
 * kMaxNotes bounds the expanded pool, not the chord, because the octave
 * span multiplies it: Arp<16> with octaves = 2 accepts eight held notes.
 * A cycle can be twice the pool minus two, hence the 2 * kMaxNotes.
 *
 * The pool's first Count() entries are the base chord, which is what
 * lets SetParams re-expand for a new octave span without asking the
 * caller for the notes again. One consequence of storing only the
 * expanded pool: the sort applied by every mode except 'order' is not
 * undoable, so switching to 'order' after the notes were sorted keeps
 * the sorted order until the next SetNotes.
 */
#pragma once
#include <stdint.h>

#include "bellows/core/prng.h"

namespace bellows {

enum class ArpMode : uint8_t {
  kUp = 0,
  kDown,
  kUpDown,
  kDownUp,
  kRandom,
  kOrder,
};

template <int kMaxNotes = 16>
class Arp {
 public:
  static_assert(kMaxNotes >= 1 && kMaxNotes <= 255,
                "Arp stores cycle entries as bytes, so the pool must fit in 255");
  static constexpr int kCapacity = kMaxNotes;

  struct Params {
    ArpMode mode = ArpMode::kUp;
    /* Octave span. 1 is the notes as given. Values below 1 are treated as 1. */
    int octaves = 1;
  };

  void Init() {
    Params d;
    Init(d);
  }

  void Init(const Params& p) {
    count_ = 0;
    base_ = 0;
    cycle_len_ = 0;
    index_ = 0;
    SetParams(p);
  }

  /* Changing the mode rebuilds the cycle in place; changing the octave
   * span re-expands the pool from the notes already held. */
  void SetParams(const Params& p) {
    p_ = p;
    if (p_.octaves < 1) p_.octaves = 1;
    Expand();
    BuildCycle();
  }

  /* Replace the held notes. The playback position is kept modulo the new
   * cycle length, so a chord change mid-pattern does not restart it.
   *
   * Returns false when notes had to be dropped: the expanded pool
   * (count * octaves) is capped at kMaxNotes, and the notes that fit are
   * taken from the front of the input. */
  bool SetNotes(const float* midis, int count) {
    bool ok = true;
    const int limit = kMaxNotes / p_.octaves;
    if (count > limit) {
      count = limit;
      ok = false;
    }
    if (count < 0) count = 0;
    for (int i = 0; i < count; ++i) pool_[i] = midis[i];
    base_ = count;
    /* 'order' keeps the given order per octave, every other mode sorts
     * ascending. Insertion sort: the chord is a handful of notes and
     * this runs at note-entry rate, never on the audio path. */
    if (p_.mode != ArpMode::kOrder) {
      for (int i = 1; i < base_; ++i) {
        const float v = pool_[i];
        int j = i - 1;
        while (j >= 0 && pool_[j] > v) {
          pool_[j + 1] = pool_[j];
          --j;
        }
        pool_[j + 1] = v;
      }
    }
    Expand();
    BuildCycle();
    return ok;
  }

  /* Next note of the cycle. Returns 0 when no notes are set, so check
   * Count() first if 0 is a note you can play. In kRandom mode without
   * an Rng this walks the pool in order rather than failing. */
  float Next() {
    if (cycle_len_ == 0) return 0.0f;
    const float v = pool_[cycle_[index_]];
    ++index_;
    if (index_ >= cycle_len_) index_ = 0;
    return v;
  }

  /* kRandom draws uniformly from the whole pool and does not touch the
   * cursor, matching the JS. Every other mode ignores the rng. */
  float Next(Rng& rng) {
    if (p_.mode != ArpMode::kRandom) return Next();
    if (count_ == 0) return 0.0f;
    /* Same truncation as the JS rng.int(n): (next() * n) | 0. */
    int i = static_cast<int>(rng.Next() * static_cast<float>(count_));
    if (i < 0) i = 0;
    if (i >= count_) i = count_ - 1;
    return pool_[i];
  }

  void Reset() { index_ = 0; }

  /* Size of the expanded pool, base chord times octaves. */
  int Count() const { return count_; }
  int CycleLength() const { return cycle_len_; }
  int Position() const { return index_; }
  bool Empty() const { return count_ == 0; }

 private:
  void Expand() {
    int n = base_;
    if (n * p_.octaves > kMaxNotes) {
      /* Only reachable when SetParams raises the octave span after the
       * notes were set. Drop base notes from the top rather than write
       * past the pool. */
      n = kMaxNotes / p_.octaves;
      base_ = n;
    }
    int w = n;
    for (int k = 1; k < p_.octaves; ++k) {
      for (int i = 0; i < n; ++i) pool_[w++] = pool_[i] + 12.0f * static_cast<float>(k);
    }
    count_ = w;
  }

  void BuildCycle() {
    const int n = count_;
    if (n == 0) {
      cycle_len_ = 0;
      index_ = 0;
      return;
    }
    switch (p_.mode) {
      case ArpMode::kDown:
        for (int i = 0; i < n; ++i) cycle_[i] = static_cast<uint8_t>(n - 1 - i);
        cycle_len_ = n;
        break;
      case ArpMode::kUpDown: {
        /* 2n - 2 for three notes and up, n below that: with one or two
         * notes there is no interior to fold back over. */
        const int m = n <= 2 ? n : 2 * n - 2;
        for (int i = 0; i < m; ++i) {
          cycle_[i] = static_cast<uint8_t>(i < n ? i : 2 * n - 2 - i);
        }
        cycle_len_ = m;
        break;
      }
      case ArpMode::kDownUp: {
        const int m = n <= 2 ? n : 2 * n - 2;
        for (int i = 0; i < m; ++i) {
          cycle_[i] = static_cast<uint8_t>(i < n ? n - 1 - i : i - n + 1);
        }
        cycle_len_ = m;
        break;
      }
      case ArpMode::kUp:
      case ArpMode::kRandom:
      case ArpMode::kOrder:
      default:
        for (int i = 0; i < n; ++i) cycle_[i] = static_cast<uint8_t>(i);
        cycle_len_ = n;
        break;
    }
    if (index_ >= cycle_len_) index_ %= cycle_len_;
  }

  Params p_;
  float pool_[kMaxNotes] = {};
  uint8_t cycle_[2 * kMaxNotes] = {};
  int base_ = 0;
  int count_ = 0;
  int cycle_len_ = 0;
  int index_ = 0;
};

}  // namespace bellows
