/*
 * Self-oscillating vocal folds: the two-mass model of Ishizaka and
 * Flanagan (1972, "Synthesis of voiced sounds from a two-mass model of the
 * vocal cords", Bell Syst. Tech. J. 51) with the pressure model of
 * Steinecke and Herzel (1995, "Bifurcations in an asymmetric vocal-fold
 * model", JASA 97), on a triangular glottis after Birkholz, Kroger and
 * Neuschaefer-Rube (2011, "Synthesis of breathy, normal, and pressed
 * phonation using a two-mass model with a triangular glottis",
 * Interspeech): written from those papers. Nothing here draws a pulse: the
 * folds open because the air pushes them, close because their springs and
 * the Bernoulli suction pull them back, and the period is whatever the
 * masses, springs and pressures make it.
 *
 * MASSES. A lower mass m1 (depth d1) and an upper mass m2 (depth d2) per
 * fold, each on a spring k_i to the body and coupled to each other by k_c,
 * with damping ratios zeta_i. Ishizaka and Flanagan's values: m1 0.125 g,
 * m2 0.025 g, k1 80 000 and k2 8000 dyn/cm, k_c 25 000 dyn/cm, zeta 0.1 and
 * 0.6, d1 0.25 and d2 0.05 cm, length 1.4 cm.
 *
 * THE TRIANGULAR GLOTTIS. At rest the folds are apart by r_i at the vocal
 * processes and meet at the anterior commissure, so mass i's edge is at
 * w_i(u) = r_i (1 - u) + x_i along the fold (u from the back, 0, to the
 * front, 1), x_i its displacement. Its open area is 2 L times the integral
 * of max(w_i, 0), its contact depth the integral of max(-w_i, 0), both
 * closed form for a line. Abduction (a breathy or voiceless glottis) is a
 * larger r_i; the folds then close only in front, or not at all, and the
 * model's own threshold rises with it, as Titze (1988) derives.
 *
 * PRESSURES (Steinecke and Herzel). With the flow separating at the
 * narrowest point, a convergent glottis (A1 > A2) has P1 = Ps - (Ps - Pe)
 * (A2 / A1)^2 on the lower mass and Pe on the upper; a divergent one has Pe
 * on both. While a mass is shut, the air below it presses with Ps. Each
 * force is P_i L d_i. Ps and Pe are the airway's pressures below and above
 * the glottis at the previous sample, and the airway solves the flow
 * through min(A1, A2) plus the chink: the folds and the air are one system.
 *
 * COLLISION. A mass in contact meets a spring h_i = 3 k_i on its mean
 * contact depth (Ishizaka and Flanagan's rule) and an extra damping ratio of
 * 1, weighted by the fraction of its length in contact.
 *
 * TENSION. Ishizaka and Flanagan scale the masses by 1 / Q and the
 * stiffnesses by Q, which moves every frequency by Q and shrinks the swing
 * by 1 / Q. Here the masses go by Q^-1.5 and the springs by Q^0.5: the
 * frequency still moves by exactly Q, and the swing by Q^-0.5, so a high
 * note keeps more of its amplitude (the folds also lengthen and thin as
 * they stretch). Q is the feedforward f / F_REF times the servo's
 * correction (dsp/pitch-servo.ts) times the caller's perturbation.
 *
 * INTEGRATION. Semi-implicit Euler at the audio rate, the damping implicit.
 * The stiffest motion, the upper mass in collision, has omega dt 0.55 at
 * Q 8 and 22050 Hz (0.82 at the largest Q, 12), inside the method's
 * stability limit of 2, so nothing oversamples (test/dsp-osc/
 * fold-oscillator.test.ts runs it at 22050 to 96000 Hz).
 *
 * Inputs are fields; step() takes and returns nothing and allocates nothing.
 */

import { PitchServo } from './pitch-servo';

