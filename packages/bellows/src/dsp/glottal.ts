/*
 * Ported from CHIMERA by Jameson Hodge (MIT), https://github.com/jamesondh/chimera-vocal-synth,
 * crates/chimera/src/sources/glottis.rs, with the Drift from crates/chimera/src/math.rs and the
 * source mapping from crates/chimera/src/voice/human_voice.rs, at 1d3ea49 (TypeScript original at
 * cd247a6^:src/engine/sources/glottis.ts). Changes from the original: an inertive orifice and a
 * derivative stand in for the airway that turned area into flow, the closure corner is band
 * limited, and vibrato, the pressure gate and the leak terms are left to the engine. See
 * THIRD_PARTY_NOTICES.md.
 *
 * Glottal source: the vocal-fold pulse of a singing voice, as the flow
 * derivative excitation a source-filter voice runs through its formants.
 *
 * WHAT IS PORTED
 *
 * A phase accumulator drives a normalised glottal area pulse, so pitch is
 * exact by construction: nothing estimates a period, the phase just wraps
 * at the requested rate. Within the open quotient the area rises as a
 * half cosine over the first `skew` of the open phase and falls over the
 * rest as a blend of a raised cosine (soft closure, zero slope at the end)
 * and a quarter cosine (abrupt closure, finite slope at the end), mixed by
 * closure sharpness (glottis.rs:231-246).
 *
 * Each cycle draws a period scale and an amplitude: jitter and shimmer
 * from one stream, diplophonia as a fixed alternation of both, and a
 * logistic map x -> r x (1 - x) with r = 2.9 + 1.1 chaos, which walks
 * through period doubling (subharmonics near 0.3) into deterministic chaos
 * past about 0.62 (glottis.rs:178-199). Fry pulls the rate toward 48 Hz,
 * shortens the open quotient toward 0.28 and adds a weaker second pulse at
 * phase 0.38 (glottis.rs:165-168, 202-213). The pitch drift is CHIMERA's
 * 1/f approximation: three one-pole filtered noises at 0.3, 0.9 and
 * 2.7 Hz, each held at unit variance, weighted 1, 1/2, 1/3 and divided by
 * 1.4 (math.rs:236-258).
 *
 * The voice mapping is CHIMERA's (human_voice.rs:317-350): open quotient
 * 0.78 - 0.36 tension, closure sharpness 0.4 tension + 1.375 max(0,
 * tension - 0.6), skew 0.56 + 0.16 tension, jitter 0.0021 + 0.0245
 * roughness, shimmer 0.02 + 0.22 roughness, diplophonia 1.4 (roughness -
 * 0.5) above 0.5. Brightness sits at its default there, where it drops
 * out, and effort at the default lung pressure of 8 cmH2O is 0.5, where
 * its open quotient term is zero. These are the Rust constants at 1d3ea49;
 * the TypeScript original at cd247a6^ mapped jitter as 0.003 + 0.035
 * roughness and sharpness as 0.25 + 0.7 tension, which upstream has since
 * retuned. CHIMERA's human voice does not tie chaos to roughness (only its
 * creatures do), so chaos has its own setter, and so do the raw jitter,
 * shimmer and diplophonia, which setRoughness sets together.
 *
 * Fixed seeds become forks of the stream given at construction: 'jitter'
 * (CHIMERA's 777) for the per-cycle draws, 'drift' (its 4242) for the
 * drift, and 'chaos' for the starting point of the logistic map, which
 * CHIMERA fixes at 0.37. A fixed start would put every pooled voice on the
 * same chaotic trajectory, in unison, so it is drawn on each reset.
 *
 * bellows' NamedRng.gauss() is the Irwin-Hall sum of four uniforms scaled
 * by SQRT2 * 0.875, standard deviation 0.714 (see types.ts). CHIMERA's is
 * the same sum scaled to unit variance. Every draw here is multiplied by
 * UNIT_GAUSS, so jitter, shimmer and the drift, whose band gains assume
 * unit variance, land at CHIMERA's depths. Both generators are
 * mulberry32, so the noise has the same character.
 *
 * The drift updates at DRIFT_CONTROL_HZ rather than every 32 samples.
 * Each band is an Ornstein-Uhlenbeck process and the one-pole update with
 * pole exp(-2 pi f / rate) and input gain sqrt(1 - pole^2) is its exact
 * discretisation, so the process is the same at any control rate; only
 * the cost changes. At 500 Hz the pitch steps every 2 ms, by 0.61 cents
 * rms at the default 6 cents of drift, against 8.5 cents rms of per-cycle
 * jitter at the default roughness of 0.1 (MEASURED). Every 32 samples it
 * cost about 5 ns a sample (MEASURED), a fifth of the unit.
 *
 * AREA TO FLOW, WHICH IS NOT A PORT
 *
 * CHIMERA outputs area and lets its FDTD airway compute flow (Bernoulli
 * drop plus the inertance of the air column), so the skew of the flow
 * pulse and the steepened closure come from the physics. There is no
 * airway here. The same two terms reduced to a single node give the
 * classic inertive orifice: subglottal pressure = (rho / 2)(U / A)^2 +
 * L dU/dt. Normalised by the peak area and the quasi-steady flow it
 * becomes
 *
 *     T du/dt = 1 - (u / a)^2
 *
 * with a the area pulse and u the flow, both about 1 at peak. Flow lags
 * area while the glottis opens (inertance limits how fast the column
 * accelerates) and is pinned to the shrinking area as it closes (the
 * orifice resistance grows without bound), which skews the pulse to the
 * right and steepens the fall: the mechanism Rothenberg (1981, "Acoustic
 * interaction between the glottal source and the vocal tract") and Titze
 * (2008, "Nonlinear source-filter coupling in phonation", JASA 123) give
 * for the skewed flow of real voices. Each step is backward Euler, a
 * quadratic in the new flow solved in closed form, in the rationalised
 * form that has no cancellation and goes to exactly zero with the area.
 * Backward Euler because the closing end of the cycle is stiff: the
 * relaxation time a T / 2 goes to zero with the area, and an explicit or
 * trapezoidal step rings or goes negative there.
 *
 * T is a fixed fraction of the period, INERTANCE = 0.08, not a fixed time.
 * L = rho l / A for the epilarynx and tract gives T of 0.5 to 0.9 ms, 0.055
 * to 0.1 of a 110 Hz period (INFERRED from textbook dimensions). Holding it
 * as a fraction keeps the pulse shape, and so the timbre, the same up the
 * range, where a fixed time would skew high notes until they lost level.
 * That is also closer to life at the top: once f0 passes F1 the tract is
 * no longer inertive and the skew goes away. At 0.08 the flow peak lands
 * 0.025 of a period after the area peak at tension 0.5, and the tilt over
 * harmonics 1 to 10 is -14.6, -10.5 and -3.2 dB per octave at tension 0,
 * 0.5 and 1 (MEASURED).
 *
 * Lip radiation is a differentiator, so the excitation is the flow
 * derivative. It is taken with respect to cycle phase, the first
 * difference divided by the phase increment, which makes the output scale
 * independent of sample rate and of pitch: harmonics 1 to 10 agree within
 * 0.3 dB at 44.1, 48 and 96 kHz (MEASURED, 220 Hz). GAIN puts the peak of
 * the default pulse at 1.
 *
 * BAND LIMITING, BY MEASUREMENT
 *
 * The flow has a slope discontinuity where the area closes with any
 * sharpness, so the derivative steps there, and that step aliases. The
 * first difference of a sampled corner is already a one-sample box step;
 * the rest is measured. Alias energy against harmonic energy in dB, f0
 * 880 Hz, 48 kHz, perturbations off, 65536-point Blackman-Harris spectrum,
 * every bin more than 6 Hz from a harmonic counted as alias:
 *
 *                               tension 0.5 (sharpness 0.2)   tension 1 (sharpness 0.95)
 *                               all     <5 kHz   <10 kHz      all     <5 kHz   <10 kHz
 *     no correction            -42.5    -64.9    -56.6       -23.0    -45.6    -37.2
 *     2-point polyBLAMP        -50.2    -78.1    -69.5       -34.5    -79.4    -69.5
 *     2x oversampled           -52.1    -78.5    -69.0       -32.3    -59.0    -49.2
 *     4x oversampled           -52.8    -89.1    -81.1       -32.9    -71.0    -61.5
 *     4-point B-spline BLAMP   -52.0    -78.2    -69.8       -44.4    -77.2    -67.4
 *     Kaiser BLAMP, 8 a side   -52.3    -78.2    -69.8       -53.2    -77.6    -67.5
 *
 * Oversampling runs through dsp/oversample.ts, whose halfband passes 24
 * to 28.8 kHz partly and folds it back under Nyquist, so it leaves the
 * near-Nyquist total almost where it was and only gains in band. The
 * corner correction removes the corner itself, so it wins in band, where
 * the formants are, at no measurable cost: in one Node 22 process on an
 * M1, at 220 Hz and 48 kHz, the uncorrected and corrected pulse both ran
 * 33.3 ns a sample in the prototype the table was measured with, against
 * 94.4 ns at 2x and 215.9 ns at 4x. Longer residuals only move the
 * near-Nyquist total, which the formant filters bury, and need up to 8
 * samples of lookahead, so the 2-point polyBLAMP of Esqueda, Valimaki and
 * Bilbao (2016, "Rounding corners with BLAMP", DAFx) is the choice. What
 * remains in band at tension 0.5 is the curvature jumps at opening and at
 * the peak, 78 dB down. At 1760 Hz, tension 1, the corrected unit is still
 * -64.8 dB under 5 kHz.
 *
 * The correction needs the flow slope just before closure, one sample
 * ahead of it. Near closure the flow is pinned at u = k a, and the
 * equation above gives k^2 - T s k - 1 = 0 for an area closing with slope
 * s per unit phase, so the flow closes with slope k s. That is exact in
 * the continuous limit and needs no history, so it holds at high f0 where
 * a few samples span the whole closing phase.
 *
 * COST
 *
 * At 48 kHz this unit runs 22 to 23 ns a sample at 220 Hz and 25 to 26 ns
 * at 880 Hz, against 6.1 to 6.4 and 10.8 to 11.1 ns for a BlepOscillator
 * saw at the same pitch in the same Node 22 process on an M1 (MEASURED,
 * medians of 7 runs of 5 s, two processes): 3.6 and 2.3 times the saw,
 * about 0.11 percent of a core per voice. Quote the ratio, as
 * dsp/oscillators.ts explains; the wall clock moves with the harness.
 * The per-sample work is step(), kept under V8's 460-byte bytecode limit
 * for inlining, with the per-cycle and per-closure work in separate
 * methods: at 767 bytes it was not inlined into its caller, every call
 * boxed its return value, and it cost 34 ns. It leaves its sample in a
 * field instead of returning it, so a caller that does not inline it pays
 * a call and nothing else. Whether a caller inlines it can depend on
 * compile order, which V8 picks by timing: once step() has been optimized
 * on its own, a caller pays 1.2 times step() plus everything inlined into
 * it (reserve_inline_budget_scale_factor) out of a 920-byte cumulative
 * budget. That is 368 + 137 + 85 + 91 bytes (step, area, pulse, one
 * sinQuarter), times 1.2, 817 (MEASURED, --trace-turbo-inlining). The
 * pulse once evaluated its sine at two call sites and came to 928, so
 * process() sometimes kept the per-sample call, and in the vocal engine
 * that boxed 13 bytes a sample in 3 runs of 16 under load (MEASURED);
 * test/engines-physical/vocal.test.ts forces that order. `node
 * --print-bytecode --print-bytecode-filter=step` prints the length. A
 * caller whose own loop is large can still exhaust the budget, which is
 * what process() is for.
 *
 * Shape parameters (tension and fry) take effect at the next cycle start,
 * where the area is zero. Moving the open quotient mid-pulse could cut the
 * area to zero at once, and the pinned flow would follow it within a
 * sample: a click. Frequency is applied every sample.
 */

