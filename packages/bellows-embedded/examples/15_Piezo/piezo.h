/* Voicing a bellows patch for a piezo disc.
 *
 * A piezo disc is not a small speaker. It is a capacitor, around 10 to 20
 * nF for a 27 mm brass disc, glued to a metal plate with a sharp mechanical
 * resonance, and it moves almost no air anywhere else. Feeding it the same
 * signal you would send an 8 ohm cone wastes nearly all of the available
 * voltage swing on frequencies it cannot reproduce.
 *
 * There are four things that help, in order of how much:
 *
 * 1. DRIVE IT DIFFERENTIALLY. A logic pin swings 3.3 V. Two pins in
 *    antiphase across the disc swing 6.6 V, which is 6 dB, which is more
 *    than everything below put together. That part is in the .ino, because
 *    it is wiring rather than DSP: this header renders the signal and its
 *    inverse into the two channels.
 *
 * 2. THROW AWAY THE BASS. Not attenuate: remove. The disc's impedance is
 *    1 / (2*pi*f*C), so at 100 Hz a 15 nF disc is about a megaohm and
 *    essentially nothing flows. Every volt spent down there is a volt not
 *    available at 4 kHz, and since the limiter below works on peaks, bass
 *    the disc cannot reproduce still steals headroom from the part it can.
 *    Two poles of highpass, high.
 *
 * 3. BOOST WHERE IT RINGS. The disc has a strong resonance, usually
 *    somewhere between 2 and 6 kHz, and it is much louder there than
 *    anywhere else. Find yours (the .ino has a sweep mode) and put the
 *    bell on it.
 *
 * 4. LIMIT HARD. There is no headroom to protect: the swing is fixed by
 *    the supply and anything above it clips at the pin regardless. So the
 *    useful move is to raise the average level until it is just under the
 *    ceiling all the time, which is what a limiter with a low ceiling and
 *    a fast release does.
 *
 * What this cannot fix: a piezo has no bass, and no amount of processing
 * invents any. A bass line played through one is heard through its
 * harmonics, so patches for a piezo should be written an octave or two up
 * from where they would sit on a speaker.
 */
#pragma once

#include "bellows/dsp/filters.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"

namespace piezo {

/* Defaults for a common 27 mm brass disc. Measure yours: the .ino's sweep
 * mode steps a tone across the band so you can hear which is loudest, and
 * that frequency is what belongs in resonance_hz. Mounting changes it, and
 * a disc glued to a box will be lower than a disc held in the air. */
struct Voicing {
  /* Everything below here is thrown away. 1200 is conservative for a bare
   * disc; a mounted one can usually go lower. */
  float highpass_hz = 1200.0f;
  /* The disc's mechanical resonance, and how hard to lean on it. */
  float resonance_hz = 4000.0f;
  float resonance_db = 8.0f;
  float resonance_q = 1.2f;
  /*
   * Gain applied after the filtering and before the limiter.
   *
   * The chain above is subtractive: two cascaded highpasses throw away
   * everything the disc cannot reproduce, and on a full-range patch that
   * is most of the energy. Measured on 07_Workstation, whose kick is at
   * 50 Hz and whose bass runs 110 to 262 Hz, the chain took RMS from
   * -19.5 dBFS to -32.9, and the peak reached 0.658 against a ceiling of
   * 0.944, so the limiter never engaged once and the disc saw a third of
   * the swing it could have had.
   *
   * Point 4 at the top of this file says the useful move is to raise the
   * average level until it is just under the ceiling all the time. This
   * is the control that does it. 1.0 leaves the chain exactly as it was.
   */
  float drive = 1.0f;
  /* Just under full scale. Not 0 dB: the pin clips hard and squarely, and
   * the last fraction of a dB is not worth the sound of that. */
  float ceiling_db = -0.5f;
  float release = 0.02f;
};

/* Wraps any bellows render and voices its output for a disc. Render is a
 * template parameter for the same reason it is one in the platform
 * adapters: the call inlines and the linker still sees exactly which
 * engines the sketch reaches. */
template <class Render>
class Voiced {
 public:
  explicit Voiced(Render& render) : render_(&render) {}

  void Init(float sample_rate, const Voicing& v = Voicing()) {
    v_ = v;
    /* Two cascaded one-pole-pair highpasses rather than one, because a
     * single 12 dB slope still leaves plenty of 400 Hz energy in the
     * limiter's sidechain, and the limiter cannot tell that the disc will
     * never reproduce it. 24 dB/octave costs four biquads and buys back
     * real loudness. */
    for (int i = 0; i < 2; ++i) {
      for (int c = 0; c < 2; ++c) {
        hp_[i][c].Init(sample_rate);
        hp_[i][c].SetMode(bellows::SvfMode::kHp);
        hp_[i][c].Set(v_.highpass_hz, 0.707f);
      }
    }
    bell_.Init(sample_rate, bellows::SvfMode::kBell, v_.resonance_hz, v_.resonance_q);
    bell_.Set(v_.resonance_hz, v_.resonance_db, v_.resonance_q, true);

    bellows::Limiter<>::Params lp;
    lp.ceiling_db = v_.ceiling_db;
    lp.release = v_.release;
    limiter_.Init(sample_rate, lp);
  }

  /* The bellows render signature, so this drops straight into
   * BellowsAudioStream in place of the patch it wraps. */
  void operator()(float* l, float* r, int from, int to) {
    (*render_)(l, r, from, to);

    for (int n = from; n < to; ++n) {
      float x = 0.5f * (l[n] + r[n]);  /* one disc, so one signal */
      for (int i = 0; i < 2; ++i) x = hp_[i][0].Process(x);
      if (!bell_.Bypassed()) x = bell_.Process(0, x);
      /* After the filtering, so it lifts only what the disc can use, and
       * before the limiter, so the limiter is what controls the peaks. */
      x *= v_.drive;
      l[n] = x;
      r[n] = x;
    }

    limiter_.Process(l, r, from, to);

    /* The differential half of the trick. Left goes to one pin, right to
     * the other, and the disc sits between them, so it sees twice the
     * swing either pin can produce on its own. Wire it single-ended and
     * you get the same sound 6 dB quieter, which still works. */
    for (int n = from; n < to; ++n) r[n] = -l[n];
  }

 private:
  Render* render_;
  Voicing v_;
  bellows::Svf hp_[2][2];
  bellows::EqBand bell_;
  bellows::Limiter<> limiter_;
};

}  // namespace piezo
