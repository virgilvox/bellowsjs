import { describe, expect, it } from 'vitest';
import { stringEngine, tubeEngine } from '../../src/engines/waveguide';
import {
  cents,
  countDiffs,
  countNonFinite,
  estimateFreq,
  magSpectrum,
  maxAbs,
  mono,
  peakFreq,
  renderVoice,
  rms,
} from './helpers';

const SR = 44100;

describe('string engine', () => {
  it('plays 440 within 3 cents when plucked', () => {
    const { l, r } = renderVoice(stringEngine, {
      freq: 440,
      seconds: 1.2,
      gate: 1.2,
      params: { sustain: 0.8, dispersion: 0 },
    });
    const m = mono(l, r);
    const est = estimateFreq(m, SR, Math.round(0.3 * SR), Math.round(0.9 * SR), 440);
    expect(Math.abs(cents(est.freq, 440))).toBeLessThan(3);
    expect(est.peak).toBeGreaterThan(0.9);
  });

  it('keeps the fundamental partial in tune with dispersion engaged', () => {
    // Dispersion stretches the upper partials by design, which shifts
    // the composite waveform period, so the fundamental partial is
    // measured by spectral peak instead of autocorrelation.
    const { l, r } = renderVoice(stringEngine, {
      freq: 220,
      seconds: 1.2,
      gate: 1.2,
      params: { sustain: 0.8, dispersion: 0.5 },
    });
    const size = 32768;
    const mags = magSpectrum(mono(l, r), Math.round(0.2 * SR), size);
    const f1 = peakFreq(mags, SR, size, 190, 250);
    expect(Math.abs(cents(f1, 220))).toBeLessThan(3);
  });

  it('dispersion detunes the second partial away from 2 f0', () => {
    const size = 32768;
    const render = (dispersion: number) => {
      const { l, r } = renderVoice(stringEngine, {
        freq: 220,
        seconds: 1.2,
        gate: 1.2,
        params: { sustain: 0.8, dispersion },
      });
      const mags = magSpectrum(mono(l, r), Math.round(0.2 * SR), size);
      const f1 = peakFreq(mags, SR, size, 190, 250);
      const f2 = peakFreq(mags, SR, size, 380, 500);
      return Math.abs(f2 - 2 * f1);
    };
    const clean = render(0);
    const dispersed = render(0.8);
    expect(dispersed).toBeGreaterThan(clean + 1);
  });

  it('sustain lengthens the tail', () => {
    const long = renderVoice(stringEngine, {
      seconds: 1.5,
      gate: 1.5,
      params: { sustain: 1 },
    });
    const short = renderVoice(stringEngine, {
      seconds: 1.5,
      gate: 1.5,
      params: { sustain: 0.1 },
    });
    const from = Math.round(1.1 * SR);
    const to = Math.round(1.5 * SR);
    expect(rms(mono(short.l, short.r), from, to)).toBeLessThan(
      rms(mono(long.l, long.r), from, to) * 0.2
    );
  });

  it('bowing sustains while the gate is held, plucks decay', () => {
    const bowed = renderVoice(stringEngine, {
      freq: 220,
      seconds: 2,
      gate: 2,
      params: { bow: 1, bowPressure: 0.6, bowSpeed: 0.5, sustain: 0.8 },
    });
    const plucked = renderVoice(stringEngine, {
      freq: 220,
      seconds: 2,
      gate: 2,
      params: { bow: 0, sustain: 0.4 },
    });
    const bm = mono(bowed.l, bowed.r);
    const pm = mono(plucked.l, plucked.r);
    const early = [Math.round(0.3 * SR), Math.round(0.6 * SR)] as const;
    const late = [Math.round(1.6 * SR), Math.round(1.9 * SR)] as const;
    const bowedLate = rms(bm, late[0], late[1]);
    expect(bowedLate).toBeGreaterThan(0.005);
    expect(bowedLate).toBeGreaterThan(rms(bm, early[0], early[1]) * 0.3);
    expect(rms(pm, late[0], late[1])).toBeLessThan(rms(pm, early[0], early[1]) * 0.2);
  });

  it('bowed output is finite and bounded', () => {
    const { l } = renderVoice(stringEngine, {
      seconds: 1.5,
      gate: 1,
      params: { bow: 1, bowPressure: 1, bowSpeed: 1, dispersion: 0.6, sustain: 1 },
    });
    expect(countNonFinite(l)).toBe(0);
    expect(maxAbs(l)).toBeLessThan(2);
  });

  it('is deterministic per seed', () => {
    const a = renderVoice(stringEngine, { seed: 'w1', seconds: 0.5 });
    const b = renderVoice(stringEngine, { seed: 'w1', seconds: 0.5 });
    expect(countDiffs(a.l, b.l)).toBe(0);
  });
});

describe('tube engine', () => {
  it('sustains while the gate is held and releases on noteOff', () => {
    const { l, r, voice } = renderVoice(tubeEngine, {
      freq: 200,
      seconds: 2,
      gate: 1.4,
      params: { breath: 0.9 },
    });
    const m = mono(l, r);
    const held1 = rms(m, Math.round(0.4 * SR), Math.round(0.6 * SR));
    const held2 = rms(m, Math.round(1.1 * SR), Math.round(1.3 * SR));
    const tail = rms(m, Math.round(1.85 * SR), Math.round(2 * SR));
    expect(held1).toBeGreaterThan(0.01);
    expect(held2).toBeGreaterThan(held1 * 0.3);
    expect(tail).toBeLessThan(held2 * 0.05);
    expect(voice.active).toBe(false);
  });

  it('plays near the requested pitch', () => {
    const { l, r } = renderVoice(tubeEngine, {
      freq: 233,
      seconds: 1.2,
      gate: 1.2,
      params: { breath: 0.9, noise: 0 },
    });
    const m = mono(l, r);
    const est = estimateFreq(m, SR, Math.round(0.5 * SR), Math.round(1.1 * SR), 233);
    expect(Math.abs(cents(est.freq, 233))).toBeLessThan(60);
  });

  it('is silent without breath and finite with it', () => {
    const quiet = renderVoice(tubeEngine, { seconds: 0.5, params: { breath: 0 } });
    expect(maxAbs(mono(quiet.l, quiet.r))).toBeLessThan(1e-3);
    const loud = renderVoice(tubeEngine, {
      seconds: 1,
      params: { breath: 1, noise: 1 },
    });
    expect(countNonFinite(loud.l)).toBe(0);
    expect(maxAbs(loud.l)).toBeLessThan(3);
  });

  it('is deterministic per seed', () => {
    const a = renderVoice(tubeEngine, { seed: 't1', seconds: 0.5, params: { noise: 0.5 } });
    const b = renderVoice(tubeEngine, { seed: 't1', seconds: 0.5, params: { noise: 0.5 } });
    expect(countDiffs(a.l, b.l)).toBe(0);
  });
});
