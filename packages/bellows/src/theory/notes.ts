/*
 * Note names, pitch classes, and interval names. MIDI convention: C4 = 60.
 * Accidentals are plain ASCII: '#' for sharp, 'b' for flat, doubled for
 * double accidentals ('C##4', 'Ebb3').
 */

const LETTER_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Pitch class spellings using sharps. */
export const SHARP_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** Pitch class spellings using flats. */
export const FLAT_NAMES = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

/** Positive modulo 12. */
export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Pitch class (0..11) of a midi note. */
export function pitchClass(midi: number): number {
  return mod12(midi);
}

/** Octave number of a midi note. C4 = 60, so octaveOf(60) = 4. */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

const NOTE_RE = /^([A-Ga-g])([#b]*)(-?\d+)$/;
const PC_RE = /^([A-Ga-g])([#b]*)$/;

function accidentalOffset(acc: string): number {
  let off = 0;
  for (let i = 0; i < acc.length; i++) off += acc[i] === '#' ? 1 : -1;
  return off;
}

/** Parse a pitch class name like 'C', 'F#', 'Bb' to 0..11. */
export function parsePitchClass(name: string): number {
  const m = PC_RE.exec(name);
  if (!m) throw new Error('invalid pitch class: ' + name);
  return mod12(LETTER_PC[m[1].toUpperCase()] + accidentalOffset(m[2]));
}

/** Parse a note name with octave ('C#4', 'Db-1', 'g3') to a midi number. */
export function parseNote(name: string): number {
  const m = NOTE_RE.exec(name);
  if (!m) throw new Error('invalid note: ' + name);
  const pc = LETTER_PC[m[1].toUpperCase()] + accidentalOffset(m[2]);
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + pc;
}

/** Name a pitch class, sharp spelling by default. */
export function pitchClassName(pc: number, preferFlats = false): string {
  const i = mod12(pc);
  return preferFlats ? FLAT_NAMES[i] : SHARP_NAMES[i];
}

/** Name a midi note with octave, e.g. noteName(61) = 'C#4'. */
export function noteName(midi: number, preferFlats = false): string {
  return pitchClassName(mod12(midi), preferFlats) + octaveOf(midi);
}

/**
 * Interval names for 0..11 semitones. The tritone is spelled A4 so that
 * compound intervals extend cleanly (A4 + octave = A11).
 */
export const INTERVAL_NAMES = [
  'P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'A4', 'P5', 'm6', 'M6', 'm7', 'M7',
] as const;

/**
 * Name an interval in semitones. Compound intervals bump the degree by 7
 * per octave: 12 = P8, 14 = M9, 19 = P12. Negative input is named by its
 * magnitude.
 */
export function intervalName(semitones: number): string {
  const s = Math.abs(Math.round(semitones));
  const octaves = Math.floor(s / 12);
  const simple = INTERVAL_NAMES[s % 12];
  if (octaves === 0) return simple;
  const quality = simple[0];
  const degree = parseInt(simple.slice(1), 10);
  return quality + (degree + 7 * octaves);
}
