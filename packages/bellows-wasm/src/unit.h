/*
 * What every unit in the module shares: the Voice and Fx interfaces the ABI and the kernel drive,
 * the adapters that put a bellows-embedded class behind them, and the conversions from a
 * TypeScript param value to a C++ Params field.
 *
 * A voice renders n frames into l and r and adds (the voice contract); an effect processes n
 * frames of l and r in place (the effect contract). Both start at the pointers they are given, so
 * a caller renders a span [from, to) of its buffer by passing l + from and to - from.
 *
 * The classes whose storage is sized by a sample rate template argument are instantiated at
 * kMaxRate, so one build serves every rate a browser runs at, and each derives its timing from the
 * rate it was created with, never the template's.
 *
 * Adding a unit: list it in tools/gen-units.mjs (with any name the field mapping there cannot
 * guess), regenerate, give Put() an overload for any new field type here, and add its case to
 * NewVoice (voices.cpp) or NewFx (effects.cpp).
 */
#pragma once
#include <stdint.h>
#include <stdlib.h>

#include "bellows/core/prng.h"
#include "bellows/dsp/lfo.h"
#include "bellows/dsp/noise.h"
#include "bellows/engines/noisesynth.h"
#include "bellows/fx/saturator.h"

namespace bwasm {

constexpr int kMaxRate = 192000;
constexpr int kIoFrames = 128;

/* Field conversions, each the one the TypeScript setParam applies. */
inline void Put(float& f, float v) { f = v; }
inline void Put(bool& f, float v) { f = v >= 0.5f; }
inline int RoundClamp(float v, int lo, int hi) {
  /* Math.round, then clamp: halves round up */
  const float r = v + 0.5f;
  int i = static_cast<int>(r);
  if (static_cast<float>(i) > r) --i;
  return i < lo ? lo : (i > hi ? hi : i);
}
inline void Put(bellows::LfoShape& f, float v) { f = static_cast<bellows::LfoShape>(RoundClamp(v, 0, 4)); }
inline void Put(bellows::SatCurve& f, float v) { f = static_cast<bellows::SatCurve>(RoundClamp(v, 0, 3)); }
inline void Put(bellows::NoiseColor& f, float v) { f = static_cast<bellows::NoiseColor>(RoundClamp(v, 0, 4)); }
inline void Put(bellows::NoiseFilterMode& f, float v) { f = static_cast<bellows::NoiseFilterMode>(RoundClamp(v, 0, 2)); }

}  // namespace bwasm

#include "units.gen.h"

namespace bwasm {

using bellows::Rng;

/* ---------------- voices ---------------- */

struct Voice {
  virtual ~Voice() {}
  virtual void On(float hz, float vel) = 0;
  virtual void Off() = 0;
  virtual void Run(float* l, float* r, int n) = 0;
  virtual bool Active() const = 0;
  virtual void Set(int i, float v) = 0;
};

template <class V, class S>
struct VoiceOf final : Voice {
  V v;
  typename V::Params p;
  Rng rng, rng2;
  void Fill(const float* vals) {
    for (int i = 0; i < S::kCount; ++i) S::Set(p, i, vals[i]);
  }
  void On(float hz, float vel) override { v.NoteOn(hz, vel); }
  void Off() override { v.NoteOff(); }
  void Run(float* l, float* r, int n) override { v.Process(l, r, 0, n); }
  bool Active() const override { return v.Active(); }
  void Set(int i, float x) override {
    S::Set(p, i, x);
    v.SetParams(p);
  }
};

/* label + suffix, the string fork() makes in the JS */
inline const char* Join(const char* a, const char* b) {
  static char buf[512];
  int n = 0;
  for (; *a && n < 511; ++a) buf[n++] = *a;
  for (; *b && n < 511; ++b) buf[n++] = *b;
  buf[n] = 0;
  return buf;
}

/* Voices that take no stream ignore `label`. The streams are the ones the TypeScript voice draws
 * from: its own, or a fork of it, by the same label. */
template <class V, class S>
VoiceOf<V, S>* Make(const float* vals) {
  auto* w = new VoiceOf<V, S>;
  w->Fill(vals);
  return w;
}

/* Creates a voice of an engine unit, or returns null for a unit that is not an engine. label is
 * the voice's PRNG label (the JS NamedRng label), vals every param in spec order, variant a
 * unit specific build choice (the string's second polarization). */
Voice* NewVoice(int unit, float sr, const char* label, const float* vals, int variant);

/* ---------------- effects ---------------- */

struct Fx {
  virtual ~Fx() {}
  virtual void Run(float* l, float* r, int n) = 0;
  virtual void Set(int i, float v) = 0;
  virtual void Reset() = 0;
};

template <class F, class S>
struct FxOf final : Fx {
  F f;
  typename F::Params p;
  void Fill(const float* vals) {
    for (int i = 0; i < S::kCount; ++i) S::Set(p, i, vals[i]);
  }
  void Run(float* l, float* r, int n) override { f.Process(l, r, 0, n); }
  void Set(int i, float x) override {
    S::Set(p, i, x);
    f.SetParams(p);
  }
  void Reset() override { f.Reset(); }
};

/* The delays and the reverbs run on storage the module allocates for them. */
template <class F, class S>
struct FxStore final : Fx {
  F f;
  typename F::Params p;
  float* store = nullptr;
  ~FxStore() override { free(store); }
  void Fill(const float* vals) {
    for (int i = 0; i < S::kCount; ++i) S::Set(p, i, vals[i]);
  }
  void Run(float* l, float* r, int n) override { f.Process(l, r, 0, n); }
  void Set(int i, float x) override {
    S::Set(p, i, x);
    f.SetParams(p);
  }
  void Reset() override { f.Reset(); }
};

template <class F, class S>
FxOf<F, S>* MakeFx(const float* vals) {
  auto* w = new FxOf<F, S>;
  w->Fill(vals);
  return w;
}

/* Creates an effect unit, or returns null. aux: the unit's create-time capacity option, the
 * longest time in seconds for the delays (their maxSeconds) and the largest size for the fdn (its
 * maxSize), 0 when not given; unused by the rest. */
Fx* NewFx(int unit, float sr, const float* vals, float aux);

}  // namespace bwasm
