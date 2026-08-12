/*
 * Does the code that actually plays in a browser render the same audio as
 * the code that renders offline?
 *
 * The README, the PRD and the offline renderer's own header all state that
 * they do: "the same KernelEngine, driven by the same message stream, in a
 * plain loop... which is why it runs in Node and renders identically to
 * realtime." Nothing checked it. src/kernel/worklet-entry.ts is imported by
 * no test, and CI only proves that regenerating worklet-code.gen.ts
 * produces no diff, which pins the string to its source and says nothing
 * about whether the two wirings agree.
 *
 * They are wired differently in three places, and each one could diverge:
 * the worklet constructs the kernel with resolveBankEngine while the
 * offline renderer takes it from the caller; the worklet calls setFrame
 * with the context clock every block and the offline renderer never calls
 * it; the worklet posts a meter every eight blocks.
 *
 * So this runs the shipped string. workletCode is the exact IIFE that gets
 * wrapped in a blob URL and handed to addModule.
 *
 * The names it needs are installed on globalThis rather than passed in as
 * function parameters, because currentFrame in a real
 * AudioWorkletGlobalScope is a live property read fresh inside every
 * process() call. The first version of this file passed them as arguments,
 * which froze currentFrame at whatever it was when the bundle loaded; the
 * kernel then re-rendered block zero forever and two of the tests below
 * still passed. A harness that can degrade that quietly is worse than none.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { workletCode } from '../../src/kernel/worklet-code.gen';
import { renderOffline } from '../../src/render/offline';
import { registerBuiltins } from '../../src/register';
import { bankEngineResolver } from '../../src/render/banks';
import { KERNEL_PROCESSOR_NAME } from '../../src/kernel/node';
import { EventKind } from '../../src/types';
import type { KernelMessage } from '../../src/kernel/messages';

const SR = 44100;
const BLOCK = 128;

beforeAll(() => registerBuiltins());

interface Processor {
  port: { onmessage?: (e: { data: unknown }) => void; postMessage(m: unknown): void };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

interface WorkletHost {
  send(msg: KernelMessage): void;
  render(blocks: number): { left: Float32Array; right: Float32Array };
  /** One block straight into a caller-shaped outputs array. */
  processInto(outputs: Float32Array[][]): boolean;
  /** Context frame the next process() will see. */
  frame: number;
  meters: Array<Record<string, number>>;
  errors: string[];
  registeredAs: string;
}

const GLOBAL_NAMES = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

function installScope(props: Record<string, unknown>, frameRef: { value: number }): void {
  for (const n of GLOBAL_NAMES) {
    if (!saved.has(n)) saved.set(n, Object.getOwnPropertyDescriptor(globalThis, n));
  }
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'currentFrame', {
    get: () => frameRef.value,
    configurable: true,
  });
}

afterEach(() => {
  for (const [n, d] of saved) {
    if (d) Object.defineProperty(globalThis, n, d);
    else delete (globalThis as Record<string, unknown>)[n];
  }
  saved.clear();
});

/** Evaluate the shipped bundle against a real global scope and drive it. */
function loadWorklet(sampleRate = SR, startFrame = 0): WorkletHost {
  let Ctor: (new () => Processor) | null = null;
  let registeredAs = '';
  const frameRef = { value: startFrame };
  const meters: Array<Record<string, number>> = [];
  const errors: string[] = [];

  class FakeAudioWorkletProcessor {
    port = {
      onmessage: undefined as ((e: { data: unknown }) => void) | undefined,
      postMessage(m: unknown) {
        const rec = m as Record<string, number> & { type?: string; message?: unknown };
        if (rec.type === 'error') errors.push(String(rec.message));
        else meters.push(rec);
      },
    };
  }

  installScope(
    {
      sampleRate,
      AudioWorkletProcessor: FakeAudioWorkletProcessor,
      registerProcessor(name: string, ctor: new () => Processor) {
        registeredAs = name;
        Ctor = ctor;
      },
    },
    frameRef,
  );

  /* No parameters: every free name in the bundle resolves through the
   * scope chain to globalThis, which is what the browser does. */
  new Function(workletCode)();
  if (!Ctor) throw new Error('worklet bundle did not call registerProcessor');
  const proc = new (Ctor as new () => Processor)();

  return {
    meters,
    errors,
    registeredAs,
    get frame() {
      return frameRef.value;
    },
    set frame(v: number) {
      frameRef.value = v;
    },
    send(msg) {
      proc.port.onmessage?.({ data: msg });
    },
    processInto(outputs) {
      const ok = proc.process([], outputs);
      frameRef.value += BLOCK;
      return ok;
    },
    render(blocks) {
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
        frameRef.value += BLOCK;
      }
      return { left, right };
    },
  };
}

