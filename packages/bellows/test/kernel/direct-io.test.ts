import { describe, it, expect, beforeAll } from 'vitest';
import { KernelEngine, type KernelIO } from '../../src/kernel/engine';
import { SetupLog } from '../../src/kernel/setuplog';
import { registerEngine, registerEffect } from '../../src/core/registry';
import { EventKind } from '../../src/types';
import type { EngineDef, EffectDef, Voice } from '../../src/types';

/* A constant DC voice while held, as in engine.test.ts, under its own id. */
const dc: EngineDef = {
  id: 'dio-dc',
  label: 'dc',
  params: [{ name: 'amp', min: 0, max: 1, default: 0.5 }],
  polyphony: 4,
  createVoice(_sr, params): Voice {
    let on = false;
    const amp = params.amp ?? 0.5;
    return {
      noteOn() { on = true; },
      noteOff() { on = false; },
      setParam() {},
      get active() { return on; },
      process(l, r, from, to) {
        for (let i = from; i < to; i++) { l[i] += amp; r[i] += amp; }
      },
    };
  },
};

const halver: EffectDef = {
  id: 'dio-halver',
  label: 'halver',
  params: [],
  create() {
    return {
      process(l, r, from, to) { for (let i = from; i < to; i++) { l[i] *= 0.5; r[i] *= 0.5; } },
      setParam() {},
      reset() {},
    };
  },
};

beforeAll(() => {
  registerEngine(dc);
  registerEffect(halver);
});

const N = 128;
const pair = (): Float32Array[] => [new Float32Array(N), new Float32Array(N)];

/** Two held DC channels: 0 at amp 0.25, 1 at amp 0.5, unity gains everywhere. */
function boot(): KernelEngine {
  const k = new KernelEngine(48000);
  k.apply({ type: 'createChannel', id: 0, engineId: 'dio-dc', params: { amp: 0.25 }, seed: 'a' });
  k.apply({ type: 'createChannel', id: 1, engineId: 'dio-dc', params: { amp: 0.5 }, seed: 'b' });
  for (const id of [0, 1]) {
    k.apply({ type: 'channelGain', id, gain: 1 });
    k.apply({ type: 'events', events: [{ time: 0, kind: EventKind.NoteOn, target: id, a: id + 1, b: 440, c: 1 }] });
  }
  k.apply({ type: 'masterGain', gain: 1 });
  return k;
}

describe('direct outputs', () => {
  it('without io (offline render, older processor) a routed channel stays in the master', () => {
    const plain = boot();
    const routed = boot();
    routed.apply({ type: 'channelOutput', id: 1, output: 1 });
    const a = pair();
    const b = pair();
    plain.process(a[0], a[1]);
    routed.process(b[0], b[1]);
    expect(Array.from(b[0])).toEqual(Array.from(a[0]));
    expect(a[0][N - 1]).toBeCloseTo(0.75);
  });

  it('passing io with nothing routed renders the master exactly as without it', () => {
    const plain = boot();
    const withIo = boot();
    const a = pair();
    const b = pair();
    plain.process(a[0], a[1]);
    withIo.process(b[0], b[1], { outputs: [b, pair(), pair()] });
    expect(Array.from(b[0])).toEqual(Array.from(a[0]));
    expect(Array.from(b[1])).toEqual(Array.from(a[1]));
  });

  it('a routed channel leaves the master and plays out of its output, after inserts', () => {
    const k = boot();
    k.apply({ type: 'channelFx', id: 1, chain: [{ effectId: 'dio-halver' }] });
    k.apply({ type: 'channelOutput', id: 1, output: 2 });
    const master = pair();
    const out1 = pair();
    const out2 = pair();
    out1[0].fill(9); // stale data from the last block must be cleared
    k.process(master[0], master[1], { outputs: [master, out1, out2] });
    expect(master[0][N - 1]).toBeCloseTo(0.25);
    expect(out2[0][N - 1]).toBeCloseTo(0.25);
    expect(out2[1][N - 1]).toBeCloseTo(0.25);
    expect(out1[0].every((v) => v === 0)).toBe(true);
  });

  it('route(0) brings it back; an output the host did not provide falls back to the master', () => {
    const k = boot();
    k.apply({ type: 'channelOutput', id: 1, output: 5 });
    const master = pair();
    k.process(master[0], master[1], { outputs: [master, pair()] });
    expect(master[0][N - 1]).toBeCloseTo(0.75);
    k.apply({ type: 'channelOutput', id: 1, output: 1 });
    k.apply({ type: 'channelOutput', id: 1, output: 0 });
    const m2 = pair();
    const o1 = pair();
    k.process(m2[0], m2[1], { outputs: [m2, o1] });
    expect(m2[0][N - 1]).toBeCloseTo(0.75);
    expect(o1[0][N - 1]).toBe(0);
  });

  it('sends from a routed channel still reach their bus, whose return stays in the master', () => {
    const k = boot();
    k.apply({ type: 'createBus', id: 7, chain: [], returnLevel: 1 });
    k.apply({ type: 'send', channelId: 1, busId: 7, level: 1 });
    k.apply({ type: 'channelOutput', id: 1, output: 1 });
    const master = pair();
    const o1 = pair();
    k.process(master[0], master[1], { outputs: [master, o1] });
    expect(o1[0][N - 1]).toBeCloseTo(0.5);
    expect(master[0][N - 1]).toBeCloseTo(0.25 + 0.5);
  });
});