/* Ishizaka and Flanagan (1972) values. */
const M1 = 0.125;
const M2 = 0.025;
const K1 = 80000;
const K2 = 8000;
const KC = 25000;
const ZETA1 = 0.1;
const ZETA2 = 0.6;
const D1 = 0.25;
const D2 = 0.05;
/** Collision stiffness over the spring's, and the extra damping ratio in contact. */
const HIT = 3;
const HIT_ZETA = 1;
/**
 * The model's frequency at Q = 1, Hz. MEASURED in the vocal engine, a held
 * male /ɑ/ at 48 kHz: with 165 here the servo settled at corrections of
 * 1.03 to 1.06 from 110 to 220 Hz. The servo takes up the rest
 * (test/dsp-osc/fold-oscillator.test.ts holds it within a fifth).
 */
export const FOLD_F_REF = 158;
const MIN_Q = 0.25;
/** The glottal area's swing over its mean that makes a cycle voiced. */
const DEPTH = 0.2;
/** The swing over its mean that a cycle needs before the servo tunes on it. */
const TUNE_DEPTH = 0.03;
/** A gap in full cycles longer than this many target periods ends voicing (the airway reads voicing so too). */
export const VOICED_GAP = 1.6;
/** How long after the first full cycle that follows a gap the servo may speed up for a large error, s. */
const ONSET_S = 0.05;
const MAX_Q = 12;

export class FoldOscillator {
  /* ---- Inputs. ---- */
  /** Pressures below and above the glottis, dyn/cm^2 (written by the airway each sample). */
  ps = 0;
  pe = 0;
  /** Rest displacements of the lower and upper masses at the vocal processes, cm. */
  rest1 = 0.01;
  rest2 = 0.01;
  /** Posterior chink, cm^2. */
  chink = 0.01;
  /** Fold length, cm. */
  length = 1.4;
  /**
   * Where rest1, rest2, chink and length ramp to, and over how many more steps (0: no ramp). A caller
   * that updates once a block sets the block's end here and the ramp goes on from where the last
   * ended: a rest that stepped once a block moved the glottis in steps at the block rate, and a fast
   * adduction rang the tract (MEASURED: a 1.5 kHz tone 20 to 35 dB over the pulse's while the folds
   * closed after a voiceless stop). The chink and the length enter the area directly, so they ramp too.
   */
  rest1To = 0.01;
  rest2To = 0.01;
  chinkTo = 0.01;
  lengthTo = 1.4;
  rampLeft = 0;
  /** A multiplier on the tension (drift, jitter), applied after the servo. */
  perturb = 1;
  /** 0..1: how far the folds are free to move (1 - a glottal stop's closure); 0 holds them shut. */
  free = 1;
  readonly servo = new PitchServo();

  /* ---- Outputs. ---- */
  /** The glottal area of the last step, cm^2 (min of the two masses' plus the chink). */
  area = 0;
  area1 = 0;
  area2 = 0;
  x1 = 0;
  x2 = 0;
  v1 = 0;
  v2 = 0;
  /** Cycles counted since reset (white box). */
  cycles = 0;

  private readonly dt: number = 0;
  private readonly rate: number = 0;
  /* Per-block coefficients. */
  private m1 = M1;
  private m2 = M2;
  private k1 = K1;
  private k2 = K2;
  private kc = KC;
  private b1 = 0;
  private b2 = 0;
  private bh1 = 0;
  private bh2 = 0;
  private q = 1;
  /** 1 when tune() has asked for new coefficients, which the next step() computes. */
  private stale = 1;
  /* Cycle detection: samples since reset, the last v1, the last turning point's time (-1: none). */
  private n = 0;
  private lastV1 = 0;
  private lastT = -1;
  private lastVoiced = -1;
  /** The sample index until which the cycles are an onset's (the servo's fast rate). */
  private onsetEnd = -1;
  /**
   * Samples since the last voiced cycle's turning point (a large number before the first): whether the
   * folds are vibrating now. A cycle is voiced when the glottal area swings by DEPTH of its mean or more:
   * abducted folds still shiver by micrometres, and counting those turns as cycles kept the voicing on
   * through voiceless sounds (MEASURED: voicing 0.5 after 60 ms of a 0.3 cm^2 opening).
   */
  sinceTurn = 1e9;
  /* The area's range since the last turning point. */
  private aLo = 1e9;
  private aHi = 0;

