/*
 * Shared helpers for the classic engine tests: block rendering through the
 * Voice contract, peak/rms measures, and Goertzel based band power for
 * cheap spectral sanity checks.
 */

import type { EngineDef, Voice } from '../../src/types';
import { rng } from '../../src/core/prng';

export const SR = 44100;

export interface RenderOpts {
  freq?: number;
  vel?: number;
  seconds?: number;
  /** noteOff time in seconds; at or past `seconds` means never released mid render. */
  offAt?: number;
  params?: Record<string, number>;
  seed?: string;
  block?: number;
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
  const voice = def.createVoice(SR, opts.params ?? {}, rng(opts.seed ?? 'test/' + def.id));
  voice.noteOn(opts.freq ?? 220, opts.vel ?? 1);
  const offAt = Math.min(n, Math.round((opts.offAt ?? seconds * 0.6) * SR));
  const block = opts.block ?? 128;
  let i = 0;
  let released = false;
  while (i < n) {
    let to = Math.min(i + block, n);
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
 * Render two voices into one shared bus with the same block splits as
 * render(), so the result is comparable sample by sample against the sum
 * of two solo renders.
 */
export function renderPair(
  def: EngineDef,
  freq1: number,
  freq2: number,
  seed1: string,
  seed2: string,
  opts: RenderOpts = {},
): { l: Float32Array; r: Float32Array } {
  const seconds = opts.seconds ?? 0.5;
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const v1 = def.createVoice(SR, opts.params ?? {}, rng(seed1));
  const v2 = def.createVoice(SR, opts.params ?? {}, rng(seed2));
  v1.noteOn(freq1, opts.vel ?? 1);
  v2.noteOn(freq2, opts.vel ?? 1);
  const offAt = Math.min(n, Math.round((opts.offAt ?? seconds * 0.6) * SR));
  const block = opts.block ?? 128;
  let i = 0;
  let released = false;
  while (i < n) {
    let to = Math.min(i + block, n);
    if (!released && i < offAt && offAt < to) to = offAt;
    v1.process(l, r, i, to);
    v2.process(l, r, i, to);
    if (!released && to >= offAt) {
      v1.noteOff();
      v2.noteOff();
      released = true;
    }
    i = to;
  }
  return { l, r };
}

export function peak(buf: Float32Array): number {
  let m = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > m) m = a;
  }
  return m;
}

export function hasBadSamples(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (!Number.isFinite(buf[i])) return true;
  }
  return false;
}

export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let acc = 0;
  for (let i = from; i < to; i++) acc += buf[i] * buf[i];
  return Math.sqrt(acc / Math.max(1, to - from));
}

/** Normalized power at one frequency via Goertzel over [from, to). */
export function tonePower(
  buf: Float32Array,
  hz: number,
  from = 0,
  to = buf.length,
  sampleRate = SR,
): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = buf[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const n = to - from;
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (n * n);
}

/** Summed Goertzel power over log spaced probe frequencies in [lo, hi]. */
export function bandPower(
  buf: Float32Array,
  lo: number,
  hi: number,
  from = 0,
  to = buf.length,
  steps = 24,
): number {
  let acc = 0;
  for (let s = 0; s < steps; s++) {
    const hz = lo * Math.pow(hi / lo, s / (steps - 1));
    acc += tonePower(buf, hz, from, to);
  }
  return acc;
}

export function zeroCrossings(buf: Float32Array, from = 0, to = buf.length): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) count++;
  }
  return count;
}

export function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}
