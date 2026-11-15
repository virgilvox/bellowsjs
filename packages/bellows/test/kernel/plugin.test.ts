/*
 * Plugins (kernel/plugin.ts) and the host API a plugin drives channels through (Bellows.paramIndex,
 * postKernelEvents, reserveNoteIds, layNotes, contextState, onUntimedParam). The plugin here is a
 * one-oscillator engine written as the self-contained script a plugin ships, registering through
 * the hook the worklet entry leaves on the global scope.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bellows } from '../../src/bellows';
import { listEngines } from '../../src/core/catalog';
import { registerEngine } from '../../src/core/registry';
import { renderOffline } from '../../src/render/offline';
import { EventKind, type EngineDef } from '../../src/types';
import type { BellowsPlugin } from '../../src/kernel/plugin';
import { FakeAudioContext, installFakeAudio } from '../integration/fake-context';

/* A sine with a short decay, as an object literal both sides can build. */
const BEEP_SOURCE = `{
  id: 'test-beep',
  label: 'Test beep',
  params: [{ name: 'level', min: 0, max: 1, default: 0.5 }],
  polyphony: 2,
  createVoice(sr, params) {
    let phase = 0, inc = 0, amp = 0, level = params.level ?? 0.5, on = false;
    return {
      get active() { return on || amp > 1e-4; },
      noteOn(f, v) { inc = f / sr; amp = v; on = true; phase = 0; },
      noteOff() { on = false; },
      setParam(n, v) { if (n === 'level') level = v; },
      process(l, r, from, to) {
        for (let i = from; i < to; i++) {
          const s = Math.sin(2 * Math.PI * phase) * amp * level;
          l[i] += s; r[i] += s;
          phase += inc; if (phase >= 1) phase -= 1;
          if (!on) amp *= 0.999;
        }
      },
    };
  },
}`;

const beepDef = (): EngineDef => new Function('return (' + BEEP_SOURCE + ')')() as EngineDef;

const beep: BellowsPlugin = {
  id: 'test-beep-plugin',
  worklet: `globalThis.bellowsKernel.registerEngine(${BEEP_SOURCE});`,
  engines: [{ id: 'test-beep', label: 'Test beep', params: [{ name: 'level', min: 0, max: 1, default: 0.5 }], polyphony: 2 }],
};

const live: Bellows[] = [];
let modules: string[] = [];

class RecordingContext extends FakeAudioContext {
  override audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      modules.push(url);
    },
  };
}

async function boot(plugins?: BellowsPlugin[]): Promise<Bellows> {
  const b = await Bellows.boot({
    seed: 'plugin',
    workletUrl: 'fake://worklet',
    context: new RecordingContext() as unknown as AudioContext,
    plugins,
  });
  live.push(b);
  return b;
}

beforeEach(() => {
  installFakeAudio(RecordingContext);
  modules = [];
});
afterEach(() => {
  for (const b of live.splice(0)) b.dispose();
});

