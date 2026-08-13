/* Shared logic for the 07_Workstation example.
 *
 * Every other example here teaches one idea. This one is the argument for
 * the library: five engines playing at once, a sequencer driving them from
 * the theory layer, an effect on a send, and one seed deciding the whole
 * thing, so two boards flashed with this file play the same four bars in
 * the same order for as long as they are both running.
 *
 * WHAT IS PLAYING
 *
 * Four bars of sixteenths in A natural minor, i VI iv v, one chord a bar.
 *
 *   kick    E(5,16)              Kick
 *   snare   E(4,16) rotated 4    Snare, on a send
 *   hat     E(11,16) rotated 1   Hat
 *   bass    E(3,16)              Va, the chord root, its fifth now and then
 *   melody  E(9,16) rotated 2    Pluck, four voices, notes from a Markov
 *                                chain, on a send
 *
 * The melody is the part worth reading. It is not a stored phrase: a
 * variable-order Markov chain is trained once on a sixteen note motif in
 * scale degrees, and every note after that is drawn from it, backing off
 * to a shorter context whenever the one it has was never seen.
 *
 * What that gives, measured over 20000 draws rather than assumed: the
 * chain plays five of the eight degrees, 0 2 4 5 7, because those are the
 * five the motif contains and a chain cannot invent a symbol it was never
 * trained on. The full sixteen note motif does turn up now and then, so
 * this is not a phrase generator that never quotes its source; it is the
 * motif as one path through the table among many, and which path you get
 * is decided by the seed.
 *
 * PITCH IS A LAYER, NOT A FORMULA
 *
 * Nothing here writes 440 * 2^((n - 69) / 12). A degree goes through
 * bellows::DegreeFreq with a Scale and a Tuning, which is what makes
 * 04_ScalesAndTuning's point reusable: change edo12_ to a 19-EDO tuning
 * and the whole piece transposes into it, motif, chords and bass line,
 * without touching a note of the arrangement.
 *
 * THE SEND BUS IS WRITTEN OUT BY HAND, BECAUSE THERE ISN'T ONE
 *
 * The TypeScript has b.bus() and inst.send(). This library deliberately
 * has no mixer: it is engines, effects and a kernel, and routing is the
 * application's business. So RenderSpan below IS the mixer, and it is
 * about fifteen lines. The one rule that shapes it is that a voice
 * advances its envelope when it renders, so a part that needs to go two
 * places has to be rendered ONCE into a scratch buffer and added twice.
 * Rendering it again would double its cost and desynchronise the copy.
 *
 * ONE ROOT, ONE STREAM PER PART
 *
 * bellows::Rng has no Fork(), and needs none: forking in the TypeScript is
 * literal string concatenation with "::", so writing the full path into
 * Init() lands on the same stream the browser is on. See core/prng.h. The
 * four labels below are that path written out, one per part, so the drums
 * cannot pull the melody off its sequence when a pattern changes.
 *
 * WHICH BOARDS, AND THE ANSWER WAS NOT THE ONE EXPECTED
 *
 * Teensy 4.0, 4.1 and MicroMod with room to spare, and 3.5 and 3.6 at 91.4
 * and 91.5 percent of their RAM, which is a fit with nothing left over.
 * Teensy 3.2 and LC do not fit at all. Those are build results from
 * examples/build-matrix.sh, not a reading of data sheets, and the 3.5 and
 * 3.6 columns were a surprise: this was written expecting 4.x only.
 *
 * The stereo delay is 500 ms at 48 kHz, 187 KB, which is most of the 225 KB
 * this costs and is more than a Teensy 3.2 has in total. It is deliberately
 * NOT scaled down per board the way 10_AudioShield's string floor is: a
 * composer patch that quietly becomes a different composer patch on a
 * smaller part is worse than one that says it does not fit. If you want it
 * on a 3.2, shorten the delay yourself and know that you did.
 *
 * None of that says any of those boards is fast enough. It fits, and 3.5
 * runs at 120 MHz against a 4.1's 600, so if anything here is going to run
 * out of time it is that one. Nobody has measured it.
 *
 * MEASURED COST, Cortex-M7, -Os, --gc-sections: see the report row for
 * p11_e7_workstation. */
#pragma once

#include "bellows/config.h"
#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/va.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"
#include "bellows/seq/euclid.h"
#include "bellows/seq/markov.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"
#include "bellows/voicepool.h"

