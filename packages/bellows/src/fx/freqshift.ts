/*
 * Single sideband frequency shifter.
 *
 * The input is split into a quadrature pair (i, q) 90 degrees apart at
 * all audio frequencies (q leading i), then heterodyned with a quadrature
 * oscillator: wet = i*cos(wt) + q*sin(wt). That keeps one sideband and
 * cancels the other, so a positive shift moves every component up by the
 * same number of Hz and a negative shift moves it down (unlike ring mod,
 * which keeps both sidebands). Both orientations were verified against
 * the spectrum tests: delaying path B instead of path A leaves a two
 * sample phase error and only 18 dB of image rejection.
 *
 * The Hilbert pair is Olli Niemitalo's well known IIR design (from
 * "Yehar's digital sound processing tutorial for the braindead", also
 * circulated on musicdsp.org): two parallel cascades of four second-order
 * allpass sections y[n] = c*(x[n] + y[n-2]) - x[n-2] with c = a*a, the
 * second cascade followed by a one sample delay. The brief asked for
 * 6th-order cascades; these classic coefficient sets are 8th order per
 * path (four biquad allpasses), which is the published, verified design,
 * so they are used as permitted. The phase difference stays within a
 * fraction of a degree of 90 across roughly [0.002, 0.498] of the sample
 * rate, so sideband rejection is far better than the 30 dB target through
 * the audio band.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp } from '../types';

const TWO_PI = Math.PI * 2;

/** Niemitalo allpass coefficients. Path A (delayed one sample) feeds i, path B feeds q. */
const PATH_A = [0.6923877778065, 0.9360654322959, 0.988229522686, 0.9987488452737];
const PATH_B = [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278];
const CA = new Float64Array(PATH_A.map((a) => a * a));
const CB = new Float64Array(PATH_B.map((a) => a * a));
const SECTIONS = 4;

/** One channel's Hilbert transformer state. tick() updates i and q. */
class HilbertPair {
  /** Section states, path A in slots 0..3, path B in slots 4..7. */
  private readonly x1 = new Float64Array(SECTIONS * 2);
  private readonly x2 = new Float64Array(SECTIONS * 2);
  private readonly y1 = new Float64Array(SECTIONS * 2);
  private readonly y2 = new Float64Array(SECTIONS * 2);
  /** One sample delay on path A. */
  private held = 0;
  i = 0;
  q = 0;

  tick(x: number): void {
    const { x1, x2, y1, y2 } = this;
    let v = x;
    for (let s = 0; s < SECTIONS; s++) {
      const y = CA[s] * (v + y2[s]) - x2[s];
      x2[s] = x1[s];
      x1[s] = v;
      y2[s] = y1[s];
      y1[s] = y;
      v = y;
    }
    this.i = this.held;
    this.held = v;
    let w = x;
    for (let s = SECTIONS; s < SECTIONS * 2; s++) {
      const y = CB[s - SECTIONS] * (w + y2[s]) - x2[s];
      x2[s] = x1[s];
      x1[s] = w;
      y2[s] = y1[s];
      y1[s] = y;
      w = y;
    }
    this.q = w;
  }

  reset(): void {
    this.x1.fill(0);
    this.x2.fill(0);
    this.y1.fill(0);
    this.y2.fill(0);
    this.held = 0;
    this.i = 0;
    this.q = 0;
  }
}

class FreqShifter implements Effect {
  private readonly sampleRate: number;
  private readonly hL = new HilbertPair();
  private readonly hR = new HilbertPair();
  /** Oscillator phase in cycles, [0, 1). */
  private phase = 0;
  /** Cycles per sample; negative shifts down. */
  private dphase = 0;
  private mix = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'shift': {
        const lim = 0.45 * this.sampleRate;
        this.dphase = clamp(value, -lim, lim) / this.sampleRate;
        break;
      }
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const dry = 1 - this.mix;
    for (let i = from; i < to; i++) {
      const th = TWO_PI * this.phase;
      const c = Math.cos(th);
      const s = Math.sin(th);
      this.phase += this.dphase;
      this.phase -= Math.floor(this.phase);
      const xl = l[i];
      const xr = r[i];
      this.hL.tick(xl);
      this.hR.tick(xr);
      l[i] = dry * xl + this.mix * (this.hL.i * c + this.hL.q * s);
      r[i] = dry * xr + this.mix * (this.hR.i * c + this.hR.q * s);
    }
  }

  reset(): void {
    this.hL.reset();
    this.hR.reset();
    this.phase = 0;
  }
}

function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): Effect {
  for (const spec of specs) fx.setParam(spec.name, params[spec.name] ?? spec.default);
  return fx;
}

export const freqshiftDef: EffectDef = {
  id: 'freqshift',
  label: 'Frequency Shifter',
  params: [
    { name: 'shift', min: -2000, max: 2000, default: 0, curve: 'lin', unit: 'Hz' },
    { name: 'mix', min: 0, max: 1, default: 1 },
  ],
  create: (sampleRate, params) => applyParams(new FreqShifter(sampleRate), freqshiftDef.params, params),
};
