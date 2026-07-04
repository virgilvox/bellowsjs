/*
 * Drum engines: kick, snare, hat, clap, tom. Each is its own EngineDef so
 * a kit maps one engine per pad. All of them tune from the noteOn
 * frequency, so kits are playable up and down the keyboard, and all use
 * one shot exponential envelopes: a voice decays to silence on its own
 * and noteOff only shortens the tail (choke).
 *
 * ExpDecay levels fall 60 dB in the configured time; a voice reports
 * inactive once every envelope is below 1e-4 (-80 dB).
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { BlepOscillator } from '../dsp/oscillators';
import { NoiseGen } from '../dsp/noise';
import { Svf } from '../dsp/filters';
import { tanhShape } from '../dsp/waveshaper';

const TWO_PI = Math.PI * 2;
/** ln(1000): ExpDecay covers 60 dB in the set time. */
const DECAY_RATE = Math.log(1000);
const SILENCE = 1e-4;
/** Choke tail applied by noteOff, seconds. */
const CHOKE_TIME = 0.03;

class ExpDecay {
  private readonly sampleRate: number;
  level = 0;
  private coef = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setTime(sec: number): void {
    this.coef = sec <= 0 ? 0 : Math.exp(-DECAY_RATE / (sec * this.sampleRate));
  }

  trigger(v = 1): void {
    this.level = v;
  }

  next(): number {
    const y = this.level;
    this.level = y * this.coef;
    return y;
  }
}

function fillDefaults(specs: ParamSpec[], given: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of specs) out[s.name] = given[s.name] !== undefined ? given[s.name] : s.default;
  return out;
}

/* ------------------------------------------------------------------ */
/* Kick                                                                */
/* ------------------------------------------------------------------ */

const KICK_PARAMS: ParamSpec[] = [
  { name: 'clickTune', min: 1, max: 16, default: 6 },
  { name: 'pitchDecay', min: 0.005, max: 0.5, default: 0.05, curve: 'exp', unit: 's' },
  { name: 'decay', min: 0.05, max: 2, default: 0.4, curve: 'exp', unit: 's' },
  { name: 'drive', min: 0, max: 10, default: 2 },
];

class KickVoice implements Voice {
  private readonly sampleRate: number;
  private readonly p: Record<string, number>;
  private readonly amp: ExpDecay;
  private readonly pitch: ExpDecay;
  private phase = 0;
  private base = 50;
  private vel = 1;

  constructor(sampleRate: number, params: Record<string, number>, _rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.p = fillDefaults(KICK_PARAMS, params);
    this.amp = new ExpDecay(sampleRate);
    this.pitch = new ExpDecay(sampleRate);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    this.amp.setTime(this.p.decay);
    this.pitch.setTime(this.p.pitchDecay);
  }

  noteOn(freq: number, vel: number): void {
    this.base = freq;
    this.vel = vel;
    this.phase = 0;
    this.apply();
    this.amp.trigger();
    this.pitch.trigger();
  }

  noteOff(): void {
    this.amp.setTime(CHOKE_TIME);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const p = this.p;
    const sr = this.sampleRate;
    const span = p.clickTune - 1;
    for (let i = from; i < to; i++) {
      const f = this.base * (1 + span * this.pitch.next());
      this.phase += f / sr;
      if (this.phase >= 1) this.phase -= 1;
      const y = tanhShape(Math.sin(TWO_PI * this.phase), p.drive) * this.amp.next() * this.vel;
      outL[i] += y * Math.SQRT1_2;
      outR[i] += y * Math.SQRT1_2;
    }
  }

  get active(): boolean {
    return this.amp.level > SILENCE;
  }
}

export const kickEngine: EngineDef = {
  id: 'kick',
  label: 'Kick',
  params: KICK_PARAMS,
  polyphony: 4,
  createVoice: (sampleRate, params, rng) => new KickVoice(sampleRate, params, rng),
};

/* ------------------------------------------------------------------ */
/* Snare                                                               */
/* ------------------------------------------------------------------ */