describe('direct inputs', () => {
  function inputKernel(): KernelEngine {
    const k = new KernelEngine(48000);
    k.apply({ type: 'createInputChannel', id: 3, input: 1 });
    k.apply({ type: 'channelGain', id: 3, gain: 1 });
    k.apply({ type: 'masterGain', gain: 1 });
    return k;
  }

  it('an input channel plays its input through its inserts into the master', () => {
    const k = inputKernel();
    k.apply({ type: 'channelFx', id: 3, chain: [{ effectId: 'dio-halver' }] });
    const inL = new Float32Array(N).map((_, i) => i / N);
    const inR = new Float32Array(N).fill(-0.5);
    const master = pair();
    k.process(master[0], master[1], { inputs: [[inL, inR]] });
    expect(master[0][N - 1]).toBeCloseTo(((N - 1) / N) * 0.5);
    expect(master[1][N - 1]).toBeCloseTo(-0.25);
  });

  it('routes to a direct output, feeds a mono input to both sides, and is silent unconnected', () => {
    const k = inputKernel();
    k.apply({ type: 'channelOutput', id: 3, output: 1 });
    const mono = new Float32Array(N).fill(0.3);
    const master = pair();
    const o1 = pair();
    const io: KernelIO = { inputs: [[mono]], outputs: [master, o1] };
    k.process(master[0], master[1], io);
    expect(o1[0][N - 1]).toBeCloseTo(0.3);
    expect(o1[1][N - 1]).toBeCloseTo(0.3);
    expect(master[0][N - 1]).toBe(0);
    const m2 = pair();
    const o2 = pair();
    k.process(m2[0], m2[1], { inputs: [[]], outputs: [m2, o2] });
    expect(o2[0].every((v) => v === 0)).toBe(true);
    const m3 = pair();
    k.process(m3[0], m3[1]); // offline: nothing feeds it
    expect(m3[0].every((v) => v === 0)).toBe(true);
  });

  it('notes, params and panic on an input channel do nothing and do not throw', () => {
    const k = inputKernel();
    k.apply({ type: 'events', events: [{ time: 0, kind: EventKind.NoteOn, target: 3, a: 1, b: 440, c: 1 }] });
    k.apply({ type: 'channelParam', id: 3, name: 'cutoff', value: 100 });
    k.apply({ type: 'panic' });
    const master = pair();
    k.process(master[0], master[1], { inputs: [[new Float32Array(N).fill(0.2)]] });
    expect(master[0][N - 1]).toBeCloseTo(0.2);
    expect(k.voiceCount).toBe(0);
  });

  it('ignores an input index below 1', () => {
    const k = new KernelEngine(48000);
    k.apply({ type: 'createInputChannel', id: 4, input: 0 });
    const master = pair();
    k.process(master[0], master[1], { inputs: [[new Float32Array(N).fill(1)]] });
    expect(master[0].every((v) => v === 0)).toBe(true);
  });
});

describe('setup log', () => {
  it('collapses repeated routes and forgets an input channel with everything posted for it', () => {
    const log = new SetupLog();
    log.record({ type: 'createInputChannel', id: 2, input: 1 });
    log.record({ type: 'channelOutput', id: 2, output: 1 });
    log.record({ type: 'channelFx', id: 2, chain: [] });
    log.record({ type: 'channelOutput', id: 2, output: 0 });
    expect(log.size).toBe(3);
    expect(log.messages[1]).toEqual({ type: 'channelOutput', id: 2, output: 0 });
    log.forgetChannel(2);
    expect(log.size).toBe(0);
  });
});
