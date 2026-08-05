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
 * the current phase. The average count of those per sample is exactly
 * 2 * KERNEL_HALF * dt, so cost climbs linearly with pitch: 0.32 edges at
 * A440, 5.1 at 7040 Hz, 15.7 at the dt clamp of 0.49, where a single
 * sample can span at most 16. That arithmetic is the durable number here.
 * Wall-clock ns/sample is not: the same shipping class measured through
 * two different benchmark harnesses gave 22.6 and 59.8 ns at 7040 Hz,
 * because how much of this inlines depends on what else the caller made
 * the JIT specialise. Quote the ratio, and measure both ends of it in one
 * process, or the figure means nothing.
 *
 * Measured that way, saw, 44100 Hz: the default path peaks at 9.0x its
 * A440 cost, at the top of the clamp. That bound, not the ratio against a
 * very low note, is what a fixed polyphony budget has to be sized to. Note
 * that a high lead is nowhere near the clamp: 7040 Hz costs about 3.7x
 * A440, and the top of a piano is 4186 Hz.
 *
 * Above dt = SWITCH_DT the harmonic sum is the better instrument. A band
 * limited saw there has one or two harmonics left under Nyquist, so
 * summing them directly is cheaper than walking sixteen edges, and it is
 * also exact where the residual sum is not. Measured, saw:
 *
 *      hz     residual ns   harmonic ns    residual dB   harmonic dB
 *   11000            30.5          25.0          -89.8         -97.0
 *   13000            38.7          24.5          -77.0         -98.1
 *   17000            45.6          24.5          -81.0        -101.1
 *   21609            56.4          24.9          -21.7        -101.6
 *
 * so the option takes the peak from 9.0x A440 to 5.2x and improves the
 * top of the range rather than trading it away. A kernel cap cannot do
 * that: capping the sum to four edges saves about a fifth of the cost at
 * 7040 Hz and gives up 39 dB, and tapering the truncated kernel recovers
 * only about 13 dB of that.
 *
 * Two things this design got wrong first, both worth stating because they
 * are the failure modes of the idea rather than of the code. Crossfading
 * between the paths across a transition band means evaluating BOTH across
 * that band, which cost about twice the default over exactly the range it
 * was meant to save in and left the peak where it was. And cutting the
 * harmonics off at the kernel cutoff steps the output when one crosses,
 * because the kernel is still passing half of a harmonic at its own
 * cutoff: for the second harmonic of a saw that is a jump of 0.16. The
 * switch is therefore hard, and every harmonic is scaled by the kernel's
 * own measured response, so harmonics fade exactly as the residual path
 * fades them and there is nothing left to fade between.
 *
 * It is opt in, through the highFreq option, because it changes rendered
 * output above the switch and this library promises that a given seed
 * reproduces a given render. The default keeps the residual path at every
 * dt, so the shipping code path is unchanged. Callers who want the bounded
 * cost ask for it, the same way the delay effects take their capacity at
 * construction.
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
/** Raw kernel, kept so the response table can be derived from it on demand. */
let kernel: Float64Array | null = null;

/**
 * Magnitude response of the bandlimiting kernel, sampled over [0, 0.5]
 * cycles per sample and normalized to unity in the passband. This is what
 * the BLEP path does to each harmonic, so it is what the harmonic sum has
 * to do to stay the same waveform: 1.0 up to about 0.34, 0.79 at 0.40,
 * 0.50 at the 0.42 cutoff, 0.21 at 0.44, and negligible past 0.48.
 *
 * Built lazily, because the integral costs about a thousand cosines per
 * point and only the opt-in high frequency path ever reads it. A default
 * oscillator never pays for this table.
 */
const RESP_LEN = 257;
let respTable: Float64Array | null = null;

function buildResponse(): void {
  const h = kernel as Float64Array;
  const n = TABLE_LEN;
  const centre = (n - 1) >> 1;
  const resp = new Float64Array(RESP_LEN);
  /* The kernel is even in d, so the transform is real and the sum only
   * needs one half of it. That removes every sine and halves the cosines. */
  for (let k = 0; k < RESP_LEN; k++) {
    const f = (0.5 * k) / (RESP_LEN - 1);
    let acc = h[centre];
    for (let i = centre + 1; i < n; i++) {
      const d = i / TABLE_RES - KERNEL_HALF;
      const w = i === n - 1 ? 0.5 : 1;
      acc += 2 * w * h[i] * Math.cos(TWO_PI * f * d);
    }
    resp[k] = acc / TABLE_RES;
  }
  const dc = resp[0];
  for (let k = 0; k < RESP_LEN; k++) resp[k] /= dc;
  respTable = resp;
}

/** Kernel gain at f cycles per sample, linearly interpolated. */
function kernelGain(f: number): number {
  if (f <= 0) return 1;
  if (f >= 0.5) return 0;
  const table = respTable as Float64Array;
  const pos = (f / 0.5) * (RESP_LEN - 1);
  const i = Math.floor(pos);
  if (i >= RESP_LEN - 1) return table[RESP_LEN - 1];
  const frac = pos - i;
  return table[i] + (table[i + 1] - table[i]) * frac;
}

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
  kernel = h;
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
 * dt at and above which the harmonic sum replaces the residual sum
 * outright. The switch is hard rather than a crossfade: a crossfade has to
 * evaluate both paths through the whole transition, which made the option
 * cost about twice the default across the band it was supposed to be
 * saving in, and with the kernel gain applied the two forms describe the
 * same waveform closely enough that there is nothing to fade between.
 */
