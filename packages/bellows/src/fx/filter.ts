/*
 * Filter: the engines' filters as an insert effect, for a channel, a bus, the master, or a direct
 * input channel.
 *
 * Types 0 to 8 are the Svf modes (lowpass, highpass, bandpass, notch, peak, allpass, bell, low
 * shelf, high shelf); `slope` 1 runs two in series for 24 dB per octave. Type 9 is the four stage
 * LadderFilter (24 dB lowpass with its own saturation, `drive`). `resonance` 0..1 maps to the Svf's
 * Q from 0.5 to 20 (0.1 is about Butterworth), and is the ladder's resonance as is. The bandpass is
 * scaled to 0 dB at its centre, so resonance narrows it without making it louder.
 *
 * Cutoff glides: a set moves the target and the filter follows it in the log domain with a time
 * constant of about 8 ms, recomputing coefficients every 16 samples while it moves, so a cutoff
 * swept from a host's controls does not zipper. The first value it is given is applied at once.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp } from '../types';
import { LadderFilter, Svf, type SvfMode } from '../dsp/filters';

const MODES: readonly SvfMode[] = ['lp', 'hp', 'bp', 'notch', 'peak', 'allpass', 'bell', 'lowshelf', 'highshelf'];
const LADDER = 9;
/** Samples between coefficient updates while the cutoff glides. */
const STEP = 16;
const GLIDE_SECONDS = 0.008;

const FILTER_PARAMS: ParamSpec[] = [
  /** 0 lowpass, 1 highpass, 2 bandpass, 3 notch, 4 peak, 5 allpass, 6 bell, 7 low shelf, 8 high shelf, 9 ladder lowpass. */
  { name: 'type', min: 0, max: 9, default: 0 },
  { name: 'cutoff', min: 20, max: 20000, default: 1000, curve: 'exp', unit: 'Hz' },
  { name: 'resonance', min: 0, max: 1, default: 0.1 },
  /** Bell and shelves. */
  { name: 'gain', min: -24, max: 24, default: 0, unit: 'dB' },
  /** 0: 12 dB per octave, 1: 24 dB (two Svf stages). The ladder is always 24. */
  { name: 'slope', min: 0, max: 1, default: 0 },
  /** Ladder only: input drive into its saturating stages. */
  { name: 'drive', min: 1, max: 10, default: 1, curve: 'exp' },
  { name: 'mix', min: 0, max: 1, default: 1 },
];

function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): void {
  for (const s of specs) fx.setParam(s.name, params[s.name] ?? s.default);
}

class Filter implements Effect {
  private readonly svf: Svf[];
  private readonly ladder: LadderFilter[];
  private readonly glide: number;
  private type = 0;
  private slope = 0;
  private target = 1000;
  private cutoff = 1000;
  private started = false;
  private resonance = 0.1;
  private gain = 0;
  private drive = 1;
  private mix = 1;
  private countdown = 0;
  /** Bandpass output scale: the Svf's bandpass peaks at Q, this brings the peak to 0 dB. */
  private bpScale = 1;

  constructor(sampleRate: number, params: Record<string, number>) {
    // [L stage 1, R stage 1, L stage 2, R stage 2]
    this.svf = [new Svf(sampleRate), new Svf(sampleRate), new Svf(sampleRate), new Svf(sampleRate)];
    this.ladder = [new LadderFilter(sampleRate), new LadderFilter(sampleRate)];
    this.glide = 1 - Math.exp(-STEP / (GLIDE_SECONDS * sampleRate));
    applyParams(this, FILTER_PARAMS, params);
    this.started = true;
  }

  setParam(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    switch (name) {
      case 'type': {
        const t = clamp(Math.round(value), 0, LADDER);
        if (t !== this.type) {
          this.type = t;
          if (t !== LADDER) for (const f of this.svf) f.setMode(MODES[t]);
          this.reset();
        }
        break;
      }
      case 'cutoff':
        this.target = clamp(value, 20, 20000);
        if (!this.started) this.cutoff = this.target;
        break;
      case 'resonance':
        this.resonance = clamp(value, 0, 1);
        break;
      case 'gain':
        this.gain = clamp(value, -24, 24);
        break;
      case 'slope':
        this.slope = value >= 0.5 ? 1 : 0;
        break;
      case 'drive':
        this.drive = clamp(value, 1, 10);
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        return;
      default:
        return;
    }
    this.update();
  }

  private update(): void {
    if (this.type === LADDER) {
      for (const f of this.ladder) f.set(this.cutoff, this.resonance, this.drive);
      return;
    }
    const q = 0.5 * Math.pow(40, this.resonance);
    this.bpScale = this.type === 2 ? 1 / q : 1;
    for (const f of this.svf) f.set(this.cutoff, q, this.gain);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const wet = this.mix;
    const dry = 1 - wet;
    const ladder = this.type === LADDER;
    const two = !ladder && this.slope === 1;
    const [a, b, c, d] = this.svf;
    const [ll, lr] = this.ladder;
    for (let i = from; i < to; i++) {
      if (this.countdown-- <= 0) {
        this.countdown = STEP - 1;
        if (this.cutoff !== this.target) {
          const ratio = this.target / this.cutoff;
          if (Math.abs(ratio - 1) < 1e-4) this.cutoff = this.target;
          else this.cutoff *= Math.pow(ratio, this.glide);
          this.update();
        }
      }
      const xl = l[i];
      const xr = r[i];
      let yl: number;
      let yr: number;
      if (ladder) {
        yl = ll.next(xl);
        yr = lr.next(xr);
      } else {
        yl = a.next(xl);
        yr = b.next(xr);
        if (two) {
          yl = c.next(yl);
          yr = d.next(yr);
        }
      }
      const w = wet * (two ? this.bpScale * this.bpScale : this.bpScale);
      l[i] = dry * xl + w * yl;
      r[i] = dry * xr + w * yr;
    }
  }

  reset(): void {
    for (const f of this.svf) f.reset();
    for (const f of this.ladder) f.reset();
  }
}

export const filterDef: EffectDef = {
  id: 'filter',
  label: 'Filter',
  params: FILTER_PARAMS,
  create: (sampleRate, params) => new Filter(sampleRate, params),
};
