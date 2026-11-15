/*
 * Plugins: engines and effects that ship in their own package instead of inside the kernel's
 * worklet bundle, so a page pays for them only when it uses them (the singing voice, bellows-voice,
 * is the first).
 *
 * A plugin is plain data. Its `worklet` is a self-contained script (an IIFE: it imports nothing) that
 * runs in the AudioWorkletGlobalScope after the kernel's own module and registers its definitions
 * through the hook the kernel leaves there, `globalThis.bellowsKernel.registerEngine(def)`. It is
 * added with audioWorklet.addModule, never eval, so a page whose Content-Security-Policy allows the
 * kernel's blob URL allows it too; a host that allows neither passes `workletUrl` for both. The same
 * script runs on the calling thread when a render has no OfflineAudioContext (kernel/offline-context.ts).
 *
 * `engines` and `effects` describe what the script registers, for listEngines() and listEffects()
 * on the main thread, which never loads the plugin's DSP. `register`, when given, registers the
 * definitions on the calling thread too, for renderOffline() and Node.
 */

import type { EffectInfo, EngineInfo } from '../types';
import { extendCatalog } from '../core/catalog';

export { KERNEL_HOOK, type KernelHook } from './hook';

export interface BellowsPlugin {
  /** Unique id; a plugin added twice is added once. */
  id: string;
  /** Self-contained script that registers the plugin's defs through globalThis.bellowsKernel. */
  worklet: string;
  /** A URL serving the same script, for hosts whose CSP blocks blob: script sources. */
  workletUrl?: string;
  /** The engines it registers, as listEngines() describes them. */
  engines?: readonly EngineInfo[];
  /** The effects it registers, as listEffects() describes them. */
  effects?: readonly EffectInfo[];
  /** Registers the plugin's defs on the calling thread (renderOffline, Node). */
  register?: () => void;
}

const pluginUrls = new Map<string, string>();

/** The URL to addModule() a plugin from: its own, or a blob of its script made once. */
export function pluginModuleUrl(plugin: BellowsPlugin): string {
  if (plugin.workletUrl) return plugin.workletUrl;
  let url = pluginUrls.get(plugin.id);
  if (!url) {
    url = URL.createObjectURL(new Blob([plugin.worklet], { type: 'application/javascript' }));
    pluginUrls.set(plugin.id, url);
  }
  return url;
}

/* The plugins added on this thread, in order, for the catalog and for renders. */
const added: BellowsPlugin[] = [];

/** Record a plugin on this thread: its catalog entries and its own registration. True the first time its id is seen. */
export function notePlugin(plugin: BellowsPlugin): boolean {
  if (added.some((p) => p.id === plugin.id)) return false;
  added.push(plugin);
  extendCatalog(plugin.engines, plugin.effects);
  return true;
}

/** Every plugin added on this thread, in order. */
export function addedPlugins(): readonly BellowsPlugin[] {
  return added;
}
