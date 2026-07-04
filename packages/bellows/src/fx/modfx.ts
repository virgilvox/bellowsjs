/*
 * Modulation effects: chorus, flanger, phaser, tremolo, autopan, ring mod.
 * All are stereo in-place Effects (src/types.ts). Sweep positions come from
 * Lfo instances offset in phase for stereo width; delay based effects read
 * a DelayLine with cubic interpolation. Each EffectDef const at the bottom
 * carries the parameter surface. Nothing here self-registers.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp } from '../types';
import { DelayLine } from '../dsp/delayline';
import { Lfo, type LfoShape } from '../dsp/lfo';
import { SineOscillator } from '../dsp/oscillators';

/** Numeric shape param mapping shared by tremolo and autopan. */
const LFO_SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'saw', 'square', 'sh'];

function shapeFor(value: number): LfoShape {
  return LFO_SHAPES[clamp(Math.round(value), 0, LFO_SHAPES.length - 1)];
}

/** Apply spec defaults overridden by the caller's params. */
function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): Effect {
  for (const spec of specs) fx.setParam(spec.name, params[spec.name] ?? spec.default);
  return fx;
}

/* ------------------------------------------------------------------ */
/* Chorus                                                              */
/* ------------------------------------------------------------------ */

const CHORUS_TAPS = 3;
/** Tap centers sit inside the 5..30 ms window with 5 ms of sweep room each way. */
const CHORUS_CENTER_MS = [10, 17.5, 25] as const;
const CHORUS_MOD_MS = 5;

/**
 * Three modulated delay taps per channel, averaged. Each tap has its own
 * sine Lfo; taps are spread a third of a cycle apart and the right channel
 * runs a quarter cycle (90 degrees) ahead of the left for stereo width.
 */
class Chorus implements Effect {
  private readonly lineL: DelayLine;
  private readonly lineR: DelayLine;
  private readonly lfoL: Lfo[] = [];
  private readonly lfoR: Lfo[] = [];
  private readonly centers = new Float64Array(CHORUS_TAPS);
  /** Sweep amplitude in samples at depth 1. */
  private readonly modScale: number;
  private modAmp = 0;
  private mix = 0.5;
  private feedback = 0;
  private fbL = 0;
  private fbR = 0;

  constructor(sampleRate: number) {
    const max = Math.ceil(0.031 * sampleRate);
    this.lineL = new DelayLine(max);
    this.lineR = new DelayLine(max);
    this.modScale = CHORUS_MOD_MS * 0.001 * sampleRate;
    for (let t = 0; t < CHORUS_TAPS; t++) {
      this.centers[t] = CHORUS_CENTER_MS[t] * 0.001 * sampleRate;
      const a = new Lfo(sampleRate);
      const b = new Lfo(sampleRate);
      a.reset(t / CHORUS_TAPS);
      b.reset(t / CHORUS_TAPS + 0.25);
      this.lfoL.push(a);
      this.lfoR.push(b);
    }
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'rate': {
        const hz = clamp(value, 0, 20);
        for (let t = 0; t < CHORUS_TAPS; t++) {
          this.lfoL[t].setFreq(hz);
          this.lfoR[t].setFreq(hz);
        }
        break;
      }
      case 'depth':
        this.modAmp = clamp(value, 0, 1) * this.modScale;
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
      case 'feedback':
        this.feedback = clamp(value, 0, 0.5);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const dry = 1 - this.mix;
    const wet = this.mix / CHORUS_TAPS;
    for (let i = from; i < to; i++) {
      const xl = l[i];
      const xr = r[i];
      this.lineL.write(xl + this.feedback * this.fbL);
      this.lineR.write(xr + this.feedback * this.fbR);
      let wl = 0;
      let wr = 0;
      for (let t = 0; t < CHORUS_TAPS; t++) {
        wl += this.lineL.readCubic(this.centers[t] + this.modAmp * this.lfoL[t].next());
        wr += this.lineR.readCubic(this.centers[t] + this.modAmp * this.lfoR[t].next());
      }
      this.fbL = wl / CHORUS_TAPS;
      this.fbR = wr / CHORUS_TAPS;
      l[i] = dry * xl + wet * wl;
      r[i] = dry * xr + wet * wr;
    }
  }