import type { NamedRng } from '../types';
import { clamp } from '../types';

/** Turns a bellows gauss() draw (sd 0.714) into a unit-variance one, as CHIMERA draws. */
const UNIT_GAUSS = 1 / (Math.sqrt(1 / 3) * Math.SQRT2 * 0.875);

const HALF_PI = Math.PI / 2;

/*
 * sin(pi x / 2) for x in [0, 1], by its Taylor series to x^15, each
 * coefficient derived from the last. The first omitted term bounds the
 * error at 6.1e-12, far under a float32 sample. It replaces Math.sin and
 * Math.cos in the pulse, which V8 compiles to calls out of the generated
 * code: 3.4 ns a sample cheaper (MEASURED), and independent of any
 * platform's libm.
 */
const S1 = HALF_PI;
const S3 = (-S1 * HALF_PI * HALF_PI) / (2 * 3);
const S5 = (-S3 * HALF_PI * HALF_PI) / (4 * 5);
const S7 = (-S5 * HALF_PI * HALF_PI) / (6 * 7);
const S9 = (-S7 * HALF_PI * HALF_PI) / (8 * 9);
const S11 = (-S9 * HALF_PI * HALF_PI) / (10 * 11);
const S13 = (-S11 * HALF_PI * HALF_PI) / (12 * 13);
const S15 = (-S13 * HALF_PI * HALF_PI) / (14 * 15);

