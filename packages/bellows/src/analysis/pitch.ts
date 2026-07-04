/*
 * Time-domain pitch detection.
 *
 * yin: the YIN estimator (de Cheveigne and Kawahara 2002). Difference
 * function over half the buffer, cumulative mean normalized difference,
 * absolute threshold with descent to the local minimum, parabolic
 * interpolation of the lag. probability is 1 minus the normalized
 * difference at the chosen lag.
 *
 * mpm: the McLeod pitch method (McLeod and Wyvill 2005). Normalized
 * square difference function via autocorrelation, key maxima picked
 * between positive zero crossings, first peak within 93 percent of the
 * highest chosen. clarity is the interpolated NSDF value at the peak.
 *
 * YinDetector wraps yin as a push-based analyzer over a ring buffer so
 * the kernel can feed it block by block and poll at control rate.
 */

import type { Analyzer } from '../types';

export interface PitchResult {
  freq: number;
  /** 1 minus the normalized difference at the chosen lag, in (0, 1]. */
  probability: number;
}

export interface MpmResult {
  freq: number;
  /** Interpolated NSDF peak value, in (0, 1]. */
  clarity: number;
}

export interface YinOptions {
  /** Analysis window length in samples. Default 2048. */
  bufferSize?: number;
  /** Absolute threshold on the normalized difference. Default 0.1. */
  threshold?: number;
}

const DEFAULT_BUFFER = 2048;
const DEFAULT_THRESHOLD = 0.1;
/** First peak within this fraction of the highest NSDF peak wins. */
const MPM_K = 0.93;
/** NSDF peaks below this are treated as unvoiced. */
const MPM_MIN_CLARITY = 0.3;

/** Fractional vertex position of the parabola through v[i-1], v[i], v[i+1]. */
function parabolicShift(a: number, b: number, c: number): number {
  const denom = a - 2 * b + c;
  return denom === 0 ? 0 : (0.5 * (a - c)) / denom;
}

/**
 * Core YIN over x[0..n) using preallocated d and cmnd of length n >> 1.
 * Returns null when nothing dips below the threshold (silence, noise,
 * or a lag range that does not fit the window).
 */
function yinCore(
  x: Float32Array,
  n: number,
  sampleRate: number,
  threshold: number,
  d: Float64Array,
  cmnd: Float64Array,
): PitchResult | null {
  const maxTau = n >> 1;
  if (maxTau < 4) return null;

  d[0] = 0;
  for (let tau = 1; tau < maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < maxTau; i++) {
      const diff = x[i] - x[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau < maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // First lag below the threshold, then follow the dip to its minimum.
  let tau = 2;
  let found = -1;
  while (tau < maxTau - 1) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < maxTau - 1 && cmnd[tau + 1] < cmnd[tau]) tau++;
      found = tau;
      break;
    }
    tau++;
  }
  if (found < 0) return null;

  const shift = parabolicShift(cmnd[found - 1], cmnd[found], cmnd[found + 1]);
  const betterTau = found + shift;
  if (betterTau <= 0) return null;
  return {
    freq: sampleRate / betterTau,
    probability: 1 - cmnd[found],
  };
}

/** One-shot YIN over a whole buffer. Lags up to buffer.length / 2. */
export function yin(
  buffer: Float32Array,
  sampleRate: number,
  threshold: number = DEFAULT_THRESHOLD,
): PitchResult | null {
  const maxTau = buffer.length >> 1;
  if (maxTau < 4) return null;
  const d = new Float64Array(maxTau);
  const cmnd = new Float64Array(maxTau);
  return yinCore(buffer, buffer.length, sampleRate, threshold, d, cmnd);
}

/**
 * One-shot McLeod pitch method over a whole buffer.
 * Returns null for silence or when no NSDF peak reaches 0.3.
 */
