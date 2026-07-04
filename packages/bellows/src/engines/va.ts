/*
 * Virtual analog engine. Two BLEP oscillators with a detune spread in
 * cents, an optional square sub oscillator one octave down, a selectable
 * ladder or SVF lowpass with its own ADSR, an amp ADSR, and a slow random
 * pitch walk per voice for analog drift.
 *
 * Param notes:
 *   shape       indexed: 0 saw, 1 square, 2 triangle, 3 sine
 *   detune      total spread in cents, osc1 down half, osc2 up half
 *   filterType  indexed: 0 ladder, 1 svf
 *   envAmount   filter envelope depth in octaves above the base cutoff
 *   velFilter   octaves added to the cutoff at full velocity
 *   velLevel    how much velocity scales level (0 none, 1 proportional)
 *   drift       depth of the random pitch walk, about 15 cents rms at 1
 *
 * Filter coefficients and drift update every CONTROL_INTERVAL samples;
 * the interval counter is per sample, so block splits do not change the
 * output.
 */

import type { EngineDef, NamedRng, ParamSpec, Rng, Voice } from '../types';
import { clamp } from '../types';
import { BlepOscillator, type BlepShape } from '../dsp/oscillators';
import { LadderFilter, Svf } from '../dsp/filters';
import { Adsr } from '../dsp/envelopes';

const SHAPES: readonly BlepShape[] = ['saw', 'square', 'triangle', 'sine'];
const CONTROL_INTERVAL = 16;
/** Cents of drift walk at drift = 1, roughly the rms wander. */
const DRIFT_CENTS = 15;
/** Leak and step of the drift walk, per control tick. */
const DRIFT_LEAK = 0.999;
const DRIFT_STEP = 0.05;

const PARAMS: ParamSpec[] = [
  { name: 'shape', min: 0, max: 3, default: 0 },
  { name: 'detune', min: 0, max: 100, default: 7, unit: 'cents' },
  { name: 'sub', min: 0, max: 1, default: 0 },
  { name: 'cutoff', min: 20, max: 20000, default: 9000, curve: 'exp', unit: 'Hz' },
  { name: 'resonance', min: 0, max: 1, default: 0.2 },
  { name: 'filterType', min: 0, max: 1, default: 0 },
  { name: 'envAmount', min: -6, max: 6, default: 0, unit: 'oct' },
  { name: 'attack', min: 0, max: 10, default: 0.005, curve: 'exp', unit: 's' },
  { name: 'decay', min: 0, max: 10, default: 0.1, curve: 'exp', unit: 's' },
  { name: 'sustain', min: 0, max: 1, default: 0.8 },
  { name: 'release', min: 0, max: 10, default: 0.2, curve: 'exp', unit: 's' },
  { name: 'fAttack', min: 0, max: 10, default: 0.003, curve: 'exp', unit: 's' },
  { name: 'fDecay', min: 0, max: 10, default: 0.15, curve: 'exp', unit: 's' },
  { name: 'fSustain', min: 0, max: 1, default: 0.5 },
  { name: 'fRelease', min: 0, max: 10, default: 0.2, curve: 'exp', unit: 's' },
  { name: 'drift', min: 0, max: 1, default: 0 },
  { name: 'pan', min: -1, max: 1, default: 0 },
  { name: 'velLevel', min: 0, max: 1, default: 0.5 },
  { name: 'velFilter', min: 0, max: 4, default: 0, unit: 'oct' },
];

function fillDefaults(given: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of PARAMS) out[s.name] = given[s.name] !== undefined ? given[s.name] : s.default;
  return out;
}

function centsRatio(c: number): number {
  return Math.pow(2, c / 1200);
}

