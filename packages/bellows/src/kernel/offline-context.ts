/*
 * Offline rendering through the kernel worklet itself, in an OfflineAudioContext: the same code the
 * page plays live, so the main thread carries no second copy of the engines, and the render runs on
 * the audio rendering thread instead of blocking the page. This is how Tone.Offline renders too.
 *
 * The score goes to the processor's constructor as processorOptions rather than through its port:
 * a message posted before startRendering() is not guaranteed to arrive before the first block, and
 * a render that loses that race is silent. A constructor runs before its node's first process().
 *
 * Where there is no OfflineAudioContext (Node, a test with a stand-in AudioContext) the same worklet
 * string runs here on the calling thread instead, in a scope holding the four names an
 * AudioWorkletGlobalScope gives it, so the facade needs no main-thread copy of the engines anywhere.
 *
 * test/kernel/worklet-parity.test.ts proves the worklet renders what renderOffline renders, block
 * for block, so every path of Bellows.render() gives the same samples.
 */

import type { KernelMessage, KernelReply } from './messages';
import { createKernelNode, KERNEL_PROCESSOR_NAME, type KernelProcessorOptions } from './node';
import { workletCode } from './worklet-code.gen';

/** Whether this environment can render offline through the worklet (a browser; not Node). */
export function canRenderInWorklet(): boolean {
  const g = globalThis as { OfflineAudioContext?: unknown; AudioWorkletNode?: unknown };
  const Offline = g.OfflineAudioContext;
  if (typeof Offline !== 'function' || typeof g.AudioWorkletNode !== 'function') return false;
  const proto = (Offline as { prototype?: unknown }).prototype;
  return typeof proto === 'object' && proto !== null && 'audioWorklet' in proto;
}

/**
 * Render a message stream through the kernel worklet in an OfflineAudioContext: `frames` samples at
 * `sampleRate`, stereo. Rejects with the kernel's own error if a message failed to apply.
 */
export async function renderInWorklet(
  messages: KernelMessage[],
  opts: { frames: number; sampleRate: number; workletUrl?: string },
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number }> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, opts.frames), sampleRate: opts.sampleRate });
  const kernel = await createKernelNode(ctx, {
    workletUrl: opts.workletUrl,
    processorOptions: { setup: messages, meters: false },
  });
  const errors: string[] = [];
  kernel.onReply((reply: KernelReply) => {
    if (reply.type === 'error') errors.push(reply.message);
  });
  kernel.node.connect(ctx.destination);
  try {
    const buf = await ctx.startRendering();
    // a reply the processor posted while applying the score is a separate task on this thread, with
    // no ordering promised against the render's completion: let it land before reading errors
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (errors.length) throw new Error('bellows: offline render failed: ' + errors.join('; '));
    // copies, not views into the AudioBuffer, so the caller owns plain Float32Arrays as renderOffline gives
    const left = Float32Array.from(buf.getChannelData(0)).subarray(0, opts.frames);
    const right = Float32Array.from(buf.getChannelData(1)).subarray(0, opts.frames);
    return { left, right, sampleRate: opts.sampleRate };
  } finally {
    kernel.dispose();
  }
}

/* ---- the worklet on the calling thread ---- */

interface ScopedProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
type ProcessorCtor = new (options?: { processorOptions?: KernelProcessorOptions }) => ScopedProcessor;

const SCOPE_NAMES = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor'] as const;
const BLOCK = 128;
/* where the processor's port posts during the render under way (one at a time: it is synchronous) */
let replies: ((msg: unknown) => void) | null = null;
let frameNow = 0;
let rateNow = 44100;
let processorCtor: ProcessorCtor | null = null;

class ScopePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(msg: unknown): void {
    if (replies) replies(msg);
  }
}

class ScopeProcessorBase {
  readonly port = new ScopePort();
}

/**
 * Render a message stream through the worklet string on this thread: what renderInWorklet() renders,
 * for an environment without an OfflineAudioContext. The scope's names are on globalThis only for the
 * length of the call (every free name in the bundle resolves there, and currentFrame has to be read
 * live on each block), and are put back after.
 */
export function renderWorkletInProcess(
  messages: KernelMessage[],
  opts: { frames: number; sampleRate: number },
): { left: Float32Array; right: Float32Array; sampleRate: number } {
  const g = globalThis as Record<string, unknown>;
  const saved = SCOPE_NAMES.map((n) => [n, Object.getOwnPropertyDescriptor(g, n)] as const);
  const errors: string[] = [];
  rateNow = opts.sampleRate;
  frameNow = 0;
  try {
    Object.defineProperty(g, 'sampleRate', { get: () => rateNow, configurable: true });
    Object.defineProperty(g, 'currentFrame', { get: () => frameNow, configurable: true });
    Object.defineProperty(g, 'AudioWorkletProcessor', { value: ScopeProcessorBase, configurable: true, writable: true });
    Object.defineProperty(g, 'registerProcessor', {
      value: (name: string, ctor: ProcessorCtor) => {
        if (name === KERNEL_PROCESSOR_NAME) processorCtor = ctor;
      },
      configurable: true,
      writable: true,
    });
    // evaluated once: its engines and their registry persist as a live worklet's do
    if (!processorCtor) new Function(workletCode)();
    if (!processorCtor) throw new Error('bellows: the worklet bundle registered no kernel processor');
    replies = (msg) => {
      const m = msg as { type?: string; message?: unknown };
      if (m && m.type === 'error') errors.push(String(m.message));
    };
    const proc = new processorCtor({ processorOptions: { setup: messages, meters: false } });
    if (errors.length) throw new Error('bellows: offline render failed: ' + errors.join('; '));
    const blocks = Math.ceil(opts.frames / BLOCK);
    const left = new Float32Array(blocks * BLOCK);
    const right = new Float32Array(blocks * BLOCK);
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    for (let b = 0; b < blocks; b++) {
      l.fill(0);
      r.fill(0);
      proc.process([], [[l, r]]);
      left.set(l, b * BLOCK);
      right.set(r, b * BLOCK);
      frameNow += BLOCK;
    }
    if (errors.length) throw new Error('bellows: offline render failed: ' + errors.join('; '));
    return { left: left.subarray(0, opts.frames), right: right.subarray(0, opts.frames), sampleRate: opts.sampleRate };
  } finally {
    replies = null;
    for (const [n, d] of saved) {
      if (d) Object.defineProperty(g, n, d);
      else delete g[n];
    }
  }
}
