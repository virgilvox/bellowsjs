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
 *
 * THE HIGH FREQUENCY FALLBACK, and why it is off by default.
 *
 * The residual sum walks every edge lying within KERNEL_HALF samples of
 * the current phase, and the number of edges in that window is
 * 2 * KERNEL_HALF * dt + 1, so oscillator cost climbs linearly with
 * pitch. Measured here at 44100 Hz, a saw costs about 5.7 ns per sample
 * at A440 and about 25 ns at 7040 Hz. Because setFreq clamps dt at 0.49
 * the growth is bounded rather than open ended: the sum never spans more
 * than about 17 edges, which puts the worst case near six times the A440
 * cost. That bound, not the ratio against a very low note, is the number
 * a fixed polyphony budget has to be sized against.
 *
 * Above roughly a sixth of the sample rate there is a better option than
 * paying that cost. A band limited saw at 7040 Hz has only two harmonics
 * under the kernel's 0.42 cutoff, so summing the harmonics directly is
 * both cheaper and exact. The two costs run in opposite directions (the
 * BLEP sum grows with dt, the harmonic sum shrinks as 1/dt) and they
 * cross near dt = 0.16. Measured, saw, 44100 Hz:
 *
 *     hz     BLEP ns   additive ns    BLEP dB   additive dB
 *     5000      21.2          33.1      -87.3         -94.8
 *     7040      25.5          23.3      -86.6         -94.0
 *     9000      30.8          21.5      -81.0         -96.1
 *    11000      36.3          10.6      -89.8         -97.0
 *
 * So above the crossover the harmonic sum wins on both axes at once,
 * which a kernel cap cannot do: capping the sum to four edges saves about
 * a fifth of the cost at 7040 Hz and gives up 39 dB of alias rejection,
 * and tapering the truncated kernel buys back only about 13 dB of that.
 *
 * It is nonetheless opt in, through the highFreq option, because turning
 * it on changes rendered output above the crossover and this library
 * promises that a given seed reproduces a given render. The default keeps
 * the BLEP path for every dt, so the shipping code path is unchanged.
 * Callers who want the bounded cost ask for it, the same way the delay
 * effects take their capacity at construction.
 */

import { clamp } from '../types';

export type BlepShape = 'saw' | 'square' | 'triangle' | 'sine';

/**
 * How the oscillator behaves above the crossover documented at the top of
 * this file. 'blep' pays the growing residual sum at every pitch and is
 * the default because it leaves rendered output unchanged. 'additive'
 * sums the surviving harmonics instead, which is cheaper and cleaner
 * above the crossover and identical below it.
 */
export type BlepHighFreqMode = 'blep' | 'additive';

export interface BlepOscillatorOptions {
  highFreq?: BlepHighFreqMode;
}

/**
 * Reads the fallback choice out of an engine's numeric parameter bag.
 * Engines already take construction-time options by this route: the delay
 * effects size their rings from params.maxSeconds the same way. Like
 * those, it stays out of the ParamSpec arrays on purpose, because a
 * ParamSpec advertises a control the user can move while a note sounds,
 * and moving this one mid note would step the waveform.
 */
export function blepOptionsFromParams(params: Record<string, number>): BlepOscillatorOptions {
  return { highFreq: params.boundedHighFreq ? 'additive' : 'blep' };
}

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

/**
 * dt below which the fallback contributes nothing. Sits under the
 * measured cost crossover (about dt 0.16) so the blend is complete
 * before the harmonic sum would ever be the more expensive of the two.
 */
const FALLBACK_LO_DT = 0.14;
/** dt at and above which the harmonic sum runs alone. */
const FALLBACK_HI_DT = 0.2;
/**
 * Harmonics the fallback can ever need. The count is floor(CUTOFF / dt)
 * and dt never goes below FALLBACK_LO_DT while the fallback is engaged,
 * so three is the true ceiling; the array is one longer so index k is
 * harmonic k and the zero slot stays unused.
 */
