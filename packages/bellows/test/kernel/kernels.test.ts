/*
 * Kernels other than KernelEngine (src/kernel/kernels.ts): a plugin registers one by name, and the
 * worklet processor, renderOffline and the facade build that one in its place.
 *
 * The kernel used here is KernelEngine with its output halved, so a render says which kernel made
 * it: the same score through the named kernel is the KernelEngine render times 0.5, sample for
 * sample (halving a float is exact).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Bellows } from '../../src/bellows';
import { registerBuiltins } from '../../src/register';
import { getEngine, registerEngine } from '../../src/core/registry';
import { renderOffline } from '../../src/render/offline';
import { renderWorkletInProcess } from '../../src/kernel/offline-context';
import { KernelEngine } from '../../src/kernel/engine';
import { createKernel, hasKernel, kernelEnv, registerKernel, type KernelLike } from '../../src/kernel/kernels';
import { EventKind } from '../../src/types';
import type { KernelMessage } from '../../src/kernel/messages';
import type { BellowsPlugin } from '../../src/kernel/plugin';
import { FakeAudioContext, FakeWorkletNode, installFakeAudio } from '../integration/fake-context';

beforeAll(() => registerBuiltins());

function halfFactory(sr: number, opts: object): KernelLike {
  const inner = createKernel(undefined, sr, opts);
  return {
    get sampleRate() {
      return inner.sampleRate;
    },
    get blockSize() {
      return inner.blockSize;
    },
    get currentFrame() {
      return inner.currentFrame;
    },
    get currentTime() {
      return inner.currentTime;
    },
    get voiceCount() {
      return inner.voiceCount;
    },
    get peakL() {
      return inner.peakL;
    },
    get peakR() {
      return inner.peakR;
    },
    get rmsL() {
      return inner.rmsL;
    },
    get rmsR() {
      return inner.rmsR;
    },
    setFrame: (f) => inner.setFrame(f),
    apply: (m) => inner.apply(m),
    process(l, r) {
      inner.process(l, r);
      for (let i = 0; i < l.length; i++) {
        l[i] *= 0.5;
        r[i] *= 0.5;
      }
    },
  };
}

const score: KernelMessage[] = [
  { type: 'createChannel', id: 1, engineId: 'va', params: { cutoff: 1200 }, seed: 'k' },
  { type: 'channelFx', id: 1, chain: [{ effectId: 'delay', params: { mix: 0.4 } }] },
  {
    type: 'events',
    events: [
      { time: 0.01, kind: EventKind.NoteOn, target: 1, a: 1, b: 220, c: 0.8 },
      { time: 0.2, kind: EventKind.NoteOff, target: 1, a: 1, b: 0, c: 0 },
    ],
  },
];

function halves(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (b[i] !== a[i] * 0.5) return false;
  return true;
}

describe('named kernels', () => {
  it('render in place of KernelEngine through renderOffline', () => {
    registerKernel('test-half', halfFactory);
    expect(hasKernel('test-half')).toBe(true);
    const ts = renderOffline(score, { seconds: 0.3, sampleRate: 44100 });
    const half = renderOffline(score, { seconds: 0.3, sampleRate: 44100, kernelName: 'test-half' });
    expect(Math.max(...ts.left.map(Math.abs))).toBeGreaterThan(0.01);
    expect(halves(ts.left, half.left)).toBe(true);
    expect(halves(ts.right, half.right)).toBe(true);
  });

  it('refuse a name nobody registered, rather than rendering with another kernel', () => {
    expect(() => renderOffline(score, { seconds: 0.1, kernelName: 'no-such-kernel' })).toThrow(/no kernel named "no-such-kernel"/);
    expect(createKernel(undefined, 48000)).toBeInstanceOf(KernelEngine);
  });

  it('are registered by a plugin in the worklet and built by the processor it names', () => {
    // a stub that ignores the score and marks its output, and checks the env the processor gave it
    const plugin: BellowsPlugin = {
      id: 'test-mark-kernel',
      kernel: 'worklet-mark',
      worklet: `globalThis.bellowsKernel.registerKernel('worklet-mark', function (sr, o, env) {
        const ok = ['getEngine', 'getEffect', 'builtinEngine', 'builtinEffect', 'rng', 'paramName', 'internParamAt']
          .every(function (k) { return typeof env[k] === 'function'; }) && typeof env.VoicePool === 'function'
          && env.builtinEngine('va') === env.getEngine('va');
        return { sampleRate: sr, blockSize: 128, currentFrame: 0, currentTime: 0, voiceCount: 0, peakL: 0, peakR: 0, rmsL: 0, rmsR: 0,
          setFrame: function () {}, apply: function () {},
          process: function (l, r) { l.fill(ok ? 0.25 : 1); r.fill(ok ? -0.25 : 1); } };
      });`,
    };
    const frames = 1024;
    const marked = renderWorkletInProcess(score, { frames, sampleRate: 44100, plugins: [plugin], kernel: 'worklet-mark' });
    expect(marked.left.every((x) => x === 0.25)).toBe(true);
    expect(marked.right.every((x) => x === -0.25)).toBe(true);
    // the same scope without the name renders with KernelEngine
    const ts = renderWorkletInProcess(score, { frames, sampleRate: 44100, plugins: [plugin] });
    expect(ts.left.every((x) => x === 0.25)).toBe(false);
  });

  it('fall back to KernelEngine in the processor when the name is missing, and say so', () => {
    const frames = 4096;
    expect(() => renderWorkletInProcess(score, { frames, sampleRate: 44100, kernel: 'never-registered' })).toThrow(
      /no kernel named "never-registered".*rendering with the TypeScript kernel/,
    );
  });

  it('get an env that tells a builtin def from a replacement under the same id', () => {
    const va = getEngine('va');
    expect(kernelEnv.builtinEngine('va')).toBe(va);
    const copy = { ...va };
    registerEngine(copy);
    try {
      expect(kernelEnv.getEngine('va')).toBe(copy);
      expect(kernelEnv.builtinEngine('va')).toBe(va);
    } finally {
      registerEngine(va);
    }
    expect(kernelEnv.builtinEffect('plate')).toBeDefined();
    expect(kernelEnv.builtinEngine('no-such-engine')).toBeUndefined();
  });
});

describe('the facade', () => {
  const made: Array<{ opts?: { processorOptions?: { kernel?: string } } }> = [];
  class RecordingNode extends FakeWorkletNode {
    constructor(ctx: unknown, name: string, opts?: { processorOptions?: { kernel?: string } }) {
      super(ctx, name, opts);
      made.push({ opts });
    }
  }
  class Ctx extends FakeAudioContext {
    override audioWorklet = { addModule: async (): Promise<void> => {} };
  }
  const live: Bellows[] = [];
  beforeEach(() => {
    installFakeAudio(Ctx);
    (globalThis as Record<string, unknown>).AudioWorkletNode = RecordingNode;
    made.length = 0;
  });
  afterEach(() => {
    for (const b of live.splice(0)) b.dispose();
  });
  const boot = async (plugins?: BellowsPlugin[]) => {
    const b = await Bellows.boot({ seed: 'k', workletUrl: 'fake://worklet', context: new Ctx() as unknown as AudioContext, plugins });
    live.push(b);
    return b;
  };
  const kernelPlugin: BellowsPlugin = { id: 'kernel-plugin', kernel: 'some-kernel', worklet: '' };

  it('builds the processor with the kernel a boot plugin brings', async () => {
    await boot([kernelPlugin]);
    expect(made[0].opts?.processorOptions?.kernel).toBe('some-kernel');
  });

  it('builds it with KernelEngine otherwise', async () => {
    await boot();
    expect(made[0].opts?.processorOptions?.kernel).toBeUndefined();
  });

  it('refuses a kernel plugin after boot, since the processor already chose', async () => {
    const b = await boot();
    await expect(b.use(kernelPlugin)).rejects.toThrow(/brings its own kernel/);
  });
});
