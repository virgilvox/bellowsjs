/*
 * Tunings map note indices to frequencies. A Tuning is periodic: `size`
 * degrees span one period (usually an octave). 12-EDO at A4 = 440 is the
 * default, never an assumption; every pitch in the library flows through
 * a Tuning before it reaches a voice.
 *
 * Internal representation is a cents table. degreeCents[d] is the offset
 * in cents of degree d above the reference index, one full period spans
 * periodCents, and
 *
 *   freqOf(refIndex + k * size + d)
 *     = refFreq * 2 ^ ((k * periodCents + degreeCents[d]) / 1200)
 *
 * Entries may be NaN for unmapped keys (Scala .kbm files allow holes);
 * freqOf returns NaN for those indices. Fractional indices interpolate
 * linearly in cents between the neighbouring integer indices, which gives
 * smooth pitch bends through any tuning.
 */

export class Tuning {
  /** Notes per period. */
  readonly size: number;
  /** Width of one period in cents. */
  readonly periodCents: number;
  /** Frequency in Hz of degree 0 at the reference index. */
  readonly refFreq: number;
  /** Note index whose frequency is refFreq. */
  readonly refIndex: number;

  private readonly degreeCents: readonly number[];

  private constructor(
    degreeCents: readonly number[],
    periodCents: number,
    refFreq: number,
    refIndex: number,
  ) {
    if (degreeCents.length < 1) throw new Error('Tuning: needs at least one degree');
    if (!Number.isFinite(periodCents) || periodCents <= 0) {
      throw new Error('Tuning: period must span a positive number of cents');
    }
    if (!Number.isFinite(refFreq) || refFreq <= 0) {
      throw new Error('Tuning: reference frequency must be positive');
    }
    if (!Number.isInteger(refIndex)) throw new Error('Tuning: reference index must be an integer');
    for (const c of degreeCents) {
      // NaN marks an unmapped key and is allowed.
      if (!Number.isFinite(c) && !Number.isNaN(c)) {
        throw new Error('Tuning: degree cents must be finite or NaN');
      }
    }
    this.degreeCents = degreeCents.slice();
    this.size = degreeCents.length;
    this.periodCents = periodCents;
    this.refFreq = refFreq;
    this.refIndex = refIndex;
  }

  /** Equal divisions of the octave. edo(12) is standard MIDI tuning. */
  static edo(n: number, refFreq = 440, refIndex = 69): Tuning {
    if (!Number.isInteger(n) || n < 1) throw new Error('Tuning.edo: n must be a positive integer');
    const cents = new Array<number>(n);
    for (let i = 0; i < n; i++) cents[i] = (1200 * i) / n;
    return new Tuning(cents, 1200, refFreq, refIndex);
  }

  /**
   * Just intonation from frequency ratios. ratios[0] is normally 1 (the
   * base degree); period is the repetition ratio, 2 for an octave.
   */
  static ji(ratios: readonly number[], baseFreq = 440, baseIndex = 69, period = 2): Tuning {
    if (ratios.length < 1) throw new Error('Tuning.ji: needs at least one ratio');
    if (!(period > 1)) throw new Error('Tuning.ji: period ratio must be greater than 1');
    const cents = new Array<number>(ratios.length);
    for (let i = 0; i < ratios.length; i++) {
      const r = ratios[i];
      if (!Number.isFinite(r) || r <= 0) throw new Error('Tuning.ji: ratios must be positive');
      cents[i] = 1200 * Math.log2(r);
    }
    return new Tuning(cents, 1200 * Math.log2(period), baseFreq, baseIndex);
  }

  /**
   * From a cents table. cents[i] is the offset of degree i above the
   * reference index; period is the width of one repetition in cents.
   * NaN entries mark unmapped keys.
   */
  static fromCents(cents: readonly number[], period = 1200, refFreq = 440, refIndex = 69): Tuning {
    return new Tuning(cents, period, refFreq, refIndex);
  }

  /** Standard MIDI tuning: 12-EDO, A4 = 440 at index 69. */
  static readonly default12: Tuning = Tuning.edo(12);

  /**
   * Cents of a note index relative to the reference:
   * freqOf(i) = refFreq * 2 ^ (centsOf(i) / 1200).
   * Fractional indices interpolate linearly in cents.
   */
  centsOf(index: number): number {
    if (Number.isInteger(index)) return this.centsAt(index);
    const i0 = Math.floor(index);
    const t = index - i0;
    const c0 = this.centsAt(i0);
    return c0 + t * (this.centsAt(i0 + 1) - c0);
  }

  /** Frequency in Hz of a note index. NaN for unmapped indices. */
  freqOf(index: number): number {
    return this.refFreq * Math.pow(2, this.centsOf(index) / 1200);
  }

  /** Alias for freqOf. For edo(12) the index is the MIDI note number. */
  midiToFreq(midi: number): number {
    return this.freqOf(midi);
  }

  /** New tuning with every pitch raised by the given cents. */
  transposeCents(cents: number): Tuning {
    if (!Number.isFinite(cents)) throw new Error('Tuning.transposeCents: cents must be finite');
    return new Tuning(
      this.degreeCents,
      this.periodCents,
      this.refFreq * Math.pow(2, cents / 1200),
      this.refIndex,
    );
  }

  /** New tuning with every pitch multiplied by the given ratio. */
  transposeRatio(ratio: number): Tuning {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      throw new Error('Tuning.transposeRatio: ratio must be positive');
    }
    return new Tuning(this.degreeCents, this.periodCents, this.refFreq * ratio, this.refIndex);
  }

  /** New tuning where each index sounds like index + steps in this one. */
  transposeSteps(steps: number): Tuning {
    if (!Number.isInteger(steps)) throw new Error('Tuning.transposeSteps: steps must be an integer');
    return new Tuning(this.degreeCents, this.periodCents, this.refFreq, this.refIndex - steps);
  }

  private centsAt(index: number): number {
    const rel = index - this.refIndex;
    const oct = Math.floor(rel / this.size);
    const deg = rel - oct * this.size;
    return oct * this.periodCents + this.degreeCents[deg];
  }
}

/**
 * Scale degree to frequency through a tuning. intervals lists tuning steps
 * above the root, e.g. [0, 2, 4, 5, 7, 9, 11] for major in edo(12).
 * Degrees outside [0, intervals.length) wrap, shifting by whole periods,
 * so degree -1 is the top interval one period down. octave shifts by
 * whole tuning periods.
 */
export function degreeFreq(
  tuning: Tuning,
  rootIndex: number,
  intervals: readonly number[],
  degree: number,
  octave = 0,
): number {
  if (intervals.length === 0) throw new Error('degreeFreq: intervals must not be empty');
  if (!Number.isInteger(degree)) throw new Error('degreeFreq: degree must be an integer');
  const n = intervals.length;
  const wrap = Math.floor(degree / n);
  const step = intervals[degree - wrap * n];
  return tuning.freqOf(rootIndex + (octave + wrap) * tuning.size + step);
}
