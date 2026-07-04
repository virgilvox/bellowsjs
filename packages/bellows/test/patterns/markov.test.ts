import { describe, it, expect } from 'vitest';
import { Markov, buildStepwiseMatrix, weightedWalk } from '../../src/seq/markov';
import { rng } from '../../src/core/prng';

describe('Markov', () => {
  it('rejects a non-positive or fractional order', () => {
    expect(() => new Markov(0)).toThrow(RangeError);
    expect(() => new Markov(1.5)).toThrow(RangeError);
    expect(() => new Markov(-2)).toThrow(RangeError);
  });

  it('order-1 chain with a single deterministic transition', () => {
    const m = new Markov<string>(1);
    m.addTransition(['a'], 'b');
    m.seed(['a']);
    expect(m.next(rng('det'))).toBe('b');
  });

  it('order-2 reproduces trained transitions exactly when unambiguous', () => {
    // In "abac", context [a, b] -> a and [b, a] -> c are unique.
    const m = new Markov<string>(2);
    m.train(['a', 'b', 'a', 'c']);
    m.seed(['a', 'b']);
    const r = rng('exact');
    expect(m.next(r)).toBe('a');
    // Context is now [b, a], whose only continuation is c.
    expect(m.next(r)).toBe('c');
  });

  it('order-2 reproduces trained transition weights statistically', () => {
    // [C, D] -> E twice, [C, D] -> G once: expect roughly 2/3 E.
    const m = new Markov<string>(2);
    m.train(['C', 'D', 'E']);
    m.train(['C', 'D', 'E']);
    m.train(['C', 'D', 'G']);
    const r = rng('stats');
    let e = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      m.seed(['C', 'D']);
      if (m.next(r) === 'E') e++;
    }
    const ratio = e / n;
    expect(ratio).toBeGreaterThan(0.62);
    expect(ratio).toBeLessThan(0.72);
  });

  it('is deterministic per seed', () => {
    const train = ['C', 'D', 'E', 'C', 'D', 'G', 'E', 'D', 'C', 'G', 'C', 'D'];
    const make = () => {
      const m = new Markov<string>(2);
      m.train(train);
      m.seed(['C', 'D']);
      return m;
    };
    const a = make().steps(rng('walk-7'), 50);
    const b = make().steps(rng('walk-7'), 50);
    expect(a).toEqual(b);
    const c = make().steps(rng('walk-8'), 50);
    expect(c).not.toEqual(a);
  });

  it('falls back to a shorter context when the full context is unseen', () => {
    const m = new Markov<string>(2);
    m.train(['x', 'a', 'b']);
    // [q, a] was never seen at order 2; order-1 [a] -> b is the only option.
    m.seed(['q', 'a']);
    expect(m.next(rng('fallback'))).toBe('b');
  });

  it('falls back to the order-0 distribution when nothing matches', () => {
    const m = new Markov<string>(2);
    m.train(['a', 'a', 'a', 'b']);
    const r = rng('order0');
    for (let i = 0; i < 20; i++) {
      m.seed(['z', 'z']);
      expect(['a', 'b']).toContain(m.next(r));
    }
  });

  it('throws when untrained and validates addTransition', () => {
    const m = new Markov<string>(2);
    expect(() => m.next(rng('empty'))).toThrow();
    expect(() => m.addTransition(['a', 'b', 'c'], 'd')).toThrow(RangeError);
    expect(() => m.addTransition(['a'], 'b', 0)).toThrow(RangeError);
    expect(() => m.addTransition(['a'], 'b', -1)).toThrow(RangeError);
  });

  it('accumulates weights across addTransition calls', () => {
    const m = new Markov<string>(1);
    m.addTransition(['a'], 'b', 1);
    m.addTransition(['a'], 'b', 1);
    m.addTransition(['a'], 'c', 2);
    const r = rng('accumulate');
    let b = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      m.seed(['a']);
      if (m.next(r) === 'b') b++;
    }
    const ratio = b / n;
    expect(ratio).toBeGreaterThan(0.44);
    expect(ratio).toBeLessThan(0.56);
  });

  it('works over numeric alphabets', () => {
    const m = new Markov<number>(1);
    m.train([60, 62, 64, 62, 60]);
    m.seed([64]);
    expect(m.next(rng('nums'))).toBe(62);
  });
});