const SNARE_PARAMS: ParamSpec[] = [
  { name: 'tone', min: 0, max: 1, default: 0.5 },
  { name: 'decay', min: 0.05, max: 1, default: 0.18, curve: 'exp', unit: 's' },
  { name: 'snap', min: 0.02, max: 1, default: 0.15, curve: 'exp', unit: 's' },
];

/** Second drum mode of the shell, relative to the fundamental. */
const SNARE_MODE2 = 1.6;
const SNARE_HP_HZ = 1800;

class SnareVoice implements Voice {
  private readonly p: Record<string, number>;
  private readonly osc1: BlepOscillator;
  private readonly osc2: BlepOscillator;
  private readonly noise: NoiseGen;
  private readonly hp: Svf;
  private readonly bodyEnv: ExpDecay;
  private readonly noiseEnv: ExpDecay;
  private vel = 1;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.p = fillDefaults(SNARE_PARAMS, params);
    this.osc1 = new BlepOscillator(sampleRate);
    this.osc1.setShape('triangle');
    this.osc2 = new BlepOscillator(sampleRate);
    this.osc2.setShape('triangle');
    this.noise = new NoiseGen(sampleRate, 'white', rng.fork('snare/noise'));
    this.hp = new Svf(sampleRate);
    this.hp.setMode('hp');
    this.hp.set(SNARE_HP_HZ, 0.7071);
    this.bodyEnv = new ExpDecay(sampleRate);
    this.noiseEnv = new ExpDecay(sampleRate);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    this.bodyEnv.setTime(this.p.decay);
    this.noiseEnv.setTime(this.p.snap);
  }

  noteOn(freq: number, vel: number): void {
    this.vel = vel;
    this.osc1.setFreq(freq);
    this.osc2.setFreq(freq * SNARE_MODE2);
    this.osc1.reset(0);
    this.osc2.reset(0.25);
    this.hp.reset();
    this.apply();
    this.bodyEnv.trigger();
    this.noiseEnv.trigger();
  }

  noteOff(): void {
    this.bodyEnv.setTime(CHOKE_TIME);
    this.noiseEnv.setTime(CHOKE_TIME);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const tone = this.p.tone;
    const bodyGain = Math.cos((tone * Math.PI) / 2) * this.vel;
    const noiseGain = Math.sin((tone * Math.PI) / 2) * this.vel;
    for (let i = from; i < to; i++) {
      const body = (this.osc1.next() + this.osc2.next()) * 0.5 * this.bodyEnv.next();
      const nz = this.hp.next(this.noise.next()) * this.noiseEnv.next();
      const y = body * bodyGain + nz * noiseGain;
      outL[i] += y * Math.SQRT1_2;
      outR[i] += y * Math.SQRT1_2;
    }
  }

  get active(): boolean {
    return this.bodyEnv.level > SILENCE || this.noiseEnv.level > SILENCE;
  }
}

export const snareEngine: EngineDef = {
  id: 'snare',
  label: 'Snare',
  params: SNARE_PARAMS,
  polyphony: 4,
  createVoice: (sampleRate, params, rng) => new SnareVoice(sampleRate, params, rng),
};

/* ------------------------------------------------------------------ */
/* Hat                                                                 */
/* ------------------------------------------------------------------ */

const HAT_PARAMS: ParamSpec[] = [
  { name: 'decay', min: 0.02, max: 2, default: 0.08, curve: 'exp', unit: 's' },
  { name: 'tone', min: 0.2, max: 2, default: 1 },
];

/** 808 style metallic ratios, normalized to the lowest oscillator. */
const HAT_RATIOS = [1, 1.4831, 1.8004, 2.5459, 2.6303, 3.8971];
const HAT_HP_HZ = 7000;

class HatVoice implements Voice {
  private readonly sampleRate: number;
  private readonly p: Record<string, number>;
  private readonly oscs: BlepOscillator[];
  private readonly hp: Svf;
  private readonly amp: ExpDecay;
  private vel = 1;

