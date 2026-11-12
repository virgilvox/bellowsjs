/*
 * How fast a cross-section of the tract may open or close: CHIMERA's area
 * rate limit, ported from CHIMERA by Jameson Hodge (MIT,
 * https://github.com/jamesondh/chimera-vocal-synth,
 * crates/chimera/src/voice/human_airway.rs:151-156 and 190-262 at
 * 1d3ea49). Reimplemented; see THIRD_PARTY_NOTICES.md. The junction
 * airway (dsp/junction-airway.ts) runs it on its grid sections and on
 * their sub-section minima, as CHIMERA runs it on its network's.
 *
 * Opening is limited to (45 k^2 + 40 A) cm^2/s: wide cavities reshape
 * fast, narrow constrictions open at a physiological rate, which sets how
 * sharp a burst is. Closing eases from that rate down to 5 k^2 cm^2/s by a
 * smoothstep between 0.03 and 0.4 k^2 cm^2, and under 0.03 k^2 slows
 * with sqrt(A / 0.03 k^2), so a seal is reached smoothly. CHIMERA's
 * comments say why: at a constant rate the flow's slope dropped to zero at
 * once, a step in the radiated pressure, and sealing at the opening rate
 * shut within about a millisecond; both are audible clicks. A prototype
 * of this voice had no limit and clicked at stop releases (MEASURED:
 * 421 click events CHIMERA lacked over 21 renders).
 */

const MAX_AREA_RATE = 45;
const AREA_RATE_GAIN = 40;
const SEAL_RATE = 5;
const SEAL_LO = 0.03;
const SEAL_HI = 0.4;
const SEAL_EASE = 0.03;

export class AreaSlew {
  private openR = MAX_AREA_RATE;
  private sealR = SEAL_RATE;
  private lo = SEAL_LO;
  private hi = SEAL_HI;
  private ease = SEAL_EASE;
  private dt = 0;

  /** The body scale k: every rate and threshold scales with k^2. */
  setScale(k: number): void {
    const k2 = k * k;
    this.openR = MAX_AREA_RATE * k2;
    this.sealR = SEAL_RATE * k2;
    this.lo = SEAL_LO * k2;
    this.hi = SEAL_HI * k2;
    this.ease = SEAL_EASE * k2;
  }

  /** The step limitAll() limits over, seconds. Set once; no double crosses limitAll(). */
  setStep(dt: number): void {
    this.dt = dt;
  }

  /** The closing rate at area a, cm^2/s. */
  private closeRate(a: number): number {
    if (a < this.ease) return this.sealR * Math.sqrt((a > 0 ? a : 0) / this.ease);
    const u = a <= this.lo ? 0 : a >= this.hi ? 1 : (a - this.lo) / (this.hi - this.lo);
    return this.sealR + (this.openR - this.sealR) * u * u * (3 - 2 * u);
  }

  /** The area `next` limited against `prev` over dt seconds. */
  limit(next: number, prev: number, dt: number): number {
    const d = next - prev;
    if (d > 0) {
      const lim = (this.openR + AREA_RATE_GAIN * next) * dt;
      return d > lim ? prev + lim : next;
    }
    const lim = (this.closeRate(prev) + AREA_RATE_GAIN * prev) * dt;
    return d < -lim ? prev - lim : next;
  }

  /** next[0 .. count) limited against prev over setStep()'s step, in place; limit() written out, so no double crosses a call. */
  limitAll(next: Float64Array, prev: Float64Array, count: number): void {
    const dt = this.dt;
    const openR = this.openR;
    const sealR = this.sealR;
    const lo = this.lo;
    const span = this.hi - this.lo;
    const ease = this.ease;
    for (let i = 0; i < count; i++) {
      const a = prev[i];
      const d = next[i] - a;
      if (d > 0) {
        const lim = (openR + AREA_RATE_GAIN * next[i]) * dt;
        if (d > lim) next[i] = a + lim;
        continue;
      }
      let rate: number;
      if (a < ease) rate = sealR * Math.sqrt((a > 0 ? a : 0) / ease);
      else {
        let u = (a - lo) / span;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        rate = sealR + (openR - sealR) * u * u * (3 - 2 * u);
      }
      const lim = (rate + AREA_RATE_GAIN * a) * dt;
      if (d < -lim) next[i] = a - lim;
    }
  }
}
