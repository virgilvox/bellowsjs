/*
 * Noise synth engine. A NoiseGen with a selectable color runs through an
 * SVF whose cutoff is swept by its own ADSR, then an amp ADSR. Meant for
 * percussion and texture layers.
 *
 * Param notes:
 *   color       indexed: 0 white, 1 pink, 2 brown, 3 velvet, 4 crackle
 *   filterMode  indexed: 0 lowpass, 1 bandpass, 2 highpass
 *   envAmount   filter envelope depth in octaves above the base cutoff
 *   keyTrack    cutoff scales with (noteFreq / 220) ^ keyTrack
 *
 * Filter coefficients update every CONTROL_INTERVAL samples on a per
 * sample counter, so block splits do not change the output.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { NoiseGen, type NoiseColor } from '../dsp/noise';
import { Svf, type SvfMode } from '../dsp/filters';
import { Adsr } from '../dsp/envelopes';

const COLORS: readonly NoiseColor[] = ['white', 'pink', 'brown', 'velvet', 'crackle'];
const MODES: readonly SvfMode[] = ['lp', 'bp', 'hp'];
const CONTROL_INTERVAL = 16;

const PARAMS: ParamSpec[] = [
  { name: 'color', min: 0, max: 4, default: 0 },
  { name: 'filterMode', min: 0, max: 2, default: 0 },
  { name: 'cutoff', min: 20, max: 20000, default: 2000, curve: 'exp', unit: 'Hz' },
  { name: 'resonance', min: 0, max: 1, default: 0.1 },
  { name: 'envAmount', min: -6, max: 6, default: 0, unit: 'oct' },
  { name: 'keyTrack', min: 0, max: 1, default: 0 },
  { name: 'attack', min: 0, max: 10, default: 0.002, curve: 'exp', unit: 's' },
  { name: 'decay', min: 0, max: 10, default: 0.15, curve: 'exp', unit: 's' },
  { name: 'sustain', min: 0, max: 1, default: 0.3 },
  { name: 'release', min: 0, max: 10, default: 0.1, curve: 'exp', unit: 's' },
  { name: 'fAttack', min: 0, max: 10, default: 0.001, curve: 'exp', unit: 's' },
  { name: 'fDecay', min: 0, max: 10, default: 0.12, curve: 'exp', unit: 's' },
  { name: 'fSustain', min: 0, max: 1, default: 0 },
  { name: 'fRelease', min: 0, max: 10, default: 0.1, curve: 'exp', unit: 's' },
  { name: 'pan', min: -1, max: 1, default: 0 },
];

function fillDefaults(given: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of PARAMS) out[s.name] = given[s.name] !== undefined ? given[s.name] : s.default;
  return out;
}

class NoiseVoice implements Voice {
  private readonly sampleRate: number;
  private readonly p: Record<string, number>;
  private readonly noise: NoiseGen;
  private readonly svf: Svf;
  private readonly ampEnv: Adsr;
  private readonly filtEnv: Adsr;
  private color: NoiseColor = 'white';
  private freq = 220;
  private vel = 1;
  private ctrl = 0;
  private gainL = Math.SQRT1_2;
  private gainR = Math.SQRT1_2;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.p = fillDefaults(params);
    this.noise = new NoiseGen(sampleRate, 'white', rng.fork('noise'));
    this.svf = new Svf(sampleRate);
    this.ampEnv = new Adsr(sampleRate);
    this.filtEnv = new Adsr(sampleRate);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    const p = this.p;
    const color = COLORS[clamp(Math.round(p.color), 0, COLORS.length - 1)];
    if (color !== this.color) {
      this.color = color;
      this.noise.setColor(color);
    }
    this.svf.setMode(MODES[clamp(Math.round(p.filterMode), 0, MODES.length - 1)]);
    this.ampEnv.set(p.attack, p.decay, p.sustain, p.release);
    this.filtEnv.set(p.fAttack, p.fDecay, p.fSustain, p.fRelease);
    const angle = ((clamp(p.pan, -1, 1) + 1) * Math.PI) / 4;
    this.gainL = Math.cos(angle);
    this.gainR = Math.sin(angle);
  }

  noteOn(freq: number, vel: number): void {
    this.freq = freq;
    this.vel = vel;
    this.svf.reset();
    this.ampEnv.reset();
    this.ampEnv.trigger();
    this.filtEnv.reset();
    this.filtEnv.trigger();
    this.ctrl = 0;
  }

  noteOff(): void {
    this.ampEnv.release();
    this.filtEnv.release();
  }

  private updateControl(): void {
    const p = this.p;
    const track = Math.pow(this.freq / 220, p.keyTrack);
    const oct = p.envAmount * this.filtEnv.level;
    const cut = clamp(p.cutoff * track * Math.pow(2, oct), 20, this.sampleRate * 0.45);
    this.svf.set(cut, 0.5 + p.resonance * 9.5);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.ampEnv.active) return;
    for (let i = from; i < to; i++) {
      if (this.ctrl <= 0) {
        this.updateControl();
        this.ctrl = CONTROL_INTERVAL;
      }
      this.ctrl--;
      this.filtEnv.next();
      const y = this.svf.next(this.noise.next()) * this.ampEnv.next() * this.vel;
      outL[i] += y * this.gainL;
      outR[i] += y * this.gainR;
    }
  }

  get active(): boolean {
    return this.ampEnv.active;
  }
}

export const noiseEngine: EngineDef = {
  id: 'noise',
  label: 'Noise Synth',
  params: PARAMS,
  polyphony: 8,
  createVoice: (sampleRate, params, rng) => new NoiseVoice(sampleRate, params, rng),
};
