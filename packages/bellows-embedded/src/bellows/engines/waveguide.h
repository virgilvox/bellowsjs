/* Transcription of src/engines/waveguide.ts, the StringVoice half.
 *
 * The TubeVoice half of the same file is already ported and stays where it
 * is, in engines/tube.h. This header is the bowed and plucked string, and
 * it is the largest single unit in the library.
 *
 * The class is named for the file rather than for the JS engine id
 * ('string'), because Arduino's WString.h defines a global class String and
 * a header that shadowed it would break every sketch that includes both.
 *
 * THE LOOP. A single loop stands in for a bidirectional waveguide:
 * fractional delay (cubic), a one pole damping filter, a dc blocker (the
 * bow injects dc that must not recirculate), and four first order allpasses
 * whose coefficient detunes upper partials for piano-like inharmonicity.
 * The read delay compensates the phase delay of every loop element at the
 * fundamental, so the sounding pitch stays right whatever the damping and
 * dispersion are set to. Plucked by default; with bow > 0 a friction curve
 * force drives the loop while the gate is held.
 *
 * On top of that, all of it inert until its own param is nonzero: a 24 mode
 * body resonator bank at the output tap, an STK friction curve whose slope
 * follows bow pressure, rosin noise and an attack bite injected on the bow
 * side of the junction, vibrato as delay length modulation, a bow hair
 * lowpass and a bow position comb on the injected force, per note attack
 * jitter and pitch settle from a second rng stream, and a second string
 * polarization a couple of cents sharp whose beat against the first is the
 * slow undulation of a real sustain. docs/BOWED-STRINGS.md carries the
 * measured evidence for every one of those and is worth reading before
 * changing any of it.
 *
 * KNOWN DEFECT, PORTED ON PURPOSE. The string runs flat on low notes:
 * measured in the TypeScript at -23.14 cents at 41.2 Hz, -17.30 at 55,
 * -11.36 at 82.4, -7.70 at 110, -4.34 at 165, -2.30 at 220 and +0.76 at
 * 440. The cause is that read_delay_ compensates the loop's phase delay at
 * f0 only, and the dc blocker's phase lead is far from flat down there.
 * This port reproduces it, because parity is the contract and a port that
 * quietly fixed it would fail. Do NOT weaken the dc blocker to chase it:
 * that was measured too, and at a 0.00002 coefficient 41.2 Hz comes good
 * (-0.87 cents) while 440 Hz goes 15.72 cents sharp, because the blocker's
 * lead was partly cancelling the error from the damping pole and the four
 * allpasses, which are compensated at f0 only as well. The real fix is a
 * tuning allpass with flat group delay across the harmonic band, replacing
 * the single-frequency compensation entirely, and it has to land in the
 * TypeScript first. See docs/HANDOFF.md.
 *
 * DEPARTURES FROM THE JS, and why.
 *
 * 1. THE 17 MODE FOREST IS BAKED INTO FLASH. The JS seeds it once at module
 *    load from rng('string-body-forest'), which is a fixed label and a
 *    deterministic generator, so the 51 numbers can never differ between
 *    two runs, two voices or two machines. Generating them in Init() would
 *    mean either 51 draws and 204 bytes of state per voice, or a function
 *    local static and a guard variable in a library that builds with
 *    -fno-threadsafe-statics. Baked, the table is 204 bytes of .rodata
 *    shared by every voice and Init() does no work at all for it. The
 *    literals below were produced by running the JS generator; the audio
 *    parity row has body on, so a transcription slip in them shows up
 *    there rather than hiding.
 *
 * 2. THE FRICTION CURVE IS NOT A TABLE AND IS NOT TABULATED HERE. The name
 *    "STK friction table" describes what it models, not how it is stored:
 *    in the JS it is a two line closed form, |dv + 0.001| * slope + 0.75
 *    raised to the -4 and clamped at 1. Tabulating it would add flash, add
 *    interpolation error to the one nonlinearity the whole engine turns on,
 *    and need retabulating whenever bow pressure moved the slope, since the
 *    slope is an argument and not a constant. It is evaluated directly.
 *    The -4 power is the one place this file does not route through fm::,
 *    and deliberately: the exponent is a small negative integer, so
 *    x2 = x * x followed by 1 / (x2 * x2) is not a transcendental at all
 *    and there is nothing for BELLOWS_FAST_MATH to switch. Two multiplies
 *    and a divide beat Exp2(Log2(x) * -4) on both counts. At
 *    BELLOWS_FAST_MATH=0 the two agree to a couple of ulp and the direct
 *    form is cheaper; at 1 the direct form is still a couple of ulp while
 *    fm::Pow carries its documented 1.4e-5 relative error, which would be
 *    injected into the friction curve once per sample for the whole of a
 *    bowed note.
 *
 * 3. NO EXCITATION BUFFER. The JS fills a Float32Array with one period of
 *    noise at NoteOn and reads it back one sample per frame. That is 9632
 *    bytes per voice at 48 kHz and a 20 Hz floor, a quarter of what the
 *    voice would cost with it. The draws are consecutive from one stream
 *    and consumed in order, so this copies the Rng (one uint32 of state) into a
 *    second generator, advances the main stream by the same number of
 *    draws, and evaluates the burst as it is consumed. Same numbers, same
 *    order, same stream position afterwards, no buffer. modal.h did the
 *    same thing to its strike pulse for the same reason.
 *
 * 4. VIBRATO PHASE IS A uint32 COUNTER, not a float accumulator. A float
 *    accumulator loses part of every increment as it approaches 1.0 and the
 *    loss is systematic, so the error grows with the length of the note
 *    instead of averaging out, while the JS accumulates in double where the
 *    same rounding is about 2^29 times smaller. Measured elsewhere in this
 *    library the same change moved chorus from 3.97e-2 to 2.02e-4, plate
 *    from 2.44e-3 to 1.34e-5 and formant from 7.85e-4 to 1.39e-5. See the
 *    note on PhaseIncrement in config.h. The increment is recomputed per
 *    sample because the rate ramp and the drift walk both modulate it,
 *    which costs one multiply and one cast over the float form.
 *
 * 5. NOTE AGE IS A SAMPLE COUNT, not a float sum. age_sec_ in the JS is
 *    ageSec += 1/sr every sample; in float that is 44100 roundings per
 *    second into a growing sum. An int counter times the step is one
 *    multiply, carries no accumulated error, and is what the vibrato onset
 *    ramp and the rate ramp read.
 *
 * 6. BODY STATE IS float, not Float64Array. The 24 biquads run transposed
 *    direct form II in single precision here. The highest Q in the tables is
 *    30 at 405 Hz, whose pole sits 3.9e-4 inside the unit circle, so single
 *    precision keeps about four decimal digits of headroom on the pole
 *    radius. Measured: putting body_z1_ and body_z2_ back in double leaves
 *    the parity row at 1.98e-4 / 2.56e-4, unchanged to three figures, so the
 *    bank is not where this engine's drift lives. It lives in the loop, and
 *    the length sweep says so: 4.75e-5 at 2048 frames, 8.85e-5 at 4096,
 *    1.21e-4 at 8192, 1.98e-4 at 16384, which is 4.2 times the error for
 *    8 times the note.
 *
 * SIZING. The delay lines are the RAM and the lowest note sets them, so the
 * class is templated on that floor the way Pluck and Tube are. Three lines:
 * the string loop (ceil(sr/f_min) + 8 samples, the eight being the slack the
 * JS carries so vibrato and the pitch settle can read past the nominal
 * length), the second polarization (the same again), and the bow position
 * comb, whose delay tops out at 2 * 0.45 periods (0.9 * sr/f_min + 9).
 * DelayLine adds four samples to each for the cubic kernel's reach, so at a
 * 20 Hz floor and 48 kHz that is (2412 + 2412 + 2173) * 4 = 27988 bytes of
 * line, and the whole voice measures:
 *
 *   f_min   sizeof, pol on   sizeof, pol off
 *   20 Hz   29000 B          19384 B
 *   41 Hz   14736 B          10040 B
 *   80 Hz    8120 B           5704 B
 *
 * The remainder over the lines is 576 bytes of body bank state (six float
 * arrays of 24) and about 430 of scalars, whatever the floor. 41 Hz is the
 * bottom string of a bass guitar and 80 Hz is a violin's G string with room
 * to spare, so a caller who is not playing the bottom octave of a piano
 * should not pay for it. The third template parameter drops the second
 * polarization (its line becomes DelayLine's 32 byte degenerate minimum),
 * which is the JS behaviour when the polDetune key is absent from the
 * construction params: 9616 bytes back at a 20 Hz floor.
 *
 * Code is 14160 bytes of flash for Waveguide<20, 48000> on Cortex-M7 at
 * -Os, measured by instantiating one and calling Init, NoteOn, Process,
 * Glide and NoteOff (./tools/check-header.sh reports the 16 byte floor
 * instead, because a template nobody instantiates is stripped before it can
 * be weighed).
 */
