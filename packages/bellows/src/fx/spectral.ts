/*
 * Spectral effects built on StftProcessor, plus offline phase-vocoder
 * time stretching and pitch shifting.
 *
 * Streaming effects run two independent StftProcessors, one per channel,
 * and blend against the dry signal through a latency-matched delay so
 * mix values between 0 and 1 stay phase-aligned. Stochastic effects
 * (blur, whisper) draw phases from a library rng seeded by the integer
 * `seed` param, never Math.random, so renders are reproducible.
 *
 * The pitch shifter and the offline stretcher are phase vocoders with
 * identity phase locking (Laroche-Dolson): spectral peaks are found each
 * frame, each peak's phase is propagated by its estimated instantaneous
 * frequency, and every bin in the peak's region of influence is rotated
 * by the same phasor, keeping the phase relationships inside a partial's
 * lobe intact.
 */

import { StftProcessor } from '../dsp/stft';
import { RealFft, hann } from '../dsp/fft';
import { rng } from '../core/prng';
import { clamp } from '../types';
import type { Effect, EffectDef, NamedRng, ParamSpec } from '../types';

const TWO_PI = 2 * Math.PI;

/** Wrap to (-pi, pi]. */
function princarg(x: number): number {
  return x - TWO_PI * Math.round(x / TWO_PI);
}

/**
 * Local maxima over a two-bin neighborhood. Writes peak bin indices to
 * `out`, returns the count. Bins 0..1 and the top two are never peaks.
 */
function findPeaks(mag: Float32Array, nb: number, out: Int32Array): number {
  let np = 0;
  for (let k = 2; k < nb - 2; k++) {
    const m = mag[k];
    if (
      m > 1e-9 &&
      m > mag[k - 1] &&
      m > mag[k - 2] &&
      m >= mag[k + 1] &&
      m >= mag[k + 2]
    ) {
      out[np++] = k;
    }
  }
  return np;
}

/* ------------------------------------------------------------------ */
/* Streaming effect base                                               */
/* ------------------------------------------------------------------ */

/**
 * Two StftProcessors plus a dry delay of `latency` samples so the mix
 * blend compares time-aligned signals. Subclasses implement frame() to
 * mutate one channel's bins.
 */
abstract class SpectralEffect implements Effect {
  protected mix = 1;
  protected readonly bins: number;
  protected readonly fftSize: number;
  protected readonly hopSamples: number;
  protected readonly hopSec: number;

  private readonly procL: StftProcessor;
  private readonly procR: StftProcessor;
  private readonly dryL: Float32Array;
  private readonly dryR: Float32Array;
  private readonly dryLen: number;
  private dryPos = 0;

  constructor(sampleRate: number, fftSize: number, hop: number) {
    const w = hann(fftSize);
    this.procL = new StftProcessor(fftSize, hop, w);
    this.procR = new StftProcessor(fftSize, hop, w);
    this.procL.spectral = (re, im) => this.frame(re, im, 0);
    this.procR.spectral = (re, im) => this.frame(re, im, 1);
    this.fftSize = fftSize;
    this.hopSamples = hop;
    this.hopSec = hop / sampleRate;
    this.bins = this.procL.bins;
    this.dryLen = this.procL.latency;
    this.dryL = new Float32Array(this.dryLen);
    this.dryR = new Float32Array(this.dryLen);
  }

  /** Mutate one channel's bins in place. ch is 0 (left) or 1 (right). */
  protected abstract frame(re: Float32Array, im: Float32Array, ch: number): void;

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const mix = this.mix;
    let pos = this.dryPos;
    for (let i = from; i < to; i++) {
      const dl = this.dryL[pos];
      const dr = this.dryR[pos];
      this.dryL[pos] = l[i];
      this.dryR[pos] = r[i];
      pos++;
      if (pos === this.dryLen) pos = 0;
      const wl = this.procL.tick(l[i]);
      const wr = this.procR.tick(r[i]);
      l[i] = dl + (wl - dl) * mix;
      r[i] = dr + (wr - dr) * mix;
    }
    this.dryPos = pos;
  }

  setParam(name: string, value: number): void {
    if (name === 'mix') {
      this.mix = clamp(value, 0, 1);
      return;
    }
    this.param(name, value);
  }

  /** Effect-specific parameters. Unknown names are ignored. */
  protected param(_name: string, _value: number): void {}

  reset(): void {
    this.procL.reset();
    this.procR.reset();
    this.dryL.fill(0);
    this.dryR.fill(0);
    this.dryPos = 0;
    this.clear();
  }

  /** Effect-specific state reset. */
  protected clear(): void {}
}

