/*
 * From the tract's shape to the junction airway's inputs. The exact
 * geometry (engines/vocal-geometry.ts) is evaluated about every 10.7 ms, a
 * keyframe; between two keyframes the areas, sub-section minima, lengths,
 * incisors and velum port are interpolated block by block (MEASURED in the
 * geometry's prototype: 100 Hz with interpolation lies 0.05 dB from
 * evaluating every 2.7 ms over all frames, 0.33 dB over consonants, at a
 * quarter of the cost). Each block, the interpolated profile (pharynx then
 * oral sections, glottis to lips) is resampled onto the airway's grid in one
 * sweep:
 *
 *   - the back duct takes up whatever the grid does not cover (at least
 *     DUCT_MIN), its area the harmonic mean over it;
 *   - each grid section's area is the harmonic mean of the profile over it,
 *     and its minimum the smallest sub-section minimum of the profile
 *     sections it overlaps, never above its own area (CHIMERA's jet rule);
 *   - the incisors and the pharynx/oral split become grid positions;
 *   - the anatomical moving-wall flow: each profile section's volume change
 *     across the keyframe interval, as -dV/dt at its place on the grid. It
 *     must not be differenced from grid areas: a grid that slides along the
 *     anatomy is not a volume change (MEASURED in the airway's prototype, a
 *     spurious 382 cm^3/s at one near-closure).
 *
 * CHIMERA's area rate law (human_airway.rs:190-262) limits each keyframe's
 * sections against the last, as CHIMERA limits its own. Learned from
 * CHIMERA by Jameson Hodge (MIT, https://github.com/jamesondh/chimera-vocal-synth
 * at 1d3ea49); see THIRD_PARTY_NOTICES.md. Nothing here allocates after
 * construction, and no double crosses a call: the airway's inputs are its
 * fields.
 */

import { SOUND_SPEED } from '../dsp/air';
import { AreaSlew } from '../dsp/area-rate';
import { ductMin, type JunctionAirway } from '../dsp/junction-airway';
import { ChimeraGeometry } from './vocal-geometry';

/** Blocks per keyframe. */
export const VOCAL_KEY_BLOCKS = 16;
/** The profile smoother's natural frequency, Hz (MEASURED choice: smooth release onsets, closures still sealed). */
const SMOOTH_HZ = 70;
/** Most profile sections per tube. */
const MAX_TUBE = 40;

/** CHIMERA's section counts for a body of scale k with pharynx factor ph, at its 96 kHz airway (human_airway.rs:75-80). */
function tubeCounts(k: number, ph: number, out: Int32Array): void {
  const dxMin = SOUND_SPEED / 96000 / 0.93;
  const phMin = 8.7 * k * (0.55 + 0.45 * ph) - 1.6 * k;
  const orMin = 8.3 * k - 1.0 * k;
  out[0] = Math.min(MAX_TUBE, Math.max(8, Math.floor(phMin / dxMin)));
  out[1] = Math.min(MAX_TUBE, Math.max(8, Math.floor(orMin / dxMin)));
}

/** One evaluated shape. */
class Key {
  readonly ph = new Float64Array(MAX_TUBE);
  readonly or = new Float64Array(MAX_TUBE);
  readonly phMin = new Float64Array(MAX_TUBE);
  readonly orMin = new Float64Array(MAX_TUBE);
  phLen = 8.8;
  orLen = 8.3;
  teeth = 16;
  velum = 0;

  copy(s: Key): void {
    this.ph.set(s.ph);
    this.or.set(s.or);
    this.phMin.set(s.phMin);
    this.orMin.set(s.orMin);
    this.phLen = s.phLen;
    this.orLen = s.orLen;
    this.teeth = s.teeth;
    this.velum = s.velum;
  }
}

export class VocalDrive {
  readonly geometry: ChimeraGeometry;
  private readonly prev = new Key();
  private readonly next = new Key();
  private readonly counts = new Int32Array(2);
  private nPh = 18;
  private nOr = 18;
  private readonly slew = new AreaSlew();
  /* The interpolated profile: edges (cm from the glottis), areas, minima, volumes and centres per section. */
  private readonly edge = new Float64Array(2 * MAX_TUBE + 1);
  private readonly prof = new Float64Array(2 * MAX_TUBE);
  private readonly pmin = new Float64Array(2 * MAX_TUBE);
  /*
   * The profile as it is heard: areas and minima through a critically damped two-pole at SMOOTH_HZ,
   * stepped once a block, so a release between two keyframes accelerates as articulators do instead
   * of opening at the area rate law's limit from its first block (MEASURED: a 61 dB step out of the
   * closure at the twinkle /k/, against CHIMERA's 26).
   */
  private readonly sProf = new Float64Array(2 * MAX_TUBE);
  private readonly vProf = new Float64Array(2 * MAX_TUBE);
  private readonly sMin = new Float64Array(2 * MAX_TUBE);
  private readonly vMin = new Float64Array(2 * MAX_TUBE);
  private sa = 1;
  private sb = 0;
  private sc = 0;
  private sd = 1;
  private snapped = true;
  /** -dV/dt per profile section over the current keyframe interval, cm^3/s. */
  private readonly dvdt = new Float64Array(2 * MAX_TUBE);
  private keyDt = 0.01;
  private readonly lbMin: number = 0;
  private readonly dx: number = 0;
  /** Fraction of the keyframe interval toAirway() reads, [0, 1]; a field, so no double crosses the call. */
  u = 0;

