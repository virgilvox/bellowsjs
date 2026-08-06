/* Transcription of the TubeVoice half of src/engines/waveguide.ts.
 *
 * Cylindrical bore after the STK clarinet: a half period delay line, a
 * two point average reflection filter with gain -0.95 (inverting, which
 * is the open end), and a memoryless reed table
 * clamp(0.7 - 0.3 * pressure_diff, -1, 1) driven by breath pressure plus
 * rng noise. The bore length subtracts 1.5 samples from the half period:
 * one sample of write-to-read latency and the half sample of group delay
 * the two point average adds. It sounds while the gate is held and
 * releases on NoteOff.
 *
 * True legato: Glide(hz) on an active voice moves the sounding
 * fundamental to hz over the glide time, equal cents per second,
 * retuning the bore once per block rather than per sample (the bore
 * delay only has to be right at audio rates, and a pow per sample buys
 * nothing). The breath envelope keeps running, so the transition never
 * re-attacks; only a small legato_scratch noise cue, scaled by the
 * interval and decaying over 30 ms, marks the move. The JS reaches this
 * through setParam('freq', hz); a named method is clearer and costs no
 * string compare.
 *
 * The bore is the only large allocation, so the class is templated on
 * the lowest note it must reach, the same way Pluck is. Tube<> at 20 Hz
 * is 8 KB of delay line; Tube<80> is 2 KB. The caller pays for the range
 * they actually play.
 */
#pragma once
#include <math.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/noise.h"

namespace bellows {

template <int kMinFreqHz = 20, int kSampleRate = BELLOWS_SAMPLE_RATE>
class Tube {
 public:
  /* Half period at the lowest note, plus room for the read offset. */
  static constexpr uint32_t kMaxSamples = kSampleRate / (2 * kMinFreqHz) + 5;

  struct Params {
    float breath = 0.85f;
    float noise = 0.1f;
    float level = 0.7f;
    /* Legato params, same contract as the string engine. */
    float glide = 0.03f;
    float legato_scratch = 0.15f;
  };

  void Init(float sample_rate, Rng* rng) {
    Params d;
    Init(sample_rate, rng, d);
  }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    /* Same guard Pluck::Init carries, and for the same reason: a rate that
     * is not finite and positive reaches every coefficient below and comes
     * back out as NaN audio on the mix bus. An SDK query that failed is how
     * a caller gets here. Falls back to the rate this instance was sized
     * for. */
    sr_ = (sample_rate > 0.0f && isfinite(sample_rate)) ? sample_rate
                                                        : static_cast<float>(kSampleRate);
    p_ = p;
    delay_.Init();
    /* Everything below takes sr_, never the raw argument: guarding the member
     * and then seeding the coefficients from the unguarded parameter leaves
     * exactly the fault the guard was added for. */
    noise_.Init(sr_, NoiseColor::kWhite, rng);
    env_.Init(sr_);
    env_.Set(0.02f, 0.03f, 1.0f, 0.12f);
    track_coef_ = fm::Exp(-1.0f / (kTrackTau * sr_));
    /* 30 ms one shot cue for the legato transition, like the string bite */
    scratch_coef_ = fm::Exp(-1.0f / (0.03f * sr_));
  }

  void SetParams(const Params& p) { p_ = p; }

  void NoteOn(float freq, float vel) {
    float f = Clamp(freq, static_cast<float>(kMinFreqHz), sr_ / 12.0f);
    freq_ = f;
    vel_ = Clamp(vel, 0.0f, 1.0f);
    delay_.Clear();
    pr_z_ = 0.0f;
    env_.Reset();
    env_.Trigger();
    read_delay_ = BoreDelay(f);
    /* a fresh note owns its pitch: cancel any legato glide in flight */
    glide_left_ = 0;
    scratch_env_ = 0.0f;
    live_ = true;
    tracker_ = 0.01f;
  }

  void NoteOff() { env_.Release(); }