function sinQuarter(x: number): number {
  const z = x * x;
  return x * (S1 + z * (S3 + z * (S5 + z * (S7 + z * (S9 + z * (S11 + z * (S13 + z * S15)))))));
}

/** Inertive time constant of the airway, as a fraction of the glottal period. */
const INERTANCE = 0.08;
const INV_INERTANCE = 1 / INERTANCE;

/**
 * Output scale. The default pulse (tension 0.5, perturbations off) has a
 * phase-derivative peak of 8.43 (MEASURED, 110 Hz at 48 kHz), so this puts
 * it at 1.
 */
const GAIN = 1 / 8.43;

/** Drift control rate in Hz. See the header for why it is not CHIMERA's 32 samples. */
const DRIFT_CONTROL_HZ = 500;
/** Slowest drift band in Hz. The others sit at 3 and 9 times it. */
const DRIFT_BASE_HZ = 0.3;
/** Band weights 1, 1/2, 1/3 summed and divided by this (math.rs:254-257). */
const DRIFT_NORM = 1.4;
const MAX_DRIFT_CENTS = 100;

/** Fry pulls the rate toward this many Hz. */
const FRY_HZ = 48;
/** Open quotient fry moves toward. */
const FRY_OQ = 0.28;
/** The second fry pulse starts at this phase, with this open quotient ratio and peak. */
const FRY_OFFSET = 0.38;
const FRY_OQ_RATIO = 0.8;
const FRY_PEAK = 0.55;