#pragma once
#include <math.h>
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/delayline.h"

namespace bellows {

inline constexpr int kStringBodyModes = 7;
inline constexpr int kStringForestModes = 17;
inline constexpr int kStringTotalModes = kStringBodyModes + kStringForestModes;
inline constexpr int kStringBodyAnchors = 4;
inline constexpr int kStringDispersionStages = 4;

/* Body resonator anchor tables. Frequencies in Hz, Q dimensionless, gain
 * linear against the strongest wood mode. body_size morphs piecewise
 * between adjacent instruments, frequencies geometrically and gains and Q
 * linearly. Anchors: violin 0.0, viola 0.18, cello 0.62, double bass 1.0.
 * Mode order per instrument: main air resonance, center bout rocking,
 * lower and upper main wood pair, mid wood band, bridge hill, upper bridge
 * hill. The modes never track the note, which is the main realism cue. */
inline constexpr float kStringAnchorS[kStringBodyAnchors] = {0.0f, 0.18f, 0.62f, 1.0f};

inline constexpr float kStringAnchorF[kStringBodyAnchors][kStringBodyModes] = {
    {275.0f, 405.0f, 465.0f, 550.0f, 1000.0f, 2300.0f, 3500.0f},
    {230.0f, 340.0f, 375.0f, 460.0f, 800.0f, 1700.0f, 2800.0f},
    {105.0f, 150.0f, 175.0f, 220.0f, 400.0f, 1600.0f, 2500.0f},
    {60.0f, 85.0f, 100.0f, 125.0f, 400.0f, 750.0f, 1400.0f},
};

inline constexpr float kStringAnchorQ[kStringBodyAnchors][kStringBodyModes] = {
    {25.0f, 30.0f, 25.0f, 25.0f, 4.0f, 2.5f, 3.0f},
    {25.0f, 25.0f, 22.0f, 22.0f, 3.0f, 2.5f, 3.0f},
    {20.0f, 25.0f, 20.0f, 20.0f, 4.0f, 2.5f, 3.0f},
    {15.0f, 20.0f, 15.0f, 15.0f, 3.0f, 2.0f, 2.5f},
};

inline constexpr float kStringAnchorG[kStringBodyAnchors][kStringBodyModes] = {
    {0.7f, 0.3f, 0.9f, 1.0f, 0.5f, 0.8f, 0.5f},
    {0.55f, 0.35f, 0.85f, 1.0f, 0.75f, 0.7f, 0.45f},
    {0.85f, 0.3f, 1.0f, 0.9f, 0.5f, 0.7f, 0.45f},
    {0.8f, 0.3f, 1.0f, 0.9f, 0.6f, 0.6f, 0.35f},
};

/* The forest: 17 extra modes on top of the seven anchors, pseudo log spaced
 * 800 Hz to 8 kHz with random offsets, Q 8 to 25, gains 0.15 to 0.4 with
 * alternating signs so neighbouring modes interfere and carve notches as
 * well as peaks. The JS draws these once at module load from
 * rng('string-body-forest'); baked here, see note 1 at the top. Nine
 * significant digits, which is past the point where the literal changes the
 * stored float. The forest frequencies follow body_size through the same
 * geometric interpolation as the anchors, referenced to the bridge hill. */
inline constexpr float kStringForestF[kStringForestModes] = {
    893.797992f,  819.650089f,  1065.59403f, 1103.42953f, 1571.74139f, 1777.45496f,
    1740.86986f,  2360.36675f,  2361.55759f, 2598.07334f, 3769.57911f, 3654.64521f,
    4241.43812f,  5036.90532f,  6356.37672f, 7513.68671f, 8440.46492f,
};

inline constexpr float kStringForestQ[kStringForestModes] = {
    16.0636552f, 24.9933025f, 20.8635211f, 13.8087731f, 14.3847162f, 8.52454061f,
    24.0868496f, 15.9606378f, 17.7519802f, 12.2063043f, 18.1899027f, 12.9337151f,
    16.4184380f, 16.9082207f, 10.5958267f, 12.1692279f, 10.3246911f,
};

inline constexpr float kStringForestG[kStringForestModes] = {
    0.366847425f,  -0.308274551f, 0.373796395f,  -0.341595155f, 0.333479250f,
    -0.268428125f, 0.202886703f,  -0.328975820f, 0.206798770f,  -0.320772967f,
    0.300053678f,  -0.269051920f, 0.206893103f,  -0.180868059f, 0.296160772f,
    -0.333322826f, 0.231563391f,
};

/*
 * kMinFreqHz is the lowest note the loop must hold, kSampleRate the rate the
 * buffers are sized for, and kSecondPolarization whether the detuned second
 * string loop exists at all. The JS decides that last one by whether the
 * polDetune key was present in the construction params, which is a runtime
 * test over a record; here it is the template argument, because the only
 * thing it actually controls is whether a delay line is allocated.
 */
template <int kMinFreqHz = 20, int kSampleRate = BELLOWS_SAMPLE_RATE,
          bool kSecondPolarization = true>
class Waveguide {
 public:
  /* One period of the lowest note, plus the eight samples of slack the JS
   * carries so vibrato and the pitch settle can read past the nominal
   * length. */
  static constexpr uint32_t kMaxSamples =
      (kSampleRate + kMinFreqHz - 1) / kMinFreqHz + 8;
  /* The bow position comb reads at most 2 * 0.45 = 0.9 periods back. */
  static constexpr uint32_t kCombSamples = (9 * kSampleRate) / (10 * kMinFreqHz) + 9;
  /* DelayLine asks for at least four samples, so the disabled polarization
   * costs 8 floats rather than nothing. */
  static constexpr uint32_t kPolSamples = kSecondPolarization ? kMaxSamples : 4u;

