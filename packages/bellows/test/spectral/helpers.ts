/*
 * Shared measurement helpers for the spectral tests: sine fixtures,
 * RMS, and DFT-based frequency and band-energy measurement.
 */

import { RealFft, hann } from '../../src/dsp/fft';
import type { Effect } from '../../src/types';

export function sine(
  freq: number,
  sampleRate: number,
  length: number,
  amp = 1,
  phase = 0
): Float32Array {
  const out = new Float32Array(length);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < length; i++) out[i] = amp * Math.sin(w * i + phase);
  return out;
}

export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function maxAbs(buf: Float32Array, from = 0, to = buf.length): number {
  let m = 0;
  for (let i = from; i < to; i++) {
    const a = Math.abs(buf[i]);
    if (a > m) m = a;
  }
  return m;
}

/**
 * Hann-windowed magnitude spectrum of the largest power-of-two segment
 * that fits at the end of [from, to). Returns the magnitudes and the
 * transform size used.
 */
export function magSpectrum(
  buf: Float32Array,
  from: number,
  to: number
): { mags: Float32Array; n: number } {
  let n = 1;
  while (n * 2 <= to - from) n *= 2;
  n = Math.min(n, 16384);
  const start = to - n;
  const w = hann(n);
  const seg = new Float32Array(n);
  for (let i = 0; i < n; i++) seg[i] = buf[start + i] * w[i];
  const fft = new RealFft(n);
  const nb = (n >> 1) + 1;
  const re = new Float32Array(nb);
  const im = new Float32Array(nb);
  fft.forward(seg, re, im);
  const mags = new Float32Array(nb);
  for (let k = 0; k < nb; k++) mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return { mags, n };
}

/**
 * Dominant frequency over [from, to) via the peak DFT bin refined with
 * parabolic interpolation on log magnitudes.
 */
export function dominantFreq(
  buf: Float32Array,
  sampleRate: number,
  from: number,
  to: number
): number {
  const { mags, n } = magSpectrum(buf, from, to);
  let best = 1;
  for (let k = 2; k < mags.length - 1; k++) {
    if (mags[k] > mags[best]) best = k;
  }
  const a = mags[best - 1];
  const b = mags[best];
  const c = mags[best + 1];
  let d = 0;
  if (a > 0 && b > 0 && c > 0) {
    const la = Math.log(a);
    const lb = Math.log(b);
    const lc = Math.log(c);
    const denom = la - 2 * lb + lc;
    if (Math.abs(denom) > 1e-12) d = (0.5 * (la - lc)) / denom;
  }
  return ((best + d) * sampleRate) / n;
}

/** Energy fraction of the spectrum inside [loHz, hiHz]. */
export function bandFraction(
  buf: Float32Array,
  sampleRate: number,
  loHz: number,
  hiHz: number,
  from: number,
  to: number
): number {
  const { mags, n } = magSpectrum(buf, from, to);
  const binHz = sampleRate / n;
  let inside = 0;
  let total = 0;
  for (let k = 1; k < mags.length; k++) {
    const e = mags[k] * mags[k];
    total += e;
    const f = k * binHz;
    if (f >= loHz && f <= hiHz) inside += e;
  }
  return total > 0 ? inside / total : 0;
}

/** Run a stereo in-place effect over the full buffers in fixed blocks. */
export function runFx(fx: Effect, l: Float32Array, r: Float32Array, block = 128): void {
  const len = Math.min(l.length, r.length);
  for (let at = 0; at < len; at += block) {
    fx.process(l, r, at, Math.min(at + block, len));
  }
}