function initParams(fx: Effect, specs: ParamSpec[], given: Record<string, number>): Effect {
  for (const s of specs) fx.setParam(s.name, given[s.name] ?? s.default);
  return fx;
}

/* ------------------------------------------------------------------ */
/* Pitch shift                                                         */
/* ------------------------------------------------------------------ */

class PitchShiftFx extends SpectralEffect {
  private ratio = 1;
  private readonly mag: Float32Array;
  private readonly pha: Float32Array;
  private readonly outRe: Float32Array;
  private readonly outIm: Float32Array;
  private readonly peaks: Int32Array;
  private readonly prevPha: [Float32Array, Float32Array];
  private readonly phaAcc: [Float32Array, Float32Array];

  constructor(sampleRate: number) {
    super(sampleRate, 2048, 512);
    const nb = this.bins;
    this.mag = new Float32Array(nb);
    this.pha = new Float32Array(nb);
    this.outRe = new Float32Array(nb);
    this.outIm = new Float32Array(nb);
    this.peaks = new Int32Array(nb);
    this.prevPha = [new Float32Array(nb), new Float32Array(nb)];
    this.phaAcc = [new Float32Array(nb), new Float32Array(nb)];
  }

  protected override param(name: string, value: number): void {
    if (name === 'semitones') this.ratio = Math.pow(2, clamp(value, -24, 24) / 12);
  }

  protected override clear(): void {
    this.prevPha[0].fill(0);
    this.prevPha[1].fill(0);
    this.phaAcc[0].fill(0);
    this.phaAcc[1].fill(0);
  }

  protected frame(re: Float32Array, im: Float32Array, ch: number): void {
    const nb = this.bins;
    const hop = this.hopSamples;
    const n = this.fftSize;
    const mag = this.mag;
    const pha = this.pha;
    const prev = this.prevPha[ch];
    const acc = this.phaAcc[ch];
    for (let k = 0; k < nb; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      pha[k] = Math.atan2(im[k], re[k]);
    }
    const np = findPeaks(mag, nb, this.peaks);
    if (np > 0) {
      const outRe = this.outRe;
      const outIm = this.outIm;
      outRe.fill(0);
      outIm.fill(0);
      const ratio = this.ratio;
      for (let pi = 0; pi < np; pi++) {
        const p = this.peaks[pi];
        const lo = pi === 0 ? 0 : (this.peaks[pi - 1] + p + 1) >> 1;
        const hi = pi === np - 1 ? nb - 1 : (p + this.peaks[pi + 1]) >> 1;
        const omega = (TWO_PI * p) / n;
        const delta = princarg(pha[p] - prev[p] - omega * hop);
        const trueOmega = omega + delta / hop;
        const tp = Math.round(p * ratio);
        if (tp < 0 || tp > nb - 1) continue;
        // Advance the accumulated synthesis phase at the target bin by
        // the shifted frequency, then rotate the whole region by the
        // single phasor that puts the peak there (identity locking).
        const a = princarg(acc[tp] + trueOmega * ratio * hop);
        acc[tp] = a;
        const rot = a - pha[p];
        const cr = Math.cos(rot);
        const ci = Math.sin(rot);
        const off = tp - p;
        let k0 = lo;
        let k1 = hi;
        if (k0 + off < 0) k0 = -off;
        if (k1 + off > nb - 1) k1 = nb - 1 - off;
        for (let k = k0; k <= k1; k++) {
          const t = k + off;
          outRe[t] += re[k] * cr - im[k] * ci;
          outIm[t] += re[k] * ci + im[k] * cr;
        }
      }
      re.set(outRe);
      im.set(outIm);
      im[0] = 0;
      im[nb - 1] = 0;
    }
    prev.set(pha);
  }
}

export const pitchshiftDef: EffectDef = {
  id: 'pitchshift',
  label: 'Pitch Shift',
  params: [
    { name: 'semitones', min: -24, max: 24, default: 0, curve: 'lin', unit: 'st' },
    { name: 'mix', min: 0, max: 1, default: 1, curve: 'lin' },
  ],
  create(sampleRate, params) {
    return initParams(new PitchShiftFx(sampleRate), this.params, params);
  },
};