  /* Same bound Pluck carries and for the same reason: below kSampleRate / 8
   * the playable range is empty at the design rate even where the
   * arithmetic stays finite, and a zero-length period reaches the delay
   * line as a read position rather than as an error. */
  static_assert(kMinFreqHz > 0 && kSampleRate > 0,
                "Waveguide kMinFreqHz and kSampleRate must both be positive");
  static_assert(kSampleRate / kMinFreqHz >= 8,
                "Waveguide kMinFreqHz must be at most kSampleRate / 8");

  struct Params {
    float damp = 0.35f;
    float sustain = 0.6f;
    float dispersion = 0.0f;
    float bow = 0.0f;
    float bow_pressure = 0.5f;
    float bow_speed = 0.5f;
    float level = 0.9f;
    /* Bowed realism. All default to neutral, so a params record that sets
     * none of them sounds like the plain plucked loop. */
    float body = 0.0f;
    float body_size = 0.0f;
    float bow_noise = 0.0f;
    float attack_bite = 0.0f;
    float vib_rate = 6.1f;   /* Hz */
    float vib_depth = 0.0f;  /* cents */
    float vib_onset = 0.3f;  /* s */
    float bow_pos = 0.11f;
    float dynamics = 0.0f;
    float pol_detune = 0.0f; /* cents */
    /* Legato. */
    float glide = 0.03f; /* s */
    float legato_scratch = 0.15f;
  };

  void Init(float sample_rate, Rng* rng, Rng* note_rng) {
    Params d;
    Init(sample_rate, rng, note_rng, d);
  }

  /*
   * note_rng is the JS rng.fork('note') stream: per note jitter and pitch
   * settle draw from it so consuming them never shifts the main stream a
   * pluck render depends on. Fork is string concatenation, so the label is
   * the parent's plus "::note" (see core/prng.h). Passing the same stream
   * twice is legal and simply means those draws come out of the main
   * stream, which is not what the browser does.
   */
  void Init(float sample_rate, Rng* rng, Rng* note_rng, const Params& p) {
    /* A rate that is not finite and positive turns every coefficient below
     * into NaN and puts NaN on the mix bus for the rest of the session. Fall
     * back to the rate this instance was sized for, which is the only rate
     * it is known to be consistent at. */
    sr_ = SafeRate(sample_rate, static_cast<float>(kSampleRate));
    rng_ = rng;
    note_rng_ = note_rng ? note_rng : rng;
    p_ = p;
    delay_.Init();
    force_delay_.Init();
    pol_delay_.Init();
    body_dirty_ = true;
    track_coef_ = fm::Exp(-1.0f / (kTrackTau * sr_));
    /* Gentle dc blocker: the pole hugs the zero so its phase delay at and
     * above the fundamental stays small and nearly flat, keeping the loop
     * close to harmonic. It only has to bleed off the dc the bow injects,
     * which builds up slowly. The low note error at the top of this file is
     * what is left of "nearly". */
    dc_r_ = Clamp(1.0f - (0.0005f * 44100.0f) / sr_, 0.99f, 0.999995f);
    /* 20 ms bow velocity ramp in at NoteOn, 10 ms ramp out at NoteOff. */
    bow_up_step_ = 1.0f / (0.02f * sr_);
    bow_down_step_ = 1.0f / (0.01f * sr_);
    /* 30 ms one shot attack bite envelope. */
    bite_coef_ = fm::Exp(-1.0f / (0.03f * sr_));
    /* One pole lowpass near 6 kHz shapes the rosin noise band. */
    noise_a_ = 1.0f - fm::Exp((-kTwoPi * Min(6000.0f, sr_ * 0.45f)) / sr_);
    /* Bow hair compliance lowpass on the injected force. */
    bow_lp_a_ = 1.0f - fm::Exp((-kTwoPi * Min(kBowHairFc, sr_ * 0.45f)) / sr_);
    /* Attack jitter walk: white through a 30 to 80 Hz one pole band,
     * normalized to roughly unit standard deviation. */
    jit_af_ = 1.0f - fm::Exp((-kTwoPi * kJitterHi) / sr_);
    jit_as_ = 1.0f - fm::Exp((-kTwoPi * kJitterLo) / sr_);
    float band_var =
        (1.0f / 3.0f) * (jit_af_ / (2.0f - jit_af_) - jit_as_ / (2.0f - jit_as_));
    jit_norm_ = band_var > 0.0f ? 1.0f / fm::Sqrt(band_var) : 0.0f;
    settle_coef_ = fm::Exp(-1.0f / (kSettleTau * sr_));
    age_step_ = 1.0f / sr_;
    /* Vibrato drift: white through a one pole near 0.5 Hz wobbles rate and
     * depth so the LFO does not read as synthetic. The scale normalizes the
     * filtered noise to roughly unit swing. */
    drift_a_ = 1.0f - fm::Exp((-kTwoPi * 0.5f) / sr_);
    drift_scale_ = fm::Sqrt((2.0f - drift_a_) / drift_a_) * fm::Sqrt(3.0f);
  }

