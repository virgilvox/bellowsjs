/* Step 1 of the 06_FirstSteps example: a tone.
 *
 * The smallest thing in this library that makes a sound, and it is smaller
 * than 01_OneKick: one oscillator, written straight into the buffer. No
 * engine, no envelope, no filter, no note. It starts when the board starts
 * and it does not stop.
 *
 * The point of having a rung this low is that it separates two questions
 * that get tangled on a first bring-up. If this is silent, the problem is
 * wiring, the codec, or the sample rate. If this is audible and something
 * else is not, the problem is in the program. Nothing here can be wrong
 * except the pitch.
 *
 * BlepOsc is band limited, which is the one thing that is not simple about
 * it. A saw built the obvious way, a counter ramping and wrapping, folds
 * every harmonic above Nyquist back down into the audible band as an
 * inharmonic whine that gets worse as you play higher. This one subtracts
 * a tabulated Kaiser-windowed sinc at each discontinuity instead, measured
 * at -85 dB or better through the musical range. That is why one
 * oscillator is 8552 B of flash rather than 200: the table is most of it,
 * and it is paid once no matter how many oscillators read it.
 *
 * Voices ADD into the buffer, so this one does too, and the caller clears
 * the block. That contract is the same all the way up the library.
 *
 * All four rungs share one namespace, `firststeps`, rather than having one
 * each. That is the convention the other examples follow, and here it is
 * also load bearing: this file was `namespace tone` first and it does not
 * compile, because the Arduino core declares `void tone(uint8_t pin,
 * uint16_t frequency, uint32_t duration)` and a namespace cannot share a
 * name with a function. Nothing on the host could see it, since a host
 * probe never includes Arduino.h. The board matrix caught it, which is the
 * argument for the matrix building real firmware rather than headers. */
#pragma once

#include "bellows/dsp/oscillators.h"

namespace firststeps {

class Tone {
 public:
  struct Params {
    /* A3. Low enough to hear the body of the waveform, high enough that a
     * small speaker or a piezo will pass it. */
    float freq = 220.0f;
    float level = 0.25f;
  };

  void Init(float sample_rate) {
    Params p;
    p.freq = 220.0f;
    p.level = 0.25f;
    Init(sample_rate, p);
  }

  void Init(float sample_rate, const Params& p) {
    p_ = p;
    osc_.Init(sample_rate);
    osc_.SetShape(bellows::BlepShape::kSaw);
    osc_.SetFreq(p_.freq);
  }

  void SetParams(const Params& p) {
    p_ = p;
    osc_.SetFreq(p_.freq);
  }

  void operator()(float* l, float* r, int from, int to) {
    for (int i = from; i < to; ++i) {
      const float s = osc_.Process() * p_.level;
      l[i] += s;
      r[i] += s;
    }
  }

 private:
  bellows::BlepOsc osc_;
  Params p_;
};

}  // namespace firststeps
