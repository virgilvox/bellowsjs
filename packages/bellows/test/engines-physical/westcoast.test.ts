import { describe, expect, it } from 'vitest';
import { westcoastEngine } from '../../src/engines/westcoast';
import {
  bandEnergy,
  countDiffs,
  countNonFinite,
  magSpectrum,
  maxAbs,
  mono,
  renderVoice,
  rms,
  spectralCentroid,
} from './helpers';

const SR = 44100;

describe('westcoast engine', () => {
  it('more foldAmount adds measurable high harmonics', () => {
    const size = 16384;
    const render = (foldAmount: number) => {
      const { l, r } = renderVoice(westcoastEngine, {
        freq: 220,
        seconds: 0.7,
        gate: 0.7,
        params: { foldAmount, foldEnv: 0, lpgColor: 0, foldStages: 3 },
      });
      return magSpectrum(mono(l, r), Math.round(0.2 * SR), size);
    };
    const clean = render(0);
    const folded = render(0.9);
    const hiClean = bandEnergy(clean, SR, size, 2000, 10000);
    const loClean = bandEnergy(clean, SR, size, 100, 2000);
    const hiFolded = bandEnergy(folded, SR, size, 2000, 10000);
    const loFolded = bandEnergy(folded, SR, size, 100, 2000);
    expect(hiFolded / loFolded).toBeGreaterThan((hiClean / loClean) * 5);
  });

  it('fold stages compound the folding', () => {
    const size = 16384;
    const render = (foldStages: number) => {
      const { l, r } = renderVoice(westcoastEngine, {
        freq: 220,
        seconds: 0.7,
        gate: 0.7,
        params: { foldAmount: 0.7, foldEnv: 0, lpgColor: 0, foldStages },
      });
      return spectralCentroid(magSpectrum(mono(l, r), Math.round(0.2 * SR), size), SR, size);
    };
    expect(render(4)).toBeGreaterThan(render(1) * 1.1);
  });

  it('lpgDecay sets the release tail length', () => {
    const render = (lpgDecay: number) => {
      const { l, r } = renderVoice(westcoastEngine, {
        seconds: 1.4,
        gate: 0.15,
        params: { lpgDecay },
      });
      return rms(mono(l, r), Math.round(0.5 * SR), Math.round(0.8 * SR));
    };
    const long = render(1.5);
    const short = render(0.05);
    expect(long).toBeGreaterThan(0.001);
    expect(short).toBeLessThan(long * 0.1);
  });

  it('lpgColor darkens the release compared to plain VCA mode', () => {
    const size = 8192;
    const render = (lpgColor: number) => {
      const { l, r } = renderVoice(westcoastEngine, {
        freq: 220,
        seconds: 1,
        gate: 0.1,
        params: { lpgColor, lpgDecay: 0.8, foldAmount: 0.7, foldEnv: 0 },
      });
      return spectralCentroid(magSpectrum(mono(l, r), Math.round(0.3 * SR), size), SR, size);
    };
    expect(render(1)).toBeLessThan(render(0) * 0.7);
  });

  it('gates cleanly: fast attack, decaying tail, voice ends', () => {
    const { l, r, voice } = renderVoice(westcoastEngine, {
      seconds: 3,
      gate: 0.3,
      params: { lpgDecay: 0.3 },
    });
    const m = mono(l, r);
    expect(rms(m, Math.round(0.05 * SR), Math.round(0.25 * SR))).toBeGreaterThan(0.01);
    expect(rms(m, Math.round(2.7 * SR), Math.round(3 * SR))).toBeLessThan(1e-3);
    expect(voice.active).toBe(false);
  });

  it('is finite, bounded, and deterministic', () => {
    const a = renderVoice(westcoastEngine, {
      seconds: 0.8,
      params: { foldAmount: 1, foldStages: 6, lpgColor: 1 },
    });
    const b = renderVoice(westcoastEngine, {
      seconds: 0.8,
      params: { foldAmount: 1, foldStages: 6, lpgColor: 1 },
    });
    expect(countNonFinite(a.l)).toBe(0);
    expect(maxAbs(a.l)).toBeLessThan(2);
    expect(countDiffs(a.l, b.l)).toBe(0);
  });
});
