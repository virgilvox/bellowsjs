/*
 * Delay effects: a clean stereo delay with cross feedback, a tape echo
 * with wow, flutter and loop saturation, and a four tap multitap with
 * diffusion. All three are stereo in-place Effects.
 *
 * Delay times run through one-pole Smoothers and reads use the cubic
 * interpolator, so a time change glides like varispeed instead of
 * clicking. Feedback paths are read before the write of the current
 * sample, giving each loop its natural one-period latency.
 */

import type { Effect, EffectDef, ParamSpec, Rng } from '../types';
import { clamp } from '../types';
import { rng } from '../core/prng';
import { DelayLine } from '../dsp/delayline';
import { Smoother } from '../dsp/envelopes';
import { OnePole, Svf } from '../dsp/filters';
import { Lfo } from '../dsp/lfo';

/** Apply spec defaults, then caller overrides, through setParam. */
function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): void {
  for (const s of specs) fx.setParam(s.name, params[s.name] ?? s.default);
}

/**
 * Schroeder allpass on a DelayLine: H(z) = (-g + z^-D) / (1 - g z^-D).
 * Unity magnitude at every frequency, so serial chains diffuse without
 * coloring the long-term spectrum.
 */
class Allpass {
  private readonly dl: DelayLine;
  private readonly len: number;
  g: number;

  constructor(lenSamples: number, g: number) {
    this.len = Math.max(1, lenSamples | 0);
    this.dl = new DelayLine(this.len + 4);
    this.g = g;
  }

  next(x: number): number {
    const z = this.dl.readInt(this.len - 1);
    const v = x + this.g * z;
    this.dl.write(v);
    return z - this.g * v;
  }

