/*
 * Construction-time capacity options for the memory-heavy time effects.
 *
 * Three things have to hold. Defaults still cover the full documented
 * range, so no existing patch changes. A smaller requested capacity
 * clamps the runtime time (or size) instead of reading past the buffer.
 * And within a time the smaller buffer can hold, the output is sample
 * identical to the default-sized effect, which is what makes shrinking
 * the allocation a memory change and not a sound change.
 */

import { describe, expect, it } from 'vitest';
import { delayDef, multitapDef, tapeDelayDef } from '../../src/fx/delay';
import { fdnDef } from '../../src/fx/reverb';
import { rng } from '../../src/core/prng';
import { argmaxAbs, impulseResponse, maxAbs, processBlocks } from './util';

const SR = 44100;

/** Deterministic stereo noise, so two effects see byte-identical input. */
function noise(n: number, stream: string): { l: Float32Array; r: Float32Array } {
  const rnd = rng(stream);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = rnd() * 2 - 1;
    r[i] = rnd() * 2 - 1;
  }
  return { l, r };
}

describe('capacity options stay out of the param specs', () => {
  it('does not expose maxSeconds or maxSize as a runtime control', () => {
    for (const def of [delayDef, tapeDelayDef, multitapDef]) {
      expect(def.params.map((p) => p.name)).not.toContain('maxSeconds');
    }
    expect(fdnDef.params.map((p) => p.name)).not.toContain('maxSize');
  });

  it('ignores a setParam call for the capacity name', () => {
    const fx = delayDef.create(SR, { timeL: 0.1, timeR: 0.1, feedback: 0, mix: 1 });
    fx.setParam('maxSeconds', 0.05);
    fx.setParam('timeL', 2.5);
    const n = Math.round(2.6 * SR);
    const { l } = impulseResponse(fx, n);
    // The runtime setParam glides, so look for the echo near 2.5 s
    // rather than exactly on it. If maxSeconds had been honoured at
    // runtime there would be nothing out here at all.
    expect(maxAbs(l, Math.round(2.3 * SR), n)).toBeGreaterThan(0.5);
  });
});

describe('stereo delay capacity', () => {
  it('honours the full documented time range by default', () => {
    const fx = delayDef.create(SR, { timeL: 3.9, timeR: 3.9, feedback: 0, mix: 1 });
    const n = Math.round(4 * SR);
    const { l } = impulseResponse(fx, n);
    const peak = argmaxAbs(l, 1, n);
    expect(peak).toBe(Math.round(3.9 * SR));
    expect(Math.abs(l[peak])).toBeCloseTo(1, 3);
  });

  it('clamps a longer requested time to the constructed maxSeconds', () => {
    const fx = delayDef.create(SR, {
      maxSeconds: 0.5,
      timeL: 3.9,
      timeR: 3.9,
      feedback: 0,
      mix: 1,
    });
    const n = Math.round(1 * SR);
    const { l, r } = impulseResponse(fx, n);
    expect(argmaxAbs(l, 1, n)).toBe(Math.round(0.5 * SR));
    expect(argmaxAbs(r, 1, n)).toBe(Math.round(0.5 * SR));
    // Nothing past the buffer: no stale samples read from behind the head.
    expect(maxAbs(l, Math.round(0.55 * SR), n)).toBeLessThan(1e-6);
  });

  it('clamps a runtime time change to the constructed maxSeconds', () => {
    const fx = delayDef.create(SR, {
      maxSeconds: 0.5,
      timeL: 0.5,
      timeR: 0.5,
      feedback: 0,
      mix: 1,
    });
    fx.setParam('timeL', 8);
    fx.reset(); // snaps the smoother to the clamped time
    const n = Math.round(1 * SR);
    const { l } = impulseResponse(fx, n);
    expect(argmaxAbs(l, 1, n)).toBe(Math.round(0.5 * SR));
  });

  it('sounds identical to the default-sized delay within the smaller buffer', () => {
    const params = { timeL: 0.25, timeR: 0.4, feedback: 0.7, crossFeedback: 0.3, mix: 0.6 };
    const big = delayDef.create(SR, params);
    const small = delayDef.create(SR, { ...params, maxSeconds: 0.5 });
    const n = 20000;
    const a = noise(n, 'fx-time/capacity/delay');
    const b = noise(n, 'fx-time/capacity/delay');
    processBlocks(big, a.l, a.r);
    processBlocks(small, b.l, b.r);
    expect(b.l).toEqual(a.l);
    expect(b.r).toEqual(a.r);
  });
});

