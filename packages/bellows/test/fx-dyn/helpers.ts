/*
 * Local buffer and measurement helpers for the dynamics, EQ, and
 * saturator tests.
 */

import type { Effect } from '../../src/types';

export function sineBuf(
  n: number,
  freq: number,
  sampleRate: number,
  amp = 1,
  phase = 0,
): Float32Array {
  const out = new Float32Array(n);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(w0 * i + phase);
  return out;
}

/** Square wave whose rectified level is exactly amp at every sample. */
export function squareBuf(n: number, freq: number, sampleRate: number, amp = 1): Float32Array {
  const out = new Float32Array(n);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = Math.sin(w0 * i) >= 0 ? amp : -amp;
  return out;
}

/** Run an effect over the full buffers in fixed-size blocks. */
export function processBlocks(fx: Effect, l: Float32Array, r: Float32Array, block = 128): void {
  for (let i = 0; i < l.length; i += block) {
    fx.process(l, r, i, Math.min(i + block, l.length));
  }
}

export function maxAbs(buf: Float32Array, from = 0, to = buf.length): number {
  let m = 0;
  for (let i = from; i < to; i++) {
    const a = Math.abs(buf[i]);
    if (a > m) m = a;
  }
  return m;
}

export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let acc = 0;
  for (let i = from; i < to; i++) acc += buf[i] * buf[i];
  return Math.sqrt(acc / (to - from));
}

/**
 * Hann-windowed projection of buf[from, from + n) onto a complex tone.
 * A unit-amplitude sine at freq returns approximately 1.
 */
export function toneMag(
  buf: Float32Array,
  from: number,
  n: number,
  freq: number,
  sampleRate: number,
): number {
  let re = 0;
  let im = 0;
  let wsum = 0;
  const w0 = (2 * Math.PI * freq) / sampleRate;
  for (let k = 0; k < n; k++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * k) / n));
    const x = buf[from + k] * w;
    const th = w0 * (from + k);
    re += x * Math.cos(th);
    im -= x * Math.sin(th);
    wsum += w;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}

export function db(g: number): number {
  return 20 * Math.log10(g);
}

export function allFinite(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (!Number.isFinite(buf[i])) return false;
  }
  return true;
}
