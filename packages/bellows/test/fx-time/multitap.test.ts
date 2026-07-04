import { describe, expect, it } from 'vitest';
import { multitapDef } from '../../src/fx/delay';
import { argmaxAbs, impulseResponse, maxStep, processBlocks, rms } from './util';
import { rng } from '../../src/core/prng';

// 48000 makes the default tap times land on integer sample positions.
const SR = 48000;

describe('multitap def', () => {
  it('exposes per-tap time and level params', () => {
    expect(multitapDef.id).toBe('multitap');
    const names = multitapDef.params.map((p) => p.name);
    for (const n of [
      'time1',
      'time2',
      'time3',
      'time4',
      'level1',
      'level2',
      'level3',
      'level4',
      'diffusion',
      'mix',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('multitap delay', () => {
  const times = [0.125, 0.25, 0.375, 0.5];
  const levels = [1, 0.8, 0.6, 0.45];

  it('produces four taps at the configured times and levels', () => {
    const fx = multitapDef.create(SR, { diffusion: 0, mix: 1 });
    const n = Math.round(0.6 * SR);
    const { l, r } = impulseResponse(fx, n);
    // With diffusion 0 the allpasses reduce to short pure delays, adding
    // the same fixed offset to every tap.
    const offsets: number[] = [];
    for (let k = 0; k < 4; k++) {
      const base = Math.round(times[k] * SR);
      const peak = argmaxAbs(l, base, base + 800);
      offsets.push(peak - base);
      expect(Math.abs(l[peak])).toBeCloseTo(levels[k], 3);
      const peakR = argmaxAbs(r, base, base + 800);
      expect(Math.abs(r[peakR])).toBeCloseTo(levels[k], 3);
    }
    expect(offsets[1]).toBe(offsets[0]);
    expect(offsets[2]).toBe(offsets[0]);
    expect(offsets[3]).toBe(offsets[0]);
  });

  it('respects per-tap overrides', () => {
    const fx = multitapDef.create(SR, {
      diffusion: 0,
      mix: 1,
      time2: 0.2,
      level2: 0.25,
      level1: 0,
      level3: 0,
      level4: 0,
    });
    const { l } = impulseResponse(fx, Math.round(0.4 * SR));
    const base = Math.round(0.2 * SR);
    const peak = argmaxAbs(l, 1, l.length);
    expect(peak).toBeGreaterThanOrEqual(base);
    expect(peak).toBeLessThan(base + 800);
    expect(Math.abs(l[peak])).toBeCloseTo(0.25, 3);
  });

  it('diffusion smears each tap into a cluster', () => {
    const count = (diffusion: number): number => {
      const fx = multitapDef.create(SR, { diffusion, mix: 1 });
      const { l } = impulseResponse(fx, Math.round(0.2 * SR));
      const base = Math.round(0.125 * SR);
      let c = 0;
      for (let i = base; i < base + 1500; i++) if (Math.abs(l[i]) > 1e-3) c++;
      return c;
    };
    const sparse = count(0);
    const smeared = count(0.8);
    expect(smeared).toBeGreaterThan(sparse + 10);
  });

  it('is a bit-exact bypass at mix 0', () => {
    const fx = multitapDef.create(SR, { mix: 0 });
    const rnd = rng('fx-time/multitap/dry');
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

  it('sweeping a tap time produces no clicks', () => {
    const fx = multitapDef.create(SR, { diffusion: 0, mix: 1 });
    const n = 90000;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
    fx.process(l, r, 0, 40000);
    fx.setParam('time1', 0.3);
    let i = 40000;
    while (i < n) {
      const to = Math.min(i + 128, n);
      fx.process(l, r, i, to);
      i = to;
    }
    expect(maxStep(l, 40001, n)).toBeLessThan(0.35);
    expect(rms(l, 60000, n)).toBeGreaterThan(0.1);
  });
});
