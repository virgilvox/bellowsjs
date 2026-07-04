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

export async function ensureBellows(seed?: string): Promise<Bellows> {
  if (bellows.value && !seed) return bellows.value;
  if (bootPromise && !seed) return bootPromise;
  if (bellows.value && seed) {
    bellows.value.dispose();
    bellows.value = null;
    bootPromise = null;
  }
  booting.value = true;
  bootPromise = Bellows.boot({ seed: seed ?? 'workbench' }).then((b) => {
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
