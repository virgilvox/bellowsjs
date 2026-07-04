import { describe, expect, it } from 'vitest';
import { Tuning, degreeFreq } from '../../src/theory/tuning';
import { mtof } from '../../src/types';

describe('Tuning.edo', () => {
  it('edo(12) matches the A440 midi table within 1e-9', () => {
    const t = Tuning.edo(12);
    for (let m = 0; m <= 127; m++) {
      expect(Math.abs(t.freqOf(m) - mtof(m))).toBeLessThan(1e-9);
    }
  });

  it('default12 is edo(12)', () => {
    const t = Tuning.default12;
    expect(t.size).toBe(12);
    expect(t.freqOf(69)).toBeCloseTo(440, 9);
    expect(t.midiToFreq(60)).toBeCloseTo(mtof(60), 9);
  });

  it('edo(19) has 19 equal steps per octave', () => {
    const t = Tuning.edo(19);
    expect(t.size).toBe(19);
    expect(t.freqOf(69)).toBeCloseTo(440, 9);
    expect(t.freqOf(69 + 19)).toBeCloseTo(880, 9);
    const step = t.freqOf(70) / t.freqOf(69);
    expect(step).toBeCloseTo(Math.pow(2, 1 / 19), 12);
    // one step is 1200/19 cents
    expect(t.centsOf(70) - t.centsOf(69)).toBeCloseTo(1200 / 19, 9);
  });

  it('edo(31) spot checks', () => {
    const t = Tuning.edo(31, 440, 69);
    expect(t.freqOf(69)).toBeCloseTo(440, 9);
    expect(t.freqOf(69 - 31)).toBeCloseTo(220, 9);
    expect(t.freqOf(69 + 18) / 440).toBeCloseTo(Math.pow(2, 18 / 31), 12);
    // 31-edo's 18th step approximates a just fifth to under a cent
    const fifthCents = t.centsOf(69 + 18) - t.centsOf(69);
    expect(Math.abs(fifthCents - 1200 * Math.log2(1.5))).toBeLessThan(1);
  });

  it('honors custom reference frequency and index', () => {
    const t = Tuning.edo(12, 432, 69);
    expect(t.freqOf(69)).toBeCloseTo(432, 9);
    expect(t.freqOf(81)).toBeCloseTo(864, 9);
  });

  it('rejects invalid divisions', () => {
    expect(() => Tuning.edo(0)).toThrow(/positive integer/);
    expect(() => Tuning.edo(2.5)).toThrow(/positive integer/);
  });
});

describe('Tuning.ji', () => {
  const major = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];

  it('gives exact frequency ratios for the just major scale', () => {
    const t = Tuning.ji(major, 264, 60);
    const base = t.freqOf(60);
    expect(base).toBeCloseTo(264, 9);
    expect(Math.abs(t.freqOf(61) / base - 9 / 8)).toBeLessThan(1e-9);
    expect(Math.abs(t.freqOf(62) / base - 5 / 4)).toBeLessThan(1e-9);
    expect(Math.abs(t.freqOf(64) / base - 3 / 2)).toBeLessThan(1e-9);
    expect(Math.abs(t.freqOf(66) / base - 15 / 8)).toBeLessThan(1e-9);
    expect(Math.abs(t.freqOf(67) / base - 2)).toBeLessThan(1e-9);
  });

  it('extends periodically in both directions', () => {
    const t = Tuning.ji(major, 264, 60);
    expect(Math.abs(t.freqOf(60 + 7) / t.freqOf(60) - 2)).toBeLessThan(1e-9);
    expect(Math.abs(t.freqOf(60 - 7) / t.freqOf(60) - 0.5)).toBeLessThan(1e-9);
    // degree 1 an octave down
    expect(Math.abs(t.freqOf(60 - 6) / t.freqOf(60) - 9 / 16)).toBeLessThan(1e-9);
  });

  it('supports non-octave periods', () => {
    // Bohlen-Pierce style: period 3
    const t = Tuning.ji([1, 5 / 3, 7 / 3], 200, 0, 3);
    expect(t.size).toBe(3);
    expect(Math.abs(t.freqOf(3) / t.freqOf(0) - 3)).toBeLessThan(1e-9);
  });

  it('rejects bad ratios and periods', () => {
    expect(() => Tuning.ji([1, -2], 440, 69)).toThrow(/positive/);
    expect(() => Tuning.ji([1, 1.5], 440, 69, 1)).toThrow(/period/);
    expect(() => Tuning.ji([], 440, 69)).toThrow(/at least one/);
  });
});

