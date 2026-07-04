/*
 * Variable-order Markov chains over any state alphabet, plus melody-matrix
 * helpers for weighted random walks with chord-tone gravity.
 *
 * Training records transitions at every order from 0 up to the configured
 * order, so an unseen full-order context falls back to progressively
 * shorter contexts and finally to the order-0 symbol distribution.
 * Contexts are keyed by JSON, so states must JSON-stringify stably
 * (numbers, strings, and plain objects all work).
 */

import type { NamedRng } from '../types';

interface Bucket<T> {
  values: T[];
  weights: number[];
  /** JSON key of each value to its index in `values`. */
  index: Map<string, number>;
}

function key(context: readonly unknown[]): string {
  return JSON.stringify(context);
}

export class Markov<T> {
  readonly order: number;
  /** tables[k] maps a length-k context key to its outgoing distribution. */
  private readonly tables: Array<Map<string, Bucket<T>>>;
  private context: T[] = [];

  constructor(order: number) {
    if (!Number.isInteger(order) || order < 1) {
      throw new RangeError('Markov: order must be an integer >= 1');
    }
    this.order = order;
    this.tables = [];
    for (let k = 0; k <= order; k++) this.tables.push(new Map());
  }

  /** Count every transition in `sequence` at all orders up to this.order. */
  train(sequence: readonly T[]): void {
    for (let i = 0; i < sequence.length; i++) {
      const to = sequence[i];
      const maxK = Math.min(this.order, i);
      for (let k = 0; k <= maxK; k++) {
        this.add(k, sequence.slice(i - k, i), to, 1);
      }
    }
  }

  /**
   * Add one weighted transition at exactly order from.length.
   * Lower orders are not populated; use train() for automatic fallback.
   */
  addTransition(from: readonly T[], to: T, weight = 1): void {
    if (from.length > this.order) {
      throw new RangeError('Markov: context longer than chain order');
    }
    if (!(weight > 0) || !Number.isFinite(weight)) {
      throw new RangeError('Markov: weight must be a positive finite number');
    }
    this.add(from.length, from, to, weight);
  }

  /** Set the current context. Only the last `order` elements are kept. */
  seed(context: readonly T[]): void {
    this.context = context.slice(-this.order);
  }

  /**
   * Emit the next state and advance the context. Tries the longest
   * available context first, backing off one element at a time.
   */
  next(rng: NamedRng): T {
    for (let k = Math.min(this.order, this.context.length); k >= 0; k--) {
      const ctx = this.context.slice(this.context.length - k);
      const bucket = this.tables[k].get(key(ctx));
      if (bucket !== undefined && bucket.values.length > 0) {
        const v = bucket.values[rng.weighted(bucket.weights)];
        this.context.push(v);
        if (this.context.length > this.order) this.context.shift();
        return v;
      }
    }
    throw new Error('Markov: no transition available (train the chain first)');
  }

  /** Emit n states. */
  steps(rng: NamedRng, n: number): T[] {
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(this.next(rng));
    return out;
  }

  private add(k: number, from: readonly T[], to: T, weight: number): void {
    const table = this.tables[k];
    const ck = key(from);
    let bucket = table.get(ck);
    if (bucket === undefined) {
      bucket = { values: [], weights: [], index: new Map() };
      table.set(ck, bucket);
    }
    const vk = JSON.stringify(to);
    const i = bucket.index.get(vk);
    if (i === undefined) {
      bucket.index.set(vk, bucket.values.length);
      bucket.values.push(to);
      bucket.weights.push(weight);
    } else {
      bucket.weights[i] += weight;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Melody matrix helpers                                               */
/* ------------------------------------------------------------------ */

export interface StepwiseMatrixOpts {
  /** Base weight for leaps of two or more positions, decaying with distance. Default 0.25. */
  leapChance?: number;
  /** How strongly repeated notes are suppressed, 0 = none, 1 = forbidden. Default 0.5. */
  repeatPenalty?: number;
}

/**
 * Build a first-order transition weight matrix over scale positions that
 * favors stepwise motion. Rows index the current position in `states`,
 * columns the next. Weights carry a small seeded jitter so different
 * streams produce different but reproducible melodic characters.
 * Weights are relative; consumers normalize when they pick.
 */
export function buildStepwiseMatrix(
  states: readonly number[],
  rng: NamedRng,
  opts: StepwiseMatrixOpts = {},
): number[][] {
  const n = states.length;
  if (n === 0) throw new RangeError('buildStepwiseMatrix: states is empty');
  const leapChance = opts.leapChance ?? 0.25;
  const repeatPenalty = opts.repeatPenalty ?? 0.5;
  if (leapChance < 0 || repeatPenalty < 0 || repeatPenalty > 1) {
    throw new RangeError('buildStepwiseMatrix: leapChance must be >= 0 and repeatPenalty in [0, 1]');
  }
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      const dist = Math.abs(j - i);
      let base: number;
      if (dist === 0) base = 0.5 * (1 - repeatPenalty);
      else if (dist === 1) base = 1;
      else base = leapChance / (dist - 1);
      row[j] = base * (0.75 + rng() * 0.5);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * One step of a weighted random walk over a transition matrix.
 * `state` is the current row index; the return value is the next index.
 * When `gravitySet` is given (a set of column indices, typically chord
 * tones), those columns' weights are multiplied by `gravityGain` so the
 * walk is pulled toward them without ever being forced.
 */
export function weightedWalk(
  matrix: readonly number[][],
  state: number,
  rng: NamedRng,
  gravitySet?: ReadonlySet<number>,
  gravityGain = 2,
): number {
  const row = matrix[state];
  if (row === undefined) throw new RangeError('weightedWalk: state out of range');
  if (gravitySet === undefined || gravityGain === 1) return rng.weighted(row);
  const adjusted = new Array<number>(row.length);
  for (let j = 0; j < row.length; j++) {
    adjusted[j] = gravitySet.has(j) ? row[j] * gravityGain : row[j];
  }
  return rng.weighted(adjusted);
}
