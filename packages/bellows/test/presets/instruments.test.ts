import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltins } from '../../src/core/register';
import { getEngine } from '../../src/core/registry';
import { renderOffline } from '../../src/render/offline';
import { EventKind } from '../../src/types';
import {
  INSTRUMENT_PRESETS,
  getPreset,
  presetsByFamily,
  type InstrumentPreset,
} from '../../src/presets/instruments';
import type { KernelMessage } from '../../src/kernel/messages';

beforeAll(() => registerBuiltins());

const SR = 44100;
const NOTE_ON = 0.02;
const NOTE_OFF = 0.52;
const TOTAL = 0.9;

/** Families whose presets play a clear fundamental worth pitch-testing. */
const PITCHED_FAMILIES = new Set(['guitars', 'strings', 'keys', 'mallets']);

/** Presets whose spectra are inharmonic by design (bell, membrane, and
 * stretched-partial mode tables), where autocorrelation has no honest
 * fundamental to find. */
const INHARMONIC = new Set([
  'steel-drum',
  'woodblock',
  'tubular-bells',
  'timpani',
  'glockenspiel',
  'music-box',
]);

/** Family-appropriate test pitch: the preset's suggested octave applied
 * to A3, so bass presets render low and treble presets high. */
function testFreq(preset: InstrumentPreset): number {
  return 220 * Math.pow(2, preset.octave ?? 0);
}

function renderPreset(preset: InstrumentPreset) {
  const setup: KernelMessage[] = [
    {
      type: 'createChannel',
      id: 0,
      engineId: preset.engineId,
      params: { ...preset.params },
      seed: 'preset-test',
    },
    { type: 'channelGain', id: 0, gain: preset.gain ?? 0.8 },
    { type: 'masterGain', gain: 1 },
  ];
  if (preset.fx && preset.fx.length) {
    setup.push({
      type: 'channelFx',
      id: 0,
      chain: preset.fx.map((f) => ({ effectId: f.effectId, params: { ...(f.params ?? {}) } })),
    });
  }
  setup.push({
    type: 'events',
    events: [
      { time: NOTE_ON, kind: EventKind.NoteOn, target: 0, a: 1, b: testFreq(preset), c: 0.9 },
      { time: NOTE_OFF, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
    ],
  });
  return renderOffline(setup, { seconds: TOTAL, sampleRate: SR });
}

function stats(x: Float32Array) {
  let peak = 0;
  let bad = false;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) bad = true;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { peak, bad };
}

function identical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Normalized autocorrelation pitch detector over a window starting at
 * `start`. Scans 40..2000 Hz, takes the smallest lag whose peak comes
 * close to the global best (guards against locking onto a multiple of
 * the period), and refines the lag parabolically.
 */
function detectPitch(x: Float32Array, sr: number, start: number): number {
  const minLag = Math.floor(sr / 2000);
  const maxLag = Math.ceil(sr / 40);
  const win = Math.max(4096, 4 * maxLag);
  const n = Math.min(win, x.length - start);
  const span = n - maxLag;
  if (span < maxLag) throw new Error('pitch window too short');

  // remove dc so a decaying offset does not masquerade as correlation
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[start + i];
  mean /= n;
  const seg = new Float64Array(n);
  for (let i = 0; i < n; i++) seg[i] = x[start + i] - mean;

  const r = new Float64Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < span; i++) {
      num += seg[i] * seg[i + lag];
      e1 += seg[i] * seg[i];
      e2 += seg[i + lag] * seg[i + lag];
    }
    r[lag] = num / Math.sqrt(e1 * e2 + 1e-12);
    if (r[lag] > best) best = r[lag];
  }

  // smallest local maximum within reach of the global best
  let chosen = -1;
  const threshold = 0.9 * best;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] >= threshold && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      chosen = lag;
      break;
    }
  }
  if (chosen < 0) throw new Error('no autocorrelation peak found');

  // parabolic refinement around the chosen lag
  const y0 = r[chosen - 1];
  const y1 = r[chosen];
  const y2 = r[chosen + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return sr / (chosen + shift);
}

