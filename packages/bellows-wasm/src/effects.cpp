/*
 * NewFx: one case per effect unit. The delays, the reverbs and the spectral effects run on storage
 * the module allocates for them, exactly what the rate and their longest setting need.
 */
#include <math.h>

#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"
#include "bellows/fx/freqshift.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"
#include "bellows/fx/reverb.h"
#include "bellows/fx/saturator.h"
#include "bellows/fx/spectral.h"
#include "unit.h"

namespace bwasm {

/* A spectral effect on Samples() floats of its own. Its FFT size and hop are fixed by the unit,
 * as in the JS, so nothing about the storage depends on the rate. */
template <class F, class S>
Fx* NewSpectral(float sr, const float* vals) {
  auto* w = new FxStore<F, S>;
  w->Fill(vals);
  w->store = static_cast<float*>(calloc(F::Samples(), sizeof(float)));
  if (!w->store || !w->f.Init(sr, w->store, F::Samples(), w->p)) {
    delete w;
    return nullptr;
  }
  return w;
}

/* Blur and whisper restart their phase stream on every write of the seed param, as the JS
 * setParam('seed') does even when the value is the one it already had (a seed slider moving
 * inside one integer restarts it each time). SetParams sees only a change of value, so the write
 * itself calls Reseed. kSeed is the seed's index in the spec list. */
template <class F, class S, int kSeed>
struct SeededFx final : Fx {
  F f;
  typename F::Params p;
  float* store = nullptr;
  ~SeededFx() override { free(store); }
  void Run(float* l, float* r, int n) override { f.Process(l, r, 0, n); }
  void Set(int i, float x) override {
    S::Set(p, i, x);
    f.SetParams(p);
    if (i == kSeed) f.Reseed();
  }
  void Reset() override { f.Reset(); }
};

template <class F, class S, int kSeed>
Fx* NewSeeded(float sr, const float* vals) {
  static_assert(kSeed < S::kCount, "the seed index is inside the spec list");
  auto* w = new SeededFx<F, S, kSeed>;
  for (int i = 0; i < S::kCount; ++i) S::Set(w->p, i, vals[i]);
  w->store = static_cast<float*>(calloc(F::Samples(), sizeof(float)));
  if (!w->store || !w->f.Init(sr, w->store, F::Samples(), w->p)) {
    delete w;
    return nullptr;
  }
  return w;
}

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

/* A create-time capacity option the way the TypeScript reads it (capSeconds, capSize): a value
 * that is not finite falls back to the default, any other is clamped. install.js passes 0 when
 * the record has none, so 0 is the default here, where the TypeScript would clamp it to lo. */
static float CapOption(float aux, float fallback, float lo, float hi) {
  if (aux == 0.0f || !isfinite(aux)) return fallback;
  return bellows::Clamp(aux, lo, hi);
}

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
    case kUnitTransient: {
      auto* w = MakeFx<Transient, ParamsTransient>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitPhaser: {
      auto* w = MakeFx<Phaser, ParamsPhaser>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitFreqshift: {
      auto* w = MakeFx<FreqShift, ParamsFreqshift>(vals);
      w->f.Init(sr, w->p);
      return w;
    }
    case kUnitTapeDelay: {
      auto* w = new FxStore<TapeDelayExt, ParamsTapeDelay>;
      w->Fill(vals);
      const float max_sec = CapOption(aux, 2.0f, 0.01f, 60.0f);
      const uint32_t cap = TapeDelaySamples(static_cast<uint32_t>(sr + 0.5f), max_sec);
      w->store = static_cast<float*>(calloc(2 * cap, sizeof(float)));
      if (!w->store) {
        delete w;
        return nullptr;
      }
      w->f.Init(sr, w->store, w->store + cap, cap, w->p, max_sec);
      return w;
    }
    case kUnitMultitap: {
      auto* w = new FxStore<MultitapExt, ParamsMultitap>;
      w->Fill(vals);
      const float max_sec = CapOption(aux, 2.0f, 0.01f, 60.0f);
      const uint32_t cap = MultitapSamples(static_cast<uint32_t>(sr + 0.5f), max_sec);
      w->store = static_cast<float*>(calloc(2 * cap, sizeof(float)));
      if (!w->store || !w->f.Init(sr, w->store, w->store + cap, cap, w->p, max_sec)) {
        delete w;
        return nullptr;
      }
      return w;
    }
    case kUnitFdn: {
      auto* w = new FxStore<FdnExt, ParamsFdn>;
      w->Fill(vals);
      const float max_size = CapOption(aux, 3.0f, 0.25f, 8.0f);
      /* the lines are carved in hundredths of a size, rounded up to hold max_size */
      uint32_t pct = static_cast<uint32_t>(max_size * 100.0f);
      if (static_cast<float>(pct) < max_size * 100.0f) ++pct;
      constexpr uint32_t kPredelayMs = 250;
      const uint32_t n = fdn_detail::TotalSamples(static_cast<uint32_t>(sr + 0.5f), pct, kPredelayMs);
      w->store = static_cast<float*>(calloc(n, sizeof(float)));
      if (!w->store || !w->f.Init(sr, w->store, n, pct, kPredelayMs, w->p, max_size)) {
        delete w;
        return nullptr;
      }
      return w;
    }
    case kUnitPitchshift:
      return NewSpectral<PitchShiftExt, ParamsPitchshift>(sr, vals);
    case kUnitFreeze:
      return NewSpectral<FreezeExt, ParamsFreeze>(sr, vals);
    case kUnitBlur:
      /* amount, mix, seed */
      return NewSeeded<BlurExt, ParamsBlur, 2>(sr, vals);
    case kUnitRobot:
      return NewSpectral<RobotExt, ParamsRobot>(sr, vals);
    case kUnitWhisper:
      /* mix, seed */
      return NewSeeded<WhisperExt, ParamsWhisper, 1>(sr, vals);
    case kUnitDenoise:
      return NewSpectral<DenoiseExt, ParamsDenoise>(sr, vals);
    default:
      return nullptr;
  }
}

}  // namespace bwasm
