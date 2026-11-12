/*
 * A cascade of identical first-order lags, H(s) = 1 / (1 + tau s)^N: the
 * target approximation Birkholz fitted to measured articulator movements
 * (Birkholz, Kroger and Neuschaefer-Rube 2011, IEEE TASLP 19(5); Birkholz
 * and Hoole 2012, Interspeech: the fit error falls steeply up to N = 5 or
 * 6, and VocalTractLab uses 6). Implemented here from those papers.
 *
 * Why not the critically damped second-order tracker (critdamp.ts, N = 2):
 * from rest its velocity peaks at 0.17 of the 98 percent time with 26
 * percent of the way done, a fast start and a long tail. Real movements are
 * nearer symmetric and bell shaped; at N = 6 the peak comes at 0.42 of the
 * 98 percent time with 38 percent done.
 *
 * Each stage follows the one before it: x_k' = (x_{k-1} - x_k) / tau, with
 * x_0 the target and x_N the output. With the target held over a step of
 * length h, the errors e_k = x_k - target evolve exactly as
 *
 *   e_k(h) = exp(-r) sum_{j=1..k} e_j(0) r^(k-j) / (k-j)!,   r = h / tau
 *
 * (each stage is the gamma-shaped impulse response of the ones before it),
 * so a step is N (N + 1) / 2 multiply-adds with coefficients computed once
 * per rate. It is the continuous solution sampled at the step times, at any
 * step rate, stable for any r.
 *
 * Time: from rest the remaining fraction after t is the gamma tail
 * exp(-u) sum_{k<N} u^k / k!, u = t / tau. It reaches 2 percent at u =
 * 12.03 for N = 6 (5.83 for N = 2), so setTime(s) sets tau = s / 12.03.
 *
 * A rate change leaves the stages where they are: position stays
 * continuous and velocity scales with the rate (critdamp.ts scales it the
 * same way on a slowdown).
 *
 * Contact: place() moves the output stage alone. The stages before it are
 * the movement still on its way, so an articulator held against a surface
 * keeps that motion (a target past the surface stays past it), and when the
 * target turns back the output leaves the surface already accelerating.
 *
 * The only state is Float64Arrays sized at construction; step() returns
 * nothing (V8 boxes a double returned from a call it does not inline), so
 * nothing on the step path allocates.
 */

import { clamp } from '../types';

/** The default order: VocalTractLab's. */
export const CASCADE_ORDER = 6;

/** u at which the gamma tail exp(-u) sum_{k<n} u^k / k! falls to 1 - fraction. */
export function cascadeSettle(order: number, fraction = 0.98): number {
  const tail = (u: number) => {
    let term = 1;
    let sum = 1;
    for (let k = 1; k < order; k++) {
      term *= u / k;
      sum += term;
    }
    return Math.exp(-u) * sum;
  };
  let lo = 0;
  let hi = 10 * order + 50;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi);
    if (tail(mid) > 1 - fraction) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** t98 / tau at N = 6: 12.03. */
export const CASCADE_SETTLE_98 = cascadeSettle(CASCADE_ORDER);

const VALUE_LIMIT = 1e15;
const MIN_RATE = 1e-3;
const MAX_RATE = 1e9;
const SETTLED = 1e-30;

export class CascadeBank {
  readonly channels: number;
  readonly order: number;
  /**
   * The outputs (the last stage), one per channel, refreshed by step(),
   * snap() and place(). Read only.
   */
  readonly values: Float64Array;
  /** Stages, channel-major: stage k of channel i at i * order + k (the last is the output). */
  private readonly x: Float64Array;
  private readonly goal: Float64Array;
  /** 1 / tau per channel, 1/s. */
  private readonly rate: Float64Array;
  /** exp(-r) r^m / m! for m = 0 .. order - 1, channel-major. */
  private readonly c: Float64Array;
  private readonly h: number;
  /** t98 / tau at this order. */
  private readonly settle: number;

  /**
   * stepRateHz is how often step() runs, within [1e-3, 1e9] Hz; order is the
   * number of stages, 1 to 12.
   */
  constructor(channels: number, stepRateHz: number, order = CASCADE_ORDER) {
    if (!(Number.isInteger(channels) && channels > 0 && channels <= 1 << 16)) {
      throw new RangeError(`channel count must be an integer from 1 to 65536, got ${channels}`);
    }
    if (!(Number.isInteger(order) && order >= 1 && order <= 12)) {
      throw new RangeError(`order must be an integer from 1 to 12, got ${order}`);
    }
    if (!(stepRateHz >= 1e-3 && stepRateHz <= 1e9)) {
      throw new RangeError(`step rate must be within [1e-3, 1e9] Hz, got ${stepRateHz}`);
    }
    this.channels = channels;
    this.order = order;
    this.h = 1 / stepRateHz;
    this.values = new Float64Array(channels);
    this.x = new Float64Array(channels * order);
    this.goal = new Float64Array(channels);
    this.rate = new Float64Array(channels);
    this.c = new Float64Array(channels * order);
    this.settle = cascadeSettle(order);
    // 100 ms to 98 percent until set
    for (let i = 0; i < channels; i++) this.setRate(i, this.settle / 0.1);
  }

