/*
 * The junction airway: a waveguide from the lungs to the lips and nostrils
 * that carries the air itself, not only its sound. Pressure builds behind a
 * closure until voicing stops, a release bursts, a voiced closure's voice
 * bar fades, and aspiration takes the tract's resonances, all from the flow.
 * Nothing is injected by rule.
 *
 * THE IDEA. Every section is c / (2 rate) long, so a wave crosses it in
 * half a sample: the Yee scheme at Courant number 1, where it is exact for
 * a lossless tube, and the scheme CHIMERA (Jameson Hodge, MIT,
 * https://github.com/jamesondh/chimera-vocal-synth at 1d3ea49) runs at
 * Courant 0.93 on an airway oversampled to 96 kHz. All the flow physics
 * lives in the junctions between sections. With power-normalized waves R
 * (toward the lips) and L (toward the lungs), a junction between impedances
 * Z1 = rho c / A1 and Z2 solves its volume flow U from
 *
 *   k(U) |U| U + (Z1 + Z2 + Rv) U = 2 (p1+ - p2-) + pn
 *
 * in closed form, where k is the Borda-Carnot kinetic loss of a jet leaving
 * the narrower side (direction dependent, with a 0.1 contraction loss), Rv
 * the viscous resistance and pn a turbulence source in series. The waves
 * leave as p1- = p1+ - Z1 U and p2+ = p2- + Z2 U. Every even junction also
 * carries a yielding wall (mass, resistance and stiffness per unit area,
 * solved implicitly as a Thevenin conductance) and the anatomical flow
 * -dV/dt of moving tissue. So the mean flow runs end to end: lung pressure,
 * trachea, glottis (a junction whose area is the fold pulse), the grid,
 * the velum (a three-way node into the nasal tube) and the Flanagan R || L
 * radiation loads at the lips and nostrils, which pass DC.
 *
 * TURBULENCE. Three dipole sources, CHIMERA's (human_airway.rs update_noise,
 * network.rs:1097-1130): at the junction the jet reattaches, 0.9 k cm past
 * the narrowest point's exit; at the incisors, an obstacle the jet hits;
 * and at the glottis. Each is Reynolds-law white noise, (Re^2 - Re_c^2)
 * saturating at Re 12000, from the local flow and area. The constriction
 * and teeth sources are shaped by a two-pole low-pass at a constant
 * Strouhal number, fc = St v / d (St = 1, CALIBRATED against Jongman,
 * Wayland and Wong 2000), and a high-pass at fc / 12; the glottal source
 * keeps CHIMERA's 300 to 3500 Hz band (human_airway.rs:271).
 *
 * COST. The trachea and nasal tube are fixed, so they are delay lines
 * between a few lumped nodes (dsp/airway-tube.ts). On the grid only the
 * sections that move by more than 0.3 percent in a block are recomputed per
 * sample (sqrt(Z) from an area ramped linearly, so an opening is spread
 * over the block), a junction's kinetic root uses its series expansion when
 * the kinetic term is small, and odd and even junctions run in separate
 * loops. MEASURED in the prototype: 0.65 to 0.87 us a sample at 48 kHz
 * against 3.1 to 4.8 for one junction per section.
 *
 * NO ALLOCATION, NO BOXING. Inputs are fields the voice writes before
 * beginBlock(); render() takes indices and buffers only. Nothing per sample
 * calls a method with a double argument or result (V8 boxes doubles that
 * cross a call it did not inline). The noise is a mulberry32 generator held
 * here as an integer, seeded from the 'noise' fork at every reset(), so
 * a stream label still reproduces every sample.
 *
 * The constants are CHIMERA's unless marked; THIRD_PARTY_NOTICES.md lists
 * each with its file and line. MEASURED and CALIBRATED values are this
 * airway's, from its prototype (docs/VOICE-2.md, "The junction airway").
 */

import type { NamedRng } from '../types';
import { AIR_DENSITY, AIR_DYNAMIC_VISCOSITY, AIR_VISCOSITY, CM_H2O, CRITICAL_REYNOLDS, SATURATION_REYNOLDS, SOUND_SPEED, WALL_NASAL, WALL_SOFT, WALL_TRACHEA } from './air';
import { AirwayTube, TUBE_RING, evenNodes } from './airway-tube';
import { AreaSlew } from './area-rate';
import { GlottalSource } from './glottal';
import { GEO_AMPLITUDE, GeometricGlottis } from './geometric-glottis';
import { FoldOscillator } from './fold-oscillator';
import { PhonationThreshold } from './phonation-threshold';

/** The fold models: kinematic two-edge, self-oscillating two-mass, the parametric pulse (the default). */
export const GLOTTIS_GEOMETRIC = 0;
export const GLOTTIS_SELF_OSCILLATING = 1;
export const GLOTTIS_PULSE = 2;

const RHO = AIR_DENSITY;
const RHOC = AIR_DENSITY * SOUND_SPEED;
const IRHOC = 1 / RHOC;
const SRHOC = Math.sqrt(RHOC);
const NU = AIR_VISCOSITY;
const RE_C = CRITICAL_REYNOLDS;
const RE_C2 = RE_C * RE_C;
const SAT = SATURATION_REYNOLDS * SATURATION_REYNOLDS - RE_C2;
/** CHIMERA's viscous resistance at 700 Hz (network.rs:866). */
const VISC = Math.sqrt((RHO * AIR_DYNAMIC_VISCOSITY * 2 * Math.PI * 700) / 2);
/** Under this area a section is shut (network.rs:417). */
const CLOSED = 2e-4;
/*
 * The least area any section takes, 1e-4 cm^2 (under the closed area, so a
 * sealed section still seals: its leak at full lung pressure is about
 * 0.4 cm^3/s), written as a literal wherever it is used: a module-level
 * constant in a conditional made V8 box every double that merged with it
 * (MEASURED: 1.9 KB a block). At 1e-6 the first sample of a release changed
 * the sealed section's impedance 85-fold and stepped the pressure stored in
 * its power-normalized waves: a step larger than the burst's peak (MEASURED:
 * 1.05 to 1.5 of it at the twinkle /k/, CHIMERA's 0.57).
 */
/** CHIMERA's output gain on the radiated flow derivative (human_voice.rs:220). */
const OUTPUT_GAIN = 5.5e-7;
/** A kinetic root takes its series expansion when 4 k |c| / bq^2 is under this (error under 1e-7). MEASURED. */
const LIN_EPS = 2e-3;
/** A grid section moving by less than this fraction in a block steps once per block (42 to 57 dB SNR against per sample). MEASURED. */
const MOVE_REL = 0.003;
/** Strouhal number of the constriction and teeth sources. CALIBRATED against Jongman (2000) fricative means. */
const STROUHAL = 1.0;
/** Their high-pass corner, as a fraction of the low-pass corner. CALIBRATED with STROUHAL. */
const HP_RATIO = 12;
/* The glottal source's fixed band is 300 to 3500 Hz (human_airway.rs:271), written as literals where used. */
/**
 * Noise gains (constriction, teeth, glottis): CHIMERA's own values at 48 kHz, times
 * sqrt(rate / 48000) elsewhere so the noise's spectral density does not change with the rate.
 * CALIBRATED against CHIMERA's output, band by band after time alignment (scratch dtw/bands.ts):
 * the earlier sqrt(rate / 96000) scaling, with the glottal gain halved again, left the vowels 6 to
 * 9 dB short above 6 kHz (the breath noise each open phase carries) and the consonant noise 2 to
 * 6 dB short above 1.5 kHz. At CHIMERA's values both are within about 2 to 3 dB.
 */
