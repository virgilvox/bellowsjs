/*
 * Piecewise-linear tempo automation in the beat domain, with exact
 * closed-form conversion between beats and seconds.
 *
 * Over a segment where bpm ramps linearly from (b0, T0) to (b1, T1),
 * with slope k = (T1 - T0) / (b1 - b0), elapsed seconds at beat b are
 *
 *   t(b) = integral of 60 / T(x) dx from b0 to b
 *        = (60 / k) * ln(T(b) / T0)          when k != 0
 *        = 60 * (b - b0) / T0                in the constant-tempo limit
 *
 * and the inverse is
 *
 *   b(t) = b0 + T0 * (exp(k * t / 60) - 1) / k   when k != 0
 *        = b0 + t * T0 / 60                       otherwise.
 *
 * Points come in two flavors. rampTo(beat, bpm) interpolates linearly
 * from the previous point. setBpm(beat, bpm) is a step: tempo holds the
 * previous value up to `beat`, then jumps. Tempo is constant before the
 * first point and after the last. Lookups binary search precomputed
 * cumulative times, so both directions are O(log segments).
 */

const K_EPS = 1e-9;

interface Point {
  beat: number;
  bpm: number;
  /** True when this point ramps from the previous one instead of stepping. */
  ramp: boolean;
}

export class TempoMap {
  private points: Point[] = [];
  /** Seconds at each point's beat, measured from the first point's beat. */
  private cum: number[] = [];
  /** Raw seconds at beat 0, subtracted so beatToSeconds(0) === 0. */
  private zeroTime = 0;
  private dirty = true;

  constructor(bpm = 120) {
    this.insert(0, bpm, false);
  }

  /** Set an instantaneous tempo change at `beat`. Tempo before it is unaffected. */
  setBpm(beat: number, bpm: number): void {
    this.insert(beat, bpm, false);
  }

  /** Add a point reached by a linear ramp from the previous point. */
  rampTo(beat: number, bpm: number): void {
    this.insert(beat, bpm, true);
  }

  /** Instantaneous bpm at `beat`. */
  bpmAt(beat: number): number {
    this.rebuild();
    const pts = this.points;
    const i = this.pointIndexFor(beat);
    if (i < 0) return pts[0].bpm;
    if (i >= pts.length - 1) return pts[pts.length - 1].bpm;
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const t1 = p1.ramp ? p1.bpm : p0.bpm;
    const k = (t1 - p0.bpm) / (p1.beat - p0.beat);
    return p0.bpm + k * (beat - p0.beat);
  }

  /** Seconds elapsed from beat 0 to `beat`. Negative beats give negative times. */
  beatToSeconds(beat: number): number {
    this.rebuild();
    return this.rawTime(beat) - this.zeroTime;
  }

  /** Inverse of beatToSeconds. */
  secondsToBeat(sec: number): number {
    this.rebuild();
    const raw = sec + this.zeroTime;
    const pts = this.points;
    const cum = this.cum;
    const last = pts.length - 1;

    if (raw <= cum[0]) {
      return pts[0].beat + ((raw - cum[0]) * pts[0].bpm) / 60;
    }
    if (raw >= cum[last]) {
      return pts[last].beat + ((raw - cum[last]) * pts[last].bpm) / 60;
    }

    // Largest i with cum[i] <= raw.
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= raw) lo = mid;
      else hi = mid - 1;
    }
    const p0 = pts[lo];
    const p1 = pts[lo + 1];
    const t0 = p0.bpm;
    const t1 = p1.ramp ? p1.bpm : t0;
    const k = (t1 - t0) / (p1.beat - p0.beat);
    const dt = raw - cum[lo];
    if (Math.abs(k) < K_EPS) return p0.beat + (dt * t0) / 60;
    return p0.beat + (t0 * (Math.exp((k * dt) / 60) - 1)) / k;
  }

  private insert(beat: number, bpm: number, ramp: boolean): void {
    if (!Number.isFinite(beat)) throw new Error(`non-finite beat: ${beat}`);
    if (!(bpm > 0) || !Number.isFinite(bpm)) throw new Error(`invalid bpm: ${bpm}`);
    const pts = this.points;
    let i = 0;
    while (i < pts.length && pts[i].beat < beat) i++;
    if (i < pts.length && pts[i].beat === beat) pts[i] = { beat, bpm, ramp };
    else pts.splice(i, 0, { beat, bpm, ramp });
    this.dirty = true;
  }

  /** Largest index with points[i].beat <= beat, or -1 when beat precedes all points. */
  private pointIndexFor(beat: number): number {
    const pts = this.points;
    if (beat < pts[0].beat) return -1;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].beat <= beat) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Seconds over `db` beats of a segment starting at `t0` bpm with slope `k`. */
  private static segSeconds(t0: number, k: number, db: number): number {
    if (Math.abs(k) < K_EPS) return (60 * db) / t0;
    return (60 / k) * Math.log((t0 + k * db) / t0);
  }

  /** Seconds at `beat` measured from the first point's beat. */
  private rawTime(beat: number): number {
    const pts = this.points;
    const cum = this.cum;
    const i = this.pointIndexFor(beat);
    if (i < 0) return cum[0] + (60 * (beat - pts[0].beat)) / pts[0].bpm;
    if (i >= pts.length - 1) {
      const p = pts[pts.length - 1];
      return cum[pts.length - 1] + (60 * (beat - p.beat)) / p.bpm;
    }
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const t1 = p1.ramp ? p1.bpm : p0.bpm;
    const k = (t1 - p0.bpm) / (p1.beat - p0.beat);
    return cum[i] + TempoMap.segSeconds(p0.bpm, k, beat - p0.beat);
  }

  private rebuild(): void {
    if (!this.dirty) return;
    const pts = this.points;
    this.cum = new Array<number>(pts.length);
    this.cum[0] = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const t1 = p1.ramp ? p1.bpm : p0.bpm;
      const db = p1.beat - p0.beat;
      const k = (t1 - p0.bpm) / db;
      this.cum[i + 1] = this.cum[i] + TempoMap.segSeconds(p0.bpm, k, db);
    }
    this.dirty = false;
    this.zeroTime = 0;
    this.zeroTime = this.rawTime(0);
  }
}
