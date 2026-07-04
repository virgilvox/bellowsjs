/*
 * Extended Karplus-Strong plucked string.
 *
 * Single delay loop: fractional Catmull-Rom read, one pole lowpass loop
 * damping, per sample loop gain setting the decay time. The read delay
 * compensates the one sample write-to-read latency and the damping
 * filter's phase delay at the fundamental, so pitch lands within a
 * couple of cents.
 *
 * Excitation is a one period burst injected into the loop: a blend of
 * an rng noise burst and a narrow impulse (exciteType 0 = noise,
 * 1 = impulse), comb filtered by the virtual pick position (pickPos)
 * before injection. noteOff caps the decay time so gated playing works.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { DelayLine } from '../dsp/delayline';

const MIN_FREQ = 20;
const TWO_PI = Math.PI * 2;
/** Decay time cap applied at noteOff, seconds. */
const RELEASE_T60 = 0.18;
/** Amplitude tracker release time constant, seconds. */
const TRACK_TAU = 0.05;
/** Below this tracked amplitude the voice is reclaimable. */
const SILENCE = 1e-4;

function p(params: Record<string, number>, name: string, dflt: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/** Phase delay in samples of y[n] = a x[n] + (1-a) y[n-1] at radian frequency w. */
function onePolePhaseDelay(a: number, w: number): number {
  const b = 1 - a;
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}

class PluckVoice implements Voice {
  private readonly sr: number;
  private readonly rng: NamedRng;
  private readonly delay: DelayLine;
  private readonly excite: Float32Array;
  private exciteLen = 0;
  private excitePos = 0;

  private readDelay = 2;
  private lpA = 1;
  private lpB = 0;
  private lpState = 0;
  private gs = 0;
  private freq = 440;
  private gate = false;
  private live = false;
  private tracker = 0;
  private readonly trackCoef: number;

  private damp: number;
  private pickPos: number;
  private exciteType: number;
  private decaySec: number;
  private level: number;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sr = sampleRate;
    this.rng = rng;
    const maxSamples = Math.ceil(sampleRate / MIN_FREQ) + 4;
    this.delay = new DelayLine(maxSamples);
    // room for one period plus the pick position comb tail
    this.excite = new Float32Array(2 * maxSamples);
    this.trackCoef = Math.exp(-1 / (TRACK_TAU * sampleRate));
    this.damp = p(params, 'damp', 0.35);
    this.pickPos = p(params, 'pickPos', 0.28);
    this.exciteType = p(params, 'exciteType', 0);
    this.decaySec = p(params, 'decay', 2.5);
    this.level = p(params, 'level', 0.9);
  }

  noteOn(freq: number, vel: number): void {
    this.freq = clamp(freq, MIN_FREQ, this.sr / 8);
    this.gate = true;
    this.live = true;
    this.delay.clear();
    this.lpState = 0;
    this.updateLoop();

    // One period excitation burst: noise blended with a narrow impulse.
    const n = this.sr / this.freq;
    const len = Math.max(2, Math.round(n));
    const type = clamp(this.exciteType, 0, 1);
    const amp = 0.6 * clamp(vel, 0, 1);
    for (let i = 0; i < len; i++) {
      const noise = 2 * this.rng() - 1;
      const imp = i === 0 ? 1 : i === 1 ? 0.4 : 0;
      this.excite[i] = ((1 - type) * noise + type * imp * 1.6) * amp;
    }
    // Feed-forward comb 1 - z^-D at the pick position: zeros where a
    // pluck at that fraction of the string excites no energy. The full
    // linear convolution runs combD past the burst, so the injection is
    // extended rather than truncated (truncating breaks the notches).
    const combD = Math.round(clamp(this.pickPos, 0, 0.95) * n);
    let total = len;
    if (combD >= 1) {
      total = len + combD;
      for (let i = len; i < total; i++) this.excite[i] = 0;
      for (let i = total - 1; i >= combD; i--) this.excite[i] -= this.excite[i - combD];
    }
    this.exciteLen = total;
    this.excitePos = 0;
    this.tracker = Math.max(amp, 0.01);
  }

  noteOff(): void {
    this.gate = false;
    this.updateLoop();
  }

  private updateLoop(): void {
    const n = this.sr / this.freq;
    const fc = Math.min(18000 * Math.pow(800 / 18000, clamp(this.damp, 0, 1)), this.sr * 0.45);
    const a = 1 - Math.exp((-TWO_PI * fc) / this.sr);
    this.lpA = a;
    this.lpB = 1 - a;
    const w = (TWO_PI * this.freq) / this.sr;
    const pd = onePolePhaseDelay(a, w);
    this.readDelay = Math.max(1, n - 1 - pd);
    const t60 = this.gate
      ? clamp(this.decaySec, 0.05, 20)
      : Math.min(clamp(this.decaySec, 0.05, 20), RELEASE_T60);
    // The circulating wave meets this gain once per period, so the loss
    // per pass is set against the period count in t60 seconds.
    this.gs = Math.pow(10, -3 / (t60 * this.freq));
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const level = this.level;
    for (let i = from; i < to; i++) {
      const y = this.delay.readCubic(this.readDelay);
      this.lpState = this.lpA * y + this.lpB * this.lpState;
      let s = this.lpState * this.gs;
      if (this.excitePos < this.exciteLen) s += this.excite[this.excitePos++];
      this.delay.write(s);
      const o = s * level;
      outL[i] += o;
      outR[i] += o;
      const as = Math.abs(s);
      this.tracker = as > this.tracker ? as : this.tracker * this.trackCoef;
    }
    if (this.tracker < SILENCE && this.excitePos >= this.exciteLen) this.live = false;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'damp':
        this.damp = value;
        if (this.live) this.updateLoop();
        break;
      case 'pickPos':
        this.pickPos = value;
        break;
      case 'exciteType':
        this.exciteType = value;
        break;
      case 'decay':
        this.decaySec = value;
        if (this.live) this.updateLoop();
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
  { name: 'damp', min: 0, max: 1, default: 0.35 },
  { name: 'pickPos', min: 0, max: 0.95, default: 0.28 },
  { name: 'exciteType', min: 0, max: 1, default: 0 },
  { name: 'decay', min: 0.05, max: 20, default: 2.5, curve: 'exp', unit: 's' },
  { name: 'level', min: 0, max: 1, default: 0.9 },
];

export const pluckEngine: EngineDef = {
  id: 'pluck',
  label: 'Pluck',
  params,
  polyphony: 16,
  createVoice: (sampleRate, initParams, rng) => new PluckVoice(sampleRate, initParams, rng),
};