  reset(): void {
    this.dl.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Clean stereo delay                                                  */
/* ------------------------------------------------------------------ */

const DELAY_MAX_SEC = 4;

const DELAY_PARAMS: ParamSpec[] = [
  { name: 'timeL', min: 0.001, max: DELAY_MAX_SEC, default: 0.35, curve: 'exp', unit: 's' },
  { name: 'timeR', min: 0.001, max: DELAY_MAX_SEC, default: 0.5, curve: 'exp', unit: 's' },
  { name: 'feedback', min: 0, max: 0.99, default: 0.4 },
  { name: 'crossFeedback', min: 0, max: 1, default: 0 },
  { name: 'damping', min: 200, max: 20000, default: 8000, curve: 'exp', unit: 'Hz' },
  { name: 'mix', min: 0, max: 1, default: 0.35 },
];

class StereoDelay implements Effect {
  private readonly sampleRate: number;
  private readonly lineL: DelayLine;
  private readonly lineR: DelayLine;
  private readonly dampL: OnePole;
  private readonly dampR: OnePole;
  private readonly smL: Smoother;
  private readonly smR: Smoother;
  private timeL = 0.35;
  private timeR = 0.5;
  private feedback = 0.4;
  private cross = 0;
  private mix = 0.35;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    const cap = Math.ceil(DELAY_MAX_SEC * sampleRate) + 8;
    this.lineL = new DelayLine(cap);
    this.lineR = new DelayLine(cap);
    this.dampL = new OnePole(sampleRate);
    this.dampR = new OnePole(sampleRate);
    this.smL = new Smoother(sampleRate, 0.15);
    this.smR = new Smoother(sampleRate, 0.15);
    applyParams(this, DELAY_PARAMS, params);
    this.smL.snap(this.timeL * sampleRate);
    this.smR.snap(this.timeR * sampleRate);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'timeL':
        this.timeL = clamp(value, 0.001, DELAY_MAX_SEC);
        this.smL.setTarget(this.timeL * this.sampleRate);
        break;
      case 'timeR':
        this.timeR = clamp(value, 0.001, DELAY_MAX_SEC);
        this.smR.setTarget(this.timeR * this.sampleRate);
        break;
      case 'feedback':
        this.feedback = clamp(value, 0, 0.99);
        break;
      case 'crossFeedback':
        this.cross = clamp(value, 0, 1);
        break;
      case 'damping': {
        const hz = clamp(value, 200, 20000);
        this.dampL.setLowpass(hz);
        this.dampR.setLowpass(hz);
        break;
      }
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const fb = this.feedback;
    const x = this.cross;
    const mix = this.mix;
    const dry = 1 - mix;
    for (let i = from; i < to; i++) {
      const dL = this.smL.next();
      const dR = this.smR.next();
      // Read before write: readCubic(d - 1) is the sample d writes back
      // once this sample's write lands.
      const wetL = this.lineL.readCubic(dL - 1);
      const wetR = this.lineR.readCubic(dR - 1);
      const fbL = this.dampL.next(fb * ((1 - x) * wetL + x * wetR));
      const fbR = this.dampR.next(fb * ((1 - x) * wetR + x * wetL));
      this.lineL.write(l[i] + fbL);
      this.lineR.write(r[i] + fbR);
      l[i] = dry * l[i] + mix * wetL;
      r[i] = dry * r[i] + mix * wetR;
    }
  }

  reset(): void {
    this.lineL.clear();
    this.lineR.clear();
    this.dampL.reset();
    this.dampR.reset();
    this.smL.snap(this.timeL * this.sampleRate);
    this.smR.snap(this.timeR * this.sampleRate);
  }
}

export const delayDef: EffectDef = {
  id: 'delay',
  label: 'Stereo Delay',
  params: DELAY_PARAMS,
  create: (sampleRate, params) => new StereoDelay(sampleRate, params),
};

/* ------------------------------------------------------------------ */
/* Tape delay                                                          */
/* ------------------------------------------------------------------ */

const TAPE_MAX_SEC = 2;
/** Wow depth in seconds at wow = 1. */
const WOW_DEPTH_SEC = 0.004;
/** Flutter depth in seconds at flutter = 1. */
const FLUTTER_DEPTH_SEC = 0.0004;

const TAPE_PARAMS: ParamSpec[] = [
  { name: 'time', min: 0.005, max: TAPE_MAX_SEC, default: 0.35, curve: 'exp', unit: 's' },
  { name: 'feedback', min: 0, max: 1.1, default: 0.45 },
  { name: 'wow', min: 0, max: 1, default: 0.3 },
  { name: 'flutter', min: 0, max: 1, default: 0.15 },
  { name: 'saturation', min: 0, max: 1, default: 0.4 },
  { name: 'tone', min: 500, max: 15000, default: 4500, curve: 'exp', unit: 'Hz' },
  { name: 'hiss', min: 0, max: 1, default: 0 },
  { name: 'mix', min: 0, max: 1, default: 0.35 },
];

/** One tape channel: delay line plus the filters that live in its loop. */
class TapeHead {
  private readonly line: DelayLine;
  private readonly tone: OnePole;
  private readonly bump: Svf;

  constructor(sampleRate: number, capSamples: number) {
    this.line = new DelayLine(capSamples);
    this.tone = new OnePole(sampleRate);
    this.bump = new Svf(sampleRate);
    this.bump.setMode('bell');
    // Head bump: gentle low mid emphasis every trip around the loop.
    this.bump.set(90, 0.7, 3);
  }

  setTone(hz: number): void {
    this.tone.setLowpass(hz);
  }

  /** Read the wet tap, run the feedback path, write. Returns the wet sample. */
  tick(x: number, readPos: number, fb: number, drive: number, hiss: number): number {
    const wet = this.line.readCubic(readPos);
    let f = this.tone.next(fb * wet);
    f = this.bump.next(f);
    f = Math.tanh(drive * (f + hiss)) / drive;
    this.line.write(x + f);
    return wet;
  }

