/*
 * Antialiased oscillators.
 *
 * BlepOscillator corrects step discontinuities (saw wrap, square edges)
 * with a two sample polyBLEP residual, and slope discontinuities
 * (triangle corners) with the integrated form, polyBLAMP.
 *
 * SineOscillator is a plain phase accumulator with a phase modulation
 * input in radians for FM engines.
 *
 * Hard sync is intentionally not implemented here: doing it cleanly needs
 * a BLEP at the fractional sync point plus slave phase rewind, which is
 * better served by the wavetable oscillator once it grows sync support.
 */

import { clamp } from '../types';

export type BlepShape = 'saw' | 'square' | 'triangle' | 'sine';

const TWO_PI = Math.PI * 2;

/**
 * Two sample polyBLEP residual for a step of height 2 at phase 0.
 * t is the current phase in [0, 1), dt the phase increment per sample.
 * Convention: subtract this from a naive waveform that steps DOWN by 2
 * at the wrap (the saw), add it for a step UP by 2.
 */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const d = t / dt;
    return d + d - d * d - 1;
  }
  if (t > 1 - dt) {
    const d = (t - 1) / dt;
    return d * d + d + d + 1;
  }
  return 0;
}

/**
 * Two sample polyBLAMP residual for a corner at phase 0 where the slope
 * increases by one unit per sample. Integral of the unit step polyBLEP:
 * for d in [0, 1) after the corner it is -(d - 1)^3 / 6, for d in (-1, 0)
 * before the corner it is (d + 1)^3 / 6. Scale by the actual slope change
 * in amplitude per sample per sample.
 */
function polyBlamp(t: number, dt: number): number {
  if (t < dt) {
    const u = t / dt - 1;
    return -(u * u * u) / 6;
  }
  if (t > 1 - dt) {
    const u = (t - 1) / dt + 1;
    return (u * u * u) / 6;
  }
  return 0;
}

export class BlepOscillator {
  private readonly sampleRate: number;
  private shape: BlepShape = 'saw';
  private phase = 0;
  private dt = 0;
  private pw = 0.5;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setShape(shape: BlepShape): void {
    this.shape = shape;
  }

  setFreq(hz: number): void {
    this.dt = clamp(hz / this.sampleRate, 0, 0.49);
  }

  /** Pulse width for the square shape, clamped away from degenerate edges. */
  setPulseWidth(pw: number): void {
    this.pw = clamp(pw, 0.01, 0.99);
  }

  reset(phase = 0): void {
    this.phase = phase - Math.floor(phase);
  }

  next(): number {
    const t = this.phase;
    const dt = this.dt;
    let y: number;
    switch (this.shape) {
      case 'saw':
        y = 2 * t - 1 - polyBlep(t, dt);
        break;
      case 'square': {
        const pw = this.pw;
        // rising edge at 0 (+2), falling edge at pw (-2)
        const tf = t < pw ? t - pw + 1 : t - pw;
        y = (t < pw ? 1 : -1) + polyBlep(t, dt) - polyBlep(tf, dt);
        break;
      }
      case 'triangle': {
        // corners at 0 (slope change +8 per unit phase) and 0.5 (-8)
        const th = t < 0.5 ? t + 0.5 : t - 0.5;
        const naive = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
        y = naive + 8 * dt * (polyBlamp(t, dt) - polyBlamp(th, dt));
        break;
      }
      case 'sine':
        y = Math.sin(TWO_PI * t);
        break;
    }
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }

  /** Overwrites out over [from, to). */
  process(out: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) out[i] = this.next();
  }
}

export class SineOscillator {
  private readonly sampleRate: number;
  private phase = 0;
  private dt = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setFreq(hz: number): void {
    this.dt = clamp(hz / this.sampleRate, 0, 0.5);
  }

  reset(phase = 0): void {
    this.phase = phase - Math.floor(phase);
  }

  next(): number {
    const y = Math.sin(TWO_PI * this.phase);
    this.phase += this.dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }

  /** Phase modulation input in radians, for FM engines. */
  nextPm(pm: number): number {
    const y = Math.sin(TWO_PI * this.phase + pm);
    this.phase += this.dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }
}
