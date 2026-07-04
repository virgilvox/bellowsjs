/*
 * Shared helpers for the sampler tests: synthesized sine zones, block
 * rendering through the Voice contract, an autocorrelation pitch
 * estimator with parabolic refinement, and simple level measures.
 */

import type { EngineDef, Voice } from '../../src/types';
import type { SampleZone } from '../../src/engines/sampler';
import { rng } from '../../src/core/prng';

export const SR = 44100;

export function sineBuffer(freq: number, seconds: number, sampleRate = SR, amp = 0.8): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(w * i);
  return out;
}

/** A zone playing a synthesized sine, 440 Hz at rootKey 69 by default. */
export function sineZone(overrides: Partial<SampleZone> = {}): SampleZone {
  return {
    data: sineBuffer(440, 1),
    sampleRate: SR,
    rootKey: 69,
    keyLo: 0,
    keyHi: 127,
    velLo: 0,
    velHi: 127,
    loopMode: 'none',
    ...overrides,
  };
}

export interface RenderOpts {
  freq?: number;
  vel?: number;
  seconds?: number;
  /** noteOff time in seconds; at or past `seconds` means never released. */
  offAt?: number;
  params?: Record<string, number>;
  seed?: string;
  voice?: Voice;
}

export interface Rendered {
  l: Float32Array;
  r: Float32Array;
  voice: Voice;
}

export function render(def: EngineDef, opts: RenderOpts = {}): Rendered {
  const seconds = opts.seconds ?? 0.5;
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const voice =
    opts.voice ?? def.createVoice(SR, opts.params ?? {}, rng(opts.seed ?? 'test/' + def.id));
  voice.noteOn(opts.freq ?? 440, opts.vel ?? 1);
  const offAt = Math.min(n, Math.round((opts.offAt ?? seconds * 2) * SR));
  let i = 0;
  let released = false;
  while (i < n) {
    let to = Math.min(i + 128, n);
    if (!released && i < offAt && offAt < to) to = offAt;
    voice.process(l, r, i, to);
    if (!released && to >= offAt) {
      voice.noteOff();
      released = true;
    }
    i = to;
  }
  return { l, r, voice };
}

/**
 * Fundamental estimate by normalized autocorrelation over lags spanning
 * [fmin, fmax], refined with parabolic interpolation of the peak.
 */
export function estimatePitch(
  buf: Float32Array,
  sampleRate = SR,
  fmin = 100,
  fmax = 2000,
  from = 2048,
  len = 8192,
): number {
  const maxLag = Math.floor(sampleRate / fmin);
  const minLag = Math.max(2, Math.floor(sampleRate / fmax));
  if (from + len + maxLag > buf.length) {
    throw new Error('estimatePitch: buffer too short for the requested window');
  }
  const scores = new Float64Array(maxLag + 2);
  let bestLag = minLag;
  let bestR = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < len; i++) {
      const a = buf[from + i];
      const b = buf[from + i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const r = num / Math.sqrt(e1 * e2 + 1e-20);
    scores[lag] = r;
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
    }
  }
  /*
   * A tone correlates at every multiple of its period, and an integer lag
   * can land closer to a higher multiple than to the period itself (440 Hz
   * at 44100: lag 401 is 0.09 off four periods, lag 100 is 0.23 off one).
   * Take the first local maximum within tolerance of the global best so
   * the fundamental beats its subharmonics.
   */
  let lag = bestLag;
  const floor = bestR - 0.01;
  for (let k = minLag + 1; k < maxLag; k++) {
    if (scores[k] >= floor && scores[k] >= scores[k - 1] && scores[k] >= scores[k + 1]) {
      lag = k;
      break;
    }
  }
  const yc = scores[lag];
  const y0 = lag > minLag ? scores[lag - 1] : yc;
  const y2 = lag < maxLag ? scores[lag + 1] : yc;
  const denom = y0 - 2 * yc + y2;
  const d = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return sampleRate / (lag + d);
}

export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let acc = 0;
  for (let i = from; i < to; i++) acc += buf[i] * buf[i];
  return Math.sqrt(acc / Math.max(1, to - from));
}

export function peak(buf: Float32Array, from = 0, to = buf.length): number {
  let m = 0;
  for (let i = from; i < to; i++) {
    const a = Math.abs(buf[i]);
    if (a > m) m = a;
  }
  return m;
}

/** Largest sample-to-sample step over [from, to). Clicks show up here. */
export function maxDelta(buf: Float32Array, from = 0, to = buf.length): number {
  let m = 0;
  for (let i = from + 1; i < to; i++) {
    const d = Math.abs(buf[i] - buf[i - 1]);
    if (d > m) m = d;
  }
  return m;
}

export function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

export function hasBadSamples(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (!Number.isFinite(buf[i])) return true;
  }
  return false;
}
