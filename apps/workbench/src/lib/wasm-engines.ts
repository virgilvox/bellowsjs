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
import { addPlugin, setKernelPlugin } from './audio';

export const WASM_PREFIX = 'wasm-';

export const wasmState = reactive({
  loaded: false,
  loading: false,
  /** the whole kernel runs in the module (a reboot with its kernel plugin) */
  kernel: false,
  kernelBusy: false,
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

/**
 * Run the whole kernel in the module, or go back to the TypeScript kernel. The module's kernel
 * plays every builtin it carries under the builtin's own id ('va', 'plate'), and anything else
 * (the singing voice, sample banks it lacks) in JavaScript inside the same render. A kernel is
 * fixed when the audio engine starts, so this restarts it.
 */
export async function setWasmKernel(on: boolean): Promise<void> {
  if (wasmState.kernelBusy) return;
  wasmState.kernelBusy = true;
  wasmState.error = '';
  try {
    const mod = await import('bellows-wasm-npm');
    if (on && !('KERNEL_NAME' in mod)) throw new Error('this build of bellows-wasm has no kernel');
    await setKernelPlugin(on ? mod.bellowsWasm({ kernel: true }) : null);
    wasmState.kernel = on;
  } catch (e: unknown) {
    wasmState.error = e instanceof Error ? e.message : String(e);
  } finally {
    wasmState.kernelBusy = false;
  }
}

/** The TypeScript id a wasm- id mirrors, or the id itself. */
export function baseUnitId(id: string): string {
  return id.startsWith(WASM_PREFIX) ? id.slice(WASM_PREFIX.length) : id;
}