  /*
   * The JS handles params one name at a time and recomputes only what that
   * name touches. A struct does not say which field moved, so this
   * recomputes both, which is what the JS does for the union of its cases
   * anyway. It is a control rate call: the loop update is a handful of
   * transcendentals and the body bank is deferred to the next Process.
   */
  void SetParams(const Params& p) {
    p_ = p;
    body_dirty_ = true;
    if (live_) UpdateLoop();
  }

  /*
   * The lowest note this instance can actually hold, which is kMinFreqHz
   * only when Init() got the rate the class was sized for. kMaxSamples - 8
   * is the period of the lowest note at the design rate, so dividing the
   * runtime rate by it gives kMinFreqHz back when the two agree. Public for
   * the reason Pluck::MinFreq() is: a caller running at a rate the template
   * did not choose has no other way to learn its real bottom note.
   */
  float MinFreq() const {
    float cap = sr_ / static_cast<float>(kMaxSamples - 8);
    float lo = static_cast<float>(kMinFreqHz);
    return cap > lo ? cap : lo;
  }

  /* The pitch the voice settled on after NoteOn clamped it. */
  float Freq() const { return freq_; }

  void NoteOn(float freq, float vel) {
    freq_ = Clamp(freq, MinFreq(), sr_ / 10.0f);
    vel_ = Clamp(vel, 0.0f, 1.0f);
    gate_ = true;
    live_ = true;
    delay_.Clear();
    lp_state_ = 0.0f;
    dc_x1_ = 0.0f;
    dc_y1_ = 0.0f;
    for (int s = 0; s < kStringDispersionStages; ++s) {
      ap_x1_[s] = 0.0f;
      ap_y1_[s] = 0.0f;
    }
    bow_env_ = 0.0f;
    bite_env_ = 1.0f;
    noise_lp_ = 0.0f;
    bow_lp_ = 0.0f;
    force_delay_.Clear();
    vib_phase_ = 0u;
    drift_state_ = 0.0f;
    age_n_ = 0;
    /* A fresh note owns its pitch: cancel any legato glide in flight. */
    glide_left_ = 0;
    scratch_env_ = 0.0f;
    for (int k = 0; k < kStringTotalModes; ++k) {
      body_z1_[k] = 0.0f;
      body_z2_[k] = 0.0f;
    }
    if (kSecondPolarization) {
      pol_delay_.Clear();
      pol_lp_ = 0.0f;
      pol_dc_x1_ = 0.0f;
      pol_dc_y1_ = 0.0f;
    }
    /* Per note life draws, in a fixed order so the note stream stays
     * aligned whatever the params: jitter scale (0.6 to 1.4), jitter decay
     * (30 to 50 ms, so the walk audibly rides the first 90 to 150 ms),
     * settle magnitude (8 to 15 cents) and its sign (mostly sharp,
     * occasionally flat). */
    jit_scale_ = 0.6f + 0.8f * note_rng_->Next();
    jit_coef_ = fm::Exp(-1.0f / ((0.03f + 0.02f * note_rng_->Next()) * sr_));
    float settle_mag = 8.0f + 7.0f * note_rng_->Next();
    settle_cents_ = note_rng_->Next() < 0.25f ? -settle_mag : settle_mag;
    jit_env_ = 1.0f;
    jit_lp_f_ = 0.0f;
    jit_lp_s_ = 0.0f;
    settle_env_ = 1.0f;
    UpdateLoop();

    /* Noise burst excitation, one period. A bowed note still gets a small
     * seed so the friction loop starts from motion, not silence. The draws
     * are taken from a copy of the stream and the main stream is advanced
     * past them, so the burst is evaluated as it is consumed instead of
     * being buffered: see note 3 at the top. */
    float n = sr_ / freq_;
    int len = static_cast<int>(n + 0.5f);
    if (len < 2) len = 2;
    excite_amp_ = 0.55f * vel_ * (1.0f - 0.8f * Clamp(p_.bow, 0.0f, 1.0f));
    excite_rng_ = *rng_;
    for (int i = 0; i < len; ++i) rng_->NextU32();
    excite_len_ = len;
    excite_pos_ = 0;
    tracker_ = vel_ * 0.5f > 0.01f ? vel_ * 0.5f : 0.01f;
  }

  void NoteOff() {
    gate_ = false;
    UpdateLoop();
  }

  /*
   * True legato. Retargets the sounding fundamental: the glide runs at
   * block rate in Process and nothing about the attack (bite, settle, bow
   * ramp, excitation) retriggers, so a phrase slurs instead of restarting.
   * Ignored on an inactive voice, which has no note to bend. The JS reaches
   * this through setParam('freq', hz); a named method is clearer and costs
   * no string compare.
   */
  void Glide(float target_hz) {
    if (!live_) return;
    float target = Clamp(target_hz, MinFreq(), sr_ / 10.0f);
    float semis = 12.0f * fm::Log2(target / freq_);
    if (semis < 0.0f) semis = -semis;
    scratch_level_ =
        (semis < kLegatoScratchSemis ? semis : kLegatoScratchSemis) / kLegatoScratchSemis;
    scratch_env_ = 1.0f;
    int dur = static_cast<int>(Clamp(p_.glide, 0.0f, kGlideMaxSec) * sr_ + 0.5f);
    if (dur < 1) {
      glide_left_ = 0;
      freq_ = target;
      UpdateLoop();
    } else {
      glide_from_ = freq_;
      glide_to_ = target;
      glide_dur_ = static_cast<float>(dur);
      glide_left_ = dur;
    }
  }

