import { describe, expect, it } from 'vitest';
import { delayDef } from '../../src/fx/delay';
import {
  argmaxAbs,
  impulseResponse,
  maxAbs,
  maxStep,
  processBlocks,
  rms,
} from './util';
import { rng } from '../../src/core/prng';

const SR = 44100;

describe('delay def', () => {
  it('exposes id, params and a factory', () => {
    expect(delayDef.id).toBe('delay');
    const names = delayDef.params.map((p) => p.name);
    for (const n of ['timeL', 'timeR', 'feedback', 'crossFeedback', 'damping', 'mix']) {
      expect(names).toContain(n);
    }
  });
});

describe('stereo delay', () => {
  it('places single echoes at timeL and timeR', () => {
    const fx = delayDef.create(SR, { timeL: 0.1, timeR: 0.15, feedback: 0, mix: 1 });
    const { l, r } = impulseResponse(fx, Math.round(0.3 * SR));
    const pl = argmaxAbs(l, 1, l.length);
    const pr = argmaxAbs(r, 1, r.length);
    expect(pl).toBe(4410);
    expect(pr).toBe(6615);
    expect(Math.abs(l[pl])).toBeCloseTo(1, 3);
    expect(Math.abs(r[pr])).toBeCloseTo(1, 3);
  });

  it('ping-pongs with crossFeedback 1', () => {
    const fx = delayDef.create(SR, {
      timeL: 0.1,
      timeR: 0.1,
      feedback: 0.6,
      crossFeedback: 1,
      damping: 20000,
      mix: 1,
    });
    const n = Math.round(0.38 * SR);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    l[0] = 1; // impulse in the left channel only
    processBlocks(fx, l, r);
    const w = 300;
    const e1 = 4410;
    const e2 = 8820;
    const e3 = 13230;
    // Echo 1 left, echo 2 right, echo 3 back left.
    expect(rms(l, e1 - w, e1 + w)).toBeGreaterThan(10 * rms(r, e1 - w, e1 + w));
    expect(rms(r, e2 - w, e2 + w)).toBeGreaterThan(10 * rms(l, e2 - w, e2 + w));
    expect(rms(l, e3 - w, e3 + w)).toBeGreaterThan(5 * rms(r, e3 - w, e3 + w));
  });

  it('damping darkens successive repeats', () => {
    const fx = delayDef.create(SR, {
      timeL: 0.12,
      timeR: 0.12,
      feedback: 0.8,
      damping: 1000,
      mix: 1,
    });
    const period = Math.round(0.12 * SR);
    const { l } = impulseResponse(fx, period * 4 + 1000);
    const w = 400;
    // Brightness (mean |diff| over rms) must fall from echo 1 to echo 3,
    // and levels must decay.
    const b1 = roughnessWindow(l, period, w);
    const b3 = roughnessWindow(l, period * 3, w);
    expect(b3).toBeLessThan(b1 * 0.8);
    expect(rms(l, period * 3 - w, period * 3 + w)).toBeLessThan(
      rms(l, period - w, period + w),
    );
  });

  it('sweeping timeL produces no clicks', () => {
    const fx = delayDef.create(SR, { timeL: 0.2, timeR: 0.2, feedback: 0, mix: 1 });
    const n = 90000;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / SR);
    fx.process(l, r, 0, 30000);
    fx.setParam('timeL', 0.32);
    let i = 30000;
    while (i < n) {
      const to = Math.min(i + 128, n);
      fx.process(l, r, i, to);
      i = to;
    }
    // Wet is a delayed 440 Hz sine at amp 0.8. Natural step is about 0.05;
    // the sweep bends pitch but never jumps. An unsmoothed time change
    // would step by order 1.
    expect(maxStep(l, 30001, n)).toBeLessThan(0.25);
    expect(rms(l, 60000, n)).toBeGreaterThan(0.3);
  });

  it('is a bit-exact bypass at mix 0', () => {
    const fx = delayDef.create(SR, { mix: 0, feedback: 0.5 });
    const rnd = rng('fx-time/delay/dry');
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

  it('stays silent on silent input', () => {
    const fx = delayDef.create(SR, {});
    const n = 8192;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    processBlocks(fx, l, r);
    expect(maxAbs(l, 0, n)).toBe(0);
    expect(maxAbs(r, 0, n)).toBe(0);
  });
});

function roughnessWindow(a: Float32Array, center: number, w: number): number {
  let s = 0;
  for (let i = center - w + 1; i < center + w; i++) s += Math.abs(a[i] - a[i - 1]);
  const level = rms(a, center - w, center + w);
  return s / (2 * w - 1) / Math.max(level, 1e-12);
}
