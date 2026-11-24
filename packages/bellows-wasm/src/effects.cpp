/*
 * NewFx: one case per effect unit. The delay and the plate run on storage the module allocates
 * for them, exactly what the rate and their longest setting need.
 */
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"
#include "bellows/fx/saturator.h"
#include "unit.h"

namespace bwasm {

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