/* ------------------------------------------------------------------ */
/* Freeze                                                              */
/* ------------------------------------------------------------------ */

class FreezeFx extends SpectralEffect {
  private freezeOn = false;
  private readonly captured = [false, false];
  private readonly pha: Float32Array;
  private readonly prevPha: [Float32Array, Float32Array];
  private readonly delta: [Float32Array, Float32Array];
  private readonly heldMag: [Float32Array, Float32Array];
  private readonly acc: [Float32Array, Float32Array];

  constructor(sampleRate: number) {
    super(sampleRate, 2048, 512);
    const nb = this.bins;
    this.pha = new Float32Array(nb);
    this.prevPha = [new Float32Array(nb), new Float32Array(nb)];
    this.delta = [new Float32Array(nb), new Float32Array(nb)];
    this.heldMag = [new Float32Array(nb), new Float32Array(nb)];
    this.acc = [new Float32Array(nb), new Float32Array(nb)];
  }

  protected override param(name: string, value: number): void {
    if (name === 'freeze') this.freezeOn = value > 0.5;
  }

  protected override clear(): void {
    this.captured[0] = false;
    this.captured[1] = false;
    for (const arr of [...this.prevPha, ...this.delta, ...this.heldMag, ...this.acc]) {
      arr.fill(0);
    }
  }

  protected frame(re: Float32Array, im: Float32Array, ch: number): void {
    const nb = this.bins;
    const pha = this.pha;
    const prev = this.prevPha[ch];
    const delta = this.delta[ch];
    for (let k = 0; k < nb; k++) pha[k] = Math.atan2(im[k], re[k]);
    if (!this.freezeOn) {
      // Track the per-hop phase advance so a freeze can start any time.
      this.captured[ch] = false;
      for (let k = 0; k < nb; k++) {
        delta[k] = princarg(pha[k] - prev[k]);
        prev[k] = pha[k];
      }
      return; // passthrough
    }
    const mag = this.heldMag[ch];
    const acc = this.acc[ch];
    if (!this.captured[ch]) {
      this.captured[ch] = true;
      for (let k = 0; k < nb; k++) {
        mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        delta[k] = princarg(pha[k] - prev[k]);
        acc[k] = pha[k];
        prev[k] = pha[k];
      }
      return; // this frame already is the held frame
    }
    for (let k = 0; k < nb; k++) {
      const a = princarg(acc[k] + delta[k]);
      acc[k] = a;
      re[k] = mag[k] * Math.cos(a);
      im[k] = mag[k] * Math.sin(a);
    }
    im[0] = 0;
    im[nb - 1] = 0;
  }
}

export const freezeDef: EffectDef = {
  id: 'freeze',
  label: 'Spectral Freeze',
  params: [
    { name: 'freeze', min: 0, max: 1, default: 0, curve: 'lin' },
    { name: 'mix', min: 0, max: 1, default: 1, curve: 'lin' },
  ],
  create(sampleRate, params) {
    return initParams(new FreezeFx(sampleRate), this.params, params);
  },
};

/* ------------------------------------------------------------------ */
/* Blur                                                                */
/* ------------------------------------------------------------------ */

class BlurFx extends SpectralEffect {
  private random: NamedRng = rng('fx/blur/1');
  private coeff = 1;
  private readonly avg: [Float32Array, Float32Array];

  constructor(sampleRate: number) {
    super(sampleRate, 2048, 512);
    this.avg = [new Float32Array(this.bins), new Float32Array(this.bins)];
  }

  protected override param(name: string, value: number): void {
    if (name === 'amount') {
      // amount 0..1 maps to a magnitude averaging time of 0..2 seconds.
      const timeSec = clamp(value, 0, 1) * 2;
      this.coeff = timeSec < 1e-3 ? 1 : 1 - Math.exp(-this.hopSec / timeSec);
    } else if (name === 'seed') {
      this.random = rng('fx/blur/' + Math.floor(value));
    }
  }

  protected override clear(): void {
    this.avg[0].fill(0);
    this.avg[1].fill(0);
  }

