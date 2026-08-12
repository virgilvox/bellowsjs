/*
 * A bad parameter value must not be able to break the audio graph.
 *
 * NaN is the one that gets in. It arrives from an empty text field read as
 * a number, from a rate divided by a zero, from a slider bound before its
 * range is known. Before the guards this test locks in, one NaN parameter
 * produced non-finite audio in 129 parameters across 17 engines and threw a
 * TypeError inside process() in 10 parameters across 4, which in an
 * AudioWorklet kills the processor for the life of the page.
 *
 * The policy is one line: a non-finite value never reaches a recursive state
 * variable. Reject it at the setter and keep the last good value, which is
 * what a physical control does when you let go of it. It is cheaper and
 * clearer than trying to recover a poisoned accumulator, and there is no way
 * to recover one: v += coef * (good - NaN) is NaN, so once a NaN is in there
 * every later sample is NaN, no good value rescues it, and a parameter change
 * does not call reset(). Silence for the rest of the session with no error.
 * It costs one test per set() call and nothing per sample.
 *
 * Each guard is tested here because each can regress on its own:
 *   - clamp() sends NaN to the low end instead of passing it through. The
 *     comparison order is load bearing: `v < lo ? lo : v > hi ? hi : v`
 *     fails both tests for NaN and returns it untouched.
 *   - Adsr's coefficient guard is written `!(timeSec > 0)` so NaN takes the
 *     same branch as a non-positive time, and Adsr.set rejects the call.
 *   - VoicePool.setParam drops non-finite values, which is the choke point
 *     the kernel uses for every realtime and offline parameter change.
 *   - Svf, LadderFilter, OnePole, Smoother and EnvelopeFollower reject at
 *     their setters, and the kernel's Ramp (channel gain, pan, sends, bus
 *     return, master gain) does the same.
 */

import { describe, expect, it } from 'vitest';
import { registerBuiltins } from '../../src/register';
import { listEngines } from '../../src/core/registry';
import { VoicePool } from '../../src/core/voicepool';
import { rng } from '../../src/core/prng';
import { clamp, EventKind } from '../../src/types';
import { Adsr, EnvelopeFollower, Smoother } from '../../src/dsp/envelopes';
import { LadderFilter, OnePole, Svf } from '../../src/dsp/filters';
import { KernelEngine, internParam } from '../../src/kernel/engine';
import type { KernelMessage } from '../../src/kernel/messages';

const SR = 44100;
const N = 256;

registerBuiltins();

