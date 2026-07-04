/*
 * Envelopes and parameter smoothing. All segments are one-pole exponentials:
 * each sample moves the level a fixed fraction of the way to a target.
 *
 * The Adsr attack aims past 1.0 (overshoot factor 1.5) so the curve hits
 * full level in the configured attack time instead of creeping toward it,
 * which is what makes percussive attacks read as punchy. Decay and release
 * aim at their real targets with a rate chosen to land within 1 percent of
 * the way there in the configured time.
 */

const enum Stage {
  Idle,
  Attack,
  Decay,
  Sustain,
  Release,
}

/** Attack aims at this multiple of full level and is clamped at 1. */
const ATTACK_TARGET = 1.5;
/** ln(3): with target 1.5 the curve crosses 1.0 at exactly the attack time. */
const ATTACK_RATE = Math.log(3);
/** ln(100): decay and release cover 99 percent of their span in the set time. */
const SETTLE_RATE = Math.log(100);
/** Below this level in release the envelope goes idle. */
const IDLE_FLOOR = 1e-4;

export class Adsr {
  private readonly sampleRate: number;
  private stage = Stage.Idle;
  private lvl = 0;
  private sus = 1;
  private aCoef = 1;
  private dCoef = 1;
  private rCoef = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.set(0.01, 0.1, 0.7, 0.2);
  }

  private coef(timeSec: number, rate: number): number {
    if (timeSec <= 0) return 1;
    return 1 - Math.exp(-rate / (timeSec * this.sampleRate));
  }

  /** Times in seconds, sustain 0..1. Safe to call while running. */
  set(attack: number, decay: number, sustain: number, release: number): void {
    this.aCoef = this.coef(attack, ATTACK_RATE);
    this.dCoef = this.coef(decay, SETTLE_RATE);
    this.rCoef = this.coef(release, SETTLE_RATE);
    this.sus = Math.min(Math.max(sustain, 0), 1);
  }

  /** Start the attack from the current level. Safe from any stage: no clicks. */
  trigger(): void {
    this.stage = Stage.Attack;
  }

  release(): void {
    if (this.stage !== Stage.Idle) this.stage = Stage.Release;
  }

  next(): number {
    switch (this.stage) {
      case Stage.Idle:
        return 0;
      case Stage.Attack:
        this.lvl += this.aCoef * (ATTACK_TARGET - this.lvl);
        if (this.lvl >= 1) {
          this.lvl = 1;
          this.stage = Stage.Decay;
        }
        return this.lvl;
      case Stage.Decay:
        this.lvl += this.dCoef * (this.sus - this.lvl);
        if (Math.abs(this.lvl - this.sus) < 1e-4) {
          this.lvl = this.sus;
          this.stage = Stage.Sustain;
        }
        return this.lvl;
      case Stage.Sustain:
        this.lvl = this.sus;
        return this.lvl;
      case Stage.Release:
        this.lvl -= this.rCoef * this.lvl;
        if (this.lvl < IDLE_FLOOR) {
          this.lvl = 0;
          this.stage = Stage.Idle;
        }
        return this.lvl;
    }
  }

  /** False once fully idle after release. */
  get active(): boolean {
    return this.stage !== Stage.Idle;
  }

  get level(): number {
    return this.lvl;
  }

  reset(): void {
    this.stage = Stage.Idle;
    this.lvl = 0;
  }
}

/** Full-wave rectify then asymmetric one-pole: fast up, slow down (or as configured). */
export class EnvelopeFollower {
  private readonly aCoef: number;
  private readonly rCoef: number;
  private y = 0;

  constructor(sampleRate: number, attackSec: number, releaseSec: number) {
    this.aCoef = attackSec <= 0 ? 1 : 1 - Math.exp(-1 / (attackSec * sampleRate));
    this.rCoef = releaseSec <= 0 ? 1 : 1 - Math.exp(-1 / (releaseSec * sampleRate));
  }

  next(x: number): number {
    const v = Math.abs(x);
    this.y += (v > this.y ? this.aCoef : this.rCoef) * (v - this.y);
    return this.y;
  }

  reset(): void {
    this.y = 0;
  }
}

/** One-pole parameter smoothing: reaches 63 percent of a step in timeSec. */
export class Smoother {
  private readonly coef: number;
  private target = 0;
  private v = 0;

  constructor(sampleRate: number, timeSec: number) {
    this.coef = timeSec <= 0 ? 1 : 1 - Math.exp(-1 / (timeSec * sampleRate));
  }

  setTarget(v: number): void {
    this.target = v;
  }

  /** Jump immediately, no smoothing. */
  snap(v: number): void {
    this.target = v;
    this.v = v;
  }

  next(): number {
    this.v += this.coef * (this.target - this.v);
    return this.v;
  }

  get value(): number {
    return this.v;
  }
}
