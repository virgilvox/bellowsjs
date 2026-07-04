/*
 * Spectral flux onset detection and inter-onset tempo estimation.
 *
 * The detector slides a windowed STFT (frame 1024, hop 256 by default)
 * over the input, computes half-wave rectified spectral flux between
 * consecutive magnitude frames, and marks a frame as an onset when its
 * flux is a local maximum above an adaptive threshold: the median of the
 * trailing flux window times a multiplier plus an absolute floor. A
 * refractory period suppresses doubles. Flux is normalized by the bin
 * count so thresholds do not depend on the frame size.
 *
 * Onset times are the start time of the peak frame, frameIndex * hop /
 * sampleRate. The local-maximum test needs one frame of lookahead, so a
 * candidate is confirmed when the following frame arrives.
 *
 * estimateTempo builds a histogram of inter-onset intervals (spans of
 * one to four onsets, weighted by 1 / span), folds each candidate tempo
 * into [75, 150) bpm by doubling or halving, and reads the peak. Tempi
 * outside that band therefore report a factor-of-two fold: 60 and 240
 * bpm both land on 120.
 */

import type { Analyzer } from '../types';
import { RealFft, hann } from '../dsp/fft';

export interface OnsetOptions {
  /** STFT frame length, power of two. Default 1024. */
  frameSize?: number;
  /** STFT hop in samples. Default 256. */
  hop?: number;
  /** Trailing frames in the median filter. Default 21. */
  medianWindow?: number;
  /** Threshold is multiplier * median + floor. Defaults 1.5 and 0.01. */
  multiplier?: number;
  floor?: number;
  /** Minimum time between reported onsets, seconds. Default 0.08. */
  refractory?: number;
}

export interface TempoEstimate {
  bpm: number;
  /** Fraction of histogram mass under the winning peak, 0 to 1. */
  confidence: number;
}

const TEMPO_LO = 75;
const TEMPO_HI = 150;

/** Streaming spectral flux onset detector. */
export class OnsetDetector implements Analyzer {
  private readonly sampleRate: number;
  private readonly frameSize: number;
  private readonly hop: number;
  private readonly medianWindow: number;
  private readonly multiplier: number;
  private readonly floor: number;
  private readonly refractory: number;

  private readonly fft: RealFft;
  private readonly window: Float32Array;
  private readonly ring: Float32Array;
  private readonly fftIn: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly mag: Float32Array;
  private readonly prevMag: Float32Array;
  private readonly history: Float64Array;
  private readonly sorted: Float64Array;

  private writePos = 0;
  private totalSamples = 0;
  private nextFrameAt: number;
  private frameIndex = 0;
  private historyLen = 0;
  private historyPos = 0;
  private fluxPrev = 0;
  private fluxPrevPrev = 0;
  private lastOnsetTime = -Infinity;
  private pending: number[] = [];

  constructor(sampleRate: number, opts: OnsetOptions = {}) {
    this.sampleRate = sampleRate;
    this.frameSize = opts.frameSize ?? 1024;
    this.hop = opts.hop ?? 256;
    this.medianWindow = opts.medianWindow ?? 21;
    this.multiplier = opts.multiplier ?? 1.5;
    this.floor = opts.floor ?? 0.01;
    this.refractory = opts.refractory ?? 0.08;
    if ((this.frameSize & (this.frameSize - 1)) !== 0) {
      throw new Error('OnsetDetector frameSize must be a power of two');
    }
    if (this.hop < 1 || this.hop > this.frameSize) {
      throw new Error('OnsetDetector hop must be in [1, frameSize]');
    }
    const bins = (this.frameSize >> 1) + 1;
    this.fft = new RealFft(this.frameSize);
    this.window = hann(this.frameSize);
    this.ring = new Float32Array(this.frameSize);
    this.fftIn = new Float32Array(this.frameSize);
    this.re = new Float32Array(bins);
    this.im = new Float32Array(bins);
    this.mag = new Float32Array(bins);
    this.prevMag = new Float32Array(bins);
    this.history = new Float64Array(this.medianWindow);
    this.sorted = new Float64Array(this.medianWindow);
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

  /** Onset times in seconds detected since the last poll. Allocates the result array. */
  poll(): number[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  reset(): void {
    this.ring.fill(0);
    this.prevMag.fill(0);
    this.writePos = 0;
    this.totalSamples = 0;
    this.nextFrameAt = this.frameSize;
    this.frameIndex = 0;
    this.historyLen = 0;
    this.historyPos = 0;
    this.fluxPrev = 0;
    this.fluxPrevPrev = 0;
    this.lastOnsetTime = -Infinity;
    this.pending = [];
  }

  private processFrame(): void {
    const size = this.frameSize;
    const bins = (size >> 1) + 1;
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

    const mag = this.mag;
    const prev = this.prevMag;
    let flux = 0;
    for (let k = 0; k < bins; k++) {
      const m = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]);
      const rise = m - prev[k];
      if (rise > 0) flux += rise;
      mag[k] = m;
    }
    flux /= bins;
    prev.set(mag);

    // Frame n just produced flux; frame n - 1 is the candidate, with the
    // trailing history holding flux values up to frame n - 2.
    const n = this.frameIndex;
    if (n >= 1) {
      const cand = this.fluxPrev;
      const thr = this.multiplier * this.medianOfHistory() + this.floor;
      if (cand > thr && cand >= this.fluxPrevPrev && cand > flux) {
        const t = ((n - 1) * this.hop) / this.sampleRate;
        if (t - this.lastOnsetTime >= this.refractory) {
          this.pending.push(t);
          this.lastOnsetTime = t;
        }
      }
      // The candidate joins the history only after its own evaluation.
      this.history[this.historyPos] = cand;
      this.historyPos = (this.historyPos + 1) % this.medianWindow;
      if (this.historyLen < this.medianWindow) this.historyLen++;
    }
    this.fluxPrevPrev = this.fluxPrev;
    this.fluxPrev = flux;
    this.frameIndex++;
  }

