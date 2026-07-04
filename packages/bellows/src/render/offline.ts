/*
 * Offline rendering: the same KernelEngine, driven by the same message
 * stream, in a plain loop. No AudioContext, no worklet, no timers, which is
 * why it runs in Node and renders identically to realtime.
 */

import { KernelEngine, type KernelOptions } from '../kernel/engine';
import type { KernelMessage } from '../kernel/messages';

export interface OfflineRenderOptions {
  seconds: number;
  sampleRate?: number;
  kernel?: KernelOptions;
  /** Called once per block with the engine, before the block renders. Lets a scheduler feed events just in time. */
  onBlock?: (engine: KernelEngine, blockStartSec: number) => void;
}

export interface RenderedAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export function renderOffline(setup: KernelMessage[], opts: OfflineRenderOptions): RenderedAudio {
  const sampleRate = opts.sampleRate ?? 44100;
  const engine = new KernelEngine(sampleRate, opts.kernel);
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
