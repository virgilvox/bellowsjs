/* Transcription of the clean stereo delay from src/fx/delay.ts.
 *
 * The JS hardcodes a 4 second maximum and pays 2 MB for it whatever the
 * user sets. Here the maximum is a template parameter in milliseconds,
 * so the caller pays for the delay range they asked for and nothing
 * more. StereoDelayExt takes caller-placed storage for SDRAM/PSRAM. */
#pragma once
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"

namespace bellows {

class StereoDelayExt {
 public:
  struct Params {
    float time_l = 0.35f;
    float time_r = 0.5f;
    float feedback = 0.4f;
    float cross_feedback = 0.0f;
    float damping = 8000.0f;
    float mix = 0.35f;
  };

  /* bufL and bufR must each be power-of-two sized. */
  void Init(float sample_rate, float* buf_l, float* buf_r, uint32_t cap,
            const Params& p) {
    sr_ = sample_rate;
    max_sec_ = static_cast<float>(cap - 4) / sample_rate;
    line_l_.Init(buf_l, cap);
    line_r_.Init(buf_r, cap);
    damp_l_.Init(sample_rate);
    damp_r_.Init(sample_rate);
    sm_l_.Init(sample_rate, 0.15f);
    sm_r_.Init(sample_rate, 0.15f);
    SetParams(p);
    sm_l_.Snap(p_.time_l * sample_rate);
    sm_r_.Snap(p_.time_r * sample_rate);
  }

  void SetParams(const Params& p) {
    p_ = p;
    if (p_.time_l > max_sec_) p_.time_l = max_sec_;
    if (p_.time_r > max_sec_) p_.time_r = max_sec_;
    sm_l_.SetTarget(p_.time_l * sr_);
    sm_r_.SetTarget(p_.time_r * sr_);
    damp_l_.SetLowpass(p_.damping);
    damp_r_.SetLowpass(p_.damping);
  }

  void Process(float* l, float* r, int from, int to) {
    float fb = p_.feedback;
    float x = p_.cross_feedback;
    float mix = p_.mix;
    float dry = 1.0f - mix;
    for (int i = from; i < to; ++i) {
      float dl = sm_l_.Process();
      float dr = sm_r_.Process();
      float wet_l = line_l_.ReadCubic(dl - 1.0f);
      float wet_r = line_r_.ReadCubic(dr - 1.0f);
      float fb_l = damp_l_.Process(fb * ((1.0f - x) * wet_l + x * wet_r));
      float fb_r = damp_r_.Process(fb * ((1.0f - x) * wet_r + x * wet_l));
      line_l_.Write(l[i] + fb_l);
      line_r_.Write(r[i] + fb_r);
      l[i] = dry * l[i] + mix * wet_l;
      r[i] = dry * r[i] + mix * wet_r;
    }
  }

  void Reset() {
    line_l_.Clear();
    line_r_.Clear();
    damp_l_.Reset();
    damp_r_.Reset();
  }

 private:
  float sr_ = 48000.0f, max_sec_ = 1.0f;
  Params p_;
  DelayLineExt line_l_, line_r_;
  OnePole damp_l_, damp_r_;
  Smoother sm_l_, sm_r_;
};

/* Owning form: kMaxMs of delay per side, in .bss. */
template <uint32_t kMaxMs = 500, uint32_t kSampleRate = 48000>
class StereoDelay : public StereoDelayExt {
 public:
  static constexpr uint32_t kCap =
      detail::NextPow2((kMaxMs * kSampleRate) / 1000 + 4);

  void Init(float sample_rate) {
    Params p;
    Init(sample_rate, p);
  }
  void Init(float sample_rate, const Params& p) {
    StereoDelayExt::Init(sample_rate, l_, r_, kCap, p);
  }

 private:
  float l_[kCap];
  float r_[kCap];
};

}  // namespace bellows
