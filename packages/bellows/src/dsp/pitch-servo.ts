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
 * glide. The caller's weight leaves the rest of the dip in (it falls as the
 * pressure backs up above the folds). In an onset's first cycles a large
 * error converges faster. One cycle far from the target (an onset's first
 * irregular cycles, a period doubling) is ignored rather than chased; a run
 * of them is chased at the limit ratio, so a correction carried out of
 * range comes back.
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
/** A measured cycle further than this ratio from the target is not used, unless it is one of a run (FAR_RUN). */
const MAX_RATIO = 1.6;
/** Full cycles in a row, all far off on one side, that mean the folds are lost rather than one odd cycle. */
const FAR_RUN = 3;

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
  /** 1 while the folds are in an onset's first cycles (the folds' own test); only then may a large error speed it up. */
  onset = 1;
  /**
   * How far the cycles count, 0..1: the caller's measure of whether f0 is the tension's or the pressure's.
   * The servo stands for the tension a singer sets, and a singer lets a voiced closure's dip go by.
   */
  weight = 1;
  /** Set by the folds at an onset: the next cycle has no predecessor to agree with (the last was before the gap). */
  restart = 0;
  /** The last used cycle's log error, ln(target / measured). */
  private lastLog = 0;
  /** Full cycles in a row far off, and on which side (1 sharp, -1 flat). */
  private farRun = 0;
  private farSide = 0;

  reset(): void {
    this.correction = 1;
    this.measured = this.target;
    this.pending = 0;
    this.lastLog = 0;
    this.farRun = 0;
    this.farSide = 0;
  }

  /** One measured cycle: update the correction. A no-op unless a cycle is pending (see FoldOscillator.step). */
  cycle(): void {
    if (this.pending === 0) return;
    this.pending = 0;
    const m = this.measured;
    const t = this.target;
    if (!(m > 0) || !(t > 0)) return;
    let ratio = t / m;
    let lost = 0;
    if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) {
      // ignored alone; a run of full cycles far off on one side is a correction carried out of range, and
      // ignoring them held it there (MEASURED: the child's /bɑ/ in "stops" 0.5 s at 1.8 times its note)
      const side = ratio > 1 ? 1 : -1;
      this.farRun = this.deep === 0 ? 0 : side === this.farSide ? this.farRun + 1 : 1;
      this.farSide = side;
      if (this.farRun < FAR_RUN) return;
      // Math.min and Math.max, not a conditional: V8 boxed a double merged with a module-level constant
      ratio = Math.min(Math.max(ratio, 1 / MAX_RATIO), MAX_RATIO);
      lost = 1;
    } else this.farRun = 0;
    // in an onset (or lost) a large error converges faster: the time constant shrinks by 1 + |error| /
    // ADAPT_CENTS, so an onset's semitone or two after a voiceless stop is gone in a few cycles instead of a
    // 60 to 100 ms audible slide (MEASURED in "twinkle": onsets 1 to 2.7 semitones sharp, falling over 60
    // to 100 ms at tau alone). Mid-note it does not: the pressure falling in a voiced closure lowers f0 for
    // as long as the closure lasts, and chasing that dip fast took the correction from 1.08 to 1.76 in 25 ms
    // and the release 800 cents sharp (MEASURED, the same /bɑ/)
    // Only a full cycle whose error the cycle before agrees with speeds it up (the smaller of the two, same sign): one odd
    // cycle (an irregular turn, a cycle locked to a resonance) at the fast rate threw the correction about
    // (MEASURED: drops of 15 percent in one cycle near F1 in the female melisma)
    if (this.restart !== 0) {
      this.restart = 0;
      this.lastLog = 0;
    }
    const lr = Math.log(ratio);
    const lp = this.lastLog;
    this.lastLog = lr;
    const same = lr * lp > 0 ? 1 : 0;
    const a = lr < 0 ? -lr : lr;
    const b = lp < 0 ? -lp : lp;
    // the closing folds' shallow cycles run at any rate as the pressure under them builds (MEASURED: two at
    // 366 Hz under a 460 Hz target took the correction from 1.20 to 1.42 and the note began 280 cents sharp)
    const cents = this.deep * same * (this.onset | lost) * (a < b ? a : b) * CENTS_PER_NEPER;
    const g = 1 - Math.exp((-this.weight * (1 + cents / ADAPT_CENTS)) / (m * this.tau));
    // Math.min and Math.max, not a conditional: V8 boxed a double merged with a module-level constant
    this.correction = Math.min(Math.max(this.correction * Math.pow(ratio, g), MIN_CORRECTION), MAX_CORRECTION);
  }
}
