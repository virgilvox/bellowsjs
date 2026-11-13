/*
 * Vocal: a singing voice built as an articulatory synthesizer. A sung
 * line's phonemes move CHIMERA's 17 articulators, CHIMERA's exact geometry
 * turns them into the tract's shape, and the junction airway (a waveguide
 * that carries the air itself: pressure behind closures, bursts, voice bars
 * and turbulence all come out of its flow) makes the sound.
 * docs/VOICE-2.md is the design and the measurements behind it.
 *
 * Learned from CHIMERA by Jameson Hodge (MIT,
 * https://github.com/jamesondh/chimera-vocal-synth at 1d3ea49): the
 * articulators and their speeds (control/articulators.rs), the planner
 * (phonetics/planner.rs, engines/vocal-planner.ts), the geometry
 * (anatomy/human.rs, engines/vocal-geometry.ts), the airway's elements
 * (airway/network.rs, voice/human_airway.rs, dsp/junction-airway.ts), the
 * contact rule (voice/human_voice.rs:520-552) and the sung breath
 * (phonetics/planner.rs:376-379). Reimplemented here; see
 * THIRD_PARTY_NOTICES.md. The singer rules come from the literature: pitch
 * overshoot and preparation (Saitou, Unoki and Akagi 2005), the singer's
 * formant (Sundberg), first-resonance tuning on high notes (Joliveau,
 * Smith and Wolfe 2004). So do the parts that replaced CHIMERA's: the
 * articulators move as a six-stage cascade with return gestures (Birkholz
 * 2011, Birkholz and Hoole 2012, VocalTractLab 2.4's manual); the pitch
 * rise after a voiceless obstruent is a fold stiffness gesture (Hanson
 * 2009); the two fold models follow Titze and Birkholz, Drechsel and Stone
 * (2019) and Ishizaka and Flanagan (1972); the turbulence follows Stevens'
 * law with Birkholz's (2014) source types and places; the tract wall is
 * Birkholz and Zhang's (2025) stiffness and damping. docs/VOICE-2.md,
 * "Integration 4", measures them together.
 *
 * THE LAYERS, AND HOW OFTEN EACH RUNS (48 kHz)
 *
 *   planner      every 64 samples: gestures to articulator targets
 *   articulators every 64: a six-stage cascade bank, then the contacts
 *   geometry     every 512 (a keyframe): the exact shape, rate limited
 *   drive        every 32: the shape between keyframes onto the grid
 *   pitch        every 32: glide, vibrato, microprosody, pressure
 *   airway       every sample
 *
 * The grids scale with the rate (block = 32 samples at 48 kHz, the
 * articulators every 2 blocks, the geometry every 16). The articulators
 * run to the end of each keyframe interval before it is heard, and the
 * glottal opening they set is read back at each block's own time, so no
 * layer leads the sound.
 *
 * EVENTS. `phoneme` starts a sound now. `nextPhoneme` says a sound will
 * start `nextIn` seconds from now (post `nextIn` first, then
 * `nextPhoneme`): the planner then starts its gestures before the sound
 * (a stop closes 22 to 31 ms early, a nasal lowers the velum 20 ms early,
 * the next vowel ramps in through the consonants before it) and releases a
 * closure before the next sound, as CHIMERA plans a whole utterance.
 * src/sing.ts posts every sound VOCAL_PLAN_LEAD ahead this way and then
 * again on its time as `phoneme`, which confirms it; a `phoneme` alone
 * still works, with gestures that start when it arrives. `bend` moves the
 * pitch through the glide; sing() posts it vocalGlideLead() early so the
 * glide is half way at the note.
 *
 * A note-on starts from rest: the planner's targets for the opening sound
 * are snapped to, the breath starts at 94 percent of its pressure (where
 * CHIMERA's sung breath, opening 70 ms before the first sound, is when it
 * sounds), every wave and state is cleared, so a reused voice equals a
 * fresh one. Events at the note-on's instant, before any sample, snap the
 * same way. A released voice keeps the sound it was released on.
 *
 * PARAMETERS THAT CHANGED MEANING FROM THE FORMANT VOICE
 *
 *   glide     the time scale of a pitch change: the glide's natural
 *             frequency is 5.834 / (2 pi glide) Hz (98 percent in `glide`
 *             at overshoot 0). Default 0.17 s, about 5.5 Hz, which with
 *             the default overshoot puts a note change half way 46 ms in.
 *   tension   the glottal pulse's tension at velocity 0.8; velocity adds
 *             0.35 per unit above 0.8. Default 0.55.
 *   breath    CHIMERA's breathiness: the glottis rests open by
 *             0.1 breath^2 k^2 cm^2 plus a chink of (0.008 + 0.03 breath)
 *             k^2, and aspiration follows from the flow through it.
 *   body      continuous from 0 (male) through 1 (female) to 2 (child):
 *             targets, tables and the geometry's body constants blend
 *             between neighbours. The airway's layout is set at note-on.
 *   articulation  multiplies every articulator's speed.
 *   velocity  sets lung pressure, 4 + 6.25 vel cmH2O held to 5 to 15
 *             (9 at 0.8, CHIMERA's default), so a louder note is also
 *             brighter and more pressed. It scales the output only under
 *             0.2, linearly to silence at 0.
 *
 * NEW: overshoot (fraction of an interval the glide passes its note by),
 * preparation (how far it first moves the wrong way), ring (the singer's
 * formant: epilarynx narrowed, larynx lowered, tongue root forward),
 * tuning (open the jaw so the first resonance stays above 1.15 f0),
 * nextPhoneme and nextIn (above), glottis (the fold model: 0 geometric,
 * dsp/geometric-glottis.ts; 1 self-oscillating, dsp/fold-oscillator.ts;
 * 2 CHIMERA's drawn pulse, the default; a sounding voice changes at its
 * next note; docs/VOICE-2.md, "Vocal folds", has the measurements).
 *
 * Randomness: forks 'glottis' and 'noise' (in the airway: the fold pulse's
 * perturbations, and one turbulence seed drawn per note) and 'vibrato' (the
 * vibrato's starting phase, drawn per note).
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { CRITDAMP_SETTLE_98 } from '../dsp/critdamp';
import { CascadeBank } from '../dsp/cascade';
import { PitchGlide } from '../dsp/pitchglide';
import { Adsr } from '../dsp/envelopes';
import { CM_H2O, SOUND_SPEED } from '../dsp/air';
import { GLOTTIS_GEOMETRIC, GLOTTIS_PULSE, GLOTTIS_SELF_OSCILLATING, JunctionAirway, ductMin } from '../dsp/junction-airway';
import { VOCAL_DEFAULT_PHONEME, VOCAL_PHONEMES } from './vocal-phonemes';
import { VOCAL_BODIES, VOCAL_NEUTRAL } from './vocal-tables.gen';
import { ART, ARTICULATORS } from './vocal-articulators';
import { ARTICULATOR_MAX, ARTICULATOR_RATE, ARTICULATOR_TARGET_MIN, LIP_COMPRESSED, VocalPlanner, restTipFrom } from './vocal-planner';
import { VocalRoof } from './vocal-roof';
import { VOCAL_KEY_BLOCKS, VocalDrive } from './vocal-drive';

const PHONEMES = VOCAL_PHONEMES.length;

/** How far ahead src/sing.ts posts each sound as `nextPhoneme`, seconds. */
export const VOCAL_PLAN_LEAD = 0.3;

