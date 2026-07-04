/*
 * Mipmapped wavetables. A WavetableSet holds one or more single cycle
 * frames plus band limited copies per octave, built by FFT truncation:
 * level 0 keeps everything below the table Nyquist, each level down
 * halves the highest kept harmonic. The oscillator picks the level
 * whose top harmonic stays under the output Nyquist for the current
 * frequency, then interpolates linearly across phase and across frames
 * for position scanning.
 *
 * The FFT here is module private on purpose: src/dsp/fft.ts is a
 * separate domain and this file must not depend on it.
 */

import { clamp } from '../types';

/* ------------------------------------------------------------------ */
/* Private radix-2 complex FFT, build time only                        */
/* ------------------------------------------------------------------ */

function fftInPlace(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * cr - im[i + k + half] * ci;
        const vi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/* ------------------------------------------------------------------ */
/* WavetableSet                                                        */
/* ------------------------------------------------------------------ */

export class WavetableSet {
  readonly frameCount: number;
  /** Single cycle length, power of two. */
  readonly tableLength: number;
  readonly sampleRate: number;
  /** levels[l][frame], harmonics above maxHarm[l] removed. Internal to this module. */
  readonly levels: Float32Array[][];
  /** Highest harmonic kept at each level, strictly decreasing down to 1. */
  readonly maxHarm: number[];

  private constructor(
    levels: Float32Array[][],
    maxHarm: number[],
    frameCount: number,
    tableLength: number,
    sampleRate: number,
  ) {
    this.levels = levels;
    this.maxHarm = maxHarm;
    this.frameCount = frameCount;
    this.tableLength = tableLength;
    this.sampleRate = sampleRate;
  }

  /**
   * frames: single cycle waveforms, all the same power of two length.
   * Builds the band limited mipmap chain internally.
   */
  static fromFrames(frames: Float32Array[], sampleRate: number): WavetableSet {
    if (frames.length === 0) throw new Error('WavetableSet needs at least one frame');
    const n = frames[0].length;
    if (!isPowerOfTwo(n) || n < 4) {
      throw new Error('wavetable frame length must be a power of two, at least 4');
    }
    for (const f of frames) {
      if (f.length !== n) throw new Error('all wavetable frames must share one length');
    }

    // top level keeps every harmonic below the table Nyquist
    const maxHarm: number[] = [];
    for (let h = (n >> 1) - 1; h >= 1; h >>= 1) maxHarm.push(h);

    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const specRe: Float64Array[] = [];
    const specIm: Float64Array[] = [];
    for (const frame of frames) {
      for (let i = 0; i < n; i++) {
        re[i] = frame[i];
        im[i] = 0;
      }
      fftInPlace(re, im, false);
      specRe.push(re.slice());
      specIm.push(im.slice());
    }

    const levels: Float32Array[][] = [];
    for (let l = 0; l < maxHarm.length; l++) {
      const keep = maxHarm[l];
      const levelFrames: Float32Array[] = [];
      for (let f = 0; f < frames.length; f++) {
        const sr = specRe[f];
        const si = specIm[f];
        for (let k = 0; k < n; k++) {
          const harm = k <= n >> 1 ? k : n - k;
          if (harm > keep || harm === n >> 1) {
            re[k] = 0;
            im[k] = 0;
          } else {
            re[k] = sr[k];
            im[k] = si[k];
          }
        }
        fftInPlace(re, im, true);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = re[i];
        levelFrames.push(out);
      }
      levels.push(levelFrames);
    }

    return new WavetableSet(levels, maxHarm, frames.length, n, sampleRate);
  }

  /** Smallest mip level whose top harmonic stays below the output Nyquist at hz. */
  levelFor(hz: number): number {
    if (hz <= 0) return 0;
    const allowed = this.sampleRate / (2 * hz);
    const last = this.maxHarm.length - 1;
    for (let l = 0; l <= last; l++) {
      if (this.maxHarm[l] <= allowed) return l;
    }
    return last;
  }
}

/* ------------------------------------------------------------------ */
/* Classic shapes                                                      */
/* ------------------------------------------------------------------ */

const CLASSIC_LENGTH = 2048;

function frameFromSineAmps(amps: (k: number) => number): Float32Array {
  const n = CLASSIC_LENGTH;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 1; k < n >> 1; k++) {
    const a = amps(k);
    if (a === 0) continue;
    // x[n] = sum a_k sin(2 pi k n / N)  <=>  X[k] = -i a_k N/2
    im[k] = (-a * n) / 2;
    im[n - k] = (a * n) / 2;
  }
  fftInPlace(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i];
  return out;
}

/** Full bandwidth saw, square and triangle sets built from Fourier series. */
export function classicWavetables(sampleRate: number): {
  saw: WavetableSet;
  square: WavetableSet;
  triangle: WavetableSet;
} {
  // rising ramp 2t - 1
  const saw = frameFromSineAmps((k) => -2 / (Math.PI * k));
  // +1 on the first half cycle
  const square = frameFromSineAmps((k) => (k % 2 === 1 ? 4 / (Math.PI * k) : 0));
  // rises through 0 at t = 0, peak +1 at t = 0.25
  const triangle = frameFromSineAmps((k) =>
    k % 2 === 1 ? ((8 / (Math.PI * Math.PI)) * (k % 4 === 1 ? 1 : -1)) / (k * k) : 0,
  );
  return {
    saw: WavetableSet.fromFrames([saw], sampleRate),
    square: WavetableSet.fromFrames([square], sampleRate),
    triangle: WavetableSet.fromFrames([triangle], sampleRate),
  };
}

/* ------------------------------------------------------------------ */
/* WavetableOscillator                                                 */
/* ------------------------------------------------------------------ */

export class WavetableOscillator {
  private readonly sampleRate: number;
  private set: WavetableSet;
  private phase = 0;
  private dt = 0;
  private hz = 0;
  private level = 0;
  private pos = 0;

  constructor(sampleRate: number, set: WavetableSet) {
    this.sampleRate = sampleRate;
    this.set = set;
  }

  setTable(set: WavetableSet): void {
    this.set = set;
    this.level = set.levelFor(this.hz);
  }

  setFreq(hz: number): void {
    this.hz = hz;
    this.dt = clamp(hz / this.sampleRate, 0, 0.5);
    this.level = this.set.levelFor(hz);
  }

  /** 0..1 scan across frames, linear crossfade between neighbours. */
  setPosition(pos: number): void {
    this.pos = clamp(pos, 0, 1);
  }

  reset(phase = 0): void {
    this.phase = phase - Math.floor(phase);
  }

  next(): number {
    const set = this.set;
    const frames = set.levels[this.level];
    const n = set.tableLength;
    const mask = n - 1;

    const x = this.phase * n;
    const xi = Math.floor(x);
    const xf = x - xi;
    const i0 = xi & mask;
    const i1 = (xi + 1) & mask;

    const fpos = this.pos * (set.frameCount - 1);
    const f0 = Math.floor(fpos);
    const ff = fpos - f0;
    const a = frames[f0];
    const s0 = a[i0] + (a[i1] - a[i0]) * xf;
    let y = s0;
    if (ff > 0) {
      const b = frames[f0 + 1];
      const s1 = b[i0] + (b[i1] - b[i0]) * xf;
      y = s0 + (s1 - s0) * ff;
    }

    this.phase += this.dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }
}
