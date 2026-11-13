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
 * TURBULENCE. Stevens' law and Birkholz's placement (Stevens, Acoustic
 * Phonetics, 1998, pp. 103-104; Birkholz, "Enhanced area functions for noise
 * source modeling in the vocal tract", ISSP 2014). Each block the grid is
 * searched for constrictions: the narrowest section under 1 k^2 cm^2 and its
 * contiguous neighbours within 0.2 k^2 cm^2 of it, then up to two more runs
 * not joined to it by sections under 1 k^2 cm^2 (a second lingual
 * constriction, so the source does not jump in /su/, and a labial one). No
 * constriction, no jet: a wide tract keeps only the glottal source, so /h/ is
 * aspiration shaped by its vowel. A constriction's source pressure is
 *
 *   p_s = G |v_c|^3 sqrt(A_min)
 *
 * with v_c the velocity through its narrowest section low-passed at 500 Hz,
 * in series at the junctions where it lands, its sign the flow's. Where it
 * lands depends on D, the distance from the flow separation point (the run's
 * anterior end) to the incisors: a wall source 0.25 k cm downstream when D is
 * over 2 k cm, an obstacle source at the incisors when it is under, blended
 * over 2 to 3 k cm (Birkholz's own proposal; his table lists /s z ʃ ʒ/ as
 * obstacle sources, and this geometry's /ʃ/ separates 1.9 to 2.2 cm behind
 * the incisors), and a labiodental source 0.15 k cm downstream where the
 * lower lip forms the constriction at the incisors (/f v/), blended over D
 * from 0.5 k cm to 0. A jet that separates at or past the incisors' edge
 * (the dental /θ/) has no obstacle ahead: as D falls from 0.3 k cm to 0 the
 * obstacle source gives way to a free-jet source at the wall source's place.
 * A place inside a section is split between its two
 * junctions linearly, and a source that moves or changes type ramps every
 * junction weight over one block. The noise is white through one first-order
 * low-pass at fc = 0.15 v_c / d, d = sqrt(4 A / pi), for every source:
 * Birkholz flattens the labiodental and glottal ones (a 6 kHz corner), but in
 * this airway that made /f/ rise 17 dB from 1 to 12 kHz against the human
 * recording's flat spectrum and /h/ bright (MEASURED: shape distance to the
 * human 11.5 and 18.0 dB, against 5.8 and 15.4 with Stevens' corner). Every
 * constriction source but the obstacle's share also falls through a second
 * pole at 3.5 kHz (Shadle 1991: the obstacle is the broadband source), and a
 * constriction makes noise only above the critical Reynolds number, faded in
 * over Re 1000 to 2000, so a closure's last leak is quiet. The
 * glottal (aspiration) source sits 1.5 k cm above the glottis, read from the
 * glottal flow and area; a velic source in the velum port, read from its flow
 * and area, gives the burst of a velic release (/pm/, as VocalTractLab 2.4
 * adds). In voicing, frication pulses at f0 behind a convective delay,
 * tau = D / (0.5 v_jet), with its modulation index soft-limited near 0.5
 * (Jackson and Shadle 2000; Pincas and Jackson 2005). A section at the closed
 * area makes no noise: its leak is the area floor's, not a jet; and a closing
 * seal's source reads the area the articulators command where the area rate
 * law still holds the airway's open, so a seal is not a fricative. The gains are
 * CALIBRATED here against the human recordings and CHIMERA's levels (Birkholz
 * fitted his to his own tract: wall 5, obstacle 10, labiodental 3, aspiration
 * 0.005 to 0.5).
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
import { AIR_DENSITY, AIR_DYNAMIC_VISCOSITY, CM_H2O, SOUND_SPEED, WALL_NASAL, WALL_TRACHEA, WALL_TRACT } from './air';
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
/*
 * Turbulence sources: three constriction slots, the glottis, the velum port. Each writes into at
 * most TAPS junctions (its places this block and the ones it fades out of); its velocity passes
 * through a ring of MOD_RING samples for the convective delay (4 ms at 96 kHz fits).
 */
