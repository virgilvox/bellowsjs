import { describe, expect, it } from 'vitest';
import { vaEngine } from '../../src/engines/va';
import { SR, bandPower, hasBadSamples, maxDiff, peak, render, renderPair, tonePower } from './helpers';

describe('va engine', () => {
  it('renders clean audio with sane peak', () => {
    const { l, r } = render(vaEngine, { freq: 220 });
    expect(hasBadSamples(l)).toBe(false);
    expect(hasBadSamples(r)).toBe(false);
    expect(peak(l)).toBeGreaterThan(0.03);
    expect(peak(l)).toBeLessThan(1.5);
  });

  it('is deterministic per seed', () => {
    const params = { drift: 0.5, detune: 12 };
    const a = render(vaEngine, { params, seed: 'va/seed' });
    const b = render(vaEngine, { params, seed: 'va/seed' });
    expect(maxDiff(a.l, b.l)).toBe(0);
    expect(maxDiff(a.r, b.r)).toBe(0);
  });

  it('is invariant to block splits', () => {
    const a = render(vaEngine, { params: { drift: 0.3 }, block: 128 });
    const b = render(vaEngine, { params: { drift: 0.3 }, block: 37 });
    expect(maxDiff(a.l, b.l)).toBe(0);
  });

  it('lowpass cutoff removes highs', () => {
    const params = { resonance: 0, envAmount: 0, sustain: 1 };
    const open = render(vaEngine, { params: { ...params, cutoff: 15000 }, freq: 110 });
    const closed = render(vaEngine, { params: { ...params, cutoff: 300 }, freq: 110 });
    const hiOpen = bandPower(open.l, 2000, 8000);
    const hiClosed = bandPower(closed.l, 2000, 8000);
    expect(hiClosed).toBeLessThan(hiOpen * 0.05);
  });

  it('svf filter type also removes highs', () => {
    const params = { filterType: 1, resonance: 0, sustain: 1 };
    const open = render(vaEngine, { params: { ...params, cutoff: 15000 }, freq: 110 });
    const closed = render(vaEngine, { params: { ...params, cutoff: 300 }, freq: 110 });
    expect(bandPower(closed.l, 2000, 8000)).toBeLessThan(bandPower(open.l, 2000, 8000) * 0.05);
  });

  it('square shape suppresses even harmonics relative to saw', () => {
    const base = { cutoff: 20000, detune: 0, resonance: 0, sustain: 1 };
    const saw = render(vaEngine, { params: { ...base, shape: 0 }, freq: 220, offAt: 1 });
    const square = render(vaEngine, { params: { ...base, shape: 1 }, freq: 220, offAt: 1 });
    // compare 2nd harmonic against the fundamental for each shape
    const sawRatio = bandPower(saw.l, 438, 442, 0, saw.l.length, 3) /
      bandPower(saw.l, 218, 222, 0, saw.l.length, 3);
    const sqRatio = bandPower(square.l, 438, 442, 0, square.l.length, 3) /
      bandPower(square.l, 218, 222, 0, square.l.length, 3);
    expect(sqRatio).toBeLessThan(sawRatio * 0.1);
  });

  it('filter envelope opens the filter while it is high', () => {
    // svf type: the ladder's tanh stages add distortion products that land
    // on harmonics and would blur the comparison. Compare the same early
    // window with the envelope on and off, at an exact harmonic (110 * 20),
    // since short window leakage swamps late window measurements.
    const base = {
      filterType: 1,
      cutoff: 200,
      fAttack: 0.001,
      fDecay: 0.15,
      fSustain: 0,
      sustain: 1,
      resonance: 0,
      detune: 0,
    };
    const win = Math.round(0.04 * SR);
    const swept = render(vaEngine, {
      params: { ...base, envAmount: 6 },
      freq: 110,
      offAt: 1,
    });
    const still = render(vaEngine, {
      params: { ...base, envAmount: 0 },
      freq: 110,
      offAt: 1,
    });
    expect(tonePower(swept.l, 2200, 0, win)).toBeGreaterThan(
      tonePower(still.l, 2200, 0, win) * 10,
    );
  });

  it('drift changes output against the drift free render', () => {
    const still = render(vaEngine, { params: { drift: 0 }, seed: 'va/d' });
    const drifting = render(vaEngine, { params: { drift: 1 }, seed: 'va/d' });
    expect(maxDiff(still.l, drifting.l)).toBeGreaterThan(1e-4);
  });

  it('pan moves energy between channels', () => {
    const left = render(vaEngine, { params: { pan: -1 } });
    expect(peak(left.r)).toBeLessThan(peak(left.l) * 0.01);
    const right = render(vaEngine, { params: { pan: 1 } });
    expect(peak(right.l)).toBeLessThan(peak(right.r) * 0.01);
  });

  it('velocity scales level', () => {
    const loud = render(vaEngine, { vel: 1 });
    const soft = render(vaEngine, { vel: 0.2 });
    expect(peak(soft.l)).toBeLessThan(peak(loud.l));
  });

  it('goes inactive after release and can be reused', () => {
    const { voice } = render(vaEngine, { seconds: 1.5, offAt: 0.2, params: { release: 0.05 } });
    expect(voice.active).toBe(false);
    // reuse from the pool: noteOn must fully restart
    voice.noteOn(330, 1);
    expect(voice.active).toBe(true);
    const l = new Float32Array(4410);
    const r = new Float32Array(4410);
    voice.process(l, r, 0, 4410);
    expect(peak(l)).toBeGreaterThan(0.03);
  });

  it('two voices sum into the same bus', () => {
    const a = render(vaEngine, { freq: 220, seed: 's1' });
    const b = render(vaEngine, { freq: 330, seed: 's2' });
    const both = renderPair(vaEngine, 220, 330, 's1', 's2');
    for (let i = 0; i < both.l.length; i += 997) {
      expect(both.l[i]).toBeCloseTo(a.l[i] + b.l[i], 5);
    }
  });
});
