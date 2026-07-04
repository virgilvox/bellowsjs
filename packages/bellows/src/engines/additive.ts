/*
 * Additive engine. Up to 32 sine partials with per partial level and
 * detune, an inharmonicity stretch, per partial exponential decay, and a
 * spectral morph between two stored frames.
 *
 * Param scheme:
 *   partial1..partial32   frame A levels (defaults form a sawtooth, 1/n)
 *   target1..target32     frame B levels (defaults form a pure sine)
 *   detune1..detune32     per partial detune in cents
 *   morph                 0 plays frame A, 1 plays frame B, linear between
 *   inharm                stretch factor B in f_n = f0 * n * sqrt(1 + B n^2)
 *   decay, rolloff        partial n decays with time constant
 *                         decay * pow(rolloff, n - 1), so higher partials
 *                         die faster when rolloff < 1
 *
 * The amp ADSR gates the whole sum (attack, sustain 1, release); tonal
 * evolution comes from the per partial decays. Partials at or above 0.45
 * of the sample rate are dropped at noteOn, so the count is bounded by
 * Nyquist. Output is normalized by the summed frame levels so dense
 * spectra do not clip.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { Adsr } from '../dsp/envelopes';

const MAX_PARTIALS = 32;
const TWO_PI = Math.PI * 2;
/** Partials must stay below this fraction of the sample rate. */
const FREQ_LIMIT = 0.45;

function buildParams(): ParamSpec[] {
  const specs: ParamSpec[] = [
    { name: 'morph', min: 0, max: 1, default: 0 },
    { name: 'inharm', min: 0, max: 0.02, default: 0 },
    { name: 'decay', min: 0.01, max: 20, default: 2, curve: 'exp', unit: 's' },
    { name: 'rolloff', min: 0.3, max: 1, default: 0.8 },
    { name: 'attack', min: 0, max: 10, default: 0.002, curve: 'exp', unit: 's' },
    { name: 'release', min: 0, max: 10, default: 0.3, curve: 'exp', unit: 's' },
    { name: 'gain', min: 0, max: 2, default: 1 },
  ];
  for (let n = 1; n <= MAX_PARTIALS; n++) {
    specs.push({ name: 'partial' + n, min: 0, max: 1, default: 1 / n });
    specs.push({ name: 'target' + n, min: 0, max: 1, default: n === 1 ? 1 : 0 });
    specs.push({ name: 'detune' + n, min: -100, max: 100, default: 0, unit: 'cents' });
  }
  return specs;
}

const PARAMS: ParamSpec[] = buildParams();

function fillDefaults(given: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of PARAMS) out[s.name] = given[s.name] !== undefined ? given[s.name] : s.default;
  return out;
}

class AdditiveVoice implements Voice {
  private readonly sampleRate: number;
  private readonly p: Record<string, number>;
  private readonly ampEnv: Adsr;

  private readonly phases = new Float64Array(MAX_PARTIALS);
  private readonly incs = new Float64Array(MAX_PARTIALS);
  private readonly levels = new Float64Array(MAX_PARTIALS);
  private readonly decState = new Float64Array(MAX_PARTIALS);
  private readonly decCoef = new Float64Array(MAX_PARTIALS);
  private count = 0;
  private norm = 1;
  private freq = 220;
  private vel = 1;

  constructor(sampleRate: number, params: Record<string, number>, _rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.p = fillDefaults(params);
    this.ampEnv = new Adsr(sampleRate);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    const p = this.p;
    this.ampEnv.set(p.attack, 0.01, 1, p.release);

    // frequencies, decay coefficients and Nyquist bound
    const limit = this.sampleRate * FREQ_LIMIT;
    const B = p.inharm;
    let count = 0;
    for (let n = 0; n < MAX_PARTIALS; n++) {
      const k = n + 1;
      const stretch = Math.sqrt(1 + B * k * k);
      const cents = p['detune' + k];
      const hz = this.freq * k * stretch * Math.pow(2, cents / 1200);
      if (hz >= limit) break;
      this.incs[n] = hz / this.sampleRate;
      const tau = p.decay * Math.pow(p.rolloff, n);
      this.decCoef[n] = Math.exp(-1 / (tau * this.sampleRate));
      count = n + 1;
    }
    this.count = count;

    // morphed levels and normalization
    const morph = clamp(p.morph, 0, 1);
    let sum = 0;
    for (let n = 0; n < count; n++) {
      const a = p['partial' + (n + 1)];
      const b = p['target' + (n + 1)];
      const lvl = a + (b - a) * morph;
      this.levels[n] = lvl;
      sum += lvl;
    }
    this.norm = (p.gain / Math.max(1, sum)) * this.vel;
  }

  noteOn(freq: number, vel: number): void {
    this.freq = freq;
    this.vel = vel;
    this.phases.fill(0);
    this.decState.fill(1);
    this.ampEnv.reset();
    this.ampEnv.trigger();
    this.apply();
  }

  noteOff(): void {
    this.ampEnv.release();
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.ampEnv.active) return;
    const count = this.count;
    const phases = this.phases;
    const incs = this.incs;
    const levels = this.levels;
    const decState = this.decState;
    const decCoef = this.decCoef;
    const norm = this.norm * Math.SQRT1_2;
    for (let i = from; i < to; i++) {
      let acc = 0;
      for (let n = 0; n < count; n++) {
        let ph = phases[n] + incs[n];
        if (ph >= 1) ph -= 1;
        phases[n] = ph;
        const d = decState[n];
        decState[n] = d * decCoef[n];
        acc += levels[n] * d * Math.sin(TWO_PI * ph);
      }
      const y = acc * norm * this.ampEnv.next();
      outL[i] += y;
      outR[i] += y;
    }
  }

  get active(): boolean {
    return this.ampEnv.active;
  }
}

export const additiveEngine: EngineDef = {
  id: 'additive',
  label: 'Additive',
  params: PARAMS,
  polyphony: 8,
  createVoice: (sampleRate, params, rng) => new AdditiveVoice(sampleRate, params, rng),
};
