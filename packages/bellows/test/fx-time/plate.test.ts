import { describe, expect, it } from 'vitest';
import { plateDef } from '../../src/fx/plate';
import { allFinite, correlation, impulseResponse, maxAbs, processBlocks, rms } from './util';
import { rng } from '../../src/core/prng';

// Any rate works: internals scale from the paper's 29761 Hz.
const SR = 32000;

describe('plate def', () => {
  it('exposes id and params', () => {
    expect(plateDef.id).toBe('plate');
    const names = plateDef.params.map((p) => p.name);
    for (const n of ['decay', 'damping', 'bandwidth', 'predelay', 'mix', 'modDepth']) {
      expect(names).toContain(n);
    }
  });
});

describe('plate reverb', () => {
  it('turns an impulse into a long dense tail', () => {
    const fx = plateDef.create(SR, { decay: 0.8, damping: 0.1, mix: 1 });
    const n = Math.round(1.2 * SR);
    const { l, r } = impulseResponse(fx, n);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    // Tail still audible at one second.
    expect(rms(l, Math.round(0.9 * SR), SR)).toBeGreaterThan(1e-4);
    // Dense: most samples in the mid tail are active relative to its level.
    const from = Math.round(0.2 * SR);
    const to = Math.round(0.5 * SR);
    const level = rms(l, from, to);
    let active = 0;
    for (let i = from; i < to; i++) if (Math.abs(l[i]) > 0.05 * level) active++;
    expect(active / (to - from)).toBeGreaterThan(0.5);
  });

  it('decorrelates left and right tails', () => {
    const fx = plateDef.create(SR, { decay: 0.8, mix: 1 });
    const n = SR;
    const { l, r } = impulseResponse(fx, n);
    const c = correlation(l, r, Math.round(0.05 * SR), Math.round(0.9 * SR));
    expect(Math.abs(c)).toBeLessThan(0.9);
    expect(rms(r, Math.round(0.2 * SR), Math.round(0.5 * SR))).toBeGreaterThan(1e-4);
  });

  it('decay lengthens the tail monotonically', () => {
    const tailEnergy = (decay: number): number => {
      const fx = plateDef.create(SR, { decay, mix: 1, modDepth: 0 });
      const n = Math.round(0.8 * SR);
      const { l } = impulseResponse(fx, n);
      return rms(l, Math.round(0.4 * SR), Math.round(0.7 * SR));
    };
    const e3 = tailEnergy(0.3);
    const e5 = tailEnergy(0.5);
    const e7 = tailEnergy(0.7);
    expect(e5).toBeGreaterThan(e3);
    expect(e7).toBeGreaterThan(e5);
  });

  it('honors predelay', () => {
    const fx = plateDef.create(SR, { predelay: 0.05, mix: 1 });
    const { l, r } = impulseResponse(fx, Math.round(0.3 * SR));
    const preSamples = Math.round(0.05 * SR);
    expect(maxAbs(l, 0, preSamples - 10)).toBe(0);
    expect(maxAbs(r, 0, preSamples - 10)).toBe(0);
    expect(rms(l, preSamples, l.length)).toBeGreaterThan(1e-5);
  });

  it('is a bit-exact bypass at mix 0', () => {
    const fx = plateDef.create(SR, { mix: 0 });
    const rnd = rng('fx-time/plate/dry');
    const n = 4096;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = rnd() * 2 - 1;
      r[i] = rnd() * 2 - 1;
    }
    const cl = l.slice();
    const cr = r.slice();
    processBlocks(fx, l, r);
    expect(l).toEqual(cl);
    expect(r).toEqual(cr);
  });

  it('stays bounded at maximum decay with modulation', () => {
    const fx = plateDef.create(SR, { decay: 0.98, modDepth: 2, mix: 1 });
    const n = 2 * SR;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < SR >> 1; i++) {
      const v = Math.sin((2 * Math.PI * 330 * i) / SR);
      l[i] = v;
      r[i] = v;
    }
    processBlocks(fx, l, r);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(maxAbs(l, 0, n)).toBeLessThan(20);
  });
});

/*
 * The README calls this "the Dattorro plate with the 1997 constants", which
 * is a claim about four specific numbers, and all four survived mutation:
 * the input diffuser lengths, their gains, the paper's reference sample
 * rate, and the tank modulation excursion. The tests above measure that a
 * tail exists, is long, is dense, is decorrelated and is bounded, and every
 * one of those is true of any plausible reverb.
 *
 * Each gate below was chosen because it moves when one constant moves and
 * not much when the others do. Measured, at 44100, decay 0.5, mix 1:
 *
 *              first arrival   6th arrival   peak    tone conc.
 *   as shipped      394           804       0.0923     0.869
 *   REF_RATE 32000  367           749       0.0979     0.870
 *   DIFF_LEN +4     394           810       0.0923     0.869
 *   DIFF_G  +0.075  394           804       0.1033     0.869
 *   EXCURSION 16    394           804       0.0923     0.497
 */
