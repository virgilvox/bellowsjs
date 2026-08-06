/* Transcription of src/seq/automata.ts.
 *
 * Elementary cellular automata with Wolfram rule numbering and wrapping
 * edges. Bit b of the rule number gives the next state of the
 * neighbourhood (left << 2) | (centre << 1) | right = b, so rule 30 is
 * chaotic, rule 110 is the Turing-complete one, and rule 90 draws the
 * Sierpinski triangle. The default initial condition is a single live
 * cell in the middle of the row, as in the JS.
 *
 * Two deviations from the JS, both to save RAM without changing a single
 * output bit. The rule table is not expanded into eight bytes: the next
 * state is one shift and mask of the rule number, which is cheaper than
 * the load it replaces. And there is no scratch row. A generation can be
 * computed in place by carrying the previous cell's old value forward
 * and remembering the old cell 0 for the wrap at the right edge, so
 * ElementaryCa<32> costs 32 bytes rather than 64.
 *
 * The rhythm sampler writes into a caller-owned buffer, so nothing here
 * decides how long a pattern the user is allowed to want.
 */
#pragma once
#include <stdint.h>

#include "bellows/core/prng.h"

namespace bellows {

template <int kWidth = 32>
class ElementaryCa {
 public:
  static_assert(kWidth >= 1, "ElementaryCa needs at least one cell");
  static constexpr int kCells = kWidth;

  /* Single live cell in the centre, matching the JS default. */
  void Init(uint8_t rule) {
    rule_ = rule;
    generation_ = 0;
    for (int i = 0; i < kWidth; ++i) row_[i] = 0;
    row_[kWidth >> 1] = 1;
  }

  /* Random fill. The threshold matches the JS init() < 0.5. */
  void Init(uint8_t rule, Rng& rng) {
    rule_ = rule;
    generation_ = 0;
    for (int i = 0; i < kWidth; ++i) row_[i] = rng.Next() < 0.5f ? 0 : 1;
  }

  /* Explicit initial row. `cells` must hold kWidth entries; any non-zero
   * value counts as live. */
  void Init(uint8_t rule, const uint8_t* cells) {
    rule_ = rule;
    generation_ = 0;
    for (int i = 0; i < kWidth; ++i) row_[i] = cells[i] ? 1 : 0;
  }

  /* Swap in a new rule without disturbing the row or the generation
   * count, which is how a live performance patch changes rules. */
  void SetRule(uint8_t rule) { rule_ = rule; }
  uint8_t Rule() const { return rule_; }

  /* Advance one generation. Edges wrap. */
  void Step() {
    const uint8_t first = row_[0];
    uint8_t prev = row_[kWidth - 1];  /* left neighbour of cell 0, old value */
    for (int i = 0; i < kWidth; ++i) {
      const uint8_t centre = row_[i];
      const uint8_t right = (i + 1 < kWidth) ? row_[i + 1] : first;
      const int idx = (prev << 2) | (centre << 1) | right;
      row_[i] = static_cast<uint8_t>((rule_ >> idx) & 1u);
      prev = centre;
    }
    ++generation_;
  }

  /* Cell state, 0 or 1. The index wraps in both directions so a caller
   * can read a column offset from the centre without bounds checks. */
  uint8_t Cell(int i) const {
    i %= kWidth;
    if (i < 0) i += kWidth;
    return row_[i];
  }

  int Width() const { return kWidth; }
  uint32_t Generation() const { return generation_; }
  int Centre() const { return kWidth >> 1; }

  /* caRhythm from the JS: read one column, then step, `steps` times, and
   * leave the automaton advanced by `steps` generations. Writes 0 or 1
   * per step into the caller's buffer and returns the number written.
   * A column outside [0, kWidth) or a negative step count writes nothing
   * and leaves the automaton alone. */
  int Rhythm(uint8_t* out, int steps, int column) {
    if (column < 0 || column >= kWidth || steps < 0) return 0;
    for (int i = 0; i < steps; ++i) {
      out[i] = row_[column];
      Step();
    }
    return steps;
  }

  int Rhythm(uint8_t* out, int steps) { return Rhythm(out, steps, kWidth >> 1); }

 private:
  uint8_t row_[kWidth] = {};
  uint32_t generation_ = 0;
  uint8_t rule_ = 30;
};

}  // namespace bellows
