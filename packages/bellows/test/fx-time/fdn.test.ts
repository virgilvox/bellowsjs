import { describe, expect, it } from 'vitest';
import { fdnDef, householderReflect } from '../../src/fx/reverb';
import { allFinite, db, impulseResponse, maxAbs, processBlocks, rms } from './util';
import { rng } from '../../src/core/prng';

const SR = 44100;

describe('householderReflect', () => {
  it('preserves energy for random vectors', () => {
    const rnd = rng('fx-time/fdn/householder');
    for (let trial = 0; trial < 20; trial++) {
      const v = new Float32Array(8);
      for (let i = 0; i < 8; i++) v[i] = rnd() * 2 - 1;
      let before = 0;
      for (let i = 0; i < 8; i++) before += v[i] * v[i];
      householderReflect(v);
      let after = 0;
      for (let i = 0; i < 8; i++) after += v[i] * v[i];
      expect(Math.abs(after - before) / before).toBeLessThan(1e-5);
    }
  });

  it('is an involution and negates the all-ones vector', () => {
    const rnd = rng('fx-time/fdn/involution');
    const v = new Float32Array(8);
    for (let i = 0; i < 8; i++) v[i] = rnd() * 2 - 1;
    const orig = v.slice();
    householderReflect(v);
    householderReflect(v);
    for (let i = 0; i < 8; i++) expect(v[i]).toBeCloseTo(orig[i], 5);
    const ones = new Float32Array(8).fill(1);
    householderReflect(ones);
    for (let i = 0; i < 8; i++) expect(ones[i]).toBeCloseTo(-1, 6);
  });
});

describe('fdn reverb', () => {
  it('exposes id and params', () => {
    expect(fdnDef.id).toBe('fdn');
    const names = fdnDef.params.map((p) => p.name);
    for (const n of ['size', 'decay', 'damp', 'chorus', 'predelay', 'mix']) {
      expect(names).toContain(n);
    }
  });

  it('decays about 30 dB over one second when RT60 is 2 s', () => {
    const fx = fdnDef.create(SR, {
      decay: 2,
      damp: 20000,
      chorus: 0,
      predelay: 0,
      mix: 1,
    });
    const n = Math.round(1.3 * SR);
    const { l, r } = impulseResponse(fx, n);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    const early =
      rms(l, Math.round(0.15 * SR), Math.round(0.25 * SR)) +
      rms(r, Math.round(0.15 * SR), Math.round(0.25 * SR));
    const late =
      rms(l, Math.round(1.15 * SR), Math.round(1.25 * SR)) +
      rms(r, Math.round(1.15 * SR), Math.round(1.25 * SR));
    const drop = db(late) - db(early);
    expect(drop).toBeLessThan(-18);
    expect(drop).toBeGreaterThan(-44);
  });

  it('produces a tail and no NaN with modulation on', () => {
    const fx = fdnDef.create(SR, { decay: 3, chorus: 1, mix: 1, predelay: 0 });
    const n = SR;
    const { l, r } = impulseResponse(fx, n);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(rms(l, Math.round(0.5 * SR), Math.round(0.6 * SR))).toBeGreaterThan(1e-5);
    expect(rms(r, Math.round(0.5 * SR), Math.round(0.6 * SR))).toBeGreaterThan(1e-5);
  });

  it('is stable under sustained DC input', () => {
    const fx = fdnDef.create(SR, { decay: 5, chorus: 0.3, mix: 1 });
    const n = SR;
    const l = new Float32Array(n).fill(0.5);
    const r = new Float32Array(n).fill(0.5);
    processBlocks(fx, l, r);
    expect(allFinite(l)).toBe(true);
    expect(maxAbs(l, 0, n)).toBeLessThan(5);
    expect(maxAbs(r, 0, n)).toBeLessThan(5);
  });

  it('honors predelay: silent until the predelay elapses', () => {
    const fx = fdnDef.create(SR, { predelay: 0.1, mix: 1, chorus: 0 });
    const { l, r } = impulseResponse(fx, Math.round(0.3 * SR));
    const preSamples = Math.round(0.1 * SR);
    expect(maxAbs(l, 0, preSamples - 10)).toBe(0);
    expect(maxAbs(r, 0, preSamples - 10)).toBe(0);
    expect(rms(l, preSamples, l.length)).toBeGreaterThan(1e-4);
  });

  it('is deterministic across instances', () => {
    const render = (): Float32Array => {
      const fx = fdnDef.create(SR, { chorus: 0.8, decay: 2, mix: 1 });
      const { l } = impulseResponse(fx, 16384);
      return l;
    };
    expect(render()).toEqual(render());
  });

  it('survives a size change mid-stream', () => {
    const fx = fdnDef.create(SR, { decay: 2, mix: 1 });
    const n = SR;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    l[0] = 1;
    r[0] = 1;
    fx.process(l, r, 0, n >> 1);
    fx.setParam('size', 2.5);
    fx.process(l, r, n >> 1, n);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
  });
});
