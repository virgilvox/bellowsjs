/*
 * Central registries for engines and effects. Both the realtime kernel and
 * the offline renderer construct instruments through these, which is what
 * makes engines interchangeable and offline output identical to realtime.
 * They hold what has been registered on this thread: the worklet registers
 * the built-ins in its own realm, and the main thread lists them from the
 * catalog (catalog.ts) without loading their DSP. The public listEngines()
 * and listEffects() are the catalog's; the ones here list registrations.
 */

import type { EngineDef, EffectDef } from '../types';

const engines = new Map<string, EngineDef>();
const effects = new Map<string, EffectDef>();

export function registerEngine(def: EngineDef): void {
  engines.set(def.id, def);
}

export function getEngine(id: string): EngineDef {
  const def = engines.get(id);
  if (!def) throw new Error(`unknown engine: ${id} (registered: ${[...engines.keys()].join(', ')})`);
  return def;
}

export function listEngines(): EngineDef[] {
  return [...engines.values()];
}

export function registerEffect(def: EffectDef): void {
  effects.set(def.id, def);
}

export function getEffect(id: string): EffectDef {
  const def = effects.get(id);
  if (!def) throw new Error(`unknown effect: ${id} (registered: ${[...effects.keys()].join(', ')})`);
  return def;
}

export function listEffects(): EffectDef[] {
  return [...effects.values()];
}
