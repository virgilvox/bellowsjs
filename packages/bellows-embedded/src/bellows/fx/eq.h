/* Three band EQ: low shelf, bell, high shelf, from src/fx/eq.ts. */
#pragma once
#include "bellows/dsp/filters.h"

namespace bellows {

class Eq3 {
 public:
  struct Params {
    float low_freq = 120.0f, low_gain = 0.0f;
    float mid_freq = 1000.0f, mid_gain = 0.0f, mid_q = 0.7f;
    float high_freq = 6000.0f, high_gain = 0.0f;
  };

  void Init(float sample_rate) {
    Params p;
    Init(sample_rate, p);
  }

  void Init(float sample_rate, const Params& p) {
    for (int c = 0; c < 2; ++c) {
      low_[c].Init(sample_rate);
      low_[c].SetMode(SvfMode::kLowShelf);
      mid_[c].Init(sample_rate);
      mid_[c].SetMode(SvfMode::kBell);
      high_[c].Init(sample_rate);
      high_[c].SetMode(SvfMode::kHighShelf);
    }
    SetParams(p);
  }

  void SetParams(const Params& p) {
    for (int c = 0; c < 2; ++c) {
      low_[c].Set(p.low_freq, 0.7071f, p.low_gain);
      mid_[c].Set(p.mid_freq, p.mid_q, p.mid_gain);
      high_[c].Set(p.high_freq, 0.7071f, p.high_gain);
    }
  }

  void Process(float* l, float* r, int from, int to) {
    for (int i = from; i < to; ++i) {
      l[i] = high_[0].Process(mid_[0].Process(low_[0].Process(l[i])));
      r[i] = high_[1].Process(mid_[1].Process(low_[1].Process(r[i])));
    }
  }

  void Reset() {
    for (int c = 0; c < 2; ++c) {
      low_[c].Reset();
      mid_[c].Reset();
      high_[c].Reset();
    }
  }

 private:
  Svf low_[2], mid_[2], high_[2];
};

}  // namespace bellows
