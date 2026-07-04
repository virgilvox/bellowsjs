/*
 * EBU R128 / ITU-R BS.1770-4 loudness metering.
 *
 * K-weighting is two biquads: a +4 dB high shelf near 1681.97 Hz (the
 * "head" pre-filter) followed by a high-pass near 38.13 Hz (the revised
 * low-cut). BS.1770 only publishes the 48 kHz coefficient table, but the
 * table is the bilinear transform of a fixed analog prototype, so the
 * coefficients for any rate follow from the prototype parameters with
 * K = tan(pi f0 / fs) prewarping:
 *
 *   shelf: f0 = 1681.9744509555319 Hz, Q = 0.7071752369554196,
 *          gain G = 3.999843853973347 dB,
 *          Vh = 10^(G/20), Vb = Vh^0.4996667741545416,
 *          d  = 1 + K/Q + K^2
 *          b = [(Vh + Vb K/Q + K^2)/d, 2(K^2 - Vh)/d, (Vh - Vb K/Q + K^2)/d]
 *          a = [1, 2(K^2 - 1)/d, (1 - K/Q + K^2)/d]
 *
 *   high-pass: f0 = 38.13547087602444 Hz, Q = 0.5003270373238773,
 *          b = [1, -2, 1] (the table's unnormalized numerator),
 *          a as above with this f0 and Q.
 *
 * The parameters are the ones recovered from the spec table by De Man
 * (2014); at fs = 48000 these formulas reproduce the published
 * coefficients to double precision, which the tests assert.
 *
 * Measurement follows BS.1770-4 and EBU Tech 3341/3342: mean square of
 * the K-weighted signal per channel with unit channel weights for mono
 * and stereo, 400 ms momentary and 3 s short-term windows at 75 percent
 * overlap, integrated loudness with absolute (-70 LUFS) then relative
 * (-10 LU) gating over 400 ms blocks, loudness range from short-term
 * values with a -20 LU relative gate between the 10th and 95th
 * percentiles, and true peak from a 4x oversampled absolute maximum.
 *
 * Internally energy is accumulated in 50 ms segments, which divides
 * every window and hop exactly: momentary = 8 segments stepping 2,
 * short-term = 60 segments, LRA hop = 15 segments (750 ms).
 *
 * Calibration: a full-scale 997 Hz sine in one channel measures
 * -3.01 LUFS (the -0.691 offset cancels the K-filter gain at 997 Hz);
 * with both stereo channels driven it measures 3.01 LU higher.
 */

import { Oversampler } from '../dsp/oversample';

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function shelfCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 1681.9744509555319;
  const q = 0.7071752369554196;
  const gainDb = 3.999843853973347;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = Math.pow(10, gainDb / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const d = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / d,
    b1: (2 * (k * k - vh)) / d,
    b2: (vh - (vb * k) / q + k * k) / d,
    a1: (2 * (k * k - 1)) / d,
    a2: (1 - k / q + k * k) / d,
  };
}

function highpassCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const d = 1 + k / q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / d,
    a2: (1 - k / q + k * k) / d,
  };
}

/** Both K-weighting stages for an arbitrary sample rate. */
export function kWeightingCoeffs(sampleRate: number): {
  shelf: BiquadCoeffs;
  highpass: BiquadCoeffs;
} {
  return { shelf: shelfCoeffs(sampleRate), highpass: highpassCoeffs(sampleRate) };
}

/** Direct form II transposed biquad. Private to the meter. */
class Biquad {
  private readonly c: BiquadCoeffs;
  private z1 = 0;
  private z2 = 0;

  constructor(c: BiquadCoeffs) {
    this.c = c;
  }

