import { describe, it, expect } from 'vitest';
import { lsystem, mapToDegrees } from '../../src/seq/lsystem';
import { rng } from '../../src/core/prng';

describe('lsystem', () => {
  const algae = { A: 'AB', B: 'A' };

  it('generation 0 returns the axiom', () => {
    expect(lsystem('A', algae, 0)).toBe('A');
  });

  it('grows Lindenmayer algae with Fibonacci lengths', () => {
    expect(lsystem('A', algae, 1)).toBe('AB');
    expect(lsystem('A', algae, 2)).toBe('ABA');
    expect(lsystem('A', algae, 3)).toBe('ABAAB');
    expect(lsystem('A', algae, 4)).toBe('ABAABABA');
    const lengths = [1, 2, 3, 5, 8, 13, 21, 34];
    for (let g = 0; g < lengths.length; g++) {
      expect(lsystem('A', algae, g).length).toBe(lengths[g]);
    }
  });

  it('passes unmapped symbols through unchanged', () => {
    expect(lsystem('A+B', { A: 'AB' }, 1)).toBe('AB+B');
    expect(lsystem('X', {}, 5)).toBe('X');
  });

  it('rewrites all symbols in parallel', () => {
    // Sequential rewriting of A -> B before B -> A would collapse everything.
    expect(lsystem('AB', { A: 'B', B: 'A' }, 1)).toBe('BA');
    expect(lsystem('AB', { A: 'B', B: 'A' }, 2)).toBe('AB');
  });

  it('stochastic rules are deterministic per seed', () => {
    const rules = { A: [{ out: 'AB', weight: 1 }, { out: 'A', weight: 1 }], B: 'A' };
    const a = lsystem('A', rules, 8, rng('lsys-1'));
    const b = lsystem('A', rules, 8, rng('lsys-1'));
    expect(a).toBe(b);
    const c = lsystem('A', rules, 8, rng('lsys-2'));
    expect(c).not.toBe(a);
  });

  it('stochastic weights bias the choice', () => {
    // Weight 0 on the second option means the first is always taken.
    const rules = { A: [{ out: 'AA', weight: 1 }, { out: 'A', weight: 0 }] };
    expect(lsystem('A', rules, 4, rng('lsys-w'))).toBe('A'.repeat(16));
  });

  it('validates inputs', () => {
    expect(() => lsystem('A', algae, -1)).toThrow(RangeError);
    expect(() => lsystem('A', algae, 1.5)).toThrow(RangeError);
    expect(() => lsystem('A', { AB: 'A' }, 1)).toThrow(RangeError);
    expect(() => lsystem('A', { A: [] }, 1, rng('x'))).toThrow(RangeError);
    expect(() => lsystem('A', { A: [{ out: 'AB', weight: 1 }] }, 1)).toThrow();
  });
});

describe('mapToDegrees', () => {
  it('maps symbols to degrees and nulls to rests', () => {
    expect(mapToDegrees('ABRA', { A: 0, B: 2, R: null })).toEqual([0, 2, null, 0]);
  });

  it('skips symbols missing from the mapping', () => {
    expect(mapToDegrees('A+B-A', { A: 0, B: 4 })).toEqual([0, 4, 0]);
    expect(mapToDegrees('+-[]', { A: 0 })).toEqual([]);
  });

  it('works end to end with an L-system expansion', () => {
    const s = lsystem('A', { A: 'AB', B: 'A' }, 3); // ABAAB
    expect(mapToDegrees(s, { A: 0, B: 7 })).toEqual([0, 7, 0, 0, 7]);
  });
});
