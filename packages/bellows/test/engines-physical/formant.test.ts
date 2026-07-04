import { describe, expect, it } from 'vitest';
import { formantEngine } from '../../src/engines/formant';
import {
  bandEnergy,
  countDiffs,
  countNonFinite,
  estimateFreq,
  magSpectrum,
  maxAbs,
  mono,
  renderVoice,
} from './helpers';

const SR = 44100;
const SIZE = 16384;

function sing(params: Record<string, number>, freq = 110, seconds = 0.8) {
  const { l, r } = renderVoice(formantEngine, { freq, seconds, gate: seconds, params });
  return mono(l, r);
}

describe('formant engine', () => {
  it('vowel a and vowel i produce their formant layouts', () => {
    const noVib = { vibratoDepth: 0, breath: 0 };
    const a = magSpectrum(sing({ ...noVib, vowel: 0 }), Math.round(0.2 * SR), SIZE);
    const i = magSpectrum(sing({ ...noVib, vowel: 2 }), Math.round(0.2 * SR), SIZE);
    // First formant: a at 600 Hz, i at 250 Hz.
    const aF1 = bandEnergy(a, SR, SIZE, 500, 700) / bandEnergy(a, SR, SIZE, 180, 320);
    const iF1 = bandEnergy(i, SR, SIZE, 500, 700) / bandEnergy(i, SR, SIZE, 180, 320);
    expect(aF1).toBeGreaterThan(iF1 * 4);
    // Second formant: a at 1040 Hz, i at 1750 Hz.
    const aF2 = bandEnergy(a, SR, SIZE, 900, 1200) / bandEnergy(a, SR, SIZE, 1600, 1900);
    const iF2 = bandEnergy(i, SR, SIZE, 900, 1200) / bandEnergy(i, SR, SIZE, 1600, 1900);
    expect(aF2).toBeGreaterThan(iF2 * 4);
  });

  it('vowel morphs continuously between tables', () => {
    const noVib = { vibratoDepth: 0, breath: 0 };
    const a = magSpectrum(sing({ ...noVib, vowel: 0 }), Math.round(0.2 * SR), SIZE);
    const half = magSpectrum(sing({ ...noVib, vowel: 0.5 }), Math.round(0.2 * SR), SIZE);
    const e = magSpectrum(sing({ ...noVib, vowel: 1 }), Math.round(0.2 * SR), SIZE);
    // F2 moves 1040 (a) -> 1620 (e); the midpoint should sit between them.
    const band = (m: Float32Array, f1: number, f2: number) => bandEnergy(m, SR, SIZE, f1, f2);
    const midLow = band(half, 950, 1150);
    const midCenter = band(half, 1200, 1500);
    expect(midCenter).toBeGreaterThan(band(a, 1200, 1500) * 2);
    expect(midCenter).toBeGreaterThan(band(e, 1200, 1500) * 0.1);
    expect(midLow).toBeLessThan(band(a, 950, 1150));
  });

  it('breath trades harmonicity for noise', () => {
    const clean = sing({ vibratoDepth: 0, breath: 0 });
    const breathy = sing({ vibratoDepth: 0, breath: 0.9 });
    const from = Math.round(0.2 * SR);
    const to = Math.round(0.7 * SR);
    const cleanPeak = estimateFreq(clean, SR, from, to, 110).peak;
    const breathyPeak = estimateFreq(breathy, SR, from, to, 110).peak;
    expect(cleanPeak).toBeGreaterThan(0.9);
    expect(breathyPeak).toBeLessThan(cleanPeak - 0.15);
  });

  it('vibrato modulates the pitch over time', () => {
    const m = sing({ vibratoDepth: 1, vibratoRate: 5, breath: 0 }, 220, 1);
    const freqs: number[] = [];
    for (let t = 0.25; t <= 0.65; t += 0.05) {
      const from = Math.round(t * SR);
      freqs.push(estimateFreq(m, SR, from, from + Math.round(0.05 * SR), 220).freq);
    }
    const spread = Math.max(...freqs) / Math.min(...freqs);
    expect(spread).toBeGreaterThan(1.02);
  });

  it('is finite, bounded, deterministic, and releases', () => {
    const a = renderVoice(formantEngine, { seed: 'f1', seconds: 1.2, gate: 0.5 });
    const b = renderVoice(formantEngine, { seed: 'f1', seconds: 1.2, gate: 0.5 });
    expect(countNonFinite(a.l)).toBe(0);
    expect(maxAbs(a.l)).toBeLessThan(3);
    expect(countDiffs(a.l, b.l)).toBe(0);
    expect(a.voice.active).toBe(false);
  });
});
