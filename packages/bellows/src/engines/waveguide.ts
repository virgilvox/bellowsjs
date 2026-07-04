/*
 * Waveguide engines: 'string' and 'tube'.
 *
 * The string is a single loop equivalent of a bidirectional waveguide:
 * fractional delay, one pole loop damping, a dc blocker (the bow injects
 * a dc component that must not recirculate), and a chain of first order
 * allpasses whose coefficient (dispersion) detunes upper partials for
 * piano-like inharmonicity. The read delay compensates the phase delay
 * of every loop element at the fundamental. Plucked by default; with
 * bow > 0 a friction-curve force drives the loop while the gate is held.
 *
 * Bowed realism additions, applied only when their params are nonzero:
 * a fixed seven mode body resonator bank at the output tap (violin,
 * viola, cello, and bass anchor tables morphed by bodySize; the modes
 * never track the note, which is the main realism cue), an STK style
 * friction table whose slope follows bowPressure, rosin noise and an
 * attack bite transient injected on the bow side of the junction, and
 * vibrato as delay line length modulation so the fixed body turns the
 * FM into per partial AM on its own.
 *
 * Round two, source spectrum and life: the injected bow force passes a
 * one pole bow hair lowpass and a feedforward bow position comb whose
 * delay is 2 * bowPos periods, matching the sin(pi n bowPos) coupling
 * envelope of a bow at bowPos of the string length, and the loop
 * damping cutoff is capped while bowed, so the sustained spectrum
 * tilts toward the minus 6 dB per octave Helmholtz sawtooth instead of
 * peaking at h9 to h11. A fixed forest of 17 extra body modes, seeded
 * once at module load with alternating gain signs, joins the 7 anchor
 * modes and carves notches as well as peaks. Attacks draw per note
 * jitter and a pitch settle (starts a few cents off, locks over about
 * 120 ms) from a forked note rng stream so no two attacks match while
 * renders stay deterministic per seed. Vibrato dips under the note
 * (center offset below nominal) and its rate ramps in over the first
 * second. dynamics maps noteOn velocity into bow speed and pressure so
 * loud is brighter, not merely louder. polDetune adds a second string
 * polarization a couple cents sharp, weakly coupled from the bow
 * force, whose beating gives the slow sustain undulation of a real
 * string; its delay line exists only when the param is present at
 * construction.
 *
 * The tube is a cylindrical bore after the STK clarinet: half period
 * delay, two point average reflection filter with gain -0.95, and a
 * memoryless reed table clamp(0.7 - 0.3 * pressureDiff, -1, 1) driven
 * by breath pressure plus rng noise. Sounds while the gate is held and
 * releases on noteOff.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { DelayLine } from '../dsp/delayline';
import { NoiseGen } from '../dsp/noise';
import { Adsr } from '../dsp/envelopes';
import { rng as makeRng } from '../core/prng';

const MIN_FREQ = 20;
const TWO_PI = Math.PI * 2;
const RELEASE_T60 = 0.25;
const TRACK_TAU = 0.05;
const SILENCE = 1e-4;
const DISPERSION_STAGES = 4;

function p(params: Record<string, number>, name: string, dflt: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/** Phase delay in samples of y[n] = a x[n] + (1-a) y[n-1] at radian frequency w. */
function onePolePhaseDelay(a: number, w: number): number {
  const b = 1 - a;
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}

/** Phase delay in samples of the allpass (c + z^-1) / (1 + c z^-1) at w. */
function allpassPhaseDelay(c: number, w: number): number {
  const s = Math.sin(w);
  const co = Math.cos(w);
  const angle = Math.atan2(-s, c + co) - Math.atan2(-c * s, 1 + c * co);
  return -angle / w;
}

/** Phase delay in samples of the dc blocker (1 - z^-1) / (1 - r z^-1) at w. Negative: phase lead. */
function dcBlockerPhaseDelay(r: number, w: number): number {
  const s = Math.sin(w);
  const co = Math.cos(w);
  const angle = Math.atan2(s, 1 - co) - Math.atan2(r * s, 1 - r * co);
  return -angle / w;
}

/**
 * Bow friction curve after the STK bowed string: near 1 (stick) for a
 * small velocity difference, falling fast past break-away (slip). The
 * slope comes from bow pressure (5 - 4 * pressure): a firmer bow gets a
 * lower slope, so a wider stick plateau and a higher break-away
 * velocity. The 0.001 offset inside the abs breaks left/right symmetry
 * (bow direction dependence) and is the dc source the loop's dc blocker
 * bleeds off.
 */
function bowTable(dv: number, slope: number): number {
  const t = Math.pow(Math.abs(dv + 0.001) * slope + 0.75, -4);
  return t > 1 ? 1 : t;
}

/* Body resonator anchor tables. Frequencies in Hz, Q dimensionless,
 * gain linear relative to the strongest wood mode. The bodySize param
 * morphs piecewise between adjacent instruments: frequencies
 * geometrically, gains and Q linearly. Anchors: violin 0.0, viola 0.18,
 * cello 0.62, double bass 1.0. Mode order per instrument: main air
 * resonance, center bout rocking, lower and upper main wood pair, mid
 * wood band, bridge hill, upper bridge hill. */
