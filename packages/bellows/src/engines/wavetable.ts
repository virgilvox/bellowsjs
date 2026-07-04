/*
 * Wavetable engine. A WavetableOscillator scans across the frames of a
 * WavetableSet. The scan position is the position param plus a bipolar
 * LFO (scanRate, scanDepth) plus the amp envelope scaled by envToPosition,
 * clamped to 0..1. One Adsr drives both the amp and the position
 * modulation. An optional SVF lowpass sits after the oscillator.
 *
 * makeWavetableEngine wraps any WavetableSet as an EngineDef. The default
 * 'wavetable' engine uses a four frame morph table (sine, triangle, saw,
 * square), built once per sample rate and cached.
 *
 * A custom set carries its own sample rate for mip selection; feeding it
 * to a voice at a different rate keeps working but the mip switch points
 * shift by the ratio of the two rates.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { WavetableOscillator, WavetableSet } from '../dsp/wavetable';
import { Lfo } from '../dsp/lfo';
import { Svf } from '../dsp/filters';
import { Adsr } from '../dsp/envelopes';

const PARAMS: ParamSpec[] = [
  { name: 'position', min: 0, max: 1, default: 0 },
  { name: 'scanRate', min: 0, max: 20, default: 0.5, curve: 'exp', unit: 'Hz' },
  { name: 'scanDepth', min: 0, max: 1, default: 0 },
  { name: 'envToPosition', min: -1, max: 1, default: 0 },
  { name: 'attack', min: 0, max: 10, default: 0.005, curve: 'exp', unit: 's' },
  { name: 'decay', min: 0, max: 10, default: 0.1, curve: 'exp', unit: 's' },
  { name: 'sustain', min: 0, max: 1, default: 0.8 },
  { name: 'release', min: 0, max: 10, default: 0.2, curve: 'exp', unit: 's' },
  { name: 'filter', min: 0, max: 1, default: 0 },
  { name: 'cutoff', min: 20, max: 20000, default: 8000, curve: 'exp', unit: 'Hz' },
  { name: 'resonance', min: 0, max: 1, default: 0.1 },
  { name: 'pan', min: -1, max: 1, default: 0 },
];

function fillDefaults(given: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of PARAMS) out[s.name] = given[s.name] !== undefined ? given[s.name] : s.default;
  return out;
}

class WavetableVoice implements Voice {
  private readonly p: Record<string, number>;
  private readonly osc: WavetableOscillator;
  private readonly lfo: Lfo;
  private readonly svf: Svf;
  private readonly ampEnv: Adsr;
  private vel = 1;
  private gainL = Math.SQRT1_2;
  private gainR = Math.SQRT1_2;

  constructor(
    sampleRate: number,
    params: Record<string, number>,
    rng: NamedRng,
    set: WavetableSet,
  ) {
    this.p = fillDefaults(params);
    this.osc = new WavetableOscillator(sampleRate, set);
    this.lfo = new Lfo(sampleRate, rng.fork('wt/lfo'));
    this.lfo.setShape('sine');
    this.svf = new Svf(sampleRate);
    this.svf.setMode('lp');
    this.ampEnv = new Adsr(sampleRate);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    const p = this.p;
    this.ampEnv.set(p.attack, p.decay, p.sustain, p.release);
    this.lfo.setFreq(p.scanRate);
    this.svf.set(p.cutoff, 0.5 + p.resonance * 9.5);
    const angle = ((clamp(p.pan, -1, 1) + 1) * Math.PI) / 4;
    this.gainL = Math.cos(angle);
    this.gainR = Math.sin(angle);
  }

  noteOn(freq: number, vel: number): void {
    this.vel = vel;
    this.osc.setFreq(freq);
    this.osc.reset(0);
    this.lfo.reset(0);
    this.svf.reset();
    this.ampEnv.reset();
    this.ampEnv.trigger();
  }

  noteOff(): void {
    this.ampEnv.release();
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.ampEnv.active) return;
    const p = this.p;
    const useFilter = p.filter >= 0.5;
    const base = p.position;
    const depth = p.scanDepth;
    const envAmt = p.envToPosition;
    const vel = this.vel;
    for (let i = from; i < to; i++) {
      const e = this.ampEnv.next();
      this.osc.setPosition(base + depth * this.lfo.next() + envAmt * e);
      let y = this.osc.next();
      if (useFilter) y = this.svf.next(y);
      y *= e * vel;
      outL[i] += y * this.gainL;
      outR[i] += y * this.gainR;
    }
  }

  get active(): boolean {
    return this.ampEnv.active;
  }
}

/** Wrap a WavetableSet as an engine. The id defaults to 'wavetable'. */
export function makeWavetableEngine(set: WavetableSet, id = 'wavetable'): EngineDef {
  return {
    id,
    label: 'Wavetable (' + id + ')',
    params: PARAMS,
    polyphony: 8,
    createVoice: (sampleRate, params, rng) => new WavetableVoice(sampleRate, params, rng, set),
  };
}

/* ------------------------------------------------------------------ */
/* Default morph table: sine, triangle, saw, square                    */
/* ------------------------------------------------------------------ */

const MORPH_LENGTH = 2048;

function buildMorphFrames(): Float32Array[] {
  const n = MORPH_LENGTH;
  const sine = new Float32Array(n);
  const tri = new Float32Array(n);
  const saw = new Float32Array(n);
  const square = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    sine[i] = Math.sin(2 * Math.PI * t);
    tri[i] = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
    saw[i] = 2 * t - 1;
    square[i] = t < 0.5 ? 1 : -1;
  }
  return [sine, tri, saw, square];
}

const defaultSets = new Map<number, WavetableSet>();

function defaultSet(sampleRate: number): WavetableSet {
  let set = defaultSets.get(sampleRate);
  if (!set) {
    set = WavetableSet.fromFrames(buildMorphFrames(), sampleRate);
    defaultSets.set(sampleRate, set);
  }
  return set;
}

export const wavetableEngine: EngineDef = {
  id: 'wavetable',
  label: 'Wavetable',
  params: PARAMS,
  polyphony: 8,
  createVoice: (sampleRate, params, rng) =>
    new WavetableVoice(sampleRate, params, rng, defaultSet(sampleRate)),
};
