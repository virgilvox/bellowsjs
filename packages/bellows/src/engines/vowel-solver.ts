/*
 * Articulator targets for a vowel given its formants: analysis by synthesis on the voice's own
 * geometry, the method VocalTractLab uses to fit vowel shapes (Birkholz, VTL manual). A posture goes
 * through ChimeraGeometry to an area function, the area function through a chain of cylindrical
 * sections (closed glottis, lips radiating through an end-correction inertance) to its resonances, and
 * a bounded Nelder-Mead search over the jaw, the tongue body's x and y, the tongue root and the lips'
 * aperture and protrusion finds the posture whose first three resonances are nearest the target on the
 * Bark scale.
 *
 * The tube has rigid walls, which put F1 low; the voice's walls yield. The correction is the classic
 * wall resonance in quadrature, F1 = sqrt(F1_rigid^2 + FW^2), with FW fitted to the engine's own General
 * American vowels (MEASURED: FW 220 Hz brings /i/ /u/ /ɛ/ /ɑ/ within a few percent; F2 agreed within 2
 * percent before any correction). Solved vowels rendered through the engine land within 1 to 8 percent
 * of their targets (MEASURED; test/engines-physical/vowel-solver.test.ts gates it).
 *
 * Offline and build-time code: it allocates freely and never runs on the audio thread.
 */

import { ChimeraGeometry, GEOMETRY_BODIES } from './vocal-geometry';
import { VOCAL_ARTICULATOR_MAX, VOCAL_ARTICULATOR_MIN, VOCAL_NEUTRAL } from './vocal-tables.gen';
import { ART } from './vocal-articulators';

/** Sections per tube in the resonance model. */
const SECTIONS = 24;
const SOUND_SPEED = 35000;
const AIR_DENSITY = 0.00114;
/** The yielding wall's resonance, Hz, added to the rigid tube's F1 in quadrature (MEASURED, see above). */
export const WALL_HZ = 220;
/** The articulators the search moves. */
const FREE = [ART.jaw, ART.tbX, ART.tbY, ART.root, ART.lipAp, ART.lipProt] as const;

/** Target formants, Hz; F3 optional. */
export interface VowelTarget {
  f1: number;
  f2: number;
  f3?: number;
}

/** A fitted posture and what the model predicts for it. */
export interface VowelFit {
  /** All 17 articulators. */
  posture: Float64Array;
  /** Predicted F1 (wall corrected), F2, F3, Hz. */
  formants: [number, number, number];
  /** Remaining cost, squared Bark. */
  cost: number;
}

/** Hz to Bark (Traunmuller-style arctangent form used across vowel normalization work). */
export function bark(f: number): number {
  return 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2);
}

/** One body's geometry, built once per solve. */
export function vowelGeometry(body: number): ChimeraGeometry {
  return new ChimeraGeometry(GEOMETRY_BODIES[Math.max(0, Math.min(GEOMETRY_BODIES.length - 1, body))]);
}

/** The area function (cm^2) and section lengths (cm) of a posture, glottis to lips. */
export function areaFunction(g: ChimeraGeometry, posture: ArrayLike<number>): { areas: number[]; lengths: number[] } {
  const ph = new Float64Array(SECTIONS);
  const or = new Float64Array(SECTIONS);
  const pm = new Float64Array(SECTIONS);
  const om = new Float64Array(SECTIONS);
  g.evaluate(posture);
  g.resampleInto(ph, or, pm, om, SECTIONS, SECTIONS);
  const areas: number[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < SECTIONS; i++) {
    areas.push(Math.max(ph[i], 0.05));
    lengths.push(g.phLen / SECTIONS);
  }
  for (let i = 0; i < SECTIONS; i++) {
    areas.push(Math.max(or[i], 0.05));
    lengths.push(g.orLen / SECTIONS);
  }
  return { areas, lengths };
}