describe('plugins', () => {
  it('load after the kernel module, once each, and join the catalog without their DSP', async () => {
    await boot([beep, beep]);
    expect(modules).toHaveLength(2);
    expect(modules[0]).toBe('fake://worklet');
    expect(modules[1]).toMatch(/^blob:/);
    const info = listEngines().find((e) => e.id === 'test-beep');
    expect(info).toEqual(beep.engines![0]);
  });

  it('can be added after boot, and adding one again does nothing', async () => {
    const b = await boot();
    await b.use(beep);
    await b.use(beep);
    expect(modules).toHaveLength(2);
  });

  it('serve a URL instead of a blob when given one', async () => {
    await boot([{ ...beep, id: 'beep-by-url', workletUrl: 'https://example.test/beep.js' }]);
    expect(modules[1]).toBe('https://example.test/beep.js');
  });

  it('render through the worklet on this thread exactly as renderOffline renders the def', async () => {
    const b = await boot([beep]);
    const inst = b.voice('test-beep', { level: 0.7 });
    b.clock.at('4n', (t, step) => {
      if (step < 3) inst.note(60 + step * 4, { at: t, dur: '8n' });
    });
    const out = await b.render({ seconds: 1.2, sampleRate: 48000 });
    let peak = 0;
    for (const v of out.left) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.1);

    registerEngine(beepDef());
    const t0 = 0;
    const ref = renderOffline(
      [
        { type: 'createChannel', id: 0, engineId: 'test-beep', params: { level: 0.7 }, seed: 'plugin::ch0' },
        {
          type: 'events',
          events: [0, 1, 2].flatMap((k) => {
            const at = t0 + k * 0.5;
            const hz = 440 * 2 ** ((60 + k * 4 - 69) / 12);
            return [
              { time: at, kind: EventKind.NoteOn, target: 0, a: k + 1, b: hz, c: 0.8 },
              { time: at + 0.25, kind: EventKind.NoteOff, target: 0, a: k + 1, b: 0, c: 0 },
            ];
          }),
        },
      ],
      { seconds: 1.2, sampleRate: 48000 },
    );
    let worst = 0;
    for (let i = 0; i < ref.left.length; i++) worst = Math.max(worst, Math.abs(ref.left[i] - out.left[i]));
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('the host API', () => {
  it('lays notes end to end through the tempo map, a null note a rest', async () => {
    const b = await boot();
    b.bpm(120);
    const laid = b.layNotes(
      [
        { note: 'A4', dur: '4n' },
        { note: null, dur: '4n' },
        { note: { hz: 300 }, dur: { seconds: 0.1 }, vel: 0.5 },
      ],
      1,
    );
    expect(laid).toHaveLength(2);
    expect(laid[0]).toEqual({ time: 1, dur: 0.5, hz: 440, vel: undefined });
    expect(laid[1].time).toBeCloseTo(2, 12);
    expect(laid[1]).toMatchObject({ dur: 0.1, hz: 300, vel: 0.5 });
  });

  it('reserves note ids that note() never reuses, and peeks with 0', async () => {
    const b = await boot();
    const first = b.reserveNoteIds(0);
    expect(b.reserveNoteIds(3)).toBe(first);
    expect(b.reserveNoteIds(0)).toBe(first + 3);
  });

  it('interns a param name once and posts timed kernel events', async () => {
    const b = await boot();
    const a = b.paramIndex('anything');
    expect(b.paramIndex('anything')).toBe(a);
    expect(() => b.postKernelEvents([{ time: 1, kind: EventKind.Param, target: 0, a, b: 1, c: 0 }])).not.toThrow();
  });

  it('keeps context state: live, and a render forks its own copy that leaves the live one alone', async () => {
    const b = await boot();
    expect(b.contextState<{ n: number }>('k')).toBeUndefined();
    const liveState = b.contextState('k', { make: () => ({ n: 1 }), fork: (s) => ({ n: s.n + 100 }) })!;
    liveState.n = 2;
    let seen: number | undefined;
    b.clock.at('4n', (_t, step) => {
      if (step !== 0) return;
      const s = b.contextState<{ n: number }>('k')!;
      seen = s.n;
      s.n = -1;
    });
    await b.render({ seconds: 0.5, sampleRate: 8000 });
    expect(seen).toBe(102);
    expect(b.contextState<{ n: number }>('k')!.n).toBe(2);
    expect(b.rendering).toBe(false);
  });

  it('tells a listener about untimed params on its channel only, and stops when removed', async () => {
    const b = await boot([beep]);
    const one = b.voice('test-beep');
    const two = b.voice('test-beep');
    const heard: string[] = [];
    const off = b.onUntimedParam(one.channel, (name, value) => heard.push(name + '=' + value));
    one.param('level', 0.3);
    one.param('level', 0.4, 2);
    two.param('level', 0.5);
    off();
    one.param('level', 0.6);
    expect(heard).toEqual(['level=0.3']);
  });
});
