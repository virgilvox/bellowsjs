/*
 * Dattorro plate reverb (Jon Dattorro, "Effect Design Part 1: Reverberator
 * and Other Filters", JAES 1997, Fig. 1). Signal path: predelay, one pole
 * bandwidth filter, four input diffusers (coefficients 0.75, 0.75, 0.625,
 * 0.625), then the figure-eight tank. Each tank branch is a modulated
 * allpass (decay diffusion 1 = 0.7, excursion about 8 samples), a delay,
 * a one pole damping filter, the decay gain, a second allpass (decay
 * diffusion 2 = 0.5), and a final delay whose output crosses into the
 * other branch. Left and right outputs sum seven taps each out of the
 * tank buffers at the paper's sample offsets.
 *
 * All lengths and tap offsets are quoted at the paper's 29761 Hz rate
 * and scaled to the actual sample rate at construction.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp } from '../types';
import { DelayLine } from '../dsp/delayline';
import { Smoother } from '../dsp/envelopes';
import { Lfo } from '../dsp/lfo';

/** The paper's reference sample rate. */
const REF_RATE = 29761;
/** Peak read position excursion in samples at REF_RATE, at modDepth 1. */
const EXCURSION = 8;
const MOD_DEPTH_MAX = 2;
const PREDELAY_MAX = 0.25;

/** Input diffuser lengths and coefficients, in paper order. */
const DIFF_LEN = [142, 107, 379, 277];
const DIFF_G = [0.75, 0.75, 0.625, 0.625];

/** Tank element lengths at REF_RATE. */
const TANK = {
  apA1: 672,
  delA1: 4453,
  apA2: 1800,
  delA2: 3720,
  apB1: 908,
  delB1: 4217,
  apB2: 2656,
  delB2: 3163,
};
const DECAY_DIFF_1 = 0.7;
const DECAY_DIFF_2 = 0.5;

/** Left output tap offsets at REF_RATE: B1, B1, apB2, B2, A1, apA2, A2. */
const TAPS_L = [266, 2974, 1913, 1996, 1990, 187, 1066];
/** Right output tap offsets at REF_RATE: A1, A1, apA2, A2, B1, apB2, B2. */
const TAPS_R = [353, 3627, 1228, 2673, 2111, 335, 121];

const PLATE_PARAMS: ParamSpec[] = [
  { name: 'decay', min: 0, max: 0.98, default: 0.5 },
  { name: 'damping', min: 0, max: 0.99, default: 0.3 },
  { name: 'bandwidth', min: 0, max: 1, default: 0.9995 },
  { name: 'predelay', min: 0, max: PREDELAY_MAX, default: 0, unit: 's' },
  { name: 'modDepth', min: 0, max: MOD_DEPTH_MAX, default: 1 },
  { name: 'mix', min: 0, max: 1, default: 0.35 },
];

/**
 * Schroeder allpass whose internal delay buffer can be tapped, which the
 * plate's output accumulators need. tap(o) reads the internal node
 * delayed o samples, taken after the current sample's write.
 */
class TappedAllpass {
  protected readonly dl: DelayLine;
  protected readonly len: number;
  private readonly g: number;

  constructor(lenSamples: number, g: number, extra = 4) {
    this.len = Math.max(1, lenSamples | 0);
    this.dl = new DelayLine(this.len + extra);
    this.g = g;
  }

  next(x: number): number {
    const z = this.dl.readInt(this.len - 1);
    const v = x + this.g * z;
    this.dl.write(v);
    return z - this.g * v;
  }

  tap(offset: number): number {
    return this.dl.readInt(offset);
  }

  reset(): void {
    this.dl.clear();
  }
}

/** Allpass with a modulated read position for the tank's first diffusers. */
class ModAllpass extends TappedAllpass {
  constructor(lenSamples: number, g: number, maxExcursion: number) {
    super(lenSamples, g, Math.ceil(maxExcursion) + 8);
  }

  nextMod(x: number, excursion: number): number {
    const z = this.dl.readCubic(this.len - 1 + excursion);
    const g = DECAY_DIFF_1;
    const v = x + g * z;
    this.dl.write(v);
    return z - g * v;
  }
}

/** Plain tank delay: write then read the full length, plus output taps. */
class TankDelay {
  private readonly dl: DelayLine;
  private readonly len: number;

  constructor(lenSamples: number) {
    this.len = Math.max(1, lenSamples | 0);
    this.dl = new DelayLine(this.len);
  }

  push(x: number): number {
    this.dl.write(x);
    return this.dl.readInt(this.len);
  }

  tap(offset: number): number {
    return this.dl.readInt(offset);
  }

  reset(): void {
    this.dl.clear();
  }
}

class PlateReverb implements Effect {
  private readonly sampleRate: number;
  private readonly preLine: DelayLine;
  private readonly preSm: Smoother;
  private readonly diffusers: TappedAllpass[] = [];
  private readonly apA1: ModAllpass;
  private readonly delA1: TankDelay;
  private readonly apA2: TappedAllpass;
  private readonly delA2: TankDelay;
  private readonly apB1: ModAllpass;
  private readonly delB1: TankDelay;
  private readonly apB2: TappedAllpass;
  private readonly delB2: TankDelay;
  private readonly lfoA: Lfo;
  private readonly lfoB: Lfo;
  private readonly tapsL: number[];
  private readonly tapsR: number[];
  private readonly excScale: number;

  private bwState = 0;
  private dampAState = 0;
  private dampBState = 0;
  private fbA = 0;
  private fbB = 0;

