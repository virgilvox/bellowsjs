/*
 * Modal synthesis: a bank of up to 24 exponentially decaying two pole
 * resonators, y = 2 r cos(w) y1 - r^2 y2 + g x, excited by a short
 * strike burst.
 *
 * The material param picks a preset mode table (frequency ratios, per
 * mode gains, per mode decay scaling): 0 bar (free-free ratios),
 * 1 membrane (Bessel ratios), 2 bell (with the minor third partial at
 * 2.4), 3 glass, 4 wood. strikeHardness shortens and sharpens the
 * strike pulse (harder = brighter), brightness tilts mode gains around
 * the fundamental, decay scales every mode's T60, and noteOn frequency
 * scales the whole bank. Modes that would land above 0.45 fs are muted.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';

const MAX_MODES = 24;
const TWO_PI = Math.PI * 2;
/** ln(1000): converts T60 to a per sample radius. */
const T60_LN = 6.907755278982137;
const TRACK_TAU = 0.06;
const SILENCE = 1e-4;
/** Decay cap applied at noteOff, seconds. */
const RELEASE_T60 = 0.3;

interface Material {
  ratios: number[];
  gains: number[];
  /** Per mode T60 multiplier relative to the base decay. */
  decays: number[];
  /** Overall decay multiplier for the material. */
  decayBase: number;
}

const MATERIALS: Material[] = [
  {
    // Free-free bar transverse modes.
    ratios: [1, 2.756, 5.404, 8.933, 13.345, 18.638],
    gains: [1, 0.7, 0.45, 0.3, 0.18, 0.1],
    decays: [1, 0.7, 0.5, 0.35, 0.25, 0.18],
    decayBase: 1,
  },
  {
    // Circular membrane, Bessel zero ratios.
    ratios: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501],
    gains: [1, 0.8, 0.65, 0.5, 0.4, 0.32, 0.25, 0.2],
    decays: [1, 0.85, 0.7, 0.65, 0.55, 0.5, 0.45, 0.4],
    decayBase: 0.4,
  },
  {
    // Bell partials with the minor third at 2.4.
    ratios: [1, 2, 2.4, 3, 4.5, 5.33],
    gains: [1, 0.85, 0.6, 0.5, 0.3, 0.25],
    decays: [1, 0.8, 0.7, 0.55, 0.4, 0.35],
    decayBase: 1.8,
  },
  {
    // Glass: sparse, nearly undamped upper modes.
    ratios: [1, 2.32, 4.25, 6.63, 9.38],
    gains: [1, 0.55, 0.3, 0.18, 0.1],
    decays: [1, 0.75, 0.5, 0.35, 0.25],
    decayBase: 1.3,
  },
  {
    // Wood: fast decay, faster still in the upper modes.
    ratios: [1, 2.572, 4.644, 6.984, 9.723],
    gains: [1, 0.6, 0.35, 0.2, 0.12],
    decays: [1, 0.35, 0.18, 0.1, 0.06],
    decayBase: 0.12,
  },
];