  private medianOfHistory(): number {
    const len = this.historyLen;
    if (len === 0) return 0;
    const sorted = this.sorted;
    // Insertion sort into the scratch array, no allocation.
    for (let i = 0; i < len; i++) {
      const v = this.history[i];
      let j = i - 1;
      while (j >= 0 && sorted[j] > v) {
        sorted[j + 1] = sorted[j];
        j--;
      }
      sorted[j + 1] = v;
    }
    const mid = len >> 1;
    return len % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
  }
}

/** One-shot onset detection over a whole buffer. Returns times in seconds. */
export function detectOnsets(
  buffer: Float32Array,
  sampleRate: number,
  opts: OnsetOptions = {},
): number[] {
  const det = new OnsetDetector(sampleRate, opts);
  det.push(buffer, 0, buffer.length);
  // Flush with silence so the trailing frames get their lookahead.
  const frameSize = opts.frameSize ?? 1024;
  const hop = opts.hop ?? 256;
  const tail = new Float32Array(frameSize + hop);
  det.push(tail, 0, tail.length);
  return det.poll().filter((t) => t * sampleRate < buffer.length);
}

/**
 * Tempo from onset times (seconds) or from raw audio. Audio input needs
 * sampleRate and runs detectOnsets first. Returns bpm 0 with confidence 0
 * when there are too few onsets to vote.
 */
export function estimateTempo(
  input: readonly number[] | Float32Array,
  sampleRate?: number,
): TempoEstimate {
  let onsets: readonly number[];
  if (input instanceof Float32Array) {
    if (sampleRate === undefined) {
      throw new Error('estimateTempo needs a sampleRate for audio input');
    }
    onsets = detectOnsets(input, sampleRate);
  } else {
    onsets = input;
  }
  if (onsets.length < 3) return { bpm: 0, confidence: 0 };

  const binCount = TEMPO_HI - TEMPO_LO;
  const hist = new Float64Array(binCount);
  let total = 0;
  for (let i = 0; i < onsets.length; i++) {
    const jMax = Math.min(onsets.length, i + 5);
    for (let j = i + 1; j < jMax; j++) {
      const d = onsets[j] - onsets[i];
      if (d < 0.15 || d > 4) continue;
      let bpm = 60 / d;
      while (bpm < TEMPO_LO) bpm *= 2;
      while (bpm >= TEMPO_HI) bpm /= 2;
      const w = 1 / (j - i);
      const pos = bpm - TEMPO_LO;
      const b0 = Math.floor(pos);
      const frac = pos - b0;
      hist[b0] += w * (1 - frac);
      if (b0 + 1 < binCount) hist[b0 + 1] += w * frac;
      total += w;
    }
  }
  if (total <= 0) return { bpm: 0, confidence: 0 };

  let peak = 0;
  for (let b = 1; b < binCount; b++) if (hist[b] > hist[peak]) peak = b;

  // Refine over the peak and its neighbors by center of mass.
  let mass = 0;
  let moment = 0;
  for (let b = Math.max(0, peak - 1); b <= Math.min(binCount - 1, peak + 1); b++) {
    mass += hist[b];
    moment += b * hist[b];
  }
  if (mass <= 0) return { bpm: 0, confidence: 0 };
  return {
    bpm: TEMPO_LO + moment / mass,
    confidence: mass / total,
  };
}