const GAIN_C = 2.2e-6;
const GAIN_T = 3.0e-6;
const GAIN_G = 3.2e-6;
/** The teeth source fades out as the jet widens past these areas, x k^2 (CHIMERA 0.2 to 0.5). CALIBRATED against Jongman. */
const TEETH_JET_LO = 0.1;
const TEETH_JET_HI = 0.3;
/** Where the jet reattaches past the narrowest point's exit, cm x k (human_airway.rs update_noise). */
const REATTACH = 0.9;
/** The glottal port: depth 0.3 k, slit 1.4 k, kinetic entrance 0.37 (human_airway.rs:102). */
const GLOTTIS_DEPTH = 0.3;
const GLOTTIS_SLIT = 1.4;
const GLOTTIS_KIN = 0.37;
/** The velum port: length 1.0 k, kinetic 0.3 in, 0.8 out (human_airway.rs:110-118). */
const VELUM_LEN = 1.0;
const VELUM_KIN = 0.3;
const VELUM_EXIT = 0.8;
/** Output high-pass (DC) and low-pass corners, Hz; the low-pass stands in for CHIMERA's decimator. MEASURED. */
const OUTPUT_HP = 25;
const OUTPUT_LP = 18000;
/** The moving-wall flow is smoothed by CHIMERA's 60 Hz two-pole (network.rs:360). */
const DVDT_HZ = 60;
/** Lumped interior nodes of the trachea and of the nasal tube. MEASURED. */
const TRACHEA_NODES = 4;
const NASAL_NODES = 6;
/** The back duct's shortest length, cm: the Lagrange read stays causal. */
export const DUCT_MIN = 1.25;
/** Fraction of a wall's volume velocity radiated through the skin (human_airway.rs:86-87). */
const WALL_RADIATION = 0.25;

/** The shortest back duct at a rate, cm: max(DUCT_MIN, 3.2 dx), so a Lagrange read is causal. */
export function ductMin(rate: number): number {
  const dx = SOUND_SPEED / (2 * rate);
  return DUCT_MIN > 3.2 * dx ? DUCT_MIN : 3.2 * dx;
}

/** GlottalSource's area block, called through Reflect.apply so V8 never inlines it into beginBlock(). */
const AREA_BLOCK = GlottalSource.prototype.processArea;

export class JunctionAirway {
  readonly rate: number = 0;
  readonly block: number = 0;
  readonly dx: number = 0;
  /** Grid capacity; nG sections are in use. */
  readonly nMax: number = 0;
  nG = 0;
  /** Velum junction (grid index). */
  jv = 2;
  private k = 1;
  private readonly T: number = 0;

  /* ---- Inputs, written by the caller before each beginBlock(). ---- */
  /** Grid areas (cm^2), back duct end to lips, nG used. */
  readonly gridIn: Float64Array;
  /** Smallest area inside each grid section (CHIMERA's sub-section minima), cm^2. */
  readonly gridMin: Float64Array;
  /** Anatomical -dV/dt per grid junction, cm^3/s (0 .. nG). */
  readonly vflow: Float64Array;
  /** Back duct length (cm) and area (cm^2). */
  ductLen = 2;
  ductArea = 3;
  /** Velum port area, cm^2. */
  velum = 0;
  /** Lung pressure, dyn/cm^2. */
  pLung = 0;
  /** The static glottal opening (abduction), cm^2. */
  agStatic = 0.02;
  /** How far the folds are held shut, 0..1 (a glottal stop). */
  closure = 0;
  /** Which fold model makes the glottal area: GLOTTIS_GEOMETRIC, GLOTTIS_SELF_OSCILLATING or GLOTTIS_PULSE. */
  model = GLOTTIS_PULSE;
  /** The part of agStatic that is the posterior chink, cm^2 (the fold models; the pulse uses agStatic whole). */
  chink = 0.01;
  /** Fold length at rest, cm (the fold models). */
  foldLength = 1.6;
  /** Geometric glottis: the upper edge's rest displacement over the lower's, cm; its phase lag (cycles), skew, double pulsing. */
  upperRest = 0.03;
  lag = 70 / 360;
  skew = 0;
  doublePulse = 0.05;
  /** Geometric glottis: the amplitude factor x_rel (under 1: stiffened folds). */
  xRel = 1;
  /** Added to both edges' rest displacement, cm: negative presses the folds together (the fold models). */
  restOffset = 0;
  /** The fold pulse's rate, Hz. */
  f0 = 110;
  /** Incisors (grid junction) and the pharynx/oral split (fractional grid position). */
  teethI = 30;
  splitI = 20;
  /** Output gain applied with the envelope. */
  gain = 1;

  /* ---- Outputs. ---- */
  voicing = 0;
  /** Pressure across the folds, dyn/cm^2, and its 30 Hz smoothing; the pressure below them, smoothed. */
  dpGlottis = 0;
  /** The transglottal pressure the fold models see: block means through a 30 Hz one-pole, dyn/cm^2. */
  pTrans = 0;
  /** The pressure above the folds, the same way, dyn/cm^2. */
  pSupra = 0;
  private dpAcc = 0;
  private paAcc = 0;
  dpSmooth = 0;
  pSubSmooth = 0;
  private pSub = 0;
  uLips = 0;
  uNose = 0;
  readonly glottis: GlottalSource;
  readonly geometric = new GeometricGlottis();
  readonly folds: FoldOscillator;
  readonly threshold: PhonationThreshold;

  /* ---- Grid sections. ---- */
  private readonly R: Float64Array;
  private readonly L: Float64Array;
  private readonly sZ: Float64Array;
  private readonly isZ: Float64Array;
  private readonly Zs: Float64Array;
  private readonly area: Float64Array;
  private readonly dArea: Float64Array;
  private readonly aMin: Float64Array;
  private readonly dAMin: Float64Array;
  private readonly iaMin: Float64Array;
  private readonly viscC: Float64Array;
  private readonly perimF: Float64Array;
  /** A wall's surface per sqrt(area) on each section: walls lumped onto even junctions at double surface. */
  private readonly wallK: Float64Array;
  private readonly moving: Int32Array;
  private nMoving = 0;
  private readonly tgt: Float64Array;
  private readonly tgtMin: Float64Array;
  private readonly slew = new AreaSlew();

  /* ---- Grid junctions 0 .. nG. ---- */
  private readonly kf: Float64Array;
  private readonly kb: Float64Array;
  private readonly rv: Float64Array;
  private readonly U: Float64Array;
  private readonly pn: Float64Array;
  private readonly wS: Float64Array;
  private readonly gw: Float64Array;
  private readonly wV: Float64Array;
  private readonly wY: Float64Array;
  private readonly jmList: Int32Array;
  private nJm = 0;
  private readonly gamA: Float64Array;
  private readonly ibA: Float64Array;
  private readonly bqA: Float64Array;
  private readonly dv1: Float64Array;
  private readonly dv2: Float64Array;
  private readonly dvRaw: Float64Array;
  private readonly dvCoef: number = 0;
  private readonly wCm: number = 0;
  private readonly wKs: number = 0;
  private readonly wIbs: number = 0;

  /* ---- Fixed tubes. ---- */
  private readonly tr: AirwayTube;
  private readonly na: AirwayTube;
  private readonly secScratch: Float64Array;
  private readonly nodeScratch = new Int32Array(16);

  /* ---- Back duct (a fractional delay, Lagrange 3). ---- */
  private readonly fBuf = new Float64Array(TUBE_RING);
  private readonly bBuf = new Float64Array(TUBE_RING);
  private pos = 0;
  private ductTau = 2;
  private dTau = 0;
  private ductSZ = 1;
  private dDuctSZ = 0;
  private ductA = 1;

  /* ---- Glottis. ---- */
  private readonly areaBuf: Float64Array;
  private readonly areaArgs: [Float64Array, number, number];
  private agSt = 0.02;
  private agSt0 = 0.02;
  private aVib = 0;
  private aVib0 = 0;
  private uG = 0;
  private momG = 0;
  private lG = 0;
  private ag = 1e-4;
  private agAcc = 0;
  private agMean = 0.05;
  private agLast = 0;
  private pL = 0;
  private pL0 = 0;
  private visc0 = 0;
  private ldG = 0;

  /* ---- Velum. ---- */
  private vel = 0;
  private vel0 = 0;
  private velNow = 0;
  private uV = 0;
  private momV = 0;
  private lV = 0;
  private velLen = 1;

  /* ---- Radiation and output. ---- */
  private ulLips = 0;
  private lrLips = 0;
  private ulNose = 0;
  private pLipsOld = 0;
  private pNoseOld = 0;
  private radPrev = 0;
  private wallRadAcc = 0;
  private hpX = 0;
  private hpY = 0;
  private readonly hpC: number = 0;
  /* The output low-pass, a second-order Butterworth (b0, b1 = 2 b0, b2 = b0; a1, a2). */
  private readonly lb0: number = 0;
  private readonly lb1: number = 0;
  private readonly la1: number = 0;
  private readonly la2: number = 0;
  private lx1 = 0;
  private lx2 = 0;
  private ly1 = 0;
  private ly2 = 0;
  /** Per-sample ramp position within the block, (n + 1) / count. */
  private w = 0;
  /** The fold rate handed to the glottis, [0]: setFreqFrom reads it, so no double crosses the call. */
  private readonly f0Buf = new Float64Array(1);