  protected frame(re: Float32Array, im: Float32Array, ch: number): void {
    const nb = this.bins;
    const avg = this.avg[ch];
    const coeff = this.coeff;
    const random = this.random;
    for (let k = 0; k < nb; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const a = avg[k] + coeff * (m - avg[k]);
      avg[k] = a;
      const ph = random() * TWO_PI;
      re[k] = a * Math.cos(ph);
      im[k] = a * Math.sin(ph);
    }
    im[0] = 0;
    im[nb - 1] = 0;
  }
}

export const blurDef: EffectDef = {
  id: 'blur',
  label: 'Spectral Blur',
  params: [
    { name: 'amount', min: 0, max: 1, default: 0.5, curve: 'lin' },
    { name: 'mix', min: 0, max: 1, default: 1, curve: 'lin' },
    { name: 'seed', min: 0, max: 1e9, default: 1, curve: 'lin' },
  ],
  create(sampleRate, params) {
    return initParams(new BlurFx(sampleRate), this.params, params);
  },
};

/* ------------------------------------------------------------------ */
/* Robot                                                               */
/* ------------------------------------------------------------------ */

class RobotFx extends SpectralEffect {
  constructor(sampleRate: number) {
    // The fixed hop sets the monotone pitch: sampleRate / 256.
    super(sampleRate, 1024, 256);
  }

  protected frame(re: Float32Array, im: Float32Array): void {
    // Zero phase in a center-of-window sense: alternating signs are the
    // linear phase that parks the pulse mid-frame, where the synthesis
    // window has gain. Plain zero phase would put it at the frame edge
    // and the hann window would erase it.
    const nb = this.bins;
    for (let k = 0; k < nb; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      re[k] = (k & 1) === 0 ? m : -m;
      im[k] = 0;
    }
  }
}

export const robotDef: EffectDef = {
  id: 'robot',
  label: 'Robotize',
  params: [{ name: 'mix', min: 0, max: 1, default: 1, curve: 'lin' }],
  create(sampleRate, params) {
    return initParams(new RobotFx(sampleRate), this.params, params);
  },
};

/* ------------------------------------------------------------------ */
/* Whisper                                                             */
/* ------------------------------------------------------------------ */

class WhisperFx extends SpectralEffect {
  private random: NamedRng = rng('fx/whisper/1');

  constructor(sampleRate: number) {
    super(sampleRate, 1024, 256);
  }

  protected override param(name: string, value: number): void {
    if (name === 'seed') this.random = rng('fx/whisper/' + Math.floor(value));
  }

  protected frame(re: Float32Array, im: Float32Array): void {
    const nb = this.bins;
    const random = this.random;
    for (let k = 0; k < nb; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const ph = random() * TWO_PI;
      re[k] = m * Math.cos(ph);
      im[k] = m * Math.sin(ph);
    }
    im[0] = 0;
    im[nb - 1] = 0;
  }
}

export const whisperDef: EffectDef = {
  id: 'whisper',
  label: 'Whisper',
  params: [
    { name: 'mix', min: 0, max: 1, default: 1, curve: 'lin' },
    { name: 'seed', min: 0, max: 1e9, default: 1, curve: 'lin' },
  ],
  create(sampleRate, params) {
    return initParams(new WhisperFx(sampleRate), this.params, params);
  },
};

/* ------------------------------------------------------------------ */
/* Denoise                                                             */
/* ------------------------------------------------------------------ */

/** Residual magnitude never drops below this fraction of the input. */
const DENOISE_FLOOR = 0.02;
/** Noise floor estimate rise rate in dB per second. */
const DENOISE_RISE_DB_PER_SEC = 1.5;
/** One-pole magnitude smoothing time feeding the minimum tracker. */
const DENOISE_SMOOTH_SEC = 0.05;
/**
 * Frames to wait before the floor starts capturing, covering the STFT
 * ramp-in and the smoother's own convergence from zero.
 */
const DENOISE_WARMUP_FRAMES = 10;

class DenoiseFx extends SpectralEffect {
  private amount = 1;
  private readonly rise: number;
  private readonly smoothCoeff: number;
  private readonly warmup = [0, 0];
  private readonly smooth: [Float32Array, Float32Array];
  private readonly floor: [Float32Array, Float32Array];

