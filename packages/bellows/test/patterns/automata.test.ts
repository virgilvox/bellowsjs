import { describe, it, expect } from 'vitest';
import { ElementaryCA, caRhythm } from '../../src/seq/automata';
import { rng } from '../../src/core/prng';

const rowOf = (ca: ElementaryCA) => Array.from(ca.row);

describe('ElementaryCA', () => {
  it('rule 110 reproduces the known left-growing triangle', () => {
    // Width 11, single seed at index 5, hand-computed rows.
    const ca = new ElementaryCA(110, 11);
    expect(rowOf(ca)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    ca.step();
    expect(rowOf(ca)).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    ca.step();
    expect(rowOf(ca)).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0]);
    ca.step();
    expect(rowOf(ca)).toEqual([0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0]);
    expect(ca.generation).toBe(3);
  });

  it('rule 90 computes left XOR right', () => {
    const init = [1, 0, 1, 1, 0, 0, 1, 0];
    const ca = new ElementaryCA(90, 8, init);
    ca.step();
    const w = init.length;
    for (let i = 0; i < w; i++) {
      expect(ca.row[i]).toBe(init[(i - 1 + w) % w] ^ init[(i + 1) % w]);
    }
  });

  it('wraps around at the edges', () => {
    // Rule 90 with a seed at index 0: neighbors of cells 1 and w-1 see it.
    const ca = new ElementaryCA(90, 5, [1, 0, 0, 0, 0]);
    ca.step();
    expect(rowOf(ca)).toEqual([0, 1, 0, 0, 1]);
  });

  it('rule 0 kills everything, rule 204 is the identity', () => {
    const init = [1, 0, 1, 1, 0];
    const dead = new ElementaryCA(0, 5, init);
    dead.step();
    expect(rowOf(dead)).toEqual([0, 0, 0, 0, 0]);
    const same = new ElementaryCA(204, 5, init);
    same.step();
    same.step();
    expect(rowOf(same)).toEqual(init);
  });

  it('seeded random init is deterministic and row reference is stable', () => {
    const a = new ElementaryCA(30, 32, rng('ca-init'));
    const b = new ElementaryCA(30, 32, rng('ca-init'));
    expect(rowOf(a)).toEqual(rowOf(b));
    const ref = a.row;
    a.step();
    expect(a.row).toBe(ref);
  });

  it('validates inputs', () => {
    expect(() => new ElementaryCA(-1, 8)).toThrow(RangeError);
    expect(() => new ElementaryCA(256, 8)).toThrow(RangeError);
    expect(() => new ElementaryCA(110.5, 8)).toThrow(RangeError);
    expect(() => new ElementaryCA(110, 0)).toThrow(RangeError);
    expect(() => new ElementaryCA(110, 8, [1, 0])).toThrow(RangeError);
  });
});

describe('caRhythm', () => {
  it('samples the center column across generations', () => {
    // Rule 110, width 11, seed at center (index 5).
    // Center column over the hand-computed rows: 1, 1, 1, 1.
    const ca = new ElementaryCA(110, 11);
    expect(caRhythm(ca, 4)).toEqual([1, 1, 1, 1]);
    expect(ca.generation).toBe(4);
  });

  it('samples an arbitrary column', () => {
    // Same triangle: column 4 reads 0 then 1 then 1 then 0.
    const ca = new ElementaryCA(110, 11);
    expect(caRhythm(ca, 4, 4)).toEqual([0, 1, 1, 0]);
  });

  it('only ever emits gates', () => {
    const ca = new ElementaryCA(30, 16, rng('gates'));
    for (const g of caRhythm(ca, 64)) expect(g === 0 || g === 1).toBe(true);
  });

  it('validates inputs', () => {
    const ca = new ElementaryCA(110, 8);
    expect(() => caRhythm(ca, -1)).toThrow(RangeError);
    expect(() => caRhythm(ca, 4, 8)).toThrow(RangeError);
    expect(() => caRhythm(ca, 4, -1)).toThrow(RangeError);
  });
});
