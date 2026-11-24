/*
 * NewVoice: one case per engine unit, building the bellows-embedded voice with the PRNG streams
 * the TypeScript voice draws from, by the same labels.
 */
#include "bellows/engines/additive.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/fm.h"
#include "bellows/engines/formant.h"
#include "bellows/engines/harmonic.h"
#include "bellows/engines/modal.h"
#include "bellows/engines/noisesynth.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/engines/va.h"
#include "bellows/engines/waveguide.h"
#include "bellows/engines/wavetable.h"
#include "bellows/engines/westcoast.h"
#include "unit.h"

namespace bwasm {

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
    case kUnitClap: {
      auto* w = Make<Clap, ParamsClap>(vals);
      w->rng.Init(Join(label, "::clap/noise"));
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitTom: {
      auto* w = Make<Tom, ParamsTom>(vals);
      w->rng.Init(Join(label, "::tom/noise"));
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    case kUnitNoise: {
      auto* w = Make<NoiseSynth, ParamsNoise>(vals);
      w->rng.Init(Join(label, "::noise"));
      w->v.Init(sr, &w->rng, w->p);
      return w;
    }
    default:
      return nullptr;
  }
}

}  // namespace bwasm
