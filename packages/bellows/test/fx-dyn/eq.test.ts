import { describe, expect, it } from 'vitest';
import { eqDef } from '../../src/fx/eq';
import { rng } from '../../src/core/prng';
import { db, processBlocks, sineBuf, toneMag } from './helpers';

const SR = 48000;

/** Steady-state gain in dB of the effect at one probe frequency. */
function measureGainDb(params: Record<string, number>, freq: number): number {
  const fx = eqDef.create(SR, params);
  const n = 24576;
  const l = sineBuf(n, freq, SR, 0.5);
  const r = sineBuf(n, freq, SR, 0.5);
  processBlocks(fx, l, r);
  const mag = toneMag(l, 8192, 16384, freq, SR);
  return db(mag / 0.5);
}

describe('parametric eq', () => {
  it('has a well formed EffectDef with four params per band', () => {
    expect(eqDef.id).toBe('eq');
    expect(eqDef.params.length).toBe(24);
    for (let i = 0; i < 6; i++) {
      const names = eqDef.params.map((p) => p.name);
      for (const f of ['freq', 'gain', 'q', 'enabled']) {
        expect(names).toContain('b' + i + f);
      }
    }
    for (const p of eqDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('bell boost matches the requested gain at center within 1 dB', () => {
    const params = { b2freq: 1000, b2gain: 6, b2q: 1 };
    expect(measureGainDb(params, 1000)).toBeGreaterThan(5);
    expect(measureGainDb(params, 1000)).toBeLessThan(7);
    // Two octaves either side the bell has mostly let go.
    expect(Math.abs(measureGainDb(params, 100))).toBeLessThan(1);
    expect(Math.abs(measureGainDb(params, 10000))).toBeLessThan(1);
  });

  it('bell cut matches the requested gain at center within 1 dB', () => {
    const params = { b3freq: 2500, b3gain: -9, b3q: 1.5 };
    const center = measureGainDb(params, 2500);
    expect(center).toBeGreaterThan(-10);
    expect(center).toBeLessThan(-8);
  });

  it('low shelf reaches its gain below the corner and unity above', () => {
    const params = { b0freq: 200, b0gain: 6 };
    const low = measureGainDb(params, 40);
    expect(low).toBeGreaterThan(5);
    expect(low).toBeLessThan(7);
    expect(Math.abs(measureGainDb(params, 4000))).toBeLessThan(1);
  });

  it('high shelf reaches its gain above the corner and unity below', () => {
    const params = { b5freq: 5000, b5gain: -6 };
    const high = measureGainDb(params, 16000);
    expect(high).toBeGreaterThan(-7);
    expect(high).toBeLessThan(-5);
    expect(Math.abs(measureGainDb(params, 500))).toBeLessThan(1);
  });

  it('is bit-transparent with every gain at 0', () => {
    const fx = eqDef.create(SR, {});
    const noise = rng('fx-dyn/eq-noise');
    const n = 4096;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = noise() * 2 - 1;
      r[i] = noise() * 2 - 1;
    }
    const lRef = l.slice();
    const rRef = r.slice();
    processBlocks(fx, l, r);
    expect(l).toEqual(lRef);
    expect(r).toEqual(rRef);
  });

  it('a disabled band has no effect regardless of its gain', () => {
    const fx = eqDef.create(SR, { b2freq: 1000, b2gain: 12, b2enabled: 0 });
    const n = 8192;
    const l = sineBuf(n, 1000, SR, 0.5);
    const r = sineBuf(n, 1000, SR, 0.5);
    const ref = l.slice();
    processBlocks(fx, l, r);
    expect(l).toEqual(ref);
  });

  it('a band leaves frequencies far outside its own range alone', () => {
    const params = { b1freq: 250, b1gain: 12, b1q: 2 };
    expect(Math.abs(measureGainDb(params, 8000))).toBeLessThan(1);
  });

  it('bands combine in series', () => {
    const params = { b0freq: 200, b0gain: 6, b5freq: 5000, b5gain: 6 };
    expect(measureGainDb(params, 40)).toBeGreaterThan(5);
    expect(measureGainDb(params, 16000)).toBeGreaterThan(5);
    expect(Math.abs(measureGainDb(params, 1200))).toBeLessThan(1.5);
  });
});
