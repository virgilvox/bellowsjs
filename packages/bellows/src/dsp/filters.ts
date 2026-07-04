/*
 * Filters. Every unit takes its sample rate at construction and ticks one
 * sample at a time; Svf also processes Float32Array ranges in place.
 *
 * Svf is Andrew Simper's linear trapezoidal state variable filter
 * (cytomic SvfLinearTrapOptimised2). One topology covers lowpass through
 * shelves by mixing the input and the two integrator outputs with
 * mode-dependent weights m0, m1, m2.
 *
 * LadderFilter is a Huovilainen style four stage transistor ladder with
 * tanh saturation in every stage, run at 2x internally to tame the
 * nonlinearity, with half-input feedback compensation so resonance does
 * not gut the passband.
 */

export type SvfMode =
  | 'lp'
  | 'hp'
  | 'bp'
  | 'notch'
  | 'peak'
  | 'allpass'
  | 'bell'
  | 'lowshelf'
  | 'highshelf';

export class Svf {
  private readonly sampleRate: number;
  private mode: SvfMode = 'lp';
  private cutoffHz = 1000;
  private q = 0.70710678;
  private gainDb = 0;

  // coefficients
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private m0 = 0;
  private m1 = 0;
  private m2 = 1;

  // integrator state
  private ic1eq = 0;
  private ic2eq = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.update();
  }

  setMode(mode: SvfMode): void {
    this.mode = mode;
    this.update();
  }

  set(cutoffHz: number, q: number, gainDb = 0): void {
    this.cutoffHz = cutoffHz;
    this.q = q;
    this.gainDb = gainDb;
    this.update();
  }

  private update(): void {
    const fs = this.sampleRate;
    const fc = Math.min(Math.max(this.cutoffHz, 1e-3), fs * 0.49);
    const q = Math.max(this.q, 1e-3);
    const w = Math.PI * (fc / fs);
    let g = Math.tan(w);
    let k = 1 / q;

    switch (this.mode) {
      case 'lp':
        this.m0 = 0;
        this.m1 = 0;
        this.m2 = 1;
        break;
      case 'bp':
        this.m0 = 0;
        this.m1 = 1;
        this.m2 = 0;
        break;
      case 'hp':
        this.m0 = 1;
        this.m1 = -k;
        this.m2 = -1;
        break;
      case 'notch':
        this.m0 = 1;
        this.m1 = -k;
        this.m2 = 0;
        break;
      case 'peak':
        this.m0 = 1;
        this.m1 = -k;
        this.m2 = -2;
        break;
      case 'allpass':
        this.m0 = 1;
        this.m1 = -2 * k;
        this.m2 = 0;
        break;
      case 'bell': {
        const A = Math.pow(10, this.gainDb / 40);
        k = 1 / (q * A);
        this.m0 = 1;
        this.m1 = k * (A * A - 1);
        this.m2 = 0;
        break;
      }
      case 'lowshelf': {
        const A = Math.pow(10, this.gainDb / 40);
        g = Math.tan(w) / Math.sqrt(A);
        this.m0 = 1;
        this.m1 = k * (A - 1);
        this.m2 = A * A - 1;
        break;
      }
      case 'highshelf': {
        const A = Math.pow(10, this.gainDb / 40);
        g = Math.tan(w) * Math.sqrt(A);
        this.m0 = A * A;
        this.m1 = k * (1 - A) * A;
        this.m2 = 1 - A * A;
        break;
      }
    }

    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  next(x: number): number {
    const v3 = x - this.ic2eq;
    const v1 = this.a1 * this.ic1eq + this.a2 * v3;
    const v2 = this.ic2eq + this.a2 * this.ic1eq + this.a3 * v3;
    this.ic1eq = 2 * v1 - this.ic1eq;
    this.ic2eq = 2 * v2 - this.ic2eq;
    return this.m0 * x + this.m1 * v1 + this.m2 * v2;
  }

  process(buf: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) buf[i] = this.next(buf[i]);
  }

  reset(): void {
    this.ic1eq = 0;
    this.ic2eq = 0;
  }
}

export class LadderFilter {
  private readonly sampleRate: number;
  private g = 0;
  private k = 0;
  private drive = 1;

  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private s4 = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.set(1000, 0);
  }

  /** cutoffHz in Hz, resonance 0..1 (self-oscillation near 1), drive >= 1 saturates harder. */
  set(cutoffHz: number, resonance: number, drive = 1): void {
    const fs2 = this.sampleRate * 2; // internal 2x rate
    const fc = Math.min(Math.max(cutoffHz, 1e-3), this.sampleRate * 0.45);
    this.g = 1 - Math.exp((-2 * Math.PI * fc) / fs2);
    this.k = 4 * Math.min(Math.max(resonance, 0), 1.05);
    this.drive = Math.max(drive, 1e-3);
  }

  private tick(x: number): number {
    // Half-input compensation keeps passband level up under resonance.
    const u = Math.tanh(this.drive * (x - this.k * (this.s4 - 0.5 * x)));
    this.s1 += this.g * (u - Math.tanh(this.s1));
    this.s2 += this.g * (Math.tanh(this.s1) - Math.tanh(this.s2));
    this.s3 += this.g * (Math.tanh(this.s2) - Math.tanh(this.s3));
    this.s4 += this.g * (Math.tanh(this.s3) - Math.tanh(this.s4));
    return this.s4;
  }

  next(x: number): number {
    // Two half-rate ticks per output sample. The input is held for both;
    // the second tick's output is the decimated result.
    this.tick(x);
    return this.tick(x);
  }

  reset(): void {
    this.s1 = 0;
    this.s2 = 0;
    this.s3 = 0;
    this.s4 = 0;
  }
}

export class OnePole {
  private readonly sampleRate: number;
  private a = 1;
  private y = 0;
  private highpass = false;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.setLowpass(1000);
  }

  private coef(hz: number): number {
    const fc = Math.min(Math.max(hz, 1e-3), this.sampleRate * 0.49);
    return 1 - Math.exp((-2 * Math.PI * fc) / this.sampleRate);
  }

  setLowpass(hz: number): void {
    this.a = this.coef(hz);
    this.highpass = false;
  }

  setHighpass(hz: number): void {
    this.a = this.coef(hz);
    this.highpass = true;
  }

  next(x: number): number {
    this.y += this.a * (x - this.y);
    return this.highpass ? x - this.y : this.y;
  }

  reset(): void {
    this.y = 0;
  }
}

export class DcBlocker {
  private readonly r: number;
  private x1 = 0;
  private y1 = 0;

  constructor(sampleRate: number) {
    // R = 0.995 at 44100; scale the pole distance from 1 with sample rate.
    const r = 1 - (0.005 * 44100) / sampleRate;
    this.r = Math.min(Math.max(r, 0.9), 0.99999);
  }

  next(x: number): number {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = 0;
    this.y1 = 0;
  }
}
