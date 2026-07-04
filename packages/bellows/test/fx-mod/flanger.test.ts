import { describe, expect, it } from 'vitest';
import { flangerDef } from '../../src/fx/modfx';
import { rng } from '../../src/core/prng';
import { allFinite, irMag, maxAbs, maxAbsDiff, processBlocks, sineBuf } from './helpers';

const SR = 48000;
// manual position that puts the center delay at exactly 5 ms (240 samples)
const MANUAL_5MS = (5 - 0.5) / (10 - 0.5);

function impulseResponse(params: Record<string, number>, n: number): Float32Array {
  const fx = flangerDef.create(SR, params);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  l[0] = 1;
  r[0] = 1;
  fx.process(l, r, 0, n);
  return l;
}

describe('flanger', () => {
  it('has a well formed EffectDef', () => {
    expect(flangerDef.id).toBe('flanger');
    const names = flangerDef.params.map((p) => p.name);
    for (const n of ['rate', 'depth', 'manual', 'feedback', 'mix', 'invert']) {
      expect(names).toContain(n);
    }
    for (const p of flangerDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('passes dry through exactly at mix 0', () => {
    const fx = flangerDef.create(SR, { mix: 0 });
    const l = sineBuf(4096, 300, SR);
    const r = sineBuf(4096, 500, SR);
    const refL = l.slice();
    const refR = r.slice();
    processBlocks(fx, l, r);
    expect(maxAbsDiff(l, refL)).toBe(0);
    expect(maxAbsDiff(r, refR)).toBe(0);
  });

  it('forms a comb: notch at odd multiples of fs/2d, peak at even', () => {
    // 240 sample delay, mix 0.5, no sweep: h = 0.5 d[n] + 0.5 d[n-240].
    // Notch at 100 Hz and 300 Hz, peaks at 0 and 200 Hz.
    const h = impulseResponse(
      { rate: 0.01, depth: 0, manual: MANUAL_5MS, feedback: 0, mix: 0.5, invert: 0 },
      2048,
    );
    expect(irMag(h, 100, SR)).toBeLessThan(0.02);
    expect(irMag(h, 300, SR)).toBeLessThan(0.02);
    expect(irMag(h, 200, SR)).toBeGreaterThan(0.9);
    expect(irMag(h, 400, SR)).toBeGreaterThan(0.9);
  });

  it('invert swaps notches and peaks', () => {
    const h = impulseResponse(
      { rate: 0.01, depth: 0, manual: MANUAL_5MS, feedback: 0, mix: 0.5, invert: 1 },
      2048,
    );
    expect(irMag(h, 200, SR)).toBeLessThan(0.02);
    expect(irMag(h, 100, SR)).toBeGreaterThan(0.9);
  });

  it('feedback deepens the comb: resonant peak gain approaches 1/(1-fb)', () => {
    const h = impulseResponse(
      { rate: 0.01, depth: 0, manual: MANUAL_5MS, feedback: 0.8, mix: 1, invert: 0 },
      48000,
    );
    // wet-only comb y[n] = x[n-240] + 0.8 y[n-241]: peak gain near 5
    expect(irMag(h, 200, SR)).toBeGreaterThan(3.5);
  });

  it('stays bounded and finite at feedback 0.9', () => {
    const fx = flangerDef.create(SR, { rate: 0.5, depth: 1, feedback: 0.9, mix: 0.5 });
    const noise = rng('flanger/fb');
    const l = new Float32Array(SR * 2);
    const r = new Float32Array(SR * 2);
    for (let i = 0; i < l.length; i++) {
      l[i] = 2 * noise() - 1;
      r[i] = 2 * noise() - 1;
    }
    processBlocks(fx, l, r);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(maxAbs(l)).toBeLessThan(60);
    expect(maxAbs(r)).toBeLessThan(60);
  });

  it('modulation changes the output over time', () => {
    const x = sineBuf(SR, 440, SR);
    const still = flangerDef.create(SR, { rate: 1, depth: 0, manual: 0.5, feedback: 0, mix: 0.5 });
    const l0 = x.slice();
    const r0 = x.slice();
    processBlocks(still, l0, r0);

    const moving = flangerDef.create(SR, { rate: 1, depth: 1, manual: 0.5, feedback: 0, mix: 0.5 });
    const l1 = x.slice();
    const r1 = x.slice();
    processBlocks(moving, l1, r1);

    expect(maxAbsDiff(l1, l0)).toBeGreaterThan(0.05);
  });
});
