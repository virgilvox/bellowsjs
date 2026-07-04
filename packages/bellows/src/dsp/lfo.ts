/*
 * Low frequency oscillator. Bipolar output in [-1, 1]. Control rate
 * signals do not need band limiting, so shapes are naive. Sample and
 * hold draws from the injected Rng; if none is given a fixed seeded
 * stream is used so output stays deterministic.
 */

import type { Rng } from '../types';
import { rng as makeRng } from '../core/prng';
import { clamp } from '../types';

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'sh';

const TWO_PI = Math.PI * 2;

export class Lfo {
  private readonly sampleRate: number;
  private readonly rng: Rng;
  private shape: LfoShape = 'sine';
  private phase = 0;
  private dt = 0;
  private held: number;

  constructor(sampleRate: number, rng?: Rng) {
    this.sampleRate = sampleRate;
    this.rng = rng ?? makeRng('lfo/sh');
    this.held = 2 * this.rng() - 1;
  }

  setFreq(hz: number): void {
    this.dt = clamp(hz / this.sampleRate, 0, 0.5);
  }

  setShape(shape: LfoShape): void {
    this.shape = shape;
  }

  /** Sets phase (fractional part is used). Does not draw from the rng. */
  reset(phase = 0): void {
    this.phase = phase - Math.floor(phase);
  }

  /** Bipolar -1..1. */
  next(): number {
    const t = this.phase;
    let y: number;
    switch (this.shape) {
      case 'sine':
        y = Math.sin(TWO_PI * t);
        break;
      case 'triangle':
        y = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
        break;
      case 'saw':
        y = 2 * t - 1;
        break;
      case 'square':
        y = t < 0.5 ? 1 : -1;
        break;
      case 'sh':
        y = this.held;
        break;
    }
    this.phase += this.dt;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.held = 2 * this.rng() - 1;
    }
    return y;
  }
}