  reset(): void {
    this.lineL.clear();
    this.lineR.clear();
    this.fbL = 0;
    this.fbR = 0;
    for (let t = 0; t < CHORUS_TAPS; t++) {
      this.lfoL[t].reset(t / CHORUS_TAPS);
      this.lfoR[t].reset(t / CHORUS_TAPS + 0.25);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Flanger                                                             */
/* ------------------------------------------------------------------ */

const FLANGER_MIN_MS = 0.5;
const FLANGER_MAX_MS = 10;

/**
 * Single short modulated delay per channel with feedback. One shared Lfo
 * sweeps both channels. manual places the center delay inside the
 * 0.5..10 ms window, depth scales the sweep, and the swept delay is
 * clamped back into the window.
 */
class Flanger implements Effect {
  private readonly lineL: DelayLine;
  private readonly lineR: DelayLine;
  private readonly lfo: Lfo;
  private readonly minS: number;
  private readonly maxS: number;
  private readonly msToSamples: number;
  private centerS: number;
  private ampS = 0;
  private depth = 0;
  private feedback = 0;
  private mix = 0.5;
  private invert = false;
  private fbL = 0;
  private fbR = 0;

  constructor(sampleRate: number) {
    this.msToSamples = 0.001 * sampleRate;
    const max = Math.ceil((FLANGER_MAX_MS + 1) * this.msToSamples);
    this.lineL = new DelayLine(max);
    this.lineR = new DelayLine(max);
    this.lfo = new Lfo(sampleRate);
    this.minS = FLANGER_MIN_MS * this.msToSamples;
    this.maxS = FLANGER_MAX_MS * this.msToSamples;
    this.centerS = FLANGER_MIN_MS * this.msToSamples;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'rate':
        this.lfo.setFreq(clamp(value, 0, 20));
        break;
      case 'depth':
        this.depth = clamp(value, 0, 1);
        this.ampS = this.depth * 0.5 * (FLANGER_MAX_MS - FLANGER_MIN_MS) * this.msToSamples;
        break;
      case 'manual': {
        const ms = FLANGER_MIN_MS + clamp(value, 0, 1) * (FLANGER_MAX_MS - FLANGER_MIN_MS);
        this.centerS = ms * this.msToSamples;
        break;
      }
      case 'feedback':
        this.feedback = clamp(value, 0, 0.9);
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
      case 'invert':
        this.invert = value >= 0.5;
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const dry = 1 - this.mix;
    const sign = this.invert ? -this.mix : this.mix;
    for (let i = from; i < to; i++) {
      let d = this.centerS + this.ampS * this.lfo.next();
      if (d < this.minS) d = this.minS;
      else if (d > this.maxS) d = this.maxS;
      const xl = l[i];
      const xr = r[i];
      this.lineL.write(xl + this.feedback * this.fbL);
      this.lineR.write(xr + this.feedback * this.fbR);
      const yl = this.lineL.readCubic(d);
      const yr = this.lineR.readCubic(d);
      this.fbL = yl;
      this.fbR = yr;
      l[i] = dry * xl + sign * yl;
      r[i] = dry * xr + sign * yr;
    }
  }

  reset(): void {
    this.lineL.clear();
    this.lineR.clear();
    this.fbL = 0;
    this.fbR = 0;
    this.lfo.reset();
  }
}

/* ------------------------------------------------------------------ */
/* Phaser                                                              */
/* ------------------------------------------------------------------ */

const PHASER_MAX_PAIRS = 8;

/**
 * Cascade of first-order allpass pairs. The stages param counts pairs
 * (4..8); each pair contributes one notch when wet and dry are mixed.
 * All sections share one coefficient derived from an Lfo-swept center
 * frequency moving exponentially between freqLo and freqHi. The right
 * channel Lfo runs spread cycles ahead of the left.
 */
class Phaser implements Effect {
  private readonly sampleRate: number;
  private readonly maxF: number;
  private readonly lfoL: Lfo;
  private readonly lfoR: Lfo;
  private readonly x1L = new Float64Array(PHASER_MAX_PAIRS * 2);
  private readonly y1L = new Float64Array(PHASER_MAX_PAIRS * 2);
  private readonly x1R = new Float64Array(PHASER_MAX_PAIRS * 2);
  private readonly y1R = new Float64Array(PHASER_MAX_PAIRS * 2);
  private pairs = 6;
  private freqLo = 300;
  private freqHi = 3000;
  private logRatio = Math.log(10);
  private feedback = 0.3;
  private mix = 0.5;
  private spread = 0;
  private fbL = 0;
  private fbR = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.maxF = 0.49 * sampleRate;
    this.lfoL = new Lfo(sampleRate);
    this.lfoR = new Lfo(sampleRate);
  }

  private updateSweep(): void {
    const hi = Math.max(this.freqHi, this.freqLo * 1.01);
    this.logRatio = Math.log(hi / this.freqLo);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'rate': {
        const hz = clamp(value, 0, 20);
        this.lfoL.setFreq(hz);
        this.lfoR.setFreq(hz);
        break;
      }
      case 'freqlo':
        this.freqLo = clamp(value, 10, this.maxF);
        this.updateSweep();
        break;
      case 'freqhi':
        this.freqHi = clamp(value, 10, this.maxF);
        this.updateSweep();
        break;
      case 'feedback':
        this.feedback = clamp(value, 0, 0.9);
        break;
      case 'stages': {
        const p = clamp(Math.round(value), 4, PHASER_MAX_PAIRS);
        if (p !== this.pairs) {
          this.pairs = p;
          this.x1L.fill(0);
          this.y1L.fill(0);
          this.x1R.fill(0);
          this.y1R.fill(0);
        }
        break;
      }
      case 'spread':
        this.spread = clamp(value, 0, 1);
        this.lfoL.reset(0);
        this.lfoR.reset(this.spread);
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  /** One sample through one channel's allpass chain. */
  private tick(x: number, lfoVal: number, x1: Float64Array, y1: Float64Array, fbPrev: number): number {
    const u = 0.5 * (lfoVal + 1);
    const f = Math.min(this.freqLo * Math.exp(this.logRatio * u), this.maxF);
    const t = Math.tan((Math.PI * f) / this.sampleRate);
    const a = (t - 1) / (t + 1);
    let v = x + this.feedback * fbPrev;
    const n = this.pairs * 2;
    for (let s = 0; s < n; s++) {
      const y = a * v + x1[s] - a * y1[s];
      x1[s] = v;
      y1[s] = y;
      v = y;
    }
    return v;
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const dry = 1 - this.mix;
    for (let i = from; i < to; i++) {
      const xl = l[i];
      const xr = r[i];
      const yl = this.tick(xl, this.lfoL.next(), this.x1L, this.y1L, this.fbL);
      const yr = this.tick(xr, this.lfoR.next(), this.x1R, this.y1R, this.fbR);
      this.fbL = yl;
      this.fbR = yr;
      l[i] = dry * xl + this.mix * yl;
      r[i] = dry * xr + this.mix * yr;
    }
  }

  reset(): void {
    this.x1L.fill(0);
    this.y1L.fill(0);
    this.x1R.fill(0);
    this.y1R.fill(0);
    this.fbL = 0;
    this.fbR = 0;
    this.lfoL.reset(0);
    this.lfoR.reset(this.spread);
  }
}

/* ------------------------------------------------------------------ */
/* Tremolo                                                             */
/* ------------------------------------------------------------------ */

/**
 * Lfo on amplitude. Gain stays at 1 when the Lfo is at its peak and dips
 * to 1 - depth at the trough. phase offsets the right channel Lfo in
 * cycles (0.5 gives anti-phase stereo tremolo).
 */
class Tremolo implements Effect {
  private readonly lfoL: Lfo;
  private readonly lfoR: Lfo;
  private depth = 0.8;
  private offset = 0;

  constructor(sampleRate: number) {
    this.lfoL = new Lfo(sampleRate);
    this.lfoR = new Lfo(sampleRate);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'rate': {
        const hz = clamp(value, 0, 100);
        this.lfoL.setFreq(hz);
        this.lfoR.setFreq(hz);
        break;
      }
      case 'depth':
        this.depth = clamp(value, 0, 1);
        break;
      case 'shape': {
        const shape = shapeFor(value);
        this.lfoL.setShape(shape);
        this.lfoR.setShape(shape);
        break;
      }
      case 'phase':
        this.offset = clamp(value, 0, 1);
        this.lfoL.reset(0);
        this.lfoR.reset(this.offset);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const half = 0.5 * this.depth;
    for (let i = from; i < to; i++) {
      l[i] *= 1 - half * (1 - this.lfoL.next());
      r[i] *= 1 - half * (1 - this.lfoR.next());
    }
  }

  reset(): void {
    this.lfoL.reset(0);
    this.lfoR.reset(this.offset);
  }
}

/* ------------------------------------------------------------------ */
/* Autopan                                                             */
/* ------------------------------------------------------------------ */

/**
 * Equal-power pan swept by one Lfo. Left gain cos(theta), right gain
 * sin(theta) with theta in [0, pi/2], so total power is constant and the
 * center position sits 3 dB down per channel.
 */
class Autopan implements Effect {
  private readonly lfo: Lfo;
  private depth = 1;

  constructor(sampleRate: number) {
    this.lfo = new Lfo(sampleRate);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'rate':
        this.lfo.setFreq(clamp(value, 0, 100));
        break;
      case 'depth':
        this.depth = clamp(value, 0, 1);
        break;
      case 'shape':
        this.lfo.setShape(shapeFor(value));
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const quarterPi = Math.PI / 4;
    for (let i = from; i < to; i++) {
      const theta = (this.depth * this.lfo.next() + 1) * quarterPi;
      l[i] *= Math.cos(theta);
      r[i] *= Math.sin(theta);
    }
  }

  reset(): void {
    this.lfo.reset();
  }
}

/* ------------------------------------------------------------------ */
/* Ring modulator                                                      */
/* ------------------------------------------------------------------ */

/** Input times a sine carrier. Both channels share one carrier. */
class RingMod implements Effect {
  private readonly carrier: SineOscillator;
  private mix = 1;

  constructor(sampleRate: number) {
    this.carrier = new SineOscillator(sampleRate);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'freq':
        this.carrier.setFreq(clamp(value, 0, 20000));
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const dry = 1 - this.mix;
    for (let i = from; i < to; i++) {
      const c = this.carrier.next();
      l[i] = dry * l[i] + this.mix * l[i] * c;
      r[i] = dry * r[i] + this.mix * r[i] * c;
    }
  }

  reset(): void {
    this.carrier.reset();
  }
}

/* ------------------------------------------------------------------ */
/* Effect definitions                                                  */
/* ------------------------------------------------------------------ */

export const chorusDef: EffectDef = {
  id: 'chorus',
  label: 'Chorus',
  params: [
    { name: 'rate', min: 0.01, max: 10, default: 0.5, curve: 'exp', unit: 'Hz' },
    { name: 'depth', min: 0, max: 1, default: 0.5 },
    { name: 'mix', min: 0, max: 1, default: 0.5 },
    { name: 'feedback', min: 0, max: 0.5, default: 0 },
  ],
  create: (sampleRate, params) => applyParams(new Chorus(sampleRate), chorusDef.params, params),
};

export const flangerDef: EffectDef = {
  id: 'flanger',
  label: 'Flanger',
  params: [
    { name: 'rate', min: 0.01, max: 10, default: 0.25, curve: 'exp', unit: 'Hz' },
    { name: 'depth', min: 0, max: 1, default: 0.7 },
    { name: 'manual', min: 0, max: 1, default: 0.25 },
    { name: 'feedback', min: 0, max: 0.9, default: 0.4 },
    { name: 'mix', min: 0, max: 1, default: 0.5 },
    { name: 'invert', min: 0, max: 1, default: 0 },
  ],
  create: (sampleRate, params) => applyParams(new Flanger(sampleRate), flangerDef.params, params),
};

export const phaserDef: EffectDef = {
  id: 'phaser',
  label: 'Phaser',
  params: [
    { name: 'rate', min: 0.01, max: 10, default: 0.3, curve: 'exp', unit: 'Hz' },
    { name: 'freqlo', min: 40, max: 2000, default: 300, curve: 'exp', unit: 'Hz' },
    { name: 'freqhi', min: 200, max: 12000, default: 3000, curve: 'exp', unit: 'Hz' },
    { name: 'feedback', min: 0, max: 0.9, default: 0.3 },
    { name: 'stages', min: 4, max: 8, default: 6 },
    { name: 'spread', min: 0, max: 1, default: 0.25 },
    { name: 'mix', min: 0, max: 1, default: 0.5 },
  ],
  create: (sampleRate, params) => applyParams(new Phaser(sampleRate), phaserDef.params, params),
};

export const tremoloDef: EffectDef = {
  id: 'tremolo',
  label: 'Tremolo',
  params: [
    { name: 'rate', min: 0.05, max: 40, default: 4, curve: 'exp', unit: 'Hz' },
    { name: 'depth', min: 0, max: 1, default: 0.8 },
    { name: 'shape', min: 0, max: 4, default: 0 },
    { name: 'phase', min: 0, max: 1, default: 0 },
  ],
  create: (sampleRate, params) => applyParams(new Tremolo(sampleRate), tremoloDef.params, params),
};

export const autopanDef: EffectDef = {
  id: 'autopan',
  label: 'Autopan',
  params: [
    { name: 'rate', min: 0.05, max: 20, default: 1, curve: 'exp', unit: 'Hz' },
    { name: 'depth', min: 0, max: 1, default: 1 },
    { name: 'shape', min: 0, max: 4, default: 0 },
  ],
  create: (sampleRate, params) => applyParams(new Autopan(sampleRate), autopanDef.params, params),
};

export const ringmodDef: EffectDef = {
  id: 'ringmod',
  label: 'Ring Mod',
  params: [
    { name: 'freq', min: 1, max: 8000, default: 440, curve: 'exp', unit: 'Hz' },
    { name: 'mix', min: 0, max: 1, default: 1 },
  ],
  create: (sampleRate, params) => applyParams(new RingMod(sampleRate), ringmodDef.params, params),
};
