/*
 * West coast voice: triangle core oscillator into an iterated wavefolder
 * into a low pass gate.
 *
 * The fold gain rides an Adsr (foldEnv sets how much), so notes open up
 * and relax like a Buchla timbre sweep. The low pass gate is an Svf
 * lowpass whose cutoff and level both follow a vactrol model: two
 * cascaded one poles with a fast rise and a slow, level dependent fall
 * (real vactrols let go quickly from bright and crawl through the dark
 * tail). lpgColor 0 is a plain VCA (filter open, level follows the
 * vactrol), 1 is all filter (cutoff follows, level barely). lpgDecay
 * sets the fall time scale.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { BlepOscillator } from '../dsp/oscillators';
import { Svf } from '../dsp/filters';
import { Adsr } from '../dsp/envelopes';
import { foldback } from '../dsp/waveshaper';

const SILENCE = 1e-4;
/** Control rate divider for the vactrol fall coefficients and the Svf. */
const CTRL = 16;
const MAX_FOLD = 7;
const OPEN_HZ = 16000;

function p(params: Record<string, number>, name: string, dflt: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

class WestCoastVoice implements Voice {
  private readonly sr: number;
  private readonly osc: BlepOscillator;
  private readonly lpg: Svf;
  private readonly foldEnvGen: Adsr;

  // vactrol: gate -> stage1 -> stage2
  private s1 = 0;
  private s2 = 0;
  private readonly rise1: number;
  private readonly rise2: number;
  private fall1 = 0;
  private fall2 = 0;
  private ctrlCountdown = 0;
  private amp = 0;

  private vel = 1;
  private gate = false;
  private live = false;

  private foldAmount: number;
  private foldStages: number;
  private foldEnv: number;
  private lpgColor: number;
  private lpgDecay: number;
  private level: number;

  constructor(sampleRate: number, params: Record<string, number>, _rng: NamedRng) {
    this.sr = sampleRate;
    this.osc = new BlepOscillator(sampleRate);
    this.osc.setShape('triangle');
    this.lpg = new Svf(sampleRate);
    this.lpg.setMode('lp');
    this.foldEnvGen = new Adsr(sampleRate);
    this.foldEnvGen.set(0.003, 0.25, 0.5, 0.12);
    this.rise1 = 1 - Math.exp(-1 / (0.0015 * sampleRate));
    this.rise2 = 1 - Math.exp(-1 / (0.003 * sampleRate));
    this.foldAmount = p(params, 'foldAmount', 0.35);
    this.foldStages = p(params, 'foldStages', 2);
    this.foldEnv = p(params, 'foldEnv', 0.5);
    this.lpgColor = p(params, 'lpgColor', 0.7);
    this.lpgDecay = p(params, 'lpgDecay', 0.5);
    this.level = p(params, 'level', 0.8);
  }

  noteOn(freq: number, vel: number): void {
    this.vel = clamp(vel, 0, 1);
    this.gate = true;
    this.live = true;
    this.osc.setFreq(freq);
    this.osc.reset();
    this.lpg.reset();
    this.s1 = 0;
    this.s2 = 0;
    this.ctrlCountdown = 0;
    this.foldEnvGen.reset();
    this.foldEnvGen.trigger();
  }

  noteOff(): void {
    this.gate = false;
    this.foldEnvGen.release();
  }

  /** Refresh the level dependent fall coefficients, the Svf, and the gain. */
  private control(): void {
    const decay = clamp(this.lpgDecay, 0.02, 5);
    // Vactrol fall slows as the light fades: time constant grows as the
    // stage level drops, which is the nonlinear tail.
    const tau1 = decay * (0.2 + 0.8 * (1 - this.s1));
    const tau2 = decay * 0.35 * (0.3 + 0.7 * (1 - this.s2));
    this.fall1 = 1 - Math.exp(-1 / (tau1 * this.sr));
    this.fall2 = 1 - Math.exp(-1 / (tau2 * this.sr));

    const v = clamp(this.s2, 0, 1);
    const color = clamp(this.lpgColor, 0, 1);
    // cutoff: fully open at color 0, riding the vactrol at color 1
    const vactrolHz = 40 * Math.pow(500, v);
    const cutHz = Math.exp(Math.log(OPEN_HZ) * (1 - color) + Math.log(vactrolHz) * color);
    this.lpg.set(cutHz, 0.6);
    // level: linear-in-vactrol VCA at color 0, mostly filter at color 1
    this.amp = Math.pow(v, 1 - 0.7 * color);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const stages = clamp(Math.round(this.foldStages), 1, 6);
    const foldAmt = clamp(this.foldAmount, 0, 1);
    const envMix = clamp(this.foldEnv, 0, 1);
    const level = this.level * this.vel;
    for (let i = from; i < to; i++) {
      if (this.ctrlCountdown <= 0) {
        this.control();
        this.ctrlCountdown = CTRL;
      }
      this.ctrlCountdown--;

      // vactrol tick: fast rise toward the gate, slow nonlinear fall
      const target = this.gate ? this.vel : 0;
      this.s1 += (target > this.s1 ? this.rise1 : this.fall1) * (target - this.s1);
      this.s2 += (this.s1 > this.s2 ? this.rise2 : this.fall2) * (this.s1 - this.s2);

      const fe = this.foldEnvGen.next();
      const gain = 1 + foldAmt * MAX_FOLD * (1 - envMix + envMix * fe);
      let x = this.osc.next();
      for (let s = 0; s < stages; s++) x = foldback(x, gain);

      const o = this.lpg.next(x) * this.amp * level;
      outL[i] += o;
      outR[i] += o;
    }
    if (!this.gate && this.s2 < SILENCE && this.s1 < SILENCE) this.live = false;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'foldAmount':
        this.foldAmount = value;
        break;
      case 'foldStages':
        this.foldStages = value;
        break;
      case 'foldEnv':
        this.foldEnv = value;
        break;
      case 'lpgColor':
        this.lpgColor = value;
        break;
      case 'lpgDecay':
        this.lpgDecay = value;
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
  { name: 'foldAmount', min: 0, max: 1, default: 0.35 },
  { name: 'foldStages', min: 1, max: 6, default: 2 },
  { name: 'foldEnv', min: 0, max: 1, default: 0.5 },
  { name: 'lpgColor', min: 0, max: 1, default: 0.7 },
  { name: 'lpgDecay', min: 0.02, max: 5, default: 0.5, curve: 'exp', unit: 's' },
  { name: 'level', min: 0, max: 1, default: 0.8 },
];

export const westcoastEngine: EngineDef = {
  id: 'westcoast',
  label: 'West Coast',
  params,
  polyphony: 8,
  createVoice: (sampleRate, initParams, rng) => new WestCoastVoice(sampleRate, initParams, rng),
};