const firstNonZero = (buf: Float32Array): number => {
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return i;
  return -1;
};

/* A setup exercising voices, a channel effect, a bus send and the master
 * chain, with events at fractional sample positions so the split loop runs. */
function setupMessages(): KernelMessage[] {
  return [
    { type: 'createChannel', id: 0, engineId: 'va', params: { cutoff: 1800, resonance: 0.4 }, seed: 'wparity' },
    { type: 'createChannel', id: 1, engineId: 'pluck', params: {}, seed: 'wparity-2' },
    { type: 'channelFx', id: 0, chain: [{ effectId: 'saturator', params: { drive: 3 } }] },
    { type: 'createBus', id: 0, chain: [{ effectId: 'plate', params: {} }], returnLevel: 0.35 },
    { type: 'send', channelId: 0, busId: 0, level: 0.5 },
    { type: 'send', channelId: 1, busId: 0, level: 0.25 },
    { type: 'channelGain', id: 0, gain: 0.8 },
    { type: 'channelGain', id: 1, gain: 0.6 },
    { type: 'channelPan', id: 1, pan: -0.4 },
    { type: 'masterFx', chain: [{ effectId: 'limiter', params: {} }] },
    { type: 'masterGain', gain: 0.9 },
    {
      type: 'events',
      events: [
        { time: 100.4 / SR, kind: EventKind.NoteOn, target: 0, a: 60, b: 261.63, c: 0.9 },
        { time: 300.7 / SR, kind: EventKind.NoteOn, target: 1, a: 67, b: 392.0, c: 0.7 },
        { time: 900.2 / SR, kind: EventKind.NoteOn, target: 0, a: 64, b: 329.63, c: 0.8 },
        { time: 2600.5 / SR, kind: EventKind.NoteOff, target: 0, a: 60, b: 0, c: 0 },
        { time: 4100.9 / SR, kind: EventKind.NoteOff, target: 1, a: 67, b: 0, c: 0 },
      ],
    },
  ];
}

