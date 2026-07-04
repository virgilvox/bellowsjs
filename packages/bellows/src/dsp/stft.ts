/*
 * Streaming STFT analysis, overlap-add synthesis, and a combined
 * analysis-modify-resynthesis processor for spectral effects.
 *
 * All units default to the periodic hann window on both analysis and
 * synthesis. Synthesis divides by the exact per-position sum of
 * analysisWindow * synthesisWindow across overlapping frames (colaNorm),
 * so unmodified frames reconstruct at unity gain for any hop where that
 * sum stays above zero, not only for hops with a constant COLA sum.
 *
 * Nothing here allocates on the audio path at steady state: rings,
 * scratch buffers, and frame pools are built in the constructors.
 */

import { RealFft, hann } from './fft';

/** One analysis frame: fftSize/2 + 1 complex bins. */
export interface SpectralFrame {
  re: Float32Array;
  im: Float32Array;
}

/** Bins mutated in place between analysis and resynthesis. */
export type SpectralCallback = (re: Float32Array, im: Float32Array) => void;

function checkArgs(fftSize: number, hop: number): void {
  if (fftSize < 2 || (fftSize & (fftSize - 1)) !== 0) {
    throw new Error('fftSize must be a power of two >= 2, got ' + fftSize);
  }
  if (!Number.isInteger(hop) || hop < 1 || hop > fftSize) {
    throw new Error('hop must be an integer in [1, fftSize], got ' + hop);
  }
}

/**
 * Steady-state overlap-add gain at each offset j in [0, hop):
 * sum over frame offsets k of winA[j + k*hop] * winS[j + k*hop].
 * For hann on both sides at hop = n/4 this is the constant 1.5.
 */
export function colaNorm(winA: Float32Array, winS: Float32Array, hop: number): Float32Array {
  const n = winA.length;
  const norm = new Float32Array(hop);
  for (let j = 0; j < hop; j++) {
    let s = 0;
    for (let k = j; k < n; k += hop) s += winA[k] * winS[k];
    norm[j] = s;
  }
  return norm;
}

/**
 * Push-based streaming analysis. Feed samples with push(); every hop
 * samples (once fftSize have accumulated) a windowed frame is transformed
 * and delivered either through the onFrame callback or queued for
 * nextFrame().
 *
 * Buffer reuse contract: frames handed out by nextFrame() and the pair
 * passed to onFrame stay valid only until the next call to push().
 * Copy them if they must live longer.
 */
export class Stft {
  readonly fftSize: number;
  readonly hop: number;
  /** fftSize/2 + 1. */
  readonly bins: number;
  /**
   * Samples between the first sample of a frame's window and the moment
   * the frame is emitted: one full window.
   */
  readonly latency: number;
  /** When set, frames are delivered here instead of the pull queue. */
  onFrame: SpectralCallback | null = null;

  private readonly window: Float32Array;
  private readonly fft: RealFft;
  private readonly ring: Float32Array;
  private readonly mask: number;
  private ringPos = 0;
  private until: number;
  private readonly scratch: Float32Array;
  private readonly cbFrame: SpectralFrame;
  private readonly queue: SpectralFrame[] = [];
  private readonly handedOut: SpectralFrame[] = [];
  private readonly free: SpectralFrame[] = [];

  constructor(fftSize: number, hop: number, window?: Float32Array) {
    checkArgs(fftSize, hop);
    if (window && window.length !== fftSize) {
      throw new Error('window length must equal fftSize');
    }
    this.fftSize = fftSize;
    this.hop = hop;
    this.bins = (fftSize >> 1) + 1;
    this.latency = fftSize;
    this.window = window ?? hann(fftSize);
    this.fft = new RealFft(fftSize);
    this.ring = new Float32Array(fftSize);
    this.mask = fftSize - 1;
    this.until = fftSize;
    this.scratch = new Float32Array(fftSize);
    this.cbFrame = { re: new Float32Array(this.bins), im: new Float32Array(this.bins) };
  }

  push(samples: Float32Array, from: number, to: number): void {
    // Frames handed out before this push are up for reuse now.
    while (this.handedOut.length > 0) this.free.push(this.handedOut.pop() as SpectralFrame);
    for (let i = from; i < to; i++) {
      this.ring[this.ringPos] = samples[i];
      this.ringPos = (this.ringPos + 1) & this.mask;
      if (--this.until === 0) {
        this.until = this.hop;
        this.emit();
      }
    }
  }

  /** Oldest queued frame, or null. Only used when onFrame is unset. */
  nextFrame(): SpectralFrame | null {
    const f = this.queue.shift();
    if (!f) return null;
    this.handedOut.push(f);
    return f;
  }

  reset(): void {
    this.ring.fill(0);
    this.ringPos = 0;
    this.until = this.fftSize;
    while (this.queue.length > 0) this.free.push(this.queue.pop() as SpectralFrame);
    while (this.handedOut.length > 0) this.free.push(this.handedOut.pop() as SpectralFrame);
  }

  private emit(): void {
    const n = this.fftSize;
    const start = this.ringPos; // oldest sample in the ring
    const sc = this.scratch;
    const w = this.window;
    for (let j = 0; j < n; j++) sc[j] = this.ring[(start + j) & this.mask] * w[j];
    if (this.onFrame) {
      this.fft.forward(sc, this.cbFrame.re, this.cbFrame.im);
      this.onFrame(this.cbFrame.re, this.cbFrame.im);
      return;
    }
    let f = this.free.pop();
    if (!f) f = { re: new Float32Array(this.bins), im: new Float32Array(this.bins) };
    this.fft.forward(sc, f.re, f.im);
    this.queue.push(f);
  }
}

