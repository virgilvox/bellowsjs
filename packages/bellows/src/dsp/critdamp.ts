/*
 * Critically damped second-order tracking: a value that glides to a target
 * the way an articulator does, starting slowly, arriving without overshoot,
 * and staying smooth in velocity when the target moves mid-glide.
 *
 * The technique follows CHIMERA by Jameson Hodge
 * (crates/chimera/src/control/articulators.rs:24-147, at 1d3ea49).
 * Reimplemented here. CHIMERA moves each articulator by
 *
 *   x'' = w^2 (target - x) - 2 w x'
 *
 * with w = 2 pi times a natural frequency of 6 to 13 Hz per articulator,
 * set, its comment says, against VocalTractLab's fitted time constants of
 * 5 to 40 ms, so that step targets turn into physiologically plausible
 * motion. It steps the equation with semi-implicit Euler, which its own
 * comment notes is stable only for w dt < 1.
 *
 * This file integrates the same equation exactly instead. With the target
 * held over a step of length h, the error e = x - target obeys
 * e'' + 2w e' + w^2 e = 0, whose critically damped solution is
 *
 *   e(t) = (e0 + (v0 + w e0) t) exp(-w t)
 *   v(t) = (v0 - w (v0 + w e0) t) exp(-w t)
 *
 * so one step is a few multiply-adds and a precomputed exp(-w h). The result
 * is the continuous solution sampled at the step times, whatever the step
 * rate: stable for any w h, with no overshoot from rest, and the same
 * trajectory at control rate as at audio rate (the tests measure both).
 * Changing the target keeps x and x' continuous, so a new phoneme bends a
 * formant glide rather than kinking it.
 *
 * The time constant: from rest, the fraction of a step still to go after t
 * is (1 + w t) exp(-w t). It reaches 2 percent at w t = 5.8339, so setTime(s)
 * sets w = 5.8339 / s and the value is 98 percent of the way there s seconds
 * later. CHIMERA's 10 Hz articulators take 93 ms.
 *
 * Setters ignore non-finite arguments and keep the last good setting, the
 * policy of dsp/filters.ts and dsp/envelopes.ts: a NaN in x or x' would
 * never leave. Finite values go through clamp() from ../types. The only
 * state is number fields (CritDamp) or Float64Arrays sized at construction
 * (CritDampBank), so step() allocates nothing.
 */

import { clamp } from '../types';

/** The root of (1 + u) exp(-u) = 0.02: w times the 98 percent settling time. */
export const CRITDAMP_SETTLE_98 = 5.83392170191739;
/** Slowest w in rad/s (98 percent in about 97 minutes). Zero would let a moving value drift forever. */
export const CRITDAMP_MIN_OMEGA = 1e-3;
/** Fastest w in rad/s. Far past any step rate, so it reads as "arrive on the next step". */
export const CRITDAMP_MAX_OMEGA = 1e9;
/** CHIMERA's most common articulator speed, 10 Hz natural frequency, as w. */
const DEFAULT_OMEGA = 2 * Math.PI * 10;
/*
 * Bounds that keep every intermediate of step() finite at every legal
 * setting: with |value| <= 1e15, w <= 1e9 and h <= 1e3, w e h stays below
 * 1e28. Nothing a voice tracks (Hz, levels, semitones) comes near them.
 */
const VALUE_LIMIT = 1e15;
const MIN_STEP_RATE = 1e-3;
const MAX_STEP_RATE = 1e9;

function checkRate(stepRateHz: number): number {
  if (!(stepRateHz >= MIN_STEP_RATE && stepRateHz <= MAX_STEP_RATE)) {
    throw new RangeError(`step rate must be within [1e-3, 1e9] Hz, got ${stepRateHz}`);
  }
  return 1 / stepRateHz;
}

function omegaForTime(seconds: number): number {
  const t = clamp(seconds, 0, Number.MAX_VALUE);
  return t > 0 ? CRITDAMP_SETTLE_98 / t : CRITDAMP_MAX_OMEGA;
}

/** An error and a velocity both under this settle on the target exactly. */
const SETTLED = 1e-30;

export class CritDamp {
  /** Step length in seconds. */
  private readonly h: number;
  private omega = DEFAULT_OMEGA;
  private decay: number;
  private x = 0;
  private v = 0;
  private goal = 0;