  /* ---- Turbulence: slot 0 constriction, 1 teeth, 2 glottis. ---- */
  private readonly srcJ = new Int32Array(3).fill(-1);
  private readonly srcJOld = new Int32Array(3).fill(-1);
  private readonly srcUJ = new Int32Array(3).fill(-1);
  private readonly srcUJOld = new Int32Array(3).fill(-1);
  private readonly srcW = new Float64Array(3);
  private readonly srcW0 = new Float64Array(3);
  private readonly srcA = new Float64Array(3);
  private readonly srcReK = new Float64Array(3);
  private readonly fade = new Float64Array(3);
  private readonly nHp = new Float64Array(3);
  private readonly nL1 = new Float64Array(3);
  private readonly nL2 = new Float64Array(3);
  private readonly cHp = new Float64Array(3);
  private readonly cLp = new Float64Array(3);
  private readonly uAbsAcc = new Float64Array(3);
  private readonly noiseGain = new Float64Array(3);
  private readonly rng: NamedRng;
  /** mulberry32 state, an int32. */
  private seed = 1;
  /** Block counter in the current note; 0 means the next block is the first. */
  private blocks = 0;

  /**
   * rate in Hz; nMax: the most grid sections any configure() will use;
   * rng: forks 'noise' (the turbulence seed per reset) and 'glottis'.
   */
  constructor(rate: number, nMax: number, rng: NamedRng) {
    this.rate = rate;
    this.T = 1 / rate;
    this.block = Math.max(8, Math.round((32 * rate) / 48000));
    this.dx = SOUND_SPEED / (2 * rate);
    this.nMax = nMax;
    this.rng = rng.fork('noise');
    const n = nMax;
    const nj = n + 1;
    this.gridIn = new Float64Array(n).fill(3);
    this.gridMin = new Float64Array(n).fill(3);
    this.vflow = new Float64Array(nj);
    this.R = new Float64Array(n);
    this.L = new Float64Array(n);
    this.sZ = new Float64Array(n);
    this.isZ = new Float64Array(n);
    this.Zs = new Float64Array(n);
    this.area = new Float64Array(n);
    this.dArea = new Float64Array(n);
    this.aMin = new Float64Array(n);
    this.dAMin = new Float64Array(n);
    this.iaMin = new Float64Array(n);
    this.viscC = new Float64Array(n);
    this.perimF = new Float64Array(n);
    this.wallK = new Float64Array(n);
    this.moving = new Int32Array(n);
    this.tgt = new Float64Array(n);
    this.tgtMin = new Float64Array(n);
    this.kf = new Float64Array(nj);
    this.kb = new Float64Array(nj);
    this.rv = new Float64Array(nj);
    this.U = new Float64Array(nj);
    this.pn = new Float64Array(nj);
    this.wS = new Float64Array(nj);
    this.gw = new Float64Array(nj);
    this.wV = new Float64Array(nj);
    this.wY = new Float64Array(nj);
    this.jmList = new Int32Array(nj);
    this.gamA = new Float64Array(nj).fill(1);
    this.ibA = new Float64Array(nj);
    this.bqA = new Float64Array(nj);
    this.dv1 = new Float64Array(nj);
    this.dv2 = new Float64Array(nj);
    this.dvRaw = new Float64Array(nj);
    this.dvCoef = 1 - Math.exp((-2 * Math.PI * DVDT_HZ) / rate);
    this.wCm = WALL_SOFT.m * rate - 0.5 * WALL_SOFT.r;
    this.wKs = WALL_SOFT.k;
    this.wIbs = 1 / (WALL_SOFT.m * rate + 0.5 * WALL_SOFT.r);
    this.tr = new AirwayTube(TRACHEA_NODES + 2);
    this.na = new AirwayTube(NASAL_NODES + 5);
    // the longest fixed tube (the male trachea, 12 cm) in sections, with room
    this.secScratch = new Float64Array(Math.ceil((14 * 1.2) / this.dx) + 4);
    this.glottis = new GlottalSource(rate, rng.fork('glottis'));
    this.folds = new FoldOscillator(rate);
    this.threshold = new PhonationThreshold(this.block / rate);
    this.areaBuf = new Float64Array(this.block);
    this.areaArgs = [this.areaBuf, 0, this.block];
    this.hpC = Math.exp((-2 * Math.PI * OUTPUT_HP) / rate);
    const fc = Math.min(OUTPUT_LP, 0.45 * rate);
    const K = Math.tan((Math.PI * fc) / rate);
    const q = Math.SQRT1_2;
    const norm = 1 / (1 + K / q + K * K);
    this.lb0 = K * K * norm;
    this.lb1 = 2 * this.lb0;
    this.la1 = 2 * (K * K - 1) * norm;
    this.la2 = (1 - K / q + K * K) * norm;
    const ns = Math.sqrt(rate / 48000);
    this.noiseGain[0] = GAIN_C * ns;
    this.noiseGain[1] = GAIN_T * ns;
    this.noiseGain[2] = GAIN_G * ns;
    this.configure(1, Math.min(n, 30), 12);
  }

  /**
   * Lay the airway out for a body of scale k with n grid sections (at most
   * nMax) and the velum at junction jv. Allocates nothing; clears all state.
   */
  configure(k: number, n: number, jv: number): void {
    this.k = k;
    const k2 = k * k;
    const dx = this.dx;
    this.nG = n < this.nMax ? n : this.nMax;
    this.jv = jv;
    this.slew.setScale(k);
    this.slew.setStep(this.block / this.rate);
    this.visc0 = 12 * AIR_DYNAMIC_VISCOSITY * GLOTTIS_DEPTH * k * (GLOTTIS_SLIT * k) ** 2;
    this.ldG = RHO * GLOTTIS_DEPTH * k;
    this.velLen = VELUM_LEN * k;
    const sec = this.secScratch;
    const nodes = this.nodeScratch;
    // trachea: 12 k cm of 2.5 k^2 cm^2, an even number of sections
    let nTr = Math.max(6, Math.round((12 * k) / dx));
    if (nTr % 2) nTr++;
    if (nTr > sec.length) nTr = sec.length - (sec.length % 2);
    for (let i = 0; i < nTr; i++) sec[i] = 2.5 * k2;
    let nn = evenNodes(nTr, TRACHEA_NODES, nodes);
    this.tr.configure(sec, nTr, nodes, nn, WALL_TRACHEA, 1, 1, dx, this.rate);
    // nasal tube: 11.4 k cm, CHIMERA's profile (human_airway.rs:95-104)
    let nNa = Math.max(8, Math.round((11.4 * k) / dx));
    if (nNa % 2) nNa++;
    if (nNa > sec.length) nNa = sec.length - (sec.length % 2);
    for (let i = 0; i < nNa; i++) {
      const u = (i + 0.5) / nNa;
      const a = u < 0.18 ? 2.6 : u < 0.75 ? 2.0 - 0.6 * (u - 0.18) : u < 0.9 ? 1.4 : 1.0;
      sec[i] = a * k2;
    }
    nn = 0;
    nodes[nn++] = 0;
    nodes[nn++] = 2 * Math.round((0.18 * nNa) / 2);
    const extra = NASAL_NODES - 3;
    for (let e = 1; e <= extra; e++) nodes[nn++] = 2 * Math.round(((0.18 + ((0.75 - 0.18) * e) / (extra + 1)) * nNa) / 2);
    nodes[nn++] = 2 * Math.round((0.75 * nNa) / 2);
    nodes[nn++] = 2 * Math.round((0.9 * nNa) / 2);
    nodes[nn++] = nNa;
    // sorted already; drop repeats
    let c = 1;
    for (let i = 1; i < nn; i++) if (nodes[i] > nodes[c - 1]) nodes[c++] = nodes[i];
    this.na.configure(sec, nNa, nodes, c, WALL_NASAL, 3.2, 2.5, dx, this.rate);
    for (let i = 0; i < this.nMax; i++) {
      this.perimF[i] = i < jv ? 1.25 : 1.5;
      this.wallK[i] = 2 * this.perimF[i] * 2 * Math.sqrt(Math.PI) * dx;
      this.viscC[i] = (0.25 * VISC * this.perimF[i] * 2 * Math.sqrt(Math.PI) * dx) / Math.pow(RHOC, 1.5);
    }
    this.reset();
  }