  constructor(rate: number) {
    this.dx = SOUND_SPEED / (2 * rate);
    this.lbMin = ductMin(rate);
    this.geometry = new ChimeraGeometry({ scale: 1, pharynx: 1, tongueRadius: 2.25, lipWidth: 4.6 });
    const blockDt = Math.max(8, Math.round((32 * rate) / 48000)) / rate;
    this.keyDt = VOCAL_KEY_BLOCKS * blockDt;
    this.slew.setStep(this.keyDt);
    // the smoother's exact step over one block: [e', v'] = [[sa, sb], [sc, sd]] [e, v]
    const w = 2 * Math.PI * SMOOTH_HZ;
    const k = Math.exp(-w * blockDt);
    this.sa = (1 + w * blockDt) * k;
    this.sb = blockDt * k;
    this.sc = -w * w * blockDt * k;
    this.sd = (1 - w * blockDt) * k;
  }

  /** A body (scale, pharynx, tongue radius, lip width), at a note-on. Allocates nothing. */
  setBody(scale: number, pharynx: number, tongueRadius: number, lipWidth: number): void {
    this.geometry.setBody(scale, pharynx, tongueRadius, lipWidth);
    tubeCounts(scale, pharynx, this.counts);
    this.nPh = this.counts[0];
    this.nOr = this.counts[1];
    this.slew.setScale(scale);
  }

  /**
   * A new keyframe from the articulators a (17, CHIMERA's order): the last
   * becomes the start of the interval. snap: both ends are this shape (a
   * note's start), and nothing is rate limited.
   */
  key(a: Float64Array, snap: boolean): void {
    const g = this.geometry;
    const p = this.prev;
    const q = this.next;
    p.copy(q);
    g.evaluate(a);
    const nPh = this.nPh;
    const nOr = this.nOr;
    g.resampleInto(q.ph, q.or, q.phMin, q.orMin, nPh, nOr);
    q.phLen = g.phLen;
    q.orLen = g.orLen;
    q.teeth = g.teethS;
    q.velum = g.velumPort;
    if (snap) {
      p.copy(q);
      this.snapped = true;
    } else {
      this.slew.limitAll(q.ph, p.ph, nPh);
      this.slew.limitAll(q.or, p.or, nOr);
      this.slew.limitAll(q.phMin, p.phMin, nPh);
      this.slew.limitAll(q.orMin, p.orMin, nOr);
      for (let i = 0; i < nPh; i++) if (q.phMin[i] > q.ph[i]) q.phMin[i] = q.ph[i];
      for (let i = 0; i < nOr; i++) if (q.orMin[i] > q.or[i]) q.orMin[i] = q.or[i];
    }
    // each section's volume change across the interval, -dV/dt
    const dt = this.keyDt;
    for (let i = 0; i < nPh; i++) this.dvdt[i] = snap ? 0 : -((q.ph[i] * q.phLen - p.ph[i] * p.phLen) / nPh) / dt;
    for (let i = 0; i < nOr; i++) this.dvdt[nPh + i] = snap ? 0 : -((q.or[i] * q.orLen - p.or[i] * p.orLen) / nOr) / dt;
  }