  void Process(float* l, float* r, int from, int to) {
    if (!live_) return;
    if (body_dirty_) {
      ComputeBody();
      body_dirty_ = false;
    }
    if (glide_left_ > 0) {
      /* Legato retune at block rate: equal cents per second between
       * glide_from_ and glide_to_. Recomputing the loop compensation per
       * block (a few ms) is inaudible and keeps the loop allocation free. */
      glide_left_ -= to - from;
      if (glide_left_ <= 0) {
        glide_left_ = 0;
        freq_ = glide_to_;
      } else {
        float t = 1.0f - static_cast<float>(glide_left_) / glide_dur_;
        freq_ = glide_from_ * fm::Pow(glide_to_ / glide_from_, t);
      }
      UpdateLoop();
    }
    const float level = p_.level;
    const float bow_amt = Clamp(p_.bow, 0.0f, 1.0f);
    /* Dynamics coupling: velocity swings bow speed across 0.35 to 0.8 and
     * nudges pressure, so loud notes are brighter, not just louder. */
    const float dyn = Clamp(p_.dynamics, 0.0f, 1.0f);
    const float speed_eff =
        Clamp(p_.bow_speed, 0.0f, 1.0f) * (1.0f - dyn) + (0.35f + 0.45f * vel_) * dyn;
    const float bow_vel = 0.05f + 0.25f * Clamp(speed_eff, 0.0f, 1.0f);
    const float pressure =
        Clamp(Clamp(p_.bow_pressure, 0.0f, 1.0f) + dyn * 0.15f * (vel_ - 0.5f), 0.0f, 1.0f);
    /* STK pressure to friction slope mapping: firm bow, low slope. */
    const float slope = 5.0f - 4.0f * pressure;
    const float bite = Clamp(p_.attack_bite, 0.0f, 1.0f);
    /* Bow position comb: the injected force cancels itself one round trip
     * to the near bridge later (2 * bow_pos periods). */
    const float comb_delay = 2.0f * Clamp(p_.bow_pos, 0.02f, 0.45f) * period_n_;
    const bool use_pol = kSecondPolarization && p_.pol_detune > 0.0f;
    /* Rosin noise level: proportional to bow speed, relatively more
     * prominent under a light bow. */
    const float n_sus_amt =
        Clamp(p_.bow_noise, 0.0f, 1.0f) * bow_vel * (0.05f + 0.1f * (1.0f - pressure));
    /* Break-away burst level, gated by the 30 ms bite envelope. */
    const float n_att_amt = bite * bow_vel * (0.5f + pressure) * 0.3f;
    /* Legato transition cue level, gated by the one shot scratch env. */
    const float n_scr_amt = Clamp(p_.legato_scratch, 0.0f, 1.0f) * scratch_level_ * bow_vel *
                            kLegatoScratchGain;
    const float body_mix = Clamp(p_.body, 0.0f, 1.0f);
    const bool use_body = body_mix > 0.0f;
    const float depth_cents = Clamp(p_.vib_depth, 0.0f, 50.0f);
    const bool use_vib = depth_cents > 0.0f;
    const float vib_cycles = Clamp(p_.vib_rate, 0.0f, 20.0f) / sr_;
    const float onset_t = p_.vib_onset > 0.0f ? p_.vib_onset : 0.0f;
    const float c = ap_c_;
    for (int i = from; i < to; ++i) {
      /* One white sample per frame feeds both the rosin noise lowpass and
       * the vibrato drift walk, so renders that differ only in the new
       * params share the same underlying noise. Drawn unconditionally, the
       * way the JS draws it: moving it inside a branch would shift the
       * stream for every param setting that skips the branch. */
      const float white = rng_->Bipolar();
      float delta = 0.0f;
      if (use_vib) {
        /* Note age from the sample count, see note 5 at the top. */
        const float age = static_cast<float>(age_n_) * age_step_;
        drift_state_ += drift_a_ * (white - drift_state_);
        const float drift = Clamp(drift_state_ * drift_scale_, -1.0f, 1.0f);
        /* The rate ramps from 0.9x to 1.05x over the first second: a
         * player's vibrato widens into the note. */
        const float rate_ramp = 0.9f + 0.15f * (age < 1.0f ? age : 1.0f);
        vib_phase_ += PhaseIncrement(vib_cycles * rate_ramp * (1.0f + 0.08f * drift));
        /* Raised cosine onset ramp: no vibrato inside the attack. */
        const float tt = age - onset_t;
        const float onset = tt <= 0.0f ? 0.0f
                            : tt >= kVibRampSec
                                ? 1.0f
                                : 0.5f * (1.0f - fm::Cos((kPi * tt) / kVibRampSec));
        const float d = depth_cents * (1.0f + 0.2f * drift) * onset;
        /* kVibAsym shifts the modulation center below the note: the
         * positive delay offset reads the loop long, so the mean pitch dips
         * under nominal by 0.3 of the depth. */
        const float ph = static_cast<float>(vib_phase_) * kPhaseToUnit;
        delta = read_delay_ * d * kCentsToRatio * (fm::Sin(kTwoPi * ph) + kVibAsym);
      }
      if (bow_amt > 0.0f && settle_env_ > 1e-4f) {
        /* Pitch settle: the note starts settle_cents_ off (usually sharp)
         * and locks exponentially over about 120 ms. */
        settle_env_ *= settle_coef_;
        delta -= read_delay_ * settle_cents_ * kCentsToRatio * settle_env_;
      }
      const float y = delay_.ReadCubic(read_delay_ + delta);
      /* Loop damping. */
      lp_state_ = lp_a_ * y + lp_b_ * lp_state_;
      /* dc blocker. */
      float f = lp_state_ - dc_x1_ + dc_r_ * dc_y1_;
      dc_x1_ = lp_state_;
      dc_y1_ = f;
      /* Dispersion allpasses. */
      for (int s = 0; s < kStringDispersionStages; ++s) {
        const float yy = c * f + ap_x1_[s] - c * ap_y1_[s];
        ap_x1_[s] = f;
        ap_y1_[s] = yy;
        f = yy;
      }
      float s_in = f * gs_;
      float ex = 0.0f;
      if (excite_pos_ < excite_len_) {
        ex = excite_rng_.Bipolar() * excite_amp_;
        ++excite_pos_;
        s_in += ex;
      }
      float inj = 0.0f;
      if (bow_amt > 0.0f) {
        if (gate_) {
          bow_env_ += bow_up_step_;
          if (bow_env_ > 1.0f) bow_env_ = 1.0f;
        } else {
          bow_env_ -= bow_down_step_;
          if (bow_env_ < 0.0f) bow_env_ = 0.0f;
        }
        if (bow_env_ > 0.0f) {
          noise_lp_ += noise_a_ * (white - noise_lp_);
          bite_env_ *= bite_coef_;
          /* Raised sticking at onset: the bite envelope lowers the slope so
           * the string breaks away late and scratches before locking into
           * Helmholtz motion. */
          const float slope_eff = slope * (1.0f - 0.35f * bite * bite_env_);
          float noise_sus = n_sus_amt * noise_lp_;
          /* Legato scratch rides the sustain rosin path for its first
           * 30 ms. The branch keeps a never-glided render bit identical to
           * the pre-legato engine. */
          if (scratch_env_ > 1e-4f) {
            scratch_env_ *= bite_coef_;
            noise_sus += n_scr_amt * scratch_env_ * noise_lp_;
          }
          const float noise_att = n_att_amt * bite_env_ * noise_lp_;
          const float noise = noise_sus + noise_att;
          /* Pre-Helmholtz jitter: the 30 to 80 Hz walk (fed by the same
           * white sample) wobbles the bow velocity through the attack,
           * scaled by attack_bite and the per note draw. */
          jit_env_ *= jit_coef_;
          jit_lp_f_ += jit_af_ * (white - jit_lp_f_);
          jit_lp_s_ += jit_as_ * (white - jit_lp_s_);
          const float walk = Clamp((jit_lp_f_ - jit_lp_s_) * jit_norm_, -1.5f, 1.5f);
          const float jit = 1.0f + kJitterAmt * bite * jit_scale_ * jit_env_ * walk;
          const float bow_vel_inst = bow_vel * bow_env_ * jit + noise;
          const float dv = bow_vel_inst - y;
          const float t = BowTable(dv, slope_eff);
          /* Friction force is mu(dv) times the normal force: pressure
           * scales the transmissible force as well as the table slope, so a
           * feather bow genuinely starves the string. */
          const float n_force = kBowNForceLo + kBowNForceSpan * pressure;
          /* tanh bounds only the injected term, not the recirculating wave,
           * as a cheap torsional loss surrogate. */
          const float force = fm::Tanh(dv * t * n_force * kBowJunctionGain) * bow_amt;
          /* Bow hair compliance: lowpass the injected friction force only,
           * never the recirculating wave. The junction noise share keeps
           * its own 6 kHz band (rosin hiss and attack scratch live above
           * the hair rolloff). */
          bow_lp_ += bow_lp_a_ * (force - bow_lp_);
          /* Bow position comb: the near bridge reflection of the injected
           * force returns inverted one bridge round trip (2 * bow_pos
           * periods) later and cancels the harmonics near 1 / bow_pos.
           * Normalized by 1 / (1 + depth) so the comb only carves nulls and
           * never boosts the in-phase bands (an unnormalized comb doubles
           * the mid harmonics, which feeds the raucous low pressure regime
           * and destabilizes the period); kCombMakeup restores the
           * injection level. The junction noise share skips the comb: it is
           * broadband, and combing it would only dull the rosin floor and
           * the bite. The second term is the force-side share of that
           * noise, gated by the table value so it pulses with the slip
           * cycle instead of overlaying the output as plain hiss. */
          inj = (bow_lp_ - kCombDepth * force_delay_.ReadCubic(comb_delay)) * kCombNorm +
                (noise_sus * kNoiseForceGain + noise_att * kBiteForceGain) * t * bow_env_ *
                    bow_amt;
          force_delay_.Write(bow_lp_);
          s_in += inj;
        }
      }
      delay_.Write(s_in);
      float o = s_in;
      if (use_pol) {
        /* Second polarization: a plain damped loop a hair sharp, kicked by
         * the same excitation burst as the main loop and fed a sliver of
         * the bow force, mixed about 6 dB down. The friction locks the main
         * loop to one period; this loop is not under the bow's servo, so
         * the burst keeps ringing at its own detuned frequency, and the
         * beat against the locked tone is the slow sustain undulation of a
         * real string. */
        const float y2 = pol_delay_.ReadCubic(pol_read_);
        pol_lp_ = pol_lp_a_ * y2 + pol_lp_b_ * pol_lp_;
        const float f2 = pol_lp_ - pol_dc_x1_ + dc_r_ * pol_dc_y1_;
        pol_dc_x1_ = pol_lp_;
        pol_dc_y1_ = f2;
        const float s2 =
            f2 * gs_ + (kPolCouple + kPolAtt * settle_env_) * inj + kPolKick * ex;
        pol_delay_.Write(s2);
        o += kPolMix * s2;
      }
      if (use_body) {
        const float x = o;
        float wet = 0.0f;
        for (int k = 0; k < kStringTotalModes; ++k) {
          const float yk = body_b0_[k] * x + body_z1_[k];
          body_z1_[k] = body_z2_[k] - body_a1_[k] * yk;
          body_z2_[k] = -body_b0_[k] * x - body_a2_[k] * yk;
          wet += body_gain_[k] * yk;
        }
        o = (1.0f - body_mix) * x + body_mix * (kBodyDry * x + kBodyMakeup * wet);
      }
      o *= level;
      l[i] += o;
      r[i] += o;
      /* The cap is a signed overflow guard, not a behaviour: 2^30 samples is
       * 6.8 hours at 44.1 kHz, by which point both consumers of the age (the
       * 1 second rate ramp and the vibrato onset) have long saturated. A
       * plain ++ is undefined at INT_MAX and a held drone would reach it. */
      if (age_n_ < kAgeMax) ++age_n_;
      const float as = s_in < 0.0f ? -s_in : s_in;
      tracker_ = as > tracker_ ? as : tracker_ * track_coef_;
    }
    if (!gate_ && tracker_ < kSilence && excite_pos_ >= excite_len_) live_ = false;
  }

