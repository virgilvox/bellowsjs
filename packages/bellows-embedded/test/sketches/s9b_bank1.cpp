#include "harness.h"
#include "bellows/engines/drums.h"
template <class... Ts> class Bank;
template <class T, class... Rest> class Bank<T, Rest...> {
 public: T head; Bank<Rest...> tail;
  template <class F> void With(int i, F&& f) { if (i==0) f(head); else tail.With(i-1, static_cast<F&&>(f)); }
};
template <> class Bank<> { public: template <class F> void With(int, F&&) {} };
static Bank<bellows::Kick> bank;
extern "C" int main() {
  bank.head.Init(kSampleRate);
  for (int i = 0; i < 1; ++i) bank.With(i, [](auto& v){ v.NoteOn(50.0f,0.9f); v.Process(g_l,g_r,0,kBlock); });
  Sink(g_l, g_r, kBlock);
  return 0;
}
