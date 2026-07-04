/*
 * Seeded functional-harmony progression generation over scale degrees
 * 0..6 (I..VII). A weight matrix encodes the usual pulls: predominants
 * lead to dominants, dominants resolve to the tonic, deceptive motion is
 * possible but rare.
 */

import type { NamedRng } from '../types';

/**
 * Transition weights: FUNCTIONAL_WEIGHTS[from][to]. Row order and column
 * order are scale degrees 0..6 (I ii iii IV V vi viio in major).
 */
export const FUNCTIONAL_WEIGHTS: readonly (readonly number[])[] = [
  // I: moves anywhere, favors the predominants and dominant
  [0.5, 1.5, 1, 3, 3, 2, 0.5],
  // ii: predominant, pulls to V
  [0.5, 0.25, 0.25, 0.5, 4, 0.5, 1],
  // iii: color chord, drifts to vi or IV
  [0.5, 0.5, 0.1, 2, 1, 3, 0.1],
  // IV: predominant, pulls to V, also plagal motion home
  [2, 1.5, 0.25, 0.25, 4, 0.5, 1],
  // V: resolves to I, deceptive to vi
  [5, 0.25, 0.1, 0.5, 0.25, 1.5, 0.25],
  // vi: relative, feeds the predominants
  [0.5, 3, 0.5, 2.5, 1.5, 0.1, 0.25],
  // viio: leading tone chord, resolves to I
  [4, 0.25, 0.5, 0.25, 1, 0.5, 0.1],
];

/** Weights for the penultimate chord of a cadence: IV, V, or viio. */
const CADENCE_WEIGHTS = [0, 0, 0, 1, 5, 0, 1.5];

/**
 * A step-by-step Markov walker over scale degrees. Each step draws the
 * next degree from the weight row of the current one.
 */
export class ChordWalker {
  degree: number;
  private readonly rng: NamedRng;
  private readonly matrix: readonly (readonly number[])[];

  constructor(rng: NamedRng, matrix: readonly (readonly number[])[] = FUNCTIONAL_WEIGHTS, start = 0) {
    this.rng = rng;
    this.matrix = matrix;
    this.degree = start;
  }

  /** Advance to the next degree and return it. */
  step(): number {
    this.degree = this.rng.weighted(this.matrix[this.degree]);
    return this.degree;
  }

  /** Jump to a degree without consuming randomness. */
  reset(degree = 0): void {
    this.degree = degree;
  }
}

export interface ProgressionOptions {
  /** End with a cadence: dominant-function penultimate, tonic last. Default true. */
  cadence?: boolean;
}

/**
 * Generate one scale degree per bar, starting on the tonic. With cadence
 * enabled (the default) the last two bars are biased to close the phrase:
 * IV, V, or viio into I.
 */
export function buildProgression(rng: NamedRng, bars: number, options: ProgressionOptions = {}): number[] {
  if (bars <= 0) return [];
  const cadence = options.cadence !== false;
  const walker = new ChordWalker(rng);
  const out: number[] = [0];
  for (let i = 1; i < bars; i++) {
    if (cadence && i === bars - 1) {
      out.push(0);
    } else if (cadence && i === bars - 2) {
      const d = rng.weighted(CADENCE_WEIGHTS);
      out.push(d);
      walker.reset(d);
    } else {
      out.push(walker.step());
    }
  }
  return out;
}