  /** 1 / tau for channel i, clamped to [1e-3, 1e9] per second. */
  setRate(i: number, perSecond: number): void {
    if (!Number.isFinite(perSecond)) return;
    const q = clamp(perSecond, MIN_RATE, MAX_RATE);
    if (q === this.rate[i]) return;
    this.rate[i] = q;
    this.coefficients(i);
  }

  /** The 98 percent time from rest for channel i, seconds (0: arrive on the next step). */
  setTime(i: number, seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const t = clamp(seconds, 0, Number.MAX_VALUE);
    this.setRate(i, t > 0 ? this.settle / t : MAX_RATE);
  }

  setTarget(i: number, target: number): void {
    if (!Number.isFinite(target)) return;
    this.goal[i] = clamp(target, -VALUE_LIMIT, VALUE_LIMIT);
  }

  /** Every stage and the target to value: at rest there. */
  snap(i: number, value: number): void {
    if (!Number.isFinite(value)) return;
    const v = clamp(value, -VALUE_LIMIT, VALUE_LIMIT);
    this.goal[i] = v;
    this.values[i] = v;
    const n = this.order;
    for (let k = 0; k < n; k++) this.x[i * n + k] = v;
  }

  /** Move channel i's output stage to value, leaving the stages before it (a contact). */
  place(i: number, value: number): void {
    if (!(value - value === 0)) return;
    const v = value < -1e15 ? -1e15 : value > 1e15 ? 1e15 : value;
    this.x[i * this.order + this.order - 1] = v;
    this.values[i] = v;
  }

  /** place(i, src[at]): no double crosses the call. */
  placeFrom(i: number, src: Float64Array, at: number): void {
    this.place(i, src[at]);
  }

  /** The output's velocity, units per second. */
  velocity(i: number): number {
    const n = this.order;
    const b = i * n + n - 1;
    return n > 1 ? (this.x[b - 1] - this.x[b]) * this.rate[i] : (this.goal[i] - this.x[b]) * this.rate[i];
  }

  /** Stage k (0 first, order - 1 the output) of channel i. */
  stage(i: number, k: number): number {
    return this.x[i * this.order + k];
  }

  target(i: number): number {
    return this.goal[i];
  }

  /**
   * Every channel's target from targets[i] and rate (1 / tau) from rates[i]:
   * one call with arrays, so no double crosses a call boundary.
   */
  setAll(targets: Float64Array, rates: Float64Array): void {
    for (let i = 0; i < this.channels; i++) {
      const t = targets[i];
      if (t - t === 0) this.goal[i] = t < -1e15 ? -1e15 : t > 1e15 ? 1e15 : t;
      const r = rates[i];
      if (!(r - r === 0)) continue;
      const q = r < 1e-3 ? 1e-3 : r > 1e9 ? 1e9 : r;
      if (q !== this.rate[i]) {
        this.rate[i] = q;
        this.coefficients(i);
      }
    }
  }

  /** Advance every channel one step. */
  step(): void {
    const n = this.order;
    const x = this.x;
    const c = this.c;
    const goal = this.goal;
    for (let i = 0; i < this.channels; i++) {
      const base = i * n;
      const g = goal[i];
      let big = 0;
      // in place from the last stage down: stage k needs the old values of stages 0 .. k
      for (let k = n - 1; k >= 0; k--) {
        let s = 0;
        for (let j = 0; j <= k; j++) s += c[base + k - j] * (x[base + j] - g);
        x[base + k] = g + s;
        if (s > big) big = s;
        else if (-s > big) big = -s;
      }
      // settle exactly far under anything audible, so no subnormal stays in the state
      if (big < SETTLED) for (let k = 0; k < n; k++) x[base + k] = g;
      this.values[i] = x[base + n - 1];
    }
  }

  private coefficients(i: number): void {
    const n = this.order;
    const r = this.h * this.rate[i];
    let term = Math.exp(-r);
    for (let m = 0; m < n; m++) {
      this.c[i * n + m] = term;
      term *= r / (m + 1);
    }
  }
}
