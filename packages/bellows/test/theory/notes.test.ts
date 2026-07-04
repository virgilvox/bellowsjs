import { describe, expect, it } from 'vitest';
import {
  intervalName,
  mod12,
  noteName,
  octaveOf,
  parseNote,
  parsePitchClass,
  pitchClass,
  pitchClassName,
} from '../../src/theory/notes';

describe('parseNote', () => {
  it('maps C4 to 60', () => {
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('A4')).toBe(69);
    expect(parseNote('C-1')).toBe(0);
    expect(parseNote('G9')).toBe(127);
  });

  it('handles sharps and flats', () => {
    expect(parseNote('C#4')).toBe(61);
    expect(parseNote('Db4')).toBe(61);
    expect(parseNote('Db-1')).toBe(1);
    expect(parseNote('Bb2')).toBe(46);
    expect(parseNote('F#3')).toBe(54);
  });

  it('handles double accidentals and lowercase letters', () => {
    expect(parseNote('C##4')).toBe(62);
    expect(parseNote('Ebb3')).toBe(50);
    expect(parseNote('g3')).toBe(55);
  });

  it('rejects malformed input', () => {
    expect(() => parseNote('H4')).toThrow();
    expect(() => parseNote('C')).toThrow();
    expect(() => parseNote('4C')).toThrow();
    expect(() => parseNote('')).toThrow();
  });
});

describe('noteName', () => {
  it('spells with sharps by default and flats on request', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(61, true)).toBe('Db4');
    expect(noteName(1, true)).toBe('Db-1');
  });

  it('round trips every midi note in both spellings', () => {
    for (let m = 0; m <= 127; m++) {
      expect(parseNote(noteName(m))).toBe(m);
      expect(parseNote(noteName(m, true))).toBe(m);
    }
  });
});

describe('pitch class helpers', () => {
  it('extracts pitch class and octave', () => {
    expect(pitchClass(61)).toBe(1);
    expect(pitchClass(0)).toBe(0);
    expect(octaveOf(60)).toBe(4);
    expect(octaveOf(59)).toBe(3);
    expect(octaveOf(0)).toBe(-1);
  });

  it('mod12 handles negatives', () => {
    expect(mod12(-1)).toBe(11);
    expect(mod12(-13)).toBe(11);
    expect(mod12(12)).toBe(0);
  });

  it('parses pitch class names', () => {
    expect(parsePitchClass('C')).toBe(0);
    expect(parsePitchClass('F#')).toBe(6);
    expect(parsePitchClass('Bb')).toBe(10);
    expect(parsePitchClass('Cb')).toBe(11);
    expect(parsePitchClass('B#')).toBe(0);
    expect(() => parsePitchClass('X')).toThrow();
    expect(() => parsePitchClass('C4')).toThrow();
  });

  it('names pitch classes', () => {
    expect(pitchClassName(6)).toBe('F#');
    expect(pitchClassName(6, true)).toBe('Gb');
    expect(pitchClassName(13)).toBe('C#');
  });
});

describe('intervalName', () => {
  it('names simple intervals', () => {
    expect(intervalName(0)).toBe('P1');
    expect(intervalName(1)).toBe('m2');
    expect(intervalName(6)).toBe('A4');
    expect(intervalName(7)).toBe('P5');
    expect(intervalName(11)).toBe('M7');
  });

  it('names compound intervals', () => {
    expect(intervalName(12)).toBe('P8');
    expect(intervalName(14)).toBe('M9');
    expect(intervalName(19)).toBe('P12');
    expect(intervalName(24)).toBe('P15');
  });

  it('uses the magnitude of a descending interval', () => {
    expect(intervalName(-7)).toBe('P5');
  });
});