  constructor(sampleRate: number, params: Record<string, number>, _rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.p = fillDefaults(HAT_PARAMS, params);
    this.oscs = [];
    for (let i = 0; i < HAT_RATIOS.length; i++) {
      const o = new BlepOscillator(sampleRate);
      o.setShape('square');
      this.oscs.push(o);
    }
    this.hp = new Svf(sampleRate);
    this.hp.setMode('hp');
    this.amp = new ExpDecay(sampleRate);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    this.amp.setTime(this.p.decay);
    const cut = Math.min(HAT_HP_HZ * this.p.tone, this.sampleRate * 0.45);
    this.hp.set(cut, 0.7071);
  }

  noteOn(freq: number, vel: number): void {
    this.vel = vel;
    for (let i = 0; i < this.oscs.length; i++) {
      this.oscs[i].setFreq(freq * HAT_RATIOS[i]);
      this.oscs[i].reset(0);
    }
    this.hp.reset();
    this.apply();
    this.amp.trigger();
  }

  noteOff(): void {
    this.amp.setTime(CHOKE_TIME);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const oscs = this.oscs;
    for (let i = from; i < to; i++) {
      let m = 0;
      for (let o = 0; o < oscs.length; o++) m += oscs[o].next();
      const y = this.hp.next(m / 6) * this.amp.next() * this.vel;
      outL[i] += y * Math.SQRT1_2;
      outR[i] += y * Math.SQRT1_2;
    }
  }

  get active(): boolean {
    return this.amp.level > SILENCE;
  }
}

export const hatEngine: EngineDef = {
  id: 'hat',
  label: 'Hat',
  params: HAT_PARAMS,
  polyphony: 4,
  createVoice: (sampleRate, params, rng) => new HatVoice(sampleRate, params, rng),
};

/* ------------------------------------------------------------------ */
/* Clap                                                                */
/* ------------------------------------------------------------------ */

const CLAP_PARAMS: ParamSpec[] = [
  { name: 'decay', min: 0.05, max: 2, default: 0.25, curve: 'exp', unit: 's' },
  { name: 'spread', min: 0.005, max: 0.05, default: 0.012, curve: 'exp', unit: 's' },
  { name: 'tone', min: 400, max: 4000, default: 1200, curve: 'exp', unit: 'Hz' },
];

/** Decay of the first two bursts, seconds. */
const CLAP_BURST_TIME = 0.006;

class ClapVoice implements Voice {
  private readonly sampleRate: number;
  private readonly p: Record<string, number>;
  private readonly noise: NoiseGen;
  private readonly bp: Svf;
  private readonly env: ExpDecay;
  private t = 0;
  private burst = 0;
  /** Sample count at which the next burst retriggers. */
  private nextBurst = 0;
  private base = 220;
  private vel = 1;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.p = fillDefaults(CLAP_PARAMS, params);
    this.noise = new NoiseGen(sampleRate, 'white', rng.fork('clap/noise'));
    this.bp = new Svf(sampleRate);
    this.bp.setMode('bp');
    this.env = new ExpDecay(sampleRate);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    // tone is the bandpass center in Hz when played at 220 Hz; it tracks the note
    this.bp.set(Math.min(this.p.tone * (this.base / 220), this.sampleRate * 0.45), 2);
  }

  noteOn(freq: number, vel: number): void {
    this.base = freq;
    this.vel = vel;
    this.t = 0;
    this.bp.reset();
    this.apply();
    this.env.setTime(CLAP_BURST_TIME);
    this.env.trigger();
    this.burst = 1;
    this.nextBurst = this.spreadSamples();
  }

  private spreadSamples(): number {
    return Math.max(1, Math.round(this.p.spread * this.sampleRate));
  }

  noteOff(): void {
    this.env.setTime(CHOKE_TIME);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    for (let i = from; i < to; i++) {
      // The burst time is latched at noteOn and advanced monotonically on
      // each retrigger, so automating spread mid-burst can never move the
      // target behind the counter and strand the voice active.
      if (this.burst > 0 && this.burst < 3 && this.t >= this.nextBurst) {
        // retrigger; the third burst carries the long tail
        this.env.setTime(this.burst === 2 ? this.p.decay : CLAP_BURST_TIME);
        this.env.trigger();
        this.burst++;
        this.nextBurst = this.t + this.spreadSamples();
      }
      this.t++;
      const y = this.bp.next(this.noise.next()) * this.env.next() * this.vel;
      outL[i] += y * Math.SQRT1_2;
      outR[i] += y * Math.SQRT1_2;
    }
  }

  get active(): boolean {
    return this.env.level > SILENCE || (this.burst > 0 && this.burst < 3);
  }
}

