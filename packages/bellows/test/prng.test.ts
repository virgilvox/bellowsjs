import { describe, it, expect } from 'vitest';
import { rng } from '../src/core/prng';

describe('seeded prng', () => {
  it('is deterministic for the same label', () => {
    const a = rng('forge-01');
    const b = rng('forge-01');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs across labels', () => {
    const a = rng('forge-01');
    const b = rng('forge-02');
    let same = 0;
    for (let i = 0; i < 100; i++) if (a() === b()) same++;
    expect(same).toBeLessThan(3);
  });

  it('forks independent stable streams regardless of consumption order', () => {
    const parent1 = rng('seed');
    const c1 = parent1.fork('melody');
    parent1(); parent1(); parent1();
    const c1again = rng('seed').fork('melody');
    for (let i = 0; i < 20; i++) expect(c1()).toBe(c1again());
  });

  it('stays in [0, 1)', () => {
    const r = rng('bounds');
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int, pick, range, weighted behave', () => {
    const r = rng('helpers');
    for (let i = 0; i < 1000; i++) {
      const n = r.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(arr).toContain(r.pick(arr));
    for (let i = 0; i < 100; i++) {
      const v = r.range(5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(9);
    }
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[r.weighted([1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBeGreaterThan(counts[0]);
  });

  it('has a roughly uniform mean', () => {
    const r = rng('uniformity');
    let sum = 0;
    for (let i = 0; i < 50000; i++) sum += r();
    expect(sum / 50000).toBeCloseTo(0.5, 1);
  });

  /*
   * int() is the index generator behind pick and shuffle, and the bound
   * above only ever asserted n < 7. An int() that can never return n - 1,
   * which is the classic off-by-one in exactly this position, satisfies
   * that. Both ends have to be reachable.
   */
  it('int reaches both 0 and n - 1', () => {
    const r = rng('int-ends');
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(r.int(7));
    expect(seen.has(0)).toBe(true);
    expect(seen.has(6)).toBe(true);
    expect(seen.size).toBe(7);
    /* int(1) has one legal answer, and 1 is not it. */
    for (let i = 0; i < 100; i++) expect(r.int(1)).toBe(0);
  });
});

/*
 * shuffle and gauss were called by nothing: not by the library, not by any
 * test. Their only appearance in the repository was a docs page teaching
 * them as public API, so the documentation was the specification and
 * nothing checked it.
 */
describe('seeded prng: shuffle', () => {
  it('is a permutation, not a resampling', () => {
    const r = rng('shuffle-perm');
    const src = Array.from({ length: 50 }, (_, i) => i);
    for (let trial = 0; trial < 20; trial++) {
      const out = r.shuffle(src);
      expect(out).toHaveLength(src.length);
      expect([...out].sort((a, b) => a - b)).toEqual(src);
    }
  });

  it('does not modify its input', () => {
    const r = rng('shuffle-pure');
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const before = [...src];
    r.shuffle(src);
    expect(src).toEqual(before);
  });

  it('moves every element to every position given enough trials', () => {
    /*
     * A Fisher-Yates that draws j from [0, i) instead of [0, i] cannot
     * leave an element where it started, and one that never touches index 0
     * pins the first element. Counting the full position matrix catches
     * both, where a length check and a sort check catch neither.
     */
    const r = rng('shuffle-cover');
    const n = 5;
    const src = Array.from({ length: n }, (_, i) => i);
    const seen = Array.from({ length: n }, () => new Set<number>());
    for (let trial = 0; trial < 4000; trial++) {
      const out = r.shuffle(src);
      for (let pos = 0; pos < n; pos++) seen[out[pos]].add(pos);
    }
    for (let v = 0; v < n; v++) expect(seen[v].size).toBe(n);
  });

  it('is stable for a label and differs across labels', () => {
    const src = Array.from({ length: 12 }, (_, i) => i);
    expect(rng('shuffle-det').shuffle(src)).toEqual(rng('shuffle-det').shuffle(src));
    expect(rng('shuffle-det').shuffle(src)).not.toEqual(rng('shuffle-other').shuffle(src));
  });

  it('handles the degenerate lengths', () => {
    const r = rng('shuffle-degenerate');
    expect(r.shuffle([])).toEqual([]);
    expect(r.shuffle([9])).toEqual([9]);
  });
});

describe('seeded prng: gauss', () => {
  /*
   * Four uniforms summed, centred and scaled: mean 0, and the scale is
   * chosen so the standard deviation is 1. Bates(4) has sd 1/sqrt(48), and
   * the sum of four uniforms is 4x that, so sqrt(4/12) = 0.5774 before
   * scaling; times SQRT2 * 0.875 gives 0.7144. The distribution is
   * therefore NOT unit variance, and the tests below pin what it actually
   * does rather than what the name suggests.
   */
  it('is centred on zero', () => {
    const r = rng('gauss-mean');
    let sum = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) sum += r.gauss();
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
  });

  it('has the standard deviation its scaling implies', () => {
    const r = rng('gauss-sd');
    const n = 200000;
    let sum = 0;
    let sumsq = 0;
    for (let i = 0; i < n; i++) {
      const v = r.gauss();
      sum += v;
      sumsq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumsq / n - mean * mean);
    /* sqrt(4/12) * SQRT2 * 0.875 = 0.71443 */
    expect(sd).toBeCloseTo(0.71443, 2);
  });

  it('is bounded by its construction and symmetric', () => {
    /* Four uniforms in [0, 1) give a sum in [0, 4), so the value lies in
     * [-2, 2) times SQRT2 * 0.875 = 1.23744. */
    const r = rng('gauss-bounds');
    const limit = 2 * Math.SQRT2 * 0.875;
    let neg = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.gauss();
      expect(v).toBeGreaterThanOrEqual(-limit);
      expect(v).toBeLessThan(limit);
      if (v < 0) neg++;
    }
    expect(neg / n).toBeCloseTo(0.5, 1);
  });

  it('is shaped like Bates(4), not like one uniform and not like a true normal', () => {
    /*
     * The point of summing four uniforms is the shape, and mean, sd and
     * bounds do not pin it: a single uniform scaled to the same sd passes
     * all three. Mass within half a standard deviation separates them.
     * Measured 0.3705, stable to four decimals across three labels at this
     * sample count. One uniform gives 1/sqrt(12) = 0.2887 and a true normal
     * gives erf(0.5/sqrt2) = 0.3829, so the band below admits neither.
     */
    const r = rng('gauss-shape');
    const n = 200000;
    let inner = 0;
    for (let i = 0; i < n; i++) if (Math.abs(r.gauss()) < 0.5 * 0.71443) inner++;
    expect(inner / n).toBeGreaterThan(0.36);
    expect(inner / n).toBeLessThan(0.38);
  });

  it('is stable for a label', () => {
    const a = rng('gauss-det');
    const b = rng('gauss-det');
    for (let i = 0; i < 50; i++) expect(a.gauss()).toBe(b.gauss());
  });
});
