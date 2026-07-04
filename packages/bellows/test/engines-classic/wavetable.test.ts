import { describe, expect, it } from 'vitest';
import { makeWavetableEngine, wavetableEngine } from '../../src/engines/wavetable';
import { WavetableSet } from '../../src/dsp/wavetable';
import {
  SR,
  bandPower,
  hasBadSamples,
  maxDiff,
  peak,
  render,
  renderPair,
  rms,
  tonePower,
} from './helpers';

describe('wavetable engine', () => {
  it('renders clean audio with sane peak', () => {
    const { l, r } = render(wavetableEngine, { freq: 220 });
    expect(hasBadSamples(l)).toBe(false);
    expect(hasBadSamples(r)).toBe(false);
    expect(peak(l)).toBeGreaterThan(0.03);
    expect(peak(l)).toBeLessThan(1.5);
  });

  it('is deterministic per seed', () => {
    const params = { scanDepth: 0.5, scanRate: 3 };
    const a = render(wavetableEngine, { params, seed: 'wt/seed' });
    const b = render(wavetableEngine, { params, seed: 'wt/seed' });
    expect(maxDiff(a.l, b.l)).toBe(0);
  });

  it('position 0 is near sine, position 1 is bright', () => {
    const base = { scanDepth: 0, envToPosition: 0, sustain: 1 };
    const sine = render(wavetableEngine, { params: { ...base, position: 0 }, freq: 220, offAt: 1 });
    const square = render(wavetableEngine, {
      params: { ...base, position: 1 },
      freq: 220,
      offAt: 1,
    });
    const sineH3 = tonePower(sine.l, 660) / tonePower(sine.l, 220);
    const squareH3 = tonePower(square.l, 660) / tonePower(square.l, 220);
    expect(sineH3).toBeLessThan(1e-3);
    expect(squareH3).toBeGreaterThan(0.05);
  });

  it('lfo scan changes the spectrum over time', () => {
    const params = { position: 0, scanDepth: 1, scanRate: 1, sustain: 1 };
    const { l } = render(wavetableEngine, { params, freq: 220, seconds: 1, offAt: 2 });
    // scanRate 1 Hz: position rides the sine lfo, bright near t = 0.25 s
    const dullWin = bandPower(l, 1000, 5000, 0, Math.round(0.05 * SR));
    const brightWin = bandPower(
      l,
      1000,
      5000,
      Math.round(0.2 * SR),
      Math.round(0.3 * SR),
    );
    expect(brightWin).toBeGreaterThan(dullWin * 10);
  });

  it('envelope to position brightens with the envelope', () => {
    const params = {
      position: 0,
      envToPosition: 1,
      scanDepth: 0,
      attack: 0.001,
      decay: 0.1,
      sustain: 0,
    };
    const { l } = render(wavetableEngine, { params, freq: 220, seconds: 0.5, offAt: 1 });
    const early = bandPower(l, 1000, 5000, 0, Math.round(0.04 * SR));
    const late = bandPower(l, 1000, 5000, Math.round(0.3 * SR), Math.round(0.34 * SR));
    expect(early).toBeGreaterThan(late * 10);
  });

  it('optional filter removes highs', () => {
    const base = { position: 1, sustain: 1 };
    const open = render(wavetableEngine, { params: { ...base, filter: 0 }, freq: 110, offAt: 1 });
    const filtered = render(wavetableEngine, {
      params: { ...base, filter: 1, cutoff: 300, resonance: 0 },
      freq: 110,
      offAt: 1,
    });
    // probe exact odd harmonics of the square so leakage does not dominate
    for (const k of [21, 31, 45]) {
      expect(tonePower(filtered.l, 110 * k)).toBeLessThan(tonePower(open.l, 110 * k) * 0.05);
    }
  });

  it('makeWavetableEngine wraps a custom set', () => {
    // two frames: fundamental sine and third harmonic sine
    const n = 256;
    const f0 = new Float32Array(n);
    const f1 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      f0[i] = Math.sin((2 * Math.PI * i) / n);
      f1[i] = Math.sin((6 * Math.PI * i) / n);
    }
    const set = WavetableSet.fromFrames([f0, f1], SR);
    const def = makeWavetableEngine(set, 'wt-custom');
    expect(def.id).toBe('wt-custom');
    const base = { scanDepth: 0, sustain: 1 };
    const at0 = render(def, { params: { ...base, position: 0 }, freq: 220, offAt: 1 });
    const at1 = render(def, { params: { ...base, position: 1 }, freq: 220, offAt: 1 });
    expect(tonePower(at0.l, 220)).toBeGreaterThan(tonePower(at0.l, 660) * 100);
    expect(tonePower(at1.l, 660)).toBeGreaterThan(tonePower(at1.l, 220) * 100);
  });

  it('release fades the voice out and it can be reused', () => {
    const { voice, l } = render(wavetableEngine, {
      seconds: 1,
      offAt: 0.2,
      params: { release: 0.05 },
    });
    expect(voice.active).toBe(false);
    expect(rms(l, Math.round(0.6 * SR), l.length)).toBeLessThan(1e-3);
    voice.noteOn(330, 1);
    expect(voice.active).toBe(true);
  });

  it('two voices sum into the same bus', () => {
    const a = render(wavetableEngine, { freq: 220, seed: 'w1' });
    const b = render(wavetableEngine, { freq: 330, seed: 'w2' });
    const both = renderPair(wavetableEngine, 220, 330, 'w1', 'w2');
    for (let i = 0; i < both.l.length; i += 997) {
      expect(both.l[i]).toBeCloseTo(a.l[i] + b.l[i], 5);
    }
  });
});