const BODY_MODES = 7;
const BODY_ANCHOR_S = [0, 0.18, 0.62, 1];
const BODY_ANCHOR_F = [
  [275, 405, 465, 550, 1000, 2300, 3500],
  [230, 340, 375, 460, 800, 1700, 2800],
  [105, 150, 175, 220, 400, 1600, 2500],
  [60, 85, 100, 125, 400, 750, 1400],
];
const BODY_ANCHOR_Q = [
  [25, 30, 25, 25, 4, 2.5, 3],
  [25, 25, 22, 22, 3, 2.5, 3],
  [20, 25, 20, 20, 4, 2.5, 3],
  [15, 20, 15, 15, 3, 2, 2.5],
];
const BODY_ANCHOR_G = [
  [0.7, 0.3, 0.9, 1.0, 0.5, 0.8, 0.5],
  [0.55, 0.35, 0.85, 1.0, 0.75, 0.7, 0.45],
  [0.85, 0.3, 1.0, 0.9, 0.5, 0.7, 0.45],
  [0.8, 0.3, 1.0, 0.9, 0.6, 0.6, 0.35],
];
/* Body forest: 17 extra modes on top of the 7 anchors, pseudo log
 * spaced 800 Hz to 8 kHz with random offsets, Q 8 to 25, gains 0.15 to
 * 0.4 with alternating signs so neighboring modes interfere and carve
 * notches as well as peaks. Seeded once from a module constant, never
 * from the voice rng, so every voice and every render agree. The
 * forest frequencies follow bodySize through the same geometric
 * interpolation as the anchors, referenced to the bridge hill mode. */
const FOREST_MODES = 17;
const TOTAL_MODES = BODY_MODES + FOREST_MODES;
const FOREST_F = new Float64Array(FOREST_MODES);
const FOREST_Q = new Float64Array(FOREST_MODES);
const FOREST_G = new Float64Array(FOREST_MODES);
{
  const fr = makeRng('string-body-forest');
  for (let k = 0; k < FOREST_MODES; k++) {
    const center = 800 * Math.pow(10, k / (FOREST_MODES - 1));
    FOREST_F[k] = center * (1 + (2 * fr() - 1) * 0.12);
    FOREST_Q[k] = 8 + 17 * fr();
    FOREST_G[k] = (0.15 + 0.25 * fr()) * (k % 2 === 0 ? 1 : -1);
  }
}
/* Dry bleed inside the wet path (prevents the hollow talking-through-a-
 * tube artifact) and makeup gain on the resonator sum. */
const BODY_DRY = 0.35;
const BODY_MAKEUP = 0.8;
const BOW_JUNCTION_GAIN = 1.1;
/* Round two source spectrum shaping, iterated against the tilt gate in
 * waveguide.test.ts (body off, A4, pressure 0.55, speed 0.6: h8 at or
 * below -12 dB, h12 at or below -16 dB relative to h1, no harmonic
 * above h1). The bow hair lowpass models hair compliance on the
 * injected force only, never the recirculating wave; the comb models
 * the reflection from the bridge side of the bow contact point; the
 * loop cutoff cap while bowed stands in for the heavier internal
 * damping a bowed string shows against a plucked one. */
const BOW_HAIR_FC = 3500;
const COMB_DEPTH = 0.9;
const COMB_MAKEUP = 1.3;
const COMB_NORM = (1 / (1 + COMB_DEPTH)) * COMB_MAKEUP;
const BOW_LOOP_FC_CAP = 4200;
/* Normal force scaling of the friction force (mu times N): the table
 * is mu(dv), pressure is N. Without it a feather bow rides the comb's
 * inter-null bands and comes out as loud as a firm one. */
const BOW_NFORCE_LO = 0.3;
const BOW_NFORCE_SPAN = 1.4;
/* Attack life: pitch settle time constant and the bow velocity jitter
 * walk band (roughly 30 to 80 Hz), scaled per note from the forked
 * note rng stream. */
const SETTLE_TAU = 0.12;
const JITTER_AMT = 0.5;
const JITTER_LO = 30;
const JITTER_HI = 80;
/* Vibrato center sits this fraction of the depth below nominal: real
 * vibrato dips under the note. */
const VIB_ASYM = 0.3;
/* Dual polarization: coupling from the main loop bow force into the
 * detuned second loop, the excitation kick share, and its output mix
 * (about 6 dB down). The second loop keeps its own gentle lowpass
 * (POL_LP_FC): the bow only damps the polarization it touches, and a
 * heavier filter would kill the free ring (and with it the beat)
 * within a second. */
const POL_COUPLE = 0.12;
const POL_MIX = 0.5;
const POL_KICK = 2;
/* The pol loop is linear, so whatever the bow force drives directly
 * stays phase locked to the main loop and cannot beat. The beat comes
 * from stored energy re-circulating at the pol loop's own detuned
 * period: POL_ATT couples the attack (gated by the settle envelope)
 * hard into the line to store that energy, and POL_KICK adds the seed
 * burst share. */
const POL_ATT = 2;
const POL_LP_FC = 16000;
/* Force-side coupling for the junction noise. The velocity-side
 * perturbation alone is almost entirely cancelled by the stick phase,
 * which servos the string back to the bow velocity within a sample or
 * two, so the audible rosin floor comes from the same noise leaking
 * through the friction contact as force, gated by the stick state. */
const NOISE_FORCE_GAIN = 3;
/* The attack bite share of the junction noise carries its own, larger
 * force gain: the bow hair lowpass and the comb normalization smooth
 * the tonal scratch the bite relied on before round two, so the
 * break-away burst has to supply the attack's high band itself. */
