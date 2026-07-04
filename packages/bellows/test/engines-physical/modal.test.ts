import { describe, expect, it } from 'vitest';
import { modalEngine } from '../../src/engines/modal';
import {
  countDiffs,
  countNonFinite,
  goertzel,
  magSpectrum,
  maxAbs,
  mono,
  renderVoice,
  rms,
  spectralCentroid,
} from './helpers';

const SR = 44100;

function strike(params: Record<string, number>, freq = 220, seconds = 1.2) {
  return renderVoice(modalEngine, { freq, seconds, gate: seconds, params });
}

describe('modal engine', () => {
  it('bar material rings at the free-free ratios', () => {
    const { l, r } = strike({ material: 0, decay: 3 });
    const m = mono(l, r);
    const from = Math.round(0.05 * SR);
    const to = Math.round(0.8 * SR);
    for (const ratio of [1, 2.756, 5.404]) {
      const on = goertzel(m, SR, 220 * ratio, from, to);
      const off = goertzel(m, SR, 220 * (ratio + 0.4), from, to);
      expect(on).toBeGreaterThan(off * 5);
    }
  });

  it('bell has the minor third partial at 2.4 f0, bar does not', () => {
    const bell = strike({ material: 2, decay: 2 });
    const bar = strike({ material: 0, decay: 2 });
    const from = Math.round(0.05 * SR);
    const to = Math.round(0.8 * SR);
    const bellP = goertzel(mono(bell.l, bell.r), SR, 220 * 2.4, from, to);
    const barP = goertzel(mono(bar.l, bar.r), SR, 220 * 2.4, from, to);
    const bellF0 = goertzel(mono(bell.l, bell.r), SR, 220, from, to);
    expect(bellP).toBeGreaterThan(bellF0 * 0.1);
    expect(bellP).toBeGreaterThan(barP * 5);
  });

  it('brightness tilts mode gains toward the upper modes', () => {
    const size = 16384;
    const dark = strike({ material: 2, brightness: 0.1 });
    const bright = strike({ material: 2, brightness: 0.9 });
    const cDark = spectralCentroid(magSpectrum(mono(dark.l, dark.r), 0, size), SR, size);
    const cBright = spectralCentroid(magSpectrum(mono(bright.l, bright.r), 0, size), SR, size);
    expect(cBright).toBeGreaterThan(cDark * 1.3);
  });

  it('strikeHardness brightens the strike', () => {
    const size = 16384;
    const soft = strike({ material: 0, strikeHardness: 0 });
    const hard = strike({ material: 0, strikeHardness: 1 });
    const cSoft = spectralCentroid(magSpectrum(mono(soft.l, soft.r), 0, size), SR, size);
    const cHard = spectralCentroid(magSpectrum(mono(hard.l, hard.r), 0, size), SR, size);
    expect(cHard).toBeGreaterThan(cSoft);
  });

  it('wood decays much faster than bell', () => {
    const wood = strike({ material: 4, decay: 2 });
    const bell = strike({ material: 2, decay: 2 });
    const wm = mono(wood.l, wood.r);
    const bm = mono(bell.l, bell.r);
    const from = Math.round(0.8 * SR);
    const to = Math.round(1.1 * SR);
    const early = [Math.round(0.01 * SR), Math.round(0.15 * SR)] as const;
    const woodRatio = rms(wm, from, to) / (rms(wm, early[0], early[1]) + 1e-12);
    const bellRatio = rms(bm, from, to) / (rms(bm, early[0], early[1]) + 1e-12);
    expect(woodRatio).toBeLessThan(bellRatio * 0.2);
  });

  it('noteOff damps the tail and frees the voice', () => {
    const rung = renderVoice(modalEngine, {
      seconds: 1.5,
      gate: 1.5,
      params: { material: 2, decay: 5 },
    });
    const gated = renderVoice(modalEngine, {
      seconds: 1.5,
      gate: 0.15,
      params: { material: 2, decay: 5 },
    });
    const from = Math.round(1.1 * SR);
    const to = Math.round(1.5 * SR);
    expect(rms(mono(gated.l, gated.r), from, to)).toBeLessThan(
      rms(mono(rung.l, rung.r), from, to) * 0.1
    );
    expect(gated.voice.active).toBe(false);
  });

  it('is finite, bounded, and deterministic per seed', () => {
    const a = renderVoice(modalEngine, { seed: 'm1', seconds: 0.6, params: { material: 3 } });
    const b = renderVoice(modalEngine, { seed: 'm1', seconds: 0.6, params: { material: 3 } });
    expect(countNonFinite(a.l)).toBe(0);
    expect(maxAbs(a.l)).toBeLessThan(3);
    expect(countDiffs(a.l, b.l)).toBe(0);
  });

  it('high notes mute modes above Nyquist without blowing up', () => {
    const { l } = renderVoice(modalEngine, {
      freq: 6000,
      seconds: 0.4,
      params: { material: 0 },
    });
    expect(countNonFinite(l)).toBe(0);
    expect(maxAbs(l)).toBeLessThan(3);
  });
});