  private decay = 0.5;
  private damping = 0.3;
  private bandwidth = 0.9995;
  private predelay = 0;
  private excDepth = 0;
  private mix = 0.35;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    const k = sampleRate / REF_RATE;
    const scale = (n: number) => Math.max(1, Math.round(n * k));
    this.excScale = EXCURSION * k;
    const excMax = this.excScale * MOD_DEPTH_MAX;

    this.preLine = new DelayLine(Math.ceil(PREDELAY_MAX * sampleRate) + 8);
    this.preSm = new Smoother(sampleRate, 0.05);
    for (let i = 0; i < DIFF_LEN.length; i++) {
      this.diffusers.push(new TappedAllpass(scale(DIFF_LEN[i]), DIFF_G[i]));
    }
    this.apA1 = new ModAllpass(scale(TANK.apA1), DECAY_DIFF_1, excMax);
    this.delA1 = new TankDelay(scale(TANK.delA1));
    this.apA2 = new TappedAllpass(scale(TANK.apA2), DECAY_DIFF_2);
    this.delA2 = new TankDelay(scale(TANK.delA2));
    this.apB1 = new ModAllpass(scale(TANK.apB1), DECAY_DIFF_1, excMax);
    this.delB1 = new TankDelay(scale(TANK.delB1));
    this.apB2 = new TappedAllpass(scale(TANK.apB2), DECAY_DIFF_2);
    this.delB2 = new TankDelay(scale(TANK.delB2));
    this.lfoA = new Lfo(sampleRate);
    this.lfoA.setFreq(1.0);
    this.lfoB = new Lfo(sampleRate);
    this.lfoB.setFreq(0.7);
    this.lfoB.reset(0.25);
    this.tapsL = TAPS_L.map(scale);
    this.tapsR = TAPS_R.map(scale);

    for (const s of PLATE_PARAMS) this.setParam(s.name, params[s.name] ?? s.default);
    this.preSm.snap(this.predelay * sampleRate);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'decay':
        this.decay = clamp(value, 0, 0.98);
        break;
      case 'damping':
        this.damping = clamp(value, 0, 0.99);
        break;
      case 'bandwidth':
        this.bandwidth = clamp(value, 0, 1);
        break;
      case 'predelay':
        this.predelay = clamp(value, 0, PREDELAY_MAX);
        this.preSm.setTarget(this.predelay * this.sampleRate);
        break;
      case 'modDepth':
        this.excDepth = clamp(value, 0, MOD_DEPTH_MAX) * this.excScale;
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const decay = this.decay;
    const damp = this.damping;
    const bw = this.bandwidth;
    const mix = this.mix;
    const dry = 1 - mix;
    const tL = this.tapsL;
    const tR = this.tapsR;
    for (let i = from; i < to; i++) {
      this.preLine.write(0.5 * (l[i] + r[i]));
      let x = this.preLine.readLinear(this.preSm.next());
      this.bwState += bw * (x - this.bwState);
      x = this.bwState;
      x = this.diffusers[3].next(
        this.diffusers[2].next(this.diffusers[1].next(this.diffusers[0].next(x))),
      );

      const excA = this.excDepth === 0 ? 0 : this.excDepth * this.lfoA.next();
      const excB = this.excDepth === 0 ? 0 : this.excDepth * this.lfoB.next();

      // Branch A, fed by the diffused input plus branch B's far end.
      let a = x + decay * this.fbB;
      a = this.apA1.nextMod(a, excA);
      const dA = this.delA1.push(a);
      this.dampAState += (1 - damp) * (dA - this.dampAState);
      const outA = this.delA2.push(this.apA2.next(this.dampAState * decay));

      // Branch B, fed by the diffused input plus branch A's far end
      // from the previous sample, keeping the figure eight symmetric.
      let b = x + decay * this.fbA;
      b = this.apB1.nextMod(b, excB);
      const dB = this.delB1.push(b);
      this.dampBState += (1 - damp) * (dB - this.dampBState);
      const outB = this.delB2.push(this.apB2.next(this.dampBState * decay));

      this.fbA = outA;
      this.fbB = outB;

      const yl =
        0.6 *
        (this.delB1.tap(tL[0]) +
          this.delB1.tap(tL[1]) -
          this.apB2.tap(tL[2]) +
          this.delB2.tap(tL[3]) -
          this.delA1.tap(tL[4]) -
          this.apA2.tap(tL[5]) -
          this.delA2.tap(tL[6]));
      const yr =
        0.6 *
        (this.delA1.tap(tR[0]) +
          this.delA1.tap(tR[1]) -
          this.apA2.tap(tR[2]) +
          this.delA2.tap(tR[3]) -
          this.delB1.tap(tR[4]) -
          this.apB2.tap(tR[5]) -
          this.delB2.tap(tR[6]));

      l[i] = dry * l[i] + mix * yl;
      r[i] = dry * r[i] + mix * yr;
    }
  }

  reset(): void {
    this.preLine.clear();
    this.preSm.snap(this.predelay * this.sampleRate);
    for (const d of this.diffusers) d.reset();
    this.apA1.reset();
    this.delA1.reset();
    this.apA2.reset();
    this.delA2.reset();
    this.apB1.reset();
    this.delB1.reset();
    this.apB2.reset();
    this.delB2.reset();
    this.lfoA.reset();
    this.lfoB.reset(0.25);
    this.bwState = 0;
    this.dampAState = 0;
    this.dampBState = 0;
    this.fbA = 0;
    this.fbB = 0;
  }
}

export const plateDef: EffectDef = {
  id: 'plate',
  label: 'Plate Reverb',
  params: PLATE_PARAMS,
  create: (sampleRate, params) => new PlateReverb(sampleRate, params),
};
