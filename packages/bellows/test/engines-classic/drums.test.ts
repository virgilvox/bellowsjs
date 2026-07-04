import { describe, expect, it } from 'vitest';
import { clapEngine, hatEngine, kickEngine, snareEngine, tomEngine } from '../../src/engines/drums';
import { rng } from '../../src/core/prng';
import {
  SR,
  bandPower,
  hasBadSamples,
  maxDiff,
  peak,
  render,
  renderPair,
  rms,
  zeroCrossings,
} from './helpers';

const DRUMS = [
  { def: kickEngine, freq: 50 },
  { def: snareEngine, freq: 180 },
  { def: hatEngine, freq: 320 },
  { def: clapEngine, freq: 220 },
  { def: tomEngine, freq: 120 },
];

describe('drum engines, shared behavior', () => {
  for (const { def, freq } of DRUMS) {
    it(`${def.id} renders clean audio with sane peak`, () => {
      const { l, r } = render(def, { freq, offAt: 1 });
      expect(hasBadSamples(l)).toBe(false);
      expect(hasBadSamples(r)).toBe(false);
      expect(peak(l)).toBeGreaterThan(0.05);
      expect(peak(l)).toBeLessThan(1.5);
    });

    it(`${def.id} is deterministic per seed`, () => {
      const a = render(def, { freq, offAt: 1, seed: 'drum/' + def.id });
      const b = render(def, { freq, offAt: 1, seed: 'drum/' + def.id });
      expect(maxDiff(a.l, b.l)).toBe(0);
    });

    it(`${def.id} decays to inactive on its own`, () => {
      const { voice } = render(def, { freq, seconds: 3, offAt: 5 });
      expect(voice.active).toBe(false);
    });

    it(`${def.id} resets fully on reuse`, () => {
      const { voice } = render(def, { freq, seconds: 3, offAt: 5 });
      expect(voice.active).toBe(false);
      voice.noteOn(freq, 1);
      expect(voice.active).toBe(true);
      const l = new Float32Array(2205);
      const r = new Float32Array(2205);
      voice.process(l, r, 0, 2205);
      expect(peak(l)).toBeGreaterThan(0.05);
    });

    it(`${def.id} velocity scales level`, () => {
      const loud = render(def, { freq, vel: 1, offAt: 1 });
      const soft = render(def, { freq, vel: 0.25, offAt: 1 });
      expect(peak(soft.l)).toBeLessThan(peak(loud.l) * 0.6);
    });

    it(`${def.id} sums two voices into one bus`, () => {
      const a = render(def, { freq, seed: 'd1', offAt: 1 });
      const b = render(def, { freq: freq * 1.3, seed: 'd2', offAt: 1 });
      const both = renderPair(def, freq, freq * 1.3, 'd1', 'd2', { offAt: 1 });
      for (let i = 0; i < both.l.length; i += 991) {
        expect(both.l[i]).toBeCloseTo(a.l[i] + b.l[i], 5);
      }
    });
  }
});

describe('kick', () => {
  it('concentrates energy low', () => {
    const { l } = render(kickEngine, { freq: 50, offAt: 1 });
    const low = bandPower(l, 30, 150);
    const high = bandPower(l, 2000, 8000);
    expect(low).toBeGreaterThan(high * 100);
  });

  it('pitch sweeps down from clickTune', () => {
    const { l } = render(kickEngine, {
      freq: 50,
      offAt: 1,
      params: { clickTune: 10, pitchDecay: 0.05, drive: 0 },
    });
    const early = zeroCrossings(l, 0, Math.round(0.03 * SR)) / 0.03;
    const late = zeroCrossings(l, Math.round(0.2 * SR), Math.round(0.3 * SR)) / 0.1;
    expect(early).toBeGreaterThan(late * 2);
  });

  it('tunes with the note frequency', () => {
    const lowKick = render(kickEngine, { freq: 40, offAt: 1, params: { clickTune: 1 } });
    const highKick = render(kickEngine, { freq: 80, offAt: 1, params: { clickTune: 1 } });
    const zLow = zeroCrossings(lowKick.l, Math.round(0.1 * SR), Math.round(0.3 * SR));
    const zHigh = zeroCrossings(highKick.l, Math.round(0.1 * SR), Math.round(0.3 * SR));
    expect(zHigh).toBeGreaterThan(zLow * 1.5);
  });
});