describe('instrument preset bank shape', () => {
  it('holds at least 40 presets', () => {
    expect(INSTRUMENT_PRESETS.length).toBeGreaterThanOrEqual(40);
  });

  it('every id is unique and kebab-case', () => {
    const seen = new Set<string>();
    for (const p of INSTRUMENT_PRESETS) {
      expect(seen.has(p.id), 'duplicate id ' + p.id).toBe(false);
      seen.add(p.id);
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every preset names a registered engine and only real params', () => {
    for (const p of INSTRUMENT_PRESETS) {
      // getEngine throws on an unregistered id
      const def = getEngine(p.engineId);
      const names = new Set(def.params.map((s) => s.name));
      for (const name of Object.keys(p.params)) {
        expect(names.has(name), p.id + ' has unknown param ' + name).toBe(true);
      }
    }
  });

  it('getPreset returns by id and throws on garbage', () => {
    expect(getPreset('nylon-guitar').engineId).toBe('pluck');
    expect(() => getPreset('kazoo-of-doom')).toThrow();
    expect(() => getPreset('')).toThrow();
  });

  it('presetsByFamily covers every preset in display order', () => {
    const grouped = presetsByFamily();
    let total = 0;
    for (const list of grouped.values()) total += list.length;
    expect(total).toBe(INSTRUMENT_PRESETS.length);
    expect([...grouped.keys()]).toEqual([
      'guitars',
      'strings',
      'winds',
      'brass',
      'keys',
      'mallets',
      'voices',
      'synth',
    ]);
  });
});

describe('strings family voicing', () => {
  // The bowed-string realism upgrade (docs/BOWED-STRINGS.md) gives every
  // violin-family preset a fixed body resonator and gives the bowed four
  // rosin noise, attack bite, and vibrato. Pizzicato keeps the body but
  // stays a plain pluck.
  const bowed = ['violin', 'viola', 'cello', 'double-bass'];

  it('bowed presets carry body, noise, bite, and vibrato settings', () => {
    for (const id of bowed) {
      const p = getPreset(id).params;
      expect(p.bow, id).toBeGreaterThan(0);
      expect(p.body, id).toBeGreaterThan(0);
      expect(p.bowNoise, id).toBeGreaterThan(0);
      expect(p.attackBite, id).toBeGreaterThan(0);
      expect(p.vibDepth, id).toBeGreaterThan(0);
      expect(p.vibOnset, id).toBeGreaterThanOrEqual(0.3);
    }
    // body size grows down the family
    const sizes = bowed.map((id) => getPreset(id).params.bodySize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes[0]).toBe(0);
    expect(sizes[3]).toBe(1);
  });

  it('pizzicato keeps the body but no bow, noise, or vibrato', () => {
    const p = getPreset('pizzicato-strings').params;
    expect(p.bow).toBe(0);
    expect(p.body).toBeGreaterThan(0);
    expect(p.bowNoise ?? 0).toBe(0);
    expect(p.attackBite ?? 0).toBe(0);
    expect(p.vibDepth ?? 0).toBe(0);
  });
});

describe('every preset renders a clean, deterministic note', () => {
  for (const preset of INSTRUMENT_PRESETS) {
    const wantPitch = PITCHED_FAMILIES.has(preset.family) && !INHARMONIC.has(preset.id);
    it(`${preset.id} (${preset.family}, ${preset.engineId})`, () => {
      const a = renderPreset(preset);
      const b = renderPreset(preset);

      const s = stats(a.left);
      expect(s.bad, preset.id + ' produced NaN or infinity').toBe(false);
      expect(s.peak, preset.id + ' is silent').toBeGreaterThan(0.003);
      expect(s.peak, preset.id + ' blew up').toBeLessThan(4);

      expect(identical(a.left, b.left), preset.id + ' left channel nondeterministic').toBe(true);
      expect(identical(a.right, b.right), preset.id + ' right channel nondeterministic').toBe(true);

      if (wantPitch) {
        const freq = testFreq(preset);
        // sustained region: past the slowest attack, before the note off
        const detected = detectPitch(a.left, SR, Math.round(0.2 * SR));
        const err = Math.abs(detected - freq) / freq;
        expect(
          err,
          `${preset.id} pitch off: wanted ${freq.toFixed(1)} Hz, got ${detected.toFixed(1)} Hz`,
        ).toBeLessThan(0.04);
      }
    });
  }
});