  /** Back to rest: every wave, flow, wall and filter; the turbulence reseeded from its stream. */
  reset(): void {
    const k2 = this.k * this.k;
    this.tr.reset();
    this.na.reset();
    this.glottis.reset();
    this.geometric.reset();
    this.folds.reset();
    this.threshold.reset();
    this.pTrans = this.dpAcc = 0;
    this.pSupra = this.paAcc = 0;
    this.R.fill(0);
    this.L.fill(0);
    this.U.fill(0);
    this.pn.fill(0);
    this.wV.fill(0);
    this.wY.fill(0);
    this.dv1.fill(0);
    this.dv2.fill(0);
    this.dvRaw.fill(0);
    this.area.fill(3 * k2);
    this.aMin.fill(3 * k2);
    this.fBuf.fill(0);
    this.bBuf.fill(0);
    this.pos = 0;
    this.uG = this.momG = this.lG = 0;
    this.uV = this.momV = this.lV = 0;
    this.ulLips = this.lrLips = this.ulNose = 0;
    this.pLipsOld = this.pNoseOld = 0;
    this.radPrev = this.wallRadAcc = 0;
    this.hpX = this.hpY = 0;
    this.lx1 = this.lx2 = this.ly1 = this.ly2 = 0;
    this.voicing = 0;
    this.dpGlottis = this.dpSmooth = 0;
    this.pSub = this.pSubSmooth = 0;
    this.uLips = this.uNose = 0;
    this.aVib = this.aVib0 = 0;
    this.agAcc = 0;
    this.agMean = 0.05;
    this.agLast = 0;
    this.ag = 1e-4;
    for (let q = 0; q < 3; q++) {
      this.srcJ[q] = this.srcJOld[q] = this.srcUJ[q] = this.srcUJOld[q] = -1;
      this.srcW[q] = this.srcW0[q] = 0;
      this.srcA[q] = 1;
      this.fade[q] = 1;
      this.nHp[q] = this.nL1[q] = this.nL2[q] = 0;
      this.uAbsAcc[q] = 0;
    }
    this.seed = (this.rng() * 4294967296) | 0 || 1;
    this.blocks = 0;
  }

