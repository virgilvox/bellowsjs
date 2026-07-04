import { describe, it, expect } from 'vitest';
import {
  fromArray,
  seq,
  gates,
  stack,
  every,
  sometimes,
  fast,
  slow,
  rev,
  rotate,
} from '../../src/seq/pattern';
import { euclid } from '../../src/seq/euclid';
import { rng } from '../../src/core/prng';
import type { StepPattern } from '../../src/types';

function sample<T>(p: StepPattern<T>, n: number, from = 0): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(p.at(from + i));
  return out;
}

describe('constructors', () => {
  it('fromArray wraps and accepts negative steps', () => {
    const p = fromArray([10, 20, 30]);
    expect(p.length).toBe(3);
    expect(sample(p, 7)).toEqual([10, 20, 30, 10, 20, 30, 10]);
    expect(p.at(-1)).toBe(30);
    expect(p.at(-3)).toBe(10);
  });

  it('fromArray copies its input', () => {
    const src = [1, 2, 3];
    const p = fromArray(src);
    src[0] = 99;
    expect(p.at(0)).toBe(1);
  });

  it('seq flattens nested arrays one level per cycle', () => {
    const p = seq(1, [2, 3], 4);
    expect(p.length).toBe(4);
    expect(sample(p, 4)).toEqual([1, 2, 3, 4]);
  });

  it('gates coerces to 0/1 and plays with euclid', () => {
    const p = gates(euclid(3, 8));
    expect(p.length).toBe(8);
    expect(sample(p, 8)).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
    expect(sample(gates([0, 2, 0.5, 0]), 4)).toEqual([0, 1, 1, 0]);
  });

  it('empty constructors throw', () => {
    expect(() => fromArray([])).toThrow(RangeError);
    expect(() => seq()).toThrow(RangeError);
    expect(() => stack()).toThrow(RangeError);
  });
});

describe('stack', () => {
  it('yields one value per layer with lcm cycle length', () => {
    const p = stack(fromArray([1, 2]), fromArray([10, 20, 30]));
    expect(p.length).toBe(6);
    expect(p.at(0)).toEqual([1, 10]);
    expect(p.at(1)).toEqual([2, 20]);
    expect(p.at(2)).toEqual([1, 30]);
    expect(p.at(5)).toEqual([2, 30]);
    expect(p.at(6)).toEqual(p.at(0));
  });
});

describe('every', () => {
  it('transforms cycles 0, n, 2n and leaves the rest alone', () => {
    const p = every(2, (q) => rev(q), fromArray([1, 2, 3]));
    expect(p.length).toBe(3);
    // Cycle 0 reversed, cycle 1 plain, cycle 2 reversed.
    expect(sample(p, 9)).toEqual([3, 2, 1, 1, 2, 3, 3, 2, 1]);
  });

  it('rejects non-positive n', () => {
    expect(() => every(0, (q) => q, fromArray([1]))).toThrow(RangeError);
  });
});

describe('sometimes', () => {
  it('is deterministic per seed and stable across queries', () => {
    const base = fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = sometimes(0.5, (v) => v + 100, base, rng('st-1'));
    const b = sometimes(0.5, (v) => v + 100, base, rng('st-1'));
    expect(sample(a, 16)).toEqual(sample(b, 16));
    // Re-querying the same steps gives the same answers.
    expect(sample(a, 16)).toEqual(sample(a, 16));
  });

  it('prob 0 never applies, prob 1 always applies', () => {
    const base = fromArray([1, 2, 3]);
    expect(sample(sometimes(0, (v) => v + 100, base, rng('st-0')), 3)).toEqual([1, 2, 3]);
    expect(sample(sometimes(1, (v) => v + 100, base, rng('st-a')), 3)).toEqual([101, 102, 103]);
    expect(() => sometimes(1.5, (v) => v, base, rng('st-x'))).toThrow(RangeError);
  });
});

describe('fast and slow', () => {
  it('fast(2) halves the cycle length and samples every other step', () => {
    const p = fast(2, fromArray([1, 2, 3, 4]));
    expect(p.length).toBe(2);
    expect(sample(p, 4)).toEqual([1, 3, 1, 3]);
  });

  it('fast rounds an odd length up', () => {
    const p = fast(2, fromArray([1, 2, 3]));
    expect(p.length).toBe(2);
    expect(sample(p, 4)).toEqual([1, 3, 2, 1]);
  });

  it('slow(2) doubles the cycle length and holds values', () => {
    const p = slow(2, fromArray([1, 2, 3]));
    expect(p.length).toBe(6);
    expect(sample(p, 8)).toEqual([1, 1, 2, 2, 3, 3, 1, 1]);
  });

  it('fast undoes slow', () => {
    const base = fromArray([1, 2, 3, 4]);
    expect(sample(fast(3, slow(3, base)), 8)).toEqual(sample(base, 8));
  });

  it('fast(1) and slow(1) are identities', () => {
    const base = fromArray([1, 2, 3]);
    expect(sample(fast(1, base), 6)).toEqual(sample(base, 6));
    expect(sample(slow(1, base), 6)).toEqual(sample(base, 6));
  });
});

describe('rev and rotate', () => {
  it('rev reverses within each cycle', () => {
    const p = rev(fromArray([1, 2, 3, 4]));
    expect(sample(p, 8)).toEqual([4, 3, 2, 1, 4, 3, 2, 1]);
  });

  it('rev(rev(p)) is the identity', () => {
    const base = fromArray([1, 2, 3, 4, 5]);
    const twice = rev(rev(base));
    expect(twice.length).toBe(base.length);
    expect(sample(twice, 15, -5)).toEqual(sample(base, 15, -5));
  });

  it('rotate shifts left and composes with negative shifts', () => {
    const base = fromArray([1, 2, 3, 4]);
    expect(sample(rotate(base, 1), 4)).toEqual([2, 3, 4, 1]);
    expect(sample(rotate(base, -1), 4)).toEqual([4, 1, 2, 3]);
    expect(sample(rotate(rotate(base, 3), -3), 4)).toEqual(sample(base, 4));
    expect(() => rotate(base, 0.5)).toThrow(RangeError);
  });

  it('transforms compose', () => {
    const base = fromArray([1, 2, 3, 4]);
    const p = rotate(rev(base), 1);
    expect(sample(p, 4)).toEqual([3, 2, 1, 4]);
  });
});
