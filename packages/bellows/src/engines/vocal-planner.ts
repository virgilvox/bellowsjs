/*
 * The articulation planner: a sung line's phonemes, as they arrive, to
 * targets and speeds for CHIMERA's 17 articulators and the glottis, at
 * control rate.
 *
 * Learned from CHIMERA by Jameson Hodge (MIT,
 * https://github.com/jamesondh/chimera-vocal-synth at 1d3ea49):
 * crates/chimera/src/phonetics/planner.rs:24, 88-108, 196-390 and 532-577
 * (the gestures and their timing), control/score.rs:273-430 and
 * voice/human_voice.rs:445 (how gestures blend), control/articulators.rs
 * (speeds), as summarized with file and line in data/vocal/
 * chimera-articulation.json. Reimplemented here; see
 * THIRD_PARTY_NOTICES.md. Changes from CHIMERA: it plans online, from
 * phonemes posted as they come (with the next ones posted early when the
 * caller knows them), instead of from a whole utterance; a phrase-initial
 * consonant starts moving 60 ms earlier; palatalization, trills and
 * nasalized vowels are not used (no bellows phoneme has them).
 *
 * GESTURES. A gesture holds some articulators at targets over [t0, t1],
 * with raised-cosine ramps ri before and ro after, at a strength. Each
 * control step every articulator's target is the strength-weighted mean of
 * the active gestures on it, with the performer's rest posture at weight
 * 0.05 (the velum is a bounded key: it moves toward the gestures' mean by
 * at most their summed weight over 2). So a consonant holds only the
 * articulators it dominates (strength 40), its other targets are weak
 * (2.2), and the tongue body keeps following the vowels: the vowel
 * gestures (strength 1) ramp in over most of the consonants before them
 * (anticipation) and out over part of those after (carryover), Ohman's
 * overlap. A gesture also speeds its articulators up by its manner's
 * speed while it can act (1.55 stops and nasals, 2.8 the tap, 2.0 and
 * 1.4 an affricate's closure and release, 1.3 the rest).
 *
 * CHANGES FOR THE ARTICULATOR CASCADE (dsp/cascade.ts, six stages where
 * CHIMERA has a critically damped pair; the 98 percent times are kept):
 *  - each articulator sees every gesture CASCADE_LAG of its own 98 percent
 *    time ahead (0.18 of it, 5 to 28 ms), the extra time the cascade takes
 *    to pass half way, so sounds keep CHIMERA's times;
 *  - a consonant's release is a return gesture (VocalTractLab 2.4): from
 *    its gesture's end its articulators move at RETURN_SPEED for one whole
 *    movement, whatever follows, where CHIMERA held the speed 45 ms;
 *  - when two consonants hold an articulator at once, a closure wins over
 *    any other constriction and then the more anterior place, and an
 *    approach takes the articulator from a return;
 *  - a bilabial closure aims at LIP_VIRTUAL, past the lips' contact (the
 *    engine stops them at LIP_COMPRESSED), and closing consonants release
 *    a few ms earlier than CHIMERA's (lips 25 ms before the next sound,
 *    tip 24, body 39), since a pressed articulator takes longer to leave.
 *
 * ONLINE. A segment is a phoneme and its start in voice time. The caller
 * adds them as they become known: addUpcoming() for one posted early,
 * addNow() for one that starts now. Every addition rebuilds the gestures of
 * the segments still in reach, which is how a gesture that ends before the
 * next segment (a closure releases 20 to 34 ms early) or starts before its
 * own (a stop closes 22 to 31 ms early, a nasal lowers the velum 20 ms
 * early) gets the right times when segments are posted far enough ahead,
 * and the nearest ones otherwise. Posted 0.3 s ahead, the plan equals the
 * one built from the whole line at once.
 *
 * Nothing allocates after construction: segments and gestures live in
 * fixed arrays, and a full pool drops the oldest segment.
 */

import { CASCADE_ORDER, CASCADE_SETTLE_98, cascadeSettle } from '../dsp/cascade';
import { CRITDAMP_SETTLE_98 } from '../dsp/critdamp';
import { ARTICULATORS, ART } from './vocal-articulators';
import { VOCAL_ACOUSTICS, vocalPhonemeIndex } from './vocal-phonemes';
import {
  VOCAL_ARTICULATOR_HZ,
  VOCAL_ARTICULATOR_MAX,
  VOCAL_ARTICULATOR_MIN,
  VOCAL_BODIES,
  VOCAL_INVENTORY,
  VOCAL_NEUTRAL,
  VOCAL_TABLE_PHONEMES,
} from './vocal-tables.gen';

/** Control keys: the 17 articulators, then the glottis: abduction, closure, fold stiffness (cricothyroid). */
export const KEY_ABDUCTION = ARTICULATORS;
export const KEY_CLOSURE = ARTICULATORS + 1;
export const KEY_STIFFNESS = ARTICULATORS + 2;
const KEYS = ARTICULATORS + 3;