/**
 * Overlap-add synthesis. Each pushFrame() consumes one spectrum, applies
 * the synthesis window, overlap-adds, and writes the hop output samples
 * it completes to out[at .. at + hop).
 *
 * Frames are assumed to arrive one hop apart, matching a Stft with the
 * same fftSize and hop. COLA compensation uses analysisWindow (defaulting
 * to the synthesis window) so a windowed analysis frame passed through
 * untouched reconstructs at unity gain.
 */
export class Istft {
  readonly fftSize: number;
  readonly hop: number;
  readonly bins: number;

  private readonly winS: Float32Array;
  private readonly invNorm: Float32Array;
  private readonly fft: RealFft;
  private readonly accum: Float32Array;
  private readonly scratch: Float32Array;

  constructor(fftSize: number, hop: number, window?: Float32Array, analysisWindow?: Float32Array) {
    checkArgs(fftSize, hop);
    if (window && window.length !== fftSize) {
      throw new Error('window length must equal fftSize');
    }
    this.fftSize = fftSize;
    this.hop = hop;
    this.bins = (fftSize >> 1) + 1;
    this.winS = window ?? hann(fftSize);
    const winA = analysisWindow ?? this.winS;
    const norm = colaNorm(winA, this.winS, hop);
    this.invNorm = new Float32Array(hop);
    for (let j = 0; j < hop; j++) this.invNorm[j] = norm[j] > 1e-6 ? 1 / norm[j] : 0;
    this.fft = new RealFft(fftSize);
    this.accum = new Float32Array(fftSize);
    this.scratch = new Float32Array(fftSize);
  }

  /** Synthesize one frame and write hop finished samples to out[at..at+hop). */
  pushFrame(re: Float32Array, im: Float32Array, out: Float32Array, at: number): void {
    const n = this.fftSize;
    const hop = this.hop;
    const sc = this.scratch;
    const acc = this.accum;
    this.fft.inverse(re, im, sc);
    for (let j = 0; j < n; j++) acc[j] += sc[j] * this.winS[j];
    for (let j = 0; j < hop; j++) out[at + j] = acc[j] * this.invNorm[j];
    acc.copyWithin(0, hop);
    acc.fill(0, n - hop);
  }

  reset(): void {
    this.accum.fill(0);
  }
}

/**
 * Combined analysis-modify-resynthesis with a per-sample streaming
 * interface. The spectral callback mutates the fftSize/2 + 1 bins in
 * place between forward and inverse transforms; with no callback the
 * unit reconstructs its input delayed by `latency`.
 *
 * Latency is one full window: output sample tick(x_t) returns the
 * resynthesized signal at time t - fftSize. The first fftSize outputs
 * are the zero-padded ramp-in.
 */
export class StftProcessor {
  readonly fftSize: number;
  readonly hop: number;
  readonly bins: number;
  /** Input-to-output delay in samples: one full window. */
  readonly latency: number;
  spectral: SpectralCallback | null = null;

  private readonly winA: Float32Array;
  private readonly winS: Float32Array;
  private readonly invNorm: Float32Array;
  private readonly fft: RealFft;
  private readonly inFifo: Float32Array;
  private readonly outFifo: Float32Array;
  private readonly accum: Float32Array;
  private readonly scratch: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly roverStart: number;
  private rover: number;

  constructor(fftSize: number, hop: number, window?: Float32Array) {
    checkArgs(fftSize, hop);
    if (window && window.length !== fftSize) {
      throw new Error('window length must equal fftSize');
    }
    this.fftSize = fftSize;
    this.hop = hop;
    this.bins = (fftSize >> 1) + 1;
    this.latency = fftSize;
    this.winA = window ?? hann(fftSize);
    this.winS = this.winA;
    const norm = colaNorm(this.winA, this.winS, hop);
    this.invNorm = new Float32Array(hop);
    for (let j = 0; j < hop; j++) this.invNorm[j] = norm[j] > 1e-6 ? 1 / norm[j] : 0;
    this.fft = new RealFft(fftSize);
    this.inFifo = new Float32Array(fftSize);
    this.outFifo = new Float32Array(hop);
    this.accum = new Float32Array(fftSize);
    this.scratch = new Float32Array(fftSize);
    this.re = new Float32Array(this.bins);
    this.im = new Float32Array(this.bins);
    this.roverStart = fftSize - hop;
    this.rover = this.roverStart;
  }

  /** Feed one sample, get one (delayed) output sample. */
  tick(x: number): number {
    const out = this.outFifo[this.rover - this.roverStart];
    this.inFifo[this.rover] = x;
    this.rover++;
    if (this.rover === this.fftSize) {
      this.frame();
      this.rover = this.roverStart;
    }
    return out;
  }

  /** In-place block processing over [from, to). */
  process(buf: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) buf[i] = this.tick(buf[i]);
  }

  reset(): void {
    this.inFifo.fill(0);
    this.outFifo.fill(0);
    this.accum.fill(0);
    this.rover = this.roverStart;
  }

  private frame(): void {
    const n = this.fftSize;
    const hop = this.hop;
    const sc = this.scratch;
    for (let j = 0; j < n; j++) sc[j] = this.inFifo[j] * this.winA[j];
    this.fft.forward(sc, this.re, this.im);
    if (this.spectral) this.spectral(this.re, this.im);
    this.fft.inverse(this.re, this.im, sc);
    const acc = this.accum;
    for (let j = 0; j < n; j++) acc[j] += sc[j] * this.winS[j];
    for (let j = 0; j < hop; j++) this.outFifo[j] = acc[j] * this.invNorm[j];
    acc.copyWithin(0, hop);
    acc.fill(0, n - hop);
    this.inFifo.copyWithin(0, hop);
  }
}