const NSRC = 5;
const SRC_ASP = 3;
const SRC_VEL = 4;
const TAPS = 16;
const MOD_RING = 512;
/**
 * Source gains by type, CALIBRATED from Birkholz's (ISSP 2014, Table 1: wall 5, obstacle 10,
 * labiodental 3). Wall 1.4 times his: at 10 and 5, the voiced /z/'s frication lay under its voicing
 * in the female and child bodies (shape distance to the human 25.4 and 26.0 dB; at 14 and 7, 12.6 and
 * 12.6). The obstacle 18, chosen on the mean of five noise seeds: the child's /z/ sits at a threshold
 * where its frication either clears its voicing or does not, and the seed decides which. Its shape
 * distance to the human, mean [range] over the seeds: at 14, 26.1 [26.0..26.3]; at 15, 23.5 [12.8..26.3]
 * (frication on one seed of five); at 17, 18.0 [12.6..26.3]; at 18, 12.6 [12.4..12.9] (this airway's
 * predecessor, before the noise round, 12.4 [12.2..12.7]). The child's mean over the fricatives goes 12.16 to 10.81
 * from 15 to 18, the male's 10.23 to 10.18, the female's 10.96 to 10.89; the cost is DTW distance to
 * CHIMERA on the strengths line, female and child, 0.06 and 0.07 dB (docs/VOICE-2.md, "Fixes after
 * verification"). Lowering the Reynolds window's floor did not move the threshold (over Re 500 to 2000
 * and 0 to 2000, the same 23.5). The labiodental one: at his 3, /f/
 * lay 37 dB under its vowel (CHIMERA 18, the earlier library 25); at 25, with the second pole below, 27.
 */
const G_WALL = 7;
const G_OBSTACLE = 18;
const G_LABIAL = 25;
/** A constriction at the lips that is not labiodental (rounding): Birkholz's labiodental gain, unfitted. */
const G_LIPS = 3;
/**
 * A jet that separates at or past the incisors' edge has no obstacle ahead of it (the dental /θ/):
 * the obstacle source fades out as D falls from D_FREE x k cm to 0, and a free-jet source at the
 * wall source's place, gain G_FREE, takes its share. CALIBRATED: /θ/ at the incisors' obstacle read
 * 12.8 dB from the human shape, 9.0 as a free jet with the second pole (docs/VOICE-2.md).
 */
const D_FREE = 0.3;
const G_FREE = 6;
/**
 * The common scale of p_s = G |v|^3 sqrt(A) at 48 kHz (dyn/cm^2 per (cm/s)^3 cm), times
 * sqrt(rate / 48000) elsewhere so the noise's spectral density does not change with the rate.
 * CALIBRATED with the six-stage articulators and the aspiration gains below: DTW distance to
 * CHIMERA over the comparison phrases (docs/VOICE-2.md, "Integration 4").
 */
const GAIN_SCALE = 3e-9;
/**
 * The aspiration source's G, open (no voicing) and in modal voicing; Birkholz's is variable.
 * CALIBRATED: the open value on the breaths between vowels and on /h/ (at 20 the vowels line sat
 * 0.3 dB further from CHIMERA, and with the second pole /θ/ no longer needs it), the voiced one on
 * the vowels' breath noise against CHIMERA, scaled by k^ASPIRATION_VOICED_K: the male line needs 3
 * (at 1 it read 1.1 dB further from CHIMERA), the child's about 1 (at 3, 0.24 dB further).
 */
const G_ASPIRATION = 10;
const G_ASPIRATION_VOICED = 3;
const ASPIRATION_VOICED_K = 3.5;
/**
 * A jet is turbulent only above a critical Reynolds number (Flanagan; CHIMERA takes 1800): a
 * constriction's source fades in over Re 1000 to 2000, Re = v d / nu, d = 2 sqrt(A / pi). MEASURED: a
 * /tʃ/ closure leaking 0.003 cm^2 at 2400 cm/s (Re 1000) carried frication 9 dB under the /s/ for
 * 10 ms; over Re 1800 to 3000 the female /z/ (Re about 2400) fell under its voicing (25.3 dB from the
 * human shape, against 12.7 over 1000 to 2000).
 */
const RE_PER_VSA = (2 / Math.sqrt(Math.PI)) * (AIR_DENSITY / AIR_DYNAMIC_VISCOSITY);
const RE_LO = 1000;
const RE_SPAN = 1 / 1000;
/** v_c's low-pass, Hz (Birkholz 2014). */
const VC_HZ = 500;
/** The slow velocity the voicing modulation is measured against, Hz: under any sung f0. */
const VSLOW_HZ = 25;
/** The source corner, fc = 0.15 v / d (Stevens 1998, p. 104). */
const FC_LINGUAL = 0.15;
/**
 * A second pole at this frequency for every constriction source except the obstacle's share (Shadle
 * 1991: a jet hitting an obstacle is the broadband source; a free jet, a wall or the lower lip falls
 * faster). CALIBRATED against the human recordings: /f/ 6.1 to 2.9 dB from the human shape, /θ/
 * 12.2 to 9.0, Jongman spectral mean error 1.46 to 0.81 kHz; at 2500 Hz /f/ went dull (6.6).
 */