/*
 * Per-cycle period scale limits 0.55 and 1.8 (glottis.rs:197) and amplitude
 * floor 0.12 (glottis.rs:198), written as literals in startCycle().
 */

/** Where the logistic map restarts if rounding lands it on 0 or 1, CHIMERA's constant. */
const CHAOS_RESTART = 0.37;
/** Range the map's start is drawn from on reset, clear of the fixed points at 0 and 1. */
const CHAOS_START_LO = 0.2;
const CHAOS_START_SPAN = 0.6;

/** A closure phase no cycle reaches, for a pulse that has no corner to correct. */
const NO_CORNER = 2;

const MIN_HZ = 1;
/**
 * Highest rate as a fraction of the sample rate. With the period scale
 * floor of 0.55 the phase step stays under 0.46, so the phase never
 * wraps twice in a sample.
 */
const MAX_HZ_FRACTION = 0.25;
const MAX_JITTER = 0.25;

/**
 * Normalised area of one pulse at cycle phase ph (glottis.rs:233-246):
 * a half cosine rise over the first `skew` of the open phase, then a
 * fall mixing soft (cos^2, which is the raised cosine) and hard (cos)
 * closure by `sharp`.
 */
function pulse(
  ph: number,
  oq: number,
  invOq: number,
  skew: number,
  invSkew: number,
  invFall: number,
  sharp: number,
): number {
  if (ph >= oq) return 0;
  const t = ph * invOq;
  // The rise and the fall each take one quarter sine, so one evaluation
  // serves both. One call site rather than two keeps sinQuarter's 91 bytes
  // of bytecode out of step()'s inlining budget once more; see COST.
  const rising = t < skew;
  const s = sinQuarter(rising ? t * invSkew : 1 - (t - skew) * invFall);
  const s2 = s * s;
  return rising ? s2 : s2 + (s - s2) * sharp;
}

export class GlottalSource {
  private readonly sampleRate: number;
  private readonly invSampleRate: number;
  private readonly maxHz: number;
  private readonly cycleRng: NamedRng;
  private readonly driftRng: NamedRng;
  private readonly chaosRng: NamedRng;
  /**
   * mulberry32 states of the cycle and drift draws, int32, reseeded from
   * their streams at every reset(). The generator runs inline here: a call
   * into a stream's closure per draw returned a boxed double each time
   * (MEASURED: 2 bytes a sample in the vocal engine). Reseeding from the
   * stream keeps every draw reproducible from its label, and successive
   * notes still differ because each reset advances the stream.
   */
  private cycleS = 1;
  private driftS = 1;

