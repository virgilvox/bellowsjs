import { describe, expect, it } from 'vitest';
import { fmEngine } from '../../src/engines/fm';
import { rng } from '../../src/core/prng';
import { SR, hasBadSamples, maxDiff, peak, render, tonePower } from './helpers';

const HOLD = { sustain: 1, mSustain: 1 };

describe('fm engine', () => {
  it('renders clean audio with sane peak', () => {
    const { l, r } = render(fmEngine, { freq: 220 });
    expect(hasBadSamples(l)).toBe(false);
    expect(hasBadSamples(r)).toBe(false);
    expect(peak(l)).toBeGreaterThan(0.03);
    expect(peak(l)).toBeLessThan(1.5);
  });

  it('is deterministic per seed', () => {
    const params = { feedback: 0.4, algorithm: 3 };
    const a = render(fmEngine, { params, seed: 'fm/seed' });
    const b = render(fmEngine, { params, seed: 'fm/seed' });
    expect(maxDiff(a.l, b.l)).toBe(0);
  });

  it('a silent modulator leaves a pure sine, modulation adds harmonics', () => {
    const base = { ops: 2, algorithm: 1, ratio1: 1, ratio2: 1, ...HOLD };
    const pure = render(fmEngine, { params: { ...base, level2: 0 }, freq: 220, offAt: 1 });
    const mod = render(fmEngine, { params: { ...base, level2: 0.8 }, freq: 220, offAt: 1 });
    const pureH2 = tonePower(pure.l, 440) / tonePower(pure.l, 220);
    const modH2 = tonePower(mod.l, 440) / tonePower(mod.l, 220);
    expect(pureH2).toBeLessThan(1e-4);
    expect(modH2).toBeGreaterThan(pureH2 * 100);
  });

  it('parallel algorithm 8 places carriers at their ratios', () => {
    const params = {
      ops: 4,
      algorithm: 8,
      ratio1: 1,
      ratio2: 2,
      ratio3: 3,
      ratio4: 5,
      level1: 1,
      level2: 1,
      level3: 1,
      level4: 1,
      feedback: 0,
      ...HOLD,
    };
    const { l } = render(fmEngine, { params, freq: 200, offAt: 1 });
    for (const mult of [1, 2, 3, 5]) {
      const on = tonePower(l, 200 * mult);
      const off = tonePower(l, 200 * mult + 71);
      expect(on).toBeGreaterThan(off * 100);
    }
  });

  it('all eight four op algorithms and all four six op algorithms render', () => {
    for (const ops of [4, 6]) {
      const count = ops === 4 ? 8 : 4;
      for (let algorithm = 1; algorithm <= count; algorithm++) {
        const { l } = render(fmEngine, {
          params: { ops, algorithm, feedback: 0.3 },
          seconds: 0.25,
        });
        expect(hasBadSamples(l)).toBe(false);
        expect(peak(l)).toBeGreaterThan(0.01);
        expect(peak(l)).toBeLessThan(1.5);
      }
    }
  });

  it('feedback broadens the spectrum of a lone carrier', () => {
    // parallel 2 op patch with only op 2 audible; feedback sits on op 2
    const base = { ops: 2, algorithm: 2, level1: 0, level2: 1, ratio2: 1, ...HOLD };
    const clean = render(fmEngine, { params: { ...base, feedback: 0 }, freq: 220, offAt: 1 });
    const fed = render(fmEngine, { params: { ...base, feedback: 0.9 }, freq: 220, offAt: 1 });
    const cleanH3 = tonePower(clean.l, 660) / tonePower(clean.l, 220);
    const fedH3 = tonePower(fed.l, 660) / tonePower(fed.l, 220);
    expect(fedH3).toBeGreaterThan(cleanH3 * 10);
  });

  it('fixed frequency operators ignore the note', () => {
    const params = { ops: 2, algorithm: 2, level1: 1, level2: 1, fixed2: 500, ...HOLD };
    const { l } = render(fmEngine, { params, freq: 220, offAt: 1 });
    expect(tonePower(l, 500)).toBeGreaterThan(tonePower(l, 555) * 100);
  });

  it('brightness makes soft notes duller', () => {
    const params = { ops: 2, algorithm: 1, level2: 0.9, brightness: 2, ...HOLD };
    const loud = render(fmEngine, { params, vel: 1, freq: 220, offAt: 1 });
    const soft = render(fmEngine, { params, vel: 0.3, freq: 220, offAt: 1 });
    const loudH2 = tonePower(loud.l, 440) / tonePower(loud.l, 220);
    const softH2 = tonePower(soft.l, 440) / tonePower(soft.l, 220);
    expect(softH2).toBeLessThan(loudH2 * 0.5);
  });

  it('goes inactive after release and can be reused', () => {
    const { voice } = render(fmEngine, {
      seconds: 1.5,
      offAt: 0.2,
      params: { release: 0.05, mRelease: 0.05 },
    });
    expect(voice.active).toBe(false);
    voice.noteOn(330, 1);
    expect(voice.active).toBe(true);
    const l = new Float32Array(4410);
    const r = new Float32Array(4410);
    voice.process(l, r, 0, 4410);
    expect(peak(l)).toBeGreaterThan(0.02);
  });

  it('two voices sum into the same bus', () => {
    const a = render(fmEngine, { freq: 220, seed: 'p1' });
    const b = render(fmEngine, { freq: 277, seed: 'p2' });
    const n = a.l.length;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    const v1 = fmEngine.createVoice(SR, {}, rng('p1'));
    const v2 = fmEngine.createVoice(SR, {}, rng('p2'));
    v1.noteOn(220, 1);
    v2.noteOn(277, 1);
    const offAt = Math.round(0.3 * SR);
    v1.process(l, r, 0, offAt);
    v2.process(l, r, 0, offAt);
    v1.noteOff();
    v2.noteOff();
    v1.process(l, r, offAt, n);
    v2.process(l, r, offAt, n);
    for (let i = 0; i < n; i += 997) {
      expect(l[i]).toBeCloseTo(a.l[i] + b.l[i], 5);
    }
  });
});
