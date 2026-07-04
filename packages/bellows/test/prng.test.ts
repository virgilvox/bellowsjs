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
});
