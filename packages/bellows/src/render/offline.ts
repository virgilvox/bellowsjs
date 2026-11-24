/*
 * Offline rendering: the same KernelEngine, driven by the same message
 * stream, in a plain loop. No AudioContext, no worklet, no timers, which is
 * why it runs in Node and renders identically to realtime.
 */

import type { KernelOptions } from '../kernel/engine';
import { createKernel, type KernelLike } from '../kernel/kernels';
import type { KernelMessage } from '../kernel/messages';
import { registerBuiltins } from '../register';

export interface OfflineRenderOptions {
  seconds: number;
  sampleRate?: number;
  kernel?: KernelOptions;
  /** A kernel registered by name (registerKernel, or a plugin's register()), in place of KernelEngine. */
  kernelName?: string;
  /**
   * Called once per block with the engine, before the block renders. Lets a scheduler feed events
   * just in time. Declared as a method so a callback typed against KernelEngine still fits.
   */
  onBlock?(engine: KernelLike, blockStartSec: number): void;
}

export interface RenderedAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export function renderOffline(setup: KernelMessage[], opts: OfflineRenderOptions): RenderedAudio {
  const sampleRate = opts.sampleRate ?? 44100;
  // the built-in engines and effects, which an in-process render cannot do without: Bellows.boot()
  // used to register them on every page, and code that rendered after a boot relied on it.
  // Idempotent, and engines registered by the caller stay registered.
  registerBuiltins();
  const engine = createKernel(opts.kernelName, sampleRate, opts.kernel);
  for (const msg of setup) engine.apply(msg);

  const totalFrames = Math.ceil(opts.seconds * sampleRate);
  const block = engine.blockSize;
  const blocks = Math.ceil(totalFrames / block);
  const left = new Float32Array(blocks * block);
  const right = new Float32Array(blocks * block);
  const bl = new Float32Array(block);
  const br = new Float32Array(block);

  for (let b = 0; b < blocks; b++) {
    if (opts.onBlock) opts.onBlock(engine, (b * block) / sampleRate);
    engine.process(bl, br);
    left.set(bl, b * block);
    right.set(br, b * block);
  }

  return {
    left: left.subarray(0, totalFrames),
    right: right.subarray(0, totalFrames),
    sampleRate,
  };
}
