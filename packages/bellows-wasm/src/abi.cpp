/*
 * The C ABI the JavaScript side drives: bellows-embedded's engines and effects behind handles.
 *
 * A voice or an effect is created by unit number (units.gen.h) with every param value in the
 * TypeScript spec order, and from then on is touched only through these calls. Audio crosses in
 * one buffer the module owns, bw_io(): kIoFrames of left followed by kIoFrames of right. A voice
 * renders into it from silence and the caller adds it into its own output, which is the voice
 * contract (voices add); an effect processes it in place, which is the effect contract.
 *
 * The classes whose storage is sized by a sample rate template argument are instantiated at
 * kMaxRate, so one build serves every rate a browser runs at, and each derives its timing from the
 * rate it was created with, never the template's. The two units that take caller storage (the
 * delay and the plate) get exactly what the rate and their longest setting need.
 */
#include <stdint.h>
#include <stdlib.h>

#include "bellows/engines/additive.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/fm.h"
#include "bellows/engines/formant.h"
#include "bellows/engines/harmonic.h"
#include "bellows/engines/modal.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/engines/va.h"
#include "bellows/engines/waveguide.h"
#include "bellows/engines/wavetable.h"
#include "bellows/engines/westcoast.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"
#include "bellows/fx/saturator.h"

namespace bwasm {

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

}  // namespace bwasm

#include "units.gen.h"

void* operator new(__SIZE_TYPE__ n) { return malloc(n); }
void operator delete(void* p) noexcept { free(p); }
void operator delete(void* p, __SIZE_TYPE__) noexcept { free(p); }