  constructor(sampleRate: number) {
    super(sampleRate, 2048, 512);
    this.rise = Math.pow(10, (DENOISE_RISE_DB_PER_SEC * this.hopSec) / 20);
    this.smoothCoeff = 1 - Math.exp(-this.hopSec / DENOISE_SMOOTH_SEC);
    const nb = this.bins;
    this.smooth = [new Float32Array(nb), new Float32Array(nb)];
    this.floor = [new Float32Array(nb).fill(Infinity), new Float32Array(nb).fill(Infinity)];
  }

  protected override param(name: string, value: number): void {
    if (name === 'amount') this.amount = clamp(value, 0, 4);
  }

  protected override clear(): void {
    this.warmup[0] = 0;
    this.warmup[1] = 0;
    this.smooth[0].fill(0);
    this.smooth[1].fill(0);
    this.floor[0].fill(Infinity);
    this.floor[1].fill(Infinity);
  }

  protected frame(re: Float32Array, im: Float32Array, ch: number): void {
    const nb = this.bins;
    const smooth = this.smooth[ch];
    const floor = this.floor[ch];
    const a = this.smoothCoeff;
    const rise = this.rise;
    const amount = this.amount;
    // During warmup the frames are the zero-padded STFT ramp-in and the
    // smoother is still converging from zero, so the floor must not
    // capture yet or it would lock onto a near-zero estimate.
    const capture = this.warmup[ch] >= DENOISE_WARMUP_FRAMES;
    if (!capture) this.warmup[ch]++;
    for (let k = 0; k < nb; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      // Smooth the magnitude, track its running minimum with a slow
      // exponential rise so the floor recovers after loud passages.
      const sm = smooth[k] + a * (m - smooth[k]);
      smooth[k] = sm;
      let f = floor[k];
      if (capture) {
        f = sm < f ? sm : f * rise + 1e-9;
        floor[k] = f;
      }
      if (f === Infinity) continue; // warmup: pass the bin through
      let target = m - amount * f;
      const least = m * DENOISE_FLOOR;
      if (target < least) target = least;
      const g = m > 1e-12 ? target / m : 0;
      re[k] *= g;
      im[k] *= g;
    }
  }
}

export const denoiseDef: EffectDef = {
  id: 'denoise',
  label: 'Spectral Denoise',
  params: [
    { name: 'amount', min: 0, max: 4, default: 1, curve: 'lin' },
    { name: 'mix', min: 0, max: 1, default: 1, curve: 'lin' },
  ],
  create(sampleRate, params) {
    return initParams(new DenoiseFx(sampleRate), this.params, params);
  },
};

export const spectralEffects: EffectDef[] = [
  pitchshiftDef,
  freezeDef,
  blurDef,
  robotDef,
  whisperDef,
  denoiseDef,
];

/* ------------------------------------------------------------------ */
/* Offline phase vocoder                                               */
/* ------------------------------------------------------------------ */

export interface TimeStretchOptions {
  /** Analysis window length, power of two. Default 2048. */
  fftSize?: number;
  /** Synthesis hop in samples. Default fftSize / 4. */
  hop?: number;
}

/**
 * Phase-vocoder time stretch with identity phase locking. ratio is
 * output duration over input duration, clamped to [0.25, 4]: ratio 2
 * doubles the length without changing pitch. sampleRate is accepted for
 * API symmetry; the algorithm is rate-independent.
 */