describe('snare', () => {
  it('tone crossfades body against noise', () => {
    const bodyOnly = render(snareEngine, { freq: 180, offAt: 1, params: { tone: 0 } });
    const noiseOnly = render(snareEngine, { freq: 180, offAt: 1, params: { tone: 1 } });
    const bodyHigh = bandPower(bodyOnly.l, 4000, 12000);
    const noiseHigh = bandPower(noiseOnly.l, 4000, 12000);
    expect(noiseHigh).toBeGreaterThan(bodyHigh * 20);
  });
});

describe('hat', () => {
  it('concentrates energy high', () => {
    const { l } = render(hatEngine, { freq: 320, offAt: 1 });
    const low = bandPower(l, 100, 1000);
    const high = bandPower(l, 6000, 15000);
    expect(high).toBeGreaterThan(low * 100);
  });

  it('open decay rings longer than closed', () => {
    const closed = render(hatEngine, { freq: 320, offAt: 1, params: { decay: 0.05 } });
    const open = render(hatEngine, { freq: 320, offAt: 1, params: { decay: 0.6 } });
    const win = [Math.round(0.2 * SR), Math.round(0.3 * SR)] as const;
    expect(rms(open.l, win[0], win[1])).toBeGreaterThan(rms(closed.l, win[0], win[1]) * 20);
  });
});

describe('clap', () => {
  it('retriggers in bursts before the tail', () => {
    const spread = 0.015;
    const { l } = render(clapEngine, { freq: 220, offAt: 1, params: { spread } });
    // just before the second burst the first has died; the retrigger jumps back up
    const dipEnd = Math.round(spread * SR);
    const dip = rms(l, dipEnd - Math.round(0.003 * SR), dipEnd);
    const burst2 = rms(l, dipEnd, dipEnd + Math.round(0.003 * SR));
    expect(burst2).toBeGreaterThan(dip * 2);
    // same around the third burst
    const dip2End = Math.round(2 * spread * SR);
    const dip2 = rms(l, dip2End - Math.round(0.003 * SR), dip2End);
    const burst3 = rms(l, dip2End, dip2End + Math.round(0.003 * SR));
    expect(burst3).toBeGreaterThan(dip2 * 2);
  });

  it('goes inactive after spread is automated downward mid-burst', () => {
    // With spread 0.03 the second burst is due at sample 1323. Render past
    // sample 221 (the trigger point for spread 0.005), then drop spread so
    // the new target lies behind the counter. The voice must still fire
    // its remaining bursts and decay to inactive.
    const voice = clapEngine.createVoice(SR, { spread: 0.03 }, rng('clap/automate'));
    voice.noteOn(220, 1);
    const n = 3 * SR;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    voice.process(l, r, 0, 1024);
    voice.setParam('spread', 0.005);
    for (let i = 1024; i < n; i += 128) voice.process(l, r, i, Math.min(i + 128, n));
    expect(voice.active).toBe(false);
    expect(hasBadSamples(l)).toBe(false);
  });

  it('keeps a longer tail after the last burst', () => {
    const { l } = render(clapEngine, { freq: 220, offAt: 1, params: { decay: 0.4 } });
    expect(rms(l, Math.round(0.15 * SR), Math.round(0.25 * SR))).toBeGreaterThan(1e-3);
  });
});

describe('tom', () => {
  it('sweeps pitch downward', () => {
    const { l } = render(tomEngine, {
      freq: 120,
      offAt: 1,
      params: { noise: 0, sweep: 0.08 },
    });
    const early = zeroCrossings(l, 0, Math.round(0.03 * SR)) / 0.03;
    const late = zeroCrossings(l, Math.round(0.25 * SR), Math.round(0.35 * SR)) / 0.1;
    expect(early).toBeGreaterThan(late * 1.3);
  });
});
