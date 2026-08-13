/* Step 2 of the 06_FirstSteps example: a note.
 *
 * The same oscillator as step 1 with an envelope on its amplitude, and a
 * counter that retriggers it. That is the whole difference between a tone
 * and a note: something has to decide when it starts and how it stops.
 *
 * ADSR is four numbers and only one of them is a shape rather than a time.
 * Attack, decay and release are how long; sustain is how loud it sits
 * while a key is held, from 0 to 1. Set sustain to 0 and decay becomes the
 * whole of the note, which is how every percussive sound in this library
 * is built, including the kick in 01_OneKick.
 *
 * The curves are exponential, not linear, because hearing is. The
 * constants that set them are in dsp/envelopes.h and they are chosen so
 * the attack crosses 1.0 at exactly the attack time (ln 3) and decay and
 * release cover 99 percent of their span in the time you asked for
 * (ln 100). Without that a "0.5 second decay" means whatever the
 * implementation felt like.
 *
 * Gate length is deliberately a separate number from the envelope. The
 * note is released partway through the step, so you can hear the release
 * as its own stage rather than as the start of the next note. */
#pragma once

#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/oscillators.h"

namespace firststeps {

class Envelope {
 public:
  struct Params {
    float freq = 220.0f;
    float attack = 0.005f;
    float decay = 0.12f;
    float sustain = 0.55f;
    float release = 0.25f;
    /* Fraction of the step the note is held for, before the release. */
    float gate = 0.5f;
    float level = 0.3f;
  };

  void Init(float sample_rate) {
    Params p;
    p.freq = 220.0f;
    p.attack = 0.005f;
    p.decay = 0.12f;
    p.sustain = 0.55f;
    p.release = 0.25f;
    p.gate = 0.5f;
    p.level = 0.3f;
    Init(sample_rate, p);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = sample_rate;
    osc_.Init(sample_rate);
    osc_.SetShape(bellows::BlepShape::kSaw);
    env_.Init(sample_rate);
    SetParams(p);
    SetTempo(120);
  }

  void SetParams(const Params& p) {
    p_ = p;
    osc_.SetFreq(p_.freq);
    env_.Set(p_.attack, p_.decay, p_.sustain, p_.release);
  }

  /* One note per beat. */
  void SetTempo(unsigned bpm) {
    float per_sec = static_cast<float>(bpm) / 60.0f;
    samples_per_step_ = static_cast<int>(sr_ / per_sec + 0.5f);
    if (samples_per_step_ < 2) samples_per_step_ = 2;
  }

  void operator()(float* l, float* r, int from, int to) {
    for (int i = from; i < to; ++i) {
      if (pos_ == 0) env_.Trigger();
      /* Release partway through, so the release stage is audible on its
       * own rather than being cut off by the next attack. */
      if (pos_ == static_cast<int>(static_cast<float>(samples_per_step_) * p_.gate)) {
        env_.Release();
      }
      const float s = osc_.Process() * env_.Process() * p_.level;
      l[i] += s;
      r[i] += s;
      if (++pos_ >= samples_per_step_) pos_ = 0;
    }
  }

 private:
  bellows::BlepOsc osc_;
  bellows::Adsr env_;
  Params p_;
  float sr_ = 48000.0f;
  int samples_per_step_ = 1;
  int pos_ = 0;
};

}  // namespace firststeps
