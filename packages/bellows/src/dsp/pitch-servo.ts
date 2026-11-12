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

  reset(): void {
    this.correction = 1;
    this.measured = this.target;
  }

  /** One measured cycle: update the correction. */
  cycle(): void {
    const m = this.measured;
    const t = this.target;
    if (!(m > 0) || !(t > 0)) return;
    const ratio = t / m;
    if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) return;
    const g = 1 - Math.exp(-1 / (m * this.tau));
    let c = this.correction * Math.pow(ratio, g);
    c = c < MIN_CORRECTION ? MIN_CORRECTION : c > MAX_CORRECTION ? MAX_CORRECTION : c;
    this.correction = c;
  }
}