const P2_HZ = 3500;
/** Constriction detection, x k^2 cm^2: under this, and the run's tolerance (Birkholz 2014). */
const CONSTRICTED = 1.0;
const RUN_TOL = 0.2;
/** Separation-to-incisor distances, x k cm: wall/obstacle blend, labiodental blend. */
const D_WALL_LO = 2.0;
const D_WALL_HI = 3.0;
const D_LABIAL = 0.5;
/** Source places, x k cm downstream of separation (wall, labiodental) or above the glottis. */
const WALL_DOWN = 0.25;
const LABIAL_DOWN = 0.15;
const ASPIRATION_AT = 1.5;
/** The convective delay's speed as a fraction of the jet's, and its cap, s (Jackson and Shadle 2000). */
const CONVECT = 0.5;
const TAU_MAX = 0.004;
/** The modulation index's soft limit (Jackson and Shadle 2000: about 0.5 at most). */
const MOD_MAX = 0.5;
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
/**
 * Fraction of a wall's volume velocity radiated through the skin. Birkholz and Zhang (2025) radiate
 * the whole wall flow through the mouth's radiation characteristic; CHIMERA 0.25 (human_airway.rs:86-87).
 * CALIBRATED on the voice bar (docs/VOICE-2.md).
 */
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
  /** Incisors and the pharynx/oral split, fractional grid positions (junction units). */
  teethX = 30;
  /** How far the lower lip forms a constriction at the incisors (0..1): labiodental, not lingual, noise. */
  labial = 0;
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
  /*
   * The turbulence sources over the last block, for measurement (index: constriction slots 0..2, the
   * glottis 3, the velum port 4): the mean of |v_c|^3 sqrt(A) times the closed-area fade (p_s / G
   * before the noise), the mean |v_c| (cm/s), the area read (cm^2), the summed junction weight G and
   * the weighted mean place (junction units; -1 when silent).
   */
  readonly noiseLevel = new Float64Array(NSRC);
  readonly noiseVelocity = new Float64Array(NSRC);
  readonly noiseArea = new Float64Array(NSRC);
  readonly noiseGain = new Float64Array(NSRC);
  readonly noisePlace = new Float64Array(NSRC).fill(-1);

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

  /* ---- Turbulence: slots 0..2 constrictions, SRC_ASP the glottis, SRC_VEL the velum port. ---- */
  /** Each constriction slot's separation junction last block (-1: free), its flow junction and narrowest section. */
  private readonly srcExit = new Int32Array(NSRC).fill(-1);
  private readonly srcUJ = new Int32Array(NSRC);
  private readonly srcSec = new Int32Array(NSRC);
  /**
   * Each constriction slot's commanded area, the least of the run's sections before the area rate law, at the
   * block's start and end, cm^2: the source reads it where it is under the airway's (a closing seal).
   */
  private readonly srcCmd0 = new Float64Array(NSRC);
  private readonly srcCmd1 = new Float64Array(NSRC);
  /** Junction taps per source: junction, weight at the block's start and end (G folded in). */
  private readonly nTap = new Int32Array(NSRC);
  private readonly tapJ = new Int32Array(NSRC * TAPS);
  private readonly tapW0 = new Float64Array(NSRC * TAPS);
  private readonly tapW1 = new Float64Array(NSRC * TAPS);
  /** The velic source's weight, ramped. */
  private velW0 = 0;
  private velW1 = 0;
  private pnV = 0;
  /** Per source: v_c low-passed, the slow mean of its delayed cube, the area low-passed, the noise low-pass state and coefficient. */
  private readonly vF = new Float64Array(NSRC);
  private readonly vS = new Float64Array(NSRC);
  private readonly aF = new Float64Array(NSRC);
  private readonly nL = new Float64Array(NSRC);
  private readonly nL2 = new Float64Array(NSRC);
  private readonly cLp2 = new Float64Array(NSRC).fill(1);
  private readonly cLp = new Float64Array(NSRC);
  /** Block sums of |v_c| and of |v_c|^3 sqrt(A), and the convective delay in samples at the block's start and end. */
  private readonly vAcc = new Float64Array(NSRC);
  private readonly lvAcc = new Float64Array(NSRC);
  private readonly tau0 = new Float64Array(NSRC);
  private readonly tau1 = new Float64Array(NSRC);
  /** Whether a slot modulates with voicing (1) or reads its velocity undelayed and unlimited (0). */
  private readonly modOn = new Float64Array(NSRC);
  private readonly ring = new Float64Array(NSRC * MOD_RING);
  private ringPos = 0;
  /** A place being added (fractional junction), its weight and its share at one junction: fields, so no double crosses a call. */
  private tx = 0;
  private tw = 0;
  private tShare = 0;
  /** The fastest jet the lungs can drive this block, cm/s (Bernoulli, with a margin). */
  private vMax = 0;
  /** Scratch for the detection: runs (lo, hi, narrowest section) and per-slot assignment. */
  private readonly runLo = new Int32Array(3);
  private readonly runHi = new Int32Array(3);
  private readonly runMin = new Int32Array(3);
  private readonly conLo = new Int32Array(3);
  private readonly conHi = new Int32Array(3);
  private readonly runSlot = new Int32Array(3);
  private readonly cVc: number = 0;
  private readonly cVs: number = 0;
  private readonly noiseScale: number = 0;
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
    this.wCm = WALL_TRACT.m * rate - 0.5 * WALL_TRACT.r;
    this.wKs = WALL_TRACT.k;
    this.wIbs = 1 / (WALL_TRACT.m * rate + 0.5 * WALL_TRACT.r);
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
    this.noiseScale = GAIN_SCALE * Math.sqrt(rate / 48000);
    this.cVc = 1 - Math.exp((-2 * Math.PI * VC_HZ) / rate);
    this.cVs = 1 - Math.exp((-2 * Math.PI * VSLOW_HZ) / rate);
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
    this.srcExit.fill(-1);
    this.srcUJ.fill(0);
    this.srcSec.fill(0);
    this.srcCmd0.fill(0);
    this.srcCmd1.fill(0);
    this.nTap.fill(0);
    this.vF.fill(0);
    this.vS.fill(0);
    this.aF.fill(0);
    this.nL.fill(0);
    this.nL2.fill(0);
    this.vAcc.fill(0);
    this.lvAcc.fill(0);
    this.noiseLevel.fill(0);
    this.noiseVelocity.fill(0);
    this.noiseArea.fill(0);
    this.noiseGain.fill(0);
    this.noisePlace.fill(-1);
    this.tau0.fill(0);
    this.tau1.fill(0);
    this.ring.fill(0);
    this.ringPos = 0;
    this.velW0 = this.velW1 = this.pnV = 0;
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
    this.placeSources();
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
    // the rest from the block's start to its end, ramped per step as the pulse ramps its opening
    const rest = this.agSt - chink;
    let r = (rest > 0 ? rest : 0) / L + this.restOffset;
    r = r > 0 ? r : 0;
    const rest0 = this.agSt0 - chink;
    let r0 = (rest0 > 0 ? rest0 : 0) / L + this.restOffset;
    r0 = r0 > 0 ? r0 : 0;
    f.length = L;
    f.chink = chink;
    f.rest1 = r0;
    f.rest2 = r0;
    f.rest1To = r;
    f.rest2To = r;
    f.rampLeft = this.block;
    f.free = 1 - closure;
    // the cycle unit still runs, for its drift and jitter: the servo aims at the drifted pitch, the
    // cycle's period scale perturbs the tension
    this.glottis.processPhase(this.areaBuf, 0, this.block);
    f.servo.target = this.f0 * this.glottis.pitchFactor;
    f.perturb = 1 / this.glottis.scale;
    f.tune();
    // voicing is whether the folds turned within the last 1.6 periods of the target, smoothed as the pulse's
    // gate is (25 Hz). A count of cycles since reset left it at 1 through every voiceless sound after the
    // first cycle: the aspiration kept its quiet voiced gain and its pulsing, and the onset after a
    // voiceless stop rang the tract (MEASURED: a 1.5 kHz tone 15 dB over the pulse's in "twinkle", female)
    const per = this.f0 > 20 ? this.rate / this.f0 : this.rate / 20;
    const on = f.sinceTurn < 1.6 * per ? 1 : 0;
    this.voicing += (1 - Math.exp((-2 * Math.PI * 25 * this.block) / this.rate)) * (on - this.voicing);
  }

  /**
   * Find the constrictions, give each a slot, and set every source's places, spectrum and delay
   * for the block (Birkholz 2014). Integers only cross this call; the doubles are fields.
   */
  private placeSources(): void {
    const pl = this.pLung > 0 ? this.pLung : 0;
    this.vMax = 1.2 * Math.sqrt((2 * pl) / RHO) + 100;
    const k = this.k;
    const k2 = k * k;
    const nG = this.nG;
    const gmn = this.tgtMin;
    const dx = this.dx;
    const rate = this.rate;
    const blk = this.block;
    const tapW0 = this.tapW0;
    const tapW1 = this.tapW1;
    for (let q = 0; q < NSRC; q++) {
      const b = q * TAPS;
      let g = 0;
      let x = 0;
      for (let t = 0; t < this.nTap[q]; t++) {
        g += tapW1[b + t];
        x += tapW1[b + t] * this.tapJ[b + t];
        tapW0[b + t] = tapW1[b + t];
        tapW1[b + t] = 0;
      }
      if (q === SRC_VEL) g = this.velW1;
      this.noiseLevel[q] = this.lvAcc[q] / blk;
      this.noiseVelocity[q] = this.vAcc[q] / blk;
      this.noiseArea[q] = this.aF[q];
      this.noiseGain[q] = g;
      this.noisePlace[q] = q === SRC_VEL ? (g > 0 ? this.jv : -1) : g > 0 ? x / g : -1;
      this.lvAcc[q] = 0;
    }
    // up to three runs apart from each other: the narrowest under 1 k^2 cm^2 and its neighbours within
    // 0.2; a further run must not connect to an earlier one through sections under 1 k^2 cm^2
    const runLo = this.runLo;
    const runHi = this.runHi;
    const conLo = this.conLo;
    const conHi = this.conHi;
    const cut = CONSTRICTED * k2;
    let nr = 0;
    for (let r = 0; r < 3; r++) {
      let mn = CONSTRICTED * k2;
      let mi = -1;
      for (let s = 0; s < nG; s++) {
        const a = gmn[s];
        if (a >= mn) continue;
        let free = true;
        for (let p = 0; p < nr; p++) if (s >= conLo[p] && s <= conHi[p]) free = false;
        if (free) {
          mn = a;
          mi = s;
        }
      }
      if (mi < 0) break;
      const lim = mn + RUN_TOL * k2;
      let lo = mi;
      let hi = mi;
      for (;;) {
        const s = lo - 1;
        if (s < 0 || gmn[s] >= lim) break;
        let free = true;
        for (let p = 0; p < nr; p++) if (s >= conLo[p] && s <= conHi[p]) free = false;
        if (!free) break;
        lo = s;
      }
      for (;;) {
        const s = hi + 1;
        if (s >= nG || gmn[s] >= lim) break;
        let free = true;
        for (let p = 0; p < nr; p++) if (s >= conLo[p] && s <= conHi[p]) free = false;
        if (!free) break;
        hi = s;
      }
      runLo[nr] = lo;
      runHi[nr] = hi;
      this.runMin[nr] = mi;
      while (lo > 0 && gmn[lo - 1] < cut) lo--;
      while (hi < nG - 1 && gmn[hi + 1] < cut) hi++;
      conLo[nr] = lo;
      conHi[nr] = hi;
      nr++;
    }
    // each run keeps the slot whose separation point was nearest (within 3 sections), else a free one
    let used = 0;
    for (let r = 0; r < nr; r++) {
      const exit = runHi[r] + 1;
      let best = -1;
      let bd = 4;
      for (let q = 0; q < 3; q++) {
        if ((used >> q) & 1 || this.srcExit[q] < 0) continue;
        const d = this.srcExit[q] > exit ? this.srcExit[q] - exit : exit - this.srcExit[q];
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      if (best < 0) for (let q = 0; q < 3 && best < 0; q++) if (!((used >> q) & 1) && this.srcExit[q] < 0 && this.nTap[q] === 0) best = q;
      if (best < 0) for (let q = 0; q < 3 && best < 0; q++) if (!((used >> q) & 1) && this.srcExit[q] < 0) best = q;
      if (best < 0) for (let q = 0; q < 3 && best < 0; q++) if (!((used >> q) & 1)) best = q;
      used |= 1 << best;
      this.runSlot[r] = best;
    }
    for (let q = 0; q < 3; q++) if (!((used >> q) & 1)) this.srcExit[q] = -1;
    for (let r = 0; r < nr; r++) {
      const q = this.runSlot[r];
      const mi = this.runMin[r];
      const exit = runHi[r] + 1;
      const a = gmn[mi];
      const fresh = this.nTap[q] === 0;
      if (fresh) this.freshSource(q, mi);
      this.srcExit[q] = exit;
      // the flow through the narrowest section itself, where the kinetic loss holds it to A sqrt(2 dp / rho); read
      // further on, a sealed section's v = U / A took the flow the cavity in between pumps (MEASURED: frication
      // at a /d/ closure as loud as the /s/)
      this.srcUJ[q] = mi + 1;
      this.srcSec[q] = mi;
      // the area the articulators command, before the rate law holds a closing seal open
      let cmd = 1e9;
      for (let s = conLo[r]; s <= conHi[r]; s++) if (this.gridMin[s] < cmd) cmd = this.gridMin[s];
      this.srcCmd0[q] = fresh ? cmd : this.srcCmd1[q];
      this.srcCmd1[q] = cmd;
      // D, the separation point to the incisors, x k cm
      const dk = ((this.teethX - exit) * dx) / k;
      // labiodental where the lower lip forms it at or past the incisors (/f v/); a tongue there (/θ/) keeps the
      // obstacle source; a constriction whose narrowest section lies past the incisors is the lips' (rounding)
      let lab = dk / D_LABIAL;
      lab = lab <= 0 ? 1 : lab >= 1 ? 0 : 1 - lab * lab * (3 - 2 * lab);
      const lip = this.labial < 0 ? 0 : this.labial > 1 ? 1 : this.labial;
      let past = mi + 1 - this.teethX;
      past = past <= 0 ? 0 : past >= 1 ? 1 : past * past * (3 - 2 * past);
      const labio = lab * lip;
      const lips = (1 - labio) * past;
      lab = labio + lips;
      let wf = (dk - D_WALL_LO) / (D_WALL_HI - D_WALL_LO);
      wf = wf < 0 ? 0 : wf > 1 ? 1 : wf * wf * (3 - 2 * wf);
      // an obstacle needs the incisors downstream of separation: a jet that separates at or past their
      // edge (the dental /θ/) blows into free air, a wall-type source with nothing ahead of it
      let ob = dk / D_FREE;
      ob = ob <= 0 ? 0 : ob >= 1 ? 1 : ob * ob * (3 - 2 * ob);
      this.tx = exit + (WALL_DOWN * k) / dx;
      this.tw = (1 - lab) * (wf * G_WALL + (1 - wf) * (1 - ob) * G_FREE);
      this.addAt(q);
      this.tx = this.teethX;
      this.tw = (1 - lab) * (1 - wf) * ob * G_OBSTACLE;
      this.addAt(q);
      this.tx = exit + (LABIAL_DOWN * k) / dx;
      this.tw = labio * G_LABIAL + lips * G_LIPS;
      this.addAt(q);
      const v = this.vAcc[q] / blk;
      const d = 2 * Math.sqrt((a > 1e-4 ? a : 1e-4) / Math.PI);
      let fc = (FC_LINGUAL * v) / d;
      fc = fc < 200 ? 200 : fc > 0.45 * rate ? 0.45 * rate : fc;
      this.cLp[q] = 1 - Math.exp((-2 * Math.PI * fc) / rate);
      // the obstacle's share keeps its single corner (Shadle 1991: an obstacle source is broadband); a free
      // jet, a wall and the lower lip fall a second order above P2_HZ
      const wo = (1 - lab) * (1 - wf) * ob;
      let f2 = P2_HZ * Math.exp(wo * Math.log((0.45 * rate) / P2_HZ));
      f2 = f2 > 0.45 * rate ? 0.45 * rate : f2;
      this.cLp2[q] = 1 - Math.exp((-2 * Math.PI * f2) / rate);
      // the convective delay from the separation point to where the source sits
      const dObs = dk > 0 ? dk * k : 0;
      const ds = (1 - lab) * (wf * WALL_DOWN * k + (1 - wf) * (ob * dObs + (1 - ob) * WALL_DOWN * k)) + lab * LABIAL_DOWN * k;
      let tau = v > 1 ? ds / (CONVECT * v) : TAU_MAX;
      tau = (tau < TAU_MAX ? tau : TAU_MAX) * rate;
      this.tau0[q] = this.tau1[q];
      this.tau1[q] = tau;
      this.modOn[q] = 1;
    }
    // aspiration, 1.5 k cm above the glottis (at the duct's end when the duct is longer)
    {
      const q = SRC_ASP;
      if (this.nTap[q] === 0) this.freshSource(q, 0);
      let x = (ASPIRATION_AT * k - this.ductLen) / dx;
      x = x < 0 ? 0 : x > nG ? nG : x;
      this.tx = x;
      // Birkholz's aspiration gain is variable (0.005 to 0.5 of the others): less in modal voicing
      const vo = this.voicing;
      this.tw = G_ASPIRATION * (1 - vo) + G_ASPIRATION_VOICED * Math.pow(k, ASPIRATION_VOICED_K) * vo;
      this.addAt(q);
      const ga = this.agMean > 1e-4 ? this.agMean : 1e-4;
      let fc = (FC_LINGUAL * (this.vAcc[q] / blk)) / (2 * Math.sqrt(ga / Math.PI));
      fc = fc < 200 ? 200 : fc > 0.45 * rate ? 0.45 * rate : fc;
      this.cLp[q] = 1 - Math.exp((-2 * Math.PI * fc) / rate);
      this.modOn[q] = 0;
    }
    // the velic source while the port is a constriction
    {
      const q = SRC_VEL;
      const vel = this.velum;
      this.velW0 = this.velW1;
      // a jet into the nasal cavity with no obstacle ahead: a wall source
      this.velW1 = vel > CLOSED && vel < CONSTRICTED * k2 ? G_WALL : 0;
      if (this.velW0 === 0 && this.velW1 > 0) this.freshSource(q, 0);
      const d = 2 * Math.sqrt((vel > 1e-4 ? vel : 1e-4) / Math.PI);
      let fc = (FC_LINGUAL * (this.vAcc[q] / blk)) / d;
      fc = fc < 200 ? 200 : fc > 0.45 * rate ? 0.45 * rate : fc;
      this.cLp[q] = 1 - Math.exp((-2 * Math.PI * fc) / rate);
      this.modOn[q] = 0;
    }
    for (let q = 0; q < NSRC; q++) this.vAcc[q] = 0;
    // drop taps that are silent at both ends
    for (let q = 0; q < NSRC; q++) {
      const b = q * TAPS;
      let n = 0;
      for (let t = 0; t < this.nTap[q]; t++) {
        if (tapW0[b + t] === 0 && tapW1[b + t] === 0) continue;
        this.tapJ[b + n] = this.tapJ[b + t];
        tapW0[b + n] = tapW0[b + t];
        tapW1[b + n] = tapW1[b + t];
        n++;
      }
      this.nTap[q] = n;
    }
  }

  /** A source starting from silence: clear its filters and its delay ring; its area from section s. */
  private freshSource(q: number, s: number): void {
    this.vF[q] = 0;
    this.vS[q] = 0;
    this.nL[q] = 0;
    this.nL2[q] = 0;
    this.aF[q] = q < 3 ? this.tgtMin[s] : q === SRC_ASP ? this.ag : this.velum > 1e-4 ? this.velum : 1e-4;
    this.tau0[q] = this.tau1[q] = 0;
    this.ring.fill(0, q * MOD_RING, (q + 1) * MOD_RING);
  }

  /** Place source q's weight `tw` at fractional junction `tx`, split linearly between the two junctions there. */
  private addAt(q: number): void {
    const w = this.tw;
    if (!(w > 0)) return;
    const nG = this.nG;
    let x = this.tx;
    x = x < 0 ? 0 : x > nG ? nG : x;
    const j = Math.floor(x);
    const f = x - j;
    this.tShare = 1 - f;
    this.addTap(q, j);
    if (f > 0 && j < nG) {
      this.tShare = f;
      this.addTap(q, j + 1);
    }
  }

  /** Add tw times tShare to source q's tap at junction j. */
  private addTap(q: number, j: number): void {
    const b = q * TAPS;
    const n = this.nTap[q];
    const add = this.tw * this.tShare;
    for (let t = 0; t < n; t++)
      if (this.tapJ[b + t] === j) {
        this.tapW1[b + t] += add;
        return;
      }
    if (n >= TAPS) return;
    this.tapJ[b + n] = j;
    this.tapW0[b + n] = 0;
    this.tapW1[b + n] = add;
    this.nTap[q] = n + 1;
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
    const ring = this.ring;
    const tapJ = this.tapJ;
    const tapW0 = this.tapW0;
    const tapW1 = this.tapW1;
    const cVc = this.cVc;
    const cVs = this.cVs;
    const noiseScale = this.noiseScale;
    const voi = this.voicing;
    const vMax = this.vMax;
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
      // turbulence from last sample's flows: p_s = G |v_c|^3 sqrt(A), in series where each source sits
      const rp = this.ringPos;
      for (let q = 0; q < NSRC; q++) {
        const nt = this.nTap[q];
        const vel = q === SRC_VEL;
        if (nt === 0 && !(vel && (this.velW0 > 0 || this.velW1 > 0))) continue;
        let u: number;
        let a: number;
        // the source's area: the airway's, or the commanded one where that is less
        let as: number;
        if (q < 3) {
          u = U[this.srcUJ[q]];
          a = aMin[this.srcSec[q]];
          if (a > area[this.srcSec[q]]) a = area[this.srcSec[q]];
          as = this.srcCmd0[q] + (this.srcCmd1[q] - this.srcCmd0[q]) * w;
          if (as > a) as = a;
        } else if (q === SRC_ASP) {
          u = this.uG;
          a = ag;
          as = a;
        } else {
          u = this.uV;
          a = this.velNow;
          as = a;
        }
        // a section at the closed area is shut: its floor's leak is numerical, not a jet (MEASURED: read as one, a
        // /t/ closure carried frication 30 dB over CHIMERA's silence); the source fades in to 5 times that area.
        // The area rate law closes the last 0.4 cm^2 slowly so a seal does not click; the source reads the
        // commanded area there, or that dwell was a fricative (MEASURED: 10 to 20 ms at the vowel's level
        // before each /t tʃ/ closure, -2 dB re the phrase for the male /tʃ/, CHIMERA -23 to -32)
        let shut = (as - 2e-4) * 1250;
        shut = q === SRC_ASP ? 1 : shut <= 0 ? 0 : shut >= 1 ? 1 : shut * shut * (3 - 2 * shut);
        if (a < 1e-4) a = 1e-4;
        if (as < 1e-4) as = 1e-4;
        const af = this.aF[q] + cVc * (as - this.aF[q]);
        this.aF[q] = af;
        // no jet outruns the lungs: the flow and the area it reads can disagree for a sample as a section seals
        let vr = u / a;
        vr = vr > vMax ? vMax : vr < -vMax ? -vMax : vr;
        const vf = this.vF[q] + cVc * (vr - this.vF[q]);
        this.vF[q] = vf;
        const av = vf < 0 ? -vf : vf;
        this.vAcc[q] += av;
        // the convective delay, read linearly between ring samples
        const rb = q * MOD_RING;
        ring[rb + rp] = av;
        const td = this.tau0[q] + (this.tau1[q] - this.tau0[q]) * w;
        const ti = td | 0;
        const tf = td - ti;
        const vd = ring[rb + ((rp - ti) & (MOD_RING - 1))] * (1 - tf) + ring[rb + ((rp - ti - 1) & (MOD_RING - 1))] * tf;
        let lev = vd * vd * vd;
        const s3 = this.vS[q] + cVs * (lev - this.vS[q]);
        this.vS[q] = s3;
        // in voicing the pulsing about the slow level is soft-limited to an index near MOD_MAX
        const mw = this.modOn[q] * voi;
        if (mw > 0) {
          let m = s3 > 1 ? lev / s3 - 1 : 0;
          m = m / (1 + (m < 0 ? -m : m) * (1 / MOD_MAX));
          lev = (1 - mw) * lev + mw * s3 * (1 + m);
        }
        // mulberry32, inline: uniform in [0, 1)
        let s = (this.seed + 0x6d2b79f5) | 0;
        this.seed = s;
        s = Math.imul(s ^ (s >>> 15), s | 1);
        s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
        const wv = ((((s ^ (s >>> 14)) >>> 0) / 4294967296) * 2 - 1) * 1.7320508075688772;
        const nl1 = this.nL[q] + this.cLp[q] * (wv - this.nL[q]);
        this.nL[q] = nl1;
        const nl2 = this.nL2[q] + this.cLp2[q] * (nl1 - this.nL2[q]);
        this.nL2[q] = nl2;
        const nl = nl2;
        // the dipole's sign follows the flow's, continuously through zero
        const sa = Math.sqrt(af);
        // a jet is turbulent only above the critical Reynolds number: Re = v d / nu, d = 2 sqrt(A / pi)
        let tu = (av * sa * RE_PER_VSA - RE_LO) * RE_SPAN;
        tu = q === SRC_ASP ? 1 : tu <= 0 ? 0 : tu >= 1 ? 1 : tu * tu * (3 - 2 * tu);
        const ls = shut * tu * lev * sa;
        this.lvAcc[q] += ls;
        const v = (noiseScale * ls * nl * vf) / (av + 1);
        if (vel) {
          this.pnV = v * (this.velW0 + (this.velW1 - this.velW0) * w);
          continue;
        }
        const b = q * TAPS;
        for (let t = 0; t < nt; t++) pn[tapJ[b + t]] += v * (tapW0[b + t] + (tapW1[b + t] - tapW0[b + t]) * w);
      }
      this.ringPos = (rp + 1) & (MOD_RING - 1);
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
      for (let q = 0; q < SRC_VEL; q++) {
        const b = q * TAPS;
        for (let t = 0; t < this.nTap[q]; t++) pn[tapJ[b + t]] = 0;
      }
      this.pnV = 0;
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
      const cv0 = zl * p0 - 2 * c3 + m0 * this.rate + this.pnV;
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