  bool Active() const { return live_; }

 private:
  static constexpr float kReleaseT60 = 0.25f;
  static constexpr float kTrackTau = 0.05f;
  static constexpr float kSilence = 1e-4f;

  /* Dry bleed inside the wet path (prevents the hollow talking-through-a-
   * tube artifact) and makeup gain on the resonator sum. */
  static constexpr float kBodyDry = 0.35f;
  static constexpr float kBodyMakeup = 0.8f;
  static constexpr float kBowJunctionGain = 1.1f;
  /* Source spectrum shaping, iterated against the tilt gate in the JS
   * waveguide.test.ts (body off, A4, pressure 0.55, speed 0.6: h8 at or
   * below -12 dB, h12 at or below -16 dB relative to h1, no harmonic above
   * h1). The bow hair lowpass models hair compliance on the injected force
   * only; the comb models the reflection from the bridge side of the bow
   * contact point; the loop cutoff cap while bowed stands in for the
   * heavier internal damping a bowed string shows against a plucked one. */
  static constexpr float kBowHairFc = 3500.0f;
  static constexpr float kCombDepth = 0.9f;
  static constexpr float kCombMakeup = 1.3f;
  static constexpr float kCombNorm = (1.0f / (1.0f + kCombDepth)) * kCombMakeup;
  static constexpr float kBowLoopFcCap = 4200.0f;
  /* Normal force scaling of the friction force (mu times N): the table is
   * mu(dv), pressure is N. Without it a feather bow rides the comb's
   * inter-null bands and comes out as loud as a firm one. */
  static constexpr float kBowNForceLo = 0.3f;
  static constexpr float kBowNForceSpan = 1.4f;
  /* Attack life: pitch settle time constant and the bow velocity jitter
   * walk band, scaled per note from the note rng stream. */
  static constexpr float kSettleTau = 0.12f;
  static constexpr float kJitterAmt = 0.5f;
  static constexpr float kJitterLo = 30.0f;
  static constexpr float kJitterHi = 80.0f;
  /* Vibrato center sits this fraction of the depth below nominal: real
   * vibrato dips under the note. */
  static constexpr float kVibAsym = 0.3f;
  static constexpr float kVibRampSec = 0.3f;
  static constexpr float kCentsToRatio = 5.78e-4f;
  /* Dual polarization: coupling from the main loop bow force into the
   * detuned second loop, the excitation kick share, and its output mix
   * (about 6 dB down). The second loop keeps its own gentle lowpass: the
   * bow only damps the polarization it touches, and a heavier filter would
   * kill the free ring (and with it the beat) within a second. The pol loop
   * is linear, so whatever the bow force drives directly stays phase locked
   * to the main loop and cannot beat; the beat comes from stored energy
   * recirculating at the pol loop's own detuned period, which is what
   * kPolAtt and kPolKick are for. */
  static constexpr float kPolCouple = 0.12f;
  static constexpr float kPolMix = 0.5f;
  static constexpr float kPolKick = 2.0f;
  static constexpr float kPolAtt = 2.0f;
  static constexpr float kPolLpFc = 16000.0f;
  /* Force-side coupling for the junction noise. The velocity-side
   * perturbation alone is almost entirely cancelled by the stick phase,
   * which servos the string back to the bow velocity within a sample or
   * two, so the audible rosin floor comes from the same noise leaking
   * through the friction contact as force, gated by the stick state. The
   * bite share carries a larger gain because the bow hair lowpass and the
   * comb normalization smooth the tonal scratch it used to rely on, so the
   * break-away burst has to supply the attack's high band itself. */
  static constexpr float kNoiseForceGain = 3.0f;
  static constexpr float kBiteForceGain = 20.0f;
  /* Legato transition cue: extra rosin noise during the first 30 ms of a
   * glide, scaled by legato_scratch and by the interval in semitones. */
  static constexpr float kLegatoScratchGain = 0.2f;
  static constexpr float kLegatoScratchSemis = 5.0f;
  static constexpr float kGlideMaxSec = 0.5f;
  /* Sample count ceiling for the note age. See the note at the increment. */
  static constexpr int32_t kAgeMax = 1 << 30;

