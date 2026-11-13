/*
 * The main thread lists engines and effects from a generated catalog (src/core/catalog.gen.ts) so a
 * page need not import their DSP, which lives in the worklet. That only works while the catalog says
 * exactly what the real definitions say: this is the check, on every test run. If it fails, run
 * npm run gen:catalog -w packages/bellows.
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_EFFECTS, BUILTIN_ENGINES } from '../../src/core/catalog.gen';
import { listEffects, listEngines } from '../../src/core/catalog';
import { getEngine, listEffects as registeredEffects, listEngines as registeredEngines, registerEngine } from '../../src/core/registry';
import { registerBuiltins } from '../../src/register';
import type { EngineDef } from '../../src/types';

describe('the engine and effect catalog', () => {
  it('describes the built-ins without registering any, so nothing is imported to list them', () => {
    expect(registeredEngines()).toEqual([]);
    expect(() => getEngine('vocal')).toThrow(/unknown engine/);
    const engines = listEngines();
    expect(engines.map((e) => e.id)).toContain('vocal');
    expect(engines.every((e) => !('createVoice' in e))).toBe(true);
    expect(listEffects().map((f) => f.id)).toContain('plate');
    const vocal = engines.find((e) => e.id === 'vocal')!;
    expect(vocal.params.find((p) => p.name === 'glottis')).toEqual({ name: 'glottis', min: 0, max: 2, default: 2 });
  });

  it('says exactly what the real definitions say, in their order', () => {
    registerBuiltins();
    const engines = registeredEngines().map((e) => ({
      id: e.id,
      label: e.label,
      params: e.params,
      ...(e.polyphony !== undefined ? { polyphony: e.polyphony } : {}),
    }));
    const effects = registeredEffects().map((f) => ({ id: f.id, label: f.label, params: f.params }));
    expect(engines).toEqual(BUILTIN_ENGINES);
    expect(effects).toEqual(BUILTIN_EFFECTS);
  });

  it('hands back a registered definition in place of its description, and lists custom ones after the built-ins', () => {
    registerBuiltins();
    const listed = listEngines();
    expect(listed.length).toBe(BUILTIN_ENGINES.length);
    expect(listed.every((e) => typeof (e as EngineDef).createVoice === 'function')).toBe(true);
    const custom: EngineDef = { ...getEngine('va'), id: 'my-engine', label: 'Mine' };
    registerEngine(custom);
    const after = listEngines();
    expect(after[after.length - 1]).toBe(custom);
    expect(after.slice(0, BUILTIN_ENGINES.length).map((e) => e.id)).toEqual(BUILTIN_ENGINES.map((e) => e.id));
  });
});
