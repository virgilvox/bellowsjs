/*
 * The singer's pitch servo: a self-oscillating source finds its own
 * frequency from its tension and the pressure on it, so a singer who wants
 * a note listens and adjusts. This loop does the same once a cycle: it
 * compares each measured cycle's frequency with the target and moves a
 * multiplicative correction of the tension toward the ratio, by a fraction
 * 1 - exp(-T / tau) of the log error for a cycle of length T, so it
 * converges with time constant tau whatever the pitch. A feedforward
 * tension (the caller's, from the target) does the bulk of a glide; the
 * correction only takes up what the model's own physics adds: the
 * pressure's pull on f0, the collision's stiffening, the integrator's
 * frequency warping at a low sample rate.
 *
 * tau is a few tens of milliseconds: slow enough that the short f0 dip of a
 * voiced closure (the transglottal pressure falling, 50 to 100 ms) is
 * mostly left in, fast enough that a held note lands in a fraction of its
 * glide. Cycles far from the target (an onset's first irregular cycles, a
 * period doubling) are ignored rather than chased.
 *
 * Inputs and outputs are fields; cycle() takes nothing and returns nothing.
 * The folds call it every sample so V8 optimizes and inlines it, and it
 * works only when a new cycle is pending: called once a cycle, it stayed
 * unoptimized and boxed its doubles.
 */

/** Correction limits: an octave each way. */
const MIN_CORRECTION = 0.5;
const MAX_CORRECTION = 2;
/** A measured cycle further than this ratio from the target is not used. */
const MAX_RATIO = 1.6;

export class PitchServo {
  /** The frequency aimed at, Hz. */
  target = 110;
  /** The last measured cycle's frequency, Hz (the input of cycle()). */
  measured = 110;
  /** The tension correction, multiplying the feedforward. */
  correction = 1;
  /** The servo's time constant, s. */
  tau = 0.04;
  /** 1 when `measured` holds a cycle cycle() has not used yet. */
  pending = 0;

  reset(): void {
    this.correction = 1;
    this.measured = this.target;
    this.pending = 0;
  }

  /** One measured cycle: update the correction. A no-op unless a cycle is pending (see FoldOscillator.step). */
  cycle(): void {
    if (this.pending === 0) return;
    this.pending = 0;
    const m = this.measured;
    const t = this.target;
    if (!(m > 0) || !(t > 0)) return;
    const ratio = t / m;
    if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) return;
    const g = 1 - Math.exp(-1 / (m * this.tau));
    // Math.min and Math.max, not a conditional: V8 boxed a double merged with a module-level constant
    this.correction = Math.min(Math.max(this.correction * Math.pow(ratio, g), MIN_CORRECTION), MAX_CORRECTION);
  }
}