  /**
   * stepRateHz is how many times per second step() will be called: a
   * sample rate, or a control rate. It throws outside [1e-3, 1e9] Hz,
   * because a step length that is not a finite positive number would turn
   * every value NaN.
   */
  constructor(stepRateHz: number) {
    this.h = checkRate(stepRateHz);
    this.decay = Math.exp(-this.omega * this.h);
  }

  /**
   * Natural angular frequency w in rad/s, clamped to [1e-3, 1e9]. Slowing
   * down scales the velocity by the same factor: kept whole, the speed built
   * at the faster rate carries the value past its target (a 40 ms glide
   * stretched to 300 ms mid-move went 6 semitones past it), and a move that
   * was not overshooting would start to.
   */
  setOmega(radPerSec: number): void {
    if (!Number.isFinite(radPerSec)) return;
    const w = clamp(radPerSec, CRITDAMP_MIN_OMEGA, CRITDAMP_MAX_OMEGA);
    if (w < this.omega) this.v *= w / this.omega;
    this.omega = w;
    this.decay = Math.exp(-w * this.h);
  }

  /** Seconds for a step from rest to cover 98 percent of the way. 0 means the next step arrives. */
  setTime(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.setOmega(omegaForTime(seconds));
  }

  /** Where the value heads next, clamped to +-1e15. */
  setTarget(target: number): void {
    if (!Number.isFinite(target)) return;
    this.goal = clamp(target, -VALUE_LIMIT, VALUE_LIMIT);
  }

  /** Jump to value and rest there: target and value both become value, velocity 0. */
  snap(value: number): void {
    if (!Number.isFinite(value)) return;
    this.x = this.goal = clamp(value, -VALUE_LIMIT, VALUE_LIMIT);
    this.v = 0;
  }

  /** Advance one step and return the new value. */
  step(): number {
    const w = this.omega;
    const e = this.x - this.goal;
    const ch = (this.v + w * e) * this.h;
    const ne = (e + ch) * this.decay;
    const nv = (this.v - w * ch) * this.decay;
    // settle exactly once the motion is far under anything audible, so no
    // subnormal stays in the state (x86 without flush-to-zero pays for those)
    if (ne < SETTLED && ne > -SETTLED && nv < SETTLED && nv > -SETTLED) {
      this.x = this.goal;
      this.v = 0;
    } else {
      this.x = this.goal + ne;
      this.v = nv;
    }
    return this.x;
  }

  get value(): number {
    return this.x;
  }

  /** Units per second. */
  get velocity(): number {
    return this.v;
  }

  get target(): number {
    return this.goal;
  }
}

/**
 * N independent CritDamp channels in Float64Arrays with one step() over all
 * of them, for an engine that tracks a dozen or more values (formant
 * frequencies and bandwidths, source levels) at the same rate. Each channel
 * steps exactly as a CritDamp with the same settings would, bit for bit.
 * step() returns nothing, so no double crosses a call boundary for V8 to
 * box when the call is not inlined; read the results from `values`.
 */
export class CritDampBank {
  readonly channels: number;
  /**
   * Current values, one per channel. Exposed so a caller can read many
   * channels without a call each. Treat as read only: writing a value here
   * moves it without touching its velocity; use snap() instead.
   */
  readonly values: Float64Array;
  private readonly h: number;
  private readonly v: Float64Array;
  private readonly goal: Float64Array;
  private readonly omega: Float64Array;
  private readonly decay: Float64Array;

  constructor(channels: number, stepRateHz: number) {
    if (!(Number.isInteger(channels) && channels > 0 && channels <= 1 << 20)) {
      throw new RangeError(`channel count must be an integer from 1 to 2^20, got ${channels}`);
    }
    this.channels = channels;
    this.h = checkRate(stepRateHz);
    this.values = new Float64Array(channels);
    this.v = new Float64Array(channels);
    this.goal = new Float64Array(channels);
    this.omega = new Float64Array(channels).fill(DEFAULT_OMEGA);
    this.decay = new Float64Array(channels).fill(Math.exp(-DEFAULT_OMEGA * this.h));
  }

