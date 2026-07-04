/*
 * Memoryless waveshaping primitives. The free functions are pure and
 * allocation free so they can sit inside per-sample loops, usually
 * behind an Oversampler. TableShaper evaluates an arbitrary transfer
 * curve stored as a lookup table over [-1, 1].
 */

/**
 * tanh saturation normalized so an input of 1 maps to 1 at any drive.
 * Low drive approaches identity, high drive approaches a hard clip.
 */
export function tanhShape(x: number, drive: number): number {
  if (drive < 1e-6) return x;
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/**
 * Cubic soft clip: 1.5x - 0.5x^3 inside [-1, 1], flat outside.
 * Continuous first derivative at the clip points; small-signal gain 1.5.
 */
export function softClip(x: number): number {
  if (x <= -1) return -1;
  if (x >= 1) return 1;
  return x * (1.5 - 0.5 * x * x);
}

export function hardClip(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/**
 * Triangle wavefolder. Scales by gain, then reflects anything outside
 * [-1, 1] back into range, repeatedly. Identity while |x * gain| <= 1.
 */
export function foldback(x: number, gain: number): number {
  let t = (x * gain + 1) % 4;
  if (t < 0) t += 4;
  return t < 2 ? t - 1 : 3 - t;
}

/**
 * Build a transfer curve as a weighted sum of Chebyshev polynomials,
 * sampled over x in [-1, 1]. coeffs[k] weights T_{k+1}, so coeffs[0]
 * is the fundamental: driving the table with cos(w t) at full level
 * produces harmonic k+1 at amplitude coeffs[k].
 */
export function chebyshevTable(coeffs: number[], size: number): Float32Array {
  if (size < 2) throw new Error('chebyshevTable size must be at least 2');
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = -1 + (2 * i) / (size - 1);
    let tPrev = 1; // T0
    let tCur = x; // T1
    let y = 0;
    for (let k = 0; k < coeffs.length; k++) {
      y += coeffs[k] * tCur;
      const tNext = 2 * x * tCur - tPrev;
      tPrev = tCur;
      tCur = tNext;
    }
    table[i] = y;
  }
  return table;
}

/** Table-driven shaper: x in [-1, 1] linearly interpolated, clamped outside. */
export class TableShaper {
  private readonly table: Float32Array;
  private readonly last: number;

  constructor(table: Float32Array) {
    if (table.length < 2) throw new Error('TableShaper table needs at least 2 points');
    this.table = table;
    this.last = table.length - 1;
  }

  next(x: number): number {
    const t = (x + 1) * 0.5 * this.last;
    if (t <= 0) return this.table[0];
    if (t >= this.last) return this.table[this.last];
    const i = t | 0;
    const f = t - i;
    const a = this.table[i];
    return a + f * (this.table[i + 1] - a);
  }
}
