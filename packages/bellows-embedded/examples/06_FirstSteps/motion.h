/* Step 4 of the 06_FirstSteps example: movement.
 *
 * Step 3 with an LFO, which is the last primitive you need before the
 * engines start doing the work for you. An envelope moves once per note. An
 * LFO moves whether or not anything is playing, and that difference is why
 * a patch with both sounds alive and a patch with neither sounds like a
 * sample.
 *
 * Two of them here, doing the two jobs LFOs actually do. A slow triangle
 * walks the filter cutoff across the whole note, which is the sweep you
 * hear on a pad. A fast sine moves the pitch by a few cents, which is
 * vibrato, and the depth is in cents rather than Hz on purpose: a fixed
 * number of Hz is a wide wobble low down and inaudible high up, because
 * pitch is logarithmic and Hz is not.
 *
 * The phase accumulator is a uint32 counter, not a float. A float
 * accumulator loses part of every increment to rounding as it approaches
 * 1.0, systematically rather than randomly, so the error grows with the
 * length of the note instead of averaging out. That was measured as the
 * whole of the chorus parity gap against the browser, 4e-2 with modulation
 * running against 6.3e-6 with it off, and the fix moved three parity rows.
 * The wrap is the natural unsigned overflow, so it costs neither a compare
 * nor a branch. See config.h. */
#pragma once

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/lfo.h"
#include "bellows/dsp/oscillators.h"

namespace firststeps {

class Motion {
 public:
  struct Params {
    float freq = 165.0f;
    float cutoff = 1500.0f;
    float resonance = 0.6f;
    /* How far the slow LFO opens and closes the filter, in octaves. */
    float sweep_octaves = 2.2f;
    float sweep_rate = 0.18f;
    /* Vibrato, in cents so it is the same size at every pitch. */
    float vibrato_cents = 12.0f;
    float vibrato_rate = 5.2f;
    float decay = 0.8f;
    float level = 0.3f;
  };

  void Init(float sample_rate) {
    Params p;
    p.freq = 165.0f;
    p.cutoff = 1500.0f;
    p.resonance = 0.6f;
    p.sweep_octaves = 2.2f;
    p.sweep_rate = 0.18f;
    p.vibrato_cents = 12.0f;
    p.vibrato_rate = 5.2f;
    p.decay = 0.8f;
    p.level = 0.3f;
    Init(sample_rate, p);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = sample_rate;
    osc_.Init(sample_rate);
    osc_.SetShape(bellows::BlepShape::kSaw);
    amp_.Init(sample_rate);
    ladder_.Init(sample_rate);
    sweep_.Init(sample_rate);
    sweep_.SetShape(bellows::LfoShape::kTriangle);
    vib_.Init(sample_rate);
    vib_.SetShape(bellows::LfoShape::kSine);
    SetParams(p);
    SetTempo(120);
  }

  void SetParams(const Params& p) {
    p_ = p;
    amp_.Set(0.01f, p_.decay, 0.0f, 0.08f);
    sweep_.SetFreq(p_.sweep_rate);
    vib_.SetFreq(p_.vibrato_rate);
  }

  void SetTempo(unsigned bpm) {
    /* Clamped before the divide: bpm 0 makes an infinity and casting that
     * to int is undefined. */
    if (bpm < 20u) bpm = 20u;
    if (bpm > 400u) bpm = 400u;
    float per_sec = static_cast<float>(bpm) / 60.0f;
    samples_per_step_ = static_cast<int>(sr_ / per_sec + 0.5f);
    if (samples_per_step_ < 2) samples_per_step_ = 2;
  }

  /* Both LFOs are stepped once per block, which is the rate the browser
   * kernel steps a parameter ramp at and is far above anything audible in
   * the movement itself. */
  void operator()(float* l, float* r, int from, int to) {
    const float sweep = 0.5f * (sweep_.Process() + 1.0f); /* 0 .. 1 */
    const float cents = vib_.Process() * p_.vibrato_cents;
    osc_.SetFreq(p_.freq * bellows::fm::Exp2(cents / 1200.0f));
    ladder_.Set(p_.cutoff * bellows::fm::Exp2(sweep * p_.sweep_octaves), p_.resonance);

    for (int i = from; i < to; ++i) {
      if (pos_ == 0) amp_.Trigger();
      const float s = ladder_.Process(osc_.Process()) * amp_.Process() * p_.level;
      l[i] += s;
      r[i] += s;
      if (++pos_ >= samples_per_step_) pos_ = 0;
    }
  }

 private:
  bellows::BlepOsc osc_;
  bellows::Adsr amp_;
  bellows::LadderFilter ladder_;
  bellows::Lfo sweep_;
  bellows::Lfo vib_;
  Params p_;
  float sr_ = 48000.0f;
  int samples_per_step_ = 1;
  int pos_ = 0;
};

}  // namespace firststeps
