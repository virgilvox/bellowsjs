/*
 * b.now() has to be render aware, the fourth replay invariant alongside the
 * three in HANDOFF item 3.
 *
 * render() re-runs the clock callbacks against an offline transport and gives
 * untimed calls renderCtx.now, the tick time of the callback being replayed.
 * now() used to return ctx.currentTime unconditionally, so a callback written
 * `inst.note(n, { at: b.now() + 0.1 })` stamped live wall-clock time into
 * every replayed event and the whole export collapsed onto one instant.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Bellows } from '../../src/bellows';
import { registerBuiltins } from '../../src/core/register';
import { FakeAudioContext, installFakeAudio } from './fake-context';

const live: Bellows[] = [];

async function boot(ctx = new FakeAudioContext()): Promise<Bellows> {
  const b = await Bellows.boot({
    seed: 'render-now',
    workletUrl: 'fake://worklet',
    context: ctx as unknown as AudioContext,
  });
  live.push(b);
  return b;
}

beforeAll(() => {
  registerBuiltins();
  installFakeAudio();
});

afterEach(() => {
  for (const b of live.splice(0)) b.dispose();
});

function peak(x: Float32Array, from = 0, to = x.length): number {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

describe('b.now() during an offline render', () => {
  it('reads the tick time of the callback being replayed, not wall clock', async () => {
    const b = await boot();
    const inst = b.voice('va');
    const seen: number[] = [];
    b.clock.at('4n', (t) => {
      seen.push(b.now());
      inst.note('C3', { at: t, dur: '8n' });
    });
    await b.render({ beats: 4, sampleRate: 22050 });
    // 120 bpm default, so quarters land every 0.5 s across the 2 s render
    expect(seen).toEqual([0, 0.5, 1, 1.5]);
  });

  it('still reads context time when no render is running', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    ctx.currentTime = 3.25;
    expect(b.now()).toBe(3.25);
    await b.render({ beats: 1, sampleRate: 22050 });
    // the render context is cleared in a finally, so live time comes back
    expect(b.now()).toBe(3.25);
  });

  it('renders identically whether a callback times off now() or its own t', async () => {
    async function renderWith(useNow: boolean) {
      const ctx = new FakeAudioContext();
      // a non-zero live clock is the whole hazard: at 0 the bug is invisible
      ctx.currentTime = 7.5;
      const b = await boot(ctx);
      const inst = b.voice('va');
      b.clock.at('4n', (t) => {
        inst.note('C3', { at: (useNow ? b.now() : t) + 0.1, dur: '8n' });
      });
      return b.render({ beats: 4, sampleRate: 22050 });
    }
    const viaNow = await renderWith(true);
    const viaTick = await renderWith(false);
    // not vacuous: there is audio, and it is spread across the render rather
    // than piled into one burst at the start
    const half = viaTick.left.length >> 1;
    expect(peak(viaTick.left, 0, half)).toBeGreaterThan(0.01);
    expect(peak(viaTick.left, half)).toBeGreaterThan(0.01);
    expect(Array.from(viaNow.left)).toEqual(Array.from(viaTick.left));
    expect(Array.from(viaNow.right)).toEqual(Array.from(viaTick.right));
  });
});
