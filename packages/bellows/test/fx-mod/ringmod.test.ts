import { describe, expect, it } from 'vitest';
import { ringmodDef } from '../../src/fx/modfx';
import { maxAbsDiff, processBlocks, sineBuf, toneMag } from './helpers';

const SR = 48000;

describe('ringmod', () => {
  it('has a well formed EffectDef', () => {
    expect(ringmodDef.id).toBe('ringmod');
    const names = ringmodDef.params.map((p) => p.name);
    for (const n of ['freq', 'mix']) expect(names).toContain(n);
    for (const p of ringmodDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('passes dry through exactly at mix 0', () => {
    const fx = ringmodDef.create(SR, { mix: 0, freq: 1000 });
    const l = sineBuf(4096, 200, SR);
    const r = sineBuf(4096, 350, SR);
    const refL = l.slice();
    const refR = r.slice();
    processBlocks(fx, l, r);
    expect(maxAbsDiff(l, refL)).toBe(0);
    expect(maxAbsDiff(r, refR)).toBe(0);
  });

  it('replaces a 200 Hz tone with 800 and 1200 Hz sidebands at carrier 1000', () => {
    const fx = ringmodDef.create(SR, { mix: 1, freq: 1000 });
    const l = sineBuf(SR, 200, SR);
    const r = l.slice();
    processBlocks(fx, l, r);

    const lower = toneMag(l, 4096, 16384, 800, SR);
    const upper = toneMag(l, 4096, 16384, 1200, SR);
    const input = toneMag(l, 4096, 16384, 200, SR);
    const carrier = toneMag(l, 4096, 16384, 1000, SR);

    // each sideband carries half the input amplitude
    expect(lower).toBeGreaterThan(0.4);
    expect(upper).toBeGreaterThan(0.4);
    // input and carrier suppressed at least 30 dB below a sideband
    expect(input).toBeLessThan(lower / 31.6);
    expect(carrier).toBeLessThan(lower / 31.6);
  });

  it('mix blends dry and wet', () => {
    const fx = ringmodDef.create(SR, { mix: 0.5, freq: 1000 });
    const l = sineBuf(SR, 200, SR);
    const r = l.slice();
    processBlocks(fx, l, r);
    const dryPart = toneMag(l, 4096, 16384, 200, SR);
    const sideband = toneMag(l, 4096, 16384, 1200, SR);
    expect(dryPart).toBeGreaterThan(0.4);
    expect(sideband).toBeGreaterThan(0.2);
  });

  it('applies the same carrier to both channels', () => {
    const fx = ringmodDef.create(SR, { mix: 1, freq: 700 });
    const l = sineBuf(8192, 200, SR);
    const r = l.slice();
    processBlocks(fx, l, r);
    expect(maxAbsDiff(l, r)).toBe(0);
  });
});
