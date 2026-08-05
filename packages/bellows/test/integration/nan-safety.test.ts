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
 * Three things now stop it, and each is tested here because each can regress
 * on its own:
 *   - clamp() sends NaN to the low end instead of passing it through. The
 *     comparison order is load bearing: `v < lo ? lo : v > hi ? hi : v`
 *     fails both tests for NaN and returns it untouched.
 *   - Adsr's coefficient guard is written `!(timeSec > 0)` so NaN takes the
 *     same branch as a non-positive time.
 *   - VoicePool.setParam drops non-finite values, which is the choke point
 *     the kernel uses for every realtime and offline parameter change.
 */

import { describe, expect, it } from 'vitest';
import { registerBuiltins } from '../../src/core/register';
import { listEngines } from '../../src/core/registry';
import { VoicePool } from '../../src/core/voicepool';
import { rng } from '../../src/core/prng';
import { clamp } from '../../src/types';
import { Adsr } from '../../src/dsp/envelopes';

const SR = 44100;
const N = 256;

registerBuiltins();

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
