/*
 * Feedback delay network reverb. Eight delay lines feed back through the
 * Householder reflection H = I - (2/N) v v^T with v = ones, which is
 * orthogonal (energy preserving) and applies in O(N): every line output
 * loses twice the mean of all outputs.
 *
 * Line lengths come from a millisecond table scaled by the size param
 * and snapped to the nearest prime, so the lengths stay mutually prime
 * and echo periods never align. Loop gain per line follows the RT60
 * rule g_i = 10^(-3 L_i / (rt60 sr)), so every path loses 60 dB in the
 * configured decay time regardless of its length. Per line one pole
 * lowpasses shorten the decay of highs (damp, in Hz), slow sine Lfos
 * wobble the read positions a few samples (chorus) to break up metallic
 * ringing, and four serial allpasses diffuse the input.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp } from '../types';
import { DelayLine } from '../dsp/delayline';
import { Smoother } from '../dsp/envelopes';
import { OnePole } from '../dsp/filters';
import { Lfo } from '../dsp/lfo';

const N = 8;
/** Base line lengths in milliseconds at size 1. Snapped to primes in samples. */
const BASE_MS = [23.9, 26.6, 29.8, 32.8, 36.6, 40.7, 44.9, 49.6];
/** Input diffuser lengths in milliseconds. */
const DIFF_MS = [3.1, 4.3, 5.9, 7.9];
const DIFF_G = 0.625;
/** Read position modulation depth in samples at chorus 1. */
const MOD_SAMPLES = 5;
/** Per line modulation rates in Hz, spread so wobbles never phase lock. */
const MOD_HZ = [0.53, 0.71, 0.89, 1.07, 1.19, 0.61, 0.97, 1.31];
const SIZE_MAX = 3;
const PREDELAY_MAX = 0.25;

const FDN_PARAMS: ParamSpec[] = [
  { name: 'size', min: 0.25, max: SIZE_MAX, default: 1 },
  { name: 'decay', min: 0.1, max: 20, default: 2, curve: 'exp', unit: 's' },
  { name: 'damp', min: 500, max: 20000, default: 6000, curve: 'exp', unit: 'Hz' },
  { name: 'chorus', min: 0, max: 1, default: 0.3 },
  { name: 'predelay', min: 0, max: PREDELAY_MAX, default: 0.01, curve: 'lin', unit: 's' },
  { name: 'mix', min: 0, max: 1, default: 0.35 },
];

/**
 * In-place Householder reflection for v = ones: y = x - (2/n) sum(x).
 * Orthogonal for any length, so it preserves the vector's energy.
 */
export function householderReflect(v: Float32Array): void {
  const n = v.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += v[i];
  s *= 2 / n;
  for (let i = 0; i < n; i++) v[i] -= s;
}

/** Schroeder allpass on a DelayLine, used for input diffusion. */
class Allpass {
  private readonly dl: DelayLine;
  private readonly len: number;
  private readonly g: number;

  constructor(lenSamples: number, g: number) {
    this.len = Math.max(1, lenSamples | 0);
    this.dl = new DelayLine(this.len + 4);
    this.g = g;
  }

  next(x: number): number {
    const z = this.dl.readInt(this.len - 1);
    const v = x + this.g * z;
    this.dl.write(v);
    return z - this.g * v;
  }

