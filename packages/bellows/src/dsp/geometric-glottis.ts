/*
 * The geometric glottis: vocal folds whose two edges move as the
 * kinematic model of Titze (1984, "Parameterization of the glottal area,
 * glottal flow, and vocal fold contact area", JASA 75) does, extended by
 * Birkholz, Drechsel and Stone (2019, "Perceptual optimization of an
 * enhanced geometric vocal fold model for articulatory speech synthesis",
 * Interspeech, 3765-3769), and written here from those papers. It makes a
 * glottal AREA; the airway (dsp/junction-airway.ts) solves the flow
 * through it from the pressures on either side, so the source and the
 * tract interact as they do in life.
 *
 * THE FOLDS. Each fold has a lower (i = 1) and an upper (i = 2) edge. Along
 * the fold, y from the vocal processes (0) to the anterior commissure (L),
 * the edge's distance from the midline is
 *
 *   x_i(y, t) = x_rest,i (1 - y / L) + x_max sin(pi y / L) sin(phi_i(t))
 *
 * a rest (prephonatory) displacement that opens a triangle toward the back,
 * plus a string-like vibration fixed at both ends. The upper edge lags the
 * lower by a phase (the mucosal wave travelling up the fold): phi_2 =
 * phi_1 - lag. The paper's naturalness test put the best male voice at a
 * lag of 70 degrees, rest 0.3 mm lower and 0.6 mm upper (a slightly
 * divergent glottis), no skew and 0.05 double pulsing; the best female at
 * 50 degrees, 0.6 and 0.6 mm, skew 0.2, 0.05. Each edge's area is twice the
 * integral of its positive part along y, plus a posterior chink, and the
 * area the air sees is the smaller of the two:
 *
 *   A_i = 2 integral_0^L max(x_i, 0) dy + A_chink,   A = min(A_1, A_2)
 *
 * The integral is closed form. With u = y / L, a = x_rest, b = x_max sin
 * phi, f(u) = a (1 - u) + b sin(pi u) and F(u) = a (u - u^2 / 2) - (b / pi)
 * cos(pi u). f(1) = 0 always, so the other root solves sin(pi v) / v = -a /
 * b with v = 1 - u, and sin(pi v) / v falls monotonically from pi to 0 on
 * (0, 1]: one root or none. It is read from a table (q = sqrt(1 - r / pi)
 * makes it smooth at both ends); the integral is stationary in the root,
 * f being zero there, so the table's error enters only at second order.
 *
 * AMPLITUDE. x_max = c x_rel sqrt(P_trans) L0 / L, after Titze (1989, "On
 * the relation between subglottal pressure and fundamental frequency in
 * phonation", JASA 85), with c set so that x_max = 1 mm at 800 Pa: the
 * folds swing wider the harder the air pushes, from the pressure the
 * airway actually has across them. The caller passes x_max. Since the
 * rest displacements here come from areas (x_rest = A_rest / L) and x_max
 * L / L0 does not depend on L, the area does not depend on the length, and
 * the paper's length rule drops out: only L0 (the body's fold length)
 * scales the area.
 *
 * SKEW. The phase is warped piecewise linearly so the opening and the
 * closing take different times (the paper's skewness s in [-1, 1]): the
 * displacement peak moves from a quarter of the cycle to (1 + s) / 4, the
 * closing quarter ends at the half cycle as before. s > 0 skews the pulse
 * to the right, as real flow pulses are.
 *
 * DOUBLE PULSING. On every second cycle the dynamic part becomes x_max
 * [(1 - d / 2)(sin phi + 1) - 1]: the opening peak drops by d, the
 * closing extreme stays (the paper's form).
 *
 * THE CYCLE. Pitch, drift, jitter, shimmer, diplophonia and chaos come from
 * a GlottalSource stepped with nextPhase(): its phase is phi_1 / 2 pi, its
 * cycle amplitude scales x_max, and its parity is the double pulse's. An
 * edge that lags into the previous cycle keeps that cycle's amplitude and
 * parity, so a new cycle's draw never steps the upper edge. Fry's second
 * pulse is the parametric source's and has no counterpart here.
 *
 * NO ALLOCATION. Inputs are fields; process() writes areas into a buffer.
 */

import type { GlottalSource } from './glottal';

