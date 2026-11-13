/*
 * b.render() in a browser renders through the kernel worklet in an OfflineAudioContext, so the page
 * carries no second copy of the engines (src/kernel/offline-context.ts). Node has no
 * OfflineAudioContext, so this installs one that hosts the SHIPPED worklet string the way
 * test/kernel/worklet-parity.test.ts does: the bundle evaluated against a scope holding the four
 * names an AudioWorkletGlobalScope gives it, its processor constructed with the node's options and
 * driven block by block. Its output must equal renderOffline() run from source over the very score the
 * processor was handed, and so must the fallback that runs the worklet string on the calling thread
 * when there is no OfflineAudioContext.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Bellows } from '../../src/bellows';
import { workletCode } from '../../src/kernel/worklet-code.gen';
import { registerBuiltins } from '../../src/register';
import { renderOffline } from '../../src/render/offline';
import { bankEngineResolver } from '../../src/render/banks';
import type { KernelMessage } from '../../src/kernel/messages';
import { FakeAudioContext, FakeWorkletNode, installFakeAudio } from './fake-context';

const BLOCK = 128;

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
type ProcessorCtor = new (options?: unknown) => Processor;

/* A MessagePort's queue: what the processor posts before the node's onmessage is set still arrives. */
class BridgePort {
  private queue: unknown[] = [];
  private handler: ((e: { data: unknown }) => void) | null = null;
  get onmessage(): ((e: { data: unknown }) => void) | null {
    return this.handler;
  }
  /* dispatch is a later task, as a MessagePort's is, never synchronous with the post */
  set onmessage(h: ((e: { data: unknown }) => void) | null) {
    this.handler = h;
    if (h) for (const m of this.queue.splice(0)) setTimeout(() => this.handler?.({ data: m }), 0);
  }
  deliver(m: unknown): void {
    if (this.handler) setTimeout(() => this.handler?.({ data: m }), 0);
    else this.queue.push(m);
  }
  postMessage(): void {}
}

let nodePortForNextProcessor: BridgePort | null = null;
const SCOPE = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'OfflineAudioContext'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

class FakeOfflineAudioContext {
  static made: FakeOfflineAudioContext[] = [];
  readonly sampleRate: number;
  readonly length: number;
  readonly destination = { connect(): void {}, disconnect(): void {} };
  readonly options: unknown[] = [];
  readonly posted: unknown[] = [];
  onRender: (() => void) | null = null;
  private Ctor: ProcessorCtor | null = null;
  private readonly procs: Processor[] = [];
  private frame = 0;

  constructor(o: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.sampleRate = o.sampleRate;
    this.length = o.length;
    FakeOfflineAudioContext.made.push(this);
  }

  /* a getter, so 'audioWorklet' is on the prototype as it is on BaseAudioContext */
  get audioWorklet(): { addModule(url: string): Promise<void> } {
    return { addModule: async () => this.load() };
  }