/** The largest jaw opening the tuning rule uses (template cm). */
const OPEN_MAX = 1.5;
/**
 * f0 raised by full fold stiffness, cents: the planner's cricothyroid gesture after a voiceless
 * obstruent (Hanson 2009). The size of the explicit rise it replaced (MEASURED choice).
 */
const STIFF_CENTS = 60;
/** How much full stiffness narrows the geometric folds' swing (x_rel; Birkholz et al. 2019: under 1 is stiffening). CHOICE. */
const STIFF_SWING = 0.25;
/** f0 change per cmH2O of transglottal pressure away from the lungs', Hz at 120 Hz (MEASURED choice). */
const COUPLE = 1.5;
/**
 * The singer's ear, for the geometric folds: their pressure term is taken against its own average
 * over this many seconds, so a closure's quick dip stays and the steady pressure a vowel holds above
 * the folds is sung away. CHOICE; without it the geometric folds sang held notes 2 to 7 cents flat
 * on average (MEASURED; docs/VOICE-2.md, "Vocal folds").
 */
const EAR_TAU = 0.25;

/*
 * The folds per table body (male, female, child): rest length L0 cm (Birkholz, Drechsel and Stone
 * 2019: 1.6 and 1.2; the child's INFERRED), and the paper's most natural settings, male then female:
 * the lower edge's rest displacement (0.3 and 0.6 mm), the upper edge's over it (0.3 and 0 mm), the
 * phase lag between the edges (70 and 50 degrees) and double pulsing (0.05). The child takes the
 * female's. Skewness is 0.3 for all, inside the paper's tested range (-0.4 to 0.4; its best were 0
 * and 0.2): CALIBRATED, the setting whose vowel band levels came closest to CHIMERA's (0 left the
 * male 1.5 to 4 kHz 6 dB over it, 0.3 within 2.5 dB; docs/VOICE-2.md, "Vocal folds").
 */
