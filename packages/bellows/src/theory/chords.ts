/*
 * Chord types, chord symbol parsing, chord detection, diatonic chords,
 * and roman numeral analysis.
 */

import { mod12, parsePitchClass, pitchClassName } from './notes';
import type { Scale } from './scales';

/**
 * Chord interval sets. Record order doubles as the preference order for
 * detectChord: earlier entries win ties.
 */
export const CHORD_TYPES: Record<string, readonly number[]> = {
  'maj': [0, 4, 7],
  'min': [0, 3, 7],
  '7': [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10],
  'dim': [0, 3, 6],
  'aug': [0, 4, 8],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'dim7': [0, 3, 6, 9],
  'm7b5': [0, 3, 6, 10],
  'mMaj7': [0, 3, 7, 11],
  '6': [0, 4, 7, 9],
  'm6': [0, 3, 7, 9],
  'add9': [0, 4, 7, 14],
  'maj9': [0, 4, 7, 11, 14],
  'm9': [0, 3, 7, 10, 14],
  '9': [0, 4, 7, 10, 14],
  '11': [0, 4, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
  '7#11': [0, 4, 7, 10, 18],
  'aug7': [0, 4, 8, 10],
};

/** Aliases accepted by parseChord on top of the CHORD_TYPES keys. */
const TYPE_ALIASES: Record<string, string> = {
  '': 'maj',
  'M': 'maj',
  'm': 'min',
  'min': 'min',
  'mmaj7': 'mMaj7',
  'mM7': 'mMaj7',
};

export interface Chord {
  /** Root pitch class 0..11. */
  readonly root: number;
  /** Key into CHORD_TYPES, or '?' for a stack with no named type. */
  readonly type: string;
  /** Semitone offsets from the root. */
  readonly intervals: readonly number[];
  /** Midi notes with the root placed in the given octave (default 4). */
  midi(octave?: number): number[];
}

/** Build a chord from a root pitch class and a CHORD_TYPES key. */
export function chord(root: number, type: string): Chord {
  const intervals = CHORD_TYPES[type];
  if (!intervals) throw new Error('unknown chord type: ' + type);
  return makeChord(mod12(root), type, intervals);
}

function makeChord(root: number, type: string, intervals: readonly number[]): Chord {
  return {
    root,
    type,
    intervals,
    midi(octave = 4): number[] {
      const base = (octave + 1) * 12 + root;
      return intervals.map((iv) => base + iv);
    },
  };
}

const CHORD_RE = /^([A-Ga-g])([#b]*)(.*)$/;

/** Parse a chord symbol like 'F#m7b5', 'Ebmaj7', 'Am', 'C'. */
export function parseChord(symbol: string): Chord {
  const m = CHORD_RE.exec(symbol);
  if (!m) throw new Error('invalid chord symbol: ' + symbol);
  const root = parsePitchClass(m[1] + m[2]);
  const rest = m[3];
  const type = TYPE_ALIASES[rest] ?? (CHORD_TYPES[rest] ? rest : undefined);
  if (!type) throw new Error('unknown chord type in symbol: ' + symbol);
  return chord(root, type);
}

/** Chord symbol suffix for a type key ('maj' prints as '', 'min' as 'm'). */
function typeSuffix(type: string): string {
  if (type === 'maj') return '';
  if (type === 'min') return 'm';
  return type;
}

/** Format a chord as a symbol, e.g. chordName(chord(6, 'm7b5')) = 'F#m7b5'. */
export function chordName(ch: Chord, preferFlats = false): string {
  return pitchClassName(ch.root, preferFlats) + typeSuffix(ch.type);
}

/**
 * Name the chord spelled by a set of pitch classes, or null when no known
 * type matches exactly. The first element is treated as the bass and its
 * pitch class is preferred as root when several roots fit.
 */
export function detectChord(pitchClasses: readonly number[], preferFlats = false): string | null {
  const pcs: number[] = [];
  for (const p of pitchClasses) {
    const pc = mod12(p);
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  if (pcs.length === 0) return null;
  const typeKeys = Object.keys(CHORD_TYPES);
  let best: { root: number; type: string } | null = null;
  let bestScore = Infinity;
  for (const root of pcs) {
    for (let t = 0; t < typeKeys.length; t++) {
      const intervals = CHORD_TYPES[typeKeys[t]];
      if (intervals.length !== pcs.length) continue;
      let match = true;
      for (const iv of intervals) {
        if (!pcs.includes(mod12(root + iv))) {
          match = false;
          break;
        }
      }
      if (!match) continue;
      const score = (root === pcs[0] ? 0 : 100) + t;
      if (score < bestScore) {
        bestScore = score;
        best = { root, type: typeKeys[t] };
      }
    }
  }
  return best ? chordName(makeChord(best.root, best.type, CHORD_TYPES[best.type]), preferFlats) : null;
}

/** Identify the type of an interval stack, or '?' when nothing matches. */
function stackType(rel: number[]): string {
  for (const key of Object.keys(CHORD_TYPES)) {
    const iv = CHORD_TYPES[key];
    if (iv.length !== rel.length) continue;
    let same = true;
    for (let i = 0; i < iv.length; i++) {
      if (iv[i] !== rel[i]) {
        same = false;
        break;
      }
    }
    if (same) return key;
  }
  return '?';
}

/** Build the chord on a scale degree by stacking scale thirds. */
function stackedChord(scale: Scale, degree: number, notes: number): Chord {
  const root = scale.degreeToMidi(degree);
  const rel: number[] = [];
  for (let i = 0; i < notes; i++) rel.push(scale.degreeToMidi(degree + 2 * i) - root);
  return makeChord(mod12(root), stackType(rel), rel);
}

/** Triads on every degree of a scale. */
export function diatonicTriads(scale: Scale): Chord[] {
  const out: Chord[] = [];
  for (let d = 0; d < scale.length; d++) out.push(stackedChord(scale, d, 3));
  return out;
}

/** Seventh chords on every degree of a scale. */
export function diatonicSevenths(scale: Scale): Chord[] {
  const out: Chord[] = [];
  for (let d = 0; d < scale.length; d++) out.push(stackedChord(scale, d, 4));
  return out;
}

/* ------------------------------------------------------------------ */
/* Roman numerals                                                      */
/* ------------------------------------------------------------------ */

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/** True when the chord has a minor or diminished third above its root. */
function isMinorish(intervals: readonly number[]): boolean {
  return intervals.includes(3) && !intervals.includes(4);
}

/** Suffix map used by chordToRoman. Case carries major/minor. */
const ROMAN_SUFFIX: Record<string, string> = {
  'maj': '',
  'min': '',
  'dim': 'o',
  'aug': '+',
  '7': '7',
  'm7': '7',
  'maj7': 'maj7',
  'mMaj7': 'maj7',
  'dim7': 'o7',
  'm7b5': 'ø7',
  'aug7': '+7',
  '6': '6',
  'm6': '6',
  '9': '9',
  'm9': '9',
};

/**
 * Roman numeral for a chord in a scale: lowercase for minor and diminished
 * qualities, 'o' for diminished, 'ø' for half diminished, '+' for
 * augmented. Chromatic roots take a 'b' or '#' prefix relative to the
 * nearest degree.
 */
export function chordToRoman(ch: Chord, scale: Scale): string {
  let accidental = '';
  let degree = -1;
  const degreePc = (d: number) => mod12(scale.degreeToMidi(d));
  for (let d = 0; d < scale.length; d++) {
    if (degreePc(d) === ch.root) {
      degree = d;
      break;
    }
  }
  if (degree < 0) {
    for (let d = 0; d < scale.length; d++) {
      if (mod12(degreePc(d) - 1) === ch.root) {
        degree = d;
        accidental = 'b';
        break;
      }
    }
  }
  if (degree < 0) {
    for (let d = 0; d < scale.length; d++) {
      if (mod12(degreePc(d) + 1) === ch.root) {
        degree = d;
        accidental = '#';
        break;
      }
    }
  }
  if (degree < 0 || degree >= ROMANS.length) {
    throw new Error('chord root does not map to a scale degree');
  }
  const numeral = isMinorish(ch.intervals) ? ROMANS[degree].toLowerCase() : ROMANS[degree];
  const suffix = ROMAN_SUFFIX[ch.type] ?? ch.type;
  return accidental + numeral + suffix;
}

const ROMAN_RE = /^([b#]?)([ivIV]+)(.*)$/;

function romanDegree(numeral: string): number {
  const idx = ROMANS.indexOf(numeral.toUpperCase() as (typeof ROMANS)[number]);
  if (idx < 0) throw new Error('invalid roman numeral: ' + numeral);
  return idx;
}

function romanSuffixType(suffix: string, lower: boolean): string {
  switch (suffix) {
    case '': return lower ? 'min' : 'maj';
    case 'o':
    case 'dim': return 'dim';
    case 'o7':
    case 'dim7': return 'dim7';
    case 'ø':
    case 'ø7': return 'm7b5';
    case '+': return 'aug';
    case '+7': return 'aug7';
    case '7': return lower ? 'm7' : '7';
    case '9': return lower ? 'm9' : '9';
    case '6': return lower ? 'm6' : '6';
    case 'maj7': return lower ? 'mMaj7' : 'maj7';
    default:
      if (CHORD_TYPES[suffix]) return suffix;
      throw new Error('unknown roman numeral suffix: ' + suffix);
  }
}

/**
 * Chord for a roman numeral in a scale: 'V7', 'ii', 'viio7', 'bVII',
 * 'IVsus4'. Case sets major/minor when the suffix does not.
 */
export function romanToChord(numeral: string, scale: Scale): Chord {
  const m = ROMAN_RE.exec(numeral);
  if (!m) throw new Error('invalid roman numeral: ' + numeral);
  const base = m[2];
  if (base !== base.toLowerCase() && base !== base.toUpperCase()) {
    throw new Error('mixed case roman numeral: ' + numeral);
  }
  const lower = base === base.toLowerCase();
  const degree = romanDegree(base);
  if (degree >= scale.length) throw new Error('degree out of range for scale: ' + numeral);
  const offset = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const root = mod12(scale.degreeToMidi(degree) + offset);
  return chord(root, romanSuffixType(m[3], lower));
}
