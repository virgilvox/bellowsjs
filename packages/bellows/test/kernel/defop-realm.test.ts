/*
 * Which realm evaluates a tier 3 def?
 *
 * The security note about this eval named the worklet: HANDOFF item 8, AUDIT
 * finding 9 and the header of core/serialize.ts. The comment at the sink
 * itself named no realm at all. The worklet is half of it. KernelEngine.apply
 * runs on whatever thread calls it, and Bellows.render() replays the recorded
 * setup log through renderOffline, so every defOp is evaluated again on the
 * thread that called render(): the main thread in a browser, where DOM, fetch,
 * cookies and localStorage all exist. renderOffline is public surface as well,
 * so this is reachable without render() at all.
 *
 * The eval is its own probe. `new Function('return (' + code + ')')()`
 * evaluates the whole parenthesised expression, so a comma expression in front
 * of the object literal runs in whichever realm did the evaluating. If that is
 * this realm, the flag lands on this globalThis. Nothing here asserts a realm
 * name, because there is no such thing to read: it asserts that the caller's
 * own globals are the ones the def code touches, which is exactly the claim
 * the documents got backwards.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { renderOffline } from '../../src/render/offline';
import { Bellows } from '../../src/bellows';
import { registerBuiltins } from '../../src/register';
import { FakeAudioContext, installFakeAudio } from '../integration/fake-context';
import type { KernelMessage } from '../../src/kernel/messages';

const FLAG = '__bellowsDefOpRealmProbe';
const POOL = '__bellowsDefOpPoolProbe';
const host = globalThis as unknown as Record<string, unknown>;

const live: Bellows[] = [];

beforeAll(() => {
  registerBuiltins();
  installFakeAudio();
});

afterEach(() => {
  delete host[FLAG];
  delete host[POOL];
  for (const b of live.splice(0)) b.dispose();
});

describe('defOp realm', () => {
  it('evaluates the def in the realm that drove the message stream', () => {
    const code = "(globalThis['" + FLAG + "'] = 'evaluated here', { id: 'defop-realm-probe' })";
    const setup: KernelMessage[] = [{ type: 'defOp', kind: 'engine', code }];
    expect(host[FLAG]).toBeUndefined();
    renderOffline(setup, { seconds: 0.01, sampleRate: 48000 });
    expect(host[FLAG]).toBe('evaluated here');
  });

  /*
   * The one above proves the MECHANISM: KernelEngine evaluates a defOp in
   * whichever realm drove it. This one proves the PATH, which is what every
   * sentence the finding corrects was actually about. Three links, and the
   * first test covers the third:
   *
   *   1. defEngine posts a defOp (bellows.ts:320) and post() records every
   *      message into the setup log (bellows.ts:183).
   *   2. render() replays that log, filtering out only 'events'
   *      (bellows.ts:602), so a defOp recorded live is replayed offline.
   *   3. renderOffline hands it to KernelEngine, which evaluates it here.
   *
   * Link 1 is the setupSize assertion below and link 3 is the test above.
   * LINK 2 IS NOT GATED HERE, and saying so is more useful than implying it
   * is: defEngine also calls registerEngine, which puts the def in this
   * realm's global registry, so the offline kernel finds the engine whether
   * or not the defOp was replayed into it. Measured, by mutating the filter
   * at bellows.ts:602 to drop 'defOp' as well as 'events': both tests in this
   * file stay green. In-process there is nothing to observe, because the
   * replay is redundant for the instance that did the defining. What the
   * replay is FOR is a log replayed in a realm that never saw the def, which
   * is also the realm question this file exists for, and renderOffline is
   * that realm's entry point, which the first test drives directly.
   *
   * Note what the live call does NOT do: it sends the code to the worklet and
   * evaluates nothing in this realm, which is the half the documents had
   * right.
   */
  it('records a live def into the log render() replays, and builds voices from it', async () => {
    const b = await Bellows.boot({
      seed: 'defop-realm',
      workletUrl: 'fake://worklet',
      context: new FakeAudioContext() as unknown as AudioContext,
    });
    live.push(b);

    const before = b.setupSize;
    b.defEngine({
      id: 'defop-realm-render',
      label: 'defOp realm probe',
      params: [{ name: 'gain', min: 0, max: 1, default: 0.5 }],
      createVoice: () => {
        /* globalThis rather than a closure variable, and that is not a style
         * choice: serializeDef writes this function out with toString() and
         * KernelEngine evaluates the text, so nothing this body closes over
         * exists on the other side. Reaching for a test-file `const` here
         * throws ReferenceError inside the eval, which is the tier 3
         * "self-contained" rule biting exactly where it is documented to. */
        const g = globalThis as unknown as Record<string, unknown>;
        g['__bellowsDefOpPoolProbe'] = ((g['__bellowsDefOpPoolProbe'] as number) || 0) + 1;
        let on = false;
        const voice = {
          active: false,
          noteOn() {
            on = true;
            voice.active = true;
          },
          noteOff() {
            on = false;
            voice.active = false;
          },
          isDone: () => !on,
          process(l: Float32Array, r: Float32Array, from: number, to: number) {
            if (!on) return;
            for (let i = from; i < to; i++) {
              l[i] += 0.5;
              r[i] += 0.5;
            }
          },
          setParam() {},
        };
        return voice;
      },
    });
    expect(b.setupSize).toBe(before + 1);
    expect(host[FLAG]).toBeUndefined();

    b.voice('defop-realm-render');
    expect(host[POOL]).toBeUndefined();

    const out = await b.render({ beats: 1, sampleRate: 22050 });

    /*
     * The offline kernel built a voice pool out of an engine that exists only
     * because it was defined at runtime. That is worth asserting on its own,
     * and it is not proof that the defOp was replayed: see the note above.
     * The count is the pool size rather than a note count, so the assertion
     * is on "more than zero" deliberately.
     */
    expect(out.left.length).toBeGreaterThan(0);
    expect((host[POOL] as number) ?? 0).toBeGreaterThan(0);
  });
});
