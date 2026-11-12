/*
 * One body's roof of the mouth (the velum from the uvula tip, then the hard
 * palate to the incisors) and the projections onto it that the voice's
 * contact rule uses: a tongue tip or body that presses more than 0.1 k cm
 * into the roof is pushed back along the contact normal (CHIMERA
 * human_voice.rs:520-552). Evaluated at every articulator step, so it is a
 * fixed polyline, not the full geometry.
 *
 * Learned from CHIMERA by Jameson Hodge (MIT,
 * https://github.com/jamesondh/chimera-vocal-synth at 1d3ea49): the roof
 * polylines (extracted from anatomy/human.rs), the template-to-body
 * transform (human.rs:685) and the rule that keeps the tip outside the
 * tongue body (human.rs:828). Reimplemented here; see THIRD_PARTY_NOTICES.md.
 * Nothing here allocates after construction.
 */

import { ART } from './vocal-articulators';
import type { VocalBodyTable } from './vocal-tables.gen';

export class VocalRoof {
  readonly k: number = 0;
  readonly pharynxScale: number = 0;
  /** Tongue body radius, body cm. */
  readonly r: number = 0;
  private readonly roofX: Float64Array;
  private readonly roofY: Float64Array;
  /* project()'s input point and its results: the signed distance and the nearest roof point. */
  x = 0;
  y = 0;
  sd = 0;
  qx = 0;
  qy = 0;
  /* The tongue body's centre of the last bodyPoint(). */
  bx = 0;
  by = 0;
  /* The tip point of the last tipPoint(). */
  tipX = 0;
  tipY = 0;

  constructor(t: VocalBodyTable) {
    this.k = t.k;
    this.pharynxScale = t.pharynxScale;
    this.r = t.tongueRadius * t.k;
    this.roofX = Float64Array.from(t.roofX);
    this.roofY = Float64Array.from(t.roofY);
  }

  /** Template to body coordinates (human.rs:685). */
  px(x: number): number {
    return (x > 0.5 ? 0.5 + (x - 0.5) * 0.86 : x) * this.k;
  }
  py(y: number): number {
    return (y < 7 ? 7 - (7 - y) * this.pharynxScale : y) * this.k;
  }
  /** d(body x) / d(template x) and likewise for y, at a template point. */
  sx(x: number): number {
    return (x > 0.5 ? 0.86 : 1) * this.k;
  }
  sy(y: number): number {
    return (y < 7 ? this.pharynxScale : 1) * this.k;
  }

  /**
   * The signed distance from (x, y) (the fields) to the roof, positive below
   * it (in the airway), into sd, and the nearest roof point into qx, qy.
   * Inputs and results are fields, so no double crosses the call.
   */
  project(): void {
    const x = this.x;
    const y = this.y;
    let best = Infinity;
    let sgn = 1;
    const X = this.roofX;
    const Y = this.roofY;
    for (let i = 0; i + 1 < X.length; i++) {
      const ax = X[i];
      const ay = Y[i];
      const ex = X[i + 1] - ax;
      const ey = Y[i + 1] - ay;
      const l2 = ex * ex + ey * ey;
      let t = ((x - ax) * ex + (y - ay) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t;
      const qy = ay + ey * t;
      const d = Math.sqrt((x - qx) * (x - qx) + (y - qy) * (y - qy));
      if (d < best) {
        best = d;
        sgn = ex * (y - ay) - ey * (x - ax) < 0 ? 1 : -1;
        this.qx = qx;
        this.qy = qy;
      }
    }
    this.sd = best * sgn;
  }

  /** The tongue body's centre in body coordinates, into bx, by. */
  bodyPoint(a: ArrayLike<number>): void {
    const tx = a[ART.tbX];
    const ty = a[ART.tbY];
    this.bx = (tx > 0.5 ? 0.5 + (tx - 0.5) * 0.86 : tx) * this.k;
    this.by = (ty < 7 ? 7 - (7 - ty) * this.pharynxScale : ty) * this.k;
  }

  /** The tip point in body coordinates, kept 1.05 r outside the tongue body, into tipX, tipY. */
  tipPoint(a: ArrayLike<number>): void {
    // px() and py() written out, so no double crosses a call
    const k = this.k;
    const ps = this.pharynxScale;
    const ax = a[ART.tbX];
    const ay = a[ART.tbY];
    const cx = a[ART.ttX];
    const cy = a[ART.ttY];
    const bx = (ax > 0.5 ? 0.5 + (ax - 0.5) * 0.86 : ax) * k;
    const by = (ay < 7 ? 7 - (7 - ay) * ps : ay) * k;
    let tx = (cx > 0.5 ? 0.5 + (cx - 0.5) * 0.86 : cx) * k;
    let ty = (cy < 7 ? 7 - (7 - cy) * ps : cy) * k;
    const d = Math.sqrt((tx - bx) * (tx - bx) + (ty - by) * (ty - by));
    if (d < 1.05 * this.r) {
      const s = (1.05 * this.r) / (d > 1e-9 ? d : 1e-9);
      tx = bx + (tx - bx) * s;
      ty = by + (ty - by) * s;
    }
    this.tipX = tx;
    this.tipY = ty;
  }
}
