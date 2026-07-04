/*
 * Saturator: drive into a selectable waveshaping curve with the
 * nonlinearity run at 4x through an Oversampler, so the harmonics it
 * generates above Nyquist are filtered out instead of folding back.
 *
 * Curves: 0 tanh (normalized, hard-clip limit at high drive), 1 cubic
 * soft clip, 2 triangle wavefolder, 3 a fixed Chebyshev polynomial
 * table (harmonics 1 through 5).
 *
 * Output compensation is automatic: on every drive or curve change the
 * unit measures the RMS a half-scale sine keeps through the curve and
 * scales the wet path so that level stays put. An `output` param in dB
 * sits on top of that, and `tone` is a tilt around 700 Hz built from a
 * complementary one-pole pair (lowpass plus its residual highpass), up
 * to +/-6 dB of tilt at the extremes with exact unity at 0.
 *
 * The oversampler round trip delays the wet path by 24 samples; the dry
 * path for `mix` runs through DelayLines of the same length so parallel
 * blends stay phase aligned. The delay is exposed as `latency`.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp, dbToGain } from '../types';
import { DelayLine } from '../dsp/delayline';
import { OnePole } from '../dsp/filters';
import { Oversampler } from '../dsp/oversample';
import { TableShaper, chebyshevTable, foldback, softClip, tanhShape } from '../dsp/waveshaper';

/** Apply spec defaults, then caller overrides, through setParam. */
function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): void {
  for (const s of specs) fx.setParam(s.name, params[s.name] ?? s.default);
}

const SAT_BLOCK = 128;
const TILT_PIVOT_HZ = 700;
const TILT_RANGE_DB = 6;
/** Reference level the auto compensation holds constant through the curve. */
const COMP_REF = 0.5;
/** Chebyshev weights for harmonics 1 through 5 of the 'cheby' curve. */
const CHEBY_COEFFS = [0.5, 0.25, 0.15, 0.08, 0.04];

const SATURATOR_PARAMS: ParamSpec[] = [
  { name: 'drive', min: 0.1, max: 20, default: 2, curve: 'exp' },
  /** 0 tanh, 1 soft, 2 fold, 3 cheby. */
  { name: 'curve', min: 0, max: 3, default: 0 },
  { name: 'tone', min: -1, max: 1, default: 0 },
  { name: 'output', min: -24, max: 24, default: 0, unit: 'dB' },
  { name: 'mix', min: 0, max: 1, default: 1 },
];

class Saturator implements Effect {
  /** Wet-path delay in samples; the dry path is delayed to match. */
  readonly latency: number;
  private readonly osL: Oversampler;
  private readonly osR: Oversampler;
  private readonly dlL: DelayLine;
  private readonly dlR: DelayLine;
  private readonly tiltL: OnePole;
  private readonly tiltR: OnePole;
  private readonly shaper: TableShaper;
  private readonly dryL = new Float32Array(SAT_BLOCK);
  private readonly dryR = new Float32Array(SAT_BLOCK);

  private drive = 2;
  private curveIdx = 0;
  private comp = 1;
  private gLo = 1;
  private gHi = 1;
  private outGain = 1;
  private mix = 1;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.osL = new Oversampler(4, SAT_BLOCK);
    this.osR = new Oversampler(4, SAT_BLOCK);
    this.latency = this.osL.latency;
    this.dlL = new DelayLine(this.latency + 4);
    this.dlR = new DelayLine(this.latency + 4);
    this.tiltL = new OnePole(sampleRate);
    this.tiltR = new OnePole(sampleRate);
    this.tiltL.setLowpass(TILT_PIVOT_HZ);
    this.tiltR.setLowpass(TILT_PIVOT_HZ);
    this.shaper = new TableShaper(chebyshevTable(CHEBY_COEFFS, 2048));
    applyParams(this, SATURATOR_PARAMS, params);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'drive':
        this.drive = clamp(value, 0.1, 20);
        this.updateComp();
        break;
      case 'curve':
        this.curveIdx = Math.round(clamp(value, 0, 3));
        this.updateComp();
        break;
      case 'tone': {
        const t = clamp(value, -1, 1);
        this.gLo = dbToGain(-t * TILT_RANGE_DB);
        this.gHi = dbToGain(t * TILT_RANGE_DB);
        break;
      }
      case 'output':
        this.outGain = dbToGain(clamp(value, -24, 24));
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  private shapeOne(x: number): number {
    switch (this.curveIdx) {
      case 0:
        return tanhShape(x, this.drive);
      case 1:
        return softClip(x * this.drive);
      case 2:
        return foldback(x, this.drive);
      default:
        return this.shaper.next(x * this.drive);
    }
  }

  /**
   * Measure the RMS a half-scale sine keeps through the current curve
   * and set the wet gain that restores it. Runs off the audio path, on
   * drive or curve changes only.
   */
  private updateComp(): void {
    let acc = 0;
    for (let k = 0; k < 64; k++) {
      const y = this.shapeOne(COMP_REF * Math.sin((2 * Math.PI * k) / 64));
      acc += y * y;
    }
    const rmsOut = Math.sqrt(acc / 64);
    const rmsIn = COMP_REF * Math.SQRT1_2;
    this.comp = clamp(rmsIn / Math.max(rmsOut, 1e-4), 0.05, 8);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    for (let start = from; start < to; start += SAT_BLOCK) {
      this.chunk(l, r, start, Math.min(start + SAT_BLOCK, to));
    }
  }

  private chunk(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const n = to - from;
    const dryL = this.dryL;
    const dryR = this.dryR;
    for (let j = 0; j < n; j++) {
      dryL[j] = l[from + j];
      dryR[j] = r[from + j];
    }

    const upL = this.osL.up(l, from, to);
    for (let k = 0, m = n * 4; k < m; k++) upL[k] = this.shapeOne(upL[k]);
    this.osL.down(upL, l, from, to);

    const upR = this.osR.up(r, from, to);
    for (let k = 0, m = n * 4; k < m; k++) upR[k] = this.shapeOne(upR[k]);
    this.osR.down(upR, r, from, to);

    const mix = this.mix;
    const dryAmt = 1 - mix;
    const comp = this.comp;
    const outG = this.outGain;
    const gLo = this.gLo;
    const gHi = this.gHi;
    const look = this.latency;
    for (let j = 0; j < n; j++) {
      const i = from + j;
      const lpL = this.tiltL.next(l[i]);
      const wetL = (gLo * lpL + gHi * (l[i] - lpL)) * comp;
      this.dlL.write(dryL[j]);
      l[i] = (this.dlL.readInt(look) * dryAmt + wetL * mix) * outG;
      const lpR = this.tiltR.next(r[i]);
      const wetR = (gLo * lpR + gHi * (r[i] - lpR)) * comp;
      this.dlR.write(dryR[j]);
      r[i] = (this.dlR.readInt(look) * dryAmt + wetR * mix) * outG;
    }
  }

  reset(): void {
    this.osL.reset();
    this.osR.reset();
    this.dlL.clear();
    this.dlR.clear();
    this.tiltL.reset();
    this.tiltR.reset();
  }
}

export const saturatorDef: EffectDef = {
  id: 'saturator',
  label: 'Saturator',
  params: SATURATOR_PARAMS,
  create: (sampleRate, params) => new Saturator(sampleRate, params),
};