const BITE_FORCE_GAIN = 20;
const VIB_RAMP_SEC = 0.3;
const CENTS_TO_RATIO = 5.78e-4;

/* ------------------------------------------------------------------ */
/* String                                                              */
/* ------------------------------------------------------------------ */

class StringVoice implements Voice {
  private readonly sr: number;
  private readonly rng: NamedRng;
  private readonly delay: DelayLine;
  private readonly excite: Float32Array;
  private exciteLen = 0;
  private excitePos = 0;

  private readDelay = 2;
  private lpA = 1;
  private lpB = 0;
  private lpState = 0;
  private gs = 0;
  private freq = 440;
  private vel = 1;
  private gate = false;
  private live = false;
  private tracker = 0;
  private readonly trackCoef: number;

  // dc blocker state
  private readonly dcR: number;
  private dcX1 = 0;
  private dcY1 = 0;

  // allpass dispersion chain state
  private apC = 0;
  private readonly apX1 = new Float32Array(DISPERSION_STAGES);
  private readonly apY1 = new Float32Array(DISPERSION_STAGES);

  // bow transient and noise state
  private bowEnv = 0;
  private biteEnv = 0;
  private noiseLP = 0;
  private readonly bowUpStep: number;
  private readonly bowDownStep: number;
  private readonly biteCoef: number;
  private readonly noiseA: number;

  // bow force shaping: hair compliance lowpass and bow position comb
  private bowLp = 0;
  private readonly bowLpA: number;
  private readonly forceDelay: DelayLine;
  private periodN = 4;

  // per note attack jitter and pitch settle, drawn from the forked
  // note rng stream so the main stream (and every pluck render) is
  // untouched
  private readonly noteRng: NamedRng;
  private jitScale = 1;
  private jitEnv = 0;
  private jitCoef = 0;
  private jitLpF = 0;
  private jitLpS = 0;
  private readonly jitAF: number;
  private readonly jitAS: number;
  private readonly jitNorm: number;
  private settleCents = 0;
  private settleEnv = 0;
  private readonly settleCoef: number;

  // dual polarization: the second delay loop exists only when the
  // polDetune param was present in the construction params. On a
  // pooled voice, setting polDetune nonzero later reuses this
  // preallocated line; if the key was absent at construction the
  // second polarization stays silent (no allocation on the audio
  // path).
  private readonly pol2: DelayLine | null;
  private pol2Read = 2;
  private polLp = 0;
  private polLpA = 1;
  private polLpB = 0;
  private polDcX1 = 0;
  private polDcY1 = 0;

  // vibrato state
  private vibPhase = 0;
  private driftState = 0;
  private ageSec = 0;
  private readonly ageStep: number;
  private readonly driftA: number;
  private readonly driftScale: number;

  // body resonator bank (7 anchors plus the 17 mode forest):
  // coefficients recomputed at block rate when bodySize changes, never
  // per sample
  private readonly bodyB0 = new Float64Array(TOTAL_MODES);
  private readonly bodyA1 = new Float64Array(TOTAL_MODES);
  private readonly bodyA2 = new Float64Array(TOTAL_MODES);
  private readonly bodyGain = new Float64Array(TOTAL_MODES);
  private readonly bodyZ1 = new Float64Array(TOTAL_MODES);
  private readonly bodyZ2 = new Float64Array(TOTAL_MODES);
  private bodyDirty = true;