  constructor(rate: number) {
    this.rate = rate;
    this.dt = 1 / rate;
  }

  reset(): void {
    this.x1 = this.x2 = this.v1 = this.v2 = 0;
    this.area = this.area1 = this.area2 = 0;
    this.n = 0;
    this.lastV1 = 0;
    this.lastT = -1;
    this.lastVoiced = -1;
    this.onsetEnd = -1;
    this.sinceTurn = 1e9;
    this.aLo = 1e9;
    this.aHi = 0;
    this.cycles = 0;
    this.rampLeft = 0;
    this.servo.reset();
    this.tune();
  }

  /**
   * The tension for the servo's target and correction and the perturbation: once a block. It only marks
   * the coefficients stale and the next step() computes them, inside the per-sample code V8 optimizes. A
   * method called once a block or once a cycle can stay unoptimized, and then every double it computes is
   * a heap number: with that, the event call that took two doubles and the clamps below written as
   * conditionals, a held vowel on these folds grew new space by 1.2 to 1.5 bytes a sample, against 0.03
   * for the other fold models (MEASURED; test/engines-physical/vocal.test.ts, "allocation").
   */
  tune(): void {
    this.stale = 1;
  }

  /** The tension Q the coefficients are (or, after tune(), will be) computed for (white box, not the audio path). */
  get tension(): number {
    if (!this.stale) return this.q;
    const q = (this.servo.target / FOLD_F_REF) * this.servo.correction * this.perturb;
    return q < MIN_Q ? MIN_Q : q > MAX_Q ? MAX_Q : q === q ? q : 1;
  }