/**
 * The stiffness gesture of a voiceless obstruent ramps out over this many
 * seconds after its abduction ends. Hanson (2009, "Effects of obstruent
 * consonants on fundamental frequency at vowel onset in English", JASA 125)
 * and Lofqvist et al. (1989) put the raised f0 after voiceless obstruents
 * in the folds' tension (cricothyroid activity that helps hold them apart
 * against the flow), lasting into the first 50 to 100 ms of the vowel.
 */
const STIFF_RELEASE = 0.08;

export const VOCAL_TABLE_SIZE = VOCAL_TABLE_PHONEMES.length;

/* Per-phoneme classes, as numbers. */
const M_SILENCE = 0;
const M_VOWEL = 1;
const M_STOP = 2;
const M_FRICATIVE = 3;
const M_AFFRICATE = 4;
const M_NASAL = 5;
const M_APPROXIMANT = 6;
const M_LATERAL = 7;
const M_TAP = 8;
const M_GLOTTAL = 9;
const MANNER_CODE: Record<string, number> = {
  silence: M_SILENCE,
  vowel: M_VOWEL,
  stop: M_STOP,
  fricative: M_FRICATIVE,
  affricate: M_AFFRICATE,
  nasal: M_NASAL,
  approximant: M_APPROXIMANT,
  lateral: M_LATERAL,
  tap: M_TAP,
  glottal: M_GLOTTAL,
};
const PLACE_RANK: Record<string, number> = {
  bilabial: 0,
  labiodental: 1,
  dental: 2,
  alveolar: 3,
  postalveolar: 4,
  retroflex: 5,
  palatal: 6,
  velar: 7,
  uvular: 8,
};

const COUNT = VOCAL_TABLE_SIZE;
const MANNER = new Uint8Array(COUNT);
const VOICED = new Uint8Array(COUNT);
const RANK = new Int8Array(COUNT);
const ALVEOLAR = new Uint8Array(COUNT);
const NASAL = new Uint8Array(COUNT);
/** 0 none, 1 open (h), 2 stop (ʔ), 3 breathy. */
const GLOTTAL = new Uint8Array(COUNT);
const RELEASE = new Int16Array(COUNT);
/** Bit a set if the phoneme dominates articulator a. */
const DOMINANT = new Int32Array(COUNT);
const BODY_ONLY = new Uint8Array(COUNT);
const LIPS_ONLY = new Uint8Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  const d = VOCAL_INVENTORY[i];
  MANNER[i] = MANNER_CODE[d.manner];
  VOICED[i] = d.voiced ? 1 : 0;
  RANK[i] = PLACE_RANK[d.place] ?? -1;
  ALVEOLAR[i] = d.place === 'alveolar' ? 1 : 0;
  NASAL[i] = d.nasal ? 1 : 0;
  GLOTTAL[i] = d.glottal === 'open' ? 1 : d.glottal === 'stop' ? 2 : d.glottal === 'breathy' ? 3 : 0;
  RELEASE[i] = d.release;
  let mask = 0;
  for (const a of d.dominant) mask |= 1 << a;
  DOMINANT[i] = mask;
  const body = (1 << ART.tbX) | (1 << ART.tbY) | (1 << ART.root);
  const lips = (1 << ART.lipAp) | (1 << ART.labiodental);
  BODY_ONLY[i] = mask !== 0 && (mask & ~body) === 0 ? 1 : 0;
  LIPS_ONLY[i] = mask !== 0 && (mask & ~lips) === 0 ? 1 : 0;
}

/** Whether table phoneme i is a vowel. */
export function vocalIsVowel(i: number): boolean {
  return MANNER[i] === M_VOWEL;
}

const SEGMENTS = 32;
const GESTURES = 256;
const GESTURE_KEYS = 12;
/** Two segments' starts closer than this are the same segment, seconds. */
const SAME = 0.003;
/** Segments whose influence has certainly ended this long ago are dropped, seconds. */
const FORGET = 1.5;
/**
 * A phrase-initial consonant starts this much earlier (the prototype's measured choice: a phrase-initial
 * /ʃ/ was 17 dB weak without it). Only the first: the rest of an onset cluster keeps its own time, or the
 * /t/ of /stɹ/ held the tongue tip from 5 ms after the note-on, outranked the /s/ and left it silent
 * (MEASURED: 45 dB under CHIMERA's above 2.5 kHz, every body).
 */
const INITIAL_LEAD = 0.06;
/** No consonant holds the articulator. */
const NO_RANK = 127;
/** CHIMERA's rest-posture weight in the blend. */
const BASE_WEIGHT = 0.05;

export class VocalPlanner {
  /* Segments, in start order. */
  private readonly segIdx = new Int16Array(SEGMENTS);
  private readonly segT0 = new Float64Array(SEGMENTS);
  private segCount = 0;
  /** Whether a vowel was dropped off the front, so no remaining consonant is phrase-initial. */
  private droppedVowel = false;
  /** The end of the phrase (Infinity until known), voice seconds. */
  private end = Infinity;

