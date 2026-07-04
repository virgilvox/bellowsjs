import { describe, it, expect } from 'vitest';
import { euclid, rotate } from '../../src/seq/euclid';

describe('euclid', () => {
  it('E(3, 8) is the tresillo (true Bjorklund, not the accumulator)', () => {
    expect(euclid(3, 8)).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
  });

  it('E(5, 8) is the cinquillo', () => {
    expect(euclid(5, 8)).toEqual([1, 0, 1, 1, 0, 1, 1, 0]);
  });

  it('E(7, 16) matches the samba fixture', () => {
    expect(euclid(7, 16)).toEqual([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('more classic fixtures', () => {
    expect(euclid(2, 5)).toEqual([1, 0, 1, 0, 0]);
    expect(euclid(3, 7)).toEqual([1, 0, 1, 0, 1, 0, 0]);
    expect(euclid(4, 9)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(euclid(5, 13)).toEqual([1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0]);
  });

  it('handles degenerate pulse counts', () => {
    expect(euclid(0, 4)).toEqual([0, 0, 0, 0]);
    expect(euclid(4, 4)).toEqual([1, 1, 1, 1]);
    expect(euclid(1, 4)).toEqual([1, 0, 0, 0]);
    expect(euclid(4, 8)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('always emits exactly `pulses` onsets over `steps` slots', () => {
    for (let steps = 1; steps <= 24; steps++) {
      for (let pulses = 0; pulses <= steps; pulses++) {
        const out = euclid(pulses, steps);
        expect(out.length).toBe(steps);
        expect(out.reduce((a, b) => a + b, 0)).toBe(pulses);
      }
    }
  });

  it('applies rotation to the left', () => {
    expect(euclid(3, 8, 1)).toEqual([0, 0, 1, 0, 0, 1, 0, 1]);
    expect(euclid(3, 8, 3)).toEqual([1, 0, 0, 1, 0, 1, 0, 0]);
    expect(euclid(3, 8, 8)).toEqual(euclid(3, 8));
    expect(euclid(3, 8, -8)).toEqual(euclid(3, 8));
  });

  it('validates inputs', () => {
    expect(() => euclid(3, 0)).toThrow(RangeError);
    expect(() => euclid(-1, 8)).toThrow(RangeError);
    expect(() => euclid(9, 8)).toThrow(RangeError);
    expect(() => euclid(2.5, 8)).toThrow(RangeError);
    expect(() => euclid(3, 8.1)).toThrow(RangeError);
    expect(() => euclid(3, 8, 0.5)).toThrow(RangeError);
  });
});

describe('rotate', () => {
  it('rotates left by n', () => {
    expect(rotate([1, 2, 3, 4], 1)).toEqual([2, 3, 4, 1]);
    expect(rotate([1, 2, 3, 4], 3)).toEqual([4, 1, 2, 3]);
  });

  it('handles negative and oversized n', () => {
    expect(rotate([1, 2, 3, 4], -1)).toEqual([4, 1, 2, 3]);
    expect(rotate([1, 2, 3, 4], 5)).toEqual([2, 3, 4, 1]);
    expect(rotate([1, 2, 3, 4], 0)).toEqual([1, 2, 3, 4]);
  });

  it('returns a new array and tolerates empty input', () => {
    const src = [1, 2];
    const out = rotate(src, 0);
    expect(out).not.toBe(src);
    expect(rotate([], 3)).toEqual([]);
  });
});