  /** The next block's inputs are in the fields: limit and ramp the shape, place the sources, run the glottal pulse. */
  beginBlock(): void {
    const first = this.blocks === 0;
    this.blocks++;
    const blk = this.block;
    const k = this.k;
    const k2 = k * k;
    const nG = this.nG;
    const area = this.area;
    const dArea = this.dArea;
    const grid = this.tgt;
    const gmn = this.tgtMin;
    const dt = blk / this.rate;
    // targets, floored; CHIMERA's area rate law on the grid and the minima (human_airway.rs:190-262)
    for (let s = 0; s < nG; s++) {
      const a = this.gridIn[s];
      grid[s] = a > 1e-4 ? a : 1e-4;
      const m = this.gridMin[s];
      gmn[s] = m > 1e-4 ? m : 1e-4;
    }
    if (!first) {
      this.slew.limitAll(grid, area, nG);
      this.slew.limitAll(gmn, this.aMin, nG);
    }
    for (let s = 0; s < nG; s++) {
      if (grid[s] < 1e-4) grid[s] = 1e-4;
      let m = gmn[s];
      if (m > grid[s]) m = grid[s];
      gmn[s] = m < 1e-4 ? 1e-4 : m;
    }
    // the velum junction sits one section behind the pharynx/oral split, and moves only while the port is shut
    if (this.splitI >= 0) {
      let want = Math.floor(this.splitI - 1);
      want = want < 2 ? 2 : want > nG - 2 ? nG - 2 : want;
      const shut = this.vel <= CLOSED && this.velum <= CLOSED && (this.uV < 1 && this.uV > -1);
      if (first || shut) this.jv = want;
    }
    // section ramps (linear in area) and the moving set
    let nm = 0;
    for (let s = 0; s < nG; s++) {
      const a = grid[s];
      if (first) area[s] = a;
      const d = a - area[s];
      const rel = d < 0 ? -d : d;
      const mt = gmn[s];
      if (first) this.aMin[s] = mt;
      const dm = mt - this.aMin[s];
      const relm = dm < 0 ? -dm : dm;
      // a narrow minimum ramps per sample at any change: its kinetic loss goes as 1 / A^2, so even a
      // 0.3 percent step once a block was a pressure step at every block (MEASURED: block-periodic
      // clicks as a closure released slowly)
      if (rel > MOVE_REL * 0.5 * (a + area[s]) || relm > MOVE_REL * 0.5 * (mt + this.aMin[s]) || (dm !== 0 && mt < 0.5 * k2)) {
        dArea[s] = d / blk;
        this.dAMin[s] = dm / blk;
        this.moving[nm++] = s;
      } else {
        this.dAMin[s] = 0;
        this.aMin[s] = mt;
        this.iaMin[s] = 1 / mt;
        dArea[s] = 0;
        area[s] = a;
        const z = Math.sqrt(RHOC / a);
        this.sZ[s] = z;
        this.isZ[s] = 1 / z;
        this.Zs[s] = z * z;
      }
    }
    this.nMoving = nm;
    // junction elements from the block-end shape; moving junctions recompute per sample
    let njm = 0;
    const dx = this.dx;
    for (let i = 1; i < nG; i++) {
      const sl = i - 1;
      const sr = i;
      const mv = dArea[sl] !== 0 || dArea[sr] !== 0 || this.dAMin[sl] !== 0 || this.dAMin[sr] !== 0;
      if (mv) this.jmList[njm++] = i;
      const al = grid[sl];
      const ar = grid[sr];
      // the jet leaves the upstream section's minimum and expands into the downstream section; a 0.1
      // contraction loss entering a narrower minimum (network.rs:919-930)
      const ef = 1 / gmn[sl] - 1 / ar;
      const eb = 1 / gmn[sr] - 1 / al;
      const cf = 1 / gmn[sr] - 1 / al;
      const cb = 1 / gmn[sl] - 1 / ar;
      this.kf[i] = 0.5 * RHO * ((ef > 0 ? ef * ef : 0) + (cf > 0 ? 0.1 * cf * cf : 0));
      this.kb[i] = 0.5 * RHO * ((eb > 0 ? eb * eb : 0) + (cb > 0 ? 0.1 * cb * cb : 0));
      const zl = RHOC / al;
      const zr = RHOC / ar;
      const r = this.viscC[sl] * zl * Math.sqrt(zl) + this.viscC[sr] * zr * Math.sqrt(zr);
      this.rv[i] = r;
      // walls lumped onto even junctions at double surface (the velum junction too); MEASURED
      const am = 0.5 * (al + ar);
      const sw = (i & 1) === 0 && am > CLOSED ? this.wallK[sl] * Math.sqrt(am - CLOSED) : 0;
      this.wS[i] = sw;
      const gw = sw * this.wIbs;
      this.gw[i] = gw;
      if (!mv) {
        const gam = 1 / (1 + zl * gw);
        this.gamA[i] = gam;
        const bq = zl * gam + zr + r;
        this.bqA[i] = bq;
        this.ibA[i] = 1 / bq;
      }
    }
    this.nJm = njm;
    // the anatomical moving-wall flow, odd junctions' share on the next even one
    const raw = this.dvRaw;
    raw.fill(0);
    if (!first) {
      for (let j = 0; j <= nG; j++) {
        const to = (j & 1) === 0 ? j : j + 1 <= nG ? j + 1 : j - 1;
        raw[to] += this.vflow[j];
      }
    }
    // weighted by the fade-in as the section opens past 0.02 to 0.12 k^2 (a sealed node takes none);
    // the product is what render() smooths per sample, so the weight's own changes are smoothed too
    // (ramped per block and multiplied by a large flow, its slope changed at every block: MEASURED
    // block-periodic clicks at a velar release)
    for (let i = 0; i <= nG; i++) {
      const a1 = i > 0 ? grid[i - 1] : this.ductArea;
      const a2 = i < nG ? grid[i] : 1;
      let wv = ((a1 > a2 ? a1 : a2) - 0.02 * k2) / (0.1 * k2);
      wv = wv < 0 ? 0 : wv > 1 ? 1 : wv * wv * (3 - 2 * wv);
      raw[i] *= wv;
    }
    // the back duct
    const tau = (this.ductLen * this.rate) / SOUND_SPEED;
    if (first) this.ductTau = tau;
    this.dTau = (tau - this.ductTau) / blk;
    const da = this.ductArea > 1e-6 ? this.ductArea : 1e-6;
    const sz = Math.sqrt(RHOC / da);
    if (first) this.ductSZ = sz;
    this.dDuctSZ = (sz - this.ductSZ) / blk;
    this.ductA = da;
    // slow inputs ramp across the block
    this.vel0 = first ? this.velum : this.vel;
    this.vel = this.velum;
    this.pL0 = first ? this.pLung : this.pL;
    this.pL = this.pLung;
    const closure = this.closure < 0 ? 0 : this.closure > 1 ? 1 : this.closure;
    const st = this.agStatic * (1 - 0.92 * closure);
    this.agSt0 = first ? st : this.agSt;
    this.agSt = st;
    // the voicing gate (glottis.rs:170-176) from this airway's own pressure across the folds
    const c30 = 1 - Math.exp(-2 * Math.PI * 30 * dt);
    this.dpSmooth += c30 * (this.dpGlottis - this.dpSmooth);
    this.pSubSmooth += c30 * (this.pSub - this.pSubSmooth);
    const thr = 2.5 * CM_H2O;
    let pg = (this.dpSmooth - thr * 0.8) / (thr * 0.8);
    pg = pg < 0 ? 0 : pg > 1 ? 1 : pg * pg * (3 - 2 * pg);
    let ag0 = (this.agStatic - 0.0125 * k2 - 0.08) / 0.14;
    ag0 = ag0 < 0 ? 0 : ag0 > 1 ? 1 : ag0 * ag0 * (3 - 2 * ag0);
    const agate = 1 - ag0;
    this.voicing += (1 - Math.exp(-2 * Math.PI * 25 * dt)) * (pg * agate * (1 - closure) - this.voicing);
    let effort = (this.pLung / CM_H2O - 3) / 10;
    effort = effort < 0 ? 0 : effort > 1 ? 1 : effort;
    this.aVib0 = this.aVib;
    this.aVib = 0.17 * k2 * (0.45 + 0.75 * effort) * this.voicing;
    if (first) this.aVib0 = this.aVib;
    // turbulence sources: the narrowest open grid minimum
    let mn = Infinity;
    let mi = -1;
    for (let i = 0; i < nG; i++) {
      const a = gmn[i];
      if (a > CLOSED && a < mn) {
        mn = a;
        mi = i;
      }
    }
    let wa = (mn - 0.35 * k2) / (0.55 * k2);
    wa = wa < 0 ? 0 : wa > 1 ? 1 : wa * wa * (3 - 2 * wa);
    const wArea = mi >= 0 ? 1 - wa : 0;
    const sw = this.srcW;
    const sw0 = this.srcW0;
    sw0[0] = sw[0];
    sw0[1] = sw[1];
    sw0[2] = sw[2];
    if (mi >= 0 && wArea > 0) {
      const exitJ = mi + 1;
      let inj = mi + 1 + Math.round((REATTACH * k) / dx);
      if (inj > nG) inj = nG;
      this.place(0, inj, exitJ);
      sw[0] = wArea;
      this.srcA[0] = mn;
      const behind = (this.teethI * dx - (mi + 0.5) * dx) / k;
      let d0 = (behind - 0.15) / 0.35;
      d0 = d0 < 0 ? 0 : d0 > 1 ? 1 : d0 * d0 * (3 - 2 * d0);
      let d1 = (behind - 2.6) / 1.4;
      d1 = d1 < 0 ? 0 : d1 > 1 ? 1 : d1 * d1 * (3 - 2 * d1);
      const wDist = d0 * (1 - d1);
      let j0 = (mn - TEETH_JET_LO * k2) / ((TEETH_JET_HI - TEETH_JET_LO) * k2);
      j0 = j0 < 0 ? 0 : j0 > 1 ? 1 : j0 * j0 * (3 - 2 * j0);
      const wJet = 1 - j0;
      let tj = this.teethI;
      tj = tj < 1 ? 1 : tj > nG ? nG : tj;
      this.place(1, tj, exitJ);
      sw[1] = wDist * wJet;
      this.srcA[1] = mn;
    } else {
      sw[0] = 0;
      sw[1] = 0;
    }
    this.place(2, 0, -1);
    sw[2] = 1;
    this.srcA[2] = this.ag > 1e-4 ? this.ag : 1e-4;
    for (let q = 0; q < 3; q++) {
      const uMean = this.uAbsAcc[q] / blk;
      this.uAbsAcc[q] = 0;
      let fc: number;
      let hc: number;
      if (q === 2) {
        // GLOTTAL_LP and GLOTTAL_HP as literals: a module constant merged with a double boxes it
        fc = 3500;
        hc = 300;
      } else {
        const a = this.srcA[q] > 1e-4 ? this.srcA[q] : 1e-4;
        fc = (STROUHAL * (uMean / a)) / (2 * Math.sqrt(a / Math.PI));
        fc = fc < 300 ? 300 : fc > 18000 ? 18000 : fc;
        hc = fc / HP_RATIO;
      }
      if (fc > 0.45 * this.rate) fc = 0.45 * this.rate;
      this.cLp[q] = 1 - Math.exp((-2 * Math.PI * fc) / this.rate);
      this.cHp[q] = Math.exp((-2 * Math.PI * hc) / this.rate);
      const sa = this.srcA[q] > 1e-12 ? this.srcA[q] : 1e-12;
      this.srcReK[q] = 2 / (NU * Math.sqrt(Math.PI * sa));
    }
    this.agAcc = 0;
    this.f0Buf[0] = this.f0;
    this.glottis.setFreqFrom(this.f0Buf, 0);
    this.areaArgs[2] = blk;
    // the pressure across the folds: the last block's mean through a 30 Hz one-pole
    const dpMean = first ? 0 : this.dpAcc / blk;
    const paMean = first ? 0 : this.paAcc / blk;
    this.dpAcc = 0;
    this.paAcc = 0;
    this.pTrans += c30 * (dpMean - this.pTrans);
    this.pSupra += c30 * (paMean - this.pSupra);
    const model = this.model;
    if (model === GLOTTIS_GEOMETRIC) this.geometricBlock(closure);
    else if (model === GLOTTIS_SELF_OSCILLATING) this.foldBlock(closure);
    else this.pulseBlock();
  }

  /** The parametric pulse into absolute areas: the static opening plus the gated pulse, averaged over two samples. */
  private pulseBlock(): void {
    Reflect.apply(AREA_BLOCK, this.glottis, this.areaArgs);
    const buf = this.areaBuf;
    const blk = this.block;
    const inv = 1 / blk;
    const last = buf[blk - 1];
    // backwards, so each sample still reads its raw predecessor
    for (let n = blk - 1; n >= 0; n--) {
      const w = (n + 1) * inv;
      const st = this.agSt0 + (this.agSt - this.agSt0) * w;
      const av = this.aVib0 + (this.aVib - this.aVib0) * w;
      // the fold pulse, averaged over two samples (a closure's top octave is softer; MEASURED)
      let ag = st + av * 0.5 * (buf[n] + (n > 0 ? buf[n - 1] : this.agLast));
      if (ag < 1e-7) ag = 1e-7;
      buf[n] = ag;
    }
    this.agLast = last;
  }

