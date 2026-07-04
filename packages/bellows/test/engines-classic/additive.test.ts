import { describe, expect, it } from 'vitest';
import { additiveEngine } from '../../src/engines/additive';
import { rng } from '../../src/core/prng';
import { SR, hasBadSamples, maxDiff, peak, render, tonePower } from './helpers';

/** Params that zero every partial in both frames. */
function silentFrames(): Record<string, number> {
  const p: Record<string, number> = {};
  for (let n = 1; n <= 32; n++) {
    p['partial' + n] = 0;
    p['target' + n] = 0;
  }
  return p;
}

describe('additive engine', () => {
  it('renders clean audio with sane peak', () => {
    const { l, r } = render(additiveEngine, { freq: 220 });
    expect(hasBadSamples(l)).toBe(false);
    expect(hasBadSamples(r)).toBe(false);
    expect(peak(l)).toBeGreaterThan(0.03);
    expect(peak(l)).toBeLessThan(1.5);
  });

  it('is deterministic per seed', () => {
    const a = render(additiveEngine, { seed: 'add/seed' });
    const b = render(additiveEngine, { seed: 'add/seed' });
    expect(maxDiff(a.l, b.l)).toBe(0);
  });

  it('a single partial lands at its harmonic', () => {
    const params = { ...silentFrames(), partial8: 1, decay: 20, rolloff: 1 };
    const { l } = render(additiveEngine, { params, freq: 220, offAt: 1 });
    const at8 = tonePower(l, 220 * 8);
    expect(at8).toBeGreaterThan(tonePower(l, 220) * 100);
    expect(at8).toBeGreaterThan(tonePower(l, 220 * 7) * 100);
  });

  it('inharmonicity stretches partials sharp', () => {
    const params = { ...silentFrames(), partial8: 1, decay: 20, rolloff: 1, inharm: 0.01 };
    const { l } = render(additiveEngine, { params, freq: 220, offAt: 1 });
    const stretched = 220 * 8 * Math.sqrt(1 + 0.01 * 64);
    expect(tonePower(l, stretched)).toBeGreaterThan(tonePower(l, 220 * 8) * 20);
  });

  it('per partial detune moves a partial in cents', () => {
    const params = { ...silentFrames(), partial4: 1, detune4: 50, decay: 20, rolloff: 1 };
    const { l } = render(additiveEngine, { params, freq: 220, offAt: 1 });
    const detuned = 220 * 4 * Math.pow(2, 50 / 1200);
    expect(tonePower(l, detuned)).toBeGreaterThan(tonePower(l, 880) * 20);
  });

  it('higher partials decay faster with rolloff below one', () => {
    const params = {
      ...silentFrames(),
      partial1: 1,
      partial8: 1,
      decay: 0.4,
      rolloff: 0.6,
      attack: 0.001,
    };
    const { l } = render(additiveEngine, { params, freq: 220, seconds: 0.6, offAt: 1 });
    const half = Math.round(0.3 * SR);
    const earlyHi = tonePower(l, 1760, 0, half);
    const lateHi = tonePower(l, 1760, half, l.length);
    const earlyLo = tonePower(l, 220, 0, half);
    const lateLo = tonePower(l, 220, half, l.length);
    // partial 8 loses far more energy across the render than partial 1
    expect(lateHi / earlyHi).toBeLessThan((lateLo / earlyLo) * 0.05);
  });

  it('morph crossfades toward the target frame', () => {
    // frame A: pure partial 6. frame B: pure fundamental.
    const params = { ...silentFrames(), partial6: 1, target1: 1, decay: 20, rolloff: 1 };
    const atA = render(additiveEngine, { params: { ...params, morph: 0 }, freq: 220, offAt: 1 });
    const atB = render(additiveEngine, { params: { ...params, morph: 1 }, freq: 220, offAt: 1 });
    expect(tonePower(atA.l, 1320)).toBeGreaterThan(tonePower(atA.l, 220) * 100);
    expect(tonePower(atB.l, 220)).toBeGreaterThan(tonePower(atB.l, 1320) * 100);
  });

  it('drops partials above Nyquist', () => {
    // fundamental high enough that partial 32 would land far above Nyquist
    const { l } = render(additiveEngine, { freq: 4000, params: { decay: 20 } });
    expect(hasBadSamples(l)).toBe(false);
    // nothing should alias down: probe a few reflection frequencies
    const p5 = tonePower(l, 20000); // 5 x 4000 exceeds 0.45 fs, must be absent
    expect(p5).toBeLessThan(tonePower(l, 4000) * 1e-3);
  });

  it('goes inactive after release and can be reused', () => {
    const { voice } = render(additiveEngine, {
      seconds: 1,
      offAt: 0.2,
      params: { release: 0.05 },
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
    const a = render(additiveEngine, { freq: 220, seed: 'a1' });
    const b = render(additiveEngine, { freq: 330, seed: 'a2' });
    const n = a.l.length;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    const v1 = additiveEngine.createVoice(SR, {}, rng('a1'));
    const v2 = additiveEngine.createVoice(SR, {}, rng('a2'));
    v1.noteOn(220, 1);
    v2.noteOn(330, 1);
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
