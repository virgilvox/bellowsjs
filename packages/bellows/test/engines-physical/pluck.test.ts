import { describe, expect, it } from 'vitest';
import { pluckEngine } from '../../src/engines/pluck';
import {
  cents,
  countDiffs,
  countNonFinite,
  estimateFreq,
  goertzel,
  magSpectrum,
  maxAbs,
  mono,
  renderVoice,
  rms,
  spectralCentroid,
} from './helpers';

const SR = 44100;

describe('pluck engine', () => {
  it('plays A4 within 2 cents, measured by autocorrelation of the steady tail', () => {
    const { l, r } = renderVoice(pluckEngine, {
      freq: 440,
      seconds: 1.2,
      gate: 1.2,
      params: { decay: 3, damp: 0.3 },
    });
    const m = mono(l, r);
    const est = estimateFreq(m, SR, Math.round(0.3 * SR), Math.round(0.9 * SR), 440);
    expect(Math.abs(cents(est.freq, 440))).toBeLessThan(2);
    expect(est.peak).toBeGreaterThan(0.9);
  });

  it('stays accurate across register and damping', () => {
    for (const [freq, damp] of [
      [220, 0.6],
      [440, 0.1],
      [880, 0.4],
    ]) {
      const { l, r } = renderVoice(pluckEngine, {
        freq,
        seconds: 1.0,
        gate: 1.0,
        params: { decay: 3, damp },
      });
      const m = mono(l, r);
      const est = estimateFreq(m, SR, Math.round(0.2 * SR), Math.round(0.8 * SR), freq);
      expect(Math.abs(cents(est.freq, freq))).toBeLessThan(2);
    }
  });

  it('produces finite, bounded output', () => {
    const { l, r } = renderVoice(pluckEngine, {
      seconds: 1.5,
      params: { decay: 8, damp: 0, pickPos: 0.9, exciteType: 0.5 },
    });
    expect(countNonFinite(l)).toBe(0);
    expect(countNonFinite(r)).toBe(0);
    expect(maxAbs(l)).toBeLessThan(2);
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = renderVoice(pluckEngine, { seed: 's1', seconds: 0.5 });
    const b = renderVoice(pluckEngine, { seed: 's1', seconds: 0.5 });
    const c = renderVoice(pluckEngine, { seed: 's2', seconds: 0.5 });
    expect(countDiffs(a.l, b.l)).toBe(0);
    expect(countDiffs(a.l, c.l)).toBeGreaterThan(100);
  });

  it('damp darkens the spectrum', () => {
    const open = renderVoice(pluckEngine, { seconds: 0.6, gate: 0.6, params: { damp: 0.05 } });
    const damped = renderVoice(pluckEngine, { seconds: 0.6, gate: 0.6, params: { damp: 0.85 } });
    const size = 8192;
    const cOpen = spectralCentroid(magSpectrum(mono(open.l, open.r), 0, size), SR, size);
    const cDamped = spectralCentroid(magSpectrum(mono(damped.l, damped.r), 0, size), SR, size);
    expect(cDamped).toBeLessThan(cOpen * 0.7);
  });

  it('pickPos at the string midpoint suppresses even harmonics', () => {
    const opts = { freq: 220, seconds: 0.8, gate: 0.8, params: { decay: 3, damp: 0.2 } };
    const mid = renderVoice(pluckEngine, {
      ...opts,
      params: { ...opts.params, pickPos: 0.5 },
    });
    const edge = renderVoice(pluckEngine, {
      ...opts,
      params: { ...opts.params, pickPos: 0.15 },
    });
    const from = Math.round(0.1 * SR);
    const to = Math.round(0.6 * SR);
    const midMono = mono(mid.l, mid.r);
    const edgeMono = mono(edge.l, edge.r);
    const midRatio = goertzel(midMono, SR, 440, from, to) / goertzel(midMono, SR, 220, from, to);
    const edgeRatio =
      goertzel(edgeMono, SR, 440, from, to) / goertzel(edgeMono, SR, 220, from, to);
    expect(midRatio).toBeLessThan(edgeRatio * 0.25);
  });

  it('decay controls the tail energy and noteOff damps it', () => {
    const long = renderVoice(pluckEngine, { seconds: 1.2, gate: 1.2, params: { decay: 4 } });
    const short = renderVoice(pluckEngine, { seconds: 1.2, gate: 1.2, params: { decay: 0.3 } });
    const gated = renderVoice(pluckEngine, { seconds: 1.2, gate: 0.2, params: { decay: 4 } });
    const from = Math.round(0.9 * SR);
    const to = Math.round(1.2 * SR);
    const tailLong = rms(mono(long.l, long.r), from, to);
    const tailShort = rms(mono(short.l, short.r), from, to);
    const tailGated = rms(mono(gated.l, gated.r), from, to);
    expect(tailShort).toBeLessThan(tailLong * 0.1);
    expect(tailGated).toBeLessThan(tailLong * 0.1);
  });

  it('reclaims the voice after the tail decays', () => {
    const { voice } = renderVoice(pluckEngine, {
      seconds: 3,
      gate: 0.2,
      params: { decay: 0.5 },
    });
    expect(voice.active).toBe(false);
  });
});