  /** The geometric glottis: rest displacements from the opening, the threshold from the pressure, then the areas. */
  private geometricBlock(closure: number): void {
    const g = this.geometric;
    const L = this.foldLength > 0.1 ? this.foldLength : 0.1;
    const shut = 1 - 0.92 * closure;
    const chink = (this.chink > 0 ? this.chink : 0) * shut;
    const rest = this.agSt - chink;
    const x1 = (rest > 0 ? rest : 0) / L + this.restOffset;
    const x2 = x1 + this.upperRest * shut;
    g.length = L;
    g.chink = chink;
    g.xRest1 = x1;
    g.xRest2 = x2;
    g.lag = this.lag;
    g.skew = this.skew;
    g.doublePulse = this.doublePulse;
    const th = this.threshold;
    th.pressure = this.pTrans;
    th.halfWidth = 0.25 * (x1 + x2);
    th.drive = 1 - closure;
    th.step();
    this.voicing = th.level;
    // the swing as the root of the pressure across the folds (Titze 1989, as the paper models it)
    const p = this.pTrans > 0 ? this.pTrans : 0;
    g.xMax = GEO_AMPLITUDE * this.xRel * Math.sqrt(p) * th.level;
    g.process(this.glottis, this.areaBuf, 0, this.block);
  }

  /** The self-oscillating folds: rest, chink, freedom and the servo's target; their perturbation from the cycle unit. */
  private foldBlock(closure: number): void {
    const f = this.folds;
    const L = this.foldLength > 0.1 ? this.foldLength : 0.1;
    const shut = 1 - 0.92 * closure;
    const chink = (this.chink > 0 ? this.chink : 0) * shut;
    const rest = this.agSt - chink;
    let r = (rest > 0 ? rest : 0) / L + this.restOffset;
    r = r > 0 ? r : 0;
    f.length = L;
    f.chink = chink;
    f.rest1 = r;
    f.rest2 = r;
    f.free = 1 - closure;
    // the cycle unit still runs, for its drift and jitter: the servo aims at the drifted pitch, the
    // cycle's period scale perturbs the tension
    this.glottis.processPhase(this.areaBuf, 0, this.block);
    f.servo.target = this.f0 * this.glottis.pitchFactor;
    f.perturb = 1 / this.glottis.scale;
    f.tune();
    this.voicing = f.cycles > 0 ? 1 : 0;
  }

  /** Put source q at junction j, reading the flow of junction uj; a move fades out at the old place over a block. */
  private place(q: number, j: number, uj: number): void {
    if (j !== this.srcJ[q] || uj !== this.srcUJ[q]) {
      this.srcJOld[q] = this.srcJ[q];
      this.srcUJOld[q] = this.srcUJ[q];
      this.fade[q] = 0;
      this.srcJ[q] = j;
      this.srcUJ[q] = uj;
    }
  }