  /**
   * The airway's inputs at fraction `u` of the keyframe interval: grid
   * areas and minima, the duct, the velum port, incisors, split and
   * moving-wall flow, written into `air`'s fields.
   */
  toAirway(air: JunctionAirway): void {
    const u = this.u;
    const w0 = 1 - u;
    const p = this.prev;
    const q = this.next;
    const nPh = this.nPh;
    const nOr = this.nOr;
    const c = nPh + nOr;
    const phLen = p.phLen * w0 + q.phLen * u;
    const orLen = p.orLen * w0 + q.orLen * u;
    const edge = this.edge;
    const prof = this.prof;
    const pmin = this.pmin;
    edge[0] = 0;
    for (let i = 0; i < nPh; i++) {
      prof[i] = p.ph[i] * w0 + q.ph[i] * u;
      pmin[i] = p.phMin[i] * w0 + q.phMin[i] * u;
      edge[i + 1] = ((i + 1) * phLen) / nPh;
    }
    for (let i = 0; i < nOr; i++) {
      prof[nPh + i] = p.or[i] * w0 + q.or[i] * u;
      pmin[nPh + i] = p.orMin[i] * w0 + q.orMin[i] * u;
      edge[nPh + i + 1] = phLen + ((i + 1) * orLen) / nOr;
    }
    // the smoother, one block per call
    const sp = this.sProf;
    const vp = this.vProf;
    const sm = this.sMin;
    const vm = this.vMin;
    if (this.snapped) {
      for (let i = 0; i < c; i++) {
        sp[i] = prof[i];
        sm[i] = pmin[i];
        vp[i] = 0;
        vm[i] = 0;
      }
      this.snapped = false;
    } else {
      const a = this.sa;
      const b = this.sb;
      const cc = this.sc;
      const d = this.sd;
      for (let i = 0; i < c; i++) {
        let e = sp[i] - prof[i];
        let v = vp[i];
        sp[i] = prof[i] + a * e + b * v;
        vp[i] = cc * e + d * v;
        e = sm[i] - pmin[i];
        v = vm[i];
        sm[i] = pmin[i] + a * e + b * v;
        vm[i] = cc * e + d * v;
      }
    }
    for (let i = 0; i < c; i++) {
      const a = sp[i] > 0 ? sp[i] : 0;
      prof[i] = a;
      const m = sm[i] > 0 ? sm[i] : 0;
      pmin[i] = m < a ? m : a;
    }
    const L = phLen + orLen;
    const n = air.nG;
    let lb = L - n * this.dx;
    if (lb < this.lbMin) lb = this.lbMin;
    const step = (L - lb) / n;
    // the duct: harmonic mean over [0, lb)
    let k = 0;
    {
      let inv = 0;
      while (k < c && edge[k] < lb) {
        const lo = edge[k];
        const hi = edge[k + 1] < lb ? edge[k + 1] : lb;
        if (hi > lo) inv += (hi - lo) / (prof[k] > 1e-6 ? prof[k] : 1e-6);
        if (edge[k + 1] > lb) break;
        k++;
      }
      air.ductLen = lb;
      air.ductArea = inv > 0 ? lb / inv : prof[0];
    }
    // the grid sections, one sweep
    const gridIn = air.gridIn;
    const gridMin = air.gridMin;
    for (let i = 0; i < n; i++) {
      const x0 = lb + i * step;
      const x1 = x0 + step;
      while (k < c - 1 && edge[k + 1] <= x0) k++;
      let inv = 0;
      let mn = Infinity;
      let q2 = k;
      while (q2 < c && edge[q2] < x1) {
        const lo = edge[q2] > x0 ? edge[q2] : x0;
        const hi = edge[q2 + 1] < x1 ? edge[q2 + 1] : x1;
        const a = prof[q2] > 1e-6 ? prof[q2] : 1e-6;
        if (hi > lo) inv += (hi - lo) / a;
        const m = pmin[q2] < a ? pmin[q2] : a;
        if (m < mn) mn = m;
        q2++;
      }
      const ga = inv > 0 ? step / inv : prof[c - 1];
      gridIn[i] = ga;
      gridMin[i] = mn < ga ? mn : ga;
    }
    // incisors and split as grid positions; the velum port
    const teeth = p.teeth * w0 + q.teeth * u;
    air.teethI = Math.round((teeth - lb) / step);
    air.splitI = (phLen - lb) / step;
    air.velum = p.velum * w0 + q.velum * u;
    // the moving-wall flow at each section's place, shared between the two nearest junctions so it
    // moves along the grid continuously as the tract does (snapped to one, it jumped between blocks)
    const vflow = air.vflow;
    for (let j = 0; j <= n; j++) vflow[j] = 0;
    for (let s = 0; s < c; s++) {
      let pos = (0.5 * (edge[s] + edge[s + 1]) - lb) / step;
      pos = pos < 0 ? 0 : pos > n ? n : pos;
      let j = Math.floor(pos);
      if (j >= n) j = n - 1;
      const f = pos - j;
      vflow[j] += (1 - f) * this.dvdt[s];
      vflow[j + 1] += f * this.dvdt[s];
    }
  }

  /** The tract length of the current interpolated shape, cm (for layout checks). */
  get length(): number {
    const u = this.u;
    return (this.prev.phLen + this.prev.orLen) * (1 - u) + (this.next.phLen + this.next.orLen) * u;
  }
}