/** Resonance peaks (Hz) of the rigid tube, glottis closed and lips radiating, up to maxHz. */
export function tubeResonances(areas: number[], lengths: number[], maxHz = 4500): number[] {
  const peaks: number[] = [];
  let prev = 0;
  let prev2 = 0;
  const step = 5;
  for (let f = 50; f <= maxHz; f += step) {
    const w = 2 * Math.PI * f;
    let ar = 1, ai = 0, br = 0, bi = 0, cr = 0, ci = 0, dr = 1, di = 0;
    for (let s = 0; s < areas.length; s++) {
      const k = w / SOUND_SPEED;
      const kl = k * lengths[s];
      const z = (AIR_DENSITY * SOUND_SPEED) / areas[s];
      const cs = Math.cos(kl);
      const sn = Math.sin(kl);
      // a small loss in each section keeps the peaks finite
      const loss = 0.003 * kl;
      const mar = cs, mai = -loss * sn, mbr = loss * z * cs, mbi = z * sn;
      const mcr = (loss * cs) / z, mci = sn / z, mdr = cs, mdi = -loss * sn;
      const nar = ar * mar - ai * mai + br * mcr - bi * mci;
      const nai = ar * mai + ai * mar + br * mci + bi * mcr;
      const nbr = ar * mbr - ai * mbi + br * mdr - bi * mdi;
      const nbi = ar * mbi + ai * mbr + br * mdi + bi * mdr;
      const ncr = cr * mar - ci * mai + dr * mcr - di * mci;
      const nci = cr * mai + ci * mar + dr * mci + di * mcr;
      const ndr = cr * mbr - ci * mbi + dr * mdr - di * mdi;
      const ndi = cr * mbi + ci * mbr + dr * mdi + di * mdr;
      ar = nar; ai = nai; br = nbr; bi = nbi; cr = ncr; ci = nci; dr = ndr; di = ndi;
    }
    // lips: pressure = Zr * flow, an end-corrected inertance plus a small radiation resistance
    const al = areas[areas.length - 1];
    const r = Math.sqrt(al / Math.PI);
    const zri = (w * AIR_DENSITY * 0.8 * r) / al;
    const zrr = ((AIR_DENSITY * SOUND_SPEED) / al) * 0.5 * ((w * r) / SOUND_SPEED) ** 2;
    const gr = cr * zrr - ci * zri + dr;
    const gi = cr * zri + ci * zrr + di;
    const h = 1 / Math.hypot(gr, gi);
    if (prev > prev2 && prev > h && f > 150) peaks.push(f - step);
    prev2 = prev;
    prev = h;
  }
  return peaks;
}

/** F1 (wall corrected), F2 and F3 a posture gives, Hz. */
export function predictFormants(g: ChimeraGeometry, posture: ArrayLike<number>): [number, number, number] {
  const { areas, lengths } = areaFunction(g, posture);
  const p = tubeResonances(areas, lengths);
  return [Math.sqrt((p[0] ?? NaN) ** 2 + WALL_HZ * WALL_HZ), p[1] ?? NaN, p[2] ?? NaN];
}

/**
 * The posture nearest `start` (a full 17-articulator row) whose formants match `target`. Only the jaw,
 * tongue body, root and lips move; everything else keeps start's values.
 */
export function solveVowel(g: ChimeraGeometry, target: VowelTarget, start: ArrayLike<number> = VOCAL_NEUTRAL): VowelFit {
  const base = Float64Array.from(start);
  const lo = FREE.map((k) => VOCAL_ARTICULATOR_MIN[k]);
  const hi = FREE.map((k) => VOCAL_ARTICULATOR_MAX[k]);
  const posture = (x: number[]): Float64Array => {
    const a = Float64Array.from(base);
    FREE.forEach((k, i) => (a[k] = Math.min(hi[i], Math.max(lo[i], x[i]))));
    return a;
  };
  const cost = (x: number[]): number => {
    let c = 0;
    FREE.forEach((k, i) => {
      const v = Math.min(hi[i], Math.max(lo[i], x[i]));
      c += (x[i] - v) ** 2 * 100;
      // a light pull toward the start, so of the postures that fit, the nearest wins
      c += 0.002 * ((x[i] - base[k]) / (hi[i] - lo[i])) ** 2;
    });
    const f = predictFormants(g, posture(x));
    if (!(f[0] > 0 && f[1] > 0)) return 1e9;
    c += (bark(f[0]) - bark(target.f1)) ** 2 + (bark(f[1]) - bark(target.f2)) ** 2;
    if (target.f3 !== undefined && f[2] > 0) c += 0.5 * (bark(f[2]) - bark(target.f3)) ** 2;
    return c;
  };
  const x = nelderMead(cost, FREE.map((k) => base[k]), FREE.map((_, i) => 0.12 * (hi[i] - lo[i])), 600);
  const best = posture(x.point);
  return { posture: best, formants: predictFormants(g, best), cost: x.value };
}

/** Minimize f from x0 with initial steps; plain Nelder-Mead (reflect 1, expand 2, contract and shrink 0.5). */
function nelderMead(f: (x: number[]) => number, x0: number[], steps: number[], iterations: number): { point: number[]; value: number } {
  const n = x0.length;
  let pts: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += steps[i];
    pts.push(p);
  }
  let vals = pts.map(f);
  for (let it = 0; it < iterations; it++) {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    const c = pts[0].map((_, j) => pts.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const worst = pts[n];
    const r = c.map((v, j) => v + (v - worst[j]));
    const fr = f(r);
    if (fr < vals[0]) {
      const e = c.map((v, j) => v + 2 * (v - worst[j]));
      const fe = f(e);
      if (fe < fr) [pts[n], vals[n]] = [e, fe];
      else [pts[n], vals[n]] = [r, fr];
    } else if (fr < vals[n - 1]) {
      [pts[n], vals[n]] = [r, fr];
    } else {
      const k = c.map((v, j) => v + 0.5 * (worst[j] - v));
      const fk = f(k);
      if (fk < vals[n]) [pts[n], vals[n]] = [k, fk];
      else
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]));
          vals[i] = f(pts[i]);
        }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (vals[i] < vals[best]) best = i;
  return { point: pts[best], value: vals[best] };
}