  /**
   * Render count samples (at most one block, and the block must have
   * begun), adding the sound times `gain` times env[c] into outL and outR at
   * [at, at + count). off: the block's first sample still to render.
   */
  render(outL: Float32Array, outR: Float32Array, at: number, count: number, off: number, env: Float32Array): void {
    const T = this.T;
    const iT = this.rate;
    const nG = this.nG;
    const jv = this.jv;
    const R = this.R;
    const L = this.L;
    const sZ = this.sZ;
    const isZ = this.isZ;
    const Zs = this.Zs;
    const area = this.area;
    const dArea = this.dArea;
    const U = this.U;
    const pn = this.pn;
    const kf = this.kf;
    const kb = this.kb;
    const rv = this.rv;
    const viscC = this.viscC;
    const wallK = this.wallK;
    const gwA = this.gw;
    const wV = this.wV;
    const wY = this.wY;
    const wS = this.wS;
    const moving = this.moving;
    const nm = this.nMoving;
    const jmList = this.jmList;
    const njm = this.nJm;
    const gamA = this.gamA;
    const ibA = this.ibA;
    const bqA = this.bqA;
    const dv1 = this.dv1;
    const dv2 = this.dv2;
    const raw = this.dvRaw;
    const dvc = this.dvCoef;
    const aMin = this.aMin;
    const dAMin = this.dAMin;
    const iaMin = this.iaMin;
    const wCm = this.wCm;
    const wKs = this.wKs;
    const wIbs = this.wIbs;
    const fBuf = this.fBuf;
    const bBuf = this.bBuf;
    const tr = this.tr;
    const na = this.na;
    const areaBuf = this.areaBuf;
    const folds = this.folds;
    const selfOsc = this.model === GLOTTIS_SELF_OSCILLATING;
    const visc0 = this.visc0;
    const ldG = this.ldG;
    const blk = this.block;
    const inv = 1 / blk;
    const gain = this.gain;
    const lungZ = (0.5 * RHOC) / tr.area[0];
    const trLast = tr.nn - 2;
    const trSegF = trLast * TUBE_RING;
    const trD = tr.D[trLast];
    const trZ = tr.Z[trLast];
    const trA = tr.area[trLast];
    let wallRad = 0;
    for (let c = 0; c < count; c++) {
      const n = off + c;
      const w = (n + 1) * inv;
      this.w = w;
      // moving sections
      for (let mi = 0; mi < nm; mi++) {
        const s = moving[mi];
        let a = area[s] + dArea[s];
        area[s] = a;
        if (a < 1e-4) a = 1e-4;
        let mm = aMin[s] + dAMin[s];
        aMin[s] = mm;
        if (mm > a) mm = a;
        if (mm < 1e-4) mm = 1e-4;
        iaMin[s] = 1 / mm;
        const isz = Math.sqrt(a) / SRHOC;
        const z = 1 / isz;
        sZ[s] = z;
        isZ[s] = isz;
        Zs[s] = z * z;
      }
      // moving junctions' elements
      for (let mi = 0; mi < njm; mi++) {
        const i = jmList[mi];
        const zl = Zs[i - 1];
        const zr = Zs[i];
        const ef = iaMin[i - 1] - zr * IRHOC;
        const eb = iaMin[i] - zl * IRHOC;
        const cf = iaMin[i] - zl * IRHOC;
        const cb = iaMin[i - 1] - zr * IRHOC;
        kf[i] = 0.5 * RHO * ((ef > 0 ? ef * ef : 0) + (cf > 0 ? 0.1 * cf * cf : 0));
        kb[i] = 0.5 * RHO * ((eb > 0 ? eb * eb : 0) + (cb > 0 ? 0.1 * cb * cb : 0));
        const r = viscC[i - 1] * zl * sZ[i - 1] + viscC[i] * zr * sZ[i];
        rv[i] = r;
        // the wall's surface follows the area per sample too (set once a block, it stepped the
        // junction's pressure at every block of an opening: MEASURED clicks at a velar release)
        if ((i & 1) === 0) {
          const am = 0.5 * (area[i - 1] + area[i]);
          // the surface goes to zero continuously as the section seals, so the wall leaves smoothly
          const sw = am > CLOSED ? wallK[i - 1] * Math.sqrt(am - CLOSED) : 0;
          wS[i] = sw;
          gwA[i] = sw * wIbs;
        }
        const t = zl * gwA[i];
        const gam = t < 1e-3 ? 1 - t : 1 / (1 + t);
        gamA[i] = gam;
        const bq = zl * gam + zr + r;
        bqA[i] = bq;
        ibA[i] = 1 / bq;
      }
      this.ductTau += this.dTau;
      this.ductSZ += this.dDuctSZ;
      const pL = this.pL0 + (this.pL - this.pL0) * w;
      this.velNow = this.vel0 + (this.vel - this.vel0) * w;
      let ag: number;
      if (selfOsc) {
        folds.step();
        ag = folds.area;
      } else ag = areaBuf[n];
      if (ag < 1e-7) ag = 1e-7;
      this.ag = ag;
      this.agAcc += ag;
      // turbulence from last sample's flows
      for (let q = 0; q < 3; q++) {
        const j = this.srcJ[q];
        if (j < 0) continue;
        // the flow the source reads crossfades with its place (switched at once to another junction's
        // flow, of the other sign at a reversal, the dipole flipped at full level: MEASURED ticks)
        let u: number;
        if (q === 2) u = this.uG;
        else {
          const f = this.fade[q];
          const uo = this.srcUJOld[q];
          u = f < 1 && uo >= 0 ? U[uo] * (1 - f) + U[this.srcUJ[q]] * f : U[this.srcUJ[q]];
        }
        const au = u < 0 ? -u : u;
        this.uAbsAcc[q] += au;
        const re = q === 2 ? (2 * au) / (NU * Math.sqrt(Math.PI * ag)) : au * this.srcReK[q];
        let amp = 0;
        if (re > RE_C) {
          const x = re * re - RE_C2;
          amp = x / (1 + x / SAT);
        }
        const lev = amp * (this.srcW0[q] + (this.srcW[q] - this.srcW0[q]) * w) * this.noiseGain[q];
        // mulberry32, inline: uniform in [0, 1)
        let s = (this.seed + 0x6d2b79f5) | 0;
        this.seed = s;
        s = Math.imul(s ^ (s >>> 15), s | 1);
        s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
        const wv = ((((s ^ (s >>> 14)) >>> 0) / 4294967296) * 2 - 1) * 1.7320508075688772;
        const hpc = this.cHp[q];
        const nh = hpc * this.nHp[q] + (1 - hpc) * wv;
        this.nHp[q] = nh;
        const lpc = this.cLp[q];
        const l1 = this.nL1[q] + lpc * (wv - nh - this.nL1[q]);
        this.nL1[q] = l1;
        const l2 = this.nL2[q] + lpc * (l1 - this.nL2[q]);
        this.nL2[q] = l2;
        // the dipole's sign follows the flow's, continuously through zero
        const v = (lev * l2 * u) / (au + 1);
        if (this.fade[q] < 1) {
          const f = this.fade[q] + inv < 1 ? this.fade[q] + inv : 1;
          this.fade[q] = f;
          const jo = this.srcJOld[q];
          if (jo >= 0) pn[jo] += v * (1 - f);
          pn[j] += v * f;
        } else pn[j] += v;
      }
      // Lagrange-3 coefficients shared by both duct reads (tau - 0.5 and tau + 0.5)
      const dF = this.ductTau - 0.5;
      const i0 = Math.floor(dF);
      const x = dF - i0;
      const hm1 = (-x * (x - 1) * (x - 2)) / 6;
      const h0 = ((x + 1) * (x - 1) * (x - 2)) / 2;
      const h1 = (-(x + 1) * x * (x - 2)) / 2;
      const h2 = ((x + 1) * x * (x - 1)) / 6;
      const pos = this.pos;

      // ---- phase 0: the lungs and the trachea, the glottis, odd grid junctions
      {
        const b = tr.B[(pos - tr.D[0]) & (TUBE_RING - 1)];
        const zt = tr.Z[0];
        const u = (pL - 2 * b) / (lungZ + zt);
        tr.F[pos] = b + zt * u;
      }
      tr.interior(pos);
      {
        const a = tr.F[trSegF + ((pos - trD) & (TUBE_RING - 1))];
        const p0 = (pos - (i0 + 1)) & (TUBE_RING - 1);
        const ductSZ = this.ductSZ;
        const b = (hm1 * bBuf[(p0 + 1) & (TUBE_RING - 1)] + h0 * bBuf[p0] + h1 * bBuf[(p0 - 1) & (TUBE_RING - 1)] + h2 * bBuf[(p0 - 2) & (TUBE_RING - 1)]) * ductSZ;
        const zb = ductSZ * ductSZ;
        const ia = 1 / ag;
        const lg = ldG * ia;
        const rg = visc0 * ia * ia * ia;
        // the duct's area from its impedance, which ramps per sample (stepped once a block, the exit
        // loss stepped the flow: MEASURED clicks a glottis-to-lips delay into every block)
        const exf = ia - zb * IRHOC;
        const exb = ia - 1 / trA;
        const kin = GLOTTIS_KIN * 0.5 * RHO * ia * ia;
        const kfg = kin + 0.5 * RHO * (exf > 0 ? exf * exf : 0);
        const kbg = kin + 0.5 * RHO * (exb > 0 ? exb * exb : 0);
        const m0 = lg < this.lG ? lg * this.uG : this.momG;
        this.lG = lg;
        const cc = 2 * (a - b) + m0 * iT;
        const bq = trZ + zb + rg + lg * iT;
        const u = cc >= 0 ? (2 * cc) / (bq + Math.sqrt(bq * bq + 4 * kfg * cc)) : (2 * cc) / (bq + Math.sqrt(bq * bq - 4 * kbg * cc));
        this.uG = u;
        this.momG = lg * u;
        const pBelow = 2 * a - trZ * u;
        const pAbove = 2 * b + zb * u;
        this.dpGlottis = pBelow - pAbove;
        this.dpAcc += pBelow - pAbove;
        this.paAcc += pAbove;
        folds.ps = pBelow;
        folds.pe = pAbove;
        this.pSub = pBelow;
        tr.B[trSegF + pos] = pBelow - a;
        fBuf[pos] = (pAbove - b) / ductSZ;
      }
      for (let i = 1; i < nG; i += 2) {
        if (i === jv) continue;
        const sl = i - 1;
        const zl = Zs[sl];
        const zr = Zs[i];
        const a = R[sl] * sZ[sl];
        const b = L[i] * sZ[i];
        const cc = 2 * (a - b) + pn[i];
        const ib = ibA[i];
        const kk = cc >= 0 ? kf[i] : kb[i];
        const ac = cc < 0 ? -cc : cc;
        const eps = 4 * kk * ac * ib * ib;
        let u: number;
        if (eps < LIN_EPS) u = cc * ib * (1 - 0.25 * eps);
        else {
          const bq = bqA[i];
          u = (2 * cc) / (bq + Math.sqrt(bq * bq + 4 * kk * ac));
        }
        U[i] = u;
        L[sl] = (a - zl * u) * isZ[sl];
        R[i] = (b + zr * u) * isZ[i];
      }
      if ((jv & 1) === 1) {
        this.velumNode(pos);
        na.interior(pos);
        this.nostrils(pos);
      }
      if ((nG & 1) === 1) this.lips();

      // ---- phase 1: even grid junctions (walls, moving-wall flow), the duct end
      for (let i = 2; i < nG; i += 2) {
        if (i === jv) continue;
        const sl = i - 1;
        const zl = Zs[sl];
        const zr = Zs[i];
        const a = R[sl] * sZ[sl];
        const b = L[i] * sZ[i];
        const ws = wS[i];
        const hist = wCm * wV[i] - wKs * wY[i];
        // CHIMERA's 60 Hz two-pole on the moving-wall flow, per sample (network.rs:360)
        const d1 = dv1[i] + dvc * (raw[i] - dv1[i]);
        dv1[i] = d1;
        const d2 = dv2[i] + dvc * (d1 - dv2[i]);
        dv2[i] = d2;
        const ue0 = d2 - ws * hist * wIbs;
        const gam = gamA[i];
        const cc = 2 * a * gam - 2 * b + zl * gam * ue0 + pn[i];
        const ib = ibA[i];
        const kk = cc >= 0 ? kf[i] : kb[i];
        const ac = cc < 0 ? -cc : cc;
        const eps = 4 * kk * ac * ib * ib;
        let u: number;
        if (eps < LIN_EPS) u = cc * ib * (1 - 0.25 * eps);
        else {
          const bq = bqA[i];
          u = (2 * cc) / (bq + Math.sqrt(bq * bq + 4 * kk * ac));
        }
        U[i] = u;
        const p = (2 * a - zl * (u - ue0)) * gam;
        // a wall with no surface (its junction closed) is disconnected: it must not integrate a sealed node
        if (ws > 0) {
          const v = (hist + p) * wIbs;
          wV[i] = v;
          wY[i] += T * v;
          wallRad += ws * v * WALL_RADIATION;
        }
        L[sl] = (p - a) * isZ[sl];
        R[i] = (b + zr * u) * isZ[i];
      }
      if ((jv & 1) === 0) {
        this.velumNode(pos);
        na.interior(pos);
        this.nostrils(pos);
      }
      {
        const ductSZ = this.ductSZ;
        const zd = ductSZ * ductSZ;
        const p0 = (pos - i0) & (TUBE_RING - 1);
        const a = (hm1 * fBuf[(p0 + 1) & (TUBE_RING - 1)] + h0 * fBuf[p0] + h1 * fBuf[(p0 - 1) & (TUBE_RING - 1)] + h2 * fBuf[(p0 - 2) & (TUBE_RING - 1)]) * ductSZ;
        const zr = Zs[0];
        const b = L[0] * sZ[0];
        const d1 = dv1[0] + dvc * (raw[0] - dv1[0]);
        dv1[0] = d1;
        const d2 = dv2[0] + dvc * (d1 - dv2[0]);
        dv2[0] = d2;
        const ue0 = d2;
        const cc = 2 * a - 2 * b + zd * ue0 + pn[0];
        pn[0] = 0;
        const u = cc / (zd + zr);
        U[0] = u;
        const p = 2 * a - zd * (u - ue0);
        bBuf[pos] = (p - a) / ductSZ;
        R[0] = (b + zr * u) * isZ[0];
      }
      if ((nG & 1) === 0) this.lips();
      for (let q = 0; q < 3; q++) {
        const j = this.srcJ[q];
        if (j >= 0) pn[j] = 0;
        const jo = this.srcJOld[q];
        if (jo >= 0) pn[jo] = 0;
      }
      this.pos = (pos + 1) & (TUBE_RING - 1);
      // the radiated flow's derivative, DC blocked, low-passed
      const rad = this.uLips + this.uNose + this.wallRadAcc + wallRad;
      this.wallRadAcc = 0;
      wallRad = 0;
      const o = (rad - this.radPrev) * iT * OUTPUT_GAIN;
      this.radPrev = rad;
      const hp = o - this.hpX + this.hpC * this.hpY;
      this.hpX = o;
      this.hpY = hp;
      const y = this.lb0 * (hp + this.lx2) + this.lb1 * this.lx1 - this.la1 * this.ly1 - this.la2 * this.ly2;
      this.lx2 = this.lx1;
      this.lx1 = hp;
      this.ly2 = this.ly1;
      this.ly1 = y;
      const v = y * gain * env[c];
      outL[at + c] += v;
      outR[at + c] += v;
    }
    if (off + count >= blk) this.agMean = this.agAcc / blk;
  }

