/*
 * Chroma vectors and key estimation.
 *
 * chromaFromSpectrum folds a magnitude spectrum into twelve pitch class
 * bins. Each bin is mapped through the log-frequency (equal temperament)
 * scale, pc = round(69 + 12 log2(f / 440)) mod 12 with C = 0, and
 * contributes its power (magnitude squared). Bins below 60 Hz are
 * ignored because their pitch class is unreliable at STFT resolution;
 * bins above 5 kHz are ignored to keep inharmonic treble out. The
 * result is normalized to unit maximum.
 *
 * keyEstimate is Krumhansl-Schmuckler: Pearson correlation of the
 * chroma vector against the 24 rotations of the standard major and
 * minor probe-tone profiles. confidence is the winning correlation
 * coefficient (typically 0.5 to 0.95 for clearly tonal input).
 */

import type { Analyzer } from '../types';
import { RealFft, hann } from '../dsp/fft';

export type KeyMode = 'major' | 'minor';

export interface KeyResult {
  /** Pitch class of the tonic, 0 = C .. 11 = B. */
  key: number;
  mode: KeyMode;
  /** Pearson correlation of the winning profile, higher is more certain. */
  confidence: number;
}

export interface ChromaOptions {
  /** STFT frame length, power of two. Default 4096. */
  frameSize?: number;
  /** STFT hop in samples. Default 2048. */
  hop?: number;
}

/** Krumhansl-Kessler major profile, C first. */
export const MAJOR_PROFILE: readonly number[] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

/** Krumhansl-Kessler minor profile, tonic first. */
export const MINOR_PROFILE: readonly number[] = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const MIN_HZ = 60;
const MAX_HZ = 5000;

/**
 * Fold a magnitude spectrum of size/2 + 1 bins into a 12-bin chroma
 * vector, normalized to unit maximum. Pass out to avoid allocation.
 */