namespace bwasm {

constexpr int kMaxRate = 192000;
constexpr int kIoFrames = 128;
float g_io[2 * kIoFrames];

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
const char* Join(const char* a, const char* b) {
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

Voice* NewVoice(int unit, float sr, const char* label, const float* vals, int variant) {
  using namespace bellows;
  switch (unit) {
    case kUnitVa: {
      auto* w = Make<Va, ParamsVa>(vals);
      w->rng.Init(Join(label, "::va"));
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitFm: {
      auto* w = Make<Fm, ParamsFm>(vals);
      w->v.Init(sr, w->p);
      return w;
    }
    case kUnitAdditive: {
      auto* w = Make<Additive<32>, ParamsAdditive>(vals);
      w->v.Init(sr, w->p);
      return w;
    }
    case kUnitWavetable: {
      auto* w = Make<Wavetable, ParamsWavetable>(vals);
      w->v.Init(sr, w->p);
      return w;
    }
    case kUnitKick: {
      auto* w = Make<Kick, ParamsKick>(vals);
      w->v.Init(sr, w->p);
      return w;
    }
    case kUnitSnare: {
      auto* w = Make<Snare, ParamsSnare>(vals);
      w->rng.Init(Join(label, "::snare/noise"));
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitHat: {
      auto* w = Make<Hat, ParamsHat>(vals);
      w->v.Init(sr, w->p);
      return w;
    }
    case kUnitPluck: {
      auto* w = Make<Pluck<20, kMaxRate>, ParamsPluck>(vals);
      w->rng.Init(label);
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitString: {
      /* The TypeScript allocates the second polarization when the params record names polDetune
       * at all, and the C++ makes it a template argument; the caller says which. */
      if (variant) {
        auto* w = Make<Waveguide<20, kMaxRate, true>, ParamsString>(vals);
        w->rng.Init(label);
        w->rng2.Init(Join(label, "::note"));
        w->v.Init(sr, &w->rng, &w->rng2, w->p);
        return w;
      }
      auto* w = Make<Waveguide<20, kMaxRate, false>, ParamsString>(vals);
      w->rng.Init(label);
      w->rng2.Init(Join(label, "::note"));
      w->v.Init(sr, &w->rng, &w->rng2, w->p);
      return w;
    }
    case kUnitTube: {
      auto* w = Make<Tube<20, kMaxRate>, ParamsTube>(vals);
      w->rng.Init(label);
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitModal: {
      auto* w = Make<Modal, ParamsModal>(vals);
      w->rng.Init(label);
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitWestcoast: {
      auto* w = Make<WestCoast, ParamsWestcoast>(vals);
      w->v.Init(sr, w->p);
      return w;
    }
    case kUnitFormant: {
      auto* w = Make<Formant, ParamsFormant>(vals);
      w->rng.Init(label);
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitHarmonic: {
      auto* w = Make<Harmonic, ParamsHarmonic>(vals);
      w->rng.Init(label);
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    default:
      return nullptr;
  }
}

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

/* The delay and the plate run on storage the module allocates for them. */
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

/* The limiter carries the true-peak detector and switches it at run time, as the JS does with
 * its truePeak param: one delay line, one deque, one release envelope either way. */
struct LimiterFx final : Fx {
  bellows::Limiter<kMaxRate, true, kIoFrames> f;
  bellows::Limiter<kMaxRate, true, kIoFrames>::Params p;
  void Run(float* l, float* r, int n) override { f.Process(l, r, 0, n); }
  void Set(int i, float x) override {
    if (i == 2) {
      f.SetTruePeak(x >= 0.5f);
      return;
    }
    ParamsLimiter::Set(p, i, x);
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

/* aux: the delay's longest time in seconds (its maxSeconds option), unused by the rest. */
Fx* NewFx(int unit, float sr, const float* vals, float aux) {
  using namespace bellows;
  switch (unit) {
    case kUnitDelay: {
      auto* w = new FxStore<StereoDelayExt, ParamsDelay>;
      w->Fill(vals);
      const float max_sec = aux > 0.0f ? aux : 4.0f;
      /* the sizing StereoDelay<kMaxMs, rate> does, at this rate */
      const uint32_t cap = static_cast<uint32_t>(max_sec * sr) + 4u;
      w->store = static_cast<float*>(calloc(2 * cap, sizeof(float)));
      if (!w->store) {
        delete w;
        return nullptr;
      }
      w->f.Init(sr, w->store, w->store + cap, cap, w->p, max_sec);
      return w;
    }
    case kUnitPlate: {
      auto* w = new FxStore<PlateExt, ParamsPlate>;
      w->Fill(vals);
      constexpr uint32_t kPredelayMs = 250;
      const uint32_t n = plate_detail::TotalSamples(static_cast<uint32_t>(sr + 0.5f), kPredelayMs);
      w->store = static_cast<float*>(calloc(n, sizeof(float)));
      if (!w->store || !w->f.Init(sr, w->store, n, kPredelayMs, w->p)) {
        delete w;
        return nullptr;
      }
      return w;
    }
    case kUnitCompressor: {
      auto* w = MakeFx<Compressor<10, kMaxRate>, ParamsCompressor>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitLimiter: {
      auto* w = new LimiterFx;
      for (int i = 0; i < ParamsLimiter::kCount; ++i) ParamsLimiter::Set(w->p, i, vals[i]);
      w->f.Init(sr, w->p);
      w->f.SetTruePeak(vals[2] >= 0.5f);
      return w;
    }
    case kUnitGate: {
      auto* w = MakeFx<Gate, ParamsGate>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitChorus: {
      auto* w = MakeFx<Chorus<kMaxRate>, ParamsChorus>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitFlanger: {
      auto* w = MakeFx<Flanger<kMaxRate>, ParamsFlanger>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitTremolo: {
      auto* w = MakeFx<Tremolo, ParamsTremolo>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitAutopan: {
      auto* w = MakeFx<AutoPan, ParamsAutopan>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitRingmod: {
      auto* w = MakeFx<RingMod, ParamsRingmod>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitEq: {
      auto* w = MakeFx<Eq6, ParamsEq>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitSaturator: {
      auto* w = MakeFx<Saturator<4, kIoFrames>, ParamsSaturator>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    default:
      return nullptr;
  }
}

}  // namespace bwasm

/* ---------------- exports ---------------- */

#define BW_EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern "C" void __wasm_call_ctors(void);

BW_EXPORT(bw_init) void bw_init() { __wasm_call_ctors(); }
BW_EXPORT(bw_io) float* bw_io() { return bwasm::g_io; }
BW_EXPORT(bw_io_frames) int bw_io_frames() { return bwasm::kIoFrames; }
BW_EXPORT(bw_unit_count) int bw_unit_count() { return bwasm::kUnitCount; }

BW_EXPORT(bw_voice_new)
bwasm::Voice* bw_voice_new(int unit, float sr, const char* label, const float* vals, int variant) {
  return bwasm::NewVoice(unit, sr, label, vals, variant);
}
BW_EXPORT(bw_voice_on) void bw_voice_on(bwasm::Voice* v, float hz, float vel) { v->On(hz, vel); }
BW_EXPORT(bw_voice_off) void bw_voice_off(bwasm::Voice* v) { v->Off(); }
BW_EXPORT(bw_voice_set) void bw_voice_set(bwasm::Voice* v, int i, float x) { v->Set(i, x); }
BW_EXPORT(bw_voice_active) int bw_voice_active(bwasm::Voice* v) { return v->Active() ? 1 : 0; }
/* Renders n frames (at most kIoFrames) from silence into bw_io(); returns Active() after. */
BW_EXPORT(bw_voice_run) int bw_voice_run(bwasm::Voice* v, int n) {
  float* l = bwasm::g_io;
  float* r = bwasm::g_io + bwasm::kIoFrames;
  for (int i = 0; i < n; ++i) l[i] = r[i] = 0.0f;
  v->Run(l, r, n);
  return v->Active() ? 1 : 0;
}
BW_EXPORT(bw_voice_free) void bw_voice_free(bwasm::Voice* v) { delete v; }

BW_EXPORT(bw_fx_new) bwasm::Fx* bw_fx_new(int unit, float sr, const float* vals, float aux) {
  return bwasm::NewFx(unit, sr, vals, aux);
}
BW_EXPORT(bw_fx_set) void bw_fx_set(bwasm::Fx* f, int i, float x) { f->Set(i, x); }
BW_EXPORT(bw_fx_reset) void bw_fx_reset(bwasm::Fx* f) { f->Reset(); }
/* Processes n frames (at most kIoFrames) of bw_io() in place. */
BW_EXPORT(bw_fx_run) void bw_fx_run(bwasm::Fx* f, int n) {
  f->Run(bwasm::g_io, bwasm::g_io + bwasm::kIoFrames, n);
}
BW_EXPORT(bw_fx_free) void bw_fx_free(bwasm::Fx* f) { delete f; }
