/*
 * Antialiased oscillators.
 *
 * BlepOscillator corrects step discontinuities (saw wrap, square edges)
 * with a BLEP residual and slope discontinuities (triangle corners) with
 * its integral, the BLAMP residual. The residuals are evaluated like a
 * polyBLEP: as a function of the distance in samples between the current
 * phase and each nearby discontinuity, so the oscillator has no latency
 * and no per sample allocation. A two sample polynomial residual only
 * attenuates components that fold from just above Nyquist by about 9 dB,
 * and the four point polyBLEP (the integrated cubic B spline) still tops
 * out near 18 dB there, both short of the 40 dB alias budget at high
 * fundamentals, so the residual here is tabulated from the integral of a
 * Kaiser windowed sinc spanning 32 samples. The table is built once per
 * module and shared by every instance.
 *
 * SineOscillator is a plain phase accumulator with a phase modulation
 * input in radians for FM engines.
 *
 * Hard sync is intentionally not implemented: done cleanly it needs a
 * BLEP at the fractional sync point plus slave phase rewind, and the
 * present design only knows edges at fixed phase offsets.
 */

import { clamp } from '../types';

export type BlepShape = 'saw' | 'square' | 'triangle' | 'sine';

const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Shared BLEP and BLAMP residual tables                               */
/* ------------------------------------------------------------------ */

/** Kernel half width in samples. Corrections reach this far from an edge. */
const KERNEL_HALF = 16;
/** Table points per sample of kernel span. */
const TABLE_RES = 64;
/** Lowpass cutoff as a fraction of the sample rate. */
const CUTOFF = 0.42;
/** Kaiser window shape, about 60 dB stopband. */
const KAISER_BETA = 6;

const TABLE_LEN = 2 * KERNEL_HALF * TABLE_RES + 1;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    const t = x / (2 * k);
    term *= t * t;
    sum += term;
    if (term < 1e-14 * sum) break;
  }
  return sum;
}

/** Integral of the bandlimiting kernel, rising 0 to 1 over [-HALF, HALF]. */
let stepTable: Float64Array | null = null;
/** BLAMP residual for a unit slope change per sample, zero at both ends. */
let rampTable: Float64Array | null = null;

function buildTables(): void {
  const n = TABLE_LEN;
  const h = new Float64Array(n);
  const norm = besselI0(KAISER_BETA);
  for (let i = 0; i < n; i++) {
    const d = i / TABLE_RES - KERNEL_HALF;
    const x = 2 * CUTOFF * d;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = d / KERNEL_HALF;
    const w = besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - r * r))) / norm;
    h[i] = 2 * CUTOFF * sinc * w;
  }
  // step response: trapezoidal integral of the kernel, normalized to 1
  const step = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += (h[i - 1] + h[i]) / (2 * TABLE_RES);
    step[i] = acc;
  }
  for (let i = 0; i < n; i++) step[i] /= acc;
  // blamp residual: integral of (step - unit step), drift removed
  const ramp = new Float64Array(n);
  let acc2 = 0;
  for (let i = 1; i < n; i++) {
    const d0 = (i - 1) / TABLE_RES - KERNEL_HALF;
    const d1 = i / TABLE_RES - KERNEL_HALF;
    const r0 = step[i - 1] - (d0 >= 0 ? 1 : 0);
    const r1 = step[i] - (d1 >= 0 ? 1 : 0);
    acc2 += (r0 + r1) / (2 * TABLE_RES);
    ramp[i] = acc2;
  }
  const drift = ramp[n - 1];
  for (let i = 0; i < n; i++) ramp[i] -= (drift * i) / (n - 1);
  stepTable = step;
  rampTable = ramp;
}

/**
 * BLEP residual for a unit upward step at d = 0, d in samples.
 * The step itself stays analytic so linear interpolation never
 * smears the discontinuity.
 */
function blepResidual(d: number): number {
  const table = stepTable as Float64Array;
  const pos = (d + KERNEL_HALF) * TABLE_RES;
  const i = Math.floor(pos);
  if (i < 0) return 0;
  if (i >= TABLE_LEN - 1) return 0;
  const f = pos - i;
  const v = table[i] + (table[i + 1] - table[i]) * f;
  return v - (d >= 0 ? 1 : 0);
}

