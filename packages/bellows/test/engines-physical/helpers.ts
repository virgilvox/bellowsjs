/*
 * Shared measurement helpers for the physical and spectral engine tests.
 * Rendering drives an EngineDef voice the way the kernel would: noteOn,
 * add-into blocks of 128 frames, noteOff at the gate boundary.
 */

import type { EngineDef, Voice } from '../../src/types';
import { rng } from '../../src/core/prng';
import { RealFft, hann } from '../../src/dsp/fft';

export interface RenderOpts {
  seed?: string;
  freq?: number;
  vel?: number;
  params?: Record<string, number>;
  /** Total render length in seconds. Default 1. */
  seconds?: number;
  /** Gate hold time in seconds. Values >= seconds mean no noteOff. Default 60 percent. */
  gate?: number;
  sampleRate?: number;
}

export interface Rendered {
  l: Float32Array;
  r: Float32Array;
  sr: number;
  voice: Voice;
}

export function defaultParams(def: EngineDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of def.params) out[spec.name] = spec.default;
  return out;
}

export function renderVoice(def: EngineDef, opts: RenderOpts = {}): Rendered {
  const sr = opts.sampleRate ?? 44100;
  const seconds = opts.seconds ?? 1;
  const freq = opts.freq ?? 440;
  const vel = opts.vel ?? 1;
  const params = { ...defaultParams(def), ...(opts.params ?? {}) };
  const voice = def.createVoice(sr, params, rng(opts.seed ?? 'test'));
  for (const [name, value] of Object.entries(opts.params ?? {})) voice.setParam(name, value);

  const n = Math.round(seconds * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const gateSec = opts.gate ?? seconds * 0.6;
  const gateIdx = Math.min(n, Math.round(gateSec * sr));
  let offSent = gateIdx >= n;

  voice.noteOn(freq, vel);
  let i = 0;
  while (i < n) {
    const end = Math.min(i + 128, n);
    if (!offSent && gateIdx <= i) {
      voice.noteOff();
      offSent = true;
    }
    if (!offSent && gateIdx > i && gateIdx < end) {
      voice.process(l, r, i, gateIdx);
      voice.noteOff();
      offSent = true;
      voice.process(l, r, gateIdx, end);
    } else {
      voice.process(l, r, i, end);
    }
    i = end;
  }
  return { l, r, sr, voice };
}

export function mono(l: Float32Array, r: Float32Array): Float32Array {
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = 0.5 * (l[i] + r[i]);
  return out;
}

export function maxAbs(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

export function countNonFinite(x: Float32Array): number {
  let c = 0;
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) c++;
  return c;
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let acc = 0;
  for (let i = from; i < to; i++) acc += x[i] * x[i];
  return Math.sqrt(acc / Math.max(1, to - from));
}

export function countDiffs(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Math.abs(a.length - b.length) + 1;
  let c = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) c++;
  return c;
}

/** Goertzel amplitude of one frequency over [from, to). */
export function goertzel(
  x: Float32Array,
  sr: number,
  freq: number,
  from: number,
  to: number
): number {
  const n = to - from;
  const w = (2 * Math.PI * freq) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  return (2 * Math.sqrt(re * re + im * im)) / n;
}

/** Hann windowed magnitude spectrum of size/2+1 bins starting at sample `from`. */
export function magSpectrum(x: Float32Array, from: number, size: number): Float32Array {
  const fft = new RealFft(size);
  const w = hann(size);
  const inp = new Float32Array(size);
  for (let i = 0; i < size; i++) inp[i] = (from + i < x.length ? x[from + i] : 0) * w[i];
  const re = new Float32Array(size / 2 + 1);
  const im = new Float32Array(size / 2 + 1);
  fft.forward(inp, re, im);
  const mags = new Float32Array(size / 2 + 1);
  for (let i = 0; i < mags.length; i++) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

export function spectralCentroid(mags: Float32Array, sr: number, size: number): number {
  let num = 0;
  let den = 0;
  for (let i = 1; i < mags.length; i++) {
    const f = (i * sr) / size;
    num += f * mags[i];
    den += mags[i];
  }
  return den > 0 ? num / den : 0;
}

export function bandEnergy(
  mags: Float32Array,
  sr: number,
  size: number,
  f1: number,
  f2: number
): number {
  const b1 = Math.max(1, Math.round((f1 * size) / sr));
  const b2 = Math.min(mags.length - 1, Math.round((f2 * size) / sr));
  let acc = 0;
  for (let i = b1; i <= b2; i++) acc += mags[i] * mags[i];
  return acc;
}

/** Parabolic-interpolated peak frequency within [f1, f2]. */
export function peakFreq(
  mags: Float32Array,
  sr: number,
  size: number,
  f1: number,
  f2: number
): number {
  const b1 = Math.max(1, Math.round((f1 * size) / sr));
  const b2 = Math.min(mags.length - 2, Math.round((f2 * size) / sr));
  let best = b1;
  for (let i = b1; i <= b2; i++) if (mags[i] > mags[best]) best = i;
  const a = mags[best - 1];
  const b = mags[best];
  const c = mags[best + 1];
  const den = a - 2 * b + c;
  const delta = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return ((best + delta) * sr) / size;
}

export interface PeriodEstimate {
  freq: number;
  /** Normalized autocorrelation at the peak, 1 for perfectly periodic. */
  peak: number;
}

/** Autocorrelation period estimate around an expected frequency, parabolic refined. */
export function estimateFreq(
  x: Float32Array,
  sr: number,
  from: number,
  to: number,
  fExpected: number
): PeriodEstimate {
  const lagMin = Math.max(2, Math.floor(sr / (fExpected * 1.35)));
  const lagMax = Math.ceil(sr / (fExpected / 1.35));
  const n = Math.min(to - from - lagMax - 2, 4096);
  if (n < 64) throw new Error('estimateFreq window too short');
  const rs = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let acc = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = from; i < from + n; i++) {
      acc += x[i] * x[i + lag];
      e1 += x[i] * x[i];
      e2 += x[i + lag] * x[i + lag];
    }
    rs[lag] = acc / Math.sqrt(e1 * e2 + 1e-30);
  }
  let best = lagMin;
  for (let lag = lagMin; lag <= lagMax; lag++) if (rs[lag] > rs[best]) best = lag;
  const a = rs[best - 1];
  const b = rs[best];
  const c = rs[best + 1];
  const den = a - 2 * b + c;
  const delta = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return { freq: sr / (best + delta), peak: b };
}

export function cents(f: number, ref: number): number {
  return 1200 * Math.log2(f / ref);
}