  /* Gestures. */
  private readonly gT0 = new Float64Array(GESTURES);
  private readonly gT1 = new Float64Array(GESTURES);
  private readonly gRi = new Float64Array(GESTURES);
  private readonly gRo = new Float64Array(GESTURES);
  private readonly gStr = new Float64Array(GESTURES);
  private readonly gSpeed = new Float64Array(GESTURES);
  /** A consonant's return: how long after t1 + ro its speed holds, s. */
  private readonly gHold = new Float64Array(GESTURES);
  /** A consonant's return speed (0: none). */
  private readonly gRet = new Float64Array(GESTURES);
  /**
   * A consonant's priority on its articulators, lower first: a closure (stop,
   * nasal, an affricate's closure) at its place rank (0 bilabial .. 8
   * uvular), anything else at 16 plus it; -1 for a gesture that is not a
   * consonant's main one.
   */
  private readonly gRank = new Int8Array(GESTURES);
  /** How far ahead each key of a gesture is evaluated, s: its articulator's added lag in the cascade (0 for the glottis). */
  private readonly gLead = new Float64Array(GESTURES * GESTURE_KEYS);
  /** The smallest and largest of a gesture's leads, to skip or take whole a gesture no key of which is in a ramp. */
  private readonly gLeadMin = new Float64Array(GESTURES);
  private readonly gLeadMax = new Float64Array(GESTURES);
  private readonly gKeyCount = new Uint8Array(GESTURES);
  private readonly gKeys = new Uint8Array(GESTURES * GESTURE_KEYS);
  private readonly gVals = new Float64Array(GESTURES * GESTURE_KEYS);
  private gCount = 0;

  /* Targets blended for the body. */
  private readonly vowelT = new Float64Array(COUNT * ARTICULATORS);
  private readonly consT = new Float64Array(COUNT * ARTICULATORS);
  /* Scratch for a gesture being built. */
  private readonly kTmp = new Uint8Array(KEYS);
  private readonly vTmp = new Float64Array(KEYS);
  private nTmp = 0;

  /* Outputs of evaluate(). */
  /** Articulator targets, clamped to range. */
  readonly target = new Float64Array(ARTICULATORS);
  /** Speed factor per articulator, 1 at rest. */
  readonly speed = new Float64Array(ARTICULATORS);
  /** Glottal abduction from gestures (cm^2 before the body's k^2), closure 0 to 1, and fold stiffness 0 to 1. */
  abduction = 0;
  closure = 0;
  stiffness = 0;
  /** Inputs of evaluateNow() and queryNow(): the time and the rest tip. */
  at = 0;
  restX = 0;
  restY = 0;
  /** Outputs of queryNow(). */
  silent = 0;
  vowel = -1;
  private readonly wsum = new Float64Array(KEYS);
  private readonly vsum = new Float64Array(KEYS);
  /* Per articulator at the evaluated time: the first in priority of the consonants approaching it (rankA), fully under way on it (rankF) and returning from it (rankR), and the speeds of those approaching and returning. */
  private readonly rankA = new Int8Array(ARTICULATORS);
  private readonly rankF = new Int8Array(ARTICULATORS);
  private readonly rankR = new Int8Array(ARTICULATORS);
  private readonly speedA = new Float64Array(ARTICULATORS);
  private readonly speedR = new Float64Array(ARTICULATORS);

  constructor() {
    this.setBody(0);
  }

  /** Body 0 male to 2 child, continuous: targets blend linearly between neighbours. */
  setBody(body: number): void {
    const b = body > 0 ? (body < 2 ? body : 2) : 0;
    const lo = Math.floor(b) < 2 ? Math.floor(b) : 1;
    const w = b - lo;
    const A = VOCAL_BODIES[lo];
    const B = VOCAL_BODIES[lo + 1];
    for (let p = 0; p < COUNT; p++) {
      for (let a = 0; a < ARTICULATORS; a++) {
        this.vowelT[p * ARTICULATORS + a] = A.vowelTargets[p][a] * (1 - w) + B.vowelTargets[p][a] * w;
        this.consT[p * ARTICULATORS + a] = A.consonantTargets[p][a] * (1 - w) + B.consonantTargets[p][a] * w;
      }
    }
    this.rebuild();
  }

  /** Forget everything: a new note. */
  clear(): void {
    this.segCount = 0;
    this.gCount = 0;
    this.droppedVowel = false;
    this.end = Infinity;
  }

  /**
   * Phoneme `idx` starts at voice time t, now: a segment posted early with
   * the same sound and time is confirmed, a repeat of the sounding segment
   * is ignored, and anything planned after t is dropped, since the caller
   * has gone another way.
   */
  addNow(idx: number, t: number): void {
    for (let s = 0; s < this.segCount; s++) {
      if (this.segIdx[s] === idx && Math.abs(this.segT0[s] - t) <= SAME) return;
    }
    const n = this.segCount;
    if (n > 0 && this.segIdx[n - 1] === idx && this.segT0[n - 1] < t - SAME) return;
    while (this.segCount > 0 && this.segT0[this.segCount - 1] >= t - SAME) this.segCount--;
    this.push(idx, t);
    this.rebuild();
  }

  /** Phoneme `idx` will start at voice time t. */
  addUpcoming(idx: number, t: number): void {
    for (let s = 0; s < this.segCount; s++) {
      if (Math.abs(this.segT0[s] - t) <= SAME) {
        this.segIdx[s] = idx;
        this.rebuild();
        return;
      }
    }
    this.push(idx, t);
    this.rebuild();
  }

