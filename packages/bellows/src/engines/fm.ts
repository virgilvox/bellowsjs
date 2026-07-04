/*
 * FM engine. Each operator owns a SineOscillator (driven through nextPm),
 * an Adsr, a frequency ratio or a fixed frequency, an output level, and
 * optionally self feedback. Routing is a declarative table per operator
 * count: mods[i] lists which operators phase modulate operator i, carriers
 * lists which operators reach the output, feedback names the operator with
 * a self loop. Operators are evaluated from the highest index down, so a
 * modulator's output from the current sample feeds its target with no
 * unit delay, like the DX chips.
 *
 * Topologies: 2 ops get a serial and a parallel algorithm; 4 ops get the
 * eight TX81Z style algorithms (reconstructed from the DX11/TX81Z charts);
 * 6 ops get DX7 algorithms 1, 5, 16 and 32. The algorithm param is one
 * based to match hardware naming and is clamped to the table.
 *
 * Envelopes are grouped, not per op: carriers share attack/decay/sustain/
 * release, modulators share mAttack/mDecay/mSustain/mRelease. An operator's
 * role follows the current algorithm's carrier list.
 *
 * Velocity: carrier level scales linearly with velocity. Modulation depth
 * scales by pow(velocity, brightness), so brightness 0 ignores velocity
 * and larger values darken soft notes.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { SineOscillator } from '../dsp/oscillators';
import { Adsr } from '../dsp/envelopes';

const MAX_OPS = 6;
/** Radians of phase modulation per unit of modulator output. */
const MOD_DEPTH = 4;
/** Radians of self feedback at feedback = 1, averaged over two samples. */
const FB_DEPTH = Math.PI;

interface FmAlgo {
  /** mods[i]: operator indices that phase modulate operator i. */
  readonly mods: readonly (readonly number[])[];
  readonly carriers: readonly number[];
  /** Operator with the self feedback loop. */
  readonly feedback: number;
}

const ALGOS_2: readonly FmAlgo[] = [
  { mods: [[1], []], carriers: [0], feedback: 1 },
  { mods: [[], []], carriers: [0, 1], feedback: 1 },
];

/* Four op set, TX81Z style, 0 indexed. Feedback sits on op 4 (index 3). */
const ALGOS_4: readonly FmAlgo[] = [
  // 1: 4>3>2>1
  { mods: [[1], [2], [3], []], carriers: [0], feedback: 3 },
  // 2: 2>1 and 4>3>1
  { mods: [[1, 2], [], [3], []], carriers: [0], feedback: 3 },
  // 3: 3>2>1 and 4>1
  { mods: [[1, 3], [2], [], []], carriers: [0], feedback: 3 },
  // 4: 4>3>2, carriers 1 and 2
  { mods: [[], [2], [3], []], carriers: [0, 1], feedback: 3 },
  // 5: 2>1 and 4>3, carriers 1 and 3
  { mods: [[1], [], [3], []], carriers: [0, 2], feedback: 3 },
  // 6: 4 modulates carriers 1, 2 and 3
  { mods: [[3], [3], [3], []], carriers: [0, 1, 2], feedback: 3 },
  // 7: 4>3, carriers 1, 2 and 3
  { mods: [[], [], [3], []], carriers: [0, 1, 2], feedback: 3 },
  // 8: four parallel carriers
  { mods: [[], [], [], []], carriers: [0, 1, 2, 3], feedback: 3 },
];

/* Six op set: DX7 algorithms 1, 5, 16, 32. Feedback on op 6 (index 5). */
const ALGOS_6: readonly FmAlgo[] = [
  // DX7 1: 2>1 and 6>5>4>3, carriers 1 and 3
  { mods: [[1], [], [3], [4], [5], []], carriers: [0, 2], feedback: 5 },
  // DX7 5: 2>1, 4>3, 6>5, carriers 1, 3 and 5
  { mods: [[1], [], [3], [], [5], []], carriers: [0, 2, 4], feedback: 5 },
  // DX7 16: 2, 3 and 5 modulate 1; 4>3; 6>5; carrier 1
  { mods: [[1, 2, 4], [], [3], [], [5], []], carriers: [0], feedback: 5 },
  // DX7 32: six parallel carriers
  { mods: [[], [], [], [], [], []], carriers: [0, 1, 2, 3, 4, 5], feedback: 5 },
];

const LEVEL_DEFAULTS = [1, 0.6, 0.5, 0.4, 0.4, 0.3];

