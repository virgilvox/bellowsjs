import { describe, expect, it } from 'vitest';
import { noiseEngine } from '../../src/engines/noisesynth';
import { SR, bandPower, hasBadSamples, maxDiff, peak, render, renderPair, rms } from './helpers';

describe('noise engine', () => {
  it('renders clean audio with sane peak', () => {
    const { l, r } = render(noiseEngine, { params: { cutoff: 20000 } });
    expect(hasBadSamples(l)).toBe(false);
    expect(hasBadSamples(r)).toBe(false);
    expect(peak(l)).toBeGreaterThan(0.03);
    expect(peak(l)).toBeLessThan(1.5);
  });

  it('is deterministic per seed', () => {
    const a = render(noiseEngine, { seed: 'nz/seed' });
    const b = render(noiseEngine, { seed: 'nz/seed' });
    expect(maxDiff(a.l, b.l)).toBe(0);
  });

  it('is invariant to block splits', () => {
    const a = render(noiseEngine, { block: 128 });
    const b = render(noiseEngine, { block: 41 });
    expect(maxDiff(a.l, b.l)).toBe(0);
  });

  it('brown noise tilts the spectrum down against white', () => {
    const base = { cutoff: 20000, sustain: 1, envAmount: 0 };
    const white = render(noiseEngine, { params: { ...base, color: 0 }, offAt: 1 });
    const brown = render(noiseEngine, { params: { ...base, color: 2 }, offAt: 1 });
    const whiteTilt = bandPower(white.l, 4000, 10000) / bandPower(white.l, 50, 200);
    const brownTilt = bandPower(brown.l, 4000, 10000) / bandPower(brown.l, 50, 200);
    expect(brownTilt).toBeLessThan(whiteTilt * 0.01);
  });

  it('lowpass cutoff shapes the noise', () => {
    const base = { sustain: 1, envAmount: 0, color: 0 };
    const open = render(noiseEngine, { params: { ...base, cutoff: 18000 }, offAt: 1 });
    const closed = render(noiseEngine, { params: { ...base, cutoff: 250 }, offAt: 1 });
    expect(bandPower(closed.l, 3000, 10000)).toBeLessThan(bandPower(open.l, 3000, 10000) * 0.05);
  });

  it('highpass mode keeps highs instead', () => {
    const params = { filterMode: 2, cutoff: 4000, sustain: 1, envAmount: 0, color: 0 };
    const { l } = render(noiseEngine, { params, offAt: 1 });
    expect(bandPower(l, 6000, 12000)).toBeGreaterThan(bandPower(l, 100, 800) * 20);
  });

  it('filter envelope sweeps the cutoff', () => {
    const params = {
      color: 0,
      cutoff: 200,
      envAmount: 6,
      fAttack: 0.001,
      fDecay: 0.05,
      fSustain: 0,
      sustain: 1,
    };
    const { l } = render(noiseEngine, { params, seconds: 0.5, offAt: 1 });
    const early = bandPower(l, 2000, 8000, 0, Math.round(0.03 * SR));
    const late = bandPower(l, 2000, 8000, Math.round(0.3 * SR), Math.round(0.34 * SR));
    expect(early).toBeGreaterThan(late * 10);
  });

  it('key tracking scales the cutoff with the note', () => {
    const params = { color: 0, cutoff: 500, keyTrack: 1, sustain: 1, envAmount: 0 };
    const lowNote = render(noiseEngine, { params, freq: 110, offAt: 1 });
    const highNote = render(noiseEngine, { params, freq: 1760, offAt: 1 });
    const hiLow = bandPower(lowNote.l, 3000, 8000);
    const hiHigh = bandPower(highNote.l, 3000, 8000);
    expect(hiHigh).toBeGreaterThan(hiLow * 10);
  });

  it('amp envelope gates the noise and the voice can be reused', () => {
    const { voice, l } = render(noiseEngine, {
      seconds: 1,
      offAt: 0.2,
      params: { release: 0.03, sustain: 1 },
    });
    expect(voice.active).toBe(false);
    expect(rms(l, Math.round(0.6 * SR), l.length)).toBeLessThan(1e-3);
    voice.noteOn(220, 1);
    expect(voice.active).toBe(true);
    const bl = new Float32Array(4410);
    const br = new Float32Array(4410);
    voice.process(bl, br, 0, 4410);
    expect(peak(bl)).toBeGreaterThan(0.02);
  });

  it('two voices sum into the same bus', () => {
    const a = render(noiseEngine, { freq: 220, seed: 'n1' });
    const b = render(noiseEngine, { freq: 330, seed: 'n2' });
    const both = renderPair(noiseEngine, 220, 330, 'n1', 'n2');
    for (let i = 0; i < both.l.length; i += 997) {
      expect(both.l[i]).toBeCloseTo(a.l[i] + b.l[i], 5);
    }
  });
});
