import { describe, expect, it } from 'vitest';
import { rng } from '../../src/core/prng';
import { ChordWalker, FUNCTIONAL_WEIGHTS, buildProgression } from '../../src/theory/progressions';

describe('FUNCTIONAL_WEIGHTS', () => {
  it('is a 7x7 matrix of nonnegative weights with nonzero rows', () => {
    expect(FUNCTIONAL_WEIGHTS).toHaveLength(7);
    for (const row of FUNCTIONAL_WEIGHTS) {
      expect(row).toHaveLength(7);
      let sum = 0;
      for (const w of row) {
        expect(w).toBeGreaterThanOrEqual(0);
        sum += w;
      }
      expect(sum).toBeGreaterThan(0);
    }
  });

  it('encodes the strong pulls: V resolves to I most of all', () => {
    const fromV = FUNCTIONAL_WEIGHTS[4];
    for (let d = 1; d < 7; d++) expect(fromV[0]).toBeGreaterThan(fromV[d]);
    const fromII = FUNCTIONAL_WEIGHTS[1];
    for (let d = 0; d < 7; d++) {
      if (d !== 4) expect(fromII[4]).toBeGreaterThan(fromII[d]);
    }
  });
});

describe('buildProgression', () => {
  it('is deterministic for the same rng label', () => {
    const a = buildProgression(rng('prog-test'), 16);
    const b = buildProgression(rng('prog-test'), 16);
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = buildProgression(rng('prog-a'), 16);
    const b = buildProgression(rng('prog-b'), 16);
    expect(a).not.toEqual(b);
  });

  it('starts on the tonic and stays in range', () => {
    const out = buildProgression(rng('prog-range'), 12);
    expect(out).toHaveLength(12);
    expect(out[0]).toBe(0);
    for (const d of out) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  it('cadences by default: dominant function into tonic', () => {
    for (let i = 0; i < 20; i++) {
      const out = buildProgression(rng('cadence-' + i), 8);
      expect(out[7]).toBe(0);
      expect([3, 4, 6]).toContain(out[6]);
    }
  });

  it('can skip the cadence', () => {
    let sawNonTonicEnd = false;
    for (let i = 0; i < 20; i++) {
      const out = buildProgression(rng('free-' + i), 8, { cadence: false });
      if (out[7] !== 0) sawNonTonicEnd = true;
    }
    expect(sawNonTonicEnd).toBe(true);
  });

  it('handles tiny sizes', () => {
    expect(buildProgression(rng('tiny'), 0)).toEqual([]);
    expect(buildProgression(rng('tiny'), 1)).toEqual([0]);
    const two = buildProgression(rng('tiny'), 2);
    expect(two).toHaveLength(2);
    expect(two[0]).toBe(0);
  });

  it('two bars is a half cadence, not tonic to tonic', () => {
    // Bar 0 is the tonic and bar 1 is both penultimate and last, so the
    // cadence chord takes it. Returning [0, 0] means the tonic branch won.
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const out = buildProgression(rng('half-' + i), 2);
      expect(out[0]).toBe(0);
      expect([3, 4, 6], 'seed ' + i).toContain(out[1]);
      seen.add(out[1]);
    }
    // V is weighted 5 against 1.5 and 1, so it has to turn up.
    expect(seen.has(4)).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('two bars without a cadence still walks', () => {
    const out = buildProgression(rng('two-free'), 2, { cadence: false });
    expect(out[0]).toBe(0);
    expect(out[1]).toBeGreaterThanOrEqual(0);
    expect(out[1]).toBeLessThanOrEqual(6);
  });

  it('three bars keeps the documented shape: cadence chord then tonic', () => {
    for (let i = 0; i < 20; i++) {
      const out = buildProgression(rng('three-' + i), 3);
      expect(out[0]).toBe(0);
      expect([3, 4, 6], 'seed ' + i).toContain(out[1]);
      expect(out[2]).toBe(0);
    }
  });
});

describe('ChordWalker', () => {
  it('steps deterministically for the same rng label', () => {
    const w1 = new ChordWalker(rng('walk'));
    const w2 = new ChordWalker(rng('walk'));
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 32; i++) {
      a.push(w1.step());
      b.push(w2.step());
    }
    expect(a).toEqual(b);
    for (const d of a) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  it('follows a custom matrix', () => {
    // each degree moves to the next, a fixed cycle
    const cycle = Array.from({ length: 7 }, (_, i) => {
      const row = new Array(7).fill(0);
      row[(i + 1) % 7] = 1;
      return row;
    });
    const w = new ChordWalker(rng('cycle'), cycle);
    expect([w.step(), w.step(), w.step(), w.step()]).toEqual([1, 2, 3, 4]);
  });

  it('resets without consuming randomness', () => {
    const w = new ChordWalker(rng('reset'));
    w.step();
    w.reset(4);
    expect(w.degree).toBe(4);
  });

  it('resolves V to I more than anywhere else', () => {
    const r = rng('stats');
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 1000; i++) {
      const w = new ChordWalker(r, FUNCTIONAL_WEIGHTS, 4);
      counts[w.step()]++;
    }
    for (let d = 1; d < 7; d++) expect(counts[0]).toBeGreaterThan(counts[d]);
  });
});