  reset(): void {
    this.line.clear();
    this.tone.reset();
    this.bump.reset();
  }
}

class TapeDelay implements Effect {
  private readonly sampleRate: number;
  private readonly headL: TapeHead;
  private readonly headR: TapeHead;
  private readonly sm: Smoother;
  private readonly wowLfo: Lfo;
  private readonly flutterLfo: Lfo;
  private readonly noise: Rng;
  private time = 0.35;
  private feedback = 0.45;
  private wowDepth = 0;
  private flutterDepth = 0;
  private drive = 1;
  private hissLevel = 0;
  private mix = 0.35;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    const cap = Math.ceil((TAPE_MAX_SEC + WOW_DEPTH_SEC + FLUTTER_DEPTH_SEC) * sampleRate) + 8;
    this.headL = new TapeHead(sampleRate, cap);
    this.headR = new TapeHead(sampleRate, cap);
    // Tape time changes slew slowly, that is most of the charm.
    this.sm = new Smoother(sampleRate, 0.3);
    this.wowLfo = new Lfo(sampleRate);
    this.wowLfo.setFreq(0.5);
    this.flutterLfo = new Lfo(sampleRate);
    this.flutterLfo.setFreq(6);
    // Fixed seed keeps hiss deterministic and identical across instances.
    this.noise = rng('fx/tapeDelay/hiss');
    applyParams(this, TAPE_PARAMS, params);
    this.sm.snap(this.time * sampleRate);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'time':
        this.time = clamp(value, 0.005, TAPE_MAX_SEC);
        this.sm.setTarget(this.time * this.sampleRate);
        break;
      case 'feedback':
        this.feedback = clamp(value, 0, 1.1);
        break;
      case 'wow':
        this.wowDepth = clamp(value, 0, 1) * WOW_DEPTH_SEC * this.sampleRate;
        break;
      case 'flutter':
        this.flutterDepth = clamp(value, 0, 1) * FLUTTER_DEPTH_SEC * this.sampleRate;
        break;
      case 'saturation':
        this.drive = 1 + 4 * clamp(value, 0, 1);
        break;
      case 'tone':
        this.headL.setTone(clamp(value, 500, 15000));
        this.headR.setTone(clamp(value, 500, 15000));
        break;
      case 'hiss':
        this.hissLevel = clamp(value, 0, 1) * 0.002;
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const fb = this.feedback;
    const drive = this.drive;
    const mix = this.mix;
    const dry = 1 - mix;
    const hissOn = this.hissLevel > 0;
    for (let i = from; i < to; i++) {
      const d = this.sm.next();
      // Both channels share the transport, so one wow and flutter pair.
      const mod =
        this.wowLfo.next() * this.wowDepth + this.flutterLfo.next() * this.flutterDepth;
      const pos = d - 1 + mod;
      const hL = hissOn ? (this.noise() * 2 - 1) * this.hissLevel : 0;
      const hR = hissOn ? (this.noise() * 2 - 1) * this.hissLevel : 0;
      const wetL = this.headL.tick(l[i], pos, fb, drive, hL);
      const wetR = this.headR.tick(r[i], pos, fb, drive, hR);
      l[i] = dry * l[i] + mix * wetL;
      r[i] = dry * r[i] + mix * wetR;
    }
  }

  reset(): void {
    this.headL.reset();
    this.headR.reset();
    this.wowLfo.reset();
    this.flutterLfo.reset();
    this.sm.snap(this.time * this.sampleRate);
  }
}

export const tapeDelayDef: EffectDef = {
  id: 'tapeDelay',
  label: 'Tape Delay',
  params: TAPE_PARAMS,
  create: (sampleRate, params) => new TapeDelay(sampleRate, params),
};

/* ------------------------------------------------------------------ */
/* Multitap                                                            */
/* ------------------------------------------------------------------ */

const MULTITAP_MAX_SEC = 2;
const TAP_COUNT = 4;
/** Diffusion allpass lengths in samples at 44100, slightly different per side. */
const MT_AP_L = [113, 173];
const MT_AP_R = [127, 181];