export function mpm(buffer: Float32Array, sampleRate: number): MpmResult | null {
  const n = buffer.length;
  const maxTau = n >> 1;
  if (maxTau < 4) return null;

  const nsdf = new Float64Array(maxTau);
  let power0 = 0;
  for (let i = 0; i < n; i++) power0 += buffer[i] * buffer[i];
  if (power0 < 1e-10) return null;

  for (let tau = 1; tau < maxTau; tau++) {
    let acf = 0;
    let m = 0;
    for (let i = 0; i + tau < n; i++) {
      acf += buffer[i] * buffer[i + tau];
      m += buffer[i] * buffer[i] + buffer[i + tau] * buffer[i + tau];
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  nsdf[0] = 1;

  // Skip the initial lobe, then record the maximum of every positive region.
  let i = 1;
  while (i < maxTau && nsdf[i] > 0) i++;
  const peakPos: number[] = [];
  const peakVal: number[] = [];
  while (i < maxTau) {
    while (i < maxTau && nsdf[i] <= 0) i++;
    let best = -1;
    let bestVal = 0;
    while (i < maxTau && nsdf[i] > 0) {
      if (nsdf[i] > bestVal) {
        bestVal = nsdf[i];
        best = i;
      }
      i++;
    }
    if (best > 0) {
      peakPos.push(best);
      peakVal.push(bestVal);
    }
  }
  if (peakPos.length === 0) return null;

  let highest = 0;
  for (let p = 0; p < peakVal.length; p++) if (peakVal[p] > highest) highest = peakVal[p];
  if (highest < MPM_MIN_CLARITY) return null;

  const cutoff = MPM_K * highest;
  let chosen = -1;
  for (let p = 0; p < peakPos.length; p++) {
    if (peakVal[p] >= cutoff) {
      chosen = peakPos[p];
      break;
    }
  }
  if (chosen <= 0 || chosen >= maxTau - 1) return null;

  const a = nsdf[chosen - 1];
  const b = nsdf[chosen];
  const c = nsdf[chosen + 1];
  const shift = parabolicShift(a, b, c);
  const betterTau = chosen + shift;
  const peak = b - 0.25 * (a - c) * shift;
  return {
    freq: sampleRate / betterTau,
    clarity: Math.min(1, peak),
  };
}

/**
 * Push-based YIN. Feed mono blocks, poll at control rate. poll runs the
 * detector over the most recent bufferSize samples; it returns null until
 * the window has filled once. All analysis storage is preallocated.
 */
export class YinDetector implements Analyzer {
  private readonly sampleRate: number;
  private readonly threshold: number;
  private readonly size: number;
  private readonly ring: Float32Array;
  private readonly frame: Float32Array;
  private readonly d: Float64Array;
  private readonly cmnd: Float64Array;
  private writePos = 0;
  private filled = 0;

  constructor(sampleRate: number, opts: YinOptions = {}) {
    this.sampleRate = sampleRate;
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    this.size = opts.bufferSize ?? DEFAULT_BUFFER;
    if (this.size < 8) throw new Error('YinDetector bufferSize must be at least 8');
    this.ring = new Float32Array(this.size);
    this.frame = new Float32Array(this.size);
    this.d = new Float64Array(this.size >> 1);
    this.cmnd = new Float64Array(this.size >> 1);
  }

  push(mono: Float32Array, from: number, to: number): void {
    const ring = this.ring;
    const size = this.size;
    let w = this.writePos;
    for (let i = from; i < to; i++) {
      ring[w] = mono[i];
      w++;
      if (w === size) w = 0;
    }
    this.writePos = w;
    this.filled = Math.min(size, this.filled + (to - from));
  }

  /** Pitch of the latest full window, or null before it fills or when unvoiced. */
  poll(): PitchResult | null {
    if (this.filled < this.size) return null;
    const ring = this.ring;
    const frame = this.frame;
    const size = this.size;
    const start = this.writePos;
    for (let i = 0; i < size; i++) {
      let j = start + i;
      if (j >= size) j -= size;
      frame[i] = ring[j];
    }
    return yinCore(frame, size, this.sampleRate, this.threshold, this.d, this.cmnd);
  }

  reset(): void {
    this.ring.fill(0);
    this.writePos = 0;
    this.filled = 0;
  }
}