/** BLAMP residual for a unit slope increase per sample at d = 0. */
function blampResidual(d: number): number {
  const table = rampTable as Float64Array;
  const pos = (d + KERNEL_HALF) * TABLE_RES;
  const i = Math.floor(pos);
  if (i < 0) return 0;
  if (i >= TABLE_LEN - 1) return 0;
  const f = pos - i;
  return table[i] + (table[i + 1] - table[i]) * f;
}

/* ------------------------------------------------------------------ */
/* BlepOscillator                                                      */
/* ------------------------------------------------------------------ */

export class BlepOscillator {
  /**
   * Output delay in samples. The residual sum looks at edges on both
   * sides of the current phase instead of buffering output, so the
   * delay is zero. Consumers should read this rather than assume it,
   * since a future kernel change may introduce a short pipeline.
   */
  readonly latency = 0;

  private readonly sampleRate: number;
  private shape: BlepShape = 'saw';
  private phase = 0;
  private dt = 0;
  private pw = 0.5;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    if (stepTable === null) buildTables();
  }

  setShape(shape: BlepShape): void {
    this.shape = shape;
  }

  setFreq(hz: number): void {
    this.dt = clamp(hz / this.sampleRate, 0, 0.49);
  }

  /** Pulse width for the square shape, clamped away from degenerate edges. */
  setPulseWidth(pw: number): void {
    this.pw = clamp(pw, 0.01, 0.99);
  }

  reset(phase = 0): void {
    this.phase = phase - Math.floor(phase);
  }

  /**
   * Sum of step corrections for edges of the given height sitting at
   * phase offset + every integer. x is current phase minus the offset.
   */
  private sumBlep(x: number, height: number): number {
    const dt = this.dt;
    const w = KERNEL_HALF * dt;
    const mLo = Math.ceil(x - w);
    const mHi = Math.floor(x + w);
    let y = 0;
    for (let m = mLo; m <= mHi; m++) y += height * blepResidual((x - m) / dt);
    return y;
  }

  /** Same for slope corrections; mu is the slope change per sample. */
  private sumBlamp(x: number, mu: number): number {
    const dt = this.dt;
    const w = KERNEL_HALF * dt;
    const mLo = Math.ceil(x - w);
    const mHi = Math.floor(x + w);
    let y = 0;
    for (let m = mLo; m <= mHi; m++) y += mu * blampResidual((x - m) / dt);
    return y;
  }

  next(): number {
    const t = this.phase;
    const dt = this.dt;
    let y: number;
    switch (this.shape) {
      case 'saw':
        y = 2 * t - 1;
        if (dt > 0) y += this.sumBlep(t, -2);
        break;
      case 'square': {
        const pw = this.pw;
        y = t < pw ? 1 : -1;
        if (dt > 0) {
          y += this.sumBlep(t, 2); // rising edges at integers
          y += this.sumBlep(t - pw, -2); // falling edges at integers + pw
        }
        break;
      }
      case 'triangle': {
        y = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
        if (dt > 0) {
          const mu = 8 * dt; // slope change per sample at the corners
          y += this.sumBlamp(t, mu); // upward corners at integers
          y += this.sumBlamp(t - 0.5, -mu); // downward corners at halves
        }
        break;
      }
      case 'sine':
        y = Math.sin(TWO_PI * t);
        break;
    }
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }

  /** Overwrites out over [from, to). */
  process(out: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) out[i] = this.next();
  }
}

/* ------------------------------------------------------------------ */
/* SineOscillator                                                      */
/* ------------------------------------------------------------------ */

export class SineOscillator {
  private readonly sampleRate: number;
  private phase = 0;
  private dt = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setFreq(hz: number): void {
    this.dt = clamp(hz / this.sampleRate, 0, 0.5);
  }

  reset(phase = 0): void {
    this.phase = phase - Math.floor(phase);
  }

  next(): number {
    const y = Math.sin(TWO_PI * this.phase);
    this.phase += this.dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }

  /** Phase modulation input in radians, for FM engines. */
  nextPm(pm: number): number {
    const y = Math.sin(TWO_PI * this.phase + pm);
    this.phase += this.dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }
}