namespace workstation {

inline constexpr int kSteps = 16; /* sixteenths in a bar */
inline constexpr int kBars = 4;

/* i VI iv v in scale degrees. Degree 0 is the root of the scale, and
 * degrees past its length wrap into the next octave, so this stays
 * meaningful in any tuning. */
inline constexpr int kProgression[kBars] = {0, 5, 3, 4};

/* Scale degrees relative to the bar's chord, so the alphabet is eight
 * symbols: an octave of the scale plus the root above it. */
inline constexpr int kAlphabet = 8;

/* The motif the chain is trained on, once, at Init. Sixteen notes, two
 * phrases that answer each other. Nothing plays it: it is the statistics
 * that play. */
inline constexpr uint8_t kMotif[] = {0, 2, 4, 2, 7, 4, 2, 0, 4, 5, 4, 2, 0, 2, 4, 7};
inline constexpr int kMotifLen = static_cast<int>(sizeof(kMotif) / sizeof(kMotif[0]));

/* Order 2 over eight symbols needs at most 1 + 8 + 64 contexts, and this
 * motif reaches 15 of them, counted. 48 leaves room to edit the motif
 * without silently dropping transitions; Truncated() reports it if you
 * overrun, and Init here checks it. */
using Chain = bellows::Markov<kAlphabet, 48, 2>;

/* A 110 Hz floor is two octaves below the melody's lowest note, which
 * costs a fifth of what a 20 Hz floor would per voice. The floor is the
 * delay line and the delay line is the RAM. */
using String = bellows::Pluck<110>;

inline constexpr int kVoices = 4;

/* The scratch the hand-written send bus runs through. One block, matching
 * the kernel and the Teensy audio library. */
inline constexpr int kMaxBlock = BELLOWS_BLOCK_SIZE;

class Piece {
 public:
  void Init(float sample_rate, unsigned bpm) {
    sr_ = sample_rate;

    /* One root, one stream per part. Nothing shares a stream, so changing
     * a drum pattern cannot move the melody. */
    rng_seq_.Init("workstation::seq");
    rng_melody_.Init("workstation::melody");
    rng_bass_.Init("workstation::bass");
    /* The JS snare forks 'snare/noise' off its channel stream, so this is
     * the path that stream would have. */
    rng_snare_.Init("workstation::kit::snare/noise");

    kick_.Init(sample_rate);
    snare_.Init(sample_rate, &rng_snare_);
    hat_.Init(sample_rate);

    bellows::Va::Params bass;
    bass.shape = 0.15f;      /* close to a saw, which the ladder likes */
    bass.detune = 4.0f;
    bass.sub = 0.6f;         /* the octave below is most of the weight */
    bass.cutoff = 900.0f;
    bass.resonance = 0.25f;
    bass.env_amount = 0.4f;
    bass.attack = 0.004f;
    bass.decay = 0.18f;
    bass.sustain = 0.45f;
    bass.release = 0.12f;
    bass_.Init(sample_rate, &rng_bass_, bass);

    String::Params str;
    str.damp = 0.32f;
    str.pick_pos = 0.22f;
    str.decay = 2.4f;
    str.level = 0.8f;
    for (int i = 0; i < kVoices; ++i) melody_.at(i).Init(sample_rate, &rng_melody_, str);

    /* A minor, root index 57 which is A3. Bass plays an octave below it
     * and the melody two above, by shifting the degree rather than the
     * root, so one scale and one tuning serve all three parts. */
    scale_.Init(57, bellows::kScaleMinor);
    edo12_.InitEdo(12, 440.0f, 69);

    for (int i = 0; i < kBars; ++i) prog_[i] = kProgression[i];
    for (int i = 0; i < kMotifLen; ++i) motif_[i] = kMotif[i];
    chain_.Init(2);
    trained_ = chain_.Train(motif_, kMotifLen);
    chain_.Seed(motif_, 2);

    kick_pat_.Generate(5, kSteps);
    snare_pat_.Generate(4, kSteps, 4);
    hat_pat_.Generate(11, kSteps, 1);
    bass_pat_.Generate(3, kSteps);
    melody_pat_.Generate(9, kSteps, 2);

    /* The last thing in the chain, exactly as b.masterFx(['limiter']) is
     * in the browser. It is not gain staging: the mix below is set so the
     * limiter takes a decibel or two off the loudest bars and nothing at
     * all off the quiet ones. It is there because a converter clips and
     * the piezo path in 15_Piezo has no headroom to give. */
    bellows::Limiter<>::Params lim;
    lim.ceiling_db = -1.0f;
    lim.release = 0.08f;
    limiter_.Init(sample_rate, lim);

    bellows::Eq3::Params eq;
    eq.low_freq = 110.0f;
    eq.low_gain = 2.0f;    /* the kick and the sub, lifted a little */
    eq.mid_freq = 800.0f;
    eq.mid_gain = -2.5f;   /* room for the strings above the bass */
    eq.mid_q = 0.8f;
    eq.high_freq = 7000.0f;
    eq.high_gain = 2.0f;
    eq_.Init(sample_rate, eq);

    SetTempo(bpm);
  }

