import { describe, expect, it } from 'vitest';
import { chorusDef } from '../../src/fx/modfx';
import { rng } from '../../src/core/prng';
import { maxAbs, maxAbsDiff, processBlocks, sineBuf } from './helpers';

const SR = 48000;

function noiseBuf(n: number, label: string): Float32Array {
  const r = rng(label);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 2 * r() - 1;
  return out;
}

describe('chorus', () => {
  it('has a well formed EffectDef', () => {
    expect(chorusDef.id).toBe('chorus');
    const names = chorusDef.params.map((p) => p.name);
    for (const n of ['rate', 'depth', 'mix', 'feedback']) expect(names).toContain(n);
    for (const p of chorusDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('passes dry through exactly at mix 0', () => {
    const fx = chorusDef.create(SR, { mix: 0, depth: 0.8, rate: 1 });
    const l = noiseBuf(4096, 'chorus/dry/l');
    const r = noiseBuf(4096, 'chorus/dry/r');
    const refL = l.slice();
    const refR = r.slice();
    processBlocks(fx, l, r);
    expect(maxAbsDiff(l, refL)).toBe(0);
    expect(maxAbsDiff(r, refR)).toBe(0);
  });

  it('at depth 0 the wet path is the average of the three fixed taps', () => {
    // Tap centers are 10, 17.5 and 25 ms: 480, 840 and 1200 samples at 48k.
    const fx = chorusDef.create(SR, { mix: 1, depth: 0, feedback: 0, rate: 0.5 });
    const x = noiseBuf(10000, 'chorus/taps');
    const l = x.slice();
    const r = x.slice();
    processBlocks(fx, l, r);
    for (let n = 1300; n < 10000; n += 7) {
      const expected = (x[n - 480] + x[n - 840] + x[n - 1200]) / 3;
      expect(Math.abs(l[n] - expected)).toBeLessThan(1e-6);
      expect(Math.abs(r[n] - expected)).toBeLessThan(1e-6);
    }
  });

  it('depth changes the output and decorrelates the channels', () => {
    const x = sineBuf(SR, 440, SR);
    const still = chorusDef.create(SR, { mix: 1, depth: 0, feedback: 0, rate: 1 });
    const l0 = x.slice();
    const r0 = x.slice();
    processBlocks(still, l0, r0);

    const moving = chorusDef.create(SR, { mix: 1, depth: 0.7, feedback: 0, rate: 1 });
    const l1 = x.slice();
    const r1 = x.slice();
    processBlocks(moving, l1, r1);

    expect(maxAbsDiff(l1, l0)).toBeGreaterThan(0.05);
    // 90 degree lfo offset between channels produces stereo width
    expect(maxAbsDiff(l1, r1)).toBeGreaterThan(0.05);
  });

  it('is deterministic across instances and block splits', () => {
    const x = noiseBuf(8192, 'chorus/det');
    const a = chorusDef.create(SR, { mix: 0.6, depth: 0.5, feedback: 0.3, rate: 2 });
    const la = x.slice();
    const ra = x.slice();
    processBlocks(a, la, ra, 128);

    const b = chorusDef.create(SR, { mix: 0.6, depth: 0.5, feedback: 0.3, rate: 2 });
    const lb = x.slice();
    const rb = x.slice();
    processBlocks(b, lb, rb, 61);

    expect(maxAbsDiff(la, lb)).toBe(0);
    expect(maxAbsDiff(ra, rb)).toBe(0);
  });

  it('stays bounded at maximum feedback', () => {
    const fx = chorusDef.create(SR, { mix: 1, depth: 0.8, feedback: 0.5, rate: 3 });
    const l = noiseBuf(SR * 2, 'chorus/fb/l');
    const r = noiseBuf(SR * 2, 'chorus/fb/r');
    processBlocks(fx, l, r);
    expect(maxAbs(l)).toBeLessThan(10);
    expect(maxAbs(r)).toBeLessThan(10);
  });

  it('reset returns the effect to its initial state', () => {
    const x = noiseBuf(4096, 'chorus/reset');
    const fx = chorusDef.create(SR, { mix: 1, depth: 0.5, feedback: 0.2, rate: 2 });
    const l1 = x.slice();
    const r1 = x.slice();
    processBlocks(fx, l1, r1);
    fx.reset();
    const l2 = x.slice();
    const r2 = x.slice();
    processBlocks(fx, l2, r2);
    expect(maxAbsDiff(l1, l2)).toBe(0);
    expect(maxAbsDiff(r1, r2)).toBe(0);
  });
});