const PI = Math.PI;
const INV_PI = 1 / PI;
const TWO_OVER_PI = 2 / PI;
const TWO_PI = 2 * PI;

/** x_max per sqrt(dyn/cm^2): 0.1 cm at 800 Pa (8000 dyn/cm^2), the paper's calibration. */
export const GEO_AMPLITUDE = 0.1 / Math.sqrt(8000);

/* The root table: v(q) and cos(pi v(q)) on q in [0, 1], q = sqrt(1 - r / pi), r = sin(pi v) / v. */
const ROOT_N = 256;
const ROOT_V = new Float64Array(ROOT_N + 2);
const ROOT_C = new Float64Array(ROOT_N + 2);
(function buildRoots(): void {
  for (let k = 0; k <= ROOT_N + 1; k++) {
    const q = Math.min(1, k / ROOT_N);
    const r = PI * (1 - q * q);
    // sin(pi v) / v decreases on (0, 1]: bisect for the v that gives r
    let lo = 1e-12;
    let hi = 1;
    for (let it = 0; it < 80; it++) {
      const mid = 0.5 * (lo + hi);
      if (Math.sin(PI * mid) / mid > r) lo = mid;
      else hi = mid;
    }
    const v = 0.5 * (lo + hi);
    ROOT_V[k] = v;
    ROOT_C[k] = Math.cos(PI * v);
  }
})();

/**
 * The edge integral's arguments and result: EDGE[0] = a, EDGE[1] = b in,
 * EDGE[2] out. A typed array, so no double crosses the call: V8 boxes one
 * that crosses a call it does not inline (MEASURED: 48 bytes a sample when
 * edgeOpen() and the warp were called from the loop).
 */
const EDGE = new Float64Array(3);

/** EDGE[2] = the integral over u in [0, 1] of max(a (1 - u) + b sin(pi u), 0), one edge's open area per 2 L. */
function edgeInto(): void {
  const a = EDGE[0];
  const b = EDGE[1];
  if ((b >= 0 && a >= 0) || (b < 0 && a >= -PI * b)) {
    // open along the whole length
    EDGE[2] = 0.5 * a + TWO_OVER_PI * b;
    return;
  }
  if (!((b > 0 && -a < PI * b) || (b < 0 && a > 0))) {
    // shut along the whole length
    EDGE[2] = 0;
    return;
  }
  // one root inside (0, 1): r = -a / b in (0, pi), v solves sin(pi v) / v = r, u0 = 1 - v
  const r = -a / b;
  let q = 1 - r * INV_PI;
  q = q > 0 ? Math.sqrt(q) : 0;
  const x = q * ROOT_N;
  const k = x | 0;
  const f = x - k;
  const v = ROOT_V[k] + (ROOT_V[k + 1] - ROOT_V[k]) * f;
  const cv = ROOT_C[k] + (ROOT_C[k + 1] - ROOT_C[k]) * f;
  const u0 = 1 - v;
  // F(u0) with cos(pi u0) = -cos(pi v)
  const F0 = a * (u0 - 0.5 * u0 * u0) + b * INV_PI * cv;
  // b > 0: open on (u0, 1], F(1) - F(u0); b < 0: open on [0, u0), F(u0) - F(0)
  EDGE[2] = b > 0 ? 0.5 * a + b * INV_PI - F0 : F0 + b * INV_PI;
}

/** The integral's value for one edge, (a, b) as above: the testable form, off the audio path. */
export function edgeOpen(a: number, b: number): number {
  EDGE[0] = a;
  EDGE[1] = b;
  edgeInto();
  return EDGE[2];
}

/*
 * WARP. The phase ph in [0, 1) is warped piecewise linearly so the
 * displacement peak sits at `peak` of the cycle and the half cycle stays
 * where it was: the opening quarter and the closing quarter trade time, the
 * closed half is unchanged. Where the edge crosses the midline its speed
 * drops back to the unwarped one, so a right-skewed pulse lands softly (the
 * posterior part, still open at that moment, then closes at the slower
 * speed). MEASURED: against the warp with one breakpoint (the whole cycle
 * after the peak at one speed), this one put the male vowels 3 to 4 dB
 * nearer CHIMERA's at 1.5 to 4 kHz (docs/VOICE-2.md, "Vocal folds").
 */
