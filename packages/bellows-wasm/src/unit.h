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
  /* Math.round, then clamp: halves round up. Clamped in float first, so a NaN or a value past
   * int range never reaches the conversion (NaN lands on lo). */
  if (!(v >= static_cast<float>(lo))) return lo;
  if (v >= static_cast<float>(hi)) return hi;
  const float r = v + 0.5f;
  int i = static_cast<int>(r);
  if (static_cast<float>(i) > r) --i;
  return i > hi ? hi : i;
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
    /* past the spec: a name the voice takes outside it (CALLS in tools/gen-units.mjs) */
    if (i >= S::kCount) {
      S::Call(v, i - S::kCount, x);
      return;
    }
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

/* ---------------- banks (banks.cpp) ---------------- */

/* Recorded audio the two bank engines play: a sampler bank (the zones of one registerBank) or a
 * grain bank (the buffer of one registerGrain). A bank owns its audio and frees it in FreeBank.
 *
 * Lifetime: every voice made on a bank reads it until the voice is freed, so a bank is freed
 * only after the last of them. Registering a bank id again makes a new bank; channels created
 * before keep the old one, as the TypeScript's do, so the old one lives until they are gone.
 *
 * Shared state: a sampler bank carries the round robin counter. The TypeScript keeps it per
 * registered bank, and every voice of every channel playing that bank advances it on each note
 * on, so voices of two channels on one bank share one cycle. */
struct Bank;

/* SetSamplerZone's fields, in this order. Absent optionals are NaN. loopMode is 0 none, 1 loop,
 * 2 loopRelease. The zone has an envelope when kZoneEnvAttack is a number. */
enum ZoneField : int {
  kZoneSampleRate = 0,
  kZoneRootKey = 1,
  kZoneFineTune = 2,    /* cents; NaN reads as 0 */
  kZoneKeyLo = 3,
  kZoneKeyHi = 4,
  kZoneVelLo = 5,
  kZoneVelHi = 6,
  kZoneLoopStart = 7,   /* NaN reads as 0 */
  kZoneLoopEnd = 8,     /* NaN reads as the zone's length */
  kZoneLoopMode = 9,
  kZoneGainDb = 10,     /* NaN reads as 0 */
  kZonePan = 11,        /* NaN reads as 0 */
  kZoneEnvAttack = 12,  /* env.attack .. env.release, seconds and sustain 0..1 */
  kZoneEnvHold = 13,
  kZoneEnvDecay = 14,
  kZoneEnvSustain = 15,
  kZoneEnvRelease = 16,
  kZoneRoundRobinGroup = 17, /* NaN: not in a group */
  kZoneSeqPosition = 18,     /* NaN reads as 1 */
  kZoneFieldCount = 19,
};

/* A sampler bank with zoneCount empty zones. An empty zone matches nothing until it is set. */
Bank* NewSamplerBank(int zone_count);

/* Sets zone `index`: fields as above (field_count at least kZoneFieldCount), data_l the mono or
 * left channel and data_r the right one or null, both `frames` long and separate malloc blocks.
 * On success the bank owns both and frees any data the zone held before. Returns false, and
 * takes nothing, for a bad bank, index or field count, or null data_l with frames > 0. */
bool SetSamplerZone(Bank* bank, int index, const float* fields, int field_count, float* data_l, float* data_r,
                    uint32_t frames);

/* A grain bank over `frames` mono frames recorded at sample_rate; takes ownership of data. */
Bank* NewGrainBank(float* data, uint32_t frames, float sample_rate);

void FreeBank(Bank* bank);

/* A voice of a bank engine: kUnitSampler on a sampler bank, kUnitGranular on a grain bank, or
 * kUnitGranular with a null bank for the plain 'granular' engine and its test tone. Null for any
 * other pairing. vals is every param of the unit's spec in spec order, label the voice's stream
 * (the granular draws from it; the sampler takes none). The bank is not const: a sampler voice
 * advances its round robin counter. */
Voice* NewBankVoice(int unit, float sr, const char* label, const float* vals, Bank* bank);

}  // namespace bwasm
