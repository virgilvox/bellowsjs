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
 * tau is a few tens of milliseconds for a small error, shorter for a large one: slow enough that the short f0 dip of a
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
/** The error in cents at which the servo runs twice as fast as tau. */
const ADAPT_CENTS = 40;
const CENTS_PER_NEPER = 1200 / Math.LN2;
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
  /** 1 when the pending cycle is a full one (the folds' own depth test); only full cycles speed the servo up. */
  deep = 1;
  /** The last used cycle's log error, ln(target / measured). */
  private lastLog = 0;

  reset(): void {
    this.correction = 1;
    this.measured = this.target;
    this.pending = 0;
    this.lastLog = 0;
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
    // a large error converges faster: the time constant shrinks by 1 + |error| / ADAPT_CENTS, so the few
    // tens of cents of a voiced closure's dip keep about tau while an onset's semitone or two after a
    // voiceless stop is gone in a few cycles instead of a 60 to 100 ms audible slide (MEASURED in
    // "twinkle": onsets 1 to 2.7 semitones sharp, falling over 60 to 100 ms at tau alone)
    // Only a full cycle whose error the cycle before agrees with speeds it up (the smaller of the two, same sign): one odd
    // cycle (an irregular turn, a cycle locked to a resonance) at the fast rate threw the correction about
    // (MEASURED: drops of 15 percent in one cycle near F1 in the female melisma)
    const lr = Math.log(ratio);
    const lp = this.lastLog;
    this.lastLog = lr;
    const same = lr * lp > 0 ? 1 : 0;
    const a = lr < 0 ? -lr : lr;
    const b = lp < 0 ? -lp : lp;
    // the closing folds' shallow cycles run at any rate as the pressure under them builds (MEASURED: two at
    // 366 Hz under a 460 Hz target took the correction from 1.20 to 1.42 and the note began 280 cents sharp)
    const cents = this.deep * same * (a < b ? a : b) * CENTS_PER_NEPER;
    const g = 1 - Math.exp(-(1 + cents / ADAPT_CENTS) / (m * this.tau));
    // Math.min and Math.max, not a conditional: V8 boxed a double merged with a module-level constant
    this.correction = Math.min(Math.max(this.correction * Math.pow(ratio, g), MIN_CORRECTION), MAX_CORRECTION);
  }
}
