/*
 * The tract's shape from the articulators: CHIMERA's midsagittal geometry,
 * ported exactly. 17 articulators and a body in; the area function out
 * (pharynx and oral tubes at any section count, with the smallest area
 * inside each section), the lengths, the incisors' place, the velum port and
 * the lips' area. MEASURED in the port's verification against CHIMERA's own
 * Rust: every output within 6e-14 over 8325 frames.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth at 1d3ea49:
 *   crates/chimera/src/anatomy/human.rs
 *     276-278   body constants (scale, pharynx, tongue radius, lip width)
 *     421-439   NEUTRAL (tongue body reference)
 *     507-519   DEG, LAB_HANDOVER, LAB_GAP, LAB_FRONT_OPENS, LAB_FRONT_RAMP, ARC_POINTS, MAX_CROSS
 *     644-683   HumanVocalTract::new (landmarks, area law)
 *     685-692   p() template to body map
 *     725-1263  compute (jaw, velum, outer wall, lips, tongue, inner wall, grid rays, contact
 *               model, lip contact, area laws, spike clamp, lateral channel, centreline)
 *     1266-1282 epilarynx_area
 *     1287-1374 resample (harmonic means with sub-section minima)
 *     1398-1490 project_on, point_along, signed_gap, closest_approach
 *   crates/chimera/src/anatomy/geom.rs: polar, rotate_about, ray_polyline, crossing_t,
 *     ray_crossings, bezier3, bezier2, arc, catmull_rom, tangent_angle
 *   crates/chimera/src/math.rs 89-158: js_min, js_max, clamp, lerp, smoothstep
 * See THIRD_PARTY_NOTICES.md.
 *
 * Changes from the original, all for the audio thread: every point list is a
 * preallocated Float64Array with a count, Vec2 results are written into
 * scratch fields, and no double crosses a call boundary in a loop (V8 boxes
 * doubles passed to or returned from calls it does not inline), so
 * evaluate() and resample() allocate nothing. setBody() lays out a new body
 * without allocating, so a body can change at a note-on. Drawing-only
 * outputs (the lips' outer faces, jaw bone, teeth outlines, nasal cavity)
 * are left out. hypot is sqrt(x^2 + y^2).
 */

export const N_ARTIC = 17;
const A = { jaw: 0, tbX: 1, tbY: 2, ttX: 3, ttY: 4, ttCurl: 5, root: 6, lipAp: 7, lipProt: 8, lipWidth: 9, labiodental: 10, velum: 11, larynx: 12, epilarynx: 13, ventricular: 14, lateral: 15, dorsum: 16 } as const;
/** CHIMERA's three bodies (human.rs:276-278): male, female, child. */
export const GEOMETRY_BODIES: readonly GeometryBody[] = [
  { scale: 1.0, pharynx: 1.0, tongueRadius: 2.25, lipWidth: 4.6 },
  { scale: 0.9, pharynx: 0.88, tongueRadius: 2.2, lipWidth: 4.4 },
  { scale: 0.74, pharynx: 0.8, tongueRadius: 2.15, lipWidth: 4.0 },
];
export interface GeometryBody {
  scale: number;
  pharynx: number;
  tongueRadius: number;
  lipWidth: number;
}
/** The pharynx wall and the hard palate, template cm (human.rs:644-683). */
const WALL_T = [-1.0, -1.5, -1.1, 1.5, -1.2, 3.6, -1.3, 5.6, -1.38, 7.5, -1.33, 8.9, -1.05, 10.1, -0.45, 10.9, 0.4, 11.3];
const PAL_T = [1.0, 9.6, 1.8, 9.92, 2.7, 10.18, 3.6, 10.3, 4.4, 10.25, 5.1, 10.05, 5.7, 9.72, 6.15, 9.36, 6.5, 9.05, 6.78, 8.7, 6.98, 8.3, 7.12, 7.95];

const PI = Math.PI;
const DEG = PI / 180;
const LAB_HANDOVER = 0.5;
const LAB_GAP = 0.3;
const LAB_FRONT_OPENS = 0.7;
const LAB_FRONT_RAMP = 0.1;
const ARC_POINTS = 32;
const MAX_CROSS = 64;
const POINTS = 256;
const GRID = 64;
const ROOF_STEPS = new Float64Array([-1.0, -0.5, 0.5, 1.0]);
/* CHIMERA's NEUTRAL tongue body (2.9, 6.85) is written as literals in evaluate(): a module constant
 * in a conditional made V8 box the doubles it merged with (MEASURED: 33 bytes an evaluation). */
const AREA_P = 2.0, AREA_O = 2.6, AREA_F = 2.0, AREA_H = 1.6, BETA = 1.4;

class Poly {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  n = 0;
  constructor(cap = POINTS) {
    this.xs = new Float64Array(cap);
    this.ys = new Float64Array(cap);
  }
}

/** A Catmull-Rom spline through (px[i], py[i]), i < m, `per` points a span, into out. */
function catmullRomInto(out: Poly, px: Float64Array, py: Float64Array, m: number, per: number): void {
  out.n = 0;
  for (let i = 0; i < m - 1; i++) {
    const i0 = i > 0 ? i - 1 : 0;
    const i3 = i + 2 < m - 1 ? i + 2 : m - 1;
    for (let q = 0; q < per; q++) {
      const t = q / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.xs[out.n] = 0.5 * (2.0 * px[i] + (-px[i0] + px[i + 1]) * t + (2.0 * px[i0] - 5.0 * px[i] + 4.0 * px[i + 1] - px[i3]) * t2 + (-px[i0] + 3.0 * px[i] - 3.0 * px[i + 1] + px[i3]) * t3);
      out.ys[out.n] = 0.5 * (2.0 * py[i] + (-py[i0] + py[i + 1]) * t + (2.0 * py[i0] - 5.0 * py[i] + 4.0 * py[i + 1] - py[i3]) * t2 + (-py[i0] + 3.0 * py[i] - 3.0 * py[i + 1] + py[i3]) * t3);
      out.n++;
    }
  }
  out.xs[out.n] = px[m - 1];
  out.ys[out.n] = py[m - 1];
  out.n++;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function smoothstep(e0: number, e1: number, x: number): number {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3.0 - 2.0 * t);
}