  static float Min(float a, float b) { return a < b ? a : b; }

  /*
   * Bow friction curve after the STK bowed string: near 1 (stick) for a
   * small velocity difference, falling fast past break-away (slip). The
   * slope comes from bow pressure (5 - 4 * pressure): a firmer bow gets a
   * lower slope, so a wider stick plateau and a higher break-away velocity.
   * The 0.001 offset inside the abs breaks left/right symmetry (bow
   * direction dependence) and is the dc source the loop's dc blocker bleeds
   * off. See note 2 at the top for why the -4 power is three multiplies and
   * a divide rather than fm::Pow.
   */
  static float BowTable(float dv, float slope) {
    float a = dv + 0.001f;
    if (a < 0.0f) a = -a;
    const float x = a * slope + 0.75f;
    const float x2 = x * x;
    const float t = 1.0f / (x2 * x2);
    return t > 1.0f ? 1.0f : t;
  }

  /* Phase delay in samples of y[n] = a x[n] + (1-a) y[n-1] at w. */
  static float OnePolePhaseDelay(float a, float w) {
    const float b = 1.0f - a;
    return fm::Atan2(b * fm::Sin(w), 1.0f - b * fm::Cos(w)) / w;
  }

  /* Phase delay in samples of the allpass (c + z^-1) / (1 + c z^-1) at w. */
  static float AllpassPhaseDelay(float c, float w) {
    const float s = fm::Sin(w);
    const float co = fm::Cos(w);
    const float angle = fm::Atan2(-s, c + co) - fm::Atan2(-c * s, 1.0f + c * co);
    return -angle / w;
  }

  /* Phase delay in samples of the dc blocker (1 - z^-1) / (1 - r z^-1) at
   * w. Negative: it is a phase lead, and compensating it at f0 alone is the
   * defect documented at the top. */
  static float DcBlockerPhaseDelay(float r, float w) {
    const float s = fm::Sin(w);
    const float co = fm::Cos(w);
    const float angle = fm::Atan2(s, 1.0f - co) - fm::Atan2(r * s, 1.0f - r * co);
    return -angle / w;
  }

  float LoopPhaseDelay(float a, float w) const {
    return OnePolePhaseDelay(a, w) + DcBlockerPhaseDelay(dc_r_, w) +
           kStringDispersionStages * AllpassPhaseDelay(ap_c_, w);
  }

  void UpdateLoop() {
    const float n = sr_ / freq_;
    period_n_ = n;
    const float w = (kTwoPi * freq_) / sr_;
    float fc = Min(15000.0f * fm::Pow(1200.0f / 15000.0f, Clamp(p_.damp, 0.0f, 1.0f)),
                   sr_ * 0.45f);
    /* A bowed string loses more to internal friction than a plucked one,
     * and the source spectrum gate needs the loop itself to tilt: cap the
     * loop cutoff while bowed. The phase compensation below absorbs the
     * cap, so pitch is unaffected. */
    if (p_.bow > 0.0f) fc = Min(fc, kBowLoopFcCap);
    const float a = 1.0f - fm::Exp((-kTwoPi * fc) / sr_);
    lp_a_ = a;
    lp_b_ = 1.0f - a;
    /* Dispersion allpasses need their pole near z = 1 (negative c) so the
     * phase delay actually varies across the partials; a pole far from the
     * circle is flat there and detunes nothing. The chain's bulk delay is
     * compensated at the fundamental, so if it would eat the whole loop on
     * a high note, the coefficient is relaxed until enough delay is left. */
    ap_c_ = -0.9f * fm::Pow(Clamp(p_.dispersion, 0.0f, 1.0f), 0.3f);
    float pd = LoopPhaseDelay(a, w);
    while (n - 1.0f - pd < 4.0f && ap_c_ < -1e-3f) {
      ap_c_ *= 0.7f;
      pd = LoopPhaseDelay(a, w);
    }
    read_delay_ = n - 1.0f - pd;
    if (read_delay_ < 1.0f) read_delay_ = 1.0f;
    if (kSecondPolarization) {
      /* Second polarization: one pole damping and dc blocker, no dispersion
       * chain, detuned sharp by pol_detune cents. */
      const float a2 = 1.0f - fm::Exp((-kTwoPi * Min(kPolLpFc, sr_ * 0.45f)) / sr_);
      pol_lp_a_ = a2;
      pol_lp_b_ = 1.0f - a2;
      const float pd2 = OnePolePhaseDelay(a2, w) + DcBlockerPhaseDelay(dc_r_, w);
      const float det = fm::CentsRatio(Clamp(p_.pol_detune, 0.0f, 50.0f));
      pol_read_ = n / det - 1.0f - pd2;
      if (pol_read_ < 1.0f) pol_read_ = 1.0f;
    }
    const float t60 =
        gate_ ? 0.3f * fm::Pow(40.0f, Clamp(p_.sustain, 0.0f, 1.0f)) : kReleaseT60;
    /* Loop loss is met once per period, so the per pass gain is set against
     * the period count in t60 seconds. */
    gs_ = fm::Pow(10.0f, -3.0f / (t60 * freq_));
  }

