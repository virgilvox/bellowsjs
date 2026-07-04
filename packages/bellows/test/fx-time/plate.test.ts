import { describe, expect, it } from 'vitest';
import { plateDef } from '../../src/fx/plate';
import { allFinite, correlation, impulseResponse, maxAbs, processBlocks, rms } from './util';
import { rng } from '../../src/core/prng';

// Any rate works: internals scale from the paper's 29761 Hz.
const SR = 32000;

describe('plate def', () => {
  it('exposes id and params', () => {
    expect(plateDef.id).toBe('plate');
    const names = plateDef.params.map((p) => p.name);
    for (const n of ['decay', 'damping', 'bandwidth', 'predelay', 'mix', 'modDepth']) {
      expect(names).toContain(n);
    }
  });
});

describe('plate reverb', () => {
  it('turns an impulse into a long dense tail', () => {
    const fx = plateDef.create(SR, { decay: 0.8, damping: 0.1, mix: 1 });
    const n = Math.round(1.2 * SR);
    const { l, r } = impulseResponse(fx, n);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    // Tail still audible at one second.
    expect(rms(l, Math.round(0.9 * SR), SR)).toBeGreaterThan(1e-4);
    // Dense: most samples in the mid tail are active relative to its level.
    const from = Math.round(0.2 * SR);
    const to = Math.round(0.5 * SR);
    const level = rms(l, from, to);
    let active = 0;
    for (let i = from; i < to; i++) if (Math.abs(l[i]) > 0.05 * level) active++;
    expect(active / (to - from)).toBeGreaterThan(0.5);
  });

  it('decorrelates left and right tails', () => {
    const fx = plateDef.create(SR, { decay: 0.8, mix: 1 });
    const n = SR;
    const { l, r } = impulseResponse(fx, n);
    const c = correlation(l, r, Math.round(0.05 * SR), Math.round(0.9 * SR));
    expect(Math.abs(c)).toBeLessThan(0.9);
    expect(rms(r, Math.round(0.2 * SR), Math.round(0.5 * SR))).toBeGreaterThan(1e-4);
  });

  it('decay lengthens the tail monotonically', () => {
    const tailEnergy = (decay: number): number => {
      const fx = plateDef.create(SR, { decay, mix: 1, modDepth: 0 });
      const n = Math.round(0.8 * SR);
      const { l } = impulseResponse(fx, n);
      return rms(l, Math.round(0.4 * SR), Math.round(0.7 * SR));
    };
    const e3 = tailEnergy(0.3);
    const e5 = tailEnergy(0.5);
    const e7 = tailEnergy(0.7);
    expect(e5).toBeGreaterThan(e3);
    expect(e7).toBeGreaterThan(e5);
  });

  it('honors predelay', () => {
    const fx = plateDef.create(SR, { predelay: 0.05, mix: 1 });
    const { l, r } = impulseResponse(fx, Math.round(0.3 * SR));
    const preSamples = Math.round(0.05 * SR);
    expect(maxAbs(l, 0, preSamples - 10)).toBe(0);
    expect(maxAbs(r, 0, preSamples - 10)).toBe(0);
    expect(rms(l, preSamples, l.length)).toBeGreaterThan(1e-5);
  });

  it('is a bit-exact bypass at mix 0', () => {
    const fx = plateDef.create(SR, { mix: 0 });
    const rnd = rng('fx-time/plate/dry');
    const n = 4096;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = rnd() * 2 - 1;
      r[i] = rnd() * 2 - 1;
    }
    const cl = l.slice();
    const cr = r.slice();
    processBlocks(fx, l, r);
    expect(l).toEqual(cl);
    expect(r).toEqual(cr);
  });

  it('stays bounded at maximum decay with modulation', () => {
    const fx = plateDef.create(SR, { decay: 0.98, modDepth: 2, mix: 1 });
    const n = 2 * SR;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < SR >> 1; i++) {
      const v = Math.sin((2 * Math.PI * 330 * i) / SR);
      l[i] = v;
      r[i] = v;
    }
    processBlocks(fx, l, r);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(maxAbs(l, 0, n)).toBeLessThan(20);
  });
});