  /* True legato. Glides the sounding bore to target_hz over the glide
   * time. Ignored on an inactive voice: an idle tube has no pitch to
   * move, so the caller wants NoteOn instead. */
  void Glide(float target_hz) {
    if (!live_) return;
    float target = Clamp(target_hz, static_cast<float>(kMinFreqHz), sr_ / 12.0f);
    float semis = 12.0f * fm::Log2(target / freq_);
    if (semis < 0.0f) semis = -semis;
    scratch_level_ = (semis < kLegatoScratchSemis ? semis : kLegatoScratchSemis) / kLegatoScratchSemis;
    scratch_env_ = 1.0f;
    int dur = static_cast<int>(Clamp(p_.glide, 0.0f, kGlideMaxSec) * sr_ + 0.5f);
    if (dur < 1) {
      glide_left_ = 0;
      freq_ = target;
      read_delay_ = BoreDelay(target);
    } else {
      glide_from_ = freq_;
      glide_to_ = target;
      glide_dur_ = static_cast<float>(dur);
      glide_left_ = dur;
    }
  }

  void Process(float* l, float* r, int from, int to) {
    if (!live_) return;
    if (glide_left_ > 0) {
      /* legato retune at block rate, equal cents per second; the breath
       * envelope keeps running so the transition never re-attacks */
      glide_left_ -= to - from;
      if (glide_left_ <= 0) {
        glide_left_ = 0;
        freq_ = glide_to_;
      } else {
        float t = 1.0f - static_cast<float>(glide_left_) / glide_dur_;
        freq_ = glide_from_ * fm::Pow(glide_to_ / glide_from_, t);
      }
      read_delay_ = BoreDelay(freq_);
    }
    const float level = p_.level;
    const float max_pressure = Clamp(p_.breath, 0.0f, 1.0f) * (0.6f + 0.4f * vel_);
    const float n_amt = Clamp(p_.noise, 0.0f, 1.0f) * 0.4f;
    /* legato cue: extra breath noise share for the first 30 ms of a glide */
    const float n_scr_amt = Clamp(p_.legato_scratch, 0.0f, 1.0f) * scratch_level_ * 0.3f;
    for (int i = from; i < to; ++i) {
      float pr = delay_.ReadLinear(read_delay_);
      /* reflection filter: two point average, inverting open end */
      float refl = -0.95f * 0.5f * (pr + pr_z_);
      pr_z_ = pr;
      float breath_p = env_.Process() * max_pressure;
      float n_eff = n_amt;
      if (scratch_env_ > 1e-4f) {
        scratch_env_ *= scratch_coef_;
        n_eff += n_scr_amt * scratch_env_;
      }
      breath_p *= 1.0f + n_eff * noise_.Process();
      float pdiff = refl - breath_p;
      float reed = Clamp(0.7f - 0.3f * pdiff, -1.0f, 1.0f);
      float s = breath_p + pdiff * reed;
      delay_.Write(s);
      float o = pr * level;
      l[i] += o;
      r[i] += o;
      float as = pr < 0.0f ? -pr : pr;
      tracker_ = as > tracker_ ? as : tracker_ * track_coef_;
    }
    if (!env_.Active() && tracker_ < kSilence) live_ = false;
  }

  bool Active() const { return live_; }

 private:
  static constexpr float kTrackTau = 0.05f;
  static constexpr float kSilence = 1e-4f;
  static constexpr float kGlideMaxSec = 0.5f;
  /* Interval, in semitones, at which the legato cue reaches full level. */
  static constexpr float kLegatoScratchSemis = 5.0f;

  /* Half period bore minus one sample write-to-read latency and the
   * half sample of the two point average reflection filter. */
  float BoreDelay(float f) const {
    float d = sr_ / (2.0f * f) - 1.5f;
    return d < 1.0f ? 1.0f : d;
  }

  float sr_ = 48000.0f;
  Params p_;
  DelayLine<kMaxSamples> delay_;
  NoiseGen noise_;
  Adsr env_;

  float read_delay_ = 2.0f, pr_z_ = 0.0f;
  float freq_ = 200.0f, vel_ = 1.0f;
  bool live_ = false;
  float tracker_ = 0.0f, track_coef_ = 0.0f;

  /* legato glide, same block-rate scheme as the string */
  float glide_from_ = 200.0f, glide_to_ = 200.0f, glide_dur_ = 1.0f;
  int glide_left_ = 0;
  float scratch_env_ = 0.0f, scratch_level_ = 0.0f, scratch_coef_ = 0.0f;
};

}  // namespace bellows