function p(params: Record<string, number>, name: string, dflt: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

class ModalVoice implements Voice {
  private readonly sr: number;
  private readonly rng: NamedRng;

  // per mode coefficients and state
  private readonly c1 = new Float32Array(MAX_MODES);
  private readonly c2 = new Float32Array(MAX_MODES);
  private readonly g = new Float32Array(MAX_MODES);
  private readonly y1 = new Float32Array(MAX_MODES);
  private readonly y2 = new Float32Array(MAX_MODES);
  private modeCount = 0;

  private readonly strike: Float32Array;
  private strikeLen = 0;
  private strikePos = 0;

  private freq = 220;
  private vel = 1;
  private gate = false;
  private live = false;
  private tracker = 0;
  private readonly trackCoef: number;

  private material: number;
  private decaySec: number;
  private brightness: number;
  private strikeHardness: number;
  private level: number;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sr = sampleRate;
    this.rng = rng;
    this.strike = new Float32Array(Math.ceil(sampleRate * 0.006) + 2);
    this.trackCoef = Math.exp(-1 / (TRACK_TAU * sampleRate));
    this.material = p(params, 'material', 0);
    this.decaySec = p(params, 'decay', 2);
    this.brightness = p(params, 'brightness', 0.5);
    this.strikeHardness = p(params, 'strikeHardness', 0.6);
    this.level = p(params, 'level', 0.6);
  }

  noteOn(freq: number, vel: number): void {
    this.freq = clamp(freq, 20, this.sr * 0.4);
    this.vel = clamp(vel, 0, 1);
    this.gate = true;
    this.live = true;
    this.y1.fill(0);
    this.y2.fill(0);
    this.updateModes();

    // Raised cosine strike pulse, unit area, so mode amplitudes stay
    // comparable across hardness. Softer = longer = darker.
    const hard = clamp(this.strikeHardness, 0, 1);
    const durSec = 0.004 * Math.pow(0.0004 / 0.004, hard);
    const len = Math.max(2, Math.round(durSec * this.sr));
    const amp = (2 * this.vel) / len;
    for (let i = 0; i < len; i++) {
      const shape = 0.5 * (1 - Math.cos((TWO_PI * i) / len));
      const jitter = 1 + 0.25 * (2 * this.rng() - 1);
      this.strike[i] = shape * jitter * amp;
    }
    this.strikeLen = len;
    this.strikePos = 0;
    this.tracker = Math.max(this.vel, 0.01);
  }

  noteOff(): void {
    this.gate = false;
    // Cap decay so gated playing damps the tail.
    this.updateModes();
  }

  private updateModes(): void {
    const mat = MATERIALS[clamp(Math.floor(this.material), 0, MATERIALS.length - 1)];
    const tilt = 2 * (clamp(this.brightness, 0, 1) - 0.5);
    const count = Math.min(mat.ratios.length, MAX_MODES);
    this.modeCount = count;
    for (let k = 0; k < count; k++) {
      const f = this.freq * mat.ratios[k];
      if (f >= this.sr * 0.45) {
        this.c1[k] = 0;
        this.c2[k] = 0;
        this.g[k] = 0;
        continue;
      }
      const w = (TWO_PI * f) / this.sr;
      let t60 = clamp(this.decaySec, 0.05, 30) * mat.decayBase * mat.decays[k];
      if (!this.gate) t60 = Math.min(t60, RELEASE_T60);
      const r = Math.exp(-T60_LN / (t60 * this.sr));
      this.c1[k] = 2 * r * Math.cos(w);
      this.c2[k] = r * r;
      // sin(w) normalizes the two pole's resonant gain so the table
      // gain sets the ring amplitude directly.
      this.g[k] = mat.gains[k] * Math.pow(mat.ratios[k], tilt) * Math.sin(w);
    }
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const level = this.level;
    const count = this.modeCount;
    for (let i = from; i < to; i++) {
      const x = this.strikePos < this.strikeLen ? this.strike[this.strikePos++] : 0;
      let sum = 0;
      for (let k = 0; k < count; k++) {
        const y = this.c1[k] * this.y1[k] - this.c2[k] * this.y2[k] + this.g[k] * x;
        this.y2[k] = this.y1[k];
        this.y1[k] = y;
        sum += y;
      }
      const o = sum * level;
      outL[i] += o;
      outR[i] += o;
      const as = Math.abs(sum);
      this.tracker = as > this.tracker ? as : this.tracker * this.trackCoef;
    }
    if (this.tracker < SILENCE && this.strikePos >= this.strikeLen) this.live = false;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'material':
        this.material = value;
        if (this.live) this.updateModes();
        break;
      case 'decay':
        this.decaySec = value;
        if (this.live) this.updateModes();
        break;
      case 'brightness':
        this.brightness = value;
        if (this.live) this.updateModes();
        break;
      case 'strikeHardness':
        this.strikeHardness = value;
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

const params: ParamSpec[] = [
  { name: 'material', min: 0, max: 4, default: 0 },
  { name: 'decay', min: 0.05, max: 30, default: 2, curve: 'exp', unit: 's' },
  { name: 'brightness', min: 0, max: 1, default: 0.5 },
  { name: 'strikeHardness', min: 0, max: 1, default: 0.6 },
  { name: 'level', min: 0, max: 1, default: 0.6 },
];

export const modalEngine: EngineDef = {
  id: 'modal',
  label: 'Modal',
  params,
  polyphony: 16,
  createVoice: (sampleRate, initParams, rng) => new ModalVoice(sampleRate, initParams, rng),
};
