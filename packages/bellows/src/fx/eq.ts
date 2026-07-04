/*
 * Six-band parametric EQ. Band 0 is a low shelf, bands 1 through 4 are
 * bells, band 5 is a high shelf. Each band is one Svf per channel and
 * the bands run in series. Params use flat names per band: b0freq,
 * b0gain, b0q, b0enabled, up through b5.
 *
 * A band whose gain is exactly 0 dB is skipped. The Svf bell and shelf
 * modes are exact identities at 0 dB anyway, so skipping changes nothing
 * audible and makes 0 gain a bit-transparent bypass. Re-enabling a band
 * resets its filter state so stale integrator energy cannot click in.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp } from '../types';
import { Svf } from '../dsp/filters';
import type { SvfMode } from '../dsp/filters';

/** Apply spec defaults, then caller overrides, through setParam. */
function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): void {
  for (const s of specs) fx.setParam(s.name, params[s.name] ?? s.default);
}

const BAND_COUNT = 6;
const BAND_MODES: SvfMode[] = ['lowshelf', 'bell', 'bell', 'bell', 'bell', 'highshelf'];
const BAND_FREQS = [80, 250, 800, 2500, 6000, 12000];
/** Shelves default to Butterworth damping; bells to a moderate width. */
const BAND_QS = [0.707, 1, 1, 1, 1, 0.707];

function buildParams(): ParamSpec[] {
  const specs: ParamSpec[] = [];
  for (let i = 0; i < BAND_COUNT; i++) {
    specs.push({
      name: 'b' + i + 'freq',
      min: 20,
      max: 20000,
      default: BAND_FREQS[i],
      curve: 'exp',
      unit: 'Hz',
    });
    specs.push({ name: 'b' + i + 'gain', min: -24, max: 24, default: 0, unit: 'dB' });
    specs.push({ name: 'b' + i + 'q', min: 0.1, max: 12, default: BAND_QS[i] });
    specs.push({ name: 'b' + i + 'enabled', min: 0, max: 1, default: 1 });
  }
  return specs;
}

const EQ_PARAMS: ParamSpec[] = buildParams();

/** One EQ band: a stereo pair of Svfs sharing frequency, gain, and q. */
class EqBand {
  readonly svfL: Svf;
  readonly svfR: Svf;
  freq: number;
  gain = 0;
  q: number;
  enabled = true;

  constructor(sampleRate: number, mode: SvfMode, freq: number, q: number) {
    this.svfL = new Svf(sampleRate);
    this.svfR = new Svf(sampleRate);
    this.svfL.setMode(mode);
    this.svfR.setMode(mode);
    this.freq = freq;
    this.q = q;
    this.apply();
  }

  apply(): void {
    this.svfL.set(this.freq, this.q, this.gain);
    this.svfR.set(this.freq, this.q, this.gain);
  }

  reset(): void {
    this.svfL.reset();
    this.svfR.reset();
  }
}

class ParametricEq implements Effect {
  private readonly bands: EqBand[];

  constructor(sampleRate: number, params: Record<string, number>) {
    this.bands = [];
    for (let i = 0; i < BAND_COUNT; i++) {
      this.bands.push(new EqBand(sampleRate, BAND_MODES[i], BAND_FREQS[i], BAND_QS[i]));
    }
    applyParams(this, EQ_PARAMS, params);
  }

  setParam(name: string, value: number): void {
    if (name.charCodeAt(0) !== 98 /* 'b' */) return;
    const idx = name.charCodeAt(1) - 48;
    if (idx < 0 || idx >= BAND_COUNT) return;
    const band = this.bands[idx];
    switch (name.slice(2)) {
      case 'freq':
        band.freq = clamp(value, 20, 20000);
        band.apply();
        break;
      case 'gain':
        band.gain = clamp(value, -24, 24);
        band.apply();
        break;
      case 'q':
        band.q = clamp(value, 0.1, 12);
        band.apply();
        break;
      case 'enabled': {
        const on = value >= 0.5;
        if (on && !band.enabled) band.reset();
        band.enabled = on;
        break;
      }
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    for (let b = 0; b < BAND_COUNT; b++) {
      const band = this.bands[b];
      if (!band.enabled || band.gain === 0) continue;
      band.svfL.process(l, from, to);
      band.svfR.process(r, from, to);
    }
  }

  reset(): void {
    for (const band of this.bands) band.reset();
  }
}

export const eqDef: EffectDef = {
  id: 'eq',
  label: 'Parametric EQ',
  params: EQ_PARAMS,
  create: (sampleRate, params) => new ParametricEq(sampleRate, params),
};
