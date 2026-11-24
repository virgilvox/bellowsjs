/*
 * One Bellows instance for the whole app. Views share it; boot happens on
 * the first user gesture. Rebooting with a new seed disposes the old
 * instance so the workbench can reforge cleanly.
 */

import { Bellows, type BellowsPlugin } from 'bellowsjs';
import { voice } from 'bellows-voice';
import { ref, shallowRef } from 'vue';

export const bellows = shallowRef<Bellows | null>(null);
export const booted = ref(false);
export const booting = ref(false);

let bootPromise: Promise<Bellows> | null = null;

/*
 * Browsers cap how many AudioContexts a page can hold, so the workbench
 * keeps one for the life of the page and hands it back to every reboot;
 * the worklet module blob URL is memoized in the library, so addModule on
 * the same context resolves from the module map.
 *
 * Bellows.dispose() closes a context that boot created, which would kill
 * the one we are holding on the first reforge. closeContextOnDispose false
 * tells it the context outlives the instance.
 */
let keptContext: AudioContext | null = null;

/* The plugins every boot loads: the singing voice, which ships in its own package, and any added
 * later with addPlugin() (the WebAssembly engines), so a reforge keeps them. */
const plugins: BellowsPlugin[] = [voice];

/* the seed of the instance now playing, so a reboot for a new kernel keeps the piece's streams */
let lastSeed = 'workbench';

/**
 * Boot again with the kernel a plugin brings, or with none (the TypeScript kernel). A kernel is
 * chosen when the worklet processor is built, so this reforges the instance, with the seed it had.
 */
export async function setKernelPlugin(plugin: BellowsPlugin | null): Promise<Bellows> {
  for (let i = plugins.length - 1; i >= 0; i--) if (plugins[i].kernel) plugins.splice(i, 1);
  if (plugin) plugins.unshift(plugin);
  return ensureBellows(lastSeed);
}

/** Load a plugin into the running instance and every later one. */
export async function addPlugin(plugin: BellowsPlugin): Promise<void> {
  if (!plugins.some((p) => p.id === plugin.id)) plugins.push(plugin);
  const b = await ensureBellows();
  await b.use(plugin);
}

export async function ensureBellows(seed?: string): Promise<Bellows> {
  if (bellows.value && !seed) return bellows.value;
  if (bootPromise && !seed) return bootPromise;
  if (bellows.value && seed) {
    bellows.value.dispose();
    bellows.value = null;
    bootPromise = null;
  }
  booting.value = true;
  lastSeed = seed ?? 'workbench';
  bootPromise = Bellows.boot({
    seed: lastSeed,
    context: keptContext ?? undefined,
    closeContextOnDispose: false,
    plugins: [...plugins],
  }).then((b) => {
    keptContext = b.ctx;
    bellows.value = b;
    booted.value = true;
    booting.value = false;
    return b;
  });
  return bootPromise;
}

export function disposeBellows(): void {
  if (bellows.value) {
    bellows.value.dispose();
    bellows.value = null;
    booted.value = false;
    bootPromise = null;
  }
}