  private damp: number;
  private sustain: number;
  private dispersion: number;
  private bow: number;
  private bowPressure: number;
  private bowSpeed: number;
  private level: number;
  private body: number;
  private bodySize: number;
  private bowNoise: number;
  private attackBite: number;
  private vibRate: number;
  private vibDepth: number;
  private vibOnset: number;
  private bowPos: number;
  private dynamics: number;
  private polDetune: number;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sr = sampleRate;
    this.rng = rng;
    const maxSamples = Math.ceil(sampleRate / MIN_FREQ) + 8;
    this.delay = new DelayLine(maxSamples);
    this.excite = new Float32Array(maxSamples);
    this.trackCoef = Math.exp(-1 / (TRACK_TAU * sampleRate));
    // Gentle dc blocker: the pole hugs the zero so its phase delay at
    // and above the fundamental stays small and nearly flat, keeping
    // the loop close to harmonic. It only has to bleed off the dc the
    // bow injects, which builds up slowly.
    this.dcR = clamp(1 - (0.0005 * 44100) / sampleRate, 0.99, 0.999995);
    // 20 ms bow velocity ramp in at noteOn, 10 ms ramp out at noteOff
    this.bowUpStep = 1 / (0.02 * sampleRate);
    this.bowDownStep = 1 / (0.01 * sampleRate);
    // 30 ms one shot attack bite envelope
    this.biteCoef = Math.exp(-1 / (0.03 * sampleRate));
    // one pole lowpass near 6 kHz shapes the rosin noise band
    this.noiseA = 1 - Math.exp((-TWO_PI * Math.min(6000, sampleRate * 0.45)) / sampleRate);
    // bow hair compliance lowpass on the injected force
    this.bowLpA = 1 - Math.exp((-TWO_PI * Math.min(BOW_HAIR_FC, sampleRate * 0.45)) / sampleRate);
    // bow position comb delay tops out at 2 * 0.45 periods of MIN_FREQ
    this.forceDelay = new DelayLine(Math.ceil(0.9 * (sampleRate / MIN_FREQ)) + 8);
    // per note draws come from a forked stream so consuming them never
    // shifts the main stream a pluck render depends on
    this.noteRng = rng.fork('note');
    // attack jitter walk: white through a 30 to 80 Hz one pole band,
    // normalized to roughly unit standard deviation
    this.jitAF = 1 - Math.exp((-TWO_PI * JITTER_HI) / sampleRate);
    this.jitAS = 1 - Math.exp((-TWO_PI * JITTER_LO) / sampleRate);
    const bandVar =
      (1 / 3) * (this.jitAF / (2 - this.jitAF) - this.jitAS / (2 - this.jitAS));
    this.jitNorm = bandVar > 0 ? 1 / Math.sqrt(bandVar) : 0;
    this.settleCoef = Math.exp(-1 / (SETTLE_TAU * sampleRate));
    // the second polarization line exists only when the param key was
    // present at construction (see the field comment)
    this.pol2 = 'polDetune' in params ? new DelayLine(maxSamples) : null;
    this.ageStep = 1 / sampleRate;
    // Vibrato drift: white noise through a one pole lowpass near 0.5 Hz
    // wobbles rate and depth so the LFO does not read as synthetic. The
    // scale normalizes the filtered noise to roughly unit swing.
    this.driftA = 1 - Math.exp((-TWO_PI * 0.5) / sampleRate);
    this.driftScale = Math.sqrt((2 - this.driftA) / this.driftA) * Math.sqrt(3);
    this.damp = p(params, 'damp', 0.35);
    this.sustain = p(params, 'sustain', 0.6);
    this.dispersion = p(params, 'dispersion', 0);
    this.bow = p(params, 'bow', 0);
    this.bowPressure = p(params, 'bowPressure', 0.5);
    this.bowSpeed = p(params, 'bowSpeed', 0.5);
    this.level = p(params, 'level', 0.9);
    this.body = p(params, 'body', 0);
    this.bodySize = p(params, 'bodySize', 0);
    this.bowNoise = p(params, 'bowNoise', 0);
    this.attackBite = p(params, 'attackBite', 0);
    this.vibRate = p(params, 'vibRate', 6.1);
    this.vibDepth = p(params, 'vibDepth', 0);
    this.vibOnset = p(params, 'vibOnset', 0.3);
    this.bowPos = p(params, 'bowPos', 0.11);
    this.dynamics = p(params, 'dynamics', 0);
    this.polDetune = p(params, 'polDetune', 0);
  }

  /** Morph the body mode table at the current bodySize and derive RBJ
   * constant peak bandpass coefficients. Block rate only. */
  private computeBody(): void {
    const s = clamp(this.bodySize, 0, 1);
    let hi = 1;
    while (hi < BODY_ANCHOR_S.length - 1 && s > BODY_ANCHOR_S[hi]) hi++;
    const lo = hi - 1;
    const t = clamp((s - BODY_ANCHOR_S[lo]) / (BODY_ANCHOR_S[hi] - BODY_ANCHOR_S[lo]), 0, 1);
    for (let k = 0; k < BODY_MODES; k++) {
      const f = BODY_ANCHOR_F[lo][k] * Math.pow(BODY_ANCHOR_F[hi][k] / BODY_ANCHOR_F[lo][k], t);
      const q = BODY_ANCHOR_Q[lo][k] + t * (BODY_ANCHOR_Q[hi][k] - BODY_ANCHOR_Q[lo][k]);
      const g = BODY_ANCHOR_G[lo][k] + t * (BODY_ANCHOR_G[hi][k] - BODY_ANCHOR_G[lo][k]);
      const w = Math.min((TWO_PI * f) / this.sr, Math.PI * 0.95);
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      this.bodyB0[k] = alpha / a0;
      this.bodyA1[k] = (-2 * Math.cos(w)) / a0;
      this.bodyA2[k] = (1 - alpha) / a0;
      this.bodyGain[k] = g;
    }
    // Forest modes ride the same geometric interpolation, referenced
    // to the bridge hill anchor (mode 5): the whole forest slides down
    // as the body grows.
    const hill = BODY_ANCHOR_F[lo][5] * Math.pow(BODY_ANCHOR_F[hi][5] / BODY_ANCHOR_F[lo][5], t);
    const scale = hill / BODY_ANCHOR_F[0][5];
    for (let j = 0; j < FOREST_MODES; j++) {
      const k = BODY_MODES + j;
      const f = FOREST_F[j] * scale;
      const w = Math.min((TWO_PI * f) / this.sr, Math.PI * 0.95);
      const alpha = Math.sin(w) / (2 * FOREST_Q[j]);
      const a0 = 1 + alpha;
      this.bodyB0[k] = alpha / a0;
      this.bodyA1[k] = (-2 * Math.cos(w)) / a0;
      this.bodyA2[k] = (1 - alpha) / a0;
      this.bodyGain[k] = FOREST_G[j];
    }
  }

  noteOn(freq: number, vel: number): void {
    this.freq = clamp(freq, MIN_FREQ, this.sr / 10);
    this.vel = clamp(vel, 0, 1);
    this.gate = true;
    this.live = true;
    this.delay.clear();
    this.lpState = 0;
    this.dcX1 = 0;
    this.dcY1 = 0;
    this.apX1.fill(0);
    this.apY1.fill(0);
    this.bowEnv = 0;
    this.biteEnv = 1;
    this.noiseLP = 0;
    this.bowLp = 0;
    this.forceDelay.clear();
    this.vibPhase = 0;
    this.driftState = 0;
    this.ageSec = 0;
    this.bodyZ1.fill(0);
    this.bodyZ2.fill(0);
    if (this.pol2) {
      this.pol2.clear();
      this.polLp = 0;
      this.polDcX1 = 0;
      this.polDcY1 = 0;
    }
    // Per note life draws, in a fixed order so the note stream stays
    // aligned whatever the params: jitter scale (0.6 to 1.4), jitter
    // decay (30 to 50 ms, so the walk audibly rides the first 90 to
    // 150 ms), settle magnitude (8 to 15 cents) and its sign (mostly
    // sharp, occasionally flat).
    this.jitScale = 0.6 + 0.8 * this.noteRng();
    this.jitCoef = Math.exp(-1 / ((0.03 + 0.02 * this.noteRng()) * this.sr));
    const settleMag = 8 + 7 * this.noteRng();
    this.settleCents = this.noteRng() < 0.25 ? -settleMag : settleMag;
    this.jitEnv = 1;
    this.jitLpF = 0;
    this.jitLpS = 0;
    this.settleEnv = 1;
    this.updateLoop();

    // Noise burst excitation, one period. A bowed note still gets a
    // small seed so the friction loop starts from motion, not silence.
    const n = this.sr / this.freq;
    const len = Math.max(2, Math.round(n));
    const amp = 0.55 * this.vel * (1 - 0.8 * clamp(this.bow, 0, 1));
    for (let i = 0; i < len; i++) this.excite[i] = (2 * this.rng() - 1) * amp;
    this.exciteLen = len;
    this.excitePos = 0;
    this.tracker = Math.max(this.vel * 0.5, 0.01);
  }

  noteOff(): void {
    this.gate = false;
    this.updateLoop();
  }

  private updateLoop(): void {
    const n = this.sr / this.freq;
    this.periodN = n;
    const w = (TWO_PI * this.freq) / this.sr;
    let fc = Math.min(15000 * Math.pow(1200 / 15000, clamp(this.damp, 0, 1)), this.sr * 0.45);
    // A bowed string loses more to internal friction than a plucked
    // one, and the source spectrum gate needs the loop itself to tilt:
    // cap the loop cutoff while bowed. The phase compensation below
    // absorbs the cap, so pitch is unaffected.
    if (this.bow > 0) fc = Math.min(fc, BOW_LOOP_FC_CAP);
    const a = 1 - Math.exp((-TWO_PI * fc) / this.sr);
    this.lpA = a;
    this.lpB = 1 - a;
    // Dispersion allpasses need their pole near z = 1 (negative c) so
    // the phase delay actually varies across the partials; a pole far
    // from the circle is flat there and detunes nothing. The chain's
    // bulk delay is compensated at the fundamental, so if it would eat
    // the whole loop on a high note, the coefficient is relaxed until
    // enough delay is left.
    this.apC = -0.9 * Math.pow(clamp(this.dispersion, 0, 1), 0.3);
    let pd =
      onePolePhaseDelay(a, w) +
      dcBlockerPhaseDelay(this.dcR, w) +
      DISPERSION_STAGES * allpassPhaseDelay(this.apC, w);
    while (n - 1 - pd < 4 && this.apC < -1e-3) {
      this.apC *= 0.7;
      pd =
        onePolePhaseDelay(a, w) +
        dcBlockerPhaseDelay(this.dcR, w) +
        DISPERSION_STAGES * allpassPhaseDelay(this.apC, w);
    }
    this.readDelay = Math.max(1, n - 1 - pd);
    if (this.pol2) {
      // Second polarization: one pole damping and dc blocker, no
      // dispersion chain, detuned sharp by polDetune cents.
      const a2 = 1 - Math.exp((-TWO_PI * Math.min(POL_LP_FC, this.sr * 0.45)) / this.sr);
      this.polLpA = a2;
      this.polLpB = 1 - a2;
      const pd2 = onePolePhaseDelay(a2, w) + dcBlockerPhaseDelay(this.dcR, w);
      const det = Math.pow(2, clamp(this.polDetune, 0, 50) / 1200);
      this.pol2Read = Math.max(1, n / det - 1 - pd2);
    }
    const t60 = this.gate ? 0.3 * Math.pow(40, clamp(this.sustain, 0, 1)) : RELEASE_T60;
    // Loop loss is met once per period, so the per pass gain is set
    // against the period count in t60 seconds.
    this.gs = Math.pow(10, -3 / (t60 * this.freq));
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    if (this.bodyDirty) {
      this.computeBody();
      this.bodyDirty = false;
    }
    const level = this.level;
    const bowAmt = clamp(this.bow, 0, 1);
    // Dynamics coupling: velocity swings bow speed across 0.35 to 0.8
    // and nudges pressure, so loud notes are brighter, not just louder.
    const dyn = clamp(this.dynamics, 0, 1);
    const speedEff =
      clamp(this.bowSpeed, 0, 1) * (1 - dyn) + (0.35 + 0.45 * this.vel) * dyn;
    const bowVel = 0.05 + 0.25 * clamp(speedEff, 0, 1);
    const pressure = clamp(clamp(this.bowPressure, 0, 1) + dyn * 0.15 * (this.vel - 0.5), 0, 1);
    // STK pressure to friction slope mapping: firm bow, low slope
    const slope = 5 - 4 * pressure;
    const bite = clamp(this.attackBite, 0, 1);
    // bow position comb: the injected force cancels itself one round
    // trip to the near bridge later (2 * bowPos periods)
    const combDelay = 2 * clamp(this.bowPos, 0.02, 0.45) * this.periodN;
    const usePol = this.pol2 !== null && this.polDetune > 0;
    // Rosin noise level: proportional to bow speed, relatively more
    // prominent under a light bow.
    const nSusAmt = clamp(this.bowNoise, 0, 1) * bowVel * (0.05 + 0.1 * (1 - pressure));
    // Break-away burst level, gated by the 30 ms bite envelope.
    const nAttAmt = bite * bowVel * (0.5 + pressure) * 0.3;
    const bodyMix = clamp(this.body, 0, 1);
    const useBody = bodyMix > 0;
    const depthCents = clamp(this.vibDepth, 0, 50);
    const useVib = depthCents > 0;
    const vibInc = (TWO_PI * clamp(this.vibRate, 0, 20)) / this.sr;
    const onsetT = Math.max(0, this.vibOnset);
    const c = this.apC;
    for (let i = from; i < to; i++) {
      // One white sample per frame feeds both the rosin noise lowpass
      // and the vibrato drift walk, so renders that differ only in the
      // new params share the same underlying noise.
      const white = 2 * this.rng() - 1;
      let delta = 0;
      if (useVib) {
        this.driftState += this.driftA * (white - this.driftState);
        const drift = clamp(this.driftState * this.driftScale, -1, 1);
        // the rate ramps from 0.9x to 1.05x over the first second: a
        // player's vibrato widens into the note
        const rateRamp = 0.9 + 0.15 * Math.min(this.ageSec, 1);
        this.vibPhase += vibInc * rateRamp * (1 + 0.08 * drift);
        if (this.vibPhase > TWO_PI) this.vibPhase -= TWO_PI;
        // raised cosine onset ramp: no vibrato inside the attack
        const tt = this.ageSec - onsetT;
        const onset = tt <= 0 ? 0 : tt >= VIB_RAMP_SEC ? 1 : 0.5 * (1 - Math.cos((Math.PI * tt) / VIB_RAMP_SEC));
        const d = depthCents * (1 + 0.2 * drift) * onset;
        // VIB_ASYM shifts the modulation center below the note: the
        // positive delay offset reads the loop long, so the mean pitch
        // dips under nominal by 0.3 of the depth
        delta = this.readDelay * d * CENTS_TO_RATIO * (Math.sin(this.vibPhase) + VIB_ASYM);
      }
      if (bowAmt > 0 && this.settleEnv > 1e-4) {
        // pitch settle: the note starts settleCents off (usually
        // sharp) and locks exponentially over about 120 ms
        this.settleEnv *= this.settleCoef;
        delta -= this.readDelay * this.settleCents * CENTS_TO_RATIO * this.settleEnv;
      }
      const y = this.delay.readCubic(this.readDelay + delta);
      // loop damping
      this.lpState = this.lpA * y + this.lpB * this.lpState;
      // dc blocker
      let f = this.lpState - this.dcX1 + this.dcR * this.dcY1;
      this.dcX1 = this.lpState;
      this.dcY1 = f;
      // dispersion allpasses
      for (let s = 0; s < DISPERSION_STAGES; s++) {
        const yy = c * f + this.apX1[s] - c * this.apY1[s];
        this.apX1[s] = f;
        this.apY1[s] = yy;
        f = yy;
      }
      let sIn = f * this.gs;
      let ex = 0;
      if (this.excitePos < this.exciteLen) {
        ex = this.excite[this.excitePos++];
        sIn += ex;
      }
      let inj = 0;
      if (bowAmt > 0) {
        if (this.gate) {
          this.bowEnv += this.bowUpStep;
          if (this.bowEnv > 1) this.bowEnv = 1;
        } else {
          this.bowEnv -= this.bowDownStep;
          if (this.bowEnv < 0) this.bowEnv = 0;
        }
        if (this.bowEnv > 0) {
          this.noiseLP += this.noiseA * (white - this.noiseLP);
          this.biteEnv *= this.biteCoef;
          // Raised sticking at onset: the bite envelope lowers the
          // slope so the string breaks away late and scratches before
          // locking into Helmholtz motion.
          const slopeEff = slope * (1 - 0.35 * bite * this.biteEnv);
          const noiseSus = nSusAmt * this.noiseLP;
          const noiseAtt = nAttAmt * this.biteEnv * this.noiseLP;
          const noise = noiseSus + noiseAtt;
          // Pre-Helmholtz jitter: the 30 to 80 Hz walk (fed by the
          // same white sample) wobbles the bow velocity through the
          // attack, scaled by attackBite and the per note draw.
          this.jitEnv *= this.jitCoef;
          this.jitLpF += this.jitAF * (white - this.jitLpF);
          this.jitLpS += this.jitAS * (white - this.jitLpS);
          const walk = clamp((this.jitLpF - this.jitLpS) * this.jitNorm, -1.5, 1.5);
          const jit = 1 + JITTER_AMT * bite * this.jitScale * this.jitEnv * walk;
          const bowVelInst = bowVel * this.bowEnv * jit + noise;
          const dv = bowVelInst - y;
          const t = bowTable(dv, slopeEff);
          // Friction force is mu(dv) times the normal force: pressure
          // scales the transmissible force as well as the table slope,
          // so a feather bow genuinely starves the string.
          const nForce = BOW_NFORCE_LO + BOW_NFORCE_SPAN * pressure;
          // tanh bounds only the injected term, not the recirculating
          // wave, as a cheap torsional loss surrogate. The second term
          // is the force-side share of the junction noise: the table
          // value gates it by stick state so it pulses with the slip
          // cycle instead of overlaying the output as plain hiss.
          const force = Math.tanh(dv * t * nForce * BOW_JUNCTION_GAIN) * bowAmt;
          // bow hair compliance: lowpass the injected friction force
          // only, never the recirculating wave. The junction noise
          // share keeps its own 6 kHz band (rosin hiss and attack
          // scratch live above the hair rolloff).
          this.bowLp += this.bowLpA * (force - this.bowLp);
          // Bow position comb: the near bridge reflection of the
          // injected force returns inverted one bridge round trip
          // (2 * bowPos periods) later and cancels the harmonics near
          // 1 / bowPos. Normalized by 1 / (1 + depth) so the comb only
          // carves nulls and never boosts the in-phase bands (an
          // unnormalized comb doubles the mid harmonics, which feeds
          // the raucous low pressure regime and destabilizes the
          // period); COMB_MAKEUP restores the injection level. The
          // junction noise share skips the comb: it is broadband, and
          // combing it would only dull the rosin floor and the bite.
          inj =
            (this.bowLp - COMB_DEPTH * this.forceDelay.readCubic(combDelay)) * COMB_NORM +
            (noiseSus * NOISE_FORCE_GAIN + noiseAtt * BITE_FORCE_GAIN) *
              t *
              this.bowEnv *
              bowAmt;
          this.forceDelay.write(this.bowLp);
          sIn += inj;
        }
      }
      this.delay.write(sIn);
      let o = sIn;
      if (usePol) {
        // Second polarization: a plain damped loop a hair sharp,
        // kicked by the same excitation burst as the main loop and fed
        // a sliver of the bow force, mixed about 6 dB down. The
        // friction locks the main loop to one period; this loop is not
        // under the bow's servo, so the burst keeps ringing at its own
        // detuned frequency, and the beat against the locked tone is
        // the slow sustain undulation of a real string.
        const y2 = this.pol2!.readCubic(this.pol2Read);
        this.polLp = this.polLpA * y2 + this.polLpB * this.polLp;
        const f2 = this.polLp - this.polDcX1 + this.dcR * this.polDcY1;
        this.polDcX1 = this.polLp;
        this.polDcY1 = f2;
        const s2 =
          f2 * this.gs + (POL_COUPLE + POL_ATT * this.settleEnv) * inj + POL_KICK * ex;
        this.pol2!.write(s2);
        o += POL_MIX * s2;
      }
      if (useBody) {
        const x = o;
        let wet = 0;
        for (let k = 0; k < TOTAL_MODES; k++) {
          const yk = this.bodyB0[k] * x + this.bodyZ1[k];
          this.bodyZ1[k] = this.bodyZ2[k] - this.bodyA1[k] * yk;
          this.bodyZ2[k] = -this.bodyB0[k] * x - this.bodyA2[k] * yk;
          wet += this.bodyGain[k] * yk;
        }
        o = (1 - bodyMix) * x + bodyMix * (BODY_DRY * x + BODY_MAKEUP * wet);
      }
      o *= level;
      outL[i] += o;
      outR[i] += o;
      this.ageSec += this.ageStep;
      const as = Math.abs(sIn);
      this.tracker = as > this.tracker ? as : this.tracker * this.trackCoef;
    }
    if (!this.gate && this.tracker < SILENCE && this.excitePos >= this.exciteLen) this.live = false;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'damp':
        this.damp = value;
        if (this.live) this.updateLoop();
        break;
      case 'sustain':
        this.sustain = value;
        if (this.live) this.updateLoop();
        break;
      case 'dispersion':
        this.dispersion = value;
        if (this.live) this.updateLoop();
        break;
      case 'bow':
        // the bowed loop cutoff cap depends on whether the bow is on
        this.bow = value;
        if (this.live) this.updateLoop();
        break;
      case 'bowPressure':
        this.bowPressure = value;
        break;
      case 'bowSpeed':
        this.bowSpeed = value;
        break;
      case 'level':
        this.level = value;
        break;
      case 'body':
        this.body = value;
        break;
      case 'bodySize':
        this.bodySize = value;
        this.bodyDirty = true;
        break;
      case 'bowNoise':
        this.bowNoise = value;
        break;
      case 'attackBite':
        this.attackBite = value;
        break;
      case 'vibRate':
        this.vibRate = value;
        break;
      case 'vibDepth':
        this.vibDepth = value;
        break;
      case 'vibOnset':
        this.vibOnset = value;
        break;
      case 'bowPos':
        this.bowPos = value;
        break;
      case 'dynamics':
        this.dynamics = value;
        break;
      case 'polDetune':
        // reuses the line preallocated at construction; if the key was
        // absent then, the second polarization stays silent
        this.polDetune = value;
        if (this.live) this.updateLoop();
        break;
    }
  }

  get active(): boolean {
    return this.live;
  }
}

