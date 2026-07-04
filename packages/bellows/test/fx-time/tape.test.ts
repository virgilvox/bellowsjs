import { describe, expect, it } from 'vitest';
import { tapeDelayDef } from '../../src/fx/delay';
import { allFinite, argmaxAbs, impulseResponse, maxAbs, processBlocks, rms } from './util';
import { rng } from '../../src/core/prng';

const SR = 44100;

describe('tapeDelay def', () => {
  it('exposes id and the expected params, hiss defaulting to off', () => {
    expect(tapeDelayDef.id).toBe('tapeDelay');
    const byName = new Map(tapeDelayDef.params.map((p) => [p.name, p]));
    for (const n of ['time', 'feedback', 'wow', 'flutter', 'saturation', 'tone', 'mix']) {
      expect(byName.has(n)).toBe(true);
    }
    expect(byName.get('hiss')?.default).toBe(0);
  });
});

describe('tape delay', () => {
  it('places the first echo at the configured time', () => {
    const fx = tapeDelayDef.create(SR, {
      time: 0.25,
      feedback: 0,
      wow: 0,
      flutter: 0,
      saturation: 0,
      mix: 1,
    });
    const { l } = impulseResponse(fx, Math.round(0.4 * SR));
    const peak = argmaxAbs(l, 1, l.length);
    expect(Math.abs(peak - 11025)).toBeLessThanOrEqual(2);
    expect(Math.abs(l[peak])).toBeGreaterThan(0.9);
  });

  it('is silent on silent input with hiss off (the default)', () => {
    const fx = tapeDelayDef.create(SR, { feedback: 0.8, mix: 1 });
    const n = Math.round(0.5 * SR);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    processBlocks(fx, l, r);
    expect(maxAbs(l, 0, n)).toBeLessThan(1e-7);
    expect(maxAbs(r, 0, n)).toBeLessThan(1e-7);
  });

  it('adds noise to the loop when hiss is turned up', () => {
    const fx = tapeDelayDef.create(SR, { hiss: 1, feedback: 0.6, mix: 1, time: 0.05 });
    const n = Math.round(0.5 * SR);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    processBlocks(fx, l, r);
    expect(rms(l, n >> 1, n)).toBeGreaterThan(1e-5);
  });

  it('wow modulates the pitch of the repeat', () => {
    const periodStd = (wow: number): number => {
      const fx = tapeDelayDef.create(SR, {
        time: 0.25,
        feedback: 0,
        wow,
        flutter: 0,
        saturation: 0,
        mix: 1,
      });
      const n = 2 * SR;
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      for (let i = 0; i < n; i++) l[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
      processBlocks(fx, l, r);
      // Upward zero crossing intervals of the wet output over the last second.
      const crossings: number[] = [];
      for (let i = SR; i < n; i++) {
        if (l[i - 1] < 0 && l[i] >= 0) crossings.push(i - 1 + l[i - 1] / (l[i - 1] - l[i]));
      }
      const periods = crossings.slice(1).map((c, k) => c - crossings[k]);
      const mean = periods.reduce((a, b) => a + b, 0) / periods.length;
      const varsum = periods.reduce((a, b) => a + (b - mean) * (b - mean), 0);
      return Math.sqrt(varsum / periods.length);
    };
    const still = periodStd(0);
    const wobbly = periodStd(1);
    expect(wobbly).toBeGreaterThan(0.1);
    expect(wobbly).toBeGreaterThan(3 * still);
  });

  it('saturation keeps a hot regenerating loop bounded', () => {
    const fx = tapeDelayDef.create(SR, {
      time: 0.1,
      feedback: 1.0,
      saturation: 1,
      mix: 1,
      tone: 8000,
    });
    const n = 2 * SR;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < SR; i++) {
      const v = 1.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
      l[i] = v;
      r[i] = v;
    }
    processBlocks(fx, l, r);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(maxAbs(l, 0, n)).toBeLessThan(3);
  });

  it('is deterministic: two instances render identically', () => {
    const params = { hiss: 0.7, wow: 0.6, flutter: 0.4, feedback: 0.7, mix: 0.5 };
    const rnd = rng('fx-time/tape/input');
    const n = 8192;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = rnd() * 2 - 1;
    const render = (): Float32Array => {
      const fx = tapeDelayDef.create(SR, params);
      const l = src.slice();
      const r = src.slice();
      processBlocks(fx, l, r);
      return l;
    };
    expect(render()).toEqual(render());
  });
});