  /* Tempo sets the step length AND the delay times, so the echo stays in
   * time with the pattern instead of drifting against it. Left is a
   * dotted eighth and right an eighth, which is the pairing that makes a
   * stereo delay read as a rhythm rather than as a smear. */
  void SetTempo(unsigned bpm) {
    bpm_ = bpm;
    const float steps_per_sec = (static_cast<float>(bpm) / 60.0f) * 4.0f;
    samples_per_step_ = static_cast<int>(sr_ / steps_per_sec + 0.5f);
    if (samples_per_step_ < 1) samples_per_step_ = 1;

    const float beat = 60.0f / static_cast<float>(bpm);
    bellows::StereoDelay<500>::Params d;
    d.time_l = beat * 0.75f;  /* dotted eighth */
    d.time_r = beat * 0.5f;   /* eighth */
    d.feedback = 0.42f;
    d.cross_feedback = 0.18f;
    d.damping = 4200.0f;      /* repeats get darker, so they sit behind */
    d.mix = 1.0f;             /* a send carries the wet signal only */
    if (delay_ready_) {
      delay_.SetParams(d);
    } else {
      delay_.Init(sr_, d);
      delay_ready_ = true;
    }
  }

  /*
   * Draw a fresh arrangement from a seed.
   *
   * Init() gives the piece written into this file, and calling nothing
   * else keeps that: the size sketch and the parity work are unaffected.
   * This re-draws the things that make one piece different from another,
   * which is more than the notes. Tempo, mode, the four bar progression,
   * all five euclidean rhythms and the motif the Markov chain is trained
   * on all come from the seed, so two boots are two arrangements rather
   * than the same arrangement with different dice.
   *
   * The seed is the whole contract. The library's promise is that a seed
   * reproduces a piece, and that still holds here: keep the number and you
   * can play this arrangement again, which is why the sketch prints it.
   *
   * Every draw is bounded to stay musical rather than merely different. A
   * kick can be 3 to 6 pulses in 16 and not 1 to 15, the modes are all
   * minor coloured so a progression written in degrees means the same
   * thing in each, and bar 0 is always the tonic.
   */
  void Compose(uint32_t seed) {
    seed_ = seed;
    bellows::Rng r;
    r.Init(seed);

    /* Minor coloured modes only, so degrees keep their character. */
    static const bellows::ScaleType kModes[] = {
        bellows::kScaleMinor,          bellows::kScaleDorian,
        bellows::kScaleHarmonicMinor,  bellows::kScaleMinorPentatonic,
        bellows::kScalePhrygian,       bellows::kScaleKumoi,
    };
    scale_.Init(57, kModes[Draw(r, 6)]);
    const int len = scale_.Length();

    /* Bar 0 is the tonic. The rest come from degrees that resolve back to
     * it: the fourth, the fifth, the sixth and the third. */
    static const int kCandidates[] = {5, 3, 4, 2, 5, 4};
    prog_[0] = 0;
    for (int i = 1; i < kBars; ++i) prog_[i] = kCandidates[Draw(r, 6)] % (len > 1 ? len : 1);

    kick_pat_.Generate(3 + Draw(r, 4), kSteps);
    snare_pat_.Generate(2 + Draw(r, 3), kSteps, 4);
    hat_pat_.Generate(7 + Draw(r, 7), kSteps, Draw(r, 4));
    bass_pat_.Generate(3 + Draw(r, 3), kSteps);
    melody_pat_.Generate(7 + Draw(r, 5), kSteps, Draw(r, 4));

    /* A motif with stepwise bias, because a chain trained on leaps plays
     * leaps. Steps of -2 to +2 in scale degrees, folded into the
     * alphabet, which is what keeps it singable. */
    int d = Draw(r, 3);
    for (int i = 0; i < kMotifLen; ++i) {
      motif_[i] = static_cast<uint8_t>(d);
      d += Draw(r, 5) - 2;
      if (d < 0) d += kAlphabet;
      if (d >= kAlphabet) d -= kAlphabet;
    }
    chain_.Init(2);
    trained_ = chain_.Train(motif_, kMotifLen);
    chain_.Seed(motif_, 2);

    SetTempo(84 + static_cast<unsigned>(Draw(r, 5)) * 7);
  }