  /** One sample: forces from the last pressures, the masses moved, the areas and a cycle check. */
  step(): void {
    if (this.rampLeft > 0) {
      const k = 1 / this.rampLeft;
      this.rest1 += (this.rest1To - this.rest1) * k;
      this.rest2 += (this.rest2To - this.rest2) * k;
      this.chink += (this.chinkTo - this.chink) * k;
      this.length += (this.lengthTo - this.length) * k;
      this.rampLeft--;
    }
    if (this.stale) {
      // the coefficients for the tension: masses as Q^-1.5, springs as Q^0.5, so f0 scales as Q
      this.stale = 0;
      // clamped with Math.min and Math.max: a conditional that merges a double with a module-level
      // constant made V8 box the result (MEASURED: one heap number each time this ran)
      const raw = (this.servo.target / FOLD_F_REF) * this.servo.correction * this.perturb;
      const q = Math.min(Math.max(raw === raw ? raw : 1, MIN_Q), MAX_Q);
      this.q = q;
      const qk = Math.sqrt(q);
      const qm = 1 / (q * qk);
      this.m1 = M1 * qm;
      this.m2 = M2 * qm;
      this.k1 = K1 * qk;
      this.k2 = K2 * qk;
      this.kc = KC * qk;
      this.b1 = 2 * ZETA1 * Math.sqrt(this.m1 * this.k1);
      this.b2 = 2 * ZETA2 * Math.sqrt(this.m2 * this.k2);
      this.bh1 = 2 * HIT_ZETA * Math.sqrt(this.m1 * this.k1);
      this.bh2 = 2 * HIT_ZETA * Math.sqrt(this.m2 * this.k2);
    }
    const L = this.length;
    const twoL = 2 * L;
    const r1 = this.rest1 > 0 ? this.rest1 : 0;
    const r2 = this.rest2 > 0 ? this.rest2 : 0;
    const x1 = this.x1;
    const x2 = this.x2;
    // open integrals and contact of the two lines w = r (1 - u) + x
    let o1 = 0;
    let c1 = 0;
    let f1 = 0;
    if (x1 >= 0) o1 = 0.5 * r1 + x1;
    else if (r1 + x1 > 0) {
      o1 = ((r1 + x1) * (r1 + x1)) / (2 * r1);
      c1 = (x1 * x1) / (2 * r1);
      f1 = -x1 / r1;
    } else {
      c1 = -(0.5 * r1 + x1);
      f1 = 1;
    }
    let o2 = 0;
    let c2 = 0;
    let f2 = 0;
    if (x2 >= 0) o2 = 0.5 * r2 + x2;
    else if (r2 + x2 > 0) {
      o2 = ((r2 + x2) * (r2 + x2)) / (2 * r2);
      c2 = (x2 * x2) / (2 * r2);
      f2 = -x2 / r2;
    } else {
      c2 = -(0.5 * r2 + x2);
      f2 = 1;
    }
    const a1 = twoL * o1;
    const a2 = twoL * o2;
    // Steinecke and Herzel's pressures
    const ps = this.ps;
    const pe = this.pe;
    let p1 = ps;
    let p2 = pe;
    if (a1 > 0 && a2 > 0) {
      if (a1 >= a2) {
        const r = a2 / a1;
        p1 = ps - (ps - pe) * r * r;
      } else p1 = pe;
    } else if (a1 > 0) p2 = ps;
    const free = this.free < 0 ? 0 : this.free > 1 ? 1 : this.free;
    const k1 = this.k1;
    const k2 = this.k2;
    const kc = this.kc;
    const m1 = this.m1;
    const m2 = this.m2;
    const dt = this.dt;
    // forces: pressure (times how free the folds are), springs, coupling, collision
    const F1 = free * p1 * L * D1 - k1 * x1 - kc * (x1 - x2) + HIT * k1 * c1;
    const F2 = free * p2 * L * D2 - k2 * x2 - kc * (x2 - x1) + HIT * k2 * c2;
    const bb1 = this.b1 + this.bh1 * f1;
    const bb2 = this.b2 + this.bh2 * f2;
    const v1 = (this.v1 + (dt * F1) / m1) / (1 + (dt * bb1) / m1);
    const v2 = (this.v2 + (dt * F2) / m2) / (1 + (dt * bb2) / m2);
    this.v1 = v1;
    this.v2 = v2;
    this.x1 = x1 + dt * v1;
    this.x2 = x2 + dt * v2;
    const ch = this.chink > 0 ? this.chink : 0;
    this.area1 = a1 + ch;
    this.area2 = a2 + ch;
    this.area = (a1 < a2 ? a1 : a2) + ch;
    // a cycle: the lower mass turns from opening to closing, between this sample and the last; the period
    // since the previous turn goes to the servo (written out here: a call taking these doubles boxed them)
    this.n++;
    const ar = this.area;
    this.aLo = Math.min(this.aLo, ar);
    this.aHi = Math.max(this.aHi, ar);
    const lv = this.lastV1;
    this.lastV1 = v1;
    if (lv > 0 && v1 <= 0) {
      const t = this.n - 1 + lv / (lv - v1);
      const period = t - this.lastT;
      const swing = this.aHi - this.aLo;
      const mean = 0.5 * (this.aHi + this.aLo);
      if (this.lastT >= 0 && period > 1 && swing > TUNE_DEPTH * mean) {
        // the servo takes the onset's shallow first cycles (gating them at DEPTH left onsets up to 370 cents
        // sharp for 55 ms) but not the shiver of abducted folds, whose turns come at any rate (44 to 854 Hz
        // under a 460 Hz target) and pulled the correction off before the note began (MEASURED)
        const deep = swing > DEPTH * mean ? 1 : 0;
        if (deep) {
          // the first full cycle after a gap opens an onset
          if (this.lastVoiced < 0 || t - this.lastVoiced > (VOICED_GAP * this.rate) / this.servo.target) {
            this.onsetEnd = t + ONSET_S * this.rate;
            this.servo.restart = 1;
          }
          this.lastVoiced = t;
        }
        this.servo.measured = this.rate / period;
        this.servo.deep = deep;
        this.servo.onset = t < this.onsetEnd ? 1 : 0;
        this.servo.pending = 1;
        this.cycles++;
      }
      this.lastT = t;
      this.aLo = 1e9;
      this.aHi = 0;
    }
    this.sinceTurn = this.lastVoiced >= 0 ? this.n - this.lastVoiced : 1e9;
    // every sample, so V8 optimizes and inlines it; it works only on a sample that measured a cycle (a call
    // once a cycle stayed unoptimized and boxed its doubles)
    this.servo.cycle();
  }
}