function buildParams(): ParamSpec[] {
  const specs: ParamSpec[] = [
    { name: 'ops', min: 2, max: 6, default: 4 },
    { name: 'algorithm', min: 1, max: 8, default: 1 },
    { name: 'feedback', min: 0, max: 1, default: 0 },
    { name: 'brightness', min: 0, max: 2, default: 0.5 },
    { name: 'attack', min: 0, max: 10, default: 0.003, curve: 'exp', unit: 's' },
    { name: 'decay', min: 0, max: 10, default: 0.3, curve: 'exp', unit: 's' },
    { name: 'sustain', min: 0, max: 1, default: 0.7 },
    { name: 'release', min: 0, max: 10, default: 0.3, curve: 'exp', unit: 's' },
    { name: 'mAttack', min: 0, max: 10, default: 0.002, curve: 'exp', unit: 's' },
    { name: 'mDecay', min: 0, max: 10, default: 0.4, curve: 'exp', unit: 's' },
    { name: 'mSustain', min: 0, max: 1, default: 0.5 },
    { name: 'mRelease', min: 0, max: 10, default: 0.2, curve: 'exp', unit: 's' },
  ];
  for (let i = 1; i <= MAX_OPS; i++) {
    specs.push({ name: 'ratio' + i, min: 0, max: 16, default: 1 });
    specs.push({ name: 'level' + i, min: 0, max: 1, default: LEVEL_DEFAULTS[i - 1] });
    specs.push({ name: 'fixed' + i, min: 0, max: 10000, default: 0, unit: 'Hz' });
  }
  return specs;
}

const PARAMS: ParamSpec[] = buildParams();

function fillDefaults(given: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of PARAMS) out[s.name] = given[s.name] !== undefined ? given[s.name] : s.default;
  return out;
}

class FmOperator {
  readonly osc: SineOscillator;
  readonly env: Adsr;
  ratio = 1;
  fixedHz = 0;
  level = 1;
  out = 0;
  prev = 0;

  constructor(sampleRate: number) {
    this.osc = new SineOscillator(sampleRate);
    this.env = new Adsr(sampleRate);
  }

  setBaseFreq(baseHz: number): void {
    this.osc.setFreq(this.fixedHz > 0 ? this.fixedHz : baseHz * this.ratio);
  }
}

function snapOpCount(v: number): number {
  if (v < 3) return 2;
  if (v < 5) return 4;
  return 6;
}

class FmVoice implements Voice {
  private readonly p: Record<string, number>;
  private readonly ops: FmOperator[];
  private opCount = 4;
  private algo: FmAlgo = ALGOS_4[0];
  private carrierGain = 1;
  private freq = 440;
  private vel = 1;
  private modVelGain = 1;

  constructor(sampleRate: number, params: Record<string, number>, _rng: NamedRng) {
    this.p = fillDefaults(params);
    this.ops = [];
    for (let i = 0; i < MAX_OPS; i++) this.ops.push(new FmOperator(sampleRate));
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    const p = this.p;
    this.opCount = snapOpCount(p.ops);
    const table = this.opCount === 2 ? ALGOS_2 : this.opCount === 4 ? ALGOS_4 : ALGOS_6;
    const idx = clamp(Math.round(p.algorithm) - 1, 0, table.length - 1);
    this.algo = table[idx];
    this.carrierGain = 1 / this.algo.carriers.length;
    for (let i = 0; i < this.opCount; i++) {
      const op = this.ops[i];
      op.ratio = p['ratio' + (i + 1)];
      op.fixedHz = p['fixed' + (i + 1)];
      op.level = p['level' + (i + 1)];
      op.setBaseFreq(this.freq);
      if (this.algo.carriers.indexOf(i) >= 0) {
        op.env.set(p.attack, p.decay, p.sustain, p.release);
      } else {
        op.env.set(p.mAttack, p.mDecay, p.mSustain, p.mRelease);
      }
    }
  }

  noteOn(freq: number, vel: number): void {
    this.freq = freq;
    this.vel = vel;
    this.modVelGain = Math.pow(Math.max(vel, 1e-3), this.p.brightness);
    for (let i = 0; i < MAX_OPS; i++) {
      const op = this.ops[i];
      op.osc.reset(0);
      op.env.reset();
      op.out = 0;
      op.prev = 0;
      op.setBaseFreq(freq);
      if (i < this.opCount) op.env.trigger();
    }
  }

  noteOff(): void {
    for (let i = 0; i < this.opCount; i++) this.ops[i].env.release();
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const ops = this.ops;
    const algo = this.algo;
    const n = this.opCount;
    const fb = this.p.feedback * FB_DEPTH * 0.5;
    const modGain = MOD_DEPTH * this.modVelGain;
    const outGain = this.carrierGain * this.vel * Math.SQRT1_2;
    const carriers = algo.carriers;
    for (let i = from; i < to; i++) {
      for (let o = n - 1; o >= 0; o--) {
        const op = ops[o];
        const mods = algo.mods[o];
        let pm = 0;
        for (let m = 0; m < mods.length; m++) pm += ops[mods[m]].out;
        pm *= modGain;
        if (o === algo.feedback && fb > 0) pm += fb * (op.out + op.prev);
        const y = op.osc.nextPm(pm) * op.level * op.env.next();
        op.prev = op.out;
        op.out = y;
      }
      let y = 0;
      for (let c = 0; c < carriers.length; c++) y += ops[carriers[c]].out;
      y *= outGain;
      outL[i] += y;
      outR[i] += y;
    }
  }

  get active(): boolean {
    const carriers = this.algo.carriers;
    for (let c = 0; c < carriers.length; c++) {
      if (this.ops[carriers[c]].env.active) return true;
    }
    return false;
  }
}

export const fmEngine: EngineDef = {
  id: 'fm',
  label: 'FM',
  params: PARAMS,
  polyphony: 8,
  createVoice: (sampleRate, params, rng) => new FmVoice(sampleRate, params, rng),
};
