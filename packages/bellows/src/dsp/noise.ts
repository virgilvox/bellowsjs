/*
 * Noise generators. All randomness comes from the injected Rng stream,
 * so the same stream label always reproduces the same output.
 *
 * white   uniform in [-1, 1)
 * pink    Paul Kellett's economy filter bank, about -3 dB per octave
 * brown   leaky integrator over white, about -6 dB per octave
 * velvet  sparse random unit impulses, around 2000 per second
 * crackle sparse pops with an exponential decay tail
 */

import type { Rng } from '../types';

export type NoiseColor = 'white' | 'pink' | 'brown' | 'velvet' | 'crackle';

const VELVET_DENSITY = 2000; // impulses per second
const CRACKLE_RATE = 8; // pops per second, sparse enough to stay mostly silent
const CRACKLE_TAU = 0.002; // pop decay time constant, seconds

export class NoiseGen {
  private readonly sampleRate: number;
  private readonly rng: Rng;
  private color: NoiseColor;

  // pink filter state (Kellett)
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;
  // brown integrator state
  private brown = 0;
  // crackle pop state
  private env = 0;
  private sign = 1;
  // per sample probabilities and decay, fixed by sample rate
  private readonly velvetP: number;
  private readonly crackleP: number;
  private readonly crackleDecay: number;

  constructor(sampleRate: number, color: NoiseColor, rng: Rng) {
    this.sampleRate = sampleRate;
    this.color = color;
    this.rng = rng;
    this.velvetP = VELVET_DENSITY / sampleRate;
    this.crackleP = CRACKLE_RATE / sampleRate;
    this.crackleDecay = Math.exp(-1 / (CRACKLE_TAU * sampleRate));
  }

  setColor(color: NoiseColor): void {
    this.color = color;
    this.b0 = this.b1 = this.b2 = this.b3 = this.b4 = this.b5 = this.b6 = 0;
    this.brown = 0;
    this.env = 0;
    this.sign = 1;
  }

  next(): number {
    switch (this.color) {
      case 'white':
        return 2 * this.rng() - 1;
      case 'pink': {
        const w = 2 * this.rng() - 1;
        this.b0 = 0.99886 * this.b0 + w * 0.0555179;
        this.b1 = 0.99332 * this.b1 + w * 0.0750759;
        this.b2 = 0.969 * this.b2 + w * 0.153852;
        this.b3 = 0.8665 * this.b3 + w * 0.3104856;
        this.b4 = 0.55 * this.b4 + w * 0.5329522;
        this.b5 = -0.7616 * this.b5 - w * 0.016898;
        const pink =
          (this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362) *
          0.11;
        this.b6 = w * 0.115926;
        return pink;
      }
      case 'brown': {
        const w = 2 * this.rng() - 1;
        this.brown = (this.brown + 0.02 * w) / 1.02;
        return this.brown * 3.5;
      }
      case 'velvet': {
        // one draw per sample: position decides fire, low half decides sign
        const r = this.rng();
        if (r >= this.velvetP) return 0;
        return r < this.velvetP * 0.5 ? 1 : -1;
      }
      case 'crackle': {
        if (this.rng() < this.crackleP) {
          this.env = 0.3 + 0.7 * this.rng();
          this.sign = this.rng() < 0.5 ? -1 : 1;
        }
        const y = this.sign * this.env;
        this.env *= this.crackleDecay;
        return y;
      }
    }
  }

  /** Overwrites out over [from, to). */
  process(out: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) out[i] = this.next();
  }
}
