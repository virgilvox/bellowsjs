/* Mirrors the JS registerBuiltins() pattern: a virtual Voice interface,
 * an adapter per engine, and a string-keyed table naming all of them.
 * main() plays only the kick. */
#include "harness.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/va.h"

struct IVoice {
  virtual void NoteOn(float f, float v) = 0;
  virtual void Process(float* l, float* r, int a, int b) = 0;
  virtual bool Active() const = 0;
};
template <class T>
struct Adapter : IVoice {
  T impl;
  void NoteOn(float f, float v) override { impl.NoteOn(f, v); }
  void Process(float* l, float* r, int a, int b) override { impl.Process(l, r, a, b); }
  bool Active() const override { return impl.Active(); }
};

static bellows::Rng rng;
static Adapter<bellows::Kick> a_kick;
static Adapter<bellows::Snare> a_snare;
static Adapter<bellows::Hat> a_hat;
static Adapter<bellows::Pluck<20, 48000>> a_pluck;
static Adapter<bellows::Va> a_va;

struct Entry { const char* id; IVoice* v; };
static Entry kRegistry[] = {
  {"kick", &a_kick}, {"snare", &a_snare}, {"hat", &a_hat},
  {"pluck", &a_pluck}, {"va", &a_va},
};

static bool StrEq(const char* a, const char* b) {
  while (*a && *a == *b) { ++a; ++b; }
  return *a == *b;
}
static IVoice* GetEngine(const char* id) {
  for (auto& e : kRegistry) if (StrEq(e.id, id)) return e.v;
  return nullptr;
}

extern "C" int main() {
  rng.Init("reg");
  a_kick.impl.Init(kSampleRate);
  IVoice* v = GetEngine("kick");     /* only the kick is ever played */
  if (v) { v->NoteOn(50.0f, 0.9f); v->Process(g_l, g_r, 0, kBlock); }
  Sink(g_l, g_r, kBlock);
  return 0;
}
