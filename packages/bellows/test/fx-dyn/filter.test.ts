import { describe, expect, it } from 'vitest';
import { filterDef } from '../../src/fx/filter';
import { processBlocks, rms, sineBuf } from './helpers';

const SR = 48000;
const N = SR / 2;

/** RMS of a filtered sine over its second half (past the transient and any glide). */
function through(params: Record<string, number>, freq: number, amp = 0.25): number {
  const fx = filterDef.create(SR, params);
  const l = sineBuf(N, freq, SR, amp);
  const r = sineBuf(N, freq, SR, amp);
  processBlocks(fx, l, r);
  return rms(l, N / 2) / (amp / Math.SQRT2);
}

describe('filter', () => {
  it('has a well formed EffectDef', () => {
    expect(filterDef.id).toBe('filter');
    for (const p of filterDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('lowpass passes below cutoff and cuts above; 24 dB cuts harder than 12', () => {
    expect(through({ type: 0, cutoff: 1000 }, 100)).toBeGreaterThan(0.95);
    const twelve = through({ type: 0, cutoff: 1000 }, 8000);
    const twentyFour = through({ type: 0, cutoff: 1000, slope: 1 }, 8000);
    expect(twelve).toBeLessThan(0.05);
    expect(twentyFour).toBeLessThan(twelve / 10);
  });

  it('highpass and bandpass select their bands', () => {
    expect(through({ type: 1, cutoff: 2000 }, 100)).toBeLessThan(0.01);
    expect(through({ type: 1, cutoff: 2000 }, 12000)).toBeGreaterThan(0.95);
    expect(through({ type: 2, cutoff: 1000, resonance: 0.5 }, 1000)).toBeGreaterThan(0.9);
    expect(through({ type: 2, cutoff: 1000, resonance: 0.5 }, 8000)).toBeLessThan(0.1);
  });

  it('notch removes its frequency; bell boosts by its gain', () => {
    expect(through({ type: 3, cutoff: 1000, resonance: 0.3 }, 1000)).toBeLessThan(0.02);
    const bell = through({ type: 6, cutoff: 1000, gain: 12, resonance: 0.3 }, 1000);
    expect(20 * Math.log10(bell)).toBeCloseTo(12, 0);
  });

  it('ladder lowpasses, and resonance lifts the response at cutoff', () => {
    expect(through({ type: 9, cutoff: 500 }, 8000, 0.05)).toBeLessThan(0.01);
    const flat = through({ type: 9, cutoff: 1000, resonance: 0 }, 1000, 0.05);
    const peaked = through({ type: 9, cutoff: 1000, resonance: 0.9 }, 1000, 0.05);
    expect(peaked).toBeGreaterThan(flat * 2);
  });

  it('mix 0 is the dry signal exactly', () => {
    const fx = filterDef.create(SR, { type: 0, cutoff: 200, mix: 0 });
    const src = sineBuf(1024, 5000, SR, 0.5);
    const l = src.slice();
    const r = src.slice();
    processBlocks(fx, l, r);
    expect(Array.from(l)).toEqual(Array.from(src));
  });

  it('a cutoff change glides instead of jumping, and lands on the target', () => {
    const fx = filterDef.create(SR, { type: 0, cutoff: 200 });
    // settle at 200 Hz, then open to 10 kHz and watch an 8 kHz tone come up gradually
    const warm = sineBuf(4800, 8000, SR, 0.25);
    processBlocks(fx, warm, warm.slice());
    fx.setParam('cutoff', 10000);
    const l = sineBuf(4800, 8000, SR, 0.25);
    const r = l.slice();
    processBlocks(fx, l, r);
    const first = rms(l, 0, 64);
    const later = rms(l, 2400);
    expect(first).toBeLessThan(later * 0.5);
    expect(later / (0.25 / Math.SQRT2)).toBeGreaterThan(0.7);
  });

  it('ignores non-finite params and keeps playing', () => {
    const fx = filterDef.create(SR, { type: 0, cutoff: 1000 });
    fx.setParam('cutoff', NaN);
    fx.setParam('resonance', Infinity);
    const l = sineBuf(2048, 100, SR, 0.25);
    const r = l.slice();
    processBlocks(fx, l, r);
    expect(l.every((v) => Number.isFinite(v))).toBe(true);
    expect(rms(l, 1024)).toBeGreaterThan(0.1);
  });
});