  reset(): void {
    this.dl.clear();
  }
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

/** Nearest prime to n (ties resolve downward). Control rate only. */
function nearestPrime(n: number): number {
  let m = Math.max(2, Math.round(n));
  if (isPrime(m)) return m;
  for (let k = 1; ; k++) {
    if (m - k >= 2 && isPrime(m - k)) return m - k;
    if (isPrime(m + k)) return m + k;
  }
}

class FdnReverb implements Effect {
  private readonly sampleRate: number;
  private readonly lines: DelayLine[] = [];
  private readonly damps: OnePole[] = [];
  private readonly lfos: Lfo[] = [];
  private readonly diffusers: Allpass[] = [];
  private readonly preLine: DelayLine;
  private readonly preSm: Smoother;
  private readonly lengths = new Float64Array(N);
  private readonly gains = new Float64Array(N);
  private readonly scratch = new Float32Array(N);
  private size = 1;
  private rt60 = 2;
  private modDepth = 0;
  private predelay = 0.01;
  private mix = 0.35;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    for (let i = 0; i < N; i++) {
      const cap = Math.ceil((BASE_MS[i] / 1000) * sampleRate * SIZE_MAX) + 64;
      this.lines.push(new DelayLine(cap));
      this.damps.push(new OnePole(sampleRate));
      const lfo = new Lfo(sampleRate);
      lfo.setFreq(MOD_HZ[i]);
      lfo.reset(i / N);
      this.lfos.push(lfo);
    }
    for (const ms of DIFF_MS) {
      this.diffusers.push(new Allpass(nearestPrime((ms / 1000) * sampleRate), DIFF_G));
    }
    this.preLine = new DelayLine(Math.ceil(PREDELAY_MAX * sampleRate) + 8);
    this.preSm = new Smoother(sampleRate, 0.05);
    applyParams(this, FDN_PARAMS, params);
    this.preSm.snap(this.predelay * sampleRate);
  }

  private updateLengths(): void {
    for (let i = 0; i < N; i++) {
      const target = (BASE_MS[i] / 1000) * this.sampleRate * this.size;
      this.lengths[i] = Math.min(nearestPrime(target), this.lines[i].maxDelay - MOD_SAMPLES - 4);
    }
    this.updateGains();
  }

  private updateGains(): void {
    for (let i = 0; i < N; i++) {
      this.gains[i] = Math.pow(10, (-3 * this.lengths[i]) / (this.rt60 * this.sampleRate));
    }
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'size':
        this.size = clamp(value, 0.25, SIZE_MAX);
        this.updateLengths();
        break;
      case 'decay':
        this.rt60 = clamp(value, 0.1, 20);
        this.updateGains();
        break;
      case 'damp': {
        const hz = clamp(value, 500, 20000);
        for (const d of this.damps) d.setLowpass(hz);
        break;
      }
      case 'chorus':
        this.modDepth = clamp(value, 0, 1) * MOD_SAMPLES;
        break;
      case 'predelay':
        this.predelay = clamp(value, 0, PREDELAY_MAX);
        this.preSm.setTarget(this.predelay * this.sampleRate);
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const mix = this.mix;
    const dry = 1 - mix;
    const s = this.scratch;
    for (let i = from; i < to; i++) {
      this.preLine.write(0.5 * (l[i] + r[i]));
      let x = this.preLine.readLinear(this.preSm.next());
      x = this.diffusers[3].next(
        this.diffusers[2].next(this.diffusers[1].next(this.diffusers[0].next(x))),
      );
      // Read every line, damp and scale, then reflect and write back.
      // Alternating signs across the L and R sums decorrelate the outputs.
      let wl = 0;
      let wr = 0;
      for (let k = 0; k < N; k++) {
        const mod = this.modDepth === 0 ? 0 : this.modDepth * this.lfos[k].next();
        const out = this.lines[k].readCubic(this.lengths[k] - 1 + mod);
        s[k] = this.damps[k].next(out) * this.gains[k];
        if (k & 1) wr += k & 2 ? -out : out;
        else wl += k & 2 ? -out : out;
      }
      householderReflect(s);
      for (let k = 0; k < N; k++) this.lines[k].write(s[k] + x);
      l[i] = dry * l[i] + mix * 0.35 * wl;
      r[i] = dry * r[i] + mix * 0.35 * wr;
    }
  }

  reset(): void {
    for (const line of this.lines) line.clear();
    for (const d of this.damps) d.reset();
    for (const ap of this.diffusers) ap.reset();
    for (let i = 0; i < N; i++) this.lfos[i].reset(i / N);
    this.preLine.clear();
    this.preSm.snap(this.predelay * this.sampleRate);
  }
}

/** Apply spec defaults, then caller overrides, through setParam. */
function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): void {
  for (const s of specs) fx.setParam(s.name, params[s.name] ?? s.default);
}

export const fdnDef: EffectDef = {
  id: 'fdn',
  label: 'FDN Reverb',
  params: FDN_PARAMS,
  create: (sampleRate, params) => new FdnReverb(sampleRate, params),
};