export const clapEngine: EngineDef = {
  id: 'clap',
  label: 'Clap',
  params: CLAP_PARAMS,
  polyphony: 4,
  createVoice: (sampleRate, params, rng) => new ClapVoice(sampleRate, params, rng),
};

/* ------------------------------------------------------------------ */
/* Tom                                                                 */
/* ------------------------------------------------------------------ */

const TOM_PARAMS: ParamSpec[] = [
  { name: 'decay', min: 0.05, max: 2, default: 0.35, curve: 'exp', unit: 's' },
  { name: 'sweep', min: 0.01, max: 0.5, default: 0.08, curve: 'exp', unit: 's' },
  { name: 'noise', min: 0, max: 1, default: 0.15 },
];

/** Pitch starts this far above the base frequency, as a multiplier - 1. */
const TOM_SWEEP_SPAN = 1.5;
const TOM_NOISE_TIME = 0.02;
const TOM_NOISE_LP_HZ = 3000;

class TomVoice implements Voice {
  private readonly sampleRate: number;
  private readonly p: Record<string, number>;
  private readonly noise: NoiseGen;
  private readonly lp: Svf;
  private readonly amp: ExpDecay;
  private readonly pitch: ExpDecay;
  private readonly noiseEnv: ExpDecay;
  private phase = 0;
  private base = 100;
  private vel = 1;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sampleRate = sampleRate;
    this.p = fillDefaults(TOM_PARAMS, params);
    this.noise = new NoiseGen(sampleRate, 'white', rng.fork('tom/noise'));
    this.lp = new Svf(sampleRate);
    this.lp.setMode('lp');
    this.lp.set(TOM_NOISE_LP_HZ, 0.7071);
    this.amp = new ExpDecay(sampleRate);
    this.pitch = new ExpDecay(sampleRate);
    this.noiseEnv = new ExpDecay(sampleRate);
    this.noiseEnv.setTime(TOM_NOISE_TIME);
    this.apply();
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    this.apply();
  }

  private apply(): void {
    this.amp.setTime(this.p.decay);
    this.pitch.setTime(this.p.sweep);
  }

  noteOn(freq: number, vel: number): void {
    this.base = freq;
    this.vel = vel;
    this.phase = 0;
    this.lp.reset();
    this.apply();
    this.noiseEnv.setTime(TOM_NOISE_TIME);
    this.amp.trigger();
    this.pitch.trigger();
    this.noiseEnv.trigger();
  }

  noteOff(): void {
    this.amp.setTime(CHOKE_TIME);
    this.noiseEnv.setTime(CHOKE_TIME);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const sr = this.sampleRate;
    const nzLevel = this.p.noise;
    for (let i = from; i < to; i++) {
      const f = this.base * (1 + TOM_SWEEP_SPAN * this.pitch.next());
      this.phase += f / sr;
      if (this.phase >= 1) this.phase -= 1;
      const body = Math.sin(TWO_PI * this.phase) * this.amp.next();
      const nz = this.lp.next(this.noise.next()) * this.noiseEnv.next() * nzLevel;
      const y = (body + nz) * this.vel;
      outL[i] += y * Math.SQRT1_2;
      outR[i] += y * Math.SQRT1_2;
    }
  }

  get active(): boolean {
    return this.amp.level > SILENCE || this.noiseEnv.level > SILENCE;
  }
}

export const tomEngine: EngineDef = {
  id: 'tom',
  label: 'Tom',
  params: TOM_PARAMS,
  polyphony: 4,
  createVoice: (sampleRate, params, rng) => new TomVoice(sampleRate, params, rng),
};