export function timeStretch(
  input: Float32Array,
  _sampleRate: number,
  ratio: number,
  opts?: TimeStretchOptions
): Float32Array {
  const r = clamp(ratio, 0.25, 4);
  const n = opts?.fftSize ?? 2048;
  const hs = opts?.hop ?? n >> 2;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('fftSize must be a power of two');
  if (!Number.isInteger(hs) || hs < 1 || hs > n) throw new Error('hop must be in [1, fftSize]');
  const outLen = Math.round(input.length * r);
  if (input.length === 0 || outLen === 0) return new Float32Array(0);

  const win = hann(n);
  const fft = new RealFft(n);
  const nb = (n >> 1) + 1;
  const ha = hs / r; // fractional analysis hop
  const acc = new Float64Array(outLen + n + hs);
  const norm = new Float64Array(acc.length);
  const seg = new Float32Array(n);
  const re = new Float32Array(nb);
  const im = new Float32Array(nb);
  const outRe = new Float32Array(nb);
  const outIm = new Float32Array(nb);
  const mag = new Float32Array(nb);
  const pha = new Float32Array(nb);
  const prevPha = new Float32Array(nb);
  const synPha = new Float32Array(nb);
  const newSynPha = new Float32Array(nb);
  const peaks = new Int32Array(nb);

  let prevAnaPos = 0;
  for (let i = 0; ; i++) {
    const anaPos = Math.round(i * ha);
    const synPos = i * hs;
    if (i > 0 && (anaPos >= input.length || synPos >= outLen)) break;

    for (let j = 0; j < n; j++) {
      const s = anaPos + j;
      seg[j] = (s < input.length ? input[s] : 0) * win[j];
    }
    fft.forward(seg, re, im);
    for (let k = 0; k < nb; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      pha[k] = Math.atan2(im[k], re[k]);
    }

    if (i === 0) {
      outRe.set(re);
      outIm.set(im);
      synPha.set(pha);
    } else {
      const dt = Math.max(1, anaPos - prevAnaPos);
      const np = findPeaks(mag, nb, peaks);
      if (np === 0) {
        outRe.set(re);
        outIm.set(im);
        newSynPha.set(pha);
      } else {
        for (let pi = 0; pi < np; pi++) {
          const p = peaks[pi];
          const lo = pi === 0 ? 0 : (peaks[pi - 1] + p + 1) >> 1;
          const hi = pi === np - 1 ? nb - 1 : (p + peaks[pi + 1]) >> 1;
          const omega = (TWO_PI * p) / n;
          const delta = princarg(pha[p] - prevPha[p] - omega * dt);
          const trueOmega = omega + delta / dt;
          // Propagate the peak's synthesis phase by its instantaneous
          // frequency over the synthesis hop, rotate the region with it.
          const rot = princarg(synPha[p] + trueOmega * hs - pha[p]);
          const cr = Math.cos(rot);
          const ci = Math.sin(rot);
          for (let k = lo; k <= hi; k++) {
            outRe[k] = re[k] * cr - im[k] * ci;
            outIm[k] = re[k] * ci + im[k] * cr;
            newSynPha[k] = pha[k] + rot;
          }
        }
      }
      synPha.set(newSynPha);
    }
    prevPha.set(pha);
    prevAnaPos = anaPos;

    outIm[0] = 0;
    outIm[nb - 1] = 0;
    fft.inverse(outRe, outIm, seg);
    for (let j = 0; j < n; j++) {
      const p = synPos + j;
      acc[p] += seg[j] * win[j];
      norm[p] += win[j] * win[j];
    }
  }

  const out = new Float32Array(outLen);
  for (let p = 0; p < outLen; p++) {
    out[p] = norm[p] > 1e-3 ? acc[p] / norm[p] : 0;
  }
  return out;
}

/** Catmull-Rom read with edge clamping. */
function cubicAt(buf: Float32Array, pos: number): number {
  const last = buf.length - 1;
  const i = Math.floor(pos);
  const t = pos - i;
  const xm1 = buf[i - 1 < 0 ? 0 : i - 1 > last ? last : i - 1];
  const x0 = buf[i < 0 ? 0 : i > last ? last : i];
  const x1 = buf[i + 1 < 0 ? 0 : i + 1 > last ? last : i + 1];
  const x2 = buf[i + 2 < 0 ? 0 : i + 2 > last ? last : i + 2];
  return (
    0.5 *
    (2 * x0 +
      (x1 - xm1) * t +
      (2 * xm1 - 5 * x0 + 4 * x1 - x2) * t * t +
      (3 * x0 - xm1 - 3 * x1 + x2) * t * t * t)
  );
}

/**
 * Offline pitch shift: time stretch by 2^(semitones/12), then resample
 * back to the original duration with a cubic interpolator. semitones is
 * clamped to [-24, 24]. Output length is within one sample of the input.
 */
export function pitchShiftOffline(
  input: Float32Array,
  sampleRate: number,
  semitones: number
): Float32Array {
  const ratio = Math.pow(2, clamp(semitones, -24, 24) / 12);
  if (input.length === 0) return new Float32Array(0);
  const stretched = timeStretch(input, sampleRate, ratio);
  const outLen = Math.round(stretched.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = cubicAt(stretched, i * ratio);
  }
  return out;
}
