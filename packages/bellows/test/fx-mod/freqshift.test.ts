import { describe, expect, it } from 'vitest';
import { freqshiftDef } from '../../src/fx/freqshift';
import { maxAbsDiff, processBlocks, sineBuf, toneMag } from './helpers';

const SR = 48000;
const ANALYZE_FROM = 8192;
const ANALYZE_N = 16384;

function shiftTone(inputHz: number, shiftHz: number, mix = 1): Float32Array {
  const fx = freqshiftDef.create(SR, { shift: shiftHz, mix });
  const l = sineBuf(SR, inputHz, SR);
  const r = l.slice();
  processBlocks(fx, l, r);
  return l;
}

describe('freqshift', () => {
  it('has a well formed EffectDef', () => {
    expect(freqshiftDef.id).toBe('freqshift');
    const names = freqshiftDef.params.map((p) => p.name);
    for (const n of ['shift', 'mix']) expect(names).toContain(n);
    const shift = freqshiftDef.params.find((p) => p.name === 'shift');
    expect(shift?.min).toBeLessThan(0);
    for (const p of freqshiftDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('passes dry through exactly at mix 0', () => {
    const fx = freqshiftDef.create(SR, { mix: 0, shift: 100 });
    const l = sineBuf(4096, 1000, SR);
    const r = sineBuf(4096, 500, SR);
    const refL = l.slice();
    const refR = r.slice();
    processBlocks(fx, l, r);
    expect(maxAbsDiff(l, refL)).toBe(0);
    expect(maxAbsDiff(r, refR)).toBe(0);
  });

  it('shifts 1000 Hz up by 100 Hz with the image at least 30 dB down', () => {
    const y = shiftTone(1000, 100);
    const wanted = toneMag(y, ANALYZE_FROM, ANALYZE_N, 1100, SR);
    const image = toneMag(y, ANALYZE_FROM, ANALYZE_N, 900, SR);
    const leak = toneMag(y, ANALYZE_FROM, ANALYZE_N, 1000, SR);
    expect(wanted).toBeGreaterThan(0.7);
    expect(image).toBeLessThan(wanted / 31.6);
    expect(leak).toBeLessThan(wanted / 31.6);
  });

  it('shifts 1000 Hz down by 100 Hz with the image at least 30 dB down', () => {
    const y = shiftTone(1000, -100);
    const wanted = toneMag(y, ANALYZE_FROM, ANALYZE_N, 900, SR);
    const image = toneMag(y, ANALYZE_FROM, ANALYZE_N, 1100, SR);
    expect(wanted).toBeGreaterThan(0.7);
    expect(image).toBeLessThan(wanted / 31.6);
  });

  it('shift is not a pitch scale: both partials move by the same Hz', () => {
    const fx = freqshiftDef.create(SR, { shift: 150, mix: 1 });
    const l = new Float32Array(SR);
    for (let i = 0; i < l.length; i++) {
      l[i] =
        0.5 * Math.sin((2 * Math.PI * 500 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 2000 * i) / SR);
    }
    const r = l.slice();
    processBlocks(fx, l, r);
    expect(toneMag(l, ANALYZE_FROM, ANALYZE_N, 650, SR)).toBeGreaterThan(0.35);
    expect(toneMag(l, ANALYZE_FROM, ANALYZE_N, 2150, SR)).toBeGreaterThan(0.35);
    // a pitch shifter would land at 575 and 2300 instead
    expect(toneMag(l, ANALYZE_FROM, ANALYZE_N, 575, SR)).toBeLessThan(0.05);
    expect(toneMag(l, ANALYZE_FROM, ANALYZE_N, 2300, SR)).toBeLessThan(0.05);
  });

  it('shift 0 preserves the tone magnitude', () => {
    const y = shiftTone(1000, 0);
    expect(toneMag(y, ANALYZE_FROM, ANALYZE_N, 1000, SR)).toBeGreaterThan(0.9);
  });

  it('mix 0.5 keeps both the dry tone and the shifted tone', () => {
    const y = shiftTone(1000, 100, 0.5);
    expect(toneMag(y, ANALYZE_FROM, ANALYZE_N, 1000, SR)).toBeGreaterThan(0.3);
    expect(toneMag(y, ANALYZE_FROM, ANALYZE_N, 1100, SR)).toBeGreaterThan(0.3);
  });

  it('is deterministic across instances and block splits', () => {
    const x = sineBuf(16384, 700, SR);
    const a = freqshiftDef.create(SR, { shift: 250, mix: 0.7 });
    const la = x.slice();
    const ra = x.slice();
    processBlocks(a, la, ra, 128);

    const b = freqshiftDef.create(SR, { shift: 250, mix: 0.7 });
    const lb = x.slice();
    const rb = x.slice();
    processBlocks(b, lb, rb, 61);

    expect(maxAbsDiff(la, lb)).toBe(0);
    expect(maxAbsDiff(ra, rb)).toBe(0);
  });

  it('reset restores the initial state', () => {
    const x = sineBuf(8192, 1000, SR);
    const fx = freqshiftDef.create(SR, { shift: 100, mix: 1 });
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
