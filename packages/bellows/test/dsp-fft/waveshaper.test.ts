import { describe, it, expect } from 'vitest';
import {
  tanhShape,
  softClip,
  hardClip,
  foldback,
  chebyshevTable,
  TableShaper,
} from '../../src/dsp/waveshaper';
import { Fft, hann } from '../../src/dsp/fft';

describe('tanhShape', () => {
  it('is odd and passes through the unit points', () => {
    for (const drive of [0.5, 1, 3, 10]) {
      expect(tanhShape(0, drive)).toBe(0);
      expect(tanhShape(1, drive)).toBeCloseTo(1, 10);
      expect(tanhShape(-1, drive)).toBeCloseTo(-1, 10);
      expect(tanhShape(0.3, drive)).toBeCloseTo(-tanhShape(-0.3, drive), 10);
    }
  });

  it('approaches identity at low drive and hard clipping at high drive', () => {
    expect(tanhShape(0.5, 1e-9)).toBeCloseTo(0.5, 6);
    expect(tanhShape(0.5, 0.01)).toBeCloseTo(0.5, 4);
    expect(tanhShape(0.2, 50)).toBeCloseTo(1, 3);
  });

  it('is monotonic in x', () => {
    let prev = -Infinity;
    for (let x = -2; x <= 2; x += 0.01) {
      const y = tanhShape(x, 4);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
});

describe('softClip', () => {
  it('matches the cubic inside and saturates outside', () => {
    expect(softClip(0)).toBe(0);
    expect(softClip(0.4)).toBeCloseTo(0.4 * (1.5 - 0.5 * 0.16), 10);
    expect(softClip(1)).toBe(1);
    expect(softClip(-1)).toBe(-1);
    expect(softClip(3)).toBe(1);
    expect(softClip(-3)).toBe(-1);
  });

  it('is continuous through the clip point', () => {
    expect(softClip(0.9999)).toBeCloseTo(1, 3);
  });
});

describe('hardClip', () => {
  it('clamps to [-1, 1]', () => {
    expect(hardClip(0.5)).toBe(0.5);
    expect(hardClip(2)).toBe(1);
    expect(hardClip(-2)).toBe(-1);
    expect(hardClip(1)).toBe(1);
  });
});

describe('foldback', () => {
  it('is identity while within range', () => {
    expect(foldback(0.5, 1)).toBeCloseTo(0.5, 10);
    expect(foldback(-0.7, 1)).toBeCloseTo(-0.7, 10);
    expect(foldback(0.3, 2)).toBeCloseTo(0.6, 10);
  });

  it('reflects at the boundaries', () => {
    expect(foldback(1.5, 1)).toBeCloseTo(0.5, 10);
    expect(foldback(-1.5, 1)).toBeCloseTo(-0.5, 10);
    expect(foldback(2, 1)).toBeCloseTo(0, 10);
    expect(foldback(0.75, 2)).toBeCloseTo(0.5, 10);
  });

  it('stays bounded at any gain', () => {
    for (let x = -1; x <= 1; x += 0.01) {
      for (const g of [1, 3.7, 10, 25]) {
        const y = foldback(x, g);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is continuous', () => {
    let prev = foldback(-2, 5);
    for (let x = -2 + 1e-3; x <= 2; x += 1e-3) {
      const y = foldback(x, 5);
      expect(Math.abs(y - prev)).toBeLessThan(5 * 2e-3 + 1e-9);
      prev = y;
    }
  });
});

describe('chebyshevTable and TableShaper', () => {
  it('coeffs [1] gives the identity curve', () => {
    const table = chebyshevTable([1], 257);
    const shaper = new TableShaper(table);
    for (const x of [-1, -0.5, 0, 0.25, 1]) {
      expect(shaper.next(x)).toBeCloseTo(x, 5);
    }
  });

  it('coeffs [0, 1] gives T2 = 2x^2 - 1', () => {
    const table = chebyshevTable([0, 1], 2049);
    const shaper = new TableShaper(table);
    for (let x = -1; x <= 1; x += 0.05) {
      expect(shaper.next(x)).toBeCloseTo(2 * x * x - 1, 4);
    }
  });

  it('turns a full-scale cosine into the selected harmonics', () => {
    // T_n(cos t) = cos(n t): coeffs [0, 0, 1] should emit only the
    // third harmonic when driven by a full-scale cosine.
    const n = 4096;
    const cycles = 32;
    const table = chebyshevTable([0, 0, 1], 4096);
    const shaper = new TableShaper(table);
    const w = hann(n);
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = shaper.next(Math.cos((2 * Math.PI * cycles * i) / n)) * w[i];
    }
    new Fft(n).forward(re, im);
    let total = 0;
    let third = 0;
    for (let k = 1; k <= n / 2; k++) {
      const e = re[k] * re[k] + im[k] * im[k];
      total += e;
      if (Math.abs(k - 3 * cycles) <= 2) third += e;
    }
    expect(third / total).toBeGreaterThan(0.99);
  });

  it('TableShaper clamps outside [-1, 1]', () => {
    const table = chebyshevTable([1], 65);
    const shaper = new TableShaper(table);
    expect(shaper.next(-5)).toBe(table[0]);
    expect(shaper.next(5)).toBe(table[64]);
  });

  it('TableShaper interpolates between points', () => {
    const table = new Float32Array([0, 1]);
    const shaper = new TableShaper(table);
    expect(shaper.next(0)).toBeCloseTo(0.5, 6);
    expect(shaper.next(-0.5)).toBeCloseTo(0.25, 6);
  });

  it('rejects degenerate inputs', () => {
    expect(() => chebyshevTable([1], 1)).toThrow();
    expect(() => new TableShaper(new Float32Array(1))).toThrow();
  });
});