  /* The seed this arrangement came from, or 0 for the written one. */
  uint32_t Seed() const { return seed_; }

  /* Shift every pitched part by whole octaves.
   *
   * The drums are deliberately unaffected: they tune from a fixed noteOn
   * frequency rather than from a degree, so a kit stays a kit. This exists
   * for output paths that cannot reproduce the bottom of the piece.
   *
   * A piezo disc motivated it and then argued against it. The reasoning
   * was that a disc passes almost nothing at 100 Hz, so lifting the piece
   * into its band should help. Measured through the 15_Piezo chain it does
   * the opposite: 1.1 dB quieter at +1 octave and 2.2 dB at +2, because a
   * plucked string carries less energy and decays faster the higher it is
   * pitched, and that loses more than the disc's response gains. Gain into
   * the limiter was worth 12 dB where this was worth less than nothing.
   * Keep it for output paths where the arithmetic comes out differently,
   * and measure before assuming it is one of them. */
  void SetTranspose(int octaves) { transpose_ = octaves; }
  int Transpose() const { return transpose_; }

  /* True when the motif fitted the chain's table. False means transitions
   * were dropped and the melody is a smaller chain than the one written. */
  bool Trained() const { return trained_; }
  int Bar() const { return (step_ / kSteps) % kBars; }
  int Step16() const { return step_ % kSteps; }
  unsigned Bpm() const { return bpm_; }
  int Voices() const { return melody_.ActiveCount(); }

  /* Advance the sequencer one step and fire whatever the patterns say. */
  void Step() {
    const int s = step_ % kSteps;
    const int chord = prog_[Bar()];
    /* An octave, in degrees of whatever scale is loaded. */
    const int octave = scale_.Length();

    if (kick_pat_.At(s)) kick_.NoteOn(50.0f, 0.95f);
    if (snare_pat_.At(s)) snare_.NoteOn(190.0f, 0.7f + 0.2f * rng_seq_.Next());
    if (hat_pat_.At(s)) hat_.NoteOn(330.0f, 0.3f + 0.25f * rng_seq_.Next());

    /* Release before retriggering, so the bass is a line and not a drone.
     * The countdown runs every step, including the ones it fires on. */
    if (bass_gate_ > 0 && --bass_gate_ == 0) bass_.NoteOff();
    if (bass_pat_.At(s)) {
      /* The root, and its fifth about one note in six, which is enough
       * movement to imply the chord without stating it. */
      const int degree = chord - octave + (rng_seq_.Next() < 0.16f ? 4 : 0);
      bass_.NoteOn(DegreeHz(degree), 0.85f);
      bass_gate_ = 3;
    }

    if (melody_pat_.At(s)) {
      uint8_t sym = 0;
      if (chain_.Next(rng_seq_, &sym)) {
        const int degree = chord + static_cast<int>(sym) + octave;
        /* The note id is the degree, so a repeated note reuses its voice
         * rather than stealing a ringing one. Plucks are never released:
         * a string has no key to lift, and the pool frees a voice as soon
         * as it has decayed. */
        melody_.NoteOn(degree, DegreeHz(degree), 0.5f + 0.35f * rng_seq_.Next(), frame_);
      }
    }
    ++step_;
  }

  /* Render one block, split wherever a step falls so a hit lands on the
   * exact sample rather than on the block boundary, and again at kMaxBlock
   * so the send scratch is never overrun. */
  void operator()(float* l, float* r, int from, int to) {
    int i = from;
    while (i < to) {
      if (countdown_ <= 0) {
        Step();
        countdown_ = samples_per_step_;
      }
      int span = to - i;
      if (span > countdown_) span = countdown_;
      if (span > kMaxBlock) span = kMaxBlock;
      RenderSpan(l, r, i, span);
      i += span;
      countdown_ -= span;
      frame_ += static_cast<uint32_t>(span);
    }
  }

