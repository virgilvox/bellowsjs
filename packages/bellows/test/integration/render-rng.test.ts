/*
 * b.render() claims in its own docstring that "a render equals what a fresh
 * page load would play, as long as randomness flows through b.rng()". That
 * holds only if b.rng(label) is CALLED INSIDE the tick callback. Every doc
 * page and every workbench example teaches the other form, capturing the
 * stream once outside the callback, and for that form the claim was false:
 * the callback closed over the live stream object, which a render's fresh
 * rngCache never sees, so a render consumed and advanced live state.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Bellows } from '../../src/bellows';
import { registerBuiltins } from '../../src/register';
import { FakeAudioContext, installFakeAudio } from './fake-context';

const live: Bellows[] = [];

async function boot(seed = 'rng-repro'): Promise<Bellows> {
  const b = await Bellows.boot({
    seed,
    workletUrl: 'fake://worklet',
    context: new FakeAudioContext() as unknown as AudioContext,
  });
  live.push(b);
  return b;
}

beforeAll(() => registerBuiltins());
beforeEach(() => installFakeAudio());
afterEach(() => {
  for (const b of live.splice(0)) b.dispose();
});

describe('render reproducibility for a captured rng stream', () => {
  it('two renders draw the same numbers when the stream is captured outside the callback', async () => {
    const b = await boot();
    const melody = b.rng('melody'); // captured OUTSIDE, the form every doc teaches
    let drawn: number[] = [];
    b.clock.at('4n', () => {
      drawn.push(melody.int(1000));
    });

    drawn = [];
    await b.render({ bars: 2 });
    const first = drawn.slice();

    drawn = [];
    await b.render({ bars: 2 });
    const second = drawn.slice();

    expect(first.length).toBeGreaterThan(4);
    expect(second).toEqual(first);
  });

  it('a render after live draws still equals a render from a fresh boot', async () => {
    // the second half of the finding: live playback used to advance the very
    // stream the render reads, so an export mid-session differed from a reload
    const fresh = await boot();
    const freshMelody = fresh.rng('melody');
    let freshDrawn: number[] = [];
    fresh.clock.at('4n', () => freshDrawn.push(freshMelody.int(1000)));
    freshDrawn = [];
    await fresh.render({ bars: 2 });
    const reference = freshDrawn.slice();

    const used = await boot();
    const usedMelody = used.rng('melody');
    let usedDrawn: number[] = [];
    used.clock.at('4n', () => usedDrawn.push(usedMelody.int(1000)));
    for (let i = 0; i < 20; i++) usedMelody.int(1000); // live playback happened
    usedDrawn = [];
    await used.render({ bars: 2 });

    expect(usedDrawn).toEqual(reference);
  });

  it('the call-inside-the-callback form keeps working', async () => {
    const b = await boot();
    let drawn: number[] = [];
    b.clock.at('4n', () => drawn.push(b.rng('melody').int(1000)));

    drawn = [];
    await b.render({ bars: 2 });
    const first = drawn.slice();
    drawn = [];
    await b.render({ bars: 2 });

    expect(first.length).toBeGreaterThan(4);
    expect(drawn).toEqual(first);
  });

  it('a fork taken through a captured stream is stable across renders', async () => {
    const b = await boot();
    const melody = b.rng('melody');
    let drawn: number[] = [];
    b.clock.at('4n', () => drawn.push(melody.fork('ornament').int(1000)));

    drawn = [];
    await b.render({ bars: 2 });
    const first = drawn.slice();
    drawn = [];
    await b.render({ bars: 2 });

    expect(first.length).toBeGreaterThan(4);
    expect(drawn).toEqual(first);
  });

  it('keeps the label the underlying stream carries, and the fork concatenation rule', async () => {
    const b = await boot('label-check');
    const melody = b.rng('melody');
    expect(melody.label).toBe('label-check::melody');
    expect(melody.fork('ornament').label).toBe('label-check::melody::ornament');
  });

  it('every draw method on a captured handle resolves the current stream', async () => {
    /*
     * The handle delegates nine ways: the bare call plus int, range, chance,
     * gauss, weighted, pick, shuffle and fork. Binding any ONE of them to the
     * stream that was live at capture time reintroduces the defect for that
     * method alone, which the two-method tests above would not see.
     */
    const b = await boot();
    const s = b.rng('all');
    let drawn: number[] = [];
    b.clock.at('4n', () => {
      drawn.push(s());
      drawn.push(s.int(1000));
      drawn.push(s.range(0, 10));
      drawn.push(s.chance(0.5) ? 1 : 0);
      drawn.push(s.gauss());
      drawn.push(s.weighted([1, 2, 3]));
      drawn.push(s.pick([10, 20, 30, 40]));
      drawn.push(s.shuffle([1, 2, 3, 4, 5])[0]);
      drawn.push(s.fork('child').int(1000));
    });

    drawn = [];
    await b.render({ bars: 2 });
    const first = drawn.slice();
    drawn = [];
    await b.render({ bars: 2 });

    expect(first.length).toBeGreaterThanOrEqual(72);
    expect(drawn).toEqual(first);
  });
});
