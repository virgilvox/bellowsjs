/*
 * The AudioWorklet entry. Bundled standalone by scripts/gen-worklet.mjs
 * into worklet-code.gen.ts, then loaded through a blob URL. Everything the
 * kernel can host (engines, effects, sampler factories) is bundled in.
 */

import { KernelEngine } from './engine';
import { registerBuiltins } from '../core/register';
import { bankEngineResolver } from '../render/banks';
import type { KernelMessage } from './messages';

/* AudioWorkletGlobalScope ambients */
declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  ctor: new () => unknown,
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

registerBuiltins();

const METER_EVERY_BLOCKS = 8;

class BellowsKernelProcessor extends AudioWorkletProcessor {
  private engine = new KernelEngine(sampleRate, { resolveBankEngine: bankEngineResolver });
  private blockCount = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      try {
        this.engine.apply(e.data as KernelMessage);
      } catch (err) {
        // no console in AudioWorkletGlobalScope on all engines; report via port
        this.port.postMessage({ type: 'error', message: String(err) });
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const l = out[0];
    const r = out[1] ?? out[0];
    this.engine.process(l, r);
    if (++this.blockCount % METER_EVERY_BLOCKS === 0) {
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