describe('buildStepwiseMatrix', () => {
  it('produces a square matrix of positive weights', () => {
    const states = [0, 1, 2, 3, 4, 5, 6];
    const mtx = buildStepwiseMatrix(states, rng('mtx'));
    expect(mtx.length).toBe(7);
    for (const row of mtx) {
      expect(row.length).toBe(7);
      for (const w of row) expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it('favors stepwise motion over leaps and repeats', () => {
    const states = [0, 1, 2, 3, 4, 5, 6];
    const mtx = buildStepwiseMatrix(states, rng('bias'));
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const dist = Math.abs(j - i);
        if (dist === 1) continue;
        // Compare against a stepwise move from the same row.
        const stepCol = dist === 0 ? (i + 1 < 7 ? i + 1 : i - 1) : i + (j > i ? 1 : -1);
        expect(mtx[i][j]).toBeLessThan(mtx[i][stepCol]);
      }
    }
  });

  it('repeatPenalty 1 forbids repeats', () => {
    const mtx = buildStepwiseMatrix([0, 1, 2], rng('norep'), { repeatPenalty: 1 });
    for (let i = 0; i < 3; i++) expect(mtx[i][i]).toBe(0);
  });

  it('is deterministic per seed', () => {
    const a = buildStepwiseMatrix([0, 1, 2, 3], rng('m-seed'));
    const b = buildStepwiseMatrix([0, 1, 2, 3], rng('m-seed'));
    expect(a).toEqual(b);
  });

  it('validates inputs', () => {
    expect(() => buildStepwiseMatrix([], rng('bad'))).toThrow(RangeError);
    expect(() => buildStepwiseMatrix([0], rng('bad'), { repeatPenalty: 2 })).toThrow(RangeError);
    expect(() => buildStepwiseMatrix([0], rng('bad'), { leapChance: -1 })).toThrow(RangeError);
  });
});

describe('weightedWalk', () => {
  it('walks deterministically per seed and stays in range', () => {
    const states = [0, 1, 2, 3, 4];
    const mtx = buildStepwiseMatrix(states, rng('walkmtx'));
    const runOnce = (label: string) => {
      const r = rng(label);
      let s = 2;
      const path: number[] = [];
      for (let i = 0; i < 40; i++) {
        s = weightedWalk(mtx, s, r);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(5);
        path.push(s);
      }
      return path;
    };
    expect(runOnce('w-1')).toEqual(runOnce('w-1'));
  });

  it('gravity multiplication pulls the walk toward the gravity set', () => {
    // Uniform matrix so only gravity biases the pick.
    const mtx = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];
    const gravity = new Set([0]);
    const r = rng('gravity');
    let hits = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      if (weightedWalk(mtx, 1, r, gravity, 10) === 0) hits++;
    }
    // Expected probability 10 / 12.
    expect(hits / n).toBeGreaterThan(0.78);
    expect(hits / n).toBeLessThan(0.89);
  });

  it('gravityGain 1 leaves the distribution alone', () => {
    const mtx = [[2, 1, 1]];
    const a = rng('gain1');
    const b = rng('gain1');
    for (let i = 0; i < 50; i++) {
      expect(weightedWalk(mtx, 0, a, new Set([1]), 1)).toBe(weightedWalk(mtx, 0, b));
    }
  });

  it('throws on an out-of-range state', () => {
    expect(() => weightedWalk([[1]], 3, rng('oops'))).toThrow(RangeError);
  });
});
