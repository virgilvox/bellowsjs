/*
 * A sung note change: pitch that prepares, glides, overshoots and settles,
 * as a singer's does, from one second-order system stepped exactly.
 *
 * Saitou, Unoki and Akagi model sung F0 as the score's step melody plus
 * components a singer adds: preparation (a small move opposite to a note
 * change, just before it), overshoot (passing the new note just after it),
 * vibrato and fine fluctuation. They make overshoot and preparation with
 * second-order systems, and in their listening tests every component
 * affected perceived quality and overshoot affected it most (Speech
 * Communication 47, 2005). A critically damped glide, which the first vocal
 * engine and CHIMERA both use, has neither.
 *
 * Here both come from one transfer function,
 *
 *   H(s) = w^2 (1 - s/z) / (s^2 + 2 zeta w s + w^2),
 *
 * whose damping below 1 overshoots and whose right-half-plane zero at z
 * makes a step start out the wrong way: the preparation. Written as
 * x'' + 2 zeta w x' + w^2 x = w^2 u - (w^2 / z) u', a step of size d in the
 * target u is an impulse in u', so it adds -(w^2 / z) d = -w p d to the
 * velocity at that instant, with p = w / z the preparation amount. Between
 * steps the error e = x - u decays exactly:
 *
 *   e(t) = exp(-zeta w t) (e0 cos(wd t) + (v0 + zeta w e0) / wd sin(wd t))
 *   v(t) = exp(-zeta w t) (v0 cos(wd t) - (zeta w v0 + w^2 e0) / wd sin(wd t))
 *
 * with wd = w sqrt(1 - zeta^2), and at zeta = 1 the critically damped limit
 * of src/dsp/critdamp.ts. So one step is a few multiply-adds and a
 * precomputed exp, cos and sin, the trajectory is the continuous one
 * sampled at the step times whatever the step rate, and a preparation that
 * should land before the note means posting the target early by
 * leadTime().
 *
 * The defaults are INFERRED, not Saitou's fitted values: about 5.5 Hz
 * natural frequency and damping 0.6 (an overshoot of 9.5 percent of the
 * interval), and no preparation.
 */

import { clamp } from '../types';

const MIN_DAMPING = 0.2;
const MAX_PREPARATION = 1;

export class PitchGlide {
  private readonly h: number;
  private x = 0;
  private v = 0;
  private goal = 0;
  private w = 2 * Math.PI * 5.5;
  private zeta = 0.6;
  private prep = 0;
  // the step's coefficients: [e', v'] = [[a, b], [c, d]] [e, v]
  private a = 1;
  private b = 0;
  private c = 0;
  private d = 1;

  /** stepRateHz: how often step() runs, a sample rate or a control rate. Throws outside [10, 1e7] Hz. */
  constructor(stepRateHz: number) {
    if (!(stepRateHz >= 10 && stepRateHz <= 1e7)) throw new RangeError(`PitchGlide step rate ${stepRateHz} Hz is outside [10, 1e7]`);
    this.h = 1 / stepRateHz;
    this.update();
  }

  /** Natural frequency in Hz: how fast a glide moves, about 3 to 10 for a voice. */
  setSpeed(hz: number): void {
    if (!Number.isFinite(hz)) return;
    this.w = 2 * Math.PI * clamp(hz, 0.1, 200);
    this.update();
  }

  /** Damping, [0.2, 1]: 1 glides without overshoot, 0.5 overshoots by 16 percent of the interval. */
  setDamping(zeta: number): void {
    if (!Number.isFinite(zeta)) return;
    this.zeta = clamp(zeta, MIN_DAMPING, 1);
    this.update();
  }

  /** Preparation, [0, 1]: how far a note change first moves the wrong way. 0 is none. */
  setPreparation(amount: number): void {
    if (!Number.isFinite(amount)) return;
    this.prep = clamp(amount, 0, MAX_PREPARATION);
  }

  /** Move toward a new target from wherever the glide is, with preparation and overshoot. */
  setTarget(target: number): void {
    if (!Number.isFinite(target)) return;
    const jump = target - this.goal;
    this.goal = target;
    if (jump !== 0 && this.prep > 0) this.v -= this.w * this.prep * jump;
  }

  /** Jump straight to a value, at rest. */
  snap(value: number): void {
    if (!Number.isFinite(value)) return;
    this.x = this.goal = value;
    this.v = 0;
  }

  /** Advance one step; returns the value. */
  step(): number {
    this.advance();
    return this.x;
  }

  /** Advance one step and leave the value in `value`: no double crosses the call. */
  advance(): void {
    const e = this.x - this.goal;
    const v = this.v;
    this.x = this.goal + this.a * e + this.b * v;
    this.v = this.c * e + this.d * v;
  }

  get value(): number {
    return this.x;
  }

  get velocity(): number {
    return this.v;
  }

  get target(): number {
    return this.goal;
  }

  /**
   * Seconds a step from rest takes to cover half the interval: post a note
   * change this much early and its glide is half way at the note's time,
   * with the preparation before it and the overshoot after.
   */
  leadTime(): number {
    // the step response is monotone in the first half, so bisect on it in closed form
    let lo = 0;
    let hi = 10 / this.w;
    for (let i = 0; i < 60; i++) {
      const t = 0.5 * (lo + hi);
      if (this.stepResponse(t) < 0.5) lo = t;
      else hi = t;
    }
    return 0.5 * (lo + hi);
  }

  /** The unit step response at time t (from rest at 0, target 1), closed form. */
  stepResponse(t: number): number {
    const w = this.w;
    const zeta = this.zeta;
    const e0 = -1;
    const v0 = -w * this.prep;
    const k = Math.exp(-zeta * w * t);
    if (zeta >= 1 - 1e-9) return 1 + k * (e0 + (v0 + w * e0) * t);
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 + k * (e0 * Math.cos(wd * t) + ((v0 + zeta * w * e0) / wd) * Math.sin(wd * t));
  }

  private update(): void {
    const w = this.w;
    const zeta = this.zeta;
    const h = this.h;
    const k = Math.exp(-zeta * w * h);
    if (zeta >= 1 - 1e-9) {
      // e(h) = (e0 + (v0 + w e0) h) k, v(h) = (v0 - w (v0 + w e0) h) k
      this.a = (1 + w * h) * k;
      this.b = h * k;
      this.c = -w * w * h * k;
      this.d = (1 - w * h) * k;
      return;
    }
    const wd = w * Math.sqrt(1 - zeta * zeta);
    const cs = Math.cos(wd * h);
    const sn = Math.sin(wd * h);
    this.a = k * (cs + ((zeta * w) / wd) * sn);
    this.b = (k * sn) / wd;
    this.c = (-k * w * w * sn) / wd;
    this.d = k * (cs - ((zeta * w) / wd) * sn);
  }
}
