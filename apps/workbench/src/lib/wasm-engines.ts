/*
 * The WebAssembly build of the bellows-embedded engines and effects, loaded
 * on request. The plugin is about 670 KB, so a page that never asks for it
 * never fetches it: the import is dynamic and its chunk is split out.
 *
 * Once loaded, every ported unit sits beside its TypeScript twin under a
 * wasm- prefix (wasm-va beside va, wasm-plate beside plate) with the same
 * params, so the instrument can switch between the two and be heard side by
 * side. The plugin goes on the app's boot list too, so a reforge that builds
 * a new Bellows keeps it, and renders through b.render() load it as well.
 */

import { reactive } from 'vue';
import { addPlugin } from './audio';

export const WASM_PREFIX = 'wasm-';

export const wasmState = reactive({
  loaded: false,
  loading: false,
  error: '',
  engineIds: [] as string[],
  effectIds: [] as string[],
});

let loading: Promise<void> | null = null;

export function loadWasmEngines(): Promise<void> {
  if (loading) return loading;
  wasmState.loading = true;
  wasmState.error = '';
  loading = import('bellows-wasm-npm')
    .then(async (mod) => {
      await addPlugin(mod.bellowsWasm());
      wasmState.engineIds = mod.engineIds.map((id: string) => WASM_PREFIX + id);
      wasmState.effectIds = mod.effectIds.map((id: string) => WASM_PREFIX + id);
      wasmState.loaded = true;
    })
    .catch((e: unknown) => {
      wasmState.error = e instanceof Error ? e.message : String(e);
      loading = null;
    })
    .finally(() => {
      wasmState.loading = false;
    });
  return loading;
}

/** The TypeScript id a wasm- id mirrors, or the id itself. */
export function baseUnitId(id: string): string {
  return id.startsWith(WASM_PREFIX) ? id.slice(WASM_PREFIX.length) : id;
}
