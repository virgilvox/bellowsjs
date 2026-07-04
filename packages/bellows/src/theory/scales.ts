/*
 * Scale definitions and the Scale class. Intervals are semitone offsets
 * from the root within one octave, always starting at 0 and strictly
 * increasing.
 */

import { mod12, octaveOf, parseNote, parsePitchClass } from './notes';

export const SCALES: Record<string, readonly number[]> = {
  // church modes
  'major': [0, 2, 4, 5, 7, 9, 11],
  'ionian': [0, 2, 4, 5, 7, 9, 11],
  'dorian': [0, 2, 3, 5, 7, 9, 10],
  'phrygian': [0, 1, 3, 5, 7, 8, 10],
  'lydian': [0, 2, 4, 6, 7, 9, 11],
  'mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'minor': [0, 2, 3, 5, 7, 8, 10],
  'aeolian': [0, 2, 3, 5, 7, 8, 10],
  'locrian': [0, 1, 3, 5, 6, 8, 10],
  // harmonic minor and its useful modes
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
  'ukrainian dorian': [0, 2, 3, 6, 7, 9, 10],
  // melodic minor and its useful modes
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  'lydian dominant': [0, 2, 4, 6, 7, 9, 10],
  'altered': [0, 1, 3, 4, 6, 8, 10],
  // pentatonic and blues
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'blues': [0, 3, 5, 6, 7, 10],
  // bebop
  'bebop dominant': [0, 2, 4, 5, 7, 9, 10, 11],
  'bebop major': [0, 2, 4, 5, 7, 8, 9, 11],
  // symmetric
  'whole tone': [0, 2, 4, 6, 8, 10],
  'octatonic half-whole': [0, 1, 3, 4, 6, 7, 9, 10],
  'octatonic whole-half': [0, 2, 3, 5, 6, 8, 9, 11],
  'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  // Japanese pentatonics
  'hirajoshi': [0, 2, 3, 7, 8],
  'in-sen': [0, 1, 5, 7, 10],
  'iwato': [0, 1, 5, 6, 10],
  'kumoi': [0, 2, 3, 7, 9],
  // others
  'double harmonic': [0, 1, 4, 5, 7, 8, 11],
  'hungarian minor': [0, 2, 3, 6, 7, 8, 11],
  'neapolitan major': [0, 1, 3, 5, 7, 9, 11],
  'neapolitan minor': [0, 1, 3, 5, 7, 8, 11],
  'prometheus': [0, 2, 4, 6, 9, 10],
  'enigmatic': [0, 1, 4, 6, 8, 10, 11],
};

/**
 * A rooted scale. The root can be a pitch class name ('F#'), a full note
 * name ('C4', which also sets the default octave), a pitch class number
 * 0..11, or a midi number (12 and up, which also sets the default octave).
 */
export class Scale {
  readonly rootPc: number;
  readonly name: string;
  readonly intervals: number[];
  readonly length: number;
  private readonly defaultOctave: number;
  /** Membership per pitch class relative to the root. */
  private readonly mask: boolean[];

  constructor(root: number | string, name: string) {
    const intervals = SCALES[name];
    if (!intervals) throw new Error('unknown scale: ' + name);
    if (typeof root === 'string') {
      if (/\d/.test(root)) {
        const midi = parseNote(root);
        this.rootPc = mod12(midi);
        this.defaultOctave = octaveOf(midi);
      } else {
        this.rootPc = parsePitchClass(root);
        this.defaultOctave = 4;
      }
    } else {
      this.rootPc = mod12(root);
      this.defaultOctave = root >= 12 || root < 0 ? octaveOf(root) : 4;
    }
    this.name = name;
    this.intervals = intervals.slice();
    this.length = intervals.length;
    this.mask = new Array<boolean>(12).fill(false);
    for (const iv of intervals) this.mask[mod12(iv)] = true;
  }

  /**
   * Midi note for a scale degree. Degree 0 is the root; degrees wrap into
   * neighboring octaves, so degree -1 is the top of the octave below and
   * degree `length` is the root an octave up.
   */
  degreeToMidi(degree: number, octave = this.defaultOctave): number {
    const n = this.length;
    const wrap = Math.floor(degree / n);
    const idx = degree - wrap * n;
    return (octave + 1) * 12 + this.rootPc + this.intervals[idx] + wrap * 12;
  }

  /** True when the note's pitch class belongs to the scale. */
  contains(midi: number): boolean {
    return this.mask[mod12(midi - this.rootPc)];
  }

  /** Nearest scale tone to a midi note. Ties resolve downward. */
  quantize(midi: number): number {
    if (this.contains(midi)) return midi;
    for (let d = 1; d <= 6; d++) {
      if (this.contains(midi - d)) return midi - d;
      if (this.contains(midi + d)) return midi + d;
    }
    return midi;
  }

  /** All degrees over a span of octaves, ascending from the base octave. */
  degrees(octaves: number, baseOctave = this.defaultOctave): number[] {
    const out: number[] = [];
    const count = octaves * this.length;
    for (let i = 0; i < count; i++) out.push(this.degreeToMidi(i, baseOctave));
    return out;
  }
}