  /** Lips: Flanagan R || L on the last grid section, with any series noise source. */
  private lips(): void {
    const sl = this.nG - 1;
    const z = this.Zs[sl];
    const a = this.R[sl] * this.sZ[sl];
    const ar = this.area[sl] > 1e-4 ? this.area[sl] : 1e-4;
    const lr = (8 * RHO) / (3 * Math.PI * Math.sqrt(Math.PI * ar));
    const rr = (128 * RHOC) / (9 * Math.PI * Math.PI * ar);
    let ul = this.ulLips;
    const lp = this.lrLips;
    if (lp > 0 && lr > lp) ul *= lp / lr;
    const h = this.T / (2 * lr);
    const pOld = this.pLipsOld;
    const src = this.pn[this.nG];
    this.pn[this.nG] = 0;
    const p = (2 * a + src - z * (ul + h * pOld)) / (1 + z * (h + 1 / rr));
    const ul2 = ul + h * (pOld + p);
    const ur = ul2 + p / rr;
    this.pLipsOld = p;
    this.U[this.nG] = ur;
    this.L[sl] = (p - src - a) * this.isZ[sl];
    this.ulLips = ul2;
    this.lrLips = lr;
    this.uLips = ur;
  }

  /** Nostrils: Flanagan R || L on the nasal tube's last segment. */
  private nostrils(pos: number): void {
    const c = this.na;
    const sl = c.nn - 2;
    const z = c.Z[sl];
    const a = c.F[sl * TUBE_RING + ((pos - c.D[sl]) & (TUBE_RING - 1))];
    const ar = c.area[sl];
    const lr = (8 * RHO) / (3 * Math.PI * Math.sqrt(Math.PI * ar));
    const rr = (128 * RHOC) / (9 * Math.PI * Math.PI * ar);
    const h = this.T / (2 * lr);
    const pOld = this.pNoseOld;
    const p = (2 * a - z * (this.ulNose + h * pOld)) / (1 + z * (h + 1 / rr));
    const ul2 = this.ulNose + h * (pOld + p);
    this.ulNose = ul2;
    this.pNoseOld = p;
    this.uNose = ul2 + p / rr;
    c.B[sl * TUBE_RING + pos] = p - a;
  }

  /**
   * The velum node: the oral section behind joins it directly, the oral
   * section ahead through the junction's series element and the nasal tube
   * through the velum port. Two coupled flows, three Gauss-Seidel passes of
   * the closed-form root.
   */
  private velumNode(pos: number): void {
    const j = this.jv;
    const R = this.R;
    const L = this.L;
    const sZ = this.sZ;
    const isZ = this.isZ;
    const Zs = this.Zs;
    const sl = j - 1;
    const sr = j;
    const na = this.na;
    const z1 = Zs[sl];
    const z2 = Zs[sr];
    const z3 = na.Z[0];
    const a = R[sl] * sZ[sl];
    const b = L[sr] * sZ[sr];
    const c3 = na.B[(pos - na.D[0]) & (TUBE_RING - 1)];
    const gw = this.gw[j];
    const d1 = this.dv1[j] + this.dvCoef * (this.dvRaw[j] - this.dv1[j]);
    this.dv1[j] = d1;
    const d2 = this.dv2[j] + this.dvCoef * (d1 - this.dv2[j]);
    this.dv2[j] = d2;
    let ue = d2;
    if (gw > 0) ue -= this.wS[j] * (this.wCm * this.wV[j] - this.wKs * this.wY[j]) * this.wIbs;
    const zl = 1 / (1 / z1 + gw);
    const p0 = (2 * a) / z1 + ue;
    const src = this.pn[j];
    this.pn[j] = 0;
    const kfr = this.kf[j];
    const kbr = this.kb[j];
    const bqr = zl + z2 + this.rv[j];
    const cr0 = zl * p0 - 2 * b + src;
    let ur = this.U[j];
    let uv = 0;
    const vel = this.velNow;
    if (vel > CLOSED) {
      const ip = 1 / vel;
      const lv = RHO * this.velLen * ip;
      const rvv = VISC * 2 * Math.sqrt(Math.PI) * this.velLen * Math.sqrt(vel) * ip * ip;
      const exf = ip - 1 / na.area[0];
      const amin = this.area[sl] < this.area[sr] ? this.area[sl] : this.area[sr];
      const exb = ip - 1 / amin;
      const kin = VELUM_KIN * 0.5 * RHO * ip * ip;
      const kfv = kin + VELUM_EXIT * 0.5 * RHO * (exf > 0 ? exf * exf : 0);
      const kbv = kin + VELUM_EXIT * 0.5 * RHO * (exb > 0 ? exb * exb : 0);
      const m0 = lv < this.lV ? lv * this.uV : this.momV;
      this.lV = lv;
      const bqv = zl + z3 + rvv + lv * this.rate;
      const cv0 = zl * p0 - 2 * c3 + m0 * this.rate;
      uv = this.uV;
      for (let it = 0; it < 3; it++) {
        let c = cr0 - zl * uv;
        if (c >= 0) ur = kfr > 0 ? (2 * c) / (bqr + Math.sqrt(bqr * bqr + 4 * kfr * c)) : c / bqr;
        else ur = kbr > 0 ? (2 * c) / (bqr + Math.sqrt(bqr * bqr - 4 * kbr * c)) : c / bqr;
        c = cv0 - zl * ur;
        if (c >= 0) uv = kfv > 0 ? (2 * c) / (bqv + Math.sqrt(bqv * bqv + 4 * kfv * c)) : c / bqv;
        else uv = kbv > 0 ? (2 * c) / (bqv + Math.sqrt(bqv * bqv - 4 * kbv * c)) : c / bqv;
      }
      this.momV = lv * uv;
    } else {
      this.momV = 0;
      this.lV = 0;
      const c = cr0;
      if (c >= 0) ur = kfr > 0 ? (2 * c) / (bqr + Math.sqrt(bqr * bqr + 4 * kfr * c)) : c / bqr;
      else ur = kbr > 0 ? (2 * c) / (bqr + Math.sqrt(bqr * bqr - 4 * kbr * c)) : c / bqr;
    }
    this.uV = uv;
    const p = zl * (p0 - ur - uv);
    if (gw > 0) {
      const v = (this.wCm * this.wV[j] + p - this.wKs * this.wY[j]) * this.wIbs;
      this.wV[j] = v;
      this.wY[j] += this.T * v;
      this.wallRadAcc += this.wS[j] * v * WALL_RADIATION;
    }
    this.U[j] = ur;
    L[sl] = (p - a) * isZ[sl];
    R[sr] = (b + z2 * ur) * isZ[sr];
    na.F[pos] = c3 + z3 * uv;
  }
}