export class GeometricGlottis {
  /* ---- Inputs: targets for the end of the next process() call. ---- */
  /** Rest displacement of the lower and upper edges at the vocal processes, cm. */
  xRest1 = 0.03;
  xRest2 = 0.06;
  /** Posterior chink, cm^2. */
  chink = 0.01;
  /** Vibration amplitude x_max, cm (GEO_AMPLITUDE x_rel sqrt(P_trans), times the voicing level). */
  xMax = 0;
  /** Fold length at rest L0, cm. */
  length = 1.6;
  /** Upper edge's phase lag, in cycles (70 degrees: 70 / 360). */
  lag = 70 / 360;
  /** Skewness s in [-1, 1]. */
  skew = 0;
  /** Double pulsing d in [0, 1]. */
  doublePulse = 0.05;

  /* ---- Outputs. ---- */
  /** The lower and upper edges' areas of the last sample, cm^2. */
  area1 = 0;
  area2 = 0;

  /* ---- Values in force at the start of the next call (ramped from). ---- */
  private r1 = 0.03;
  private r2 = 0.06;
  private ch = 0.01;
  private xm = 0;
  private first = true;

  /** The next process() starts from its targets rather than ramping to them. */
  reset(): void {
    this.first = true;
    this.area1 = this.area2 = 0;
  }

  /**
   * Steps src (nextPhase) once per sample over [from, to) and writes the
   * glottal area, cm^2, into out. The inputs ramp linearly from their values
   * at the last call to the current fields across the span.
   */
  process(src: GlottalSource, out: Float64Array, from: number, to: number): void {
    if (this.first) {
      this.r1 = this.xRest1;
      this.r2 = this.xRest2;
      this.ch = this.chink;
      this.xm = this.xMax;
      this.first = false;
    }
    const n = to - from;
    if (n <= 0) return;
    const inv = 1 / n;
    const r1a = this.r1;
    const r2a = this.r2;
    const cha = this.ch;
    const xma = this.xm;
    const dr1 = this.xRest1 - r1a;
    const dr2 = this.xRest2 - r2a;
    const dch = this.chink - cha;
    const dxm = this.xMax - xma;
    const twoL = 2 * this.length;
    let s = this.skew;
    s = s < -0.9 ? -0.9 : s > 0.9 ? 0.9 : s;
    const peak = 0.25 * (1 + s);
    const rise = 0.25 / peak;
    const fall = 0.25 / (0.5 - peak);
    let lag = this.lag;
    lag = lag < 0 ? 0 : lag > 0.5 ? 0.5 : lag;
    let d = this.doublePulse;
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    const dh = 1 - 0.5 * d;
    let a1 = 0;
    let a2 = 0;
    for (let i = from; i < to; i++) {
      src.nextPhase();
      const w = (i - from + 1) * inv;
      const xm = xma + dxm * w;
      const ph = src.phase;
      // the warp (see WARP), written out for both edges: no double crosses a call
      let phi = ph < peak ? ph * rise : ph < 0.5 ? 0.25 + (ph - peak) * fall : ph;
      let s1 = Math.sin(TWO_PI * phi);
      if (src.odd) s1 = dh * (s1 + 1) - 1;
      let ph2 = ph - lag;
      let odd2 = src.odd;
      let amp2 = src.amp;
      if (ph2 < 0) {
        ph2 += 1;
        odd2 = !odd2;
        amp2 = src.ampPrev;
      }
      phi = ph2 < peak ? ph2 * rise : ph2 < 0.5 ? 0.25 + (ph2 - peak) * fall : ph2;
      let s2 = Math.sin(TWO_PI * phi);
      if (odd2) s2 = dh * (s2 + 1) - 1;
      const ch = cha + dch * w;
      EDGE[0] = r1a + dr1 * w;
      EDGE[1] = xm * src.amp * s1;
      edgeInto();
      a1 = twoL * EDGE[2] + ch;
      EDGE[0] = r2a + dr2 * w;
      EDGE[1] = xm * amp2 * s2;
      edgeInto();
      a2 = twoL * EDGE[2] + ch;
      out[i] = a1 < a2 ? a1 : a2;
    }
    this.area1 = a1;
    this.area2 = a2;
    this.r1 = this.xRest1;
    this.r2 = this.xRest2;
    this.ch = this.chink;
    this.xm = this.xMax;
  }
}