  /** The phrase ends at voice time t (the note-off). */
  setEnd(t: number): void {
    this.end = t;
    while (this.segCount > 0 && this.segT0[this.segCount - 1] >= t) this.segCount--;
    this.rebuild();
  }

  /** Drop segments that can no longer matter at time t. */
  forget(t: number): void {
    let drop = 0;
    while (drop + 2 < this.segCount && this.segT0[drop + 2] < t - FORGET) drop++;
    if (drop === 0) return;
    for (let s = 0; s < drop; s++) if (MANNER[this.segIdx[s]] === M_VOWEL) this.droppedVowel = true;
    this.segIdx.copyWithin(0, drop, this.segCount);
    this.segT0.copyWithin(0, drop, this.segCount);
    this.segCount -= drop;
    this.rebuild();
  }

  private push(idx: number, t: number): void {
    if (this.segCount === SEGMENTS) {
      if (MANNER[this.segIdx[0]] === M_VOWEL) this.droppedVowel = true;
      this.segIdx.copyWithin(0, 1);
      this.segT0.copyWithin(0, 1);
      this.segCount--;
    }
    let at = this.segCount;
    while (at > 0 && this.segT0[at - 1] > t) at--;
    for (let s = this.segCount; s > at; s--) {
      this.segIdx[s] = this.segIdx[s - 1];
      this.segT0[s] = this.segT0[s - 1];
    }
    this.segIdx[at] = idx;
    this.segT0[at] = t;
    this.segCount++;
  }

  private t1(s: number): number {
    return s + 1 < this.segCount ? this.segT0[s + 1] : this.end;
  }

  /** The segment sounding at time t (the last to start at or before it), or -1. */
  segmentAt(t: number): number {
    let cur = -1;
    for (let s = 0; s < this.segCount; s++) {
      if (this.segT0[s] <= t) cur = s;
      else break;
    }
    return cur;
  }

  /** Phoneme of segment s. */
  phonemeOf(s: number): number {
    return this.segIdx[s];
  }

  /** The vowel sounding at t or the next one, as a table phoneme, or -1. */
  vowelAt(t: number): number {
    for (let s = 0; s < this.segCount; s++) {
      if (MANNER[this.segIdx[s]] === M_VOWEL && this.t1(s) > t) return this.segIdx[s];
    }
    return -1;
  }

  /** Whether the segment at t is silence (the breath stops). */
  silentAt(t: number): boolean {
    const s = this.segmentAt(t);
    return s >= 0 && MANNER[this.segIdx[s]] === M_SILENCE;
  }

  /**
   * At the time in `at`: whether the breath stops (`silent`, 0 or 1) and
   * the vowel sounding or next (`vowel`, -1 for none). The audio path's
   * form of silentAt and vowelAt.
   */
  queryNow(): void {
    const t = this.at;
    let cur = -1;
    let vowel = -1;
    for (let s = 0; s < this.segCount; s++) {
      const r = this.segT0[s];
      const idx = this.segIdx[s];
      if (r <= t) cur = s;
      // t1(s) written out: a returned double crossing a call is boxed when V8 does not inline it
      const end = s + 1 < this.segCount ? this.segT0[s + 1] : this.end;
      if (vowel < 0 && MANNER[idx] === M_VOWEL && end > t) vowel = idx;
    }
    this.silent = cur >= 0 && MANNER[this.segIdx[cur]] === M_SILENCE ? 1 : 0;
    this.vowel = vowel;
  }

  /* ---------------------------------------------------------------- */
  /* Building gestures                                                 */
  /* ---------------------------------------------------------------- */

  private begin(): void {
    this.nTmp = 0;
  }

  private key(k: number, v: number): void {
    if (v !== v) return;
    this.kTmp[this.nTmp] = k;
    this.vTmp[this.nTmp] = v;
    this.nTmp++;
  }

  private emit(t0: number, t1: number, ri: number, ro: number, str: number, speed: number): number {
    if (this.nTmp === 0 || this.gCount === GESTURES) return -1;
    const g = this.gCount++;
    this.gT0[g] = t0;
    this.gT1[g] = t1;
    this.gRi[g] = ri;
    this.gRo[g] = ro;
    this.gStr[g] = str;
    this.gSpeed[g] = speed;
    this.gHold[g] = 0;
    this.gRet[g] = 0;
    this.gRank[g] = -1;
    const n = this.nTmp < GESTURE_KEYS ? this.nTmp : GESTURE_KEYS;
    this.gKeyCount[g] = n;
    let lo = Infinity;
    let hi = -Infinity;
    for (let q = 0; q < n; q++) {
      const k = this.kTmp[q];
      this.gKeys[g * GESTURE_KEYS + q] = k;
      this.gVals[g * GESTURE_KEYS + q] = this.vTmp[q];
      // the cascade passes half way CASCADE_LAG of a 98 percent time later than CHIMERA's tracker did:
      // each articulator sees the gesture that much ahead, at the gesture's speed
      const lead = k < ARTICULATORS ? (CASCADE_LAG * CRITDAMP_SETTLE_98) / (2 * Math.PI * VOCAL_ARTICULATOR_HZ[k] * (speed > 0 ? speed : 1)) : 0;
      this.gLead[g * GESTURE_KEYS + q] = lead;
      if (lead < lo) lo = lead;
      if (lead > hi) hi = lead;
    }
    this.gLeadMin[g] = lo;
    this.gLeadMax[g] = hi;
    this.nTmp = 0;
    return g;
  }