export class ChimeraGeometry {
  k = 1;
  // fixed landmarks (body coordinates), laid out by setBody()
  private readonly pharWall = new Poly(64);
  private readonly palate = new Poly(64);
  private readonly ctlX = new Float64Array(16);
  private readonly ctlY = new Float64Array(16);
  private pnsX = 0;
  private pnsY = 0;
  private condX = 0;
  private condY = 0;
  private polarCX = 0;
  private polarCY = 0;
  private polarC2X = 0;
  private polarC2Y = 0;
  private jawR = 1;
  // scratch outlines
  private readonly vel = new Poly(16);
  private readonly velOral = new Poly(16);
  private readonly velNasal = new Poly(16);
  private readonly outer = new Poly();
  private readonly inner = new Poly();
  private readonly upperLipIn = new Poly(16);
  private readonly lowerLipIn = new Poly(16);
  private readonly root = new Poly(16);
  private readonly arcPts = new Poly(ARC_POINTS + 1);
  private readonly blade = new Poly(16);
  private readonly under = new Poly(16);
  private readonly back = new Poly(64);
  private readonly roof = new Poly();
  private readonly cum = new Float64Array(POINTS);
  private readonly tipPts = new Poly(32);
  private readonly outline = new Poly();
  private readonly floorX = new Float64Array(3);
  private readonly floorY = new Float64Array(3);
  private readonly lowTeethX = new Float64Array(4);
  private readonly lowTeethY = new Float64Array(4);
  private readonly tmp = new Float64Array(MAX_CROSS);
  private readonly crossT = new Float64Array(MAX_CROSS);
  private readonly crossExit = new Uint8Array(MAX_CROSS);
  // ray in: ox, oy, dx, dy, tMin, tMax
  private readonly ray = new Float64Array(6);
  // scalar results of helpers: [0] x / value, [1] y, [2] s, [3] dist, [4] signed, [5] seg
  private readonly r = new Float64Array(8);
  // measured ray: inner x, y, outer x, y, d
  private readonly m = new Float64Array(5);
  // helper inputs (no doubles cross a call): bezier control points, points, arc positions
  private readonly io = new Float64Array(8);
  private fs0 = 0;
  private fs1 = 0;
  // current posture's derived values used by helpers
  private phScale = 1;
  private tongueR = 2.25;
  private lipWB = 4.6;
  private sinPhi = 0;
  private cosPhi = 1;

  /* The grid of the last evaluate(). */
  readonly gInX = new Float64Array(GRID);
  readonly gInY = new Float64Array(GRID);
  readonly gOutX = new Float64Array(GRID);
  readonly gOutY = new Float64Array(GRID);
  readonly gMidX = new Float64Array(GRID);
  readonly gMidY = new Float64Array(GRID);
  readonly gD = new Float64Array(GRID);
  readonly gArea = new Float64Array(GRID);
  readonly gS = new Float64Array(GRID);
  readonly gRegion = new Uint8Array(GRID);
  gN = 0;

  /* Scalar outputs of the last evaluate(). */
  length = 17;
  pharynxLength = 8.8;
  teethS = 16;
  lipS = 17;
  lipArea = 1;
  velumPort = 0;
  splitIndex = -1;
  tipX = 0;
  tipY = 0;
  contactTip = 1;
  contactBody = 1;
  contactTipNX = 0;
  contactTipNY = -1;
  contactBodyNX = 0;
  contactBodyNY = -1;
  /* resample() outputs. */
  phLen = 8.8;
  orLen = 8.3;
  private epiArt = 0;
  private ventArt = 0;

  constructor(body: GeometryBody) {
    this.setBody(body.scale, body.pharynx, body.tongueRadius, body.lipWidth);
  }

  /** Lay out a body (scale, pharynx factor, tongue radius cm, lip width cm). Allocates nothing. */
  setBody(scale: number, pharynx: number, tongueRadius: number, lipWidth: number): void {
    this.k = scale;
    this.phScale = pharynx;
    this.tongueR = tongueRadius;
    this.lipWB = lipWidth;
    const cx = this.ctlX;
    const cy = this.ctlY;
    for (let i = 0; i < WALL_T.length / 2; i++) {
      cx[i] = this.pX(WALL_T[2 * i]);
      cy[i] = this.pY(WALL_T[2 * i + 1]);
    }
    catmullRomInto(this.pharWall, cx, cy, WALL_T.length / 2, 4);
    for (let i = 0; i < PAL_T.length / 2; i++) {
      cx[i] = this.pX(PAL_T[2 * i]);
      cy[i] = this.pY(PAL_T[2 * i + 1]);
    }
    catmullRomInto(this.palate, cx, cy, PAL_T.length / 2, 3);
    this.pnsX = this.pX(1.0);
    this.pnsY = this.pY(9.75);
    this.condX = this.pX(-2.5);
    this.condY = this.pY(10.5);
    this.polarCX = this.pX(2.6);
    this.polarCY = this.pY(6.95);
    this.polarC2X = this.pX(5.0);
    this.polarC2Y = this.pY(6.85);
    const jx = this.pX(6.95) - this.condX;
    const jy = this.pY(7.75) - this.condY;
    this.jawR = Math.sqrt(jx * jx + jy * jy);
  }

  /** Template x to body x (human.rs:685). */
  pX(x: number): number {
    return (x > 0.5 ? 0.5 + (x - 0.5) * 0.86 : x) * this.k;
  }
  /** Template y to body y. */
  pY(y: number): number {
    return (y < 7.0 ? 7.0 - (7.0 - y) * this.phScale : y) * this.k;
  }

  /** j(): a jaw-carried template point, rotated about the condyle, into r[0], r[1]. */
  private j(x: number, y: number): void {
    const px = this.pX(x);
    const py = this.pY(y);
    const dx = px - this.condX;
    const dy = py - this.condY;
    this.r[0] = this.condX + dx * this.cosPhi - dy * this.sinPhi;
    this.r[1] = this.condY + dx * this.sinPhi + dy * this.cosPhi;
  }

