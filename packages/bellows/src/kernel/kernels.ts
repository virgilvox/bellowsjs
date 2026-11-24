/*
 * Kernels other than KernelEngine. A plugin can bring its own render core (bellows-wasm brings
 * the whole kernel compiled to WebAssembly) and register it here by name; the worklet processor
 * and renderOffline build the named one in place of KernelEngine, and drive it through the same
 * KernelLike surface with the same message stream.
 *
 * A kernel that is not KernelEngine still has to play units it does not carry (a plugin's
 * engine, a tier 3 def, a sample bank), so it is handed the realm's half of the contract as a
 * KernelEnv: the registry, the defs registerBuiltins() registered (to tell a builtin from a
 * replacement under the same id), rng, VoicePool and the interned param names. Everything there is
 * what KernelEngine itself uses, so a foreign unit played through it sounds as it does in
 * KernelEngine.
 *
 * Which kernel runs is chosen once, when the processor (or the render) is built: a plugin that
 * declares `kernel` and is passed to Bellows.boot({ plugins }) names it, and renders of that
 * instance use the same one.
 */

import type { EffectDef, EngineDef, NamedRng } from '../types';
import { getEffect, getEngine } from '../core/registry';
import { rng } from '../core/prng';
import { VoicePool } from '../core/voicepool';
import { builtinEffect, builtinEngine } from '../register';
import { KernelEngine, internParamAt, paramNameAt, type KernelOptions } from './engine';
import type { KernelMessage } from './messages';

/** What a processor or a render needs from a kernel: KernelEngine's public surface. */
export interface KernelLike {
  readonly sampleRate: number;
  readonly blockSize: number;
  readonly currentFrame: number;
  readonly currentTime: number;
  readonly voiceCount: number;
  readonly peakL: number;
  readonly peakR: number;
  readonly rmsL: number;
  readonly rmsR: number;
  setFrame(frame: number): void;
  apply(msg: KernelMessage): void;
  /** Render exactly blockSize frames into outL and outR (overwrites). */
  process(outL: Float32Array, outR: Float32Array): void;
}

/** The realm a kernel runs in, as KernelEngine sees it. */
export interface KernelEnv {
  getEngine(id: string): EngineDef;
  getEffect(id: string): EffectDef;
  /** The def registerBuiltins() registered under this id, whatever the registry holds now. */
  builtinEngine(id: string): EngineDef | undefined;
  builtinEffect(id: string): EffectDef | undefined;
  rng(seed: string): NamedRng;
  VoicePool: typeof VoicePool;
  /** The param name interned at this index (Param and ParamRamp events carry the index). */
  paramName(index: number): string | undefined;
  /** What an internParam message does in KernelEngine. */
  internParamAt(index: number, name: string): void;
}

export type KernelFactory = (sampleRate: number, opts: KernelOptions, env: KernelEnv) => KernelLike;

const kernels = new Map<string, KernelFactory>();

/** Makes a kernel available by name in this realm. Registering a name again replaces it. */
export function registerKernel(name: string, factory: KernelFactory): void {
  kernels.set(name, factory);
}

export function hasKernel(name: string): boolean {
  return kernels.has(name);
}

export const kernelEnv: KernelEnv = {
  getEngine,
  getEffect,
  builtinEngine,
  builtinEffect,
  rng,
  VoicePool,
  paramName: paramNameAt,
  internParamAt,
};

/**
 * The named kernel, or KernelEngine when no name is given. A name that is not registered throws:
 * a caller who asked for a kernel and silently got another would measure the wrong thing.
 */
export function createKernel(name: string | undefined, sampleRate: number, opts: KernelOptions = {}): KernelLike {
  if (!name) return new KernelEngine(sampleRate, opts);
  const factory = kernels.get(name);
  if (!factory) throw new Error(`bellows: no kernel named "${name}" is registered (load the plugin that provides it first)`);
  return factory(sampleRate, opts, kernelEnv);
}
