import { describe, it, expect } from 'vitest';
import { DelayLine } from '../../src/dsp/delayline';

describe('DelayLine', () => {
  it('readInt returns exact past samples', () => {
    const dl = new DelayLine(64);
    for (let i = 0; i < 200; i++) dl.write(i);
    // Last written value is 199.
    expect(dl.readInt(0)).toBe(199);
    expect(dl.readInt(1)).toBe(198);
    expect(dl.readInt(64)).toBe(199 - 64);
  });

  it('readInt survives ring wraparound', () => {
    const dl = new DelayLine(16);
    for (let i = 0; i < 1000; i++) {
      dl.write(i);
      if (i >= 16) expect(dl.readInt(16)).toBe(i - 16);
    }
  });

  it('readLinear is exact on a linear ramp', () => {
    const dl = new DelayLine(64);
    for (let i = 0; i < 100; i++) dl.write(i * 0.5);
    // Signal is linear in time, so linear interpolation is exact.
    const last = 99 * 0.5;
    expect(dl.readLinear(3.25)).toBeCloseTo(last - 3.25 * 0.5, 6);
    expect(dl.readLinear(10.75)).toBeCloseTo(last - 10.75 * 0.5, 6);
    expect(dl.readLinear(0)).toBeCloseTo(last, 6);
  });

  it('readCubic is exact on a quadratic', () => {
    // Keys cubic (Catmull-Rom) reproduces polynomials up to degree 2.
    const dl = new DelayLine(64);
    const f = (t: number) => 0.001 * t * t - 0.03 * t + 2;
    for (let i = 0; i < 100; i++) dl.write(f(i));
    for (const d of [1.5, 4.25, 20.9]) {
      expect(dl.readCubic(d)).toBeCloseTo(f(99 - d), 5);
    }
  });

  it('readCubic tracks a sine to fractional delays', () => {
    const sr = 48000;
    const freq = 441;
    const dl = new DelayLine(256);
    const n = 2000;
    for (let i = 0; i < n; i++) dl.write(Math.sin((2 * Math.PI * freq * i) / sr));
    for (const d of [1.0, 2.5, 17.37, 100.001, 200.75]) {
      const expected = Math.sin((2 * Math.PI * freq * (n - 1 - d)) / sr);
      expect(Math.abs(dl.readCubic(d) - expected)).toBeLessThan(1e-4);
    }
  });

  it('readLinear tracks a sine within its coarser tolerance', () => {
    const sr = 48000;
    const freq = 441;
    const dl = new DelayLine(256);
    const n = 2000;
    for (let i = 0; i < n; i++) dl.write(Math.sin((2 * Math.PI * freq * i) / sr));
    for (const d of [2.5, 17.37, 200.75]) {
      const expected = Math.sin((2 * Math.PI * freq * (n - 1 - d)) / sr);
      expect(Math.abs(dl.readLinear(d) - expected)).toBeLessThan(1e-3);
    }
  });

  it('clear zeroes the buffer', () => {
    const dl = new DelayLine(32);
    for (let i = 0; i < 40; i++) dl.write(1);
    dl.clear();
    for (let d = 0; d <= 32; d++) expect(dl.readInt(d)).toBe(0);
    expect(dl.readLinear(4.5)).toBe(0);
    expect(dl.readCubic(4.5)).toBe(0);
  });

  it('clamps out-of-range delays instead of reading garbage', () => {
    const dl = new DelayLine(8);
    for (let i = 0; i < 100; i++) dl.write(i);
    expect(dl.readInt(-3)).toBe(99);
    expect(dl.readLinear(1000)).toBe(dl.readLinear(8));
    expect(dl.readCubic(0.2)).toBe(dl.readCubic(1));
  });
});