  /* Drift interval in samples, band poles, and the input gains that hold each band at unit variance. */
  private readonly driftInterval: number;
  private readonly driftPole0: number;
  private readonly driftPole1: number;
  private readonly driftPole2: number;
  private readonly driftIn0: number;
  private readonly driftIn1: number;
  private readonly driftIn2: number;

  /* Settings. The shape targets wait for the next cycle start. */
  private hz = 110;
  private targetOq = 0.6;
  private targetSkew = 0.64;
  private targetSharp = 0.2;
  private targetFry = 0;
  private jitter = 0;
  private shimmer = 0;
  private diplophonia = 0;
  private chaos = 0;
  private driftCents = 6;

  /* The shape in force for this cycle. */
  private fry = 0;
  private oq = 0.6;
  private invOq = 1 / 0.6;
  private skew = 0.64;
  private invSkew = 1 / 0.64;
  private invFall = 1 / 0.36;
  private sharp = 0.2;
  private fryGain = 0;
  private oq2 = 0;
  private invOq2 = 0;
  private end2 = 0;
  /* Where each pulse closes onto a corner the polyBLAMP corrects, NO_CORNER if it does not. */
  private closeFirst = NO_CORNER;
  private closeSecond = NO_CORNER;

  /* Cycle state. */
  private phase = 0;
  private odd = false;
  private scale = 1;
  private amp = 1;
  private chaosX = CHAOS_RESTART;
  private inc = 0;

  /* Drift state. */
  private drift0 = 0;
  private drift1 = 0;
  private drift2 = 0;
  private driftCountdown = 0;
  private pitchFactor = 1;

  /* Flow: the inertive state, the corrected flow the derivative is taken
   * of, and the corner correction owed to the next sample. */
  private u = 0;
  private uOut = 0;
  private pending = 0;
  /** The sample step() made; see step() for why it is a field and not a return value. */
  private y = 0;
  /** The area nextArea() computed; openArea reads it. A field, so a hot loop reads it without a call. */
  aOut = 0;

  constructor(sampleRate: number, rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.invSampleRate = 1 / sampleRate;
    this.maxHz = sampleRate * MAX_HZ_FRACTION;
    this.cycleRng = rng.fork('jitter');
    this.driftRng = rng.fork('drift');
    this.chaosRng = rng.fork('chaos');
    this.driftInterval = Math.max(1, Math.round(sampleRate / DRIFT_CONTROL_HZ));
    const controlRate = sampleRate / this.driftInterval;
    this.driftPole0 = Math.exp((-2 * Math.PI * DRIFT_BASE_HZ) / controlRate);
    this.driftPole1 = Math.exp((-2 * Math.PI * DRIFT_BASE_HZ * 3) / controlRate);
    this.driftPole2 = Math.exp((-2 * Math.PI * DRIFT_BASE_HZ * 9) / controlRate);
    this.driftIn0 = Math.sqrt(1 - this.driftPole0 * this.driftPole0);
    this.driftIn1 = Math.sqrt(1 - this.driftPole1 * this.driftPole1);
    this.driftIn2 = Math.sqrt(1 - this.driftPole2 * this.driftPole2);
    // CHIMERA's default voice: tension 0.5, roughness 0.1, and the glottis default drift of 6 cents.
    this.setTension(0.5);
    this.setRoughness(0.1);
    this.reset();
  }

  /**
   * Starts a note from a closed glottis. The streams carry on rather than
   * rewind, so successive notes differ while a render stays reproducible
   * from its seed. Allocates nothing.
   */
  reset(): void {
    this.phase = 0;
    this.odd = false;
    this.scale = 1;
    this.amp = 1;
    this.chaosX = CHAOS_START_LO + CHAOS_START_SPAN * this.chaosRng();
    this.cycleS = (this.cycleRng() * 4294967296) | 0;
    this.driftS = (this.driftRng() * 4294967296) | 0;
    this.drift0 = 0;
    this.drift1 = 0;
    this.drift2 = 0;
    this.driftCountdown = 0;
    this.pitchFactor = 1;
    this.u = 0;
    this.uOut = 0;
    this.pending = 0;
    this.aOut = 0;
    this.latch();
    this.inc = this.hz * this.invSampleRate;
  }

  /** Target f0 in Hz before drift, fry and the per-cycle perturbations. Cheap enough per sample. */
  setFreq(hz: number): void {
    // Math.min and Math.max, not clamp(): clamp's integer bounds merged into
    // the stored double and boxed it, about 0.8 bytes a sample at 48 kHz
    if (hz !== hz) return;
    this.hz = Math.min(Math.max(hz, MIN_HZ), this.maxHz);
  }

