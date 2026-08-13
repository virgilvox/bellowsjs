/* Step 3 of the 06_FirstSteps example: a sound.
 *
 * Step 2 plus a filter, and a second envelope to move it. This is the rung
 * where it stops being a test tone: a saw through a resonant lowpass whose
 * cutoff falls as the note decays is most of what a subtractive synth is,
 * and 03_PolySynth is this with a voice pool around it.
 *
 * Two envelopes rather than one, because they are doing different jobs.
 * The amplitude envelope says how loud, the filter envelope says how
 * bright, and they almost never want the same times: a plucked sound is a
 * slow amplitude decay under a fast brightness decay. Sharing one is the
 * commonest reason a patch sounds like a toy.
 *
 * The ladder is the Moog topology: four one-pole stages with a tanh in
 * each and a feedback path whose gain is the resonance. Its cutoff is set
 * against 2x the sample rate, which is deliberate and documented in
 * dsp/filters.h; it is not a bug and audit 2 refuted it twice.
 *
 * Resonance is the knob to turn. Past about 0.9 the feedback loop starts
 * to sustain itself and the filter sings its own pitch, which is a synth
 * sound rather than a fault. */
#pragma once

#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/oscillators.h"

namespace firststeps {

class Filter {
 public:
  struct Params {
    float freq = 110.0f;
    /* Where the filter opens to at the peak of the note. */
    float cutoff = 2600.0f;
    /* Where it falls back to. The sweep between the two is the sound. */
    float cutoff_floor = 180.0f;
    float resonance = 0.72f;
    float decay = 0.45f;
    float filter_decay = 0.22f;
    float level = 0.32f;
  };

  void Init(float sample_rate) {
    Params p;
    p.freq = 110.0f;
    p.cutoff = 2600.0f;
    p.cutoff_floor = 180.0f;
    p.resonance = 0.72f;
    p.decay = 0.45f;
    p.filter_decay = 0.22f;
    p.level = 0.32f;
    Init(sample_rate, p);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = sample_rate;
    osc_.Init(sample_rate);
    osc_.SetShape(bellows::BlepShape::kSaw);
    amp_.Init(sample_rate);
    filt_.Init(sample_rate);
    ladder_.Init(sample_rate);
    SetParams(p);
    SetTempo(120);
  }

  void SetParams(const Params& p) {
    p_ = p;
    osc_.SetFreq(p_.freq);
    /* Sustain 0 on both, so decay is the whole of the note and there is
     * nothing to hold. */
    amp_.Set(0.004f, p_.decay, 0.0f, 0.05f);
    filt_.Set(0.002f, p_.filter_decay, 0.0f, 0.05f);
  }

  void SetTempo(unsigned bpm) {
    float per_sec = (static_cast<float>(bpm) / 60.0f) * 2.0f; /* eighths */
    samples_per_step_ = static_cast<int>(sr_ / per_sec + 0.5f);
    if (samples_per_step_ < 2) samples_per_step_ = 2;
  }

  void operator()(float* l, float* r, int from, int to) {
    for (int i = from; i < to; ++i) {
      if (pos_ == 0) {
        amp_.Trigger();
        filt_.Trigger();
      }
      /* One filter update per sample. It is a control signal, so per block
       * would do and is what 03_PolySynth does; per sample here because
       * the sweep is short enough to hear the steps at 128 frames. */
      const float e = filt_.Process();
      const float span = p_.cutoff - p_.cutoff_floor;
      ladder_.Set(p_.cutoff_floor + span * e, p_.resonance);
      const float s = ladder_.Process(osc_.Process()) * amp_.Process() * p_.level;
      l[i] += s;
      r[i] += s;
      if (++pos_ >= samples_per_step_) pos_ = 0;
    }
  }

 private:
  bellows::BlepOsc osc_;
  bellows::Adsr amp_;
  bellows::Adsr filt_;
  bellows::LadderFilter ladder_;
  Params p_;
  float sr_ = 48000.0f;
  int samples_per_step_ = 1;
  int pos_ = 0;
};

}  // namespace firststeps
