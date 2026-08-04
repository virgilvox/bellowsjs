/*
 * Channel lifecycle and setup recording. Bellows.boot needs an AudioContext,
 * so the facade runs here against a minimal fake: enough surface for the
 * analyser wiring and the worklet node, with every posted kernel message
 * captured so the tests can read what the kernel would have received. The
 * offline render path is the real one, so audio comparisons are real.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Bellows } from '../../src/bellows';
import { SetupLog } from '../../src/kernel/setuplog';
import { registerBuiltins } from '../../src/core/register';
import type { KernelMessage } from '../../src/kernel/messages';

/* ------------------------------------------------------------ */
/* fake audio context                                            */
/* ------------------------------------------------------------ */

const posted: KernelMessage[] = [];

class FakeParam {
  value = 0;
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(msg: KernelMessage): void {
    posted.push(msg);
  }
}

class FakeWorkletNode extends FakeNode {
  port = new FakePort();
  parameters = new Map<string, FakeParam>();
  constructor(_ctx: unknown, _name: string, _opts?: unknown) {
    super();
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  closed = false;
  destination = new FakeNode();
  audioWorklet = { addModule: async () => {} };
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser();
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

const live: Bellows[] = [];

async function boot(
  opts: { context?: FakeAudioContext; closeContextOnDispose?: boolean } = {},
): Promise<Bellows> {
  const b = await Bellows.boot({
    seed: 'lifecycle',
    workletUrl: 'fake://worklet',
    context: opts.context as unknown as AudioContext,
    closeContextOnDispose: opts.closeContextOnDispose,
  });
  live.push(b);
  return b;
}

function ofType(type: string): KernelMessage[] {
  return posted.filter((m) => m.type === type);
}

beforeAll(() => {
  registerBuiltins();
  (globalThis as Record<string, unknown>).AudioWorkletNode = FakeWorkletNode;
  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
});

afterEach(() => {
  for (const b of live.splice(0)) b.dispose();
  posted.length = 0;
});

/* ------------------------------------------------------------ */
/* the pure log                                                  */
/* ------------------------------------------------------------ */

describe('setup log', () => {
  it('collapses repeated setters in place, keeping the last value', () => {
    const log = new SetupLog();
    log.record({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 's' });
    log.record({ type: 'channelGain', id: 0, gain: 0.1 });
    log.record({ type: 'channelPan', id: 0, pan: -0.5 });
    for (let i = 0; i < 100; i++) log.record({ type: 'channelGain', id: 0, gain: i / 100 });
    expect(log.size).toBe(3);
    expect(log.messages[1]).toEqual({ type: 'channelGain', id: 0, gain: 0.99 });
    // position held: the pan set after the first gain is still last
    expect(log.messages[2].type).toBe('channelPan');
  });

  it('keys collapse by identity, not just by message type', () => {
    const log = new SetupLog();
    log.record({ type: 'channelParam', id: 0, name: 'cutoff', value: 1 });
    log.record({ type: 'channelParam', id: 0, name: 'resonance', value: 1 });
    log.record({ type: 'channelParam', id: 1, name: 'cutoff', value: 1 });
    log.record({ type: 'fxParam', channelId: 0, fxIndex: 0, name: 'mix', value: 1 });
    log.record({ type: 'fxParam', channelId: 0, fxIndex: 1, name: 'mix', value: 1 });
    log.record({ type: 'send', channelId: 0, busId: 1, level: 1 });
    log.record({ type: 'send', channelId: 0, busId: 2, level: 1 });
    expect(log.size).toBe(7);
    log.record({ type: 'channelParam', id: 1, name: 'cutoff', value: 9 });
    log.record({ type: 'send', channelId: 0, busId: 2, level: 9 });
    expect(log.size).toBe(7);
  });

  it('always appends creation, registration and definition messages', () => {
    const log = new SetupLog();
    log.record({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'a' });
    log.record({ type: 'createChannel', id: 1, engineId: 'va', params: {}, seed: 'b' });
    log.record({ type: 'createBus', id: 1, chain: [], returnLevel: 1 });
    log.record({ type: 'internParam', name: 'cutoff', index: 3 });
    log.record({ type: 'internParam', name: 'cutoff', index: 3 });
    log.record({ type: 'defOp', kind: 'engine', code: 'x' });
    log.record({ type: 'defOp', kind: 'engine', code: 'x' });
    expect(log.size).toBe(7);
  });

  it('forgets a channel and everything posted for it', () => {
    const log = new SetupLog();
    log.record({ type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'a' });
    log.record({ type: 'createChannel', id: 1, engineId: 'fm', params: {}, seed: 'b' });
    log.record({ type: 'channelGain', id: 0, gain: 0.5 });
    log.record({ type: 'channelGain', id: 1, gain: 0.5 });
    log.record({ type: 'send', channelId: 0, busId: 1, level: 0.2 });
    log.record({ type: 'masterGain', gain: 0.9 });
    log.forgetChannel(0);
    expect(log.messages.map((m) => m.type)).toEqual(['createChannel', 'channelGain', 'masterGain']);
    expect((log.messages[0] as { id: number }).id).toBe(1);
    // the surviving channel still collapses after the positions shifted
    log.record({ type: 'channelGain', id: 1, gain: 0.25 });
    expect(log.size).toBe(3);
    expect(log.messages[1]).toEqual({ type: 'channelGain', id: 1, gain: 0.25 });
  });

  it('ignores a channel it never recorded', () => {
    const log = new SetupLog();
    log.record({ type: 'masterGain', gain: 1 });
    log.forgetChannel(7);
    expect(log.size).toBe(1);
  });
});

/* ------------------------------------------------------------ */
/* the facade                                                    */
/* ------------------------------------------------------------ */

describe('instrument dispose', () => {
  it('posts removeChannel and prunes the setup stream', async () => {
    const b = await boot({ context: new FakeAudioContext() });
    const a = b.voice('va');
    const c = b.voice('fm');
    a.gain(0.5).pan(-0.2).param('cutoff', 900);
    c.gain(0.4);
    const before = b.setupSize;
    a.dispose();
    expect(ofType('removeChannel')).toEqual([{ type: 'removeChannel', id: a.channel }]);
    // createChannel, gain, pan, channelParam gone; the interned param name stays
    expect(b.setupSize).toBe(before - 4);
  });

  it('is idempotent', async () => {
    const b = await boot({ context: new FakeAudioContext() });
    const a = b.voice('va');
    a.dispose();
    const size = b.setupSize;
    a.dispose();
    a.dispose();
    expect(ofType('removeChannel').length).toBe(1);
    expect(b.setupSize).toBe(size);
  });

  it('leaves a disposed handle inert instead of throwing', async () => {
    const b = await boot({ context: new FakeAudioContext() });
    const a = b.voice('va');
    a.dispose();
    const after = posted.length;
    const size = b.setupSize;
    expect(a.disposed).toBe(true);
    expect(() => {
      a.note('C4');
      a.chord(['C4', 'E4']);
      a.param('cutoff', 500);
      a.rampParam('cutoff', 500, '4n');
      a.gain(0.2);
      a.pan(0.2);
      a.fx('saturator');
      a.fxParam(0, 'drive', 2);
      a.allOff();
      a.off(1);
    }).not.toThrow();
    expect(a.on('C4')).toBe(-1);
    expect(posted.length).toBe(after);
    expect(b.setupSize).toBe(size);
  });

  it('a disposed instrument does not come back in an offline render', async () => {
    const b = await boot({ context: new FakeAudioContext() });
    const keep = b.voice('va');
    const drop = b.voice('va');
    b.clock.at('4n', (t) => {
      keep.note('C3', { at: t, dur: '8n' });
      drop.note('C5', { at: t, dur: '8n' });
    });
    const both = await b.render({ beats: 2, sampleRate: 22050 });
    drop.dispose();
    const one = await b.render({ beats: 2, sampleRate: 22050 });
    expect(peak(one.left)).toBeGreaterThan(0);
    expect(peak(one.left)).toBeLessThan(peak(both.left));
  });
});

describe('setup growth', () => {
  it('stays flat under repeated param, gain and fxParam calls', async () => {
    const b = await boot({ context: new FakeAudioContext() });
    const inst = b.voice('va');
    inst.fx('saturator');
    inst.param('cutoff', 400);
    inst.gain(0.5);
    inst.pan(0);
    inst.fxParam(0, 'drive', 1);
    b.masterGain(0.9);
    const size = b.setupSize;
    for (let i = 0; i < 500; i++) {
      inst.param('cutoff', 400 + i);
      inst.gain(0.5);
      inst.pan(i / 1000);
      inst.fxParam(0, 'drive', 1 + i / 100);
      b.masterGain(0.9);
    }
    expect(b.setupSize).toBe(size);
  });

  it('keeps the last value written', async () => {
    const b = await boot({ context: new FakeAudioContext() });
    const inst = b.voice('va');
    b.clock.at('4n', (t) => inst.note('C3', { at: t, dur: '8n' }));
    inst.gain(1);
    const loud = await b.render({ beats: 2, sampleRate: 22050 });
    inst.gain(0.9);
    inst.gain(0.25);
    const quiet = await b.render({ beats: 2, sampleRate: 22050 });
    expect(peak(quiet.left)).toBeCloseTo(peak(loud.left) * 0.25, 3);
  });

  it('renders the same audio after repeated setters collapse', async () => {
    const b = await boot({ context: new FakeAudioContext() });
    const inst = b.voice('va');
    inst.fx('saturator');
    inst.gain(0.6);
    inst.pan(0.1);
    inst.param('cutoff', 800);
    inst.fxParam(0, 'drive', 1.5);
    b.clock.at('4n', (t) => inst.note('A3', { at: t, dur: '8n' }));
    const before = await b.render({ beats: 2, sampleRate: 22050 });
    const size = b.setupSize;
    for (let i = 0; i < 200; i++) {
      inst.gain(0.6);
      inst.pan(0.1);
      inst.param('cutoff', 800);
      inst.fxParam(0, 'drive', 1.5);
    }
    expect(b.setupSize).toBe(size);
    const after = await b.render({ beats: 2, sampleRate: 22050 });
    expect(Array.from(after.left)).toEqual(Array.from(before.left));
    expect(Array.from(after.right)).toEqual(Array.from(before.right));
  });
});

describe('bellows dispose', () => {
  it('closes a context it created', async () => {
    const b = await boot();
    const ctx = b.ctx as unknown as FakeAudioContext;
    expect(ctx.closed).toBe(false);
    b.dispose();
    expect(ctx.closed).toBe(true);
    expect(b.transport.state).toBe('stopped');
  });

  it('leaves a caller supplied context alone', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot({ context: ctx });
    b.dispose();
    expect(ctx.closed).toBe(false);
  });

  it('honors closeContextOnDispose false for a context it created', async () => {
    const b = await boot({ closeContextOnDispose: false });
    const ctx = b.ctx as unknown as FakeAudioContext;
    b.dispose();
    expect(ctx.closed).toBe(false);
  });
});

function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}
