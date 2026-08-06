/* Transcription of src/seq/lsystem.ts.
 *
 * Lindenmayer systems for melodic and rhythmic growth. Every symbol is
 * rewritten in parallel each generation, which is the whole point: the
 * classic algae system A -> AB, B -> A gives Fibonacci lengths only if
 * the generation is built from the old string, never from itself as it
 * is written. A rule is either a plain replacement or a weighted list of
 * alternatives; the stochastic form draws from a seeded Rng so the
 * expansion is reproducible. Symbols with no rule pass through.
 *
 * The JS grows a string. Here two fixed buffers alternate, so growth
 * costs 2 * (kMaxLen + 1) bytes and nothing else. Growth is explosive
 * (algae reaches 34 symbols by generation 8 and doubling systems reach
 * kMaxLen far sooner), so overflow is the normal case rather than the
 * exception, and it is defined: when a replacement does not fit whole,
 * that generation stops before writing it, the rest of the string is
 * dropped, Truncated() latches true, and Grow returns false without
 * attempting further generations. The result is always a valid
 * NUL-terminated prefix of what the JS would have produced up to that
 * generation.
 *
 * Rule text is not copied. A rule holds the caller's pointer, so string
 * literals stay in flash and never cost RAM. The strings and the weight
 * arrays must outlive the LSystem, which for literals means forever.
 */
#pragma once
#include <stdint.h>

#include "bellows/core/prng.h"

namespace bellows {

/* Sentinel degree meaning "rest" in a degree mapping, standing in for
 * the JS null. Chosen outside any plausible scale degree. */
inline constexpr int8_t kRestDegree = -128;

template <int kMaxLen = 128, int kMaxRules = 8>
class LSystem {
 public:
  static_assert(kMaxLen >= 1, "LSystem needs room for at least one symbol");
  static_assert(kMaxRules >= 1, "LSystem needs room for at least one rule");
  static constexpr int kCapacity = kMaxLen;

  void Init() {
    rules_ = 0;
    cur_ = 0;
    len_ = 0;
    truncated_ = false;
    buf_[0][0] = '\0';
    buf_[1][0] = '\0';
  }

  /* Set the starting string. Returns false, and keeps the previous
   * axiom, when it does not fit. */
  bool SetAxiom(const char* axiom) {
    int n = 0;
    while (axiom[n] != '\0') {
      if (n >= kMaxLen) return false;
      ++n;
    }
    for (int i = 0; i < n; ++i) buf_[cur_][i] = axiom[i];
    buf_[cur_][n] = '\0';
    len_ = n;
    truncated_ = false;
    return true;
  }

  /* Plain rule: every `sym` becomes `replacement`. Adding a rule for a
   * symbol that already has one replaces it. Returns false when the
   * rule table is full. */
  bool AddRule(char sym, const char* replacement) {
    Rule* r = Slot(sym);
    if (r == nullptr) return false;
    r->sym = sym;
    r->plain = replacement;
    r->outs = nullptr;
    r->weights = nullptr;
    r->count = 0;
    return true;
  }

  /* Stochastic rule: one of `count` alternatives, chosen by weight.
   * Both arrays are borrowed, not copied. */
  bool AddRule(char sym, const char* const* outs, const float* weights, int count) {
    if (count < 1) return false;
    Rule* r = Slot(sym);
    if (r == nullptr) return false;
    r->sym = sym;
    r->plain = nullptr;
    r->outs = outs;
    r->weights = weights;
    r->count = count;
    return true;
  }

  /* Rewrite `generations` times. Without an Rng a stochastic rule takes
   * its first alternative, which keeps the call deterministic instead of
   * failing the way the JS does. Returns false if growth was truncated. */
  bool Grow(int generations) { return Expand(generations, nullptr); }

  bool Grow(int generations, Rng& rng) { return Expand(generations, &rng); }

  /* NUL-terminated current string. Valid until the next Grow. */
  const char* Result() const { return buf_[cur_]; }
  int Length() const { return len_; }
  bool Truncated() const { return truncated_; }
  int RuleCount() const { return rules_; }

 private:
  struct Rule {
    char sym = '\0';
    const char* plain = nullptr;
    const char* const* outs = nullptr;
    const float* weights = nullptr;
    int count = 0;
  };

  /* Existing slot for `sym`, else a fresh one, else nullptr when full. */
  Rule* Slot(char sym) {
    for (int i = 0; i < rules_; ++i) {
      if (table_[i].sym == sym) return &table_[i];
    }
    if (rules_ >= kMaxRules) return nullptr;
    return &table_[rules_++];
  }

  const Rule* Find(char sym) const {
    for (int i = 0; i < rules_; ++i) {
      if (table_[i].sym == sym) return &table_[i];
    }
    return nullptr;
  }

  /* Same walk as the JS rng.weighted: subtract until the running total
   * goes non-positive, fall back to the last option. */
  static int Weighted(const float* w, int n, Rng* rng) {
    if (rng == nullptr) return 0;
    float total = 0.0f;
    for (int i = 0; i < n; ++i) total += w[i];
    float r = rng->Next() * total;
    for (int i = 0; i < n; ++i) {
      r -= w[i];
      if (r <= 0.0f) return i;
    }
    return n - 1;
  }

  bool Expand(int generations, Rng* rng) {
    if (generations < 0) return false;
    for (int g = 0; g < generations; ++g) {
      const char* src = buf_[cur_];
      char* dst = buf_[cur_ ^ 1];
      int w = 0;
      bool overflow = false;
      for (int i = 0; src[i] != '\0'; ++i) {
        const Rule* r = Find(src[i]);
        const char* rep = nullptr;
        if (r != nullptr) {
          rep = r->plain != nullptr ? r->plain : r->outs[Weighted(r->weights, r->count, rng)];
        }
        if (rep == nullptr) {
          if (w + 1 > kMaxLen) {
            overflow = true;
            break;
          }
          dst[w++] = src[i];
          continue;
        }
        int n = 0;
        while (rep[n] != '\0') ++n;
        if (w + n > kMaxLen) {
          overflow = true;
          break;
        }
        for (int k = 0; k < n; ++k) dst[w++] = rep[k];
      }
      dst[w] = '\0';
      cur_ ^= 1;
      len_ = w;
      if (overflow) {
        truncated_ = true;
        return false;
      }
    }
    return true;
  }

  Rule table_[kMaxRules];
  char buf_[2][kMaxLen + 1] = {};
  int rules_ = 0;
  int cur_ = 0;
  int len_ = 0;
  bool truncated_ = false;
};

/* mapToDegrees from the JS. Walks `str`, and for each symbol found in
 * `symbols` writes the degree at the same index of `degrees`, where
 * kRestDegree means a rest. Symbols absent from `symbols` are structural
 * (turtle commands, brackets) and are skipped. Writes at most `max_out`
 * degrees into the caller's buffer and returns how many it wrote. */
inline int MapToDegrees(const char* str, const char* symbols, const int8_t* degrees,
                        int8_t* out, int max_out) {
  int n = 0;
  for (int i = 0; str[i] != '\0' && n < max_out; ++i) {
    for (int s = 0; symbols[s] != '\0'; ++s) {
      if (symbols[s] == str[i]) {
        out[n++] = degrees[s];
        break;
      }
    }
  }
  return n;
}

}  // namespace bellows