const MULTITAP_PARAMS: ParamSpec[] = [
  { name: 'time1', min: 0.001, max: MULTITAP_MAX_SEC, default: 0.125, curve: 'exp', unit: 's' },
  { name: 'time2', min: 0.001, max: MULTITAP_MAX_SEC, default: 0.25, curve: 'exp', unit: 's' },
  { name: 'time3', min: 0.001, max: MULTITAP_MAX_SEC, default: 0.375, curve: 'exp', unit: 's' },
  { name: 'time4', min: 0.001, max: MULTITAP_MAX_SEC, default: 0.5, curve: 'exp', unit: 's' },
  { name: 'level1', min: 0, max: 1, default: 1 },
  { name: 'level2', min: 0, max: 1, default: 0.8 },
  { name: 'level3', min: 0, max: 1, default: 0.6 },
  { name: 'level4', min: 0, max: 1, default: 0.45 },
  { name: 'diffusion', min: 0, max: 1, default: 0.4 },
  { name: 'mix', min: 0, max: 1, default: 0.5 },
];

class MultitapDelay implements Effect {
  private readonly sampleRate: number;
  private readonly lineL: DelayLine;
  private readonly lineR: DelayLine;
  private readonly smoothers: Smoother[] = [];
  private readonly times = new Float64Array(TAP_COUNT);
  private readonly levels = new Float64Array(TAP_COUNT);
  private readonly apL: Allpass[];
  private readonly apR: Allpass[];
  private mix = 0.5;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    const cap = Math.ceil(MULTITAP_MAX_SEC * sampleRate) + 8;
    this.lineL = new DelayLine(cap);
    this.lineR = new DelayLine(cap);
    for (let k = 0; k < TAP_COUNT; k++) this.smoothers.push(new Smoother(sampleRate, 0.1));
    const scale = sampleRate / 44100;
    this.apL = MT_AP_L.map((n) => new Allpass(Math.round(n * scale), 0));
    this.apR = MT_AP_R.map((n) => new Allpass(Math.round(n * scale), 0));
    applyParams(this, MULTITAP_PARAMS, params);
    for (let k = 0; k < TAP_COUNT; k++) this.smoothers[k].snap(this.times[k] * sampleRate);
  }

  setParam(name: string, value: number): void {
    if (name.length === 5 && name.startsWith('time')) {
      const k = name.charCodeAt(4) - 49; // '1' is 49
      if (k >= 0 && k < TAP_COUNT) {
        this.times[k] = clamp(value, 0.001, MULTITAP_MAX_SEC);
        this.smoothers[k].setTarget(this.times[k] * this.sampleRate);
        return;
      }
    }
    if (name.length === 6 && name.startsWith('level')) {
      const k = name.charCodeAt(5) - 49;
      if (k >= 0 && k < TAP_COUNT) {
        this.levels[k] = clamp(value, 0, 1);
        return;
      }
    }
    if (name === 'diffusion') {
      const g = clamp(value, 0, 1) * 0.7;
      for (const ap of this.apL) ap.g = g;
      for (const ap of this.apR) ap.g = g;
    } else if (name === 'mix') {
      this.mix = clamp(value, 0, 1);
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const mix = this.mix;
    const dry = 1 - mix;
    for (let i = from; i < to; i++) {
      // Write first: no feedback, so taps read the current history directly.
      this.lineL.write(l[i]);
      this.lineR.write(r[i]);
      let wetL = 0;
      let wetR = 0;
      for (let k = 0; k < TAP_COUNT; k++) {
        const d = this.smoothers[k].next();
        const lv = this.levels[k];
        wetL += lv * this.lineL.readCubic(d);
        wetR += lv * this.lineR.readCubic(d);
      }
      wetL = this.apL[1].next(this.apL[0].next(wetL));
      wetR = this.apR[1].next(this.apR[0].next(wetR));
      l[i] = dry * l[i] + mix * wetL;
      r[i] = dry * r[i] + mix * wetR;
    }
  }

  reset(): void {
    this.lineL.clear();
    this.lineR.clear();
    for (const ap of this.apL) ap.reset();
    for (const ap of this.apR) ap.reset();
    for (let k = 0; k < TAP_COUNT; k++) this.smoothers[k].snap(this.times[k] * this.sampleRate);
  }
}

export const multitapDef: EffectDef = {
  id: 'multitap',
  label: 'Multitap Delay',
  params: MULTITAP_PARAMS,
  create: (sampleRate, params) => new MultitapDelay(sampleRate, params),
};