describe('Tuning.fromCents', () => {
  it('reproduces edo(12) from an explicit cents table', () => {
    const cents = Array.from({ length: 12 }, (_, i) => i * 100);
    const t = Tuning.fromCents(cents, 1200, 440, 69);
    for (let m = 40; m <= 100; m++) {
      expect(Math.abs(t.freqOf(m) - mtof(m))).toBeLessThan(1e-9);
    }
  });

  it('returns NaN for unmapped (NaN) degrees', () => {
    const t = Tuning.fromCents([0, NaN, 200], 300, 100, 60);
    expect(t.freqOf(60)).toBeCloseTo(100, 9);
    expect(Number.isNaN(t.freqOf(61))).toBe(true);
    expect(Number.isNaN(t.freqOf(64))).toBe(true);
    expect(t.freqOf(63)).toBeCloseTo(100 * Math.pow(2, 300 / 1200), 9);
  });

  it('rejects a non-positive period', () => {
    expect(() => Tuning.fromCents([0], 0)).toThrow(/period/);
  });
});

describe('centsOf and fractional indices', () => {
  it('centsOf is zero at the reference and 100 per edo(12) step', () => {
    const t = Tuning.edo(12);
    expect(t.centsOf(69)).toBeCloseTo(0, 9);
    expect(t.centsOf(70)).toBeCloseTo(100, 9);
    expect(t.centsOf(57)).toBeCloseTo(-1200, 9);
  });

  it('interpolates fractional indices linearly in cents', () => {
    const t = Tuning.edo(12);
    expect(t.freqOf(69.5)).toBeCloseTo(440 * Math.pow(2, 0.5 / 12), 9);
    expect(t.centsOf(69.25)).toBeCloseTo(25, 9);
  });
});

describe('transpose helpers', () => {
  it('transposeCents shifts every pitch', () => {
    const t = Tuning.edo(12).transposeCents(100);
    expect(t.freqOf(69)).toBeCloseTo(mtof(70), 9);
  });

  it('transposeRatio multiplies every pitch', () => {
    const t = Tuning.edo(12).transposeRatio(3 / 2);
    expect(Math.abs(t.freqOf(69) / 440 - 3 / 2)).toBeLessThan(1e-9);
  });

  it('transposeSteps makes each index sound steps higher', () => {
    const base = Tuning.edo(12);
    const up2 = base.transposeSteps(2);
    expect(up2.freqOf(60)).toBeCloseTo(base.freqOf(62), 9);
    const down3 = base.transposeSteps(-3);
    expect(down3.freqOf(60)).toBeCloseTo(base.freqOf(57), 9);
  });

  it('transposeSteps requires integer steps', () => {
    expect(() => Tuning.edo(12).transposeSteps(0.5)).toThrow(/integer/);
  });
});

describe('degreeFreq', () => {
  const major = [0, 2, 4, 5, 7, 9, 11];

  it('walks a major scale through edo(12)', () => {
    const t = Tuning.default12;
    expect(degreeFreq(t, 60, major, 0)).toBeCloseTo(mtof(60), 9);
    expect(degreeFreq(t, 60, major, 2)).toBeCloseTo(mtof(64), 9);
    expect(degreeFreq(t, 60, major, 4)).toBeCloseTo(mtof(67), 9);
    expect(degreeFreq(t, 60, major, 7)).toBeCloseTo(mtof(72), 9);
  });

  it('wraps negative degrees and applies octave shifts', () => {
    const t = Tuning.default12;
    expect(degreeFreq(t, 60, major, -1)).toBeCloseTo(mtof(59), 9);
    expect(degreeFreq(t, 60, major, -7)).toBeCloseTo(mtof(48), 9);
    expect(degreeFreq(t, 60, major, 0, 1)).toBeCloseTo(mtof(72), 9);
    expect(degreeFreq(t, 60, major, 2, -1)).toBeCloseTo(mtof(52), 9);
  });

  it('works through a non-12 tuning', () => {
    // 19-edo "major": steps chosen inside the 19-note octave
    const t = Tuning.edo(19, 440, 0);
    const scale = [0, 3, 6, 8, 11, 14, 17];
    expect(degreeFreq(t, 0, scale, 1)).toBeCloseTo(440 * Math.pow(2, 3 / 19), 9);
    expect(degreeFreq(t, 0, scale, 7)).toBeCloseTo(880, 9);
  });

  it('rejects empty interval lists and fractional degrees', () => {
    const t = Tuning.default12;
    expect(() => degreeFreq(t, 60, [], 0)).toThrow(/empty/);
    expect(() => degreeFreq(t, 60, major, 0.5)).toThrow(/integer/);
  });
});
