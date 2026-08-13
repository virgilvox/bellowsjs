/* Rewrite of src/seq/markov.ts, which is the one seq module that could not
 * be transcribed.
 *
 * Variable-order Markov chains. Training records a transition at every
 * order from 0 up to the configured order, so a full-order context that
 * was never seen backs off to progressively shorter ones and finally to
 * the order-0 distribution over everything trained. The backoff is the
 * module: a chain that only answers at its full order stalls on the first
 * context it does not hold, which for melody is the second bar.
 *
 * WHY THIS IS A REWRITE AND NOT A TRANSCRIPTION
 *
 * The JS keys a context by JSON.stringify into a Map, one Map per order,
 * and both the key and the Map grow for as long as you train. Neither a
 * string key nor unbounded growth exists here, so:
 *
 *   - A state is an index into a caller-owned alphabet, 0 to kAlphabet-1,
 *     one byte. What a state MEANS (a scale degree, a slot in a note
 *     table, a drum) stays outside, the same way MapToDegrees in
 *     lsystem.h leaves the symbol mapping to the caller.
 *   - A context is packed into one uint32 instead of stringified:
 *     key = 1, then key = key * kAlphabet + symbol for each element in
 *     order. The leading 1 is what puts the LENGTH in the key, so the
 *     empty context (1) and the one-symbol context [0] (kAlphabet) cannot
 *     collide and every order shares one flat table instead of one table
 *     per order.
 *   - That table is kMaxContexts entries long and each entry's outgoing
 *     distribution is kAlphabet wide, both fixed at compile time. The
 *     whole chain is one object and nothing allocates.
 *
 * Overflow is defined, and follows the contract lsystem.h chose: when the
 * table is full the transition is dropped, Truncated() latches true and
 * the call returns false. A chain that dropped transitions still plays.
 * It plays a smaller chain, and Truncated() is the only way to find out,
 * so check it after training rather than trusting the capacity.
 *
 * TWO THINGS ARE PRESERVED EXACTLY, because the note that comes out
 * depends on them:
 *
 *   1. Each distribution walks its symbols in the order they were FIRST
 *      SEEN, not in alphabet order. rng.weighted subtracts along the
 *      array until it goes non-positive, so re-ordering the same weights
 *      picks a different symbol from the same draw. Storing weights
 *      indexed by symbol would have been smaller and would have quietly
 *      played a different melody.
 *   2. The backoff runs from min(order, context length) down to 0, taking
 *      the LAST k symbols of the context at each step, and stops at the
 *      first order holding any weight.
 *
 * Both are compared against the TypeScript, exactly, in
 * test/parity/tables.cpp. The draw itself is compared there too, through
 * NextWith below rather than through an Rng, for the reason that file
 * gives.
 *
 * Lookup is a linear scan over the recorded contexts and not a hash. The
 * table is small by construction (kMaxContexts is the whole of it),
 * training runs once at setup and Next() runs at note rate, so a hash
 * would cost state and a second failure mode to save time nothing is
 * waiting on.
 *
 * Cost: one entry is 4 bytes of key, 2 of bookkeeping, kAlphabet bytes of
 * symbols and 4 * kAlphabet of weights, padded to a multiple of 4. The
 * default Markov<8, 32, 2> is 1556 bytes, measured with sizeof rather than
 * counted, and the same on a Cortex-M as on the host because every member
 * is four byte aligned or smaller. That is the whole chain: there is
 * nothing else to account for.
 *
 * The melody-matrix helpers in the same JS file (buildStepwiseMatrix and
 * weightedWalk) are deliberately not here. They build an n-by-n float
 * matrix with a seeded jitter per cell, which is a different shape of
 * object with a different capacity question, and nothing in the examples
 * needs one yet.
 */
#pragma once
#include <stdint.h>

#include "bellows/core/prng.h"

namespace bellows {

/* Does a context of kMaxOrder symbols over kAlphabet still pack into a
 * uint32?
 *
 * The largest key is a full-length context of the last symbol, which is
 * kAlphabet^kMaxOrder + (kAlphabet^kMaxOrder - 1). At namespace scope, and
 * above the class, for the same reason Xmur3 is: a static_assert inside the
 * class cannot name a member declared further down, and this has to fail at
 * compile time on every target rather than silently alias two contexts onto
 * one entry. The loop stops early so the product cannot itself overflow. */
inline constexpr bool MarkovKeyFitsU32(int alphabet, int max_order) {
  uint64_t p = 1;
  for (int i = 0; i < max_order; ++i) {
    p *= static_cast<uint64_t>(alphabet);
    if (p > 0x80000000ull) return false;
  }
  return true;
}

template <int kAlphabet = 8, int kMaxContexts = 32, int kMaxOrder = 2>
class Markov {
 public:
  static_assert(kAlphabet >= 1 && kAlphabet <= 256,
                "Markov stores states as bytes, so the alphabet must fit in 256");
  static_assert(kMaxContexts >= 1, "Markov needs room for at least one context");
  static_assert(kMaxOrder >= 1, "Markov: order must be at least 1, as in the JS");
  static_assert(MarkovKeyFitsU32(kAlphabet, kMaxOrder),
                "Markov: kAlphabet^kMaxOrder does not fit a packed uint32 key");

