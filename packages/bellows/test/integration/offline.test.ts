import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltins } from '../../src/core/register';
import { listEngines, listEffects } from '../../src/core/registry';
import { renderOffline } from '../../src/render/offline';
import { bankEngineResolver } from '../../src/render/banks';
import { EventKind } from '../../src/types';
import type { KernelMessage, SamplerZoneData } from '../../src/kernel/messages';

beforeAll(() => registerBuiltins());

function stats(x: Float32Array) {
  let peak = 0;
  let sum = 0;
  let nan = false;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (Number.isNaN(v) || !Number.isFinite(v)) nan = true;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / x.length), nan };
}

function renderNote(engineId: string, params: Record<string, number> = {}) {
  const setup: KernelMessage[] = [
    { type: 'createChannel', id: 0, engineId, params, seed: 'itest' },
    { type: 'channelGain', id: 0, gain: 0.8 },
    { type: 'masterGain', gain: 1 },
    {
      type: 'events',
      events: [
        { time: 0.01, kind: EventKind.NoteOn, target: 0, a: 1, b: 220, c: 0.9 },
        { time: 0.35, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
      ],
    },
  ];
  return renderOffline(setup, { seconds: 0.7, sampleRate: 44100, kernel: { resolveBankEngine: bankEngineResolver } });
}

describe('offline integration: every registered engine makes sound', () => {
  it('has the full engine roster', () => {
    const ids = listEngines().map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        'va', 'fm', 'additive', 'wavetable', 'kick', 'snare', 'hat', 'clap', 'tom',
        'noise', 'pluck', 'string', 'tube', 'modal', 'westcoast', 'formant',
        'granular', 'harmonic',
      ].sort(),
    );
  });

  for (const id of [
    'va', 'fm', 'additive', 'wavetable', 'kick', 'snare', 'hat', 'clap', 'tom',
    'noise', 'pluck', 'string', 'tube', 'modal', 'westcoast', 'formant',
    'granular', 'harmonic',
  ]) {
    it(`${id} produces bounded, non-silent, deterministic audio`, () => {
      const a = renderNote(id);
      const b = renderNote(id);
      const sa = stats(a.left);
      expect(sa.nan).toBe(false);
      expect(sa.peak).toBeGreaterThan(0.001);
      expect(sa.peak).toBeLessThan(4);
      expect(a.left).toEqual(b.left);
      expect(a.right).toEqual(b.right);
    });
  }
});

describe('offline integration: every registered effect passes audio', () => {
  it('runs each effect on a va note without NaN or silence collapse', () => {
    for (const def of listEffects()) {
      const setup: KernelMessage[] = [
        { type: 'createChannel', id: 0, engineId: 'va', params: {}, seed: 'fx' },
        { type: 'channelGain', id: 0, gain: 0.8 },
        { type: 'channelFx', id: 0, chain: [{ effectId: def.id }] },
        { type: 'masterGain', gain: 1 },
        {
          type: 'events',
          events: [
            { time: 0.01, kind: EventKind.NoteOn, target: 0, a: 1, b: 220, c: 0.9 },
            { time: 0.3, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
          ],
        },
      ];
      const out = renderOffline(setup, { seconds: 0.8, sampleRate: 44100 });
      const s = stats(out.left);
      expect(s.nan, def.id + ' produced NaN').toBe(false);
      expect(s.peak, def.id + ' silent').toBeGreaterThan(1e-4);
      expect(s.peak, def.id + ' blew up').toBeLessThan(8);
    }
  });
});

describe('offline integration: sampler bank via resolver', () => {
  it('plays a registered bank zone at pitch', () => {
    const sr = 44100;
    const data = new Float32Array(sr);
    for (let i = 0; i < sr; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
    const zone: SamplerZoneData = {
      data, sampleRate: sr, rootKey: 69, keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, loopMode: 'none',
    };
    const setup: KernelMessage[] = [
      { type: 'registerBank', bankId: 'tb', zones: [zone] },
      { type: 'createChannel', id: 0, engineId: 'sampler:tb', params: {}, seed: 's' },
      { type: 'channelGain', id: 0, gain: 1 },
      { type: 'masterGain', gain: 1 },
      {
        type: 'events',
        events: [
          { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
          { time: 0.4, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
        ],
      },
    ];
    const out = renderOffline(setup, { seconds: 0.5, sampleRate: sr, kernel: { resolveBankEngine: bankEngineResolver } });
    const s = stats(out.left);
    expect(s.nan).toBe(false);
    expect(s.peak).toBeGreaterThan(0.1);
    // zero crossing rate of a 440 sine is 880 crossings per second
    let crossings = 0;
    const from = 2205; // 50 ms in, well after attack
    const to = 15435; // 350 ms, before the note off at 400 ms
    for (let i = from + 1; i < to; i++) {
      if ((out.left[i] >= 0) !== (out.left[i - 1] >= 0)) crossings++;
    }
    const hz = (crossings / 2) * (sr / (to - from));
    expect(Math.abs(hz - 440) / 440).toBeLessThan(0.02);
  });
});