export function chromaFromSpectrum(
  mag: Float32Array,
  sampleRate: number,
  out?: Float32Array,
): Float32Array {
  const chroma = out ?? new Float32Array(12);
  chroma.fill(0);
  const fftSize = (mag.length - 1) * 2;
  const binHz = sampleRate / fftSize;
  const kLo = Math.max(1, Math.ceil(MIN_HZ / binHz));
  const kHi = Math.min(mag.length - 1, Math.floor(MAX_HZ / binHz));
  for (let k = kLo; k <= kHi; k++) {
    const f = k * binHz;
    const midi = 69 + 12 * Math.log2(f / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += mag[k] * mag[k];
  }
  let max = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
  if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

/**
 * Push-based chroma. Accumulates unnormalized chroma over every STFT
 * frame since the last poll; poll returns the normalized mean as a
 * fresh 12-element array (control rate, allocation acceptable), or
 * null when no frame completed since the last poll.
 */
export class ChromaAnalyzer implements Analyzer {
  private readonly sampleRate: number;
  private readonly frameSize: number;
  private readonly hop: number;
  private readonly fft: RealFft;
  private readonly window: Float32Array;
  private readonly ring: Float32Array;
  private readonly fftIn: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly mag: Float32Array;
  private readonly accum: Float64Array;
  private writePos = 0;
  private totalSamples = 0;
  private nextFrameAt: number;
  private frames = 0;

  constructor(sampleRate: number, opts: ChromaOptions = {}) {
    this.sampleRate = sampleRate;
    this.frameSize = opts.frameSize ?? 4096;
    this.hop = opts.hop ?? 2048;
    if ((this.frameSize & (this.frameSize - 1)) !== 0) {
      throw new Error('ChromaAnalyzer frameSize must be a power of two');
    }
    if (this.hop < 1 || this.hop > this.frameSize) {
      throw new Error('ChromaAnalyzer hop must be in [1, frameSize]');
    }
    const bins = (this.frameSize >> 1) + 1;
    this.fft = new RealFft(this.frameSize);
    this.window = hann(this.frameSize);
    this.ring = new Float32Array(this.frameSize);
    this.fftIn = new Float32Array(this.frameSize);
    this.re = new Float32Array(bins);
    this.im = new Float32Array(bins);
    this.mag = new Float32Array(bins);
    this.accum = new Float64Array(12);
    this.nextFrameAt = this.frameSize;
  }

  push(mono: Float32Array, from: number, to: number): void {
    const ring = this.ring;
    const size = this.frameSize;
    for (let i = from; i < to; i++) {
      ring[this.writePos] = mono[i];
      this.writePos++;
      if (this.writePos === size) this.writePos = 0;
      this.totalSamples++;
      if (this.totalSamples === this.nextFrameAt) {
        this.processFrame();
        this.nextFrameAt += this.hop;
      }
    }
  }

  /** Normalized mean chroma over frames since the last poll, or null. */
  poll(): Float32Array | null {
    if (this.frames === 0) return null;
    const out = new Float32Array(12);
    let max = 0;
    for (let i = 0; i < 12; i++) if (this.accum[i] > max) max = this.accum[i];
    if (max > 0) for (let i = 0; i < 12; i++) out[i] = this.accum[i] / max;
    this.accum.fill(0);
    this.frames = 0;
    return out;
  }

  reset(): void {
    this.ring.fill(0);
    this.accum.fill(0);
    this.writePos = 0;
    this.totalSamples = 0;
    this.nextFrameAt = this.frameSize;
    this.frames = 0;
  }

  private processFrame(): void {
    const size = this.frameSize;
    const ring = this.ring;
    const fftIn = this.fftIn;
    const win = this.window;
    const start = this.writePos;
    for (let i = 0; i < size; i++) {
      let j = start + i;
      if (j >= size) j -= size;
      fftIn[i] = ring[j] * win[i];
    }
    this.fft.forward(fftIn, this.re, this.im);
    const bins = (size >> 1) + 1;
    for (let k = 0; k < bins; k++) {
      this.mag[k] = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]);
    }
    const binHz = this.sampleRate / size;
    const kLo = Math.max(1, Math.ceil(MIN_HZ / binHz));
    const kHi = Math.min(bins - 1, Math.floor(MAX_HZ / binHz));
    for (let k = kLo; k <= kHi; k++) {
      const f = k * binHz;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      this.accum[pc] += this.mag[k] * this.mag[k];
    }
    this.frames++;
  }
}

/** Pearson correlation of chroma against profile rotated so index rot is the tonic. */
function correlate(chroma: ArrayLike<number>, profile: readonly number[], rot: number): number {
  let mx = 0;
  let my = 0;
  for (let i = 0; i < 12; i++) {
    mx += chroma[i];
    my += profile[i];
  }
  mx /= 12;
  my /= 12;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let pc = 0; pc < 12; pc++) {
    const x = chroma[pc] - mx;
    const y = profile[(pc - rot + 12) % 12] - my;
    cov += x * y;
    vx += x * x;
    vy += y * y;
  }
  const denom = Math.sqrt(vx * vy);
  return denom > 0 ? cov / denom : 0;
}

/** Krumhansl-Schmuckler key estimation over a 12-bin chroma vector. */
export function keyEstimate(chroma: ArrayLike<number>): KeyResult {
  let bestKey = 0;
  let bestMode: KeyMode = 'major';
  let bestR = -Infinity;
  for (let key = 0; key < 12; key++) {
    const rMaj = correlate(chroma, MAJOR_PROFILE, key);
    if (rMaj > bestR) {
      bestR = rMaj;
      bestKey = key;
      bestMode = 'major';
    }
    const rMin = correlate(chroma, MINOR_PROFILE, key);
    if (rMin > bestR) {
      bestR = rMin;
      bestKey = key;
      bestMode = 'minor';
    }
  }
  return { key: bestKey, mode: bestMode, confidence: bestR };
}