const stringParams: ParamSpec[] = [
  { name: 'damp', min: 0, max: 1, default: 0.35 },
  { name: 'sustain', min: 0, max: 1, default: 0.6 },
  { name: 'dispersion', min: 0, max: 1, default: 0 },
  { name: 'bow', min: 0, max: 1, default: 0 },
  { name: 'bowPressure', min: 0, max: 1, default: 0.5 },
  { name: 'bowSpeed', min: 0, max: 1, default: 0.5 },
  { name: 'level', min: 0, max: 1, default: 0.9 },
  // Bowed realism params. All default to neutral so old presets and
  // params records keep their sound.
  { name: 'body', min: 0, max: 1, default: 0 },
  { name: 'bodySize', min: 0, max: 1, default: 0 },
  { name: 'bowNoise', min: 0, max: 1, default: 0 },
  { name: 'attackBite', min: 0, max: 1, default: 0 },
  { name: 'vibRate', min: 3, max: 9, default: 6.1, unit: 'Hz' },
  { name: 'vibDepth', min: 0, max: 50, default: 0, unit: 'cents' },
  { name: 'vibOnset', min: 0, max: 1, default: 0.3, unit: 's' },
  // Round two params. bowPos shapes only the bowed injection (0.06 is
  // ponticello glass, 0.2 is tasto flute); dynamics and polDetune
  // default to neutral so non-bowed behavior is untouched.
  { name: 'bowPos', min: 0.06, max: 0.2, default: 0.11 },
  { name: 'dynamics', min: 0, max: 1, default: 0 },
  { name: 'polDetune', min: 0, max: 5, default: 0, unit: 'cents' },
];

