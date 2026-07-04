import { describe, expect, it } from 'vitest';
import { autopanDef } from '../../src/fx/modfx';
import { processBlocks } from './helpers';

const SR = 48000;

function ones(n: number): Float32Array {
  return new Float32Array(n).fill(1);
}

describe('autopan', () => {
  it('has a well formed EffectDef', () => {
    expect(autopanDef.id).toBe('autopan');
    const names = autopanDef.params.map((p) => p.name);
    for (const n of ['rate', 'depth', 'shape']) expect(names).toContain(n);
    for (const p of autopanDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('keeps total power constant (equal-power law)', () => {
    const fx = autopanDef.create(SR, { rate: 2, depth: 1 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    for (let i = 0; i < l.length; i += 7) {
      expect(Math.abs(l[i] * l[i] + r[i] * r[i] - 1)).toBeLessThan(1e-6);
    }
  });

  it('sweeps each channel from silent to full at depth 1', () => {
    const fx = autopanDef.create(SR, { rate: 2, depth: 1 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    let minL = 1;
    let maxL = 0;
    let minR = 1;
    let maxR = 0;
    for (let i = 0; i < l.length; i++) {
      if (l[i] < minL) minL = l[i];
      if (l[i] > maxL) maxL = l[i];
      if (r[i] < minR) minR = r[i];
      if (r[i] > maxR) maxR = r[i];
    }
    expect(minL).toBeLessThan(0.02);
    expect(maxL).toBeGreaterThan(0.98);
    expect(minR).toBeLessThan(0.02);
    expect(maxR).toBeGreaterThan(0.98);
  });

  it('channels move in opposition', () => {
    const fx = autopanDef.create(SR, { rate: 2, depth: 1 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    // wherever the left gain rises the right gain must fall
    for (let i = 100; i < SR / 2; i += 500) {
      const dl = l[i] - l[i - 64];
      const dr = r[i] - r[i - 64];
      if (Math.abs(dl) > 1e-4) expect(Math.sign(dr)).toBe(-Math.sign(dl));
    }
  });

  it('depth 0 pins the pan at center, 3 dB down each side', () => {
    const fx = autopanDef.create(SR, { rate: 2, depth: 0 });
    const l = ones(4096);
    const r = ones(4096);
    processBlocks(fx, l, r);
    const c = Math.SQRT1_2;
    for (let i = 0; i < l.length; i += 19) {
      expect(Math.abs(l[i] - c)).toBeLessThan(1e-6);
      expect(Math.abs(r[i] - c)).toBeLessThan(1e-6);
    }
  });

  it('is periodic at the lfo rate', () => {
    const fx = autopanDef.create(SR, { rate: 2, depth: 1 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    const period = SR / 2;
    for (let i = 0; i < period; i += 23) {
      expect(Math.abs(l[i] - l[i + period])).toBeLessThan(1e-5);
    }
  });
});
