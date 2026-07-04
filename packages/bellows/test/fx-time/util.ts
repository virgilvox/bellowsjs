/* Shared helpers for the time-based effect tests. */

import type { Effect } from '../../src/types';

/** Process a stereo pair through an effect in uneven blocks, like the kernel would. */
export function processBlocks(fx: Effect, l: Float32Array, r: Float32Array, block = 128): void {
  const n = l.length;
  let i = 0;
  while (i < n) {
    const to = Math.min(i + block, n);
    fx.process(l, r, i, to);
    i = to;
  }
}

/** Stereo impulse response over n samples. */
export function impulseResponse(fx: Effect, n: number): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  l[0] = 1;
  r[0] = 1;
  processBlocks(fx, l, r);
  return { l, r };
}

export function rms(a: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function db(x: number): number {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

export function maxAbs(a: Float32Array, from: number, to: number): number {
  let m = 0;
  for (let i = from; i < to; i++) {
    const v = Math.abs(a[i]);
    if (v > m) m = v;
  }
  return m;
}

export function argmaxAbs(a: Float32Array, from: number, to: number): number {
  let m = -1;
  let at = from;
  for (let i = from; i < to; i++) {
    const v = Math.abs(a[i]);
    if (v > m) {
      m = v;
      at = i;
    }
  }
  return at;
}

/** Largest absolute sample-to-sample step, a click detector. */
export function maxStep(a: Float32Array, from: number, to: number): number {
  let m = 0;
  for (let i = Math.max(from, 1); i < to; i++) {
    const v = Math.abs(a[i] - a[i - 1]);
    if (v > m) m = v;
  }
  return m;
}

export function allFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

/** Normalized zero-lag cross correlation over [from, to). */
export function correlation(a: Float32Array, b: Float32Array, from: number, to: number): number {
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = from; i < to; i++) {
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
    sab += a[i] * b[i];
  }
  return sab / Math.sqrt(saa * sbb + 1e-30);
}

/** Mean absolute first difference over rms: a crude brightness measure. */
export function roughness(a: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from + 1; i < to; i++) s += Math.abs(a[i] - a[i - 1]);
  const level = rms(a, from, to);
  return s / Math.max(1, to - from - 1) / Math.max(level, 1e-12);
}