  /** A consonant's oral gestures from its targets row (planner.rs:292-321, 532-577), returning at speed `ret`. */
  private oral(idx: number, row: number, a: number, b: number, speed: number, ret: number): void {
    const T = this.consT;
    const dom = DOMINANT[idx];
    const bodyOnly = BODY_ONLY[idx] === 1;
    const sp = bodyOnly ? 1 + (speed - 1) * 0.35 : speed;
    const m = MANNER[idx];
    const closing = m === M_STOP || m === M_NASAL || m === M_AFFRICATE;
    const lipsOnly = LIPS_ONLY[idx] === 1;
    const lead = closing ? (bodyOnly ? 0.039 : lipsOnly ? 0.025 : 0.024) : 0;
    const early = closing ? (bodyOnly ? 0.024 : lipsOnly ? 0.022 : 0.031) : 0.008;
    this.begin();
    const bilabial = closing && RANK[idx] === 0;
    for (let k = 0; k < ARTICULATORS; k++) if (dom & (1 << k)) this.key(k, bilabial && k === ART.lipAp ? LIP_VIRTUAL : T[row + k]);
    const g = this.emit(a - early, Math.max(a + 0.01, b - lead), 0.03, bodyOnly ? 0.03 : 0.018, 40, sp);
    if (g >= 0) {
      // the return gesture: the release at the consonant's own speed for a whole movement, whatever follows
      const rs = bodyOnly ? 1 + (ret - 1) * 0.35 : ret;
      let hz = 0;
      for (let k = 0; k < ARTICULATORS; k++) if (dom & (1 << k) && VOCAL_ARTICULATOR_HZ[k] > hz) hz = VOCAL_ARTICULATOR_HZ[k];
      this.gRet[g] = rs;
      this.gHold[g] = CRITDAMP_SETTLE_98 / (2 * Math.PI * (hz > 0 ? hz : 10) * rs);
      this.gRank[g] = (closing ? 0 : 16) + (RANK[idx] >= 0 ? RANK[idx] : 0);
    }
    const tbXSet = T[row + ART.tbX] === T[row + ART.tbX];
    const alveolar = ALVEOLAR[idx] === 1 && !tbXSet && (closing || m === M_FRICATIVE || m === M_TAP);
    if (alveolar) {
      this.begin();
      this.key(ART.tbX, 3.2);
      this.key(ART.tbY, 7.4);
      this.emit(a, b, 0.05, 0.05, 1.2, 0);
    }
    this.begin();
    let place = NaN;
    for (let k = 0; k < ARTICULATORS; k++) {
      if (dom & (1 << k)) continue;
      const v = T[row + k];
      if (v !== v) continue;
      if (bodyOnly && k === ART.tbX) place = v;
      else this.key(k, v);
    }
    this.emit(a, b, 0.05, 0.05, 2.2, 0);
    if (place === place) {
      this.begin();
      this.key(ART.tbX, place);
      this.emit(a, b, 0.05, 0.05, 0.25, 0);
    }
  }

