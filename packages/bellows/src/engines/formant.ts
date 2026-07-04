/*
 * Source-filter vocal synth: a BLEP saw or pulse source with sine
 * vibrato, mixed with breath noise, through five parallel Svf bandpass
 * formant filters.
 *
 * Vowel tables give frequency, bandwidth, and level for the vowels
 * a e i o u of a bass voice. Values are the bass rows of the "Formant
 * Values" appendix of the Csound manual (the widely copied CLM/Csound
 * formant data). The vowel param 0..4 morphs continuously between
 * adjacent vowels: frequency interpolates in the log domain, bandwidth
 * and level linearly.
 *
 * The Svf bandpass peaks at gain q, so each formant output is scaled by
 * level / q to land at its table level.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { BlepOscillator } from '../dsp/oscillators';
import { NoiseGen } from '../dsp/noise';
import { Lfo } from '../dsp/lfo';
import { Svf } from '../dsp/filters';
import { Adsr } from '../dsp/envelopes';

const FORMANTS = 5;
/** Filter and vibrato depth refresh divider. */
const CTRL = 32;

interface VowelTable {
  freq: number[];
  /** Level in dB relative to the first formant. */
  db: number[];
  bw: number[];
}

/* Bass a, e, i, o, u. */
const VOWELS: VowelTable[] = [
  { freq: [600, 1040, 2250, 2450, 2750], db: [0, -7, -9, -9, -20], bw: [60, 70, 110, 120, 130] },
  { freq: [400, 1620, 2400, 2800, 3100], db: [0, -12, -9, -12, -18], bw: [40, 80, 100, 120, 120] },
  { freq: [250, 1750, 2600, 3050, 3340], db: [0, -30, -16, -22, -28], bw: [60, 90, 100, 120, 120] },
  { freq: [400, 750, 2400, 2600, 2900], db: [0, -11, -21, -20, -40], bw: [40, 80, 100, 120, 120] },
  { freq: [350, 600, 2400, 2675, 2950], db: [0, -20, -32, -28, -36], bw: [40, 80, 100, 120, 120] },
];

function p(params: Record<string, number>, name: string, dflt: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

class FormantVoice implements Voice {
  private readonly sr: number;
  private readonly osc: BlepOscillator;
  private readonly noise: NoiseGen;
  private readonly vibrato: Lfo;
  private readonly env: Adsr;
  private readonly filters: Svf[] = [];
  private readonly scales = new Float32Array(FORMANTS);

  private f0 = 220;
  private vel = 1;
  private live = false;
  private ctrlCountdown = 0;

  private vowel: number;
  private breath: number;
  private vibratoRate: number;
  private vibratoDepth: number;
  private shape: number;
  private level: number;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sr = sampleRate;
    this.osc = new BlepOscillator(sampleRate);
    this.noise = new NoiseGen(sampleRate, 'white', rng);
    this.vibrato = new Lfo(sampleRate, rng.fork('vibrato'));
    this.vibrato.setShape('sine');
    this.env = new Adsr(sampleRate);
    this.env.set(0.02, 0.08, 0.85, 0.25);
    for (let k = 0; k < FORMANTS; k++) {
      const f = new Svf(sampleRate);
      f.setMode('bp');
      this.filters.push(f);
    }
    this.vowel = p(params, 'vowel', 0);
    this.breath = p(params, 'breath', 0.1);
    this.vibratoRate = p(params, 'vibratoRate', 5);
    this.vibratoDepth = p(params, 'vibratoDepth', 0.25);
    this.shape = p(params, 'shape', 0);
    this.level = p(params, 'level', 1);
  }

  noteOn(freq: number, vel: number): void {
    this.f0 = clamp(freq, 20, this.sr * 0.35);
    this.vel = clamp(vel, 0, 1);
    this.live = true;
    this.osc.setShape(this.shape < 0.5 ? 'saw' : 'square');
    this.osc.setPulseWidth(0.3);
    this.osc.reset();
    this.vibrato.reset();
    this.vibrato.setFreq(this.vibratoRate);
    for (const f of this.filters) f.reset();
    this.env.reset();
    this.env.trigger();
    this.ctrlCountdown = 0;
    this.updateFormants();
  }

  noteOff(): void {
    this.env.release();
  }

  /** Morph the five filters between the vowel tables adjacent to the vowel param. */
  private updateFormants(): void {
    const v = clamp(this.vowel, 0, VOWELS.length - 1);
    const i0 = Math.min(VOWELS.length - 2, Math.floor(v));
    const frac = v - i0;
    const a = VOWELS[i0];
    const b = VOWELS[i0 + 1];
    for (let k = 0; k < FORMANTS; k++) {
      const f = a.freq[k] * Math.pow(b.freq[k] / a.freq[k], frac);
      const bw = a.bw[k] + (b.bw[k] - a.bw[k]) * frac;
      const la = Math.pow(10, a.db[k] / 20);
      const lb = Math.pow(10, b.db[k] / 20);
      const lvl = la + (lb - la) * frac;
      const q = Math.max(f / bw, 0.5);
      this.filters[k].set(f, q);
      this.scales[k] = lvl / q;
    }
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const breath = clamp(this.breath, 0, 1);
    const level = this.level * this.vel;
    const depth = this.vibratoDepth;
    for (let i = from; i < to; i++) {
      if (this.ctrlCountdown <= 0) {
        this.vibrato.setFreq(this.vibratoRate);
        this.ctrlCountdown = CTRL;
      }
      this.ctrlCountdown--;

      const vib = this.vibrato.next() * depth;
      this.osc.setFreq(this.f0 * Math.pow(2, vib / 12));
      const src = this.osc.next() * (1 - breath) + this.noise.next() * breath;

      let y = 0;
      for (let k = 0; k < FORMANTS; k++) y += this.filters[k].next(src) * this.scales[k];

      const o = y * this.env.next() * level;
      outL[i] += o;
      outR[i] += o;
    }
    if (!this.env.active) this.live = false;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'vowel':
        this.vowel = value;
        if (this.live) this.updateFormants();
        break;
      case 'breath':
        this.breath = value;
        break;
      case 'vibratoRate':
        this.vibratoRate = value;
        break;
      case 'vibratoDepth':
        this.vibratoDepth = value;
        break;
      case 'shape':
        this.shape = value;
        if (this.live) this.osc.setShape(value < 0.5 ? 'saw' : 'square');
        break;
      case 'level':
        this.level = value;
        break;
    }
  }

  get active(): boolean {
    return this.live;
  }
}

const params: ParamSpec[] = [
  { name: 'vowel', min: 0, max: 4, default: 0 },
  { name: 'breath', min: 0, max: 1, default: 0.1 },
  { name: 'vibratoRate', min: 0, max: 12, default: 5, unit: 'Hz' },
  { name: 'vibratoDepth', min: 0, max: 2, default: 0.25, unit: 'st' },
  { name: 'shape', min: 0, max: 1, default: 0 },
  { name: 'level', min: 0, max: 2, default: 1 },
];

export const formantEngine: EngineDef = {
  id: 'formant',
  label: 'Formant',
  params,
  polyphony: 8,
  createVoice: (sampleRate, initParams, rng) => new FormantVoice(sampleRate, initParams, rng),
};