const SWITCH_DT = 0.22;
/**
 * Harmonics the sum can ever need: those under Nyquist at the lowest dt
 * that reaches the harmonic path, floor(0.5 / SWITCH_DT). The arrays are
 * one longer so index n is harmonic n and the zero slot stays unused.
 */
const MAX_HARMONICS = 2;

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

  /* Fallback state. `additive` stays false for the whole of the default
   * mode, and next() then runs exactly the code it ran before the fallback
   * existed. Every array is allocated here so the audio path never does.
   *
   * The series is kept in two layers. base* is the ideal waveform's
   * coefficients, which depend on the shape and the pulse width and so
   * survive a frequency change; the working coefficients are those times
   * the kernel gain at that harmonic's frequency. Splitting them is what
   * keeps setFreq free of transcendentals, which matters because
   * engines/formant.ts calls setFreq once per sample to apply vibrato. */
  private readonly highFreq: BlepHighFreqMode;
  private additive = false;
  private harmonics = 0;
  private baseDc = 0;
  private readonly baseCos = new Float64Array(MAX_HARMONICS + 1);
  private readonly baseSin = new Float64Array(MAX_HARMONICS + 1);
  private readonly cosCoef = new Float64Array(MAX_HARMONICS + 1);
  private readonly sinCoef = new Float64Array(MAX_HARMONICS + 1);

  constructor(sampleRate: number, options?: BlepOscillatorOptions) {
    this.sampleRate = sampleRate;
    this.highFreq = options?.highFreq ?? 'blep';
    if (stepTable === null) buildTables();
    this.updateSeries();
  }

  setShape(shape: BlepShape): void {
    this.shape = shape;
    this.updateSeries();
  }

  setFreq(hz: number): void {
    this.dt = clamp(hz / this.sampleRate, 0, 0.49);
    this.updateBandLimit();
  }

  /** Pulse width for the square shape, clamped away from degenerate edges. */
  setPulseWidth(pw: number): void {
    this.pw = clamp(pw, 0.01, 0.99);
    this.updateSeries();
  }

  /**
   * Rebuilds the ideal waveform's Fourier coefficients. Depends on the
   * shape and the pulse width only, so a frequency change does not
   * touch it, which is what confines the transcendentals here to a
   * shape or pulse width change. Sine is excluded from the fallback
   * because it has no harmonics above the fundamental to alias.
   */
  private updateSeries(): void {
    if (this.highFreq !== 'additive') return;
    const cos = this.baseCos;
    const sin = this.baseSin;
    cos.fill(0);
    sin.fill(0);
    this.baseDc = 0;
    switch (this.shape) {
      case 'saw':
        // 2t - 1 has the series -(2/pi) * sum sin(2 pi n t) / n
        for (let n = 1; n <= MAX_HARMONICS; n++) sin[n] = -2 / (Math.PI * n);
        break;
      case 'square': {
        // duty pw: mean 2pw - 1, then the standard pulse train coefficients
        const pw = this.pw;
        this.baseDc = 2 * pw - 1;
        for (let n = 1; n <= MAX_HARMONICS; n++) {
          cos[n] = (2 * Math.sin(TWO_PI * n * pw)) / (Math.PI * n);
          sin[n] = (2 * (1 - Math.cos(TWO_PI * n * pw))) / (Math.PI * n);
        }
        break;
      }
      case 'triangle':
        // -1 at phase 0 rising to +1 at a half: odd cosines falling as 1/n^2
        for (let n = 1; n <= MAX_HARMONICS; n += 2) cos[n] = (-8 / (Math.PI * Math.PI * n)) / n;
        break;
      default:
        break;
    }
    this.updateBandLimit();
  }

  /**
   * Decides whether the harmonic sum runs at this dt, and if it does,
   * applies the kernel's own gain to each harmonic. Matching the gain
   * rather than cutting at the cutoff is what stops a harmonic vanishing
   * mid sweep: at the cutoff the kernel is still passing half of it, so a
   * hard cut would step the output by half that harmonic's amplitude,
   * which for the second harmonic of a saw is 0.16.
   *
   * No transcendental runs here. engines/formant.ts calls setFreq once per
   * sample for vibrato, so anything expensive on this path is a per sample
   * cost on that engine.
   */
  private updateBandLimit(): void {
    const dt = this.dt;
    if (this.highFreq !== 'additive' || this.shape === 'sine' || dt < SWITCH_DT) {
      this.additive = false;
      return;
    }
    if (respTable === null) buildResponse();
    this.additive = true;
    /* Everything under Nyquist. The gain kills whatever the kernel would
     * have killed, so nothing needs a second band limit here. */
    this.harmonics = Math.min(MAX_HARMONICS, Math.floor(0.5 / dt));
    for (let n = 1; n <= this.harmonics; n++) {
      const g = kernelGain(n * dt);
      this.cosCoef[n] = this.baseCos[n] * g;
      this.sinCoef[n] = this.baseSin[n] * g;
    }
  }

  /**
   * Sum of the surviving harmonics at phase t. One sine and one cosine,
   * then an angle addition recurrence for the rest, so the count of
   * transcendentals does not grow with the harmonic count.
   */
  private harmonicSum(t: number): number {
    const th = TWO_PI * t;
    const c1 = Math.cos(th);
    const s1 = Math.sin(th);
    let c = c1;
    let s = s1;
    let y = this.baseDc;
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
    let y: number;
    if (this.additive) {
      /* The residual sum is skipped outright, which is the whole of the
       * saving. An earlier revision crossfaded the two paths across a
       * transition band and so ran both, which cost about twice the
       * default over exactly the band it was meant to be saving in. */
      y = this.harmonicSum(t);
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