  /** Rebuild every gesture from the segments (event rate). */
  private rebuild(): void {
    this.gCount = 0;
    const n = this.segCount;
    // vowels: Ohman overlap ramps (planner.rs:88-108)
    let prevVowel = -1;
    for (let s = 0; s < n; s++) {
      const idx = this.segIdx[s];
      if (MANNER[idx] !== M_VOWEL) continue;
      const t0 = this.segT0[s];
      const t1 = this.t1(s);
      let next = -1;
      for (let q = s + 1; q < n; q++) {
        if (MANNER[this.segIdx[q]] === M_VOWEL) {
          next = q;
          break;
        }
      }
      const prevEnd = prevVowel >= 0 ? this.t1(prevVowel) : t0 - 0.08;
      const ri = Math.max(0.03, 0.75 * (t0 - prevEnd)) + 0.01;
      const ro = next >= 0 ? Math.max(0.03, 0.4 * (this.segT0[next] - t1)) + 0.01 : 0.042;
      const row = idx * ARTICULATORS;
      this.begin();
      for (let k = 0; k < ARTICULATORS; k++) this.key(k, this.vowelT[row + k]);
      this.emit(t0, t1, ri, ro, 1, 0);
      prevVowel = s;
    }
    let firstVowel = n;
    if (!this.droppedVowel) {
      for (let s = 0; s < n; s++) {
        if (MANNER[this.segIdx[s]] === M_VOWEL) {
          firstVowel = s;
          break;
        }
      }
    } else firstVowel = -1;
    for (let s = 0; s < n; s++) {
      const idx = this.segIdx[s];
      const m = MANNER[idx];
      if (m === M_VOWEL || m === M_SILENCE) continue;
      const before = this.gCount;
      const t0 = this.segT0[s];
      const t1 = this.t1(s);
      const dur = t1 - t0;
      const row = idx * ARTICULATORS;
      if (m === M_STOP) {
        // a stop closing behind another stop's closure, already placed, aims 25 ms later (planner.rs:299)
        let placed = false;
        if (s > 1) {
          const p = this.segIdx[s - 1];
          const bb = this.segIdx[s - 2];
          if (MANNER[p] === M_STOP && RANK[p] >= 0 && RANK[p] < RANK[idx]) {
            placed = true;
            const dom = DOMINANT[idx];
            for (let k = 0; k < ARTICULATORS; k++) {
              const v = this.consT[bb * ARTICULATORS + k];
              if (dom & (1 << k) && v !== v) placed = false;
            }
          }
        }
        this.oral(idx, row, placed ? t0 + Math.min(0.025, Math.max(0, dur - 0.03)) : t0, t1, 1.55, RETURN_SPEED[idx]);
      } else if (m === M_NASAL) this.oral(idx, row, t0, t1, 1.55, RETURN_SPEED[idx]);
      else if (m === M_TAP) this.oral(idx, row, t0, t1, 2.8, RETURN_SPEED[idx]);
      else if (m === M_AFFRICATE) {
        const split = t0 + dur * 0.55;
        this.oral(idx, row, t0, split, 2.0, RETURN_SPEED[idx]);
        const rel = RELEASE[idx];
        // the release part ends as its fricative does
        if (rel >= 0) this.oral(idx, rel * ARTICULATORS, split + 0.008, t1, 1.4, RETURN_SPEED[rel]);
      } else if (m === M_FRICATIVE || m === M_APPROXIMANT || m === M_LATERAL) this.oral(idx, row, t0, t1, 1.3, RETURN_SPEED[idx]);
      if (NASAL[idx]) {
        this.begin();
        this.key(ART.velum, 0.45);
        this.emit(t0 - 0.02, t1 - 0.02, 0.05, 0.03, 4, 0);
      }
      // phonation (planner.rs:329-358)
      const gl = GLOTTAL[idx];
      this.begin();
      if (gl === 1) {
        this.key(KEY_ABDUCTION, 0.33);
        this.emit(t0 - 0.01, t1, 0.03, 0.035, 5, 0);
      } else if (gl === 2) {
        this.key(KEY_CLOSURE, 1);
        this.emit(t0, t1, 0.012, 0.015, 8, 0);
      } else if (gl === 3) {
        this.key(KEY_ABDUCTION, 0.1);
        this.emit(t0, t1, 0.03, 0.03, 5, 0);
      } else if (VOICED[idx] === 0) {
        if (m === M_STOP || m === M_AFFRICATE) {
          const nextVowel = s + 1 < n && MANNER[this.segIdx[s + 1]] === M_VOWEL;
          const afterS = s > 0 && VOCAL_TABLE_PHONEMES[this.segIdx[s - 1]] === 's';
          const aspirated = nextVowel && !afterS;
          this.key(KEY_ABDUCTION, aspirated ? 0.36 : 0.22);
          // an aspirated release holds the glottis open for the stop's VOT (Lisker and Abramson 1964:
          // p 58, t 70, k 80 ms; src/sing.ts releases that much before the beat) less the 50 ms the
          // abduction's ramp out and the voicing gate add (MEASURED), at least CHIMERA's 20 ms
          const hold = aspirated ? Math.max(0.02, STOP_VOT[idx] - 0.05) : 0.0048;
          this.emit(t0 + 0.25 * dur, t1 + hold, 0.035, aspirated ? 0.045 : 0.02, 6, 0);
          this.stiffen(t0 + 0.25 * dur, t1 + hold + (aspirated ? 0.045 : 0.02));
        } else {
          this.key(KEY_ABDUCTION, 0.3);
          this.emit(t0 - 0.015, t1 + 0.005, 0.03, 0.03, 6, 0);
          this.stiffen(t0 - 0.015, t1 + 0.035);
        }
      } else if (m === M_FRICATIVE) {
        this.key(KEY_ABDUCTION, 0.035);
        this.emit(t0, t1, 0.03, 0.03, 3, 0);
      }
      if (s === 0 && s < firstVowel) {
        for (let g = before; g < this.gCount; g++) {
          const kc = this.gKeyCount[g];
          let glottal = false;
          for (let q = 0; q < kc; q++) if (this.gKeys[g * GESTURE_KEYS + q] >= KEY_ABDUCTION) glottal = true;
          if (glottal) continue;
          this.gT0[g] -= INITIAL_LEAD;
          this.gRi[g] += 0.5 * INITIAL_LEAD;
        }
      }
    }
    // the end of the breath group (planner.rs:383-389)
    if (this.end < Infinity) {
      const last = n > 0 ? this.segIdx[n - 1] : 0;
      const m = MANNER[last];
      const sonorant = m === M_VOWEL || m === M_NASAL || m === M_APPROXIMANT || m === M_LATERAL || m === M_TAP;
      this.begin();
      this.key(KEY_ABDUCTION, 0.22);
      this.emit(this.end + (sonorant ? 0.045 : 0.015), this.end + 0.1, 0.03, 0.06, 6, 0);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Control rate                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Targets and speeds at time t, with the tip's rest position (when no
   * gesture holds the tip) given by the caller from the current jaw and
   * tongue body.
   */
  evaluate(t: number, restTipX: number, restTipY: number): void {
    this.at = t;
    this.restX = restTipX;
    this.restY = restTipY;
    this.evaluateNow();
  }

  /**
   * evaluate() at the time and rest tip in the fields `at`, `restX` and
   * `restY`: the audio path's form, so no double crosses the call.
   */
  evaluateNow(): void {
    const t = this.at;
    const restTipX = this.restX;
    const restTipY = this.restY;
    const wsum = this.wsum;
    const vsum = this.vsum;
    const speed = this.speed;
    const rankA = this.rankA;
    const rankR = this.rankR;
    const speedA = this.speedA;
    const speedR = this.speedR;
    wsum.fill(0);
    vsum.fill(0);
    const rankF = this.rankF;
    rankA.fill(NO_RANK);
    rankF.fill(NO_RANK);
    rankR.fill(NO_RANK);
    speedA.fill(1);
    speedR.fill(1);
    // which consonants hold each articulator: approaching (from the ramp's start to t1; fully from t0)
    // or returning (from t1, over the ramp out and the return). When two compete, a closure wins over
    // any other constriction, then the more anterior place
    for (let g = 0; g < this.gCount; g++) {
      const rank = this.gRank[g];
      if (rank < 0) continue;
      const lo = this.gT0[g] - this.gRi[g];
      const t1 = this.gT1[g];
      const last = t1 + this.gRo[g] + this.gHold[g];
      if (t + this.gLeadMax[g] <= lo || t + this.gLeadMin[g] > last) continue;
      const kc = this.gKeyCount[g];
      const base = g * GESTURE_KEYS;
      for (let q = 0; q < kc; q++) {
        const tg = t + this.gLead[base + q];
        if (tg <= lo || tg > last) continue;
        const approach = tg < t1;
        const sp = approach ? this.gSpeed[g] : this.gRet[g];
        const k = this.gKeys[base + q];
        if (approach) {
          if (rank < rankA[k] || (rank === rankA[k] && sp > speedA[k])) {
            rankA[k] = rank;
            speedA[k] = sp;
          }
          if (tg >= this.gT0[g] && rank < rankF[k]) rankF[k] = rank;
        } else if (rank < rankR[k] || (rank === rankR[k] && sp > speedR[k])) {
          rankR[k] = rank;
          speedR[k] = sp;
        }
      }
    }
    for (let i = 0; i < ARTICULATORS; i++) speed[i] = rankA[i] !== NO_RANK ? speedA[i] : rankR[i] !== NO_RANK ? speedR[i] : 1;
    for (let g = 0; g < this.gCount; g++) {
      const lo = this.gT0[g] - this.gRi[g];
      const t0 = this.gT0[g];
      const t1 = this.gT1[g];
      const ri = this.gRi[g] > 1e-6 ? this.gRi[g] : 1e-6;
      const ro = this.gRo[g];
      if (t + this.gLeadMax[g] <= lo || t + this.gLeadMin[g] >= t1 + ro) continue;
      const str = this.gStr[g];
      const rank = this.gRank[g];
      const kc = this.gKeyCount[g];
      const base = g * GESTURE_KEYS;
      // every key between the ramps: whole, with no cosine
      const whole = t + this.gLeadMin[g] >= t0 && t + this.gLeadMax[g] <= t1;
      for (let q = 0; q < kc; q++) {
        const tg = t + this.gLead[base + q];
        if (tg <= lo || tg >= t1 + ro) continue;
        const k = this.gKeys[base + q];
        // a consonant that outranks this one, fully under way on the same articulator, takes it
        if (rank >= 0 && tg < t1 && k < ARTICULATORS && rank > rankF[k]) continue;
        let act = 1;
        if (whole) {
          // act stays 1
        } else if (tg < t0) act = 0.5 - 0.5 * Math.cos((Math.PI * (tg - lo)) / ri);
        else if (tg > t1) act = 0.5 + 0.5 * Math.cos((Math.PI * (tg - t1)) / (ro > 1e-6 ? ro : 1e-6));
        const w = act * str;
        wsum[k] += w;
        vsum[k] += w * this.gVals[base + q];
      }
    }
    const target = this.target;
    for (let i = 0; i < ARTICULATORS; i++) {
      const base = i === ART.ttX ? restTipX : i === ART.ttY ? restTipY : NEUTRAL[i];
      let tgt = base;
      if (wsum[i] > 0) {
        if (i === ART.velum) tgt = base + Math.min(1, wsum[i] / 2) * (vsum[i] / wsum[i] - base);
        else tgt = (base * BASE_WEIGHT + vsum[i]) / (BASE_WEIGHT + wsum[i]);
      }
      target[i] = tgt;
    }
    const wa = wsum[KEY_ABDUCTION];
    this.abduction = wa > 0 ? (vsum[KEY_ABDUCTION] / wa) * Math.min(1, wa / 2) : 0;
    const wc = wsum[KEY_CLOSURE];
    this.closure = wc > 0 ? (vsum[KEY_CLOSURE] / wc) * Math.min(1, wc / 2) : 0;
    const ws = wsum[KEY_STIFFNESS];
    this.stiffness = ws > 0 ? (vsum[KEY_STIFFNESS] / ws) * Math.min(1, ws) : 0;
  }

  /** A cricothyroid stiffness gesture from t0, full until t1, ramping out over STIFF_RELEASE. */
  private stiffen(t0: number, t1: number): void {
    this.begin();
    this.key(KEY_STIFFNESS, 1);
    this.emit(t0, t1, 0.03, STIFF_RELEASE, 1, 0);
  }
}

/**
 * Each articulator's rate, 1 / tau of its six-stage cascade (dsp/cascade.ts),
 * per second: CHIMERA's natural frequencies (control/articulators.rs:23)
 * with the 98 percent time kept, t98 = 5.834 / w = 12.03 tau.
 */
export const ARTICULATOR_RATE = Float64Array.from(VOCAL_ARTICULATOR_HZ, (hz) => (2 * Math.PI * hz * CASCADE_SETTLE_98) / CRITDAMP_SETTLE_98);
/**
 * How much later, as a fraction of the 98 percent time, the cascade passes
 * half way than CHIMERA's critically damped tracker with the same 98
 * percent time (0.471 against 0.288 of it). Gestures are evaluated this
 * much ahead so the sounds keep their times.
 */
export const CASCADE_LAG = cascadeSettle(CASCADE_ORDER, 0.5) / CASCADE_SETTLE_98 - cascadeSettle(2, 0.5) / CRITDAMP_SETTLE_98;
/**
 * Each consonant's return (release) speed, a factor on its articulators'
 * rates like the approach speeds, after VocalTractLab 2.4's return
 * gestures (manual section 6.1): it governs the whole release movement, one
 * 98 percent time long, whatever vowel follows (CHIMERA held a consonant's
 * speed 45 ms past its ramp out and left the rest of the release to the
 * vowel's rate). Stops and nasals 1.55, an affricate's closure 2.0, the tap
 * 2.8, the rest 1.3: each its approach speed, which MEASURED keeps the
 * vowels' arrival (a glide released at 1 landed its vowel 8 ms later).
 */
const RETURN_SPEED = Float64Array.from(VOCAL_INVENTORY, (d) =>
  d.manner === 'stop' || d.manner === 'nasal' ? 1.55 : d.manner === 'tap' ? 2.8 : d.manner === 'affricate' ? 2.0 : 1.3,
);
/** Each table phoneme's VOT, s (0 for all but stops), from engines/vocal-phonemes.ts. */
const STOP_VOT = Float64Array.from(VOCAL_TABLE_PHONEMES, (ipa) => {
  const i = vocalPhonemeIndex(ipa);
  return i >= 0 ? VOCAL_ACOUSTICS[i].vot : 0;
});
/** The rest posture as doubles in a typed array (a plain array of mixed literals can box its reads). */
const NEUTRAL = Float64Array.from(VOCAL_NEUTRAL);
/** Each articulator's range. */
export const ARTICULATOR_MIN = Float64Array.from(VOCAL_ARTICULATOR_MIN);
export const ARTICULATOR_MAX = Float64Array.from(VOCAL_ARTICULATOR_MAX);
/**
 * The lips stop closing here (template cm of aperture, scaled by k in the
 * geometry): CHIMERA's closure target, the most the lips are compressed.
 */
export const LIP_COMPRESSED = -0.25;
/**
 * A bilabial closure's virtual target, past LIP_COMPRESSED: the lips meet
 * moving near their fastest and compress (Lofqvist and Gracco 1997), and
 * the contact holds them while their motion carries on toward it.
 */
export const LIP_VIRTUAL = -1.0;
/** The lowest target each articulator may be given: its range, but the lips may aim at LIP_VIRTUAL. */
export const ARTICULATOR_TARGET_MIN = Float64Array.from(VOCAL_ARTICULATOR_MIN, (v, i) => (i === ART.lipAp ? Math.min(v, LIP_VIRTUAL) : v));

/** CHIMERA's rest tip for a jaw and tongue body (articulators.rs:110, anatomy/human.rs:443), into out[0], out[1]. */
/** restTip() of the jaw and tongue body in an articulator array a: no double crosses the call. */
export function restTipFrom(a: Float64Array, out: Float64Array): void {
  const ang = -a[ART.jaw] / 9.84;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  out[0] = -2.5 + 8.95 * c + 3.15 * s + 0.3 * (a[ART.tbX] - 2.9);
  out[1] = 10.5 + 8.95 * s - 3.15 * c + 0.35 * (a[ART.tbY] - 6.85);
}

export function restTip(jaw: number, tbX: number, tbY: number, out: Float64Array): void {
  const cx = -2.5;
  const cy = 10.5;
  const ang = -jaw / 9.84;
  const dx = 6.45 - cx;
  const dy = 7.35 - cy;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  out[0] = cx + dx * c - dy * s + 0.3 * (tbX - 2.9);
  out[1] = cy + dx * s + dy * c + 0.35 * (tbY - 6.85);
}