const FOLD_LENGTH = [1.6, 1.2, 0.9];
const FOLD_REST = [0.03, 0.06, 0.06];
/** The self-oscillating folds' rest displacement, cm: a wider glottis than this stops them above about 600 Hz (MEASURED). */
const SELF_REST = 0.01;
const FOLD_UPPER = [0.03, 0, 0];
const FOLD_LAG = [70 / 360, 50 / 360, 50 / 360];
const FOLD_SKEW = [0.3, 0.3, 0.3];
const FOLD_DOUBLE = 0.05;
/** Medial compression per unit of tension away from 0.5, cm of rest displacement (pressed closes, lax opens). CHOICE. */
const PRESS = 0.04;
/** Output gain over CHIMERA's: puts the loudest held vowel near 1 at velocity 1. */
const OUTPUT_GAIN = 0.25;
/** CHIMERA's vibrato ramps out over this many seconds. */
const VIBRATO_FADE = 0.06;
const MIN_HZ = 20;
/** Articulator steps per keyframe. */
const STEPS = VOCAL_KEY_BLOCKS / 2;
/** CHIMERA's geometry body constants per table body (human.rs:276-278). */
const LIP_WIDTH = [4.6, 4.4, 4.0];

/** Damping for an overshoot fraction of a step without preparation: the inverse of exp(-pi zeta / sqrt(1 - zeta^2)). */
export function vocalDamping(overshoot: number): number {
  const os = overshoot > 0 ? (overshoot < 0.6 ? overshoot : 0.6) : 0;
  if (!(os > 1e-6)) return 1;
  const l = Math.log(os);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
}

/** The glide's natural frequency for a `glide` time, Hz. */
export function vocalGlideSpeed(glide: number): number {
  const g = clamp(glide, 0.005, 0.5);
  return CRITDAMP_SETTLE_98 / (2 * Math.PI * g);
}

/**
 * Seconds a pitch change takes to be half way, for a channel's glide,
 * overshoot and preparation (the engine's defaults where undefined): post a
 * bend this much early and the glide crosses the middle on the note.
 */
export function vocalGlideLead(glide?: number, overshoot?: number, preparation?: number): number {
  const g = new PitchGlide(1000);
  g.setSpeed(vocalGlideSpeed(Number.isFinite(glide) ? (glide as number) : DEFAULTS.glide));
  g.setDamping(vocalDamping(Number.isFinite(overshoot) ? (overshoot as number) : DEFAULTS.overshoot));
  g.setPreparation(clamp(Number.isFinite(preparation) ? (preparation as number) : DEFAULTS.preparation, 0, 1));
  return g.leadTime();
}

const DEFAULTS = { glide: 0.17, overshoot: 0.095, preparation: 0.25 };

function initial(params: Record<string, number>, spec: ParamSpec): number {
  const v = params[spec.name];
  return typeof v === 'number' && Number.isFinite(v) ? v : spec.default;
}

/** Grid sections for a shortest tract of minLength cm at a rate. */
function gridSections(rate: number, minLength: number): number {
  const dx = SOUND_SPEED / (2 * rate);
  return Math.max(8, Math.floor((minLength - ductMin(rate)) / dx));
}

class VocalVoice implements Voice {
  private readonly sr: number = 0;
  private readonly air: JunctionAirway;
  private readonly drive: VocalDrive;
  private readonly roofs: VocalRoof[];
  private readonly planner = new VocalPlanner();
  private readonly bank: CascadeBank;
  private readonly glide: PitchGlide;
  private readonly env: Adsr;
  private readonly vibRng: NamedRng;
  private readonly blk: number = 0;
  private readonly stepEvery: number = 0;
  private readonly keyEvery: number = 0;
  private readonly envBuf: Float32Array;

  /* Scratch. */
  private readonly art = new Float64Array(ARTICULATORS);
  private readonly tip = new Float64Array(2);
  private readonly rate = new Float64Array(ARTICULATORS);
  /** The glottal opening and closure at each articulator step of the keyframe interval (0 is its start). */
  private readonly abdAt = new Float64Array(STEPS + 1);
  private readonly cloAt = new Float64Array(STEPS + 1);
  private readonly stfAt = new Float64Array(STEPS + 1);
  /** A contact's new position for each axis (x then y), for CascadeBank.placeFrom. */
  private readonly placed = new Float64Array(2);
  /** The time of the articulator step or block being computed, s (a field: no double crosses a call). */
  private at = 0;

  /* Parameters. */
  private phonemeParam = VOCAL_DEFAULT_PHONEME;
  private bendParam = 0;
  private body = 0;
  private tension = 0.55;
  private breath = 0.15;
  private vibInc = 0;
  private vibDepth = 0.3;
  private vibDelay = 0.25;
  private articulation = 1;
  private attack = 0.02;
  private release = 0.15;
  private level = 1;
  private ring = 0;
  private tuning = 0;
  private nextIn = 0;

  /* Note. */
  private live = false;
  private fresh = false;
  private released = false;
  private noteHz = 220;
  private vel = 0.8;
  /** Samples since note-on, and the current block's position. */
  private pos = 0;
  private bi = 0;
  /** Samples left in the keyframe interval, and blocks begun in it. */
  private intervalLeft = 0;
  private blockInInterval = 0;
  private end = Infinity;
  private pLungTarget = 9;
  /** Lung pressure, cmH2O. */
  private pLung = 0;
  private pCoupleHz = 0;
  /** The pressure above the folds as the singer has adapted to it, dyn/cm^2 (geometric folds). */
  private pEar = 0;