 private:
  /* rng.int(n) with the same truncation the JS uses. */
  static int Draw(bellows::Rng& r, int n) {
    int i = static_cast<int>(r.Next() * static_cast<float>(n));
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    return i;
  }

  float DegreeHz(int degree) const {
    return bellows::DegreeFreq(edo12_, 57, scale_.Intervals(), scale_.Length(),
                               degree + transpose_ * scale_.Length());
  }

  /*
   * The mixer, in full.
   *
   * Every part goes through Mix, which gives it a fader and a send knob,
   * because the drum engines have no level of their own: Kick::Params is
   * tune, decay and drive, and how loud it sits against a bass line is a
   * property of the arrangement rather than of the drum. Kick, hat and
   * bass send nothing, since a long echo on the low end is mud and a hat
   * through a dotted eighth just doubles the pattern.
   *
   * The bus then runs through the delay at mix 1, so what comes back is
   * the echo alone, and the sum goes through the EQ and the limiter.
   */
  void RenderSpan(float* l, float* r, int from, int n) {
    for (int i = 0; i < n; ++i) {
      send_l_[i] = 0.0f;
      send_r_[i] = 0.0f;
    }

    Mix(kick_, 0.55f, 0.0f, l, r, from, n);
    Mix(snare_, 0.33f, 0.14f, l, r, from, n);
    Mix(hat_, 0.2f, 0.0f, l, r, from, n);
    Mix(bass_, 0.4f, 0.0f, l, r, from, n);
    Mix(melody_, 0.36f, 0.26f, l, r, from, n);

    delay_.Process(send_l_, send_r_, 0, n);
    for (int i = 0; i < n; ++i) {
      l[from + i] += send_l_[i];
      r[from + i] += send_r_[i];
    }

    eq_.Process(l, r, from, from + n);
    limiter_.Process(l, r, from, from + n);
  }

  /* Render one part into the scratch, add it to the mix at `dry`, and add
   * it to the send bus at `send`.
   *
   * Rendering the part a second time into the bus is what this exists to
   * avoid: a voice advances its envelope when it renders, so the second
   * copy would be a different signal and would cost a second voice. */
  template <class Part>
  void Mix(Part& part, float dry, float send, float* l, float* r, int from, int n) {
    for (int i = 0; i < n; ++i) {
      dry_l_[i] = 0.0f;
      dry_r_[i] = 0.0f;
    }
    part.Process(dry_l_, dry_r_, 0, n);
    for (int i = 0; i < n; ++i) {
      l[from + i] += dry * dry_l_[i];
      r[from + i] += dry * dry_r_[i];
      send_l_[i] += send * dry_l_[i];
      send_r_[i] += send * dry_r_[i];
    }
  }

  bellows::Rng rng_seq_;
  bellows::Rng rng_melody_;
  bellows::Rng rng_bass_;
  bellows::Rng rng_snare_;

  bellows::Kick kick_;
  bellows::Snare snare_;
  bellows::Hat hat_;
  bellows::Va bass_;
  bellows::VoicePool<String, kVoices> melody_;

  bellows::StereoDelay<500> delay_;
  bellows::Eq3 eq_;
  bellows::Limiter<> limiter_;

  bellows::Scale scale_;
  bellows::Tuning12 edo12_;
  Chain chain_;

  bellows::Euclid<kSteps> kick_pat_;
  bellows::Euclid<kSteps> snare_pat_;
  bellows::Euclid<kSteps> hat_pat_;
  bellows::Euclid<kSteps> bass_pat_;
  bellows::Euclid<kSteps> melody_pat_;

  float send_l_[kMaxBlock] = {};
  float send_r_[kMaxBlock] = {};
  float dry_l_[kMaxBlock] = {};
  float dry_r_[kMaxBlock] = {};

  float sr_ = 48000.0f;
  unsigned bpm_ = 96;
  int samples_per_step_ = 1;
  int countdown_ = 0;
  int step_ = 0;
  int bass_gate_ = 0;
  int transpose_ = 0;
  uint32_t frame_ = 0;
  uint32_t seed_ = 0;
  int prog_[kBars] = {0, 0, 0, 0};
  uint8_t motif_[kMotifLen] = {};
  bool trained_ = false;
  bool delay_ready_ = false;
};

}  // namespace workstation
