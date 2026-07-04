/*
 * 2x and 4x oversampling with polyphase halfband FIR stages, for running
 * nonlinear processors (waveshapers, saturating filters) above the host
 * rate and rejecting the aliases on the way back down.
 *
 * The halfband kernel is a 33-tap Blackman-windowed sinc with cutoff at
 * a quarter of the high rate. Every even tap except the center is exactly
 * zero, so each stage runs as a 1-tap plus 16-tap polyphase pair. The odd
 * taps are renormalized so the filter has exactly unit DC gain. Measured
 * stopband rejection is better than 70 dB; the transition band spans
 * roughly 0.2 to 0.3 of the high rate.
 *
 * Factor 4 cascades two 2x stages. Each filter delays by 16 samples at
 * its own high rate, so the round trip (up then down) lands on an integer
 * number of input samples: 16 for 2x, 24 for 4x. That figure is exposed
 * as `latency`.
 */

const TAPS = 33;
const CENTER = 16;
/** Count of nonzero odd-index taps: indices 1, 3, ..., 31. */
const HALF_ODD_TAPS = 16;

function designHalfbandOddTaps(): Float64Array {
  const h = new Float64Array(HALF_ODD_TAPS);
  let sum = 0;
  for (let k = 0; k < HALF_ODD_TAPS; k++) {
    const n = 2 * k + 1;
    const m = n - CENTER; // odd offset from center, never zero
    const a = (Math.PI * m) / 2;
    const sinc = Math.sin(a) / a;
    const t = (2 * Math.PI * n) / (TAPS - 1);
    const win = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t);
    h[k] = 0.5 * sinc * win;
    sum += h[k];
  }
  // Center tap is 0.5; scale the odd branch so total DC gain is 1.
  const scale = 0.5 / sum;
  for (let k = 0; k < HALF_ODD_TAPS; k++) h[k] *= scale;
  return h;
}

const H_ODD = designHalfbandOddTaps();

/** One 2x interpolation stage. Produces two outputs per input sample. */
class HalfbandUpStage {
  private readonly hist = new Float32Array(32);
  private pos = 0;
  /** Odd-branch taps scaled by 2 to compensate zero stuffing. */
  private readonly odd2: Float64Array;

  constructor() {
    this.odd2 = new Float64Array(HALF_ODD_TAPS);
    for (let k = 0; k < HALF_ODD_TAPS; k++) this.odd2[k] = 2 * H_ODD[k];
  }

  process(input: Float32Array, from: number, to: number, out: Float32Array, outFrom: number): void {
    const hist = this.hist;
    const odd2 = this.odd2;
    let pos = this.pos;
    let o = outFrom;
    for (let i = from; i < to; i++) {
      hist[pos] = input[i];
      // Even phase: only the center tap survives, a pure delay.
      out[o++] = hist[(pos - (CENTER >> 1)) & 31];
      let acc = 0;
      for (let k = 0; k < HALF_ODD_TAPS; k++) {
        acc += odd2[k] * hist[(pos - k) & 31];
      }
      out[o++] = acc;
      pos = (pos + 1) & 31;
    }
    this.pos = pos;
  }

  reset(): void {
    this.hist.fill(0);
    this.pos = 0;
  }
}

/** One 2x decimation stage. Consumes two inputs per output sample. */
class HalfbandDownStage {
  private readonly histE = new Float32Array(32);
  private readonly histO = new Float32Array(32);
  private pos = 0;

  process(input: Float32Array, inFrom: number, count: number, out: Float32Array, outFrom: number): void {
    const histE = this.histE;
    const histO = this.histO;
    let pos = this.pos;
    let i = inFrom;
    for (let m = 0; m < count; m++) {
      histE[pos] = input[i++];
      histO[pos] = input[i++];
      // y[m] = 0.5 v[2m - 16] + sum_k h[2k + 1] v[2m - 2k - 1]
      let acc = 0.5 * histE[(pos - (CENTER >> 1)) & 31];
      for (let k = 0; k < HALF_ODD_TAPS; k++) {
        acc += H_ODD[k] * histO[(pos - k - 1) & 31];
      }
      out[outFrom + m] = acc;
      pos = (pos + 1) & 31;
    }
    this.pos = pos;
  }

  reset(): void {
    this.histE.fill(0);
    this.histO.fill(0);
    this.pos = 0;
  }
}

export class Oversampler {
  readonly factor: 2 | 4;
  /** Round-trip delay of up followed by down, in input-rate samples. */
  readonly latency: number;
  private readonly maxBlock: number;
  private readonly up1 = new HalfbandUpStage();
  private readonly down1 = new HalfbandDownStage();
  private readonly up2: HalfbandUpStage | null;
  private readonly down2: HalfbandDownStage | null;
  private readonly buf2: Float32Array;
  private readonly buf4: Float32Array | null;
  private readonly mid: Float32Array | null;
  /**
   * Views of the full high-rate buffer keyed by view length. Distinct
   * block lengths are bounded by event-boundary block splitting, so the
   * map stays small and steady-state processing never allocates.
   */
  private readonly upViews = new Map<number, Float32Array>();

  constructor(factor: 2 | 4, maxBlock: number) {
    if (factor !== 2 && factor !== 4) {
      throw new Error('Oversampler factor must be 2 or 4');
    }
    if (maxBlock < 1) throw new Error('Oversampler maxBlock must be at least 1');
    this.factor = factor;
    this.maxBlock = maxBlock;
    this.buf2 = new Float32Array(maxBlock * 2);
    if (factor === 4) {
      this.up2 = new HalfbandUpStage();
      this.down2 = new HalfbandDownStage();
      this.buf4 = new Float32Array(maxBlock * 4);
      this.mid = new Float32Array(maxBlock * 2);
      this.latency = 24;
    } else {
      this.up2 = null;
      this.down2 = null;
      this.buf4 = null;
      this.mid = null;
      this.latency = 16;
    }
  }

  /**
   * Upsample input[from..to). Returns an internal buffer holding
   * (to - from) * factor samples; contents are valid until the next call.
   */
  up(input: Float32Array, from: number, to: number): Float32Array {
    const n = to - from;
    if (n > this.maxBlock) throw new Error('Oversampler block exceeds maxBlock');
    this.up1.process(input, from, to, this.buf2, 0);
    let full: Float32Array;
    if (this.factor === 4) {
      this.up2!.process(this.buf2, 0, n * 2, this.buf4!, 0);
      full = this.buf4!;
    } else {
      full = this.buf2;
    }
    const len = n * this.factor;
    let view = this.upViews.get(len);
    if (view === undefined) {
      // View creation only happens the first time a length appears, so
      // alternating block spans stay allocation free after warmup.
      view = len === full.length ? full : full.subarray(0, len);
      this.upViews.set(len, view);
    }
    return view;
  }

  /**
   * Downsample processed (length (to - from) * factor, starting at 0)
   * into out[from..to).
   */
  down(processed: Float32Array, out: Float32Array, from: number, to: number): void {
    const n = to - from;
    if (n > this.maxBlock) throw new Error('Oversampler block exceeds maxBlock');
    if (this.factor === 4) {
      this.down2!.process(processed, 0, n * 2, this.mid!, 0);
      this.down1.process(this.mid!, 0, n, out, from);
    } else {
      this.down1.process(processed, 0, n, out, from);
    }
  }

  reset(): void {
    this.up1.reset();
    this.down1.reset();
    if (this.up2) this.up2.reset();
    if (this.down2) this.down2.reset();
  }
}