  /* Body blend in force. */
  private bLo = 0;
  private bW = 0;
  private k = 1;

  /* Pitch. */
  private vibPhase = 0;
  private bloomT = 0;
  private bloomFrom = 0;
  private bloomNow = 0;
  private tuneJaw = 0;
  private abduction = 0;
  private closure = 0;
  private stiffness = 0;
  private foldRest = 0.03;
  private glottisModel = GLOTTIS_PULSE;
  private f0Now = 110;
  private depth = 0;
  /* The layout and geometry body last laid out (-1: none). */
  private laidK = -1;
  private laidN = -1;
  private laidJv = -1;
  private laidGeoK = -1;
  private laidPh = -1;
  private laidTongue = -1;
  private laidLips = -1;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sr = sampleRate;
    this.roofs = VOCAL_BODIES.map((t) => new VocalRoof(t));
    this.air = new JunctionAirway(sampleRate, gridSections(sampleRate, VOCAL_BODIES[0].minLength), rng);
    this.drive = new VocalDrive(sampleRate);
    this.blk = this.air.block;
    this.stepEvery = 2 * this.blk;
    this.keyEvery = VOCAL_KEY_BLOCKS * this.blk;
    this.bank = new CascadeBank(ARTICULATORS, sampleRate / this.stepEvery);
    this.glide = new PitchGlide(sampleRate / this.blk);
    this.env = new Adsr(sampleRate);
    this.vibRng = rng.fork('vibrato');
    this.envBuf = new Float32Array(this.blk);
    this.bi = this.blk;
    for (const spec of PARAMS) this.setParam(spec.name, initial(params, spec));
  }

  noteOn(freq: number, vel: number): void {
    this.noteHz = clamp(Number.isFinite(freq) ? freq : 220, MIN_HZ, this.sr * 0.25);
    this.vel = clamp(Number.isFinite(vel) ? vel : 0.8, 0, 1);
    this.live = true;
    this.fresh = true;
    this.released = false;
    this.end = Infinity;
    this.env.reset();
    this.env.trigger();
    this.vibPhase = this.vibRng();
    this.bloomT = 0;
    this.bloomFrom = 0;
    this.bloomNow = 0;
    this.start();
  }

  noteOff(): void {
    if (!this.live || this.released) return;
    this.released = true;
    this.env.release();
    this.end = this.pos / this.sr;
    this.planner.setEnd(this.end);
  }

  get active(): boolean {
    return this.live;
  }

  setParam(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    switch (name) {
      case 'phoneme':
        this.setPhoneme(value);
        return;
      case 'nextIn':
        this.nextIn = clamp(value, 0, 1);
        return;
      case 'nextPhoneme':
        this.setNext(value);
        return;
      case 'bend':
        this.setBend(value);
        return;
      case 'glide':
        this.glide.setSpeed(vocalGlideSpeed(value));
        return;
      case 'overshoot':
        this.glide.setDamping(vocalDamping(clamp(value, 0, 0.5)));
        return;
      case 'preparation':
        this.glide.setPreparation(clamp(value, 0, 1));
        return;
      case 'body':
        this.body = clamp(value, 0, 2);
        this.applyBody();
        if (this.live && this.fresh) this.start();
        return;
      case 'tension':
        this.tension = clamp(value, 0, 1);
        this.applyTension();
        return;
      case 'roughness':
        this.air.glottis.setRoughness(clamp(value, 0, 1));
        return;
      case 'fry':
        this.air.glottis.setFry(clamp(value, 0, 1));
        return;
      case 'drift':
        this.air.glottis.setDrift(clamp(value, 0, 20));
        return;
      case 'glottis':
        this.setGlottis(value);
        return;
      case 'breath':
        this.breath = clamp(value, 0, 1);
        return;
      case 'vibratoRate':
        this.vibInc = (clamp(value, 0, 12) * this.blk) / this.sr;
        return;
      case 'vibratoDepth':
        this.vibDepth = clamp(value, 0, 2);
        return;
      case 'vibratoDelay':
        this.vibDelay = clamp(value, 0, 1);
        return;
      case 'articulation':
        this.articulation = clamp(value, 0.25, 4);
        return;
      case 'attack':
        this.attack = clamp(value, 0.001, 1);
        this.env.set(this.attack, 0.05, 1, this.release);
        return;
      case 'release':
        this.release = clamp(value, 0.01, 2);
        this.env.set(this.attack, 0.05, 1, this.release);
        return;
      case 'level':
        this.level = clamp(value, 0, 2);
        return;
      case 'ring':
        this.ring = clamp(value, 0, 1);
        return;
      case 'tuning':
        this.tuning = clamp(value, 0, 1);
        return;
    }
  }

  /** 0 geometric, 1 self-oscillating, 2 the parametric pulse; a voice that is sounding changes at its next note. */
  private setGlottis(value: number): void {
    const m = clamp(Math.round(value), 0, 2);
    this.glottisModel = m === 1 ? GLOTTIS_SELF_OSCILLATING : m === 2 ? GLOTTIS_PULSE : GLOTTIS_GEOMETRIC;
    if (!this.live) this.air.model = this.glottisModel;
    this.applyTension();
  }

  private setPhoneme(value: number): void {
    const idx = clamp(Math.round(value), 0, PHONEMES - 1);
    this.phonemeParam = idx;
    if (!this.live || this.released) return;
    if (this.fresh) this.start();
    else this.planner.addNow(idx, this.pos / this.sr);
  }

  private setNext(value: number): void {
    const idx = clamp(Math.round(value), 0, PHONEMES - 1);
    if (!this.live || this.released) return;
    this.planner.addUpcoming(idx, this.pos / this.sr + this.nextIn);
    if (this.fresh) this.settle();
  }

  private setBend(value: number): void {
    const b = clamp(value, -48, 48);
    this.bendParam = b;
    if (!this.live || this.released) return;
    if (this.fresh) this.glide.snap(b);
    else if (b !== this.glide.target) {
      this.glide.setTarget(b);
      this.bloomFrom = this.bloomNow;
      this.bloomT = 0;
    }
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const air = this.air;
    const blk = this.blk;
    let i = from;
    while (i < to) {
      if (this.bi === blk) {
        if (this.intervalLeft === 0) this.interval();
        this.beginBlock();
        this.bi = 0;
      }
      const left = blk - this.bi;
      const n = left < to - i ? left : to - i;
      const eb = this.envBuf;
      this.env.fill(eb, 0, n);
      air.render(outL, outR, i, n, this.bi, eb);
      this.bi += n;
      this.pos += n;
      this.intervalLeft -= n;
      i += n;
    }
    if (to > from) this.fresh = false;
    if (!this.env.active) this.live = false;
  }

  /* ---------------------------------------------------------------- */
  /* Note start                                                        */
  /* ---------------------------------------------------------------- */

  private applyBody(): void {
    const b = this.body;
    this.bLo = Math.floor(b) < 2 ? Math.floor(b) : 1;
    this.bW = b - this.bLo;
    const A = VOCAL_BODIES[this.bLo];
    const B = VOCAL_BODIES[this.bLo + 1];
    const w = this.bW;
    this.k = A.k * (1 - w) + B.k * w;
    this.planner.setBody(b);
    const lo = this.bLo;
    const air = this.air;
    air.foldLength = FOLD_LENGTH[lo] * (1 - w) + FOLD_LENGTH[lo + 1] * w;
    air.upperRest = FOLD_UPPER[lo] * (1 - w) + FOLD_UPPER[lo + 1] * w;
    air.lag = FOLD_LAG[lo] * (1 - w) + FOLD_LAG[lo + 1] * w;
    air.skew = FOLD_SKEW[lo] * (1 - w) + FOLD_SKEW[lo + 1] * w;
    air.doublePulse = FOLD_DOUBLE;
    this.foldRest = FOLD_REST[lo] * (1 - w) + FOLD_REST[lo + 1] * w;
    this.applyTension();
  }

  private applyTension(): void {
    const t = clamp(this.tension + 0.35 * (this.vel - 0.8), 0, 1);
    this.air.glottis.setTension(t);
    // the model that is sounding: a change waits for the next note, and the queued model's rest moved the
    // sounding folds (MEASURED: 2.4 dB on a held note switched from 1 to 0)
    const base = this.air.model === GLOTTIS_SELF_OSCILLATING ? SELF_REST : this.foldRest;
    this.air.restOffset = base + PRESS * (0.5 - t);
  }

  /** Everything from rest, on the current phoneme, bend and body. */
  private start(): void {
    this.pos = 0;
    this.bi = this.blk;
    const A = VOCAL_BODIES[this.bLo];
    const B = VOCAL_BODIES[this.bLo + 1];
    const w = this.bW;
    const k = this.k;
    const pharynx = A.pharynxScale * (1 - w) + B.pharynxScale * w;
    const tongue = A.tongueRadius * (1 - w) + B.tongueRadius * w;
    const lips = LIP_WIDTH[this.bLo] * (1 - w) + LIP_WIDTH[this.bLo + 1] * w;
    const minLength = A.minLength * (1 - w) + B.minLength * w;
    const neutralPharynx = A.neutralPharynx * (1 - w) + B.neutralPharynx * w;
    const air = this.air;
    const n = Math.min(air.nMax, gridSections(this.sr, minLength));
    const lb = minLength - n * air.dx;
    const jv = clamp(Math.round((neutralPharynx - lb) / air.dx), 2, n - 2);
    // a new layout only for a new body; the same one just rests (configure runs cold, and cold code boxes)
    if (k !== this.laidK || n !== this.laidN || jv !== this.laidJv) {
      air.configure(k, n, jv);
      this.laidK = k;
      this.laidN = n;
      this.laidJv = jv;
    } else air.reset();
    if (pharynx !== this.laidPh || tongue !== this.laidTongue || lips !== this.laidLips || k !== this.laidGeoK) {
      this.drive.setBody(k, pharynx, tongue, lips);
      this.laidGeoK = k;
      this.laidPh = pharynx;
      this.laidTongue = tongue;
      this.laidLips = lips;
    }
    air.model = this.glottisModel;
    this.applyTension();
    this.planner.clear();
    this.planner.addNow(this.phonemeParam, 0);
    this.glide.snap(this.bendParam);
    this.pLungTarget = clamp(4 + 6.25 * this.vel, 5, 15);
    this.pLung = this.planner.silentAt(0) ? 0 : 0.94 * this.pLungTarget;
    this.pCoupleHz = COUPLE * (this.noteHz / 120);
    this.pEar = 0;
    this.tuneJaw = 0;
    this.settle();
  }

  /** Snap the articulators and the shape to the plan at the current time (fresh notes only). */
  private settle(): void {
    const bank = this.bank;
    for (let i = 0; i < ARTICULATORS; i++) bank.snap(i, VOCAL_NEUTRAL[i]);
    this.at = this.pos / this.sr;
    for (let pass = 0; pass < 3; pass++) {
      this.targets();
      for (let i = 0; i < ARTICULATORS; i++) bank.snap(i, this.planner.target[i]);
      this.contact();
      // at rest where the contacts hold it: a note that opens on a closure starts pressed, not mid-movement
      for (let i = 0; i < ARTICULATORS; i++) bank.snap(i, bank.values[i]);
    }
    this.art.set(bank.values);
    this.drive.key(this.art, true);
    this.updateGlottis();
    for (let q = 0; q <= STEPS; q++) {
      this.abdAt[q] = this.abduction;
      this.cloAt[q] = this.closure;
      this.stfAt[q] = this.stiffness;
    }
    this.intervalLeft = 0;
    this.blockInInterval = 0;
  }

  /* ---------------------------------------------------------------- */
  /* Control                                                           */
  /* ---------------------------------------------------------------- */

  /** Planner targets at `at`, with the singer's offsets, clamped, into planner.target. */
  private targets(): void {
    restTipFrom(this.bank.values, this.tip);
    const p = this.planner;
    p.at = this.at;
    p.restX = this.tip[0];
    p.restY = this.tip[1];
    p.evaluateNow();
    const tg = p.target;
    const ring = this.ring;
    const tj = this.tuneJaw;
    tg[ART.epilarynx] += ring;
    tg[ART.larynx] -= 0.6 * ring;
    tg[ART.root] += 0.4 * ring;
    tg[ART.jaw] += tj;
    tg[ART.tbY] -= tj;
    tg[ART.lipAp] += 0.5 * tj;
    for (let i = 0; i < ARTICULATORS; i++) {
      const v = tg[i];
      tg[i] = v < ARTICULATOR_TARGET_MIN[i] ? ARTICULATOR_TARGET_MIN[i] : v > ARTICULATOR_MAX[i] ? ARTICULATOR_MAX[i] : v;
    }
  }

  private updateGlottis(): void {
    const k2 = this.k * this.k;
    const b = this.breath;
    this.abduction = (0.1 * b * b + 0.008 + 0.03 * b) * k2 + this.planner.abduction * k2;
    this.closure = this.planner.closure;
    this.stiffness = this.planner.stiffness;
  }

  /** One articulator step ending at time `at`. */
  private step(): void {
    this.targets();
    const bank = this.bank;
    const p = this.planner;
    const art = this.articulation;
    const rate = this.rate;
    for (let i = 0; i < ARTICULATORS; i++) rate[i] = ARTICULATOR_RATE[i] * p.speed[i] * art;
    bank.setAll(p.target, rate);
    bank.step();
    this.contact();
    this.updateGlottis();
  }

  /**
   * Tip and body may press 0.1 k cm into the roof; past that they are
   * projected back along the contact normal (CHIMERA human_voice.rs:520-552).
   * CHIMERA then removes the inward part of the velocity; in the cascade
   * the velocity is the stages behind the output, so only the output stage
   * is moved and those stages keep going toward a target past the roof (a
   * /t/ aims 0.29 k cm past it). The articulator presses into the roof
   * while they do, and when its target turns back it leaves the roof
   * already accelerating. The lips likewise stop at LIP_COMPRESSED while
   * their stages go on to the virtual closure target.
   */
  private contact(): void {
    const bank = this.bank;
    if (bank.values[ART.lipAp] < LIP_COMPRESSED) {
      this.placed[0] = LIP_COMPRESSED;
      bank.placeFrom(ART.lipAp, this.placed, 0);
    }
    const roof = this.roofs[this.bW < 0.5 ? this.bLo : this.bLo + 1];
    const k = roof.k;
    const lim = -0.1 * k;
    const a = this.art;
    a.set(bank.values);
    // the body: its circle against the roof
    roof.bodyPoint(a);
    roof.x = roof.bx;
    roof.y = roof.by;
    roof.project();
    if (roof.sd - roof.r < lim) {
      this.depth = lim - (roof.sd - roof.r);
      this.push(roof, ART.tbX, ART.tbY);
    }
    a.set(bank.values);
    roof.tipPoint(a);
    roof.x = roof.tipX;
    roof.y = roof.tipY;
    roof.project();
    if (roof.sd < lim) {
      this.depth = lim - roof.sd;
      this.push(roof, ART.ttX, ART.ttY);
    }
  }

  /**
   * Move the output stages of articulators (ix, iy), at the roof's point
   * (x, y) with signed distance sd from it, out by `depth` along the normal.
   */
  private push(roof: VocalRoof, ix: number, iy: number): void {
    const sd = roof.sd;
    const depth = this.depth;
    let nx = roof.x - roof.qx;
    let ny = roof.y - roof.qy;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (!(len > 1e-9)) {
      nx = 0;
      ny = -1;
    } else {
      // the normal points into the airway: away from the roof from below it, toward it from above
      const s = sd >= 0 ? 1 / len : -1 / len;
      nx *= s;
      ny *= s;
    }
    const bank = this.bank;
    const val = bank.values;
    const ax = val[ix];
    const ay = val[iy];
    const k = roof.k;
    const sx = (ax > 0.5 ? 0.86 : 1) * k;
    const sy = (ay < 7 ? roof.pharynxScale : 1) * k;
    const pl = this.placed;
    pl[0] = ax + (nx * depth) / sx;
    pl[1] = ay + (ny * depth) / sy;
    bank.placeFrom(ix, pl, 0);
    bank.placeFrom(iy, pl, 1);
  }

  /** A keyframe interval starts: the articulators to its end, then the shape there. */
  private interval(): void {
    const sr = this.sr;
    this.abdAt[0] = this.abdAt[STEPS];
    this.cloAt[0] = this.cloAt[STEPS];
    this.stfAt[0] = this.stfAt[STEPS];
    for (let q = 1; q <= STEPS; q++) {
      this.at = (this.pos + q * this.stepEvery) / sr;
      this.step();
      this.abdAt[q] = this.abduction;
      this.cloAt[q] = this.closure;
      this.stfAt[q] = this.stiffness;
    }
    this.art.set(this.bank.values);
    this.drive.key(this.art, false);
    this.planner.forget(this.pos / sr);
    this.intervalLeft = this.keyEvery;
    this.blockInInterval = 0;
  }

  /** A voice block starts: shape, pitch, breath and glottis for its samples. */
  private beginBlock(): void {
    const sr = this.sr;
    const blk = this.blk;
    const air = this.air;
    this.blockInInterval++;
    const b = this.blockInInterval;
    const drive = this.drive;
    drive.u = b / VOCAL_KEY_BLOCKS;
    drive.toAirway(air);
    // the glottis at the block's end, from the articulator steps either side
    const sf = (b * STEPS) / VOCAL_KEY_BLOCKS;
    const s0 = Math.floor(sf);
    const s1 = s0 < STEPS ? s0 + 1 : STEPS;
    const fr = sf - s0;
    air.agStatic = this.abdAt[s0] + (this.abdAt[s1] - this.abdAt[s0]) * fr;
    air.closure = this.cloAt[s0] + (this.cloAt[s1] - this.cloAt[s0]) * fr;
    // the posterior chink: CHIMERA's (0.008 + 0.03 breath) k^2 part of the opening above
    const k2 = this.k * this.k;
    air.chink = (0.008 + 0.03 * this.breath) * k2;
    const stiff = this.stfAt[s0] + (this.stfAt[s1] - this.stfAt[s0]) * fr;
    air.xRel = 1 - STIFF_SWING * stiff;
    const t = (this.pos + blk / 2) / sr;
    const p = this.planner;
    p.at = t;
    p.queryNow();

    // pitch: the glide, the vibrato blooming in, the folds' stiffness, the pressure across the folds
    this.glide.advance();
    const bend = this.glide.value;
    this.bloomT += blk / sr;
    const bt = this.bloomT;
    const up = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(bt / Math.max(this.vibDelay, 1e-9), 1));
    const down = this.bloomFrom * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(bt / VIBRATO_FADE, 1)));
    this.bloomNow = up > down ? up : down;
    let ph = this.vibPhase + this.vibInc;
    if (ph >= 1) ph -= 1;
    this.vibPhase = ph;
    const vib = Math.sin(2 * Math.PI * ph) * this.vibDepth * this.bloomNow;
    const f0 = this.noteHz * Math.pow(2, (bend + vib) / 12 + (stiff * STIFF_CENTS) / 1200);
    this.f0Now = f0;
    this.tune();
    // f0 follows the pressure across the folds against the pressure below them, which is the pressure
    // above them: a closure above the folds lowers it, effort (both pressures together) does not
    // (Titze 1989: 2 to 6 Hz per cmH2O). The geometric folds read it from block means, against the
    // singer's ear (EAR_TAU); the pulse keeps
    // its reading of each block's last sample, which aliases the cycle (MEASURED: a female /ɑ/ at
    // 494 Hz 19 cents sharp; docs/VOICE-2.md, "Vocal folds"). Self-oscillating folds find all this
    // themselves: their servo aims at the note.
    const pa = air.pSupra;
    this.pEar += (pa - this.pEar) * (1 - Math.exp(-blk / sr / EAR_TAU));
    if (air.model === GLOTTIS_SELF_OSCILLATING) air.f0 = f0;
    else if (air.model === GLOTTIS_GEOMETRIC) air.f0 = f0 - (this.pCoupleHz * Math.max(pa - this.pEar, 0)) / CM_H2O;
    else air.f0 = f0 + (this.pCoupleHz * (Math.max(air.dpSmooth, 0) - Math.max(air.pSubSmooth, 0))) / CM_H2O;

    // the sung breath (planner.rs:376-379): full drive from the note-on to its end, off in silences
    const gate = t < this.end && p.silent === 0 ? 1 : 0;
    const tau = gate ? 0.025 : 0.05;
    this.pLung += (this.pLungTarget * gate - this.pLung) * (1 - Math.exp(-blk / sr / tau));
    air.pLung = this.pLung * CM_H2O;
    // velocity is lung pressure above 0.2; under it the note also fades, so velocity 0 is silent
    air.gain = OUTPUT_GAIN * this.level * Math.min(this.vel / 0.2, 1);
    air.beginBlock();
  }

  /** Formant tuning: open the jaw so the vowel's first resonance stays above 1.15 f0 (the block's f0Now). */
  private tune(): void {
    const f0 = this.f0Now;
    if (!(this.tuning > 0)) {
      this.tuneJaw = 0;
      return;
    }
    const v = this.planner.vowel;
    if (v < 0) {
      this.tuneJaw = 0;
      return;
    }
    const A = VOCAL_BODIES[this.bLo];
    const B = VOCAL_BODIES[this.bLo + 1];
    const w = this.bW;
    const slope = A.tuneSlope[v] * (1 - w) + B.tuneSlope[v] * w;
    // only where opening raises R1 (an open vowel's falls as the tongue drops into the pharynx)
    if (slope < 20) {
      this.tuneJaw = 0;
      return;
    }
    const r1 = A.tuneR1[v] * (1 - w) + B.tuneR1[v] * w;
    const jaw = A.tuneJaw[v] * (1 - w) + B.tuneJaw[v] * w;
    const need = (1.15 * f0 - r1) / slope;
    const room = 2.6 - jaw;
    this.tuneJaw = this.tuning * Math.min(OPEN_MAX, room, need > 0 ? need : 0);
  }
}

