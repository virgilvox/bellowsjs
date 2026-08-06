/*
 * One Bellows instance for the whole app. Views share it; boot happens on
 * the first user gesture. Rebooting with a new seed disposes the old
 * instance so the workbench can reforge cleanly.
 */

import { Bellows } from 'bellowsjs';
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

export async function ensureBellows(seed?: string): Promise<Bellows> {
  if (bellows.value && !seed) return bellows.value;
  if (bootPromise && !seed) return bootPromise;
  if (bellows.value && seed) {
    bellows.value.dispose();
    bellows.value = null;
    bootPromise = null;
  }
  booting.value = true;
  bootPromise = Bellows.boot({
    seed: seed ?? 'workbench',
    context: keptContext ?? undefined,
    closeContextOnDispose: false,
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