  /** setFreq(src[i]): the audio path's form, so no double crosses the call. */
  setFreqFrom(src: Float64Array, i: number): void {
    const hz = src[i];
    if (hz !== hz) return;
    this.hz = Math.min(Math.max(hz, MIN_HZ), this.maxHz);
  }

  /** 0 lax to 1 pressed: open quotient, closure sharpness and skew. */
  setTension(t: number): void {
    const v = clamp(t, 0, 1);
    this.targetOq = clamp(0.78 - 0.36 * v, 0.25, 0.98);
    this.targetSkew = clamp(0.56 + 0.16 * v, 0.3, 0.9);
    this.targetSharp = clamp(0.4 * v + 1.375 * Math.max(0, v - 0.6), 0, 1);
    if (this.phase === 0) this.latch();
  }

  /** 0..1: jitter, shimmer and, above 0.5, diplophonia, by CHIMERA's mapping. */
  setRoughness(r: number): void {
    const v = clamp(r, 0, 1);
    this.jitter = 0.0021 + 0.0245 * v;
    this.shimmer = 0.02 + 0.22 * v;
    this.diplophonia = v > 0.5 ? (v - 0.5) * 1.4 : 0;
  }

  /** 0..1 vocal fry. */
  setFry(f: number): void {
    this.targetFry = clamp(f, 0, 1);
    if (this.phase === 0) this.latch();
  }

  /** Depth of the 1/f pitch drift in cents. */
  setDrift(cents: number): void {
    this.driftCents = clamp(cents, 0, MAX_DRIFT_CENTS);
  }

  /** Cycle-to-cycle period perturbation as a fraction, overriding setRoughness. */
  setJitter(fraction: number): void {
    this.jitter = clamp(fraction, 0, MAX_JITTER);
  }

  /** Cycle-to-cycle amplitude perturbation as a fraction, overriding setRoughness. */
  setShimmer(fraction: number): void {
    this.shimmer = clamp(fraction, 0, 1);
  }

  /** 0..1 alternation of period and amplitude between cycles, overriding setRoughness. */
  setDiplophonia(amount: number): void {
    this.diplophonia = clamp(amount, 0, 1);
  }

  /** 0..1 logistic-map bifurcation: period doubling near 0.3, chaos past about 0.62. */
  setChaos(amount: number): void {
    this.chaos = clamp(amount, 0, 1);
  }

  /** The last glottal flow sample: 0 while closed, about 1 at peak. */
  get flow(): number {
    return this.u;
  }

  /**
   * The glottal area of the last nextArea() sample: 0 while closed, about 1
   * at peak, scaled by the cycle's shimmer. Multiply by an area in cm^2.
   */
  get openArea(): number {
    return this.aOut;
  }

  /**
   * Advances one sample of the area waveform only, for a caller that solves
   * the flow itself from the pressure across the folds (src/dsp/tract.ts),
   * which is where source and tract interact. It draws the same streams at
   * the same moments as next(), so drift, jitter, shimmer and fry behave
   * the same; the flow and its derivative are not computed. Use one of
   * next() and the area methods per source, not both.
   */
  nextArea(): void {
    if (--this.driftCountdown <= 0) this.stepDrift();
    let hz = this.hz * this.pitchFactor;
    if (this.fry > 0) hz = this.fryPull(hz);
    if (hz > this.maxHz) hz = this.maxHz;
    const inc = (hz * this.invSampleRate) / this.scale;
    this.inc = inc;
    let ph = this.phase + inc;
    if (ph >= 1) {
      ph -= 1;
      this.startCycle();
    }
    this.phase = ph;
    this.aOut = this.area(ph);
  }

