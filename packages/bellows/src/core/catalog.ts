/*
 * What engines and effects this thread can name, without carrying their DSP. The built-ins are
 * described by a generated table (catalog.gen.ts, checked against the real definitions by
 * test/integration/catalog.test.ts), so a page can list every engine and draw its parameters while
 * the engines' code lives only in the AudioWorklet. A definition registered on this thread
 * (registerBuiltins(), registerEngine(), b.defEngine) stands in for its description, so callers
 * that registered the real thing get the real thing back.
 */

import type { EffectInfo, EngineInfo } from '../types';
import { BUILTIN_EFFECTS, BUILTIN_ENGINES } from './catalog.gen';
import { listEffects as registeredEffects, listEngines as registeredEngines } from './registry';

function merge<T extends { id: string }>(builtins: readonly T[], registered: T[]): T[] {
  const byId = new Map(registered.map((d) => [d.id, d]));
  const out: T[] = [];
  for (const b of builtins) {
    out.push(byId.get(b.id) ?? b);
    byId.delete(b.id);
  }
  for (const d of byId.values()) out.push(d);
  return out;
}

/** Every engine: the built-ins in their registration order, then any other registered on this thread. */
export function listEngines(): EngineInfo[] {
  return merge<EngineInfo>(BUILTIN_ENGINES, registeredEngines());
}

/** Every effect: the built-ins in their registration order, then any other registered on this thread. */
export function listEffects(): EffectInfo[] {
  return merge<EffectInfo>(BUILTIN_EFFECTS, registeredEffects());
}