describe('the shipped worklet bundle against the offline renderer', () => {
  const BLOCKS = 96;

  it('registers under the name the facade asks the context for', () => {
    /* KERNEL_PROCESSOR_NAME in kernel/node.ts and the string inside the
     * bundle are written in two files and agree only by hand. If they ever
     * stop agreeing, addModule succeeds and the node constructor throws at
     * runtime, with nothing having failed to build. */
    const w = loadWorklet();
    expect(w.registeredAs).toBe(KERNEL_PROCESSOR_NAME);
  });

  it('renders bit-identical audio to renderOffline over the same messages', () => {
    const w = loadWorklet();
    for (const m of setupMessages()) w.send(m);
    const live = w.render(BLOCKS);
    expect(w.errors).toEqual([]);

    const off = renderOffline(setupMessages(), {
      seconds: (BLOCKS * BLOCK) / SR,
      sampleRate: SR,
      kernel: { resolveBankEngine: bankEngineResolver },
    });

    expect(live.left.length).toBe(off.left.length);
    /* Bit identical, not close: both sides run the same classes over the
     * same doubles, so any difference is a wiring difference and there is
     * no rounding to hide behind. */
    let worst = 0;
    let at = -1;
    for (let i = 0; i < off.left.length; i++) {
      const d = Math.max(
        Math.abs(live.left[i] - off.left[i]),
        Math.abs(live.right[i] - off.right[i]),
      );
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    expect({ worst, at }).toEqual({ worst: 0, at: -1 });
  });

  it('makes sound, so the comparison above is not two silences', () => {
    const w = loadWorklet();
    for (const m of setupMessages()) w.send(m);
    const live = w.render(BLOCKS);
    let peak = 0;
    let energy = 0;
    for (let i = 0; i < live.left.length; i++) {
      expect(Number.isFinite(live.left[i])).toBe(true);
      const a = Math.abs(live.left[i]);
      if (a > peak) peak = a;
      energy += live.left[i] * live.left[i];
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(Math.sqrt(energy / live.left.length)).toBeGreaterThan(0.005);
  });

  it('reads the context clock live, on every block', () => {
    /*
     * currentFrame is a live property of AudioWorkletGlobalScope, and the
     * kernel's frame has to follow it. Freeze it and the kernel re-renders
     * the same block forever, which is what the first version of this
     * harness accidentally did.
     */
    const w = loadWorklet();
    w.send({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'clock' });
    w.send({ type: 'channelGain', id: 0, gain: 1 });
    w.send({ type: 'masterGain', gain: 1 });
    w.render(8);
    const frames = w.meters.map((m) => m.frame);
    expect(frames).toEqual([BLOCK * 8]);
  });

  it('places an event by context time, wherever the node was created', () => {
    /*
     * setFrame is the one wiring difference that can move a note. An event
     * stamped in context time has to land on the same sample whether the
     * node was created at frame zero or a minute into the context's life.
     */
    const run = (startFrame: number): number => {
      const w = loadWorklet(SR, startFrame);
      w.send({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'clock' });
      w.send({ type: 'channelGain', id: 0, gain: 1 });
      w.send({ type: 'masterGain', gain: 1 });
      w.send({
        type: 'events',
        events: [
          { time: (startFrame + 300) / SR, kind: EventKind.NoteOn, target: 0, a: 60, b: 440, c: 1 },
        ],
      });
      return firstNonZero(w.render(8).left);
    };
    expect(run(0)).toBe(300);
    expect(run(128 * 1000)).toBe(300);
    expect(run(44100 * 60 + 77)).toBe(300);
  });

  it('reports a kernel error through the port instead of throwing', () => {
    /* There is no console in AudioWorkletGlobalScope on every engine, so a
     * bad message has to come back over the port. If it threw instead it
     * would take out onmessage and the node would go deaf silently. */
    const w = loadWorklet();
    expect(() =>
      w.send({ type: 'createChannel', id: 0, engineId: 'no-such-engine', params: {}, seed: 'x' }),
    ).not.toThrow();
    expect(w.errors.length).toBe(1);
    expect(w.errors[0]).toMatch(/no-such-engine/);
  });

  it('posts a meter every eight blocks and no more often', () => {
    const w = loadWorklet();
    w.send({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'm' });
    w.send({ type: 'masterGain', gain: 1 });
    w.render(24);
    expect(w.meters.length).toBe(3);
    expect(w.meters[0]).toMatchObject({ type: 'meter' });
  });

  it('survives a mono output, which is what a mono destination gives it', () => {
    /* out[1] is undefined on a mono context and the entry falls back to
     * out[0]. Writing the right channel into a missing array would throw
     * inside process(), which kills the node for the life of the page. */
    const w = loadWorklet();
    w.send({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'mono' });
    w.send({ type: 'channelGain', id: 0, gain: 1 });
    w.send({ type: 'masterGain', gain: 1 });
    w.send({
      type: 'events',
      events: [{ time: 10 / SR, kind: EventKind.NoteOn, target: 0, a: 60, b: 440, c: 1 }],
    });
    const mono = new Float32Array(BLOCK);
    expect(() => w.processInto([[mono]])).not.toThrow();
    expect(firstNonZero(mono)).toBe(10);
  });

  it('does not throw when handed no output at all', () => {
    /* outputs[0] can be an empty array while a node is disconnected. The
     * entry returns true early; if it did not, one disconnect would end
     * playback permanently. */
    const w = loadWorklet();
    w.send({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'none' });
    expect(() => w.processInto([[]])).not.toThrow();
    expect(w.processInto([[]])).toBe(true);
  });
});