  private load(): void {
    const ctx = this;
    class Proc {
      readonly port: { postMessage(m: unknown): void };
      constructor() {
        const bridge = nodePortForNextProcessor;
        this.port = {
          postMessage: (m: unknown) => {
            ctx.posted.push(m);
            bridge?.deliver(m);
          },
        };
      }
    }
    Object.defineProperty(globalThis, 'sampleRate', { value: this.sampleRate, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'currentFrame', { get: () => ctx.frame, configurable: true });
    Object.defineProperty(globalThis, 'AudioWorkletProcessor', { value: Proc, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'registerProcessor', {
      value: (_name: string, c: ProcessorCtor) => {
        ctx.Ctor = c;
      },
      configurable: true,
      writable: true,
    });
    new Function(workletCode)();
  }

  construct(options: unknown, port: BridgePort): void {
    if (!this.Ctor) throw new Error('addModule() was not awaited');
    this.options.push(options);
    nodePortForNextProcessor = port;
    this.procs.push(new this.Ctor(options));
    nodePortForNextProcessor = null;
  }

  async startRendering(): Promise<{ getChannelData(c: number): Float32Array }> {
    this.onRender?.();
    const blocks = Math.ceil(this.length / BLOCK);
    const L = new Float32Array(blocks * BLOCK);
    const R = new Float32Array(blocks * BLOCK);
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    for (let b = 0; b < blocks; b++) {
      l.fill(0);
      r.fill(0);
      for (const p of this.procs) p.process([], [[l, r]]);
      L.set(l, b * BLOCK);
      R.set(r, b * BLOCK);
      this.frame += BLOCK;
    }
    return { getChannelData: (c: number) => (c === 0 ? L : R).subarray(0, this.length) };
  }
}

/* The live context's node stays the inert fake; a node on the offline context hosts the processor. */
class DispatchingWorkletNode extends FakeWorkletNode {
  constructor(ctx: unknown, name: string, opts?: { processorOptions?: unknown }) {
    super(ctx, name, opts);
    if (ctx instanceof FakeOfflineAudioContext) {
      const port = new BridgePort();
      (this as unknown as { port: BridgePort }).port = port;
      ctx.construct(opts, port);
    }
  }
}

function installOffline(): void {
  (globalThis as Record<string, unknown>).OfflineAudioContext = FakeOfflineAudioContext;
  (globalThis as Record<string, unknown>).AudioWorkletNode = DispatchingWorkletNode;
}

function removeOffline(): void {
  delete (globalThis as Record<string, unknown>).OfflineAudioContext;
  (globalThis as Record<string, unknown>).AudioWorkletNode = FakeWorkletNode;
}

const live: Bellows[] = [];
async function boot(seed: string): Promise<Bellows> {
  const b = await Bellows.boot({ seed, context: new FakeAudioContext() as unknown as AudioContext });
  live.push(b);
  return b;
}

/* a short piece across a few engines, an effect and a sung line */
async function piece(seed: string): Promise<Bellows> {
  const b = await boot(seed);
  const lead = b.voice('va', { cutoff: 2000 });
  lead.fx('saturator');
  const bass = b.voice('pluck');
  const melody = b.rng('melody');
  b.clock.at('8n', (t, step) => {
    lead.note(60 + melody.int(12), { at: t, dur: '16n' });
    if (step % 4 === 0) bass.note(36, { at: t, dur: '8n' });
  });
  const singer = b.voice('vocal', { body: 1 });
  b.clock.at('1m', (t, step) => {
    if (step === 0) singer.sing('la la', [{ note: 'A4', dur: '4n' }, { note: 'C5', dur: '4n' }], { at: t + 0.1 });
  });
  return b;
}

beforeAll(() => registerBuiltins());
beforeEach(() => {
  for (const n of SCOPE) if (!saved.has(n)) saved.set(n, Object.getOwnPropertyDescriptor(globalThis, n));
  installFakeAudio();
  FakeOfflineAudioContext.made = [];
});
afterEach(() => {
  for (const b of live.splice(0)) b.dispose();
  for (const [n, d] of saved) {
    if (d) Object.defineProperty(globalThis, n, d);
    else delete (globalThis as Record<string, unknown>)[n];
  }
  saved.clear();
});

describe('b.render() through the worklet in an OfflineAudioContext', () => {
  it('renders, both ways, sample for sample what renderOffline renders from source, and is not silent', async () => {
    installOffline();
    const viaWorklet = await (await piece('worklet-render')).render({ bars: 2 });
    expect(FakeOfflineAudioContext.made.length).toBe(1);
    const ctx = FakeOfflineAudioContext.made[0];
    const score = (ctx.options[0] as { processorOptions: { setup: KernelMessage[] } }).processorOptions.setup;
    const reference = renderOffline(score, {
      seconds: ctx.length / ctx.sampleRate,
      sampleRate: ctx.sampleRate,
      kernel: { resolveBankEngine: bankEngineResolver },
    });
    removeOffline();
    const inProcess = await (await piece('worklet-render')).render({ bars: 2 });

    const diff = (a: { left: Float32Array; right: Float32Array }) => {
      let worst = 0;
      for (let i = 0; i < reference.left.length; i++) {
        worst = Math.max(worst, Math.abs(a.left[i] - reference.left[i]), Math.abs(a.right[i] - reference.right[i]));
      }
      return worst;
    };
    let peak = 0;
    for (const v of reference.left) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.01);
    expect(viaWorklet.left.length).toBe(reference.left.length);
    expect(inProcess.left.length).toBe(reference.left.length);
    expect(diff(viaWorklet)).toBe(0);
    expect(diff(inProcess)).toBe(0);
    expect(viaWorklet.wav().byteLength).toBe(inProcess.wav().byteLength);
  });

  it('leaves the global scope as it found it after rendering on the calling thread', async () => {
    removeOffline();
    const g = globalThis as Record<string, unknown>;
    const before = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor'].map((n) => n in g);
    await (await piece('worklet-scope')).render({ bars: 1 });
    const after = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor'].map((n) => n in g);
    expect(after).toEqual(before);
  });

  it("rejects with the kernel's own error on the calling thread too", async () => {
    removeOffline();
    const b = await boot('worklet-error-inprocess');
    b.voice('no-such-engine');
    await expect(b.render({ bars: 1 })).rejects.toThrow(/no-such-engine/);
  });

  it('hands the score to the processor at construction, with meters off, at the asked rate and length', async () => {
    installOffline();
    const b = await piece('worklet-options');
    await b.render({ seconds: 1.5, sampleRate: 48000 });
    const ctx = FakeOfflineAudioContext.made[0];
    expect(ctx.sampleRate).toBe(48000);
    expect(ctx.length).toBe(72000);
    const o = ctx.options[0] as { processorOptions: { setup: Array<{ type: string }>; meters: boolean } };
    expect(o.processorOptions.meters).toBe(false);
    expect(o.processorOptions.setup.some((m) => m.type === 'createChannel')).toBe(true);
    expect(o.processorOptions.setup[o.processorOptions.setup.length - 1].type).toBe('events');
    expect(ctx.posted.filter((m) => (m as { type?: string }).type === 'meter')).toEqual([]);
  });

  it("rejects with the kernel's own error when a message fails in the worklet", async () => {
    installOffline();
    const b = await boot('worklet-error');
    b.voice('no-such-engine');
    await expect(b.render({ bars: 1 })).rejects.toThrow(/no-such-engine/);
  });

  it('has left the render context before the audio renders, so a live tick meanwhile sees live time', async () => {
    installOffline();
    const b = await piece('worklet-ctx');
    let during: unknown = 'unset';
    const restore = FakeOfflineAudioContext.prototype.startRendering;
    FakeOfflineAudioContext.made = [];
    const make = FakeOfflineAudioContext;
    const origConstruct = make.prototype.construct;
    make.prototype.construct = function (this: FakeOfflineAudioContext, o: unknown, p: BridgePort) {
      this.onRender = () => {
        during = (b as unknown as { renderCtx: unknown }).renderCtx;
      };
      origConstruct.call(this, o, p);
    };
    try {
      await b.render({ bars: 1 });
    } finally {
      make.prototype.construct = origConstruct;
      make.prototype.startRendering = restore;
    }
    expect(during).toBeNull();
  });
});