  /* Morph the body mode table at the current body_size and derive RBJ
   * constant peak bandpass coefficients. Block rate only. */
  void ComputeBody() {
    const float s = Clamp(p_.body_size, 0.0f, 1.0f);
    int hi = 1;
    while (hi < kStringBodyAnchors - 1 && s > kStringAnchorS[hi]) ++hi;
    const int lo = hi - 1;
    const float t =
        Clamp((s - kStringAnchorS[lo]) / (kStringAnchorS[hi] - kStringAnchorS[lo]), 0.0f,
              1.0f);
    for (int k = 0; k < kStringBodyModes; ++k) {
      const float f =
          kStringAnchorF[lo][k] * fm::Pow(kStringAnchorF[hi][k] / kStringAnchorF[lo][k], t);
      const float q =
          kStringAnchorQ[lo][k] + t * (kStringAnchorQ[hi][k] - kStringAnchorQ[lo][k]);
      const float g =
          kStringAnchorG[lo][k] + t * (kStringAnchorG[hi][k] - kStringAnchorG[lo][k]);
      SetMode(k, f, q, g);
    }
    /* Forest modes ride the same geometric interpolation, referenced to the
     * bridge hill anchor (mode 5): the whole forest slides down as the body
     * grows. */
    const float hill =
        kStringAnchorF[lo][5] * fm::Pow(kStringAnchorF[hi][5] / kStringAnchorF[lo][5], t);
    const float scale = hill / kStringAnchorF[0][5];
    for (int j = 0; j < kStringForestModes; ++j) {
      SetMode(kStringBodyModes + j, kStringForestF[j] * scale, kStringForestQ[j],
              kStringForestG[j]);
    }
  }

  void SetMode(int k, float f, float q, float g) {
    const float w = Min((kTwoPi * f) / sr_, kPi * 0.95f);
    const float alpha = fm::Sin(w) / (2.0f * q);
    const float a0 = 1.0f + alpha;
    body_b0_[k] = alpha / a0;
    body_a1_[k] = (-2.0f * fm::Cos(w)) / a0;
    body_a2_[k] = (1.0f - alpha) / a0;
    body_gain_[k] = g;
  }

  float sr_ = 48000.0f;
  Rng* rng_ = nullptr;
  Rng* note_rng_ = nullptr;
  Params p_;

  DelayLine<kMaxSamples> delay_;
  DelayLine<kCombSamples> force_delay_;
  DelayLine<kPolSamples> pol_delay_;

  /* Excitation: a copy of the main stream plus a length and a position,
   * where the JS keeps a buffer. */
  Rng excite_rng_;
  float excite_amp_ = 0.0f;
  int excite_len_ = 0, excite_pos_ = 0;

  float read_delay_ = 2.0f, period_n_ = 4.0f;
  float lp_a_ = 1.0f, lp_b_ = 0.0f, lp_state_ = 0.0f;
  float gs_ = 0.0f, freq_ = 440.0f, vel_ = 1.0f;
  bool gate_ = false, live_ = false;
  float tracker_ = 0.0f, track_coef_ = 0.0f;

  /* dc blocker. */
  float dc_r_ = 0.9995f, dc_x1_ = 0.0f, dc_y1_ = 0.0f;

  /* Allpass dispersion chain. */
  float ap_c_ = 0.0f;
  float ap_x1_[kStringDispersionStages] = {};
  float ap_y1_[kStringDispersionStages] = {};

  /* Bow transient and noise. */
  float bow_env_ = 0.0f, bite_env_ = 0.0f, noise_lp_ = 0.0f;
  float bow_up_step_ = 0.0f, bow_down_step_ = 0.0f, bite_coef_ = 0.0f, noise_a_ = 0.0f;

  /* Bow force shaping: hair compliance lowpass and bow position comb. */
  float bow_lp_ = 0.0f, bow_lp_a_ = 0.0f;

  /* Per note attack jitter and pitch settle, drawn from the note stream. */
  float jit_scale_ = 1.0f, jit_env_ = 0.0f, jit_coef_ = 0.0f;
  float jit_lp_f_ = 0.0f, jit_lp_s_ = 0.0f;
  float jit_af_ = 0.0f, jit_as_ = 0.0f, jit_norm_ = 0.0f;
  float settle_cents_ = 0.0f, settle_env_ = 0.0f, settle_coef_ = 0.0f;

  /* Second polarization. */
  float pol_read_ = 2.0f, pol_lp_ = 0.0f, pol_lp_a_ = 1.0f, pol_lp_b_ = 0.0f;
  float pol_dc_x1_ = 0.0f, pol_dc_y1_ = 0.0f;

  /* Legato glide. */
  float glide_from_ = 440.0f, glide_to_ = 440.0f, glide_dur_ = 1.0f;
  int glide_left_ = 0;
  float scratch_env_ = 0.0f, scratch_level_ = 0.0f;

  /* Vibrato and note age. */
  uint32_t vib_phase_ = 0u;
  float drift_state_ = 0.0f, drift_a_ = 0.0f, drift_scale_ = 0.0f;
  int32_t age_n_ = 0;
  float age_step_ = 0.0f;

  /* Body bank: seven anchors plus the seventeen mode forest. */
  float body_b0_[kStringTotalModes] = {};
  float body_a1_[kStringTotalModes] = {};
  float body_a2_[kStringTotalModes] = {};
  float body_gain_[kStringTotalModes] = {};
  float body_z1_[kStringTotalModes] = {};
  float body_z2_[kStringTotalModes] = {};
  bool body_dirty_ = true;
};

}  // namespace bellows