  static constexpr int kCapacity = kMaxContexts;

  /* One recorded context and where it goes next.
   *
   * Public because the table is the thing that has to be right and
   * nothing else can see it: a wrong transition table plays a confident,
   * plausible, wrong melody and no audio test can hear it. Every member
   * is read-only to a caller in practice; test/parity/tables.cpp walks
   * these to diff the whole table against the TypeScript. */
  struct Context {
    /* Packed context, 0 for an unused slot. Never 0 once written: the
     * empty context packs to 1. */
    uint32_t key;
    /* Number of symbols in the context, 0 to kMaxOrder. */
    uint8_t order;
    /* Distinct symbols recorded after it. */
    uint8_t count;
    /* Symbols in first-seen order, which is the order the draw walks. */
    uint8_t next[kAlphabet];
    /* Accumulated weight of each, aligned with `next`. */
    float weight[kAlphabet];
  };

  /* Clear the chain and set the order. As in the JS the order is at least
   * 1; unlike the JS, which throws, an order outside [1, kMaxOrder] is
   * clamped and Order() reports what it actually got. */
  void Init(int order = 1) {
    order_ = ClampOrder(order);
    used_ = 0;
    ctx_len_ = 0;
    truncated_ = false;
    for (int i = 0; i < kMaxContexts; ++i) {
      table_[i].key = 0u;
      table_[i].order = 0u;
      table_[i].count = 0u;
    }
    for (int i = 0; i < kMaxOrder; ++i) ctx_[i] = 0u;
  }

  /* Count every transition in `sequence` at all orders up to Order().
   *
   * Returns false and records NOTHING when any symbol is outside the
   * alphabet, because a partly trained chain is worse than an obvious
   * no-op. Returns false with everything that fit recorded when the table
   * filled up, which Truncated() also latches. */
  bool Train(const uint8_t* sequence, int n) {
    if (n < 0) return false;
    for (int i = 0; i < n; ++i) {
      if (!InAlphabet(sequence[i])) return false;
    }
    bool ok = true;
    for (int i = 0; i < n; ++i) {
      const int max_k = order_ < i ? order_ : i;
      for (int k = 0; k <= max_k; ++k) {
        if (!Add(sequence + i - k, k, sequence[i], 1.0f)) ok = false;
      }
    }
    return ok;
  }

  /* Add one weighted transition at exactly order `len`. Lower orders are
   * not populated; Train() is what gives a chain its fallback. Weights
   * accumulate across calls, as in the JS.
   *
   * Returns false where the JS throws: a context longer than the order, a
   * symbol outside the alphabet, or a weight that is not positive and
   * finite. Also false when the table is full. */
  bool AddTransition(const uint8_t* from, int len, uint8_t to, float weight = 1.0f) {
    if (len < 0 || len > order_) return false;
    if (!InAlphabet(to)) return false;
    for (int i = 0; i < len; ++i) {
      if (!InAlphabet(from[i])) return false;
    }
    /* Positive rules out 0, negatives and NaN; the upper bound rules out
     * an infinity without needing isfinite. */
    if (!(weight > 0.0f) || !(weight <= kMaxWeight)) return false;
    return Add(from, len, to, weight);
  }

  /* Set the current context. Only the last Order() symbols are kept, as
   * in the JS slice(-order). A symbol outside the alphabet leaves the
   * previous context untouched and returns false. */
  bool Seed(const uint8_t* context, int n) {
    if (n < 0) return false;
    for (int i = 0; i < n; ++i) {
      if (!InAlphabet(context[i])) return false;
    }
    const int keep = n < order_ ? n : order_;
    for (int i = 0; i < keep; ++i) ctx_[i] = context[n - keep + i];
    ctx_len_ = keep;
    return true;
  }

  /* Emit the next state into `out` and advance the context, trying the
   * longest available context first and backing off one symbol at a time.
   *
   * Returns false, and writes nothing, where the JS throws: no order from
   * the current context down to 0 holds a transition, which for an
   * untrained chain is every call. The rng is drawn from only once a
   * distribution has been found, so a failed call leaves the stream
   * exactly where the JS leaves it. */
  bool Next(Rng& rng, uint8_t* out) {
    const Context* c = Backoff();
    if (c == nullptr) return false;
    return Pick(c, rng.Next(), out);
  }

  /* The same step with the uniform supplied by the caller instead of
   * drawn, `r` in [0, 1).
   *
   * This is what makes the walk comparable to the TypeScript. Rng::Next()
   * rounds a uint32 to float before scaling and the JS keeps it in
   * double, so the same stream can land either side of a weight boundary
   * and pick a different symbol: a property of the generator, not of the
   * chain. Handing both sides the same exactly representable r takes that
   * out and leaves the backoff and the weighted walk under test. See
   * test/parity/tables.cpp.
   *
   * An r outside [0, 1) picks an end of the distribution rather than
   * reading past it. */
  bool NextWith(float r, uint8_t* out) {
    const Context* c = Backoff();
    if (c == nullptr) return false;
    return Pick(c, r, out);
  }