  /** As CritDamp.setOmega, for channel i. */
  setOmega(i: number, radPerSec: number): void {
    if (!Number.isFinite(radPerSec)) return;
    const w = clamp(radPerSec, CRITDAMP_MIN_OMEGA, CRITDAMP_MAX_OMEGA);
    if (w < this.omega[i]) this.v[i] *= w / this.omega[i];
    this.omega[i] = w;
    this.decay[i] = Math.exp(-w * this.h);
  }

  /** As CritDamp.setTime, for channel i. */
  setTime(i: number, seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.setOmega(i, omegaForTime(seconds));
  }

  /** As CritDamp.setTarget, for channel i. */
  setTarget(i: number, target: number): void {
    if (!Number.isFinite(target)) return;
    this.goal[i] = clamp(target, -VALUE_LIMIT, VALUE_LIMIT);
  }

  /** As CritDamp.snap, for channel i. */
  snap(i: number, value: number): void {
    if (!Number.isFinite(value)) return;
    this.values[i] = this.goal[i] = clamp(value, -VALUE_LIMIT, VALUE_LIMIT);
    this.v[i] = 0;
  }

  /**
   * Move channel i to `value` with velocity `velocity`, keeping its target:
   * for a constraint that pushes a value back (a tongue against the
   * palate) and removes only the part of its motion that went into it.
   */
  place(i: number, value: number, velocity: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(velocity)) return;
    this.values[i] = clamp(value, -VALUE_LIMIT, VALUE_LIMIT);
    this.v[i] = clamp(velocity, -VALUE_LIMIT, VALUE_LIMIT);
  }

  /**
   * Channel i moved as place() would, to src[at] with velocity src[at + 1]:
   * no double crosses the call (V8 boxes doubles passed to a call it does
   * not inline).
   */
  placeFrom(i: number, src: Float64Array, at: number): void {
    const value = src[at];
    const velocity = src[at + 1];
    if (!(value - value === 0) || !(velocity - velocity === 0)) return;
    this.values[i] = value < -1e15 ? -1e15 : value > 1e15 ? 1e15 : value;
    this.v[i] = velocity < -1e15 ? -1e15 : velocity > 1e15 ? 1e15 : velocity;
  }

  /** Current velocities, one per channel (read only, like values). */
  get velocities(): Float64Array {
    return this.v;
  }

  value(i: number): number {
    return this.values[i];
  }

  velocity(i: number): number {
    return this.v[i];
  }

  target(i: number): number {
    return this.goal[i];
  }

  /**
   * Every channel's target from targets[i] and natural frequency from
   * omegas[i] (rad/s), as setTarget and setOmega would set them one by one;
   * one call with arrays passes no doubles for V8 to box.
   */
  setAll(targets: Float64Array, omegas: Float64Array): void {
    for (let i = 0; i < this.channels; i++) {
      const t = targets[i];
      // the limits are literals here: a module constant merged with a double in a conditional made V8
      // box the double (MEASURED: 7 bytes a sample of the vocal engine's control path)
      if (t === t && t - t === 0) this.goal[i] = t < -1e15 ? -1e15 : t > 1e15 ? 1e15 : t;
      const r = omegas[i];
      if (!(r === r && r - r === 0)) continue;
      const w = r < 1e-3 ? 1e-3 : r > 1e9 ? 1e9 : r;
      if (w !== this.omega[i]) {
        if (w < this.omega[i]) this.v[i] *= w / this.omega[i];
        this.omega[i] = w;
        this.decay[i] = Math.exp(-w * this.h);
      }
    }
  }

  /** Advance every channel one step. */
  step(): void {
    const x = this.values;
    const v = this.v;
    const goal = this.goal;
    const omega = this.omega;
    const decay = this.decay;
    const h = this.h;
    for (let i = 0; i < this.channels; i++) {
      const w = omega[i];
      const e = x[i] - goal[i];
      const ch = (v[i] + w * e) * h;
      const ne = (e + ch) * decay[i];
      const nv = (v[i] - w * ch) * decay[i];
      if (ne < SETTLED && ne > -SETTLED && nv < SETTLED && nv > -SETTLED) {
        x[i] = goal[i];
        v[i] = 0;
      } else {
        x[i] = goal[i] + ne;
        v[i] = nv;
      }
    }
  }
}