export const stringEngine: EngineDef = {
  id: 'string',
  label: 'Waveguide String',
  params: stringParams,
  polyphony: 12,
  createVoice: (sampleRate, initParams, rng) => new StringVoice(sampleRate, initParams, rng),
};

/* ------------------------------------------------------------------ */
/* Tube                                                                */
/* ------------------------------------------------------------------ */

class TubeVoice implements Voice {
  private readonly sr: number;
  private readonly delay: DelayLine;
  private readonly noise: NoiseGen;
  private readonly env: Adsr;

  private readDelay = 2;
  private prZ = 0;
  private vel = 1;
  private live = false;
  private tracker = 0;
  private readonly trackCoef: number;

  private breath: number;
  private noiseAmt: number;
  private level: number;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sr = sampleRate;
    const maxSamples = Math.ceil(sampleRate / (2 * MIN_FREQ)) + 4;
    this.delay = new DelayLine(maxSamples);
    this.noise = new NoiseGen(sampleRate, 'white', rng);
    this.env = new Adsr(sampleRate);
    this.env.set(0.02, 0.03, 1, 0.12);
    this.trackCoef = Math.exp(-1 / (TRACK_TAU * sampleRate));
    this.breath = p(params, 'breath', 0.85);
    this.noiseAmt = p(params, 'noise', 0.1);
    this.level = p(params, 'level', 0.7);
  }

  noteOn(freq: number, vel: number): void {
    const f = clamp(freq, MIN_FREQ, this.sr / 12);
    this.vel = clamp(vel, 0, 1);
    this.delay.clear();
    this.prZ = 0;
    this.env.reset();
    this.env.trigger();
    // Half period bore minus one sample write-to-read latency and the
    // half sample of the two point average reflection filter.
    this.readDelay = Math.max(1, this.sr / (2 * f) - 1.5);
    this.live = true;
    this.tracker = 0.01;
  }

  noteOff(): void {
    this.env.release();
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const level = this.level;
    const maxPressure = clamp(this.breath, 0, 1) * (0.6 + 0.4 * this.vel);
    const nAmt = clamp(this.noiseAmt, 0, 1) * 0.4;
    for (let i = from; i < to; i++) {
      const pr = this.delay.readLinear(this.readDelay);
      // reflection filter: two point average, inverting open end
      const refl = -0.95 * 0.5 * (pr + this.prZ);
      this.prZ = pr;
      let breathP = this.env.next() * maxPressure;
      breathP *= 1 + nAmt * this.noise.next();
      const pdiff = refl - breathP;
      const reed = clamp(0.7 - 0.3 * pdiff, -1, 1);
      const s = breathP + pdiff * reed;
      this.delay.write(s);
      const o = pr * level;
      outL[i] += o;
      outR[i] += o;
      const as = Math.abs(pr);
      this.tracker = as > this.tracker ? as : this.tracker * this.trackCoef;
    }
    if (!this.env.active && this.tracker < SILENCE) this.live = false;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'breath':
        this.breath = value;
        break;
      case 'noise':
        this.noiseAmt = value;
        break;
      case 'level':
        this.level = value;
        break;
    }
  }

  get active(): boolean {
    return this.live;
  }
}

const tubeParams: ParamSpec[] = [
  { name: 'breath', min: 0, max: 1, default: 0.85 },
  { name: 'noise', min: 0, max: 1, default: 0.1 },
  { name: 'level', min: 0, max: 1, default: 0.7 },
];

export const tubeEngine: EngineDef = {
  id: 'tube',
  label: 'Waveguide Tube',
  params: tubeParams,
  polyphony: 8,
  createVoice: (sampleRate, initParams, rng) => new TubeVoice(sampleRate, initParams, rng),
};