const PARAMS: ParamSpec[] = [
  { name: 'phoneme', min: 0, max: PHONEMES - 1, default: VOCAL_DEFAULT_PHONEME },
  { name: 'bend', min: -48, max: 48, default: 0, unit: 'st' },
  { name: 'glide', min: 0.005, max: 0.5, default: DEFAULTS.glide, curve: 'exp', unit: 's' },
  { name: 'body', min: 0, max: 2, default: 0 },
  { name: 'tension', min: 0, max: 1, default: 0.55 },
  { name: 'roughness', min: 0, max: 1, default: 0.1 },
  { name: 'fry', min: 0, max: 1, default: 0 },
  { name: 'drift', min: 0, max: 20, default: 6, unit: 'cents' },
  { name: 'glottis', min: 0, max: 2, default: 2 },
  { name: 'breath', min: 0, max: 1, default: 0.15 },
  { name: 'vibratoRate', min: 0, max: 12, default: 5.5, unit: 'Hz' },
  { name: 'vibratoDepth', min: 0, max: 2, default: 0.3, unit: 'st' },
  { name: 'vibratoDelay', min: 0, max: 1, default: 0.25, unit: 's' },
  { name: 'articulation', min: 0.25, max: 4, default: 1, curve: 'exp' },
  { name: 'attack', min: 0.001, max: 1, default: 0.02, curve: 'exp', unit: 's' },
  { name: 'release', min: 0.01, max: 2, default: 0.15, curve: 'exp', unit: 's' },
  { name: 'level', min: 0, max: 2, default: 1 },
  { name: 'overshoot', min: 0, max: 0.5, default: DEFAULTS.overshoot },
  { name: 'preparation', min: 0, max: 1, default: DEFAULTS.preparation },
  { name: 'ring', min: 0, max: 1, default: 0 },
  { name: 'tuning', min: 0, max: 1, default: 0 },
  { name: 'nextIn', min: 0, max: 1, default: 0, unit: 's' },
  { name: 'nextPhoneme', min: 0, max: PHONEMES - 1, default: 0 },
];

export const vocalEngine: EngineDef = {
  id: 'vocal',
  label: 'Vocal',
  params: PARAMS,
  polyphony: 8,
  createVoice: (sampleRate, initParams, rng) => new VocalVoice(sampleRate, initParams, rng),
};
