/*
 * Compile-time engine bank.
 *
 * This is the embedded answer to the JS getEngine(id) registry. You name
 * the engines you want as template arguments, dispatch by a runtime index
 * exactly as you would by id, and the linker sees only the engines you
 * named.
 *
 *   bellows::Bank<bellows::Kick, bellows::Snare, bellows::Hat> kit;
 *   kit.With(slot, [&](auto& v) { v.NoteOn(hz, vel); });
 *
 * Why this exists rather than a virtual interface plus a table: measured
 * on Cortex-M7, playing one kick through a string-keyed registry of five
 * engines costs 30296 bytes of flash and 30828 bytes of RAM. The same
 * kick through this bank costs 3760 and 1104, byte for byte identical to
 * using the class directly. A registry names every engine, so the linker
 * has to keep every engine, every constant table, and every delay buffer,
 * including the ones the program can never reach.
 *
 * The cost of the abstraction is a chain of integer compares, one per
 * bank entry, resolved at the call site.
 */
#pragma once

namespace bellows {

template <class... Ts>
class Bank;

template <class T, class... Rest>
class Bank<T, Rest...> {
 public:
  static constexpr int kCount = 1 + static_cast<int>(sizeof...(Rest));

  T head;
  Bank<Rest...> tail;

  /* Call f with the engine at runtime index i. Out of range does nothing. */
  template <class F>
  void With(int i, F&& f) {
    if (i == 0) f(head);
    else tail.With(i - 1, static_cast<F&&>(f));
  }

  /* Call f with every engine in the bank, in declaration order. */
  template <class F>
  void ForEach(F&& f) {
    f(head);
    tail.ForEach(static_cast<F&&>(f));
  }
};

template <>
class Bank<> {
 public:
  static constexpr int kCount = 0;

  template <class F>
  void With(int, F&&) {}

  template <class F>
  void ForEach(F&&) {}
};

}  // namespace bellows
