/*
 * quick.ts holds two module globals across the life of the page: the shared
 * boot promise and the instrument cache. Neither used to be recoverable.
 *
 * The boot promise is stored before it settles, which is what makes
 * concurrent callers share one boot, and it means a rejection is stored the
 * same way. boot() called outside a user gesture and a CSP that blocks the
 * blob worklet URL both reject, both are worth retrying, and both used to
 * reject every later play() forever. The cache holds Instrument handles bound
 * to one Bellows, so a replaced instance has to take its instruments with it
 * or the next note goes to a disposed kernel and nothing reports it.
 *
 * Each test imports quick.ts fresh, because those globals are the subject.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeAudioContext, installFakeAudio } from './fake-context';

/** Rejects addModule for the first `n` contexts constructed, like a CSP would. */
function contextClassFailingFirst(n: number) {
  let made = 0;
  return class extends FakeAudioContext {
    constructor() {
      super();
      const fail = made++ < n;
      this.audioWorklet = {
        addModule: async () => {
          if (fail) throw new Error('blocked by Content-Security-Policy');
        },
      };
    }
  };
}

/** A new module graph per test: quick.ts's module globals are the subject. */
async function freshQuick() {
  vi.resetModules();
  return import('../../src/quick');
}

beforeEach(() => {
  installFakeAudio();
});

describe('quick.ts shared boot', () => {
  it('does not cache a failed boot: the next call boots again', async () => {
    installFakeAudio(contextClassFailingFirst(1));
    const quick = await freshQuick();
    await expect(quick.play('va', 'C4')).rejects.toThrow(/failed to load the kernel worklet/);
    // the second attempt reaches a working context, which is the whole point
    await expect(quick.play('va', 'C4')).resolves.toBeUndefined();
    const b = await quick.quickBellows();
    expect(b.disposed).toBe(false);
  });

  it('shares one boot between concurrent callers', async () => {
    const quick = await freshQuick();
    const [a, b] = await Promise.all([quick.quickBellows(), quick.quickBellows()]);
    expect(a).toBe(b);
  });

  it('replaces a disposed instance instead of playing into a dead kernel', async () => {
    const quick = await freshQuick();
    const first = await quick.quickBellows();
    await quick.play('va', 'C4');
    first.dispose();
    expect(first.disposed).toBe(true);
    const second = await quick.quickBellows();
    expect(second).not.toBe(first);
    expect(second.disposed).toBe(false);
  });

  it('drops cached instruments bound to the replaced instance', async () => {
    const quick = await freshQuick();
    const first = await quick.quickBellows();
    await quick.play('va', 'C4');
    // one channel on the first instance, from the cached instrument
    expect(first.setupSize).toBeGreaterThan(0);
    first.dispose();
    await quick.play('va', 'C4');
    const second = await quick.quickBellows();
    // a stale cached handle would have played into the disposed Bellows and
    // left the fresh one with no channel at all
    expect(second).not.toBe(first);
    expect(second.setupSize).toBeGreaterThan(0);
  });
});
