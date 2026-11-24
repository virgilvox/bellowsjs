/*
 * The AudioWorklet entry. Bundled standalone by scripts/gen-worklet.mjs
 * into worklet-code.gen.ts, then loaded through a blob URL. Everything the
 * kernel can host (engines, effects, sampler factories) is bundled in.
 */

import { createKernel, registerKernel, type KernelFactory, type KernelLike } from './kernels';
import { registerBuiltins } from '../register';
import { registerEngine, registerEffect } from '../core/registry';
import { KERNEL_HOOK, type KernelHook } from './hook';
import type { EffectDef, EngineDef } from '../types';
import { bankEngineResolver } from '../render/banks';
import type { KernelMessage } from './messages';
import type { KernelProcessorOptions } from './node';

/* AudioWorkletGlobalScope ambients */
declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(
  name: string,
  ctor: new () => unknown,
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

registerBuiltins();

/* The hook plugins register through (kernel/plugin.ts): their scripts run after this module, in this scope. */
const hook: KernelHook = {
  version: 2,
  registerEngine: (def) => registerEngine(def as EngineDef),
  registerEffect: (def) => registerEffect(def as EffectDef),
  registerKernel: (name, factory) => registerKernel(name, factory as KernelFactory),
};
(globalThis as Record<string, unknown>)[KERNEL_HOOK] = hook;

const METER_EVERY_BLOCKS = 8;

class BellowsKernelProcessor extends AudioWorkletProcessor {
  private engine: KernelLike;
  private blockCount = 0;
  private meters = true;

  constructor(options?: { processorOptions?: KernelProcessorOptions }) {
    super();
    const o = options?.processorOptions;
    /*
     * The kernel a plugin registered under processorOptions.kernel, or KernelEngine. A name that
     * is not registered (its plugin's script failed, say) falls back to KernelEngine and says so,
     * because a processor that throws here leaves the page with no audio and no message at all.
     */
    let engine: KernelLike;
    try {
      engine = createKernel(o?.kernel, sampleRate, { resolveBankEngine: bankEngineResolver });
    } catch (err) {
      engine = createKernel(undefined, sampleRate, { resolveBankEngine: bankEngineResolver });
      this.port.postMessage({ type: 'error', message: String(err) + '; rendering with the TypeScript kernel', kernelFallback: true });
    }
    this.engine = engine;
    this.port.onmessage = (e: MessageEvent) => this.apply(e.data as KernelMessage);
    // a setup handed to the constructor is in place before the first process(): an offline render
    // posted as messages instead races startRendering() and can render silence
    if (o) {
      if (o.meters === false) this.meters = false;
      if (o.setup) for (const msg of o.setup) this.apply(msg);
    }
  }

  private apply(msg: KernelMessage): void {
    try {
      this.engine.apply(msg);
    } catch (err) {
      // no console in AudioWorkletGlobalScope on all engines; report via port
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const l = out[0];
    const r = out[1] ?? out[0];
    // lock engine time to context time so event timestamps mean what the
    // facade thinks they mean, even on an old or reused AudioContext
    this.engine.setFrame(currentFrame);
    this.engine.process(l, r);
    if (this.meters && ++this.blockCount % METER_EVERY_BLOCKS === 0) {
      this.port.postMessage({
        type: 'meter',
        peakL: this.engine.peakL,
        peakR: this.engine.peakR,
        rmsL: this.engine.rmsL,
        rmsR: this.engine.rmsR,
        voices: this.engine.voiceCount,
        frame: this.engine.currentFrame,
      });
    }
    return true;
  }
}

registerProcessor('bellows-kernel', BellowsKernelProcessor);