  /** Geometry for an articulation (17 values in CHIMERA's order). Allocates nothing. */
  evaluate(a: ArrayLike<number>): void {
    const k = this.k;
    const phs = this.phScale;
    let ss = 0.0;
    let cc = 0.0;
    const r2 = this.r;
    const lar = a[A.larynx] * k;
    const glotY = (((0.0) < 7.0 ? 7.0 - (7.0 - (0.0)) * phs : (0.0)) * k) + lar;

    // ---- jaw
    const phi = (-((cc = (a[A.jaw])), cc < (-0.2) ? (-0.2) : cc > (3.0) ? (3.0) : cc) * k) / this.jawR;
    this.sinPhi = Math.sin(phi);
    this.cosPhi = Math.cos(phi);

    // ---- velum
    const vOpen = ((cc = (a[A.velum] / 1.2)), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
    const vAng = (194.0 + 46.0 * vOpen) * DEG;
    const vLen = 2.8 * k;
    const cv = Math.cos(vAng);
    const sv = Math.sin(vAng);
    const vel = this.vel, vo = this.velOral, vn = this.velNasal;
    vel.n = vo.n = vn.n = 0;
    for (let i = 0; i <= 10; i++) {
      const s = i / 10.0;
      const sag = Math.sin(s * PI) * k * (0.3 * vOpen - 0.12);
      const cx = this.pnsX + vLen * s * cv;
      const cy = this.pnsY + vLen * s * sv - sag;
      const nx = -sv;
      const ny = cv;
      const th = (0.48 - 0.2 * s) * k;
      vo.xs[i] = cx + nx * th;
      vo.ys[i] = cy + ny * th;
      vn.xs[i] = cx - nx * th;
      vn.ys[i] = cy - ny * th;
      vel.xs[i] = cx;
      vel.ys[i] = cy;
    }
    vel.n = vo.n = vn.n = 11;
    const pal = this.palate;
    const pal0x = pal.xs[0], pal0y = pal.ys[0];
    for (let i = 0; i < 11; i++) {
      const u = i / 10.0 / 0.35;
      if (u < 1.0) {
        const t = (1.0 - u) * (1.0 - u);
        vo.xs[i] = vo.xs[i] + (pal0x - vo.xs[i]) * t;
        vo.ys[i] = vo.ys[i] + (pal0y - vo.ys[i]) * t;
      }
    }

    // ---- outer contour
    const outer = this.outer;
    outer.n = 0;
    const uvY = vo.ys[10] - 0.3 * k;
    const pw = this.pharWall;
    for (let i = 0; i < pw.n; i++) {
      const py = pw.ys[i];
      if (py < uvY) {
        outer.xs[outer.n] = pw.xs[i];
        outer.ys[outer.n++] = py;
        continue;
      }
      if (i > 0) {
        const ax = pw.xs[i - 1], ay = pw.ys[i - 1];
        const den = py - ay;
        const t = ((cc = ((uvY - ay) / (den > 1e-9 ? den : 1e-9))), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
        outer.xs[outer.n] = ax + (pw.xs[i] - ax) * t;
        outer.ys[outer.n++] = ay + (py - ay) * t;
      }
      break;
    }
    const roofStart = outer.n;
    for (let i = 10; i >= 0; i--) {
      outer.xs[outer.n] = vo.xs[i];
      outer.ys[outer.n++] = vo.ys[i];
    }
    for (let i = 1; i < pal.n; i++) {
      outer.xs[outer.n] = pal.xs[i];
      outer.ys[outer.n++] = pal.ys[i];
    }
    const roofEnd = outer.n - 1;
    // upper lip
    const prot = ((cc = (a[A.lipProt])), cc < (-0.2) ? (-0.2) : cc > (1.6) ? (1.6) : cc) * k;
    const spreadW = ((cc = (a[A.lipWidth])), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
    const yMid = (7.85 - 0.3 * a[A.jaw]) * k;
    const lab = ((cc = (a[A.labiodental])), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
    const ap = a[A.lipAp] * k;
    const lipFrontX = (((8.15 + 0.12 * (1.0 - spreadW)) > 0.5 ? 0.5 + ((8.15 + 0.12 * (1.0 - spreadW)) - 0.5) * 0.86 : (8.15 + 0.12 * (1.0 - spreadW))) * k) + prot * 0.95;
    let ulx = lipFrontX - 0.15 * k;
    let uly = yMid + ap * 0.35 + lab * 0.35 * k;
    let llx = lipFrontX - 0.25 * k;
    let lly = yMid - ap * 0.65;
    const incX = pal.xs[pal.n - 1], incY = pal.ys[pal.n - 1];
    if (lab > 0.0) {
      const lt = a[A.lipAp] * k;
      const tx = incX + 0.05 * k;
      const ty = incY - (lt > -0.1 ? lt : -0.1);
      llx = llx + (tx - llx) * lab;
      lly = lly + (ty - lly) * lab;
      const ux = incX + 0.55 * k, uy = incY + 0.45 * k;
      ulx = ulx + (ux - ulx) * (lab * 0.7);
      uly = uly + (uy - uly) * (lab * 0.7);
    }
    {
      const bx = (((7.32) > 0.5 ? 0.5 + ((7.32) - 0.5) * 0.86 : (7.32)) * k), by = (((8.35) < 7.0 ? 7.0 - (7.0 - (8.35)) * phs : (8.35)) * k);
      { const io = this.io; io[0] = bx; io[1] = by; io[2] = bx + (0.3 * k + prot * 0.4); io[3] = by + 0.05 * k; io[4] = ulx + -0.35 * k; io[5] = uly + 0.12 * k; io[6] = ulx; io[7] = uly; this.bezier3(this.upperLipIn, 7); }
      const ul = this.upperLipIn;
      for (let i = 0; i < ul.n; i++) {
        outer.xs[outer.n] = ul.xs[i];
        outer.ys[outer.n++] = ul.ys[i];
      }
    }

    // ---- tongue
    const rr = this.tongueR * k;
    const bX = (((a[A.tbX]) > 0.5 ? 0.5 + ((a[A.tbX]) - 0.5) * 0.86 : (a[A.tbX])) * k), bY = (((a[A.tbY]) < 7.0 ? 7.0 - (7.0 - (a[A.tbY])) * phs : (a[A.tbY])) * k);
    const b0X = ((2.9 > 0.5 ? 0.5 + (2.9 - 0.5) * 0.86 : 2.9) * k), b0Y = ((6.85 < 7.0 ? 7.0 - (7.0 - 6.85) * phs : 6.85) * k);
    const valX = (((0.75) > 0.5 ? 0.5 + ((0.75) - 0.5) * 0.86 : (0.75)) * k) + (0.45 * (bX - b0X) + a[A.root] * k);
    const valY = (((3.3) < 7.0 ? 7.0 - (7.0 - (3.3)) * phs : (3.3)) * k) + (0.3 * (bY - b0Y) + 0.55 * lar);
    const epiBX = (((0.3) > 0.5 ? 0.5 + ((0.3) - 0.5) * 0.86 : (0.3)) * k) + 0.0;
    const epiBY = (((2.4) < 7.0 ? 7.0 - (7.0 - (2.4)) * phs : (2.4)) * k) + lar;
    const epiTX = (((0.0) > 0.5 ? 0.5 + ((0.0) - 0.5) * 0.86 : (0.0)) * k) + 0.35 * (valX - 0.75 * k);
    const epiTY = (((4.5) < 7.0 ? 7.0 - (7.0 - (4.5)) * phs : (4.5)) * k) + (lar * 0.8 + 0.15 * (bY - b0Y));
    const thB = 200.0 * DEG;
    const pBX = bX + rr * Math.cos(thB), pBY = bY + rr * Math.sin(thB);
    const tanBX = Math.sin(thB), tanBY = -Math.cos(thB);
    const hR = Math.sqrt((valX - pBX) * (valX - pBX) + (valY - pBY) * (valY - pBY)) / 3.0;
    { const io = this.io; io[0] = valX; io[1] = valY; io[2] = valX + 0.08 * k; io[3] = valY + hR; io[4] = pBX - tanBX * hR; io[5] = pBY - tanBY * hR; io[6] = pBX; io[7] = pBY; this.bezier3(this.root, 9); }
    let tipX = (((a[A.ttX]) > 0.5 ? 0.5 + ((a[A.ttX]) - 0.5) * 0.86 : (a[A.ttX])) * k), tipY = (((a[A.ttY]) < 7.0 ? 7.0 - (7.0 - (a[A.ttY])) * phs : (a[A.ttY])) * k);
    {
      const dT = Math.sqrt((tipX - bX) * (tipX - bX) + (tipY - bY) * (tipY - bY));
      if (dT < rr * 1.05) {
        let ex = tipX - bX, ey = tipY - bY;
        let l = Math.sqrt(ex * ex + ey * ey);
        if (l === 0 || l !== l) l = 1.0;
        ex /= l;
        ey /= l;
        tipX = bX + ex * (rr * 1.05);
        tipY = bY + ey * (rr * 1.05);
      }
    }
    let thF: number;
    {
      const d = Math.sqrt((bX - tipX) * (bX - tipX) + (bY - tipY) * (bY - tipY));
      if (d <= rr * 1.0001) thF = Math.atan2(tipY - bY, tipX - bX);
      else thF = Math.atan2(tipY - bY, tipX - bX) + Math.acos(rr / d);
    }
    while (thF > thB) thF -= 2.0 * PI;
    while (thF < thB - 2.0 * PI) thF += 2.0 * PI;
    const arc = this.arcPts;
    for (let i = 0; i < ARC_POINTS; i++) {
      const ang = thB + ((thF - thB) * i) / (ARC_POINTS - 1);
      arc.xs[i] = bX + rr * Math.cos(ang);
      arc.ys[i] = bY + rr * Math.sin(ang);
    }
    arc.n = ARC_POINTS;
    const pFX = arc.xs[ARC_POINTS - 1], pFY = arc.ys[ARC_POINTS - 1];
    const tanFX = Math.sin(thF), tanFY = -Math.cos(thF);
    const bl = Math.sqrt((pFX - tipX) * (pFX - tipX) + (pFY - tipY) * (pFY - tipY));
    const curl = ((cc = (a[A.ttCurl])), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
    const ctrlX = pFX + tanFX * (bl * 0.5) + 0.0;
    const ctrlY = pFY + tanFY * (bl * 0.5) + (0.18 + 0.5 * curl) * k;
    { const io = this.io; io[0] = pFX; io[1] = pFY; io[2] = ctrlX; io[3] = ctrlY; io[4] = tipX; io[5] = tipY; this.bezier2(this.blade, 7); }
    const dorsum = a[A.dorsum];
    if (dorsum > 0.0) {
      const x0 = bX, x1 = tipX;
      const den = x1 - x0 > 1e-6 ? x1 - x0 : 1e-6;
      for (let i = 0; i < arc.n; i++) {
        const u = (arc.xs[i] - x0) / den;
        if (u <= 0.0 || u >= 1.0) continue;
        const w = Math.sin(PI * Math.pow(u, 0.8));
        arc.ys[i] = arc.ys[i] + -dorsum * 0.9 * k * w * w;
      }
      const bd = this.blade;
      for (let i = 1; i < bd.n - 1; i++) {
        const u = (bd.xs[i] - x0) / den;
        if (u <= 0.0 || u >= 1.0) continue;
        const w = Math.sin(PI * Math.pow(u, 0.8));
        bd.ys[i] = bd.ys[i] + -dorsum * 0.9 * k * w * w;
      }
    }
    { const jx = ((5.7) > 0.5 ? 0.5 + ((5.7) - 0.5) * 0.86 : (5.7)) * k; const jy = ((6.15) < 7.0 ? 7.0 - (7.0 - (6.15)) * phs : (6.15)) * k; const jdx = jx - this.condX; const jdy = jy - this.condY; r2[0] = this.condX + jdx * this.cosPhi - jdy * this.sinPhi; r2[1] = this.condY + jdx * this.sinPhi + jdy * this.cosPhi; }
    const frX = r2[0], frY = r2[1];
    { const io = this.io; io[0] = tipX; io[1] = tipY; io[2] = tipX + (-0.3 * k - curl * 0.4 * k); io[3] = tipY + -0.6 * k; io[4] = frX; io[5] = frY; this.bezier2(this.under, 6); }
    this.floorX[0] = frX;
    this.floorY[0] = frY;
    { const jx = ((6.2) > 0.5 ? 0.5 + ((6.2) - 0.5) * 0.86 : (6.2)) * k; const jy = ((6.25) < 7.0 ? 7.0 - (7.0 - (6.25)) * phs : (6.25)) * k; const jdx = jx - this.condX; const jdy = jy - this.condY; r2[0] = this.condX + jdx * this.cosPhi - jdy * this.sinPhi; r2[1] = this.condY + jdx * this.sinPhi + jdy * this.cosPhi; }
    this.floorX[1] = r2[0];
    this.floorY[1] = r2[1];
    { const jx = ((6.45) > 0.5 ? 0.5 + ((6.45) - 0.5) * 0.86 : (6.45)) * k; const jy = ((6.55) < 7.0 ? 7.0 - (7.0 - (6.55)) * phs : (6.55)) * k; const jdx = jx - this.condX; const jdy = jy - this.condY; r2[0] = this.condX + jdx * this.cosPhi - jdy * this.sinPhi; r2[1] = this.condY + jdx * this.sinPhi + jdy * this.cosPhi; }
    this.floorX[2] = r2[0];
    this.floorY[2] = r2[1];
    this.lowTeethX[0] = r2[0];
    this.lowTeethY[0] = r2[1];
    { const jx = ((6.72) > 0.5 ? 0.5 + ((6.72) - 0.5) * 0.86 : (6.72)) * k; const jy = ((7.15) < 7.0 ? 7.0 - (7.0 - (7.15)) * phs : (7.15)) * k; const jdx = jx - this.condX; const jdy = jy - this.condY; r2[0] = this.condX + jdx * this.cosPhi - jdy * this.sinPhi; r2[1] = this.condY + jdx * this.sinPhi + jdy * this.cosPhi; }
    this.lowTeethX[1] = r2[0];
    this.lowTeethY[1] = r2[1];
    { const jx = ((6.95) > 0.5 ? 0.5 + ((6.95) - 0.5) * 0.86 : (6.95)) * k; const jy = ((7.75) < 7.0 ? 7.0 - (7.0 - (7.75)) * phs : (7.75)) * k; const jdx = jx - this.condX; const jdy = jy - this.condY; r2[0] = this.condX + jdx * this.cosPhi - jdy * this.sinPhi; r2[1] = this.condY + jdx * this.sinPhi + jdy * this.cosPhi; }
    this.lowTeethX[2] = r2[0];
    this.lowTeethY[2] = r2[1];
    { const jx = ((7.12) > 0.5 ? 0.5 + ((7.12) - 0.5) * 0.86 : (7.12)) * k; const jy = ((7.45) < 7.0 ? 7.0 - (7.0 - (7.45)) * phs : (7.45)) * k; const jdx = jx - this.condX; const jdy = jy - this.condY; r2[0] = this.condX + jdx * this.cosPhi - jdy * this.sinPhi; r2[1] = this.condY + jdx * this.sinPhi + jdy * this.cosPhi; }
    this.lowTeethX[3] = r2[0];
    this.lowTeethY[3] = r2[1];
    {
      const lbx = r2[0], lby = r2[1];
      { const io = this.io; io[0] = lbx; io[1] = lby; io[2] = lbx + (0.25 * k + prot * 0.3); io[3] = lby + -0.05 * k; io[4] = llx + -0.3 * k; io[5] = lly + -0.12 * k; io[6] = llx; io[7] = lly; this.bezier3(this.lowerLipIn, 7); }
    }

    // ---- inner wall
    const inner = this.inner;
    inner.n = 0;
    inner.xs[0] = epiBX;
    inner.ys[0] = epiBY;
    inner.xs[1] = epiTX;
    inner.ys[1] = epiTY;
    inner.n = 2;
    const yRoot = epiTY + 0.05 * k;
    const back = this.back;
    const root = this.root;
    back.n = 0;
    for (let i = 0; i < root.n; i++) {
      back.xs[back.n] = root.xs[i];
      back.ys[back.n++] = root.ys[i];
    }
    for (let i = 1; i < arc.n; i++) {
      back.xs[back.n] = arc.xs[i];
      back.ys[back.n++] = arc.ys[i];
    }
    const rootLen = root.n;
    let start = -1;
    for (let i = 0; i < back.n; i++) {
      if (back.ys[i] > yRoot) {
        start = i;
        break;
      }
    }
    if (start < 0) start = back.n - 1;
    else if (start > 0) {
      const ax = back.xs[start - 1], ay = back.ys[start - 1], bx = back.xs[start], by = back.ys[start];
      const den = by - ay;
      const t = ((cc = ((yRoot - ay) / (den > 1e-9 ? den : 1e-9))), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
      inner.xs[inner.n] = ax + (bx - ax) * t;
      inner.ys[inner.n++] = ay + (by - ay) * t;
    }
    if (start < rootLen) {
      for (let i = start; i < rootLen; i++) {
        inner.xs[inner.n] = root.xs[i];
        inner.ys[inner.n++] = root.ys[i];
      }
      this.appendFrom(inner, arc, 1);
    } else {
      // arc_pts[start - rootLen + 1 ..] with its first point skipped
      this.appendFrom(inner, arc, start - rootLen + 2);
    }
    this.appendFrom(inner, this.blade, 1);
    this.appendFrom(inner, this.under, 1);
    for (let i = 1; i < 3; i++) {
      inner.xs[inner.n] = this.floorX[i];
      inner.ys[inner.n++] = this.floorY[i];
    }
    for (let i = 1; i < 4; i++) {
      inner.xs[inner.n] = this.lowTeethX[i];
      inner.ys[inner.n++] = this.lowTeethY[i];
    }
    this.appendFrom(inner, this.lowerLipIn, 0);

    // ---- grid
    const gN0 = 0;
    this.gN = gN0;
    const yEpiTop = glotY + 2.4 * k * this.phScale;
    const yPharTop = this.polarCY;
    const nPh = 12;
    let split = -1;
    for (let i = 0; i < nPh; i++) {
      const t = i / nPh;
      const y = yEpiTop + 0.12 * k + (yPharTop - (yEpiTop + 0.12 * k)) * t;
      const ry = this.ray;
      ry[0] = 4.6 * k;
      ry[1] = y;
      ry[2] = -1.0;
      ry[3] = 0.0;
      ry[5] = 9.0 * k;
      if (this.measure(false)) this.pushSample(1);
    }
    const nRad = 30;
    for (let i = 0; i <= nRad; i++) {
      const t = i / nRad;
      const ang = (180.0 + (36.0 - 180.0) * t) * DEG;
      const w = t < 0.45 ? 0.0 : (t - 0.45) / 0.55;
      const ww = w * w * (3.0 - 2.0 * w);
      const cx = this.polarCX + (this.polarC2X - this.polarCX) * ww;
      const cy = this.polarCY + (this.polarC2Y - this.polarCY) * ww;
      const ry = this.ray;
      ry[0] = cx;
      ry[1] = cy;
      ry[2] = Math.cos(ang);
      ry[3] = Math.sin(ang);
      ry[5] = 8.0 * k;
      if (!this.measure(true)) continue;
      if (split < 0 && ang <= 150.0 * DEG) split = this.gN;
      this.pushSample(split < 0 ? 1 : 2);
    }
    const xStart = incX + 0.03 * k;
    const xe0 = (ulx < llx ? ulx : llx) - 0.04 * k;
    const xEnd = xStart + 0.3 * k > xe0 ? xStart + 0.3 * k : xe0;
    const nFr = 6;
    const teethIdx = this.gN;
    const mm = this.m;
    for (let i = 0; i < nFr; i++) {
      const x = xStart + (xEnd - xStart) * (i / (nFr - 1.0));
      const ry = this.ray;
      ry[0] = x;
      ry[1] = 4.0 * k;
      ry[2] = 0.0;
      ry[3] = 1.0;
      ry[5] = 8.0 * k;
      if (!this.measure(false)) continue;
      if (x > llx) {
        const f0 = lly - ((x - llx) * 4.0) / 3.0;
        const face = f0 < mm[3] ? f0 : mm[3];
        const open = ((ss = ((lab) - (LAB_FRONT_OPENS)) / ((1.0) - (LAB_FRONT_OPENS))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss)) * ((ss = ((x - llx) - (0.0)) / ((LAB_FRONT_RAMP * k) - (0.0))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss));
        const yIn = face + (mm[3] - 3.5 * k - face) * open;
        mm[0] = x;
        mm[1] = yIn;
        mm[4] = mm[3] - yIn;
      }
      this.pushSample(3);
    }
    this.splitIndex = split;
    const lipW = (1.1 + (this.lipWB - 1.1) * spreadW) * k;
    const gn = this.gN;

    // ---- contact model
    const roof = this.roof;
    roof.n = 0;
    for (let i = roofStart; i <= roofEnd; i++) {
      roof.xs[roof.n] = outer.xs[i];
      roof.ys[roof.n++] = outer.ys[i];
    }
    const cum = this.cum;
    cum[0] = 0;
    for (let i = 1; i < roof.n; i++) {
      const dx = roof.xs[i] - roof.xs[i - 1], dy = roof.ys[i] - roof.ys[i - 1];
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    const tp = this.tipPts;
    tp.n = 0;
    for (let i = 2; i < this.blade.n; i++) {
      tp.xs[tp.n] = this.blade.xs[i];
      tp.ys[tp.n++] = this.blade.ys[i];
    }
    for (let i = 1; i < 3; i++) {
      tp.xs[tp.n] = this.under.xs[i];
      tp.ys[tp.n++] = this.under.ys[i];
    }
    this.closestApproach(tp);
    this.contactTip = r2[4];
    this.contactTipNX = r2[0];
    this.contactTipNY = r2[1];
    this.closestApproach(arc);
    this.contactBody = r2[4];
    this.contactBodyNX = r2[0];
    this.contactBodyNY = r2[1];
    {
      const outl = this.outline;
      outl.n = 0;
      this.appendFrom(outl, root, 0);
      this.appendFrom(outl, arc, 1);
      this.appendFrom(outl, this.blade, 1);
      this.appendFrom(outl, this.under, 1);
      for (let i = 1; i < 3; i++) {
        outl.xs[outl.n] = this.floorX[i];
        outl.ys[outl.n++] = this.floorY[i];
      }
      outl.xs[outl.n] = root.xs[0];
      outl.ys[outl.n++] = root.ys[0];
      const ct = this.contactTip < this.contactBody ? this.contactTip : this.contactBody;
      const press = 1.0 - ((ss = ((ct) - (-0.06 * k)) / ((0.0) - (-0.06 * k))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss));
      const half = 0.1 * k * (1.0 + press);
      const roofLen = cum[roof.n - 1];
      for (let g = 0; g < gn; g++) {
        if (this.gRegion[g] === 0) continue;
        const io = this.io;
        io[0] = this.gOutX[g];
        io[1] = this.gOutY[g];
        this.projectOn();
        const prS = r2[2], prDist = r2[3];
        const onRoof = 1.0 - ((ss = ((prDist) - (0.15 * k)) / ((0.25 * k) - (0.15 * k))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss));
        if (onRoof <= 0.0) continue;
        io[0] = this.gOutX[g];
        io[1] = this.gOutY[g];
        this.signedGap();
        let dc = r2[0];
        if (dc - half - prDist <= 0.6 * k) {
          for (let q = 0; q < 4; q++) {
            const fr = ROOF_STEPS[q];
            io[2] = ((cc = (prS + fr * half)), cc < (0.0) ? (0.0) : cc > (roofLen) ? (roofLen) : cc);
            this.pointAlong();
            this.signedGap();
            const gq = r2[0];
            // js_min: NaN if either is NaN
            if (gq < dc || gq !== gq) dc = gq;
          }
        }
        const w = (1.0 - ((ss = ((dc) - (0.15 * k)) / ((0.6 * k) - (0.15 * k))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss))) * onRoof;
        const cap = (1.0 - ((ss = ((dc) - (0.45 * k)) / ((0.6 * k) - (0.45 * k))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss))) * onRoof;
        if (w <= 0.0 && cap <= 0.0) continue;
        const dp = dc > 0.0 ? dc : 0.0;
        const gd = this.gD[g];
        const dm = gd + ((gd < dp ? gd : dp) - gd) * cap;
        this.gD[g] = dm + (dp - dm) * w;
      }
    }

    // ---- lip contact
    {
      const edgeX = ulx < llx ? ulx : llx;
      const rl = 0.6 * k;
      const labOpen = ((ss = ((lab) - (0.0)) / ((LAB_HANDOVER) - (0.0))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss));
      const apEff = labOpen >= 1.0 ? Infinity : ap + (LAB_GAP * k * labOpen) / (1.0 - labOpen);
      for (let g = 0; g < gn; g++) {
        if (this.gRegion[g] !== 3 || this.gMidX[g] < incX) continue;
        const e = edgeX - this.gMidX[g];
        const dxl = e > 0.0 ? e : 0.0;
        const c0 = apEff + (dxl * dxl) / (2.0 * rl);
        const c = c0 > 0.0 ? c0 : 0.0;
        if (c < this.gD[g]) this.gD[g] = c;
      }
    }

    // ---- areas
    for (let g = 0; g < gn; g++) {
      const d = this.gD[g];
      const reg = this.gRegion[g];
      if (reg === 1) this.gArea[g] = AREA_P * Math.pow(d, BETA);
      else if (reg === 2) {
        const ahead = ((ss = ((this.gMidX[g] - tipX) - (0.0)) / ((0.4 * k) - (0.0))), (ss = ss < 0 ? 0 : ss > 1 ? 1 : ss), ss * ss * (3.0 - 2.0 * ss));
        const o = AREA_O * Math.pow(d, BETA);
        this.gArea[g] = o + (AREA_H * Math.pow(d, BETA) - o) * ahead;
      } else {
        const u = ((cc = ((this.gMidX[g] - incX) / (0.45 * k))), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
        const dental = AREA_F * Math.pow(d, BETA);
        const lip = (PI / 4.0) * d * lipW;
        this.gArea[g] = dental + (lip - dental) * u;
      }
    }
    for (let g = 1; g < gn - 1; g++) {
      const a0 = this.gArea[g - 1], a1 = this.gArea[g + 1];
      const lim = 1.35 * (a0 > a1 ? a0 : a1);
      if (this.gArea[g] > lim) this.gArea[g] = lim;
    }
    const lat = a[A.lateral];
    if (lat > 0.0) {
      const floor = lat * 0.35 * k * k;
      for (let g = 0; g < gn; g++) {
        if (this.gRegion[g] < 2) continue;
        const dx = this.gMidX[g] - tipX, dy = this.gMidY[g] - tipY;
        if (Math.sqrt(dx * dx + dy * dy) < 1.4 * k && this.gArea[g] < floor) this.gArea[g] = floor;
      }
    }

    // ---- centreline
    const epiLen = 2.4 * k * this.phScale;
    let s = epiLen;
    for (let g = 0; g < gn; g++) {
      if (g > 0) {
        const dx = this.gMidX[g] - this.gMidX[g - 1], dy = this.gMidY[g] - this.gMidY[g - 1];
        s += Math.sqrt(dx * dx + dy * dy);
      }
      this.gS[g] = s;
    }
    const last = gn - 1;
    this.teethS = teethIdx < gn ? this.gS[teethIdx] : this.gS[last];
    this.lipS = this.gS[last];
    this.pharynxLength = split > 0 ? this.gS[split] : this.gS[nPh];
    this.length = this.lipS;
    this.lipArea = this.gArea[last];
    const vp = a[A.velum];
    this.velumPort = (vp > 0.0 ? vp : 0.0) * k * k;
    this.tipX = tipX;
    this.tipY = tipY;
    this.epiArt = a[A.epilarynx];
    this.ventArt = a[A.ventricular];
  }

  /**
   * Resample the last evaluate() into a pharynx tube (glottis to the velum) and an oral tube
   * (velum to the lips) of ph.length and or.length sections, harmonic means, with the smallest
   * area inside each section (human.rs:1287). Sets phLen, orLen.
   */
  resample(ph: Float64Array, or: Float64Array, phMin: Float64Array, orMin: Float64Array): void {
    this.resampleInto(ph, or, phMin, orMin, ph.length, or.length);
  }

  /** resample() into the first nPh and nOr elements of the arrays. */
  resampleInto(ph: Float64Array, or: Float64Array, phMin: Float64Array, orMin: Float64Array, nPh: number, nOr: number): void {
    const sp = this.pharynxLength;
    this.fs0 = 0.0;
    this.fs1 = sp;
    this.fill(ph, phMin, nPh);
    this.fs0 = sp;
    this.fs1 = this.lipS;
    this.fill(or, orMin, nOr);
    this.phLen = sp;
    this.orLen = this.lipS - sp;
  }

  private fill(out: Float64Array, mins: Float64Array, n: number): void {
    const s0 = this.fs0, s1 = this.fs1;
    let cc = 0.0;
    const k = this.k;
    const epiLen = 2.4 * k * this.phScale;
    const flare = 0.1 * epiLen;
    const gn = this.gN;
    const gS = this.gS, gA = this.gArea;
    const vent = 0.95 * (1.0 - 0.75 * ((cc = (this.ventArt)), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc));
    const top = 1.9 + (0.35 - 1.9) * ((cc = (this.epiArt)), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc);
    const kk = k * k;
    const d = (s1 - s0) / n;
    const sub = 8;
    let gi = 0;
    for (let i = 0; i < n; i++) {
      let inv = 0.0;
      let closed = false;
      let mn = Infinity;
      for (let jj = 0; jj < sub; jj++) {
        const s = s0 + d * (i + (jj + 0.5) / sub);
        // area_at(s), inline
        let area: number;
        if (s <= epiLen) {
          // epilarynx_area(s)
          const u = s / epiLen;
          let e = u < 0.3 ? 1.3 : u < 0.5 ? vent : 1.2 + (top - 1.2) * ((u - 0.5) / 0.5);
          for (let q = 0; q < 2; q++) {
            const u0 = q === 0 ? 0.3 : 0.5;
            if (Math.abs(u - u0) < 0.03) {
              const xa = u0 - 0.03, xb = u0 + 0.03;
              const fa = xa < 0.3 ? 1.3 : xa < 0.5 ? vent : 1.2 + (top - 1.2) * ((xa - 0.5) / 0.5);
              const fb = xb < 0.3 ? 1.3 : xb < 0.5 ? vent : 1.2 + (top - 1.2) * ((xb - 0.5) / 0.5);
              e = fa + (fb - fa) * ((u - (u0 - 0.03)) / (2.0 * 0.03));
            }
          }
          area = e * kk;
          if (s > epiLen - flare) area = area + (gA[0] - area) * ((s - (epiLen - flare)) / flare);
        } else if (s <= gS[0]) area = gA[0];
        else {
          let lo = 0;
          let hi = gn - 1;
          if (s >= gS[hi]) area = gA[hi];
          else {
            while (hi - lo > 1) {
              const m = (lo + hi) >> 1;
              if (gS[m] <= s) lo = m;
              else hi = m;
            }
            const dd = gS[hi] - gS[lo];
            const t = (s - gS[lo]) / (dd > 1e-9 ? dd : 1e-9);
            area = gA[lo] + (gA[hi] - gA[lo]) * t;
          }
        }
        if (area < mn) mn = area;
        if (area <= 1e-5) {
          closed = true;
          break;
        }
        inv += 1.0 / area;
      }
      const a0 = s0 + d * i;
      const a1 = s0 + d * (i + 1.0) + (i === n - 1 ? 1e-6 : 0.0);
      while (gi < gn && gS[gi] < a0) gi++;
      let q = gi;
      while (q < gn && gS[q] <= a1) {
        if (gA[q] < mn) mn = gA[q];
        if (gA[q] <= 1e-5) closed = true;
        q++;
      }
      out[i] = closed ? 0.0 : sub / inv;
      mins[i] = closed ? 0.0 : mn < out[i] ? mn : out[i];
    }
  }

  // ---------------------------------------------------------------- helpers

  private appendFrom(dst: Poly, src: Poly, from: number): void {
    for (let i = from < src.n ? from : src.n; i < src.n; i++) {
      dst.xs[dst.n] = src.xs[i];
      dst.ys[dst.n++] = src.ys[i];
    }
  }

  private bezier3(out: Poly, count: number): void {
    const io = this.io;
    const x0 = io[0], y0 = io[1], x1 = io[2], y1 = io[3], x2 = io[4], y2 = io[5], x3 = io[6], y3 = io[7];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1.0);
      const u = 1.0 - t;
      const a = u * u * u;
      const b = 3.0 * u * u * t;
      const c = 3.0 * u * t * t;
      const d = t * t * t;
      out.xs[i] = a * x0 + b * x1 + c * x2 + d * x3;
      out.ys[i] = a * y0 + b * y1 + c * y2 + d * y3;
    }
    out.n = count;
  }

  private bezier2(out: Poly, count: number): void {
    const io = this.io;
    const x0 = io[0], y0 = io[1], x1 = io[2], y1 = io[3], x2 = io[4], y2 = io[5];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1.0);
      const u = 1.0 - t;
      out.xs[i] = u * u * x0 + 2.0 * u * t * x1 + t * t * x2;
      out.ys[i] = u * u * y0 + 2.0 * u * t * y1 + t * t * y2;
    }
    out.n = count;
  }

  /** Crossings of the ray in this.ray with pl into out (t values); returns the count. */
  private rayPolyline(pl: Poly, out: Float64Array): number {
    const ry = this.ray;
    const ox = ry[0], oy = ry[1], dx = ry[2], dy = ry[3], tMin = ry[4], tMax = ry[5];
    let n = 0;
    const xs = pl.xs, ys = pl.ys;
    for (let i = 0; i + 1 < pl.n; i++) {
      const ax = xs[i], ay = ys[i], bx = xs[i + 1], by = ys[i + 1];
      const sa = dx * (ay - oy) - dy * (ax - ox) >= 0.0;
      const sb = dx * (by - oy) - dy * (bx - ox) >= 0.0;
      if (sa === sb) continue;
      const ex = bx - ax, ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) continue;
      const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
      if (t >= tMin && t <= tMax && n < out.length) out[n++] = t;
    }
    return n;
  }

  /** Like rayPolyline, also recording whether each crossing leaves the tissue (crossExit). */
  private rayCrossings(pl: Poly): number {
    const ry = this.ray;
    const ox = ry[0], oy = ry[1], dx = ry[2], dy = ry[3], tMin = ry[4], tMax = ry[5];
    let n = 0;
    const xs = pl.xs, ys = pl.ys;
    const ct = this.crossT, ce = this.crossExit;
    for (let i = 0; i + 1 < pl.n; i++) {
      const ax = xs[i], ay = ys[i], bx = xs[i + 1], by = ys[i + 1];
      const sa = dx * (ay - oy) - dy * (ax - ox) >= 0.0;
      const sb = dx * (by - oy) - dy * (bx - ox) >= 0.0;
      if (sa === sb) continue;
      const ex = bx - ax, ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) continue;
      const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
      if (t >= tMin && t <= tMax && n < ct.length) {
        ct[n] = t;
        ce[n] = dx * (ys[i + 1] - ys[i]) - dy * (xs[i + 1] - xs[i]) < 0.0 ? 1 : 0;
        n++;
      }
    }
    return n;
  }

  /** Measure a ray from (ox, oy) along (dx, dy): writes this.m; false if it meets no outer wall. */
  /** Measure the ray set in this.ray (origin, direction, [5] its length): writes this.m; false if it meets no outer wall. */
  private measure(fan: boolean): boolean {
    const k = this.k;
    const ry = this.ray;
    const tmp = this.tmp;
    const ox = ry[0], oy = ry[1], dx = ry[2], dy = ry[3];
    ry[4] = 0.0;
    const nOut = this.rayPolyline(this.outer, tmp);
    if (nOut === 0) return false;
    let tOut = Infinity;
    for (let i = 0; i < nOut; i++) if (tmp[i] < tOut) tOut = tmp[i];
    let tIn: number;
    if (fan) {
      // fan_inner
      ry[5] = tOut + 1.5 * k;
      const n = this.rayCrossings(this.inner);
      const ct = this.crossT, ce = this.crossExit;
      for (let i = 1; i < n; i++) {
        const t = ct[i], e = ce[i];
        let jj = i - 1;
        while (jj >= 0 && ct[jj] > t) {
          ct[jj + 1] = ct[jj];
          ce[jj + 1] = ce[jj];
          jj--;
        }
        ct[jj + 1] = t;
        ce[jj + 1] = e;
      }
      let i = 0;
      if (n > 0 && ce[0] === 1) {
        tIn = ct[0];
        i = 1;
      } else {
        const back = 2.5 * k;
        ry[2] = -dx;
        ry[3] = -dy;
        ry[5] = back;
        const nBack = this.rayPolyline(this.inner, tmp);
        let tb = back;
        for (let q = 0; q < nBack; q++) if (tmp[q] < tb) tb = tmp[q];
        tIn = -tb;
      }
      let tissue = 0.0;
      while (i < n && ct[i] < tOut) {
        if (ce[i] === 1) {
          i++;
          continue;
        }
        const bb = i + 1 < n ? ct[i + 1] : tOut + 1.5 * k;
        tissue += (bb < tOut ? bb : tOut) - ct[i];
        i += 2;
      }
      tIn = tIn + tissue;
    } else {
      ry[5] = tOut + 1.5 * k;
      const nIn = this.rayPolyline(this.inner, tmp);
      tIn = -Infinity;
      for (let i = 0; i < nIn; i++) if (tmp[i] > tIn && tmp[i] < tOut + 1.5 * k) tIn = tmp[i];
      if (tIn === -Infinity) {
        const z = tOut - 3.5 * k;
        tIn = z > 0.0 ? z : 0.0;
      }
    }
    const dd = tOut - tIn;
    const m = this.m;
    const tc = tIn < tOut ? tIn : tOut;
    m[0] = ox + dx * tc;
    m[1] = oy + dy * tc;
    m[2] = ox + dx * tOut;
    m[3] = oy + dy * tOut;
    m[4] = dd > 0.0 ? dd : 0.0;
    return true;
  }

  private pushSample(region: number): void {
    const g = this.gN++;
    const m = this.m;
    this.gInX[g] = m[0];
    this.gInY[g] = m[1];
    this.gOutX[g] = m[2];
    this.gOutY[g] = m[3];
    this.gMidX[g] = m[0] + (m[2] - m[0]) * 0.5;
    this.gMidY[g] = m[1] + (m[3] - m[1]) * 0.5;
    this.gD[g] = m[4];
    this.gArea[g] = 0;
    this.gS[g] = 0;
    this.gRegion[g] = region;
  }

  /** Project (px, py) on the roof: r[2] arc position, r[3] distance, r[4] signed, r[5] segment, r[6], r[7] the point. */
  private projectOn(): void {
    const pl = this.roof, cum = this.cum, r = this.r;
    const px = this.io[0], py = this.io[1];
    let best = Infinity, bs = 0.0, bx = 0.0, by = 0.0, sign = 1.0, bseg = 0;
    for (let i = 0; i + 1 < pl.n; i++) {
      const ax = pl.xs[i], ay = pl.ys[i];
      const ex = pl.xs[i + 1] - ax, ey = pl.ys[i + 1] - ay;
      const l2 = ex * ex + ey * ey;
      if (l2 < 1e-12) continue;
      let t = ((px - ax) * ex + (py - ay) * ey) / l2;
      t = t < 0.0 ? 0.0 : t > 1.0 ? 1.0 : t;
      const qx = ax + ex * t, qy = ay + ey * t;
      const d = Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
      if (d < best) {
        best = d;
        bs = cum[i] + t * Math.sqrt(l2);
        bx = qx;
        by = qy;
        const cross = ex * (py - ay) - ey * (px - ax);
        sign = cross < 0.0 ? 1.0 : -1.0;
        bseg = i;
      }
    }
    r[2] = bs;
    r[3] = best;
    r[4] = sign * best;
    r[5] = bseg;
    r[6] = bx;
    r[7] = by;
  }

  /** The roof point at arc length io[2] into io[0], io[1]. */
  private pointAlong(): void {
    const pl = this.roof, cum = this.cum;
    const s = this.io[2];
    let cc = 0.0;
    let i = 0;
    while (i + 2 < pl.n && cum[i + 1] < s) i++;
    const l = cum[i + 1] - cum[i];
    const u = l > 1e-9 ? ((cc = ((s - cum[i]) / l)), cc < (0.0) ? (0.0) : cc > (1.0) ? (1.0) : cc) : 0.0;
    this.io[0] = pl.xs[i] + (pl.xs[i + 1] - pl.xs[i]) * u;
    this.io[1] = pl.ys[i] + (pl.ys[i + 1] - pl.ys[i]) * u;
  }

  /** Signed distance from (px, py) to the tongue outline (negative inside) into r[0]. */
  private signedGap(): void {
    const pl = this.outline;
    const px = this.io[0], py = this.io[1];
    let best = Infinity;
    let inside = false;
    const xs = pl.xs, ys = pl.ys;
    for (let i = 0; i + 1 < pl.n; i++) {
      const ax = xs[i], ay = ys[i], bx = xs[i + 1], by = ys[i + 1];
      const ex = bx - ax, ey = by - ay;
      const l2 = ex * ex + ey * ey;
      let t = l2 > 1e-12 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0.0;
      t = t < 0.0 ? 0.0 : t > 1.0 ? 1.0 : t;
      const dx = px - ax - ex * t, dy = py - ay - ey * t;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
      if (ay > py !== by > py && px < ax + ((py - ay) * ex) / ey) inside = !inside;
    }
    const d = Math.sqrt(best);
    this.r[0] = inside ? -d : d;
  }

  /** Closest approach of pts to the roof: r[4] signed gap, r[0], r[1] the inward roof normal. */
  private closestApproach(pts: Poly): void {
    const r = this.r;
    let d = Infinity;
    let seg = 0;
    for (let i = 0; i < pts.n; i++) {
      this.io[0] = pts.xs[i];
      this.io[1] = pts.ys[i];
      this.projectOn();
      if (r[4] < d) {
        d = r[4];
        seg = r[5] | 0;
      }
    }
    const pl = this.roof;
    const ex = pl.xs[seg + 1] - pl.xs[seg], ey = pl.ys[seg + 1] - pl.ys[seg];
    let l = Math.sqrt(ex * ex + ey * ey);
    if (l === 0 || l !== l) l = 1.0;
    r[4] = d;
    r[0] = ey / l;
    r[1] = -ex / l;
  }
}