const MAX_HARMONICS = 4;

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

  /* Fallback state. blend stays 0 for the whole of the default mode, and
   * next() then runs exactly the code it ran before the fallback existed.
   * The coefficient arrays are allocated once here so the audio path
   * never does. */
  private readonly highFreq: BlepHighFreqMode;
  private blend = 0;
  private harmonics = 0;
  private dc = 0;
  private readonly cosCoef = new Float64Array(MAX_HARMONICS + 1);
  private readonly sinCoef = new Float64Array(MAX_HARMONICS + 1);

  constructor(sampleRate: number, options?: BlepOscillatorOptions) {
    this.sampleRate = sampleRate;
    this.highFreq = options?.highFreq ?? 'blep';
    if (stepTable === null) buildTables();
  }

  setShape(shape: BlepShape): void {
    this.shape = shape;
    this.updateFallback();
  }

  setFreq(hz: number): void {
    this.dt = clamp(hz / this.sampleRate, 0, 0.49);
    this.updateFallback();
  }

  /** Pulse width for the square shape, clamped away from degenerate edges. */
  setPulseWidth(pw: number): void {
    this.pw = clamp(pw, 0.01, 0.99);
    this.updateFallback();
  }

  /**
   * Recomputes how much of the output comes from the harmonic sum and
   * what that sum contains. Called from the setters rather than from
   * next(), so the per sample path never evaluates a transcendental to
   * build a coefficient. Sine is excluded because it has no harmonics
   * above the fundamental and therefore nothing to alias.
   */
  private updateFallback(): void {
    if (this.highFreq !== 'additive' || this.shape === 'sine' || this.dt <= FALLBACK_LO_DT) {
      this.blend = 0;
      return;
    }
    const dt = this.dt;
    this.blend =
      dt >= FALLBACK_HI_DT ? 1 : (dt - FALLBACK_LO_DT) / (FALLBACK_HI_DT - FALLBACK_LO_DT);
    /* Keep the same band limit the BLEP kernel imposes, so the two forms
     * describe the same waveform and the blend has nothing to step over.
     * At least one harmonic always survives: past dt 0.42 the fundamental
     * itself is over the cutoff, and the BLEP path does not remove it
     * either, so dropping it here would blend towards silence. */
    this.harmonics = clamp(Math.floor(CUTOFF / dt), 1, MAX_HARMONICS);

    const k = this.harmonics;
    const cos = this.cosCoef;
    const sin = this.sinCoef;
    cos.fill(0);
    sin.fill(0);
    this.dc = 0;
    switch (this.shape) {
      case 'saw':
        // 2t - 1 has the series -(2/pi) * sum sin(2 pi n t) / n
        for (let n = 1; n <= k; n++) sin[n] = -2 / (Math.PI * n);
        break;
      case 'square': {
        // duty pw: mean 2pw - 1, then the standard pulse train coefficients
        const pw = this.pw;
        this.dc = 2 * pw - 1;
        for (let n = 1; n <= k; n++) {
          cos[n] = (2 * Math.sin(TWO_PI * n * pw)) / (Math.PI * n);
          sin[n] = (2 * (1 - Math.cos(TWO_PI * n * pw))) / (Math.PI * n);
        }
        break;
      }
      case 'triangle':
        // -1 at phase 0 rising to +1 at a half: odd cosines falling as 1/n^2
        for (let n = 1; n <= k; n += 2) cos[n] = -8 / (Math.PI * Math.PI * n * n);
        break;
      default:
        break;
    }
  }

  /**
   * Sum of the surviving harmonics at phase t. One sine and one cosine,
   * then an angle addition recurrence for the rest, so the count of
   * transcendentals does not grow with the harmonic count.
   */
  private additive(t: number): number {
    const th = TWO_PI * t;
    const c1 = Math.cos(th);
    const s1 = Math.sin(th);
    let c = c1;
    let s = s1;
    let y = this.dc;
    const k = this.harmonics;
    const cos = this.cosCoef;
    const sin = this.sinCoef;
    for (let n = 1; n <= k; n++) {
      y += cos[n] * c + sin[n] * s;
      const nc = c * c1 - s * s1;
      s = s * c1 + c * s1;
      c = nc;
    }
    return y;
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
    const blend = this.blend;
    let y: number;
    if (blend >= 1) {
      /* The residual sum is skipped outright here, which is where the
       * saving comes from: blending against a BLEP value we then throw
       * most of away would cost more than the path it replaces. */
      y = this.additive(t);
    } else {
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
      if (blend > 0) y += (this.additive(t) - y) * blend;
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