describe('tape delay capacity', () => {
  const clean = { feedback: 0, wow: 0, flutter: 0, saturation: 0, mix: 1 };

  it('honours the full documented time range by default', () => {
    const fx = tapeDelayDef.create(SR, { ...clean, time: 1.9 });
    const n = Math.round(2 * SR);
    const { l } = impulseResponse(fx, n);
    const peak = argmaxAbs(l, 1, n);
    expect(Math.abs(peak - Math.round(1.9 * SR))).toBeLessThanOrEqual(2);
    expect(Math.abs(l[peak])).toBeGreaterThan(0.9);
  });

  it('clamps a longer requested time to the constructed maxSeconds', () => {
    const fx = tapeDelayDef.create(SR, { ...clean, maxSeconds: 0.3, time: 1.9 });
    const n = Math.round(0.6 * SR);
    const { l } = impulseResponse(fx, n);
    const peak = argmaxAbs(l, 1, n);
    expect(Math.abs(peak - Math.round(0.3 * SR))).toBeLessThanOrEqual(2);
    expect(Math.abs(l[peak])).toBeGreaterThan(0.9);
  });

  it('sounds identical to the default-sized tape within the smaller buffer', () => {
    const params = { time: 0.2, feedback: 0.6, wow: 0.5, flutter: 0.4, mix: 0.5 };
    const big = tapeDelayDef.create(SR, params);
    const small = tapeDelayDef.create(SR, { ...params, maxSeconds: 0.3 });
    const n = 20000;
    const a = noise(n, 'fx-time/capacity/tape');
    const b = noise(n, 'fx-time/capacity/tape');
    processBlocks(big, a.l, a.r);
    processBlocks(small, b.l, b.r);
    expect(b.l).toEqual(a.l);
    expect(b.r).toEqual(a.r);
  });
});

describe('multitap capacity', () => {
  const oneTap = { diffusion: 0, mix: 1, level1: 1, level2: 0, level3: 0, level4: 0 };

  it('honours the full documented time range by default', () => {
    const fx = multitapDef.create(SR, { ...oneTap, time1: 1.9 });
    const n = Math.round(2 * SR);
    const { l } = impulseResponse(fx, n);
    const base = Math.round(1.9 * SR);
    const peak = argmaxAbs(l, base - 8, base + 800);
    expect(Math.abs(l[peak])).toBeGreaterThan(0.9);
  });

  it('clamps a longer requested time to the constructed maxSeconds', () => {
    const fx = multitapDef.create(SR, { ...oneTap, maxSeconds: 0.25, time1: 1.9 });
    const n = Math.round(0.6 * SR);
    const { l } = impulseResponse(fx, n);
    const base = Math.round(0.25 * SR);
    const peak = argmaxAbs(l, 1, n);
    expect(Math.abs(peak - base)).toBeLessThanOrEqual(800);
    expect(Math.abs(l[peak])).toBeGreaterThan(0.9);
  });

  it('sounds identical to the default-sized multitap within the smaller buffer', () => {
    const params = { time1: 0.05, time2: 0.1, time3: 0.15, time4: 0.2, diffusion: 0.5, mix: 0.6 };
    const big = multitapDef.create(SR, params);
    const small = multitapDef.create(SR, { ...params, maxSeconds: 0.25 });
    const n = 20000;
    const a = noise(n, 'fx-time/capacity/multitap');
    const b = noise(n, 'fx-time/capacity/multitap');
    processBlocks(big, a.l, a.r);
    processBlocks(small, b.l, b.r);
    expect(b.l).toEqual(a.l);
    expect(b.r).toEqual(a.r);
  });
});

describe('fdn capacity', () => {
  const params = { decay: 2, damp: 6000, chorus: 0, predelay: 0.01, mix: 1 };

  function tail(fx: ReturnType<typeof fdnDef.create>, n: number): Float32Array {
    return impulseResponse(fx, n).l;
  }

  it('honours the full documented size range by default', () => {
    // Size really does change the network, so the default build must not
    // be quietly clamping size 3 down to size 1.
    const small = tail(fdnDef.create(SR, { ...params, size: 1 }), 8192);
    const large = tail(fdnDef.create(SR, { ...params, size: 3 }), 8192);
    expect(maxAbs(large, 0, large.length)).toBeGreaterThan(0);
    expect(large).not.toEqual(small);
  });

  it('clamps a larger requested size to the constructed maxSize', () => {
    const clamped = tail(fdnDef.create(SR, { ...params, maxSize: 1, size: 3 }), 8192);
    const atMax = tail(fdnDef.create(SR, { ...params, size: 1 }), 8192);
    expect(clamped).toEqual(atMax);
  });

  it('clamps a runtime size change to the constructed maxSize', () => {
    const fx = fdnDef.create(SR, { ...params, maxSize: 1.5, size: 1 });
    fx.setParam('size', 3);
    fx.reset();
    const clamped = tail(fx, 8192);
    const atMax = tail(fdnDef.create(SR, { ...params, size: 1.5 }), 8192);
    expect(clamped).toEqual(atMax);
  });

  it('sounds identical to the default-sized fdn within the smaller lines', () => {
    const big = fdnDef.create(SR, { ...params, size: 1.2, chorus: 0.3 });
    const small = fdnDef.create(SR, { ...params, size: 1.2, chorus: 0.3, maxSize: 1.5 });
    const n = 20000;
    const a = noise(n, 'fx-time/capacity/fdn');
    const b = noise(n, 'fx-time/capacity/fdn');
    processBlocks(big, a.l, a.r);
    processBlocks(small, b.l, b.r);
    expect(b.l).toEqual(a.l);
    expect(b.r).toEqual(a.r);
  });
});