  /** In-place over buf[from..to). */
  process(buf: Float32Array, from: number, to: number): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = from; i < to; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

const SEGMENTS_MOMENTARY = 8; // 400 ms of 50 ms segments
const SEGMENTS_SHORT = 60; // 3 s
const BLOCK_HOP = 2; // 100 ms gating block hop, 75 percent overlap
const LRA_HOP = 15; // 750 ms short-term hop, 75 percent overlap
const ABS_GATE = -70; // LUFS
const REL_GATE = -10; // LU below the abs-gated mean, integrated
const LRA_REL_GATE = -20; // LU below the abs-gated mean, LRA
const CHUNK = 1024;

function lufsOf(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

/** Linear interpolation percentile over a sorted array, p in [0, 1]. */
function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Streaming loudness meter for one or two channels.
 *
 * push takes separate per-channel buffers over an index range: mono
 * meters pass null for the right channel, stereo meters must pass both
 * and the ranges must cover the same frames on each. Interleaved input
 * is not accepted; deinterleave before pushing.
 *
 * Poll methods: momentary() and shortTerm() return the loudness of the
 * trailing window in LUFS (window positions quantize to the 50 ms
 * segment grid), integrated() applies the two-stage gate over
 * everything since construction or reset, range() returns the loudness
 * range in LU, truePeak() the largest 4x-oversampled absolute sample
 * value as a linear gain (convert with gainToDb for dBTP). Methods
 * return -Infinity (or 0 for range) until enough audio has arrived.
 */
export class LoudnessMeter {
  readonly channels: 1 | 2;
  private readonly segLen: number;
  private readonly shelfL: Biquad;
  private readonly hpL: Biquad;
  private readonly shelfR: Biquad | null;
  private readonly hpR: Biquad | null;
  private readonly ovsL: Oversampler;
  private readonly ovsR: Oversampler | null;
  private readonly scratchL = new Float32Array(CHUNK);
  private readonly scratchR: Float32Array | null;

  /** Per-segment sum of squares over all channels. */
  private segSums: number[] = [];
  /** 400 ms gating block powers (mean square, channel summed). */
  private blockPowers: number[] = [];
  /** Short-term powers on the 750 ms grid, for LRA. */
  private stPowers: number[] = [];
  private segAccum = 0;
  private segRemaining: number;
  private peak = 0;

  constructor(sampleRate: number, channels: 1 | 2) {
    if (channels !== 1 && channels !== 2) {
      throw new Error('LoudnessMeter channels must be 1 or 2');
    }
    this.channels = channels;
    this.segLen = Math.round(0.05 * sampleRate);
    this.segRemaining = this.segLen;
    const coeffs = kWeightingCoeffs(sampleRate);
    this.shelfL = new Biquad(coeffs.shelf);
    this.hpL = new Biquad(coeffs.highpass);
    this.ovsL = new Oversampler(4, CHUNK);
    if (channels === 2) {
      this.shelfR = new Biquad(coeffs.shelf);
      this.hpR = new Biquad(coeffs.highpass);
      this.ovsR = new Oversampler(4, CHUNK);
      this.scratchR = new Float32Array(CHUNK);
    } else {
      this.shelfR = null;
      this.hpR = null;
      this.ovsR = null;
      this.scratchR = null;
    }
  }

  /**
   * Feed left[from..to) and, for stereo meters, right[from..to).
   * Input buffers are not modified.
   */
  push(left: Float32Array, right: Float32Array | null, from: number, to: number): void {
    if (this.channels === 2 && right === null) {
      throw new Error('stereo LoudnessMeter needs both channels');
    }
    let i = from;
    while (i < to) {
      const n = Math.min(CHUNK, to - i);
      this.pushChunk(left, right, i, i + n);
      i += n;
    }
  }

  private pushChunk(left: Float32Array, right: Float32Array | null, from: number, to: number): void {
    const n = to - from;
    const sL = this.scratchL;

    // True peak on the raw signal, before weighting.
    const upL = this.ovsL.up(left, from, to);
    for (let k = 0; k < n * 4; k++) {
      const a = Math.abs(upL[k]);
      if (a > this.peak) this.peak = a;
    }
    for (let k = from; k < to; k++) {
      const a = Math.abs(left[k]);
      if (a > this.peak) this.peak = a;
    }

    sL.set(left.subarray(from, to));
    this.shelfL.process(sL, 0, n);
    this.hpL.process(sL, 0, n);

    let sR: Float32Array | null = null;
    if (this.channels === 2 && right !== null) {
      const upR = this.ovsR!.up(right, from, to);
      for (let k = 0; k < n * 4; k++) {
        const a = Math.abs(upR[k]);
        if (a > this.peak) this.peak = a;
      }
      for (let k = from; k < to; k++) {
        const a = Math.abs(right[k]);
        if (a > this.peak) this.peak = a;
      }
      sR = this.scratchR!;
      sR.set(right.subarray(from, to));
      this.shelfR!.process(sR, 0, n);
      this.hpR!.process(sR, 0, n);
    }

    for (let k = 0; k < n; k++) {
      let e = sL[k] * sL[k];
      if (sR !== null) e += sR[k] * sR[k];
      this.segAccum += e;
      this.segRemaining--;
      if (this.segRemaining === 0) {
        this.finishSegment();
      }
    }
  }

  private finishSegment(): void {
    this.segSums.push(this.segAccum);
    this.segAccum = 0;
    this.segRemaining = this.segLen;
    const count = this.segSums.length;
    if (count >= SEGMENTS_MOMENTARY && count % BLOCK_HOP === 0) {
      this.blockPowers.push(this.trailingPower(SEGMENTS_MOMENTARY));
    }
    if (count >= SEGMENTS_SHORT && count % LRA_HOP === 0) {
      this.stPowers.push(this.trailingPower(SEGMENTS_SHORT));
    }
  }

  /** Mean square per channel-sum over the trailing `segments` segments. */
  private trailingPower(segments: number): number {
    const sums = this.segSums;
    let total = 0;
    for (let i = sums.length - segments; i < sums.length; i++) total += sums[i];
    return total / (segments * this.segLen);
  }

  /** Loudness of the trailing 400 ms in LUFS, -Infinity until filled. */
  momentary(): number {
    if (this.segSums.length < SEGMENTS_MOMENTARY) return -Infinity;
    return lufsOf(this.trailingPower(SEGMENTS_MOMENTARY));
  }

  /** Loudness of the trailing 3 s in LUFS, -Infinity until filled. */
  shortTerm(): number {
    if (this.segSums.length < SEGMENTS_SHORT) return -Infinity;
    return lufsOf(this.trailingPower(SEGMENTS_SHORT));
  }

  /** Gated integrated loudness in LUFS, -Infinity when nothing passes the gates. */
  integrated(): number {
    const abs: number[] = [];
    for (const z of this.blockPowers) {
      if (lufsOf(z) > ABS_GATE) abs.push(z);
    }
    if (abs.length === 0) return -Infinity;
    let mean = 0;
    for (const z of abs) mean += z;
    mean /= abs.length;
    const relThreshold = lufsOf(mean) + REL_GATE;
    let gatedMean = 0;
    let gatedCount = 0;
    for (const z of abs) {
      if (lufsOf(z) > relThreshold) {
        gatedMean += z;
        gatedCount++;
      }
    }
    if (gatedCount === 0) return -Infinity;
    return lufsOf(gatedMean / gatedCount);
  }

  /** Loudness range in LU per EBU Tech 3342. 0 until two gated windows exist. */
  range(): number {
    const abs: number[] = [];
    for (const z of this.stPowers) {
      const l = lufsOf(z);
      if (l > ABS_GATE) abs.push(l);
    }
    if (abs.length < 2) return 0;
    let meanZ = 0;
    for (const l of abs) meanZ += Math.pow(10, (l + 0.691) / 10);
    meanZ /= abs.length;
    const relThreshold = lufsOf(meanZ) + LRA_REL_GATE;
    const gated = abs.filter((l) => l > relThreshold).sort((a, b) => a - b);
    if (gated.length < 2) return 0;
    return percentile(gated, 0.95) - percentile(gated, 0.1);
  }

  /** Largest observed true-peak absolute value, linear. */
  truePeak(): number {
    return this.peak;
  }

  reset(): void {
    this.segSums = [];
    this.blockPowers = [];
    this.stPowers = [];
    this.segAccum = 0;
    this.segRemaining = this.segLen;
    this.peak = 0;
    this.shelfL.reset();
    this.hpL.reset();
    this.ovsL.reset();
    if (this.shelfR) this.shelfR.reset();
    if (this.hpR) this.hpR.reset();
    if (this.ovsR) this.ovsR.reset();
  }
}
