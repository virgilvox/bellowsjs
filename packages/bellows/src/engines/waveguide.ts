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

/** Bow friction curve: near 1 (stick) for small velocity difference, falling fast (slip). */
function bowTable(dv: number): number {
  const t = Math.pow(Math.abs(dv) * 2.5 + 0.75, -4);
  return t > 1 ? 1 : t;
}

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

  private damp: number;
  private sustain: number;
  private dispersion: number;
  private bow: number;
  private bowPressure: number;
  private bowSpeed: number;
  private level: number;

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
    this.damp = p(params, 'damp', 0.35);
    this.sustain = p(params, 'sustain', 0.6);
    this.dispersion = p(params, 'dispersion', 0);
    this.bow = p(params, 'bow', 0);
    this.bowPressure = p(params, 'bowPressure', 0.5);
    this.bowSpeed = p(params, 'bowSpeed', 0.5);
    this.level = p(params, 'level', 0.9);
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
    const w = (TWO_PI * this.freq) / this.sr;
    const fc = Math.min(15000 * Math.pow(1200 / 15000, clamp(this.damp, 0, 1)), this.sr * 0.45);
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
    const t60 = this.gate ? 0.3 * Math.pow(40, clamp(this.sustain, 0, 1)) : RELEASE_T60;
    // Loop loss is met once per period, so the per pass gain is set
    // against the period count in t60 seconds.
    this.gs = Math.pow(10, -3 / (t60 * this.freq));
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const level = this.level;
    const bowing = this.gate && this.bow > 0;
    const bowAmt = clamp(this.bow, 0, 1);
    const bowVel = 0.05 + 0.25 * clamp(this.bowSpeed, 0, 1);
    const bowForce = 0.5 + 2 * clamp(this.bowPressure, 0, 1);
    const c = this.apC;
    for (let i = from; i < to; i++) {
      const y = this.delay.readCubic(this.readDelay);
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
      if (this.excitePos < this.exciteLen) sIn += this.excite[this.excitePos++];
      if (bowing) {
        const dv = bowVel - y;
        sIn += dv * bowTable(dv) * bowForce * bowAmt;
        sIn = Math.tanh(sIn);
      }
      this.delay.write(sIn);
      const o = sIn * level;
      outL[i] += o;
      outR[i] += o;
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
        this.bow = value;
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