  /* Emit up to n states. Returns how many were written, which is less
   * than n as soon as one step finds nothing. */
  int Steps(Rng& rng, uint8_t* out, int n) {
    int i = 0;
    for (; i < n; ++i) {
      if (!Next(rng, out + i)) break;
    }
    return i;
  }

  int Order() const { return order_; }
  /* How many contexts are recorded, and how many symbols are in the
   * current context. */
  int Contexts() const { return used_; }
  int ContextLength() const { return ctx_len_; }
  /* True once any transition has been dropped for want of table space. */
  bool Truncated() const { return truncated_; }

  /* Contexts in the order they were first recorded, which is the order
   * the JS Map iterates. */
  const Context& ContextAt(int i) const { return table_[i]; }

  /* Unpack a context key back into `order` symbols. */
  static void Unpack(uint32_t key, int order, uint8_t* out) {
    for (int i = order - 1; i >= 0; --i) {
      out[i] = static_cast<uint8_t>(key % static_cast<uint32_t>(kAlphabet));
      key /= static_cast<uint32_t>(kAlphabet);
    }
  }

 private:
  /* FLT_MAX as a literal, so this header needs neither float.h nor
   * math.h. Anything above it is an infinity. */
  static constexpr float kMaxWeight = 3.402823466e38f;

  static constexpr bool InAlphabet(uint8_t s) { return static_cast<int>(s) < kAlphabet; }

  static constexpr int ClampOrder(int order) {
    return order < 1 ? 1 : (order > kMaxOrder ? kMaxOrder : order);
  }

  static uint32_t Pack(const uint8_t* ctx, int k) {
    uint32_t key = 1u;
    for (int i = 0; i < k; ++i) {
      key = key * static_cast<uint32_t>(kAlphabet) + static_cast<uint32_t>(ctx[i]);
    }
    return key;
  }

  /* Same walk as the JS rng.weighted, over the same array in the same
   * order: sum, scale one uniform by the total, subtract until the
   * running value goes non-positive, fall back to the last option. */
  static int Weighted(const float* w, int n, float r) {
    float total = 0.0f;
    for (int i = 0; i < n; ++i) total += w[i];
    float x = r * total;
    for (int i = 0; i < n; ++i) {
      x -= w[i];
      if (x <= 0.0f) return i;
    }
    return n - 1;
  }

  const Context* Find(uint32_t key) const {
    for (int i = 0; i < used_; ++i) {
      if (table_[i].key == key) return &table_[i];
    }
    return nullptr;
  }

  bool Add(const uint8_t* from, int k, uint8_t to, float weight) {
    const uint32_t key = Pack(from, k);
    Context* c = nullptr;
    for (int i = 0; i < used_; ++i) {
      if (table_[i].key == key) {
        c = &table_[i];
        break;
      }
    }
    if (c == nullptr) {
      if (used_ >= kMaxContexts) {
        truncated_ = true;
        return false;
      }
      c = &table_[used_++];
      c->key = key;
      c->order = static_cast<uint8_t>(k);
      c->count = 0u;
    }
    for (int j = 0; j < c->count; ++j) {
      if (c->next[j] == to) {
        c->weight[j] += weight;
        return true;
      }
    }
    /* count cannot pass kAlphabet: every symbol is in the alphabet and
     * appears in this list at most once. */
    c->next[c->count] = to;
    c->weight[c->count] = weight;
    ++c->count;
    return true;
  }

  /* Longest context with any recorded weight, backing off to the empty
   * one. Null when even order 0 holds nothing. */
  const Context* Backoff() const {
    for (int k = (ctx_len_ < order_ ? ctx_len_ : order_); k >= 0; --k) {
      const Context* c = Find(Pack(ctx_ + ctx_len_ - k, k));
      if (c != nullptr && c->count > 0u) return c;
    }
    return nullptr;
  }

  bool Pick(const Context* c, float r, uint8_t* out) {
    const uint8_t v = c->next[Weighted(c->weight, c->count, r)];
    Push(v);
    if (out != nullptr) *out = v;
    return true;
  }

  /* Append and keep the last Order() symbols, as the JS push/shift does. */
  void Push(uint8_t v) {
    if (ctx_len_ < order_) {
      ctx_[ctx_len_++] = v;
      return;
    }
    for (int i = 1; i < order_; ++i) ctx_[i - 1] = ctx_[i];
    ctx_[order_ - 1] = v;
  }

  Context table_[kMaxContexts] = {};
  uint8_t ctx_[kMaxOrder] = {};
  int order_ = 1;
  int used_ = 0;
  int ctx_len_ = 0;
  bool truncated_ = false;
};

}  // namespace bellows