  /**
   * nextArea() for samples [from, to) of out, for a caller whose own loop is
   * too large to inline the pulse: called on its own, this method keeps the
   * pulse's calls inside its own optimization, as process() does for next().
   */
  processArea(out: Float64Array, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      this.nextArea();
      out[i] = this.aOut;
    }
  }

  /** The rate the last sample advanced at, in Hz, after drift, fry and the cycle's perturbation. */
  get f0(): number {
    return this.inc * this.sampleRate;
  }

  /** One sample of the glottal flow derivative. */
  next(): number {
    this.step();
    return this.y;
  }

  /** Overwrites out over [from, to), for callers whose own loop is too large to inline step(). */
  process(out: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      this.step();
      out[i] = this.y;
    }
  }

  /**
   * Advances one sample and leaves it in `y`. It returns nothing, so no
   * double crosses this call for V8 to box when it is not inlined (the
   * pattern of CritDampBank.step()); everything it calls per sample is
   * inlined into it. Keep under 460 bytes of bytecode: see COST.
   */
  private step(): void {
    if (--this.driftCountdown <= 0) this.stepDrift();

    let hz = this.hz * this.pitchFactor;
    if (this.fry > 0) hz = this.fryPull(hz);
    if (hz > this.maxHz) hz = this.maxHz;
    const inc = (hz * this.invSampleRate) / this.scale;
    this.inc = inc;
    let ph = this.phase + inc;
    if (ph >= 1) {
      ph -= 1;
      this.startCycle();
    }
    this.phase = ph;
    const a = this.area(ph);

    // Backward Euler on T du/dphase = 1 - (u/a)^2, rationalised: exact zero when a is.
    let u = 0;
    if (a > 0) {
      const h = inc * INV_INERTANCE;
      const b = this.u + h;
      u = (2 * b) / (1 + Math.sqrt(1 + (4 * h * b) / (a * a)));
    }

    let out = u + this.pending;
    this.pending = 0;
    if (ph + inc >= this.closeFirst && ph < this.closeFirst) out += this.cornerFirst(ph, inc);
    if (ph + inc >= this.closeSecond && ph < this.closeSecond) out += this.cornerSecond(ph, inc);
    this.y = ((out - this.uOut) * GAIN) / inc;
    this.uOut = out;
    this.u = u;
  }

  /** CHIMERA's fry pull of the rate toward FRY_HZ (glottis.rs:166-168). */
  private fryPull(hz: number): number {
    const fry = this.fry;
    return hz * (1 - fry) + (hz < FRY_HZ ? hz : FRY_HZ) * fry;
  }

  /** Glottal area at phase ph: the main pulse plus, under heavy fry, the second one. */
  private area(ph: number): number {
    const amp = this.amp;
    let a = amp * pulse(ph, this.oq, this.invOq, this.skew, this.invSkew, this.invFall, this.sharp);
    if (this.fryGain > 0 && ph > FRY_OFFSET) {
      a +=
        amp *
        this.fryGain *
        pulse(ph - FRY_OFFSET, this.oq2, this.invOq2, this.skew, this.invSkew, this.invFall, this.sharp);
    }
    return a;
  }

  /**
   * The main pulse closes before the next sample. It closes onto zero
   * unless the second fry pulse is already open there, and an open second
   * pulse rounds the corner over about a2 T / 2 of a period, so the
   * correction fades with that time measured in samples.
   */
  private cornerFirst(ph: number, inc: number): number {
    const oq = this.oq;
    let weight = 1;
    if (this.fryGain > 0 && oq > FRY_OFFSET) {
      const a2 =
        this.amp *
        this.fryGain *
        pulse(oq - FRY_OFFSET, this.oq2, this.invOq2, this.skew, this.invSkew, this.invFall, this.sharp);
      weight = 1 / (1 + (a2 * INERTANCE) / (2 * inc));
    }
    const slope = this.amp * this.sharp * HALF_PI * this.invFall * this.invOq;
    return this.corner(ph, inc, oq, slope, weight);
  }

  /** The second fry pulse closes before the next sample, always onto zero. */
  private cornerSecond(ph: number, inc: number): number {
    const slope = this.amp * this.fryGain * this.sharp * HALF_PI * this.invFall * this.invOq2;
    return this.corner(ph, inc, this.end2, slope, 1);
  }

  /**
   * Two-point polyBLAMP for the flow corner at phase `end`, which falls
   * between this sample and the next. `slope` is the magnitude of the area
   * slope per unit phase just before closure; the flow closes k times
   * faster, k the positive root of k^2 - T s k - 1 = 0. The residual
   * (1 - |x|)^3 / 6 is added at both neighbours of the corner: this
   * sample's share is returned, the next one's is left in `pending`.
   */
  private corner(ph: number, inc: number, end: number, slope: number, weight: number): number {
    const ts = INERTANCE * slope;
    const flowSlope = 0.5 * slope * (ts + Math.sqrt(ts * ts + 4));
    const mu = weight * flowSlope * inc;
    const x = (end - ph) / inc;
    const d = 1 - x;
    this.pending += (mu * x * x * x) / 6;
    return (mu * d * d * d) / 6;
  }

  /** New cycle: the shape catches up with its settings, then the per-cycle draws. */
  private startCycle(): void {
    this.latch();
    this.odd = !this.odd;
    const alt = this.odd ? 1 : -1;
    let chaosP = 0;
    let chaosA = 0;
    const chaos = this.chaos;
    if (chaos > 0) {
      const r = 2.9 + 1.1 * chaos;
      let x = r * this.chaosX * (1 - this.chaosX);
      if (!(x > 0 && x < 1)) x = 0.37; // CHAOS_RESTART, a literal for the reason above
      this.chaosX = x;
      const dev = x - 0.5;
      chaosP = 0.45 * chaos * dev;
      chaosA = 1.1 * chaos * dev;
    }
    // two Irwin-Hall draws of four uniforms each (NamedRng.gauss), by mulberry32 inline
    let st = this.cycleS;
    let u0 = 0;
    let u1 = 0;
    for (let q = 0; q < 8; q++) {
      st = (st + 0x6d2b79f5) | 0;
      let t = Math.imul(st ^ (st >>> 15), st | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      if (q < 4) u0 += u;
      else u1 += u;
    }
    this.cycleS = st;
    const gp = (u0 - 2) * Math.SQRT2 * 0.875 * UNIT_GAUSS;
    const ga = (u1 - 2) * Math.SQRT2 * 0.875 * UNIT_GAUSS;
    // the limits as literals: a module constant merged with a double in a conditional made V8
    // box the double once a cycle (MEASURED in the vocal engine)
    const sc = 1 + this.jitter * gp + this.diplophonia * 0.08 * alt + chaosP;
    this.scale = sc < 0.55 ? 0.55 : sc > 1.8 ? 1.8 : sc;
    const amp = 1 + this.shimmer * ga - (this.odd ? this.diplophonia * 0.35 : 0) + chaosA;
    this.amp = amp > 0.12 ? amp : 0.12;
  }

  /** One control-rate step of the three-band drift, and the pitch factor it gives. */
  private stepDrift(): void {
    this.driftCountdown = this.driftInterval;
    // three Irwin-Hall draws, by mulberry32 inline (see cycleS)
    let st = this.driftS;
    let g0 = 0;
    let g1 = 0;
    let g2 = 0;
    for (let q = 0; q < 12; q++) {
      st = (st + 0x6d2b79f5) | 0;
      let t = Math.imul(st ^ (st >>> 15), st | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      if (q < 4) g0 += u;
      else if (q < 8) g1 += u;
      else g2 += u;
    }
    this.driftS = st;
    const gs = Math.SQRT2 * 0.875 * UNIT_GAUSS;
    this.drift0 = this.driftPole0 * this.drift0 + this.driftIn0 * (g0 - 2) * gs;
    this.drift1 = this.driftPole1 * this.drift1 + this.driftIn1 * (g1 - 2) * gs;
    this.drift2 = this.driftPole2 * this.drift2 + this.driftIn2 * (g2 - 2) * gs;
    const v = (this.drift0 + this.drift1 / 2 + this.drift2 / 3) / DRIFT_NORM;
    this.pitchFactor = Math.pow(2, (this.driftCents * v) / 1200);
  }

  /** Puts the tension and fry settings into force. Called where the area is zero. */
  private latch(): void {
    const fry = this.targetFry;
    this.fry = fry;
    const oq = fry > 0 ? this.targetOq * (1 - fry) + FRY_OQ * fry : this.targetOq;
    this.oq = oq;
    this.invOq = 1 / oq;
    this.skew = this.targetSkew;
    this.invSkew = 1 / this.targetSkew;
    this.invFall = 1 / (1 - this.targetSkew);
    this.sharp = this.targetSharp;
    const corners = this.sharp > 0;
    // NO_CORNER (2) as a literal: a module constant merged with a double in a conditional is boxed
    this.closeFirst = corners ? oq : 2;
    if (fry > 0.3) {
      const t = clamp((fry - 0.3) / 0.5, 0, 1);
      this.fryGain = FRY_PEAK * t * t * (3 - 2 * t);
      this.oq2 = oq * FRY_OQ_RATIO;
      this.invOq2 = 1 / this.oq2;
      this.end2 = FRY_OFFSET + this.oq2;
      this.closeSecond = corners ? this.end2 : 2;
    } else {
      this.fryGain = 0;
      this.end2 = 0;
      this.closeSecond = NO_CORNER;
    }
  }
}
