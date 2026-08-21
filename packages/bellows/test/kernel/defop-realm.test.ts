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

import { describe, it, expect, afterEach } from 'vitest';
import { renderOffline } from '../../src/render/offline';
import type { KernelMessage } from '../../src/kernel/messages';

const FLAG = '__bellowsDefOpRealmProbe';
const host = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete host[FLAG];
});

describe('defOp realm', () => {
  it('evaluates the def in the realm that drove the message stream', () => {
    const code = "(globalThis['" + FLAG + "'] = 'evaluated here', { id: 'defop-realm-probe' })";
    const setup: KernelMessage[] = [{ type: 'defOp', kind: 'engine', code }];
    expect(host[FLAG]).toBeUndefined();
    renderOffline(setup, { seconds: 0.01, sampleRate: 48000 });
    expect(host[FLAG]).toBe('evaluated here');
  });
});