describe('the Dattorro constants', () => {
  /** Impulse response of the left channel, modulation off unless asked. */
  function impulse(sampleRate: number, n: number, params: Record<string, number> = {}): Float32Array {
    const fx = plateDef.create(sampleRate, { decay: 0.5, mix: 1, predelay: 0, modDepth: 0, ...params });
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    l[0] = 1;
    r[0] = 1;
    for (let i = 0; i < n; i += 128) fx.process(l, r, i, Math.min(i + 128, n));
    return l;
  }

  const firstArrival = (buf: Float32Array): number => {
    for (let i = 1; i < buf.length; i++) if (Math.abs(buf[i]) > 0.02) return i;
    return -1;
  };

  it('places its first arrival at 8.93 ms whatever the sample rate', () => {
    /*
     * This is what REF_RATE is for: every length in the paper is quoted at
     * 29761 Hz and scaled by sr / 29761, so the plate has one geometry
     * measured in seconds rather than in samples. Measured 8.934 to 8.938
     * ms across a factor of three in sample rate.
     *
     * Changing REF_RATE to 32000 moves it to 8.32 ms, consistently at
     * every rate, which is why the gate is on the absolute time and not on
     * agreement between rates: agreement alone survives a wrong constant.
     */
    for (const sr of [32000, 44100, 48000, 96000]) {
      const ms = (firstArrival(impulse(sr, Math.round(0.05 * sr))) / sr) * 1000;
      expect(ms, `${sr} Hz`).toBeGreaterThan(8.8);
      expect(ms, `${sr} Hz`).toBeLessThan(9.1);
    }
  });

  it('keeps the input diffuser arrival pattern the paper gives it', () => {
    /* The first six arrivals above 0.03, in samples at 44100. The last one
     * is what moves when a diffuser length does. */
    const y = impulse(44100, 4000);
    const arrivals: number[] = [];
    for (let i = 1; i < 1200 && arrivals.length < 6; i++) {
      if (Math.abs(y[i]) > 0.03 && Math.abs(y[i]) >= Math.abs(y[i - 1]) && Math.abs(y[i]) > Math.abs(y[i + 1])) {
        arrivals.push(i);
      }
    }
    expect(arrivals).toEqual([394, 553, 604, 712, 763, 804]);
  });

  it('holds the diffuser gains, which set how much of the impulse survives undiffused', () => {
    /*
     * An allpass chain passes an impulse through with a leading spike whose
     * height is the product of the gains. Raising the third gain from 0.625
     * to 0.7 takes the peak from 0.0923 to 0.1033, 12 percent, while moving
     * no arrival time at all.
     */
    const y = impulse(44100, 4000);
    let peak = 0;
    for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
    expect(peak).toBeGreaterThan(0.088);
    expect(peak).toBeLessThan(0.097);
  });

  it('sweeps the tank by the excursion the paper gives, no more and no less', () => {
    /*
     * The tank's two delays are read through a slowly modulated position,
     * and the excursion is how far. Measured as how much of a steady 1 kHz
     * tone is still at exactly 1 kHz after the tail: a deeper sweep smears
     * more of it away.
     *
     * Modulation off it is 0.923 at every setting, which is what makes this
     * a measurement of the sweep rather than of the tank. On, it is 0.916
     * at excursion 4, 0.869 as shipped at 8, and 0.497 at 16.
     */
    const concentration = (modDepth: number): number => {
      const n = 1 << 15;
      const fx = plateDef.create(44100, { decay: 0.9, mix: 1, predelay: 0, modDepth });
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      const w = (2 * Math.PI * 1000) / 44100;
      for (let i = 0; i < n; i++) {
        l[i] = 0.5 * Math.sin(w * i);
        r[i] = l[i];
      }
      for (let i = 0; i < n; i += 128) fx.process(l, r, i, Math.min(i + 128, n));
      const from = n >> 1;
      let re = 0;
      let im = 0;
      let tot = 0;
      for (let i = from; i < n; i++) {
        re += l[i] * Math.cos(w * i);
        im -= l[i] * Math.sin(w * i);
        tot += l[i] * l[i];
      }
      const mag = Math.hypot(re, im) / (n - from);
      return (mag * mag * 2) / (tot / (n - from));
    };
    expect(concentration(0)).toBeCloseTo(0.923, 2);
    const modulated = concentration(1);
    expect(modulated).toBeGreaterThan(0.83);
    expect(modulated).toBeLessThan(0.90);
  });
});