class VaVoice implements Voice {
  private readonly sampleRate: number;
  private readonly p: Record<string, number>;
  private readonly rand: Rng;
  private readonly osc1: BlepOscillator;
  private readonly osc2: BlepOscillator;
  private readonly subOsc: BlepOscillator;
  private readonly ladder: LadderFilter;
  private readonly svf: Svf;
  private readonly ampEnv: Adsr;
  private readonly filtEnv: Adsr;

  private freq = 440;
  private vel = 1;
  private ampVelGain = 1;
  private d1 = 0;
  private d2 = 0;
  private ctrl = 0;
  private gainL = Math.SQRT1_2;
  private gainR = Math.SQRT1_2;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.p = fillDefaults(params);
    this.rand = rng.fork('va');
    this.osc1 = new BlepOscillator(sampleRate);
    this.osc2 = new BlepOscillator(sampleRate);
    this.subOsc = new BlepOscillator(sampleRate);
    this.subOsc.setShape('square');
    this.ladder = new LadderFilter(sampleRate);
    this.svf = new Svf(sampleRate);
    this.svf.setMode('lp');
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
    const shape = SHAPES[clamp(Math.round(p.shape), 0, 3)];
    this.osc1.setShape(shape);
    this.osc2.setShape(shape);
    this.ampEnv.set(p.attack, p.decay, p.sustain, p.release);
    this.filtEnv.set(p.fAttack, p.fDecay, p.fSustain, p.fRelease);
    const angle = ((clamp(p.pan, -1, 1) + 1) * Math.PI) / 4;
    this.gainL = Math.cos(angle);
    this.gainR = Math.sin(angle);
  }

  noteOn(freq: number, vel: number): void {
    const p = this.p;
    this.freq = freq;
    this.vel = vel;
    this.ampVelGain = 1 - p.velLevel * (1 - vel);
    this.d1 = 0;
    this.d2 = 0;
    this.osc1.reset(0);
    this.osc2.reset(this.rand());
    this.subOsc.reset(0);
    this.ladder.reset();
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
    if (p.drift > 0) {
      this.d1 = this.d1 * DRIFT_LEAK + (this.rand() - 0.5) * DRIFT_STEP;
      this.d2 = this.d2 * DRIFT_LEAK + (this.rand() - 0.5) * DRIFT_STEP;
    }
    const half = p.detune * 0.5;
    const dc1 = this.d1 * p.drift * DRIFT_CENTS;
    const dc2 = this.d2 * p.drift * DRIFT_CENTS;
    this.osc1.setFreq(this.freq * centsRatio(-half + dc1));
    this.osc2.setFreq(this.freq * centsRatio(half + dc2));
    this.subOsc.setFreq(this.freq * 0.5);
    const oct = p.envAmount * this.filtEnv.level + p.velFilter * this.vel;
    const cut = clamp(p.cutoff * Math.pow(2, oct), 20, this.sampleRate * 0.45);
    if (p.filterType < 0.5) this.ladder.set(cut, p.resonance);
    else this.svf.set(cut, 0.5 + p.resonance * 9.5);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.ampEnv.active) return;
    const p = this.p;
    const useLadder = p.filterType < 0.5;
    const sub = p.sub;
    for (let i = from; i < to; i++) {
      if (this.ctrl <= 0) {
        this.updateControl();
        this.ctrl = CONTROL_INTERVAL;
      }
      this.ctrl--;
      this.filtEnv.next();
      let y = (this.osc1.next() + this.osc2.next()) * 0.5 + sub * this.subOsc.next();
      y = useLadder ? this.ladder.next(y) : this.svf.next(y);
      y *= this.ampEnv.next() * this.ampVelGain;
      outL[i] += y * this.gainL;
      outR[i] += y * this.gainR;
    }
  }

  get active(): boolean {
    return this.ampEnv.active;
  }
}

export const vaEngine: EngineDef = {
  id: 'va',
  label: 'Virtual Analog',
  params: PARAMS,
  polyphony: 8,
  createVoice: (sampleRate, params, rng) => new VaVoice(sampleRate, params, rng),
};
