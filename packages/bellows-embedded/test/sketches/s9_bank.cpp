#include "harness.h"
#include "bellows/engines/drums.h"

/* A variadic bank: the user names the engines they want, dispatch is a
 * compile-time-generated switch, nothing else is instantiated. */
template <class... Ts>
class Bank;

template <class T, class... Rest>
class Bank<T, Rest...> {
 public:
  static constexpr int kCount = 1 + sizeof...(Rest);
  T head;
  Bank<Rest...> tail;
  template <class F>
  void With(int i, F&& f) {
    if (i == 0) f(head);
    else tail.With(i - 1, static_cast<F&&>(f));
  }
};
template <>
class Bank<> {
 public:
  static constexpr int kCount = 0;
  template <class F>
  void With(int, F&&) {}
};

static bellows::Rng rng;
static Bank<bellows::Kick, bellows::Snare, bellows::Hat> bank;

extern "C" int main() {
  rng.Init("bank");
  bank.head.Init(kSampleRate);
  bank.tail.head.Init(kSampleRate, &rng);
  bank.tail.tail.head.Init(kSampleRate);
  /* runtime index, exactly like getEngine(id) */
  for (int i = 0; i < 3; ++i) {
    bank.With(i, [](auto& v) { v.NoteOn(120.0f, 0.8f); v.Process(g_l, g_r, 0, kBlock); });
  }
  Sink(g_l, g_r, kBlock);
  return 0;
}