/** Deterministic test signal: no Math.random anywhere in this repository. */
function noise(n: number, label: string): Float32Array {
  const r = rng(label);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r.range(-1, 1);
  return x;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

function allFinite(x: Float32Array): boolean {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false;
  return true;
}

describe('clamp is the shared guard and must not pass NaN', () => {
  it('sends NaN to the low end', () => {
    expect(clamp(NaN, 0, 1)).toBe(0);
    expect(clamp(NaN, -5, 5)).toBe(-5);
    expect(Number.isNaN(clamp(NaN, 0, 1))).toBe(false);
  });

  it('leaves every finite value exactly where it was', () => {
    for (const [v, lo, hi, want] of [
      [0.5, 0, 1, 0.5],
      [-1, 0, 1, 0],
      [2, 0, 1, 1],
      [0, 0, 1, 0],
      [1, 0, 1, 1],
      [-Infinity, 0, 1, 0],
      [Infinity, 0, 1, 1],
    ] as Array<[number, number, number, number]>) {
      expect(clamp(v, lo, hi)).toBe(want);
    }
  });
});

describe('Adsr survives a NaN time', () => {
  it('does not latch NaN into the level', () => {
    const env = new Adsr(SR);
    env.set(NaN, NaN, NaN, NaN);
    env.trigger();
    for (let i = 0; i < 512; i++) {
      const v = env.next();
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('keeps the last good setting rather than substituting one', () => {
    const env = new Adsr(SR);
    env.set(0.001, 0.001, 0.3, 0.05);
    env.set(0.001, 0.001, NaN, 0.05);
    env.trigger();
    let v = 0;
    for (let i = 0; i < SR * 0.05; i++) v = env.next();
    // the rejected call left sustain at 0.3; accepting NaN and clamping it
    // would have parked the envelope on 0 instead
    expect(v).toBeCloseTo(0.3, 3);
  });
});

/*
 * The recursive units, one entry per unit. Each drives a good setting, then a
 * NaN one, then a good one again, and checks that the output stayed finite
 * throughout AND that the unit still answers. Finiteness alone is not enough:
 * a unit stuck at zero is finite and silent, which is the failure this whole
 * file exists to catch.
 */
const RECURSIVE: Array<{ name: string; run: (poison: boolean) => Float32Array }> = [
  {
    name: 'Svf',
    run(poison) {
      const f = new Svf(SR);
      f.set(1200, 0.707);
      const x = noise(N, 'svf');
      f.process(x, 0, N);
      if (poison) f.set(NaN, NaN, NaN);
      const y = noise(N, 'svf');
      f.process(y, 0, N);
      return y;
    },
  },
  {
    name: 'Svf in bell mode with a NaN gain',
    run(poison) {
      const f = new Svf(SR);
      f.setMode('bell');
      f.set(1200, 0.707, 6);
      if (poison) f.set(1200, 0.707, NaN);
      const y = noise(N, 'svf-bell');
      f.process(y, 0, N);
      return y;
    },
  },
  {
    name: 'LadderFilter',
    run(poison) {
      const f = new LadderFilter(SR);
      f.set(1200, 0.4, 1.5);
      const x = noise(N, 'ladder');
      for (let i = 0; i < N; i++) f.next(x[i]);
      if (poison) {
        f.set(NaN, 0.4, 1.5);
        f.set(1200, NaN, 1.5);
        f.set(1200, 0.4, NaN);
      }
      const y = noise(N, 'ladder');
      for (let i = 0; i < N; i++) y[i] = f.next(y[i]);
      return y;
    },
  },
  {
    name: 'OnePole',
    run(poison) {
      const f = new OnePole(SR);
      f.setLowpass(2000);
      if (poison) {
        f.setLowpass(NaN);
        f.setHighpass(NaN);
      }
      const y = noise(N, 'onepole');
      for (let i = 0; i < N; i++) y[i] = f.next(y[i]);
      return y;
    },
  },
  {
    name: 'Smoother',
    run(poison) {
      const s = new Smoother(SR, poison ? NaN : 0.001);
      s.snap(0);
      if (poison) {
        s.setTarget(NaN);
        for (let i = 0; i < 64; i++) s.next();
        s.snap(NaN);
      }
      // whatever happened above, a good target must still be reached
      s.setTarget(0.75);
      const y = new Float32Array(N);
      for (let i = 0; i < N; i++) y[i] = s.next();
      return y;
    },
  },
  {
    name: 'EnvelopeFollower',
    run(poison) {
      const e = poison ? new EnvelopeFollower(SR, NaN, NaN) : new EnvelopeFollower(SR, 0.001, 0.01);
      const y = new Float32Array(N);
      for (let i = 0; i < N; i++) y[i] = e.next(0.5);
      return y;
    },
  },
];

describe('a NaN parameter cannot poison a recursive unit', () => {
  for (const unit of RECURSIVE) {
    it(`${unit.name} stays finite and still responds`, () => {
      const clean = unit.run(false);
      const poisoned = unit.run(true);
      // not vacuous: the clean run has to produce something to compare to
      expect(allFinite(clean)).toBe(true);
      expect(rms(clean)).toBeGreaterThan(0.01);
      expect(allFinite(poisoned)).toBe(true);
      expect(rms(poisoned)).toBeGreaterThan(0.01);
    });
  }
});

describe('the kernel level ramps reject NaN', () => {
  const AMP = internParam('amp');

  function kernel(): KernelEngine {
    const k = new KernelEngine(SR, { blockSize: 128 });
    const msgs: KernelMessage[] = [
      { type: 'internParam', name: 'amp', index: AMP },
      { type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'nan-ramp' },
      { type: 'channelGain', id: 0, gain: 0.8 },
      { type: 'masterGain', gain: 0.9 },
      {
        type: 'events',
        events: [{ time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 220, c: 1 }],
      },
    ];
    for (const m of msgs) k.apply(m);
    return k;
  }

  function run(k: KernelEngine, blocks: number): Float32Array {
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    const out = new Float32Array(blocks * 128);
    for (let b = 0; b < blocks; b++) {
      l.fill(0);
      r.fill(0);
      k.process(l, r);
      out.set(l, b * 128);
    }
    return out;
  }

  // channelPan is deliberately absent: engine.ts clamps pan before it reaches
  // the ramp, so a pan test here would pass on clamp() and gate nothing.
  for (const msg of [
    { type: 'masterGain', gain: NaN },
    { type: 'channelGain', id: 0, gain: NaN },
  ] as KernelMessage[]) {
    it(`${msg.type} = NaN does not silence the output for good`, () => {
      const k = kernel();
      // past the first block, so setLevel ramps rather than snapping: both
      // entry points have to reject
      run(k, 4);
      k.apply(msg);
      const after = run(k, 40);
      expect(allFinite(after)).toBe(true);
      expect(rms(after)).toBeGreaterThan(0.001);
    });
  }

  it('a NaN gain in the setup stream still leaves the master audible', () => {
    // before the first block setLevel snaps, and a snapped NaN used to sit in
    // v where no later set() could reach it
    const k = new KernelEngine(SR, { blockSize: 128 });
    for (const m of [
      { type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'nan-ramp' },
      { type: 'masterGain', gain: NaN },
      {
        type: 'events',
        events: [{ time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 220, c: 1 }],
      },
    ] as KernelMessage[]) {
      k.apply(m);
    }
    const out = run(k, 40);
    expect(allFinite(out)).toBe(true);
    expect(rms(out)).toBeGreaterThan(0.001);
  });

  it('a bus created with a NaN return level does not poison the mix', () => {
    // createBus is the one place a caller-supplied number reaches a Ramp
    // constructor rather than set() or snap(). b.bus(fx, { level: NaN }).
    const k = kernel();
    k.apply({ type: 'createBus', id: 1, chain: [{ effectId: 'delay', params: {} }], returnLevel: NaN });
    k.apply({ type: 'send', channelId: 0, busId: 1, level: 1 });
    const out = run(k, 40);
    // the send is live, so a NaN return level lands in the master mix
    expect(allFinite(out)).toBe(true);
    expect(rms(out)).toBeGreaterThan(0.001);
  });
});

describe('no engine parameter can poison the audio', () => {
  /* Driven through VoicePool because that is the path the kernel uses for
   * every parameter change, realtime and offline alike. */
  for (const def of listEngines()) {
    it(`${def.id} stays finite with NaN on any parameter`, () => {
      const l = new Float32Array(N);
      const r = new Float32Array(N);
      for (const spec of def.params ?? []) {
        l.fill(0);
        r.fill(0);
        const pool = new VoicePool(def, SR, {}, rng(`nan/${def.id}`), 2);
        pool.noteOn(1, 220, 1, 0);
        pool.setParam(spec.name, NaN);
        pool.process(l, r, 0, N);
        for (let i = 0; i < N; i++) {
          if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) {
            throw new Error(`${def.id}.${spec.name} produced non-finite audio at sample ${i}`);
          }
        }
      }
    });
  }
});
