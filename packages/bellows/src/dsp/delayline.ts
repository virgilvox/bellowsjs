/*
 * Fractional delay line over a power-of-two ring buffer. One writer,
 * arbitrary readers. readInt(0) is the sample most recently written.
 * readLinear and readCubic interpolate between integer taps; readCubic
 * uses the 4-point Catmull-Rom (Hermite) kernel, so it needs one sample
 * of lookahead on the new side and clamps its delay to at least 1.
 */

/*
 * Largest capacity the ring can express, saturating rather than wrapping the
 * way DelayLineExt::Init does for its own degenerate size. Rounding up to a
 * power of two means the buffer holds up to 2^30 floats, and 2^30 is the last
 * power of two a 32-bit shift can carry: 1 << 31 is negative. Measured with
 * the old `while (n < maxSamples + 4) n <<= 1`, 1073741820 terminated after 30
 * shifts and 1073741821 spun forever, because n runs 2^30, -2147483648, 0, 0
 * and every one of those is below maxSamples + 4. Nothing rescues that: the
 * loop never allocates, so it is an unkillable spin rather than an out-of-
 * memory throw, and node does not run out anyway (`new Float32Array(2 ** 30)`
 * succeeds here and reserves 4 GiB). A throw is the only useful answer.
 */
const MAX_SAMPLES = 2 ** 30 - 4;

export class DelayLine {
  /** Largest delay readInt and readLinear accept. */
  readonly maxDelay: number;
  private readonly buf: Float32Array;
  private readonly mask: number;
  private w = 0;

  constructor(maxSamples: number) {
    if (maxSamples < 1 || !Number.isFinite(maxSamples)) {
      throw new Error('DelayLine maxSamples must be a positive number');
    }
    if (maxSamples > MAX_SAMPLES) {
      throw new Error(`DelayLine maxSamples must be at most ${MAX_SAMPLES}`);
    }
    // Round capacity up to a power of two with room for the cubic
    // kernel's two-sample tail past maxDelay. `n *= 2` and not `n <<= 1`:
    // a float multiply has no 32-bit wrap, so the loop still terminates if
    // the bound above is ever loosened.
    let n = 1;
    while (n < maxSamples + 4) n *= 2;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
    this.maxDelay = Math.floor(maxSamples);
  }

  /** Push one sample and advance the write head. */
  write(x: number): void {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }

  /** Sample written delaySamples writes ago. 0 is the most recent. */
  readInt(delaySamples: number): number {
    let d = delaySamples | 0;
    if (d < 0) d = 0;
    else if (d > this.maxDelay + 2) d = this.maxDelay + 2;
    return this.buf[(this.w - 1 - d) & this.mask];
  }

  /** Linear interpolation between the two neighboring integer taps. */
  readLinear(delaySamples: number): number {
    let d = delaySamples;
    if (d < 0) d = 0;
    else if (d > this.maxDelay) d = this.maxDelay;
    const di = d | 0;
    const f = d - di;
    const a = this.buf[(this.w - 1 - di) & this.mask];
    const b = this.buf[(this.w - 2 - di) & this.mask];
    return a + f * (b - a);
  }

  /** 4-point Catmull-Rom interpolation. Delay is clamped to [1, maxDelay]. */
  readCubic(delaySamples: number): number {
    let d = delaySamples;
    if (d < 1) d = 1;
    else if (d > this.maxDelay) d = this.maxDelay;
    const di = d | 0;
    const f = d - di;
    const base = this.w - 1 - di;
    const y0 = this.buf[(base + 1) & this.mask]; // one sample newer
    const y1 = this.buf[base & this.mask];
    const y2 = this.buf[(base - 1) & this.mask];
    const y3 = this.buf[(base - 2) & this.mask]; // two samples older
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  clear(): void {
    this.buf.fill(0);
    this.w = 0;
  }
}
