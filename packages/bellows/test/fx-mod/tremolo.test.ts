import { describe, expect, it } from 'vitest';
import { tremoloDef } from '../../src/fx/modfx';
import { processBlocks } from './helpers';

const SR = 48000;

function ones(n: number): Float32Array {
  return new Float32Array(n).fill(1);
}

describe('tremolo', () => {
  it('has a well formed EffectDef', () => {
    expect(tremoloDef.id).toBe('tremolo');
    const names = tremoloDef.params.map((p) => p.name);
    for (const n of ['rate', 'depth', 'shape', 'phase']) expect(names).toContain(n);
    for (const p of tremoloDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('sweeps gain over the full 0..1 range at depth 1', () => {
    const fx = tremoloDef.create(SR, { rate: 4, depth: 1, shape: 0, phase: 0 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    let min = 1;
    let max = 0;
    for (let i = 0; i < l.length; i++) {
      if (l[i] < min) min = l[i];
      if (l[i] > max) max = l[i];
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });

  it('depth 0 leaves the signal untouched', () => {
    const fx = tremoloDef.create(SR, { rate: 4, depth: 0 });
    const l = ones(4096);
    const r = ones(4096);
    processBlocks(fx, l, r);
    for (let i = 0; i < l.length; i += 13) {
      expect(l[i]).toBe(1);
      expect(r[i]).toBe(1);
    }
  });

  it('anti-phase stereo gains sum to 1 with a sine lfo at depth 1', () => {
    const fx = tremoloDef.create(SR, { rate: 4, depth: 1, shape: 0, phase: 0.5 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    for (let i = 0; i < l.length; i += 11) {
      expect(Math.abs(l[i] + r[i] - 1)).toBeLessThan(1e-6);
    }
  });

  it('is periodic at the lfo rate', () => {
    const fx = tremoloDef.create(SR, { rate: 4, depth: 0.8, shape: 0 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    const period = SR / 4;
    for (let i = 0; i < period; i += 17) {
      expect(Math.abs(l[i] - l[i + period])).toBeLessThan(1e-5);
    }
  });

  it('square shape chops between full gain and 1 - depth', () => {
    const fx = tremoloDef.create(SR, { rate: 8, depth: 1, shape: 3 });
    const l = ones(SR);
    const r = ones(SR);
    processBlocks(fx, l, r);
    let high = 0;
    let low = 0;
    for (let i = 0; i < l.length; i++) {
      if (Math.abs(l[i] - 1) < 1e-6) high++;
      else if (Math.abs(l[i]) < 1e-6) low++;
    }
    expect(high + low).toBe(l.length);
    expect(high).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(0);
  });
});
