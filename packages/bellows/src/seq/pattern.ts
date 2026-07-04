/*
 * Step-indexed pattern combinators. Strudel-inspired but deliberately
 * smaller: a pattern is only a pull-based at(step) over an integer step
 * index plus a cycle length, no timeline queries, no fractional spans.
 * The step is the atomic time unit, so every transform is defined in
 * whole steps:
 *
 *   fast(n)   samples every nth step, cycle length ceil(len / n)
 *   slow(n)   holds each value for n steps, cycle length len * n
 *   rev       reverses within each cycle
 *   rotate    shifts the pattern left by n steps
 *   every     applies a transform on every nth cycle
 *   sometimes applies a per-step transform with a seeded mask, fixed
 *             per cycle position so the pattern stays re-queryable
 *
 * All constructors produce patterns that wrap: at(i) === at(i mod length),
 * and at() accepts negative steps.
 */

import type { NamedRng, StepPattern } from '../types';

function mod(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function positiveInt(n: number, where: string): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(where + ': n must be a positive integer');
  }
}

/** Wrap a finite array as a cyclic pattern. The array is copied. */
export function fromArray<T>(values: readonly T[]): StepPattern<T> {
  if (values.length === 0) throw new RangeError('fromArray: values is empty');
  const vals = values.slice();
  return {
    at: (step: number) => vals[mod(step, vals.length)],
    length: vals.length,
  };
}

/**
 * A cycle from values in order. Nested arrays are flattened one level, so
 * seq(1, [2, 3], 4) is the four-step cycle 1 2 3 4.
 */
export function seq<T>(...values: Array<T | readonly T[]>): StepPattern<T> {
  const flat: T[] = [];
  for (const v of values) {
    if (Array.isArray(v)) flat.push(...(v as readonly T[]));
    else flat.push(v as T);
  }
  return fromArray(flat);
}

/** A gate pattern from a binary array. Nonzero values become 1. */
export function gates(bits: readonly number[]): StepPattern<number> {
  return fromArray(bits.map((b) => (b ? 1 : 0)));
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Layer patterns: each step yields one value per input pattern. The cycle
 * length is the least common multiple of the inputs' lengths.
 */
export function stack<T>(...patterns: Array<StepPattern<T>>): StepPattern<T[]> {
  if (patterns.length === 0) throw new RangeError('stack: no patterns given');
  let length = 1;
  for (const p of patterns) length = (length / gcd(length, p.length)) * p.length;
  return {
    at: (step: number) => patterns.map((p) => p.at(step)),
    length,
  };
}

/** Apply fn to the pattern on every nth cycle (cycles 0, n, 2n, ...). */
export function every<T>(
  n: number,
  fn: (p: StepPattern<T>) => StepPattern<T>,
  pattern: StepPattern<T>,
): StepPattern<T> {
  positiveInt(n, 'every');
  const transformed = fn(pattern);
  const len = pattern.length;
  return {
    at: (step: number) => {
      const cycle = Math.floor(step / len);
      return mod(cycle, n) === 0 ? transformed.at(step) : pattern.at(step);
    },
    length: len,
  };
}

/**
 * Apply fn to each value with probability prob. The random mask is drawn
 * once at construction (one draw per cycle position), so repeated queries
 * of the same step agree and the result is reproducible per seed.
 */
export function sometimes<T>(
  prob: number,
  fn: (v: T) => T,
  pattern: StepPattern<T>,
  rng: NamedRng,
): StepPattern<T> {
  if (prob < 0 || prob > 1) throw new RangeError('sometimes: prob must be in [0, 1]');
  const len = pattern.length;
  const mask = new Array<boolean>(len);
  for (let i = 0; i < len; i++) mask[i] = rng.chance(prob);
  return {
    at: (step: number) => (mask[mod(step, len)] ? fn(pattern.at(step)) : pattern.at(step)),
    length: len,
  };
}

/**
 * Compress the pattern by sampling every nth step. A cycle of length L
 * becomes ceil(L / n) steps, so fast(2) halves the cycle length. With
 * integer steps as the atomic unit this is decimation: intermediate
 * values are skipped, not squeezed.
 */
export function fast<T>(n: number, p: StepPattern<T>): StepPattern<T> {
  positiveInt(n, 'fast');
  return {
    at: (step: number) => p.at(step * n),
    length: Math.max(1, Math.ceil(p.length / n)),
  };
}

/** Hold each value for n steps. A cycle of length L becomes L * n steps. */
export function slow<T>(n: number, p: StepPattern<T>): StepPattern<T> {
  positiveInt(n, 'slow');
  return {
    at: (step: number) => p.at(Math.floor(step / n)),
    length: p.length * n,
  };
}

/** Reverse the pattern within each cycle. rev(rev(p)) equals p. */
export function rev<T>(p: StepPattern<T>): StepPattern<T> {
  const len = p.length;
  return {
    at: (step: number) => p.at(len - 1 - mod(step, len)),
    length: len,
  };
}

/** Shift the pattern left by n steps (rotate(p, 1).at(0) === p.at(1)). */
export function rotate<T>(p: StepPattern<T>, n: number): StepPattern<T> {
  if (!Number.isInteger(n)) throw new RangeError('rotate: n must be an integer');
  return {
    at: (step: number) => p.at(step + n),
    length: p.length,
  };
}
