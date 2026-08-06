import { describe, expect, it } from 'vitest';
import {
  CHORD_TYPES,
  chord,
  chordName,
  chordToRoman,
  detectChord,
  diatonicSevenths,
  diatonicTriads,
  parseChord,
  romanToChord,
} from '../../src/theory/chords';
import { SCALES, Scale } from '../../src/theory/scales';

describe('CHORD_TYPES', () => {
  it('covers the required set', () => {
    const required = [
      'maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'maj7', 'm7', '7', 'dim7',
      'm7b5', 'mMaj7', 'maj9', 'm9', '9', 'add9', '6', 'm6', '11', '13',
      '7b9', '7#9', '7#11', 'aug7', 'maj7#5',
    ];
    for (const key of required) expect(CHORD_TYPES[key], key).toBeDefined();
  });

  it('has the augmented major seventh, which harmonic minor produces', () => {
    expect(CHORD_TYPES['maj7#5']).toEqual([0, 4, 8, 11]);
    const sevenths = diatonicSevenths(new Scale('C', 'harmonic minor'));
    expect(sevenths.map((c) => c.type)).toEqual([
      'mMaj7', 'm7b5', 'maj7#5', 'm7', '7', 'maj7', 'dim7',
    ]);
    expect(sevenths[2].midi(4)).toEqual([63, 67, 71, 74]);
    expect(detectChord([0, 4, 8, 11])).toBe('Cmaj7#5');
    expect(parseChord('Cmaj7#5').type).toBe('maj7#5');
    expect(chordName(parseChord('Cmaj7#5'))).toBe('Cmaj7#5');
  });

  it('adding it did not move the neighbouring detections', () => {
    expect(detectChord([0, 4, 8, 10])).toBe('Caug7');
    expect(detectChord([0, 4, 7, 11])).toBe('Cmaj7');
    expect(detectChord([0, 4, 8])).toBe('Caug');
  });

  it('every type starts at the root', () => {
    for (const [name, intervals] of Object.entries(CHORD_TYPES)) {
      expect(intervals[0], name).toBe(0);
    }
  });
});

describe('parseChord', () => {
  it('parses plain triads', () => {
    const c = parseChord('C');
    expect(c.root).toBe(0);
    expect(c.type).toBe('maj');
    expect(c.midi(4)).toEqual([60, 64, 67]);
    expect(parseChord('Am').midi(4)).toEqual([69, 72, 76]);
  });

  it('parses accidentals and extended types', () => {
    const c = parseChord('F#m7b5');
    expect(c.root).toBe(6);
    expect(c.type).toBe('m7b5');
    expect(c.midi(3)).toEqual([54, 57, 60, 64]);
    expect(parseChord('Ebmaj7').root).toBe(3);
    expect(parseChord('Bb7').midi(3)).toEqual([58, 62, 65, 68]);
    expect(parseChord('CmMaj7').type).toBe('mMaj7');
    expect(parseChord('G7#9').type).toBe('7#9');
  });

  it('rejects unknown symbols', () => {
    expect(() => parseChord('Cxyz')).toThrow();
    expect(() => parseChord('H7')).toThrow();
    expect(() => parseChord('')).toThrow();
  });

  it('chord() builds from root and type, chordName formats', () => {
    const c = chord(6, 'm7b5');
    expect(chordName(c)).toBe('F#m7b5');
    expect(chordName(c, true)).toBe('Gbm7b5');
    expect(chordName(parseChord('Cm'))).toBe('Cm');
    expect(() => chord(0, 'nope')).toThrow();
  });
});

describe('detectChord', () => {
  it('names root position chords', () => {
    expect(detectChord([0, 4, 7])).toBe('C');
    expect(detectChord([9, 0, 4])).toBe('Am');
    expect(detectChord([7, 11, 2, 5])).toBe('G7');
    expect(detectChord([2, 5, 9, 0])).toBe('Dm7');
    expect(detectChord([0, 4, 8])).toBe('Caug');
  });

  it('prefers the bass as root on ambiguous sets', () => {
    // C6 and Am7 share pitch classes
    expect(detectChord([0, 4, 7, 9])).toBe('C6');
    expect(detectChord([9, 0, 4, 7])).toBe('Am7');
    // fully symmetric dim7 names from the bass
    expect(detectChord([0, 3, 6, 9])).toBe('Cdim7');
    expect(detectChord([3, 6, 9, 0])).toBe('D#dim7');
  });

  it('returns null when nothing matches', () => {
    expect(detectChord([0, 1, 2])).toBeNull();
    expect(detectChord([])).toBeNull();
  });
});

describe('diatonic chords', () => {
  it('builds C major triads', () => {
    const triads = diatonicTriads(new Scale('C', 'major'));
    expect(triads.map((c) => c.type)).toEqual(['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']);
    expect(triads.map((c) => c.root)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(triads[0].midi(4)).toEqual([60, 64, 67]);
    expect(triads[6].midi(4)).toEqual([71, 74, 77]);
  });

  it('builds C major sevenths', () => {
    const sevenths = diatonicSevenths(new Scale('C', 'major'));
    expect(sevenths.map((c) => c.type)).toEqual(['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5']);
  });

  it('builds D dorian triads', () => {
    const triads = diatonicTriads(new Scale('D', 'dorian'));
    expect(triads.map((c) => chordName(c))).toEqual(['Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C']);
  });

  it('builds A harmonic minor triads', () => {
    const triads = diatonicTriads(new Scale('A', 'harmonic minor'));
    expect(triads.map((c) => c.type)).toEqual(['min', 'dim', 'aug', 'min', 'maj', 'maj', 'dim']);
  });
});

describe('roman numerals', () => {
  const cMajor = new Scale('C', 'major');
  const dDorian = new Scale('D', 'dorian');

  it('romanToChord resolves degree and quality', () => {
    const v7 = romanToChord('V7', cMajor);
    expect(v7.root).toBe(7);
    expect(v7.type).toBe('7');
    const ii = romanToChord('ii', cMajor);
    expect(ii.root).toBe(2);
    expect(ii.type).toBe('min');
    const dim = romanToChord('viio7', cMajor);
    expect(dim.root).toBe(11);
    expect(dim.type).toBe('dim7');
    expect(romanToChord('iiø7', cMajor).type).toBe('m7b5');
    expect(romanToChord('IVsus4', cMajor).type).toBe('sus4');
    expect(romanToChord('imaj7', cMajor).type).toBe('mMaj7');
  });

  it('handles accidental prefixes', () => {
    expect(romanToChord('bVII', cMajor).root).toBe(10);
    expect(romanToChord('bII', cMajor).root).toBe(1);
    expect(romanToChord('#IV', cMajor).root).toBe(6);
  });

  it('rejects malformed numerals', () => {
    expect(() => romanToChord('VIII', cMajor)).toThrow();
    expect(() => romanToChord('Iv', cMajor)).toThrow();
    expect(() => romanToChord('V99', cMajor)).toThrow();
  });

  it('chordToRoman uses case and quality symbols', () => {
    expect(chordToRoman(parseChord('C'), cMajor)).toBe('I');
    expect(chordToRoman(parseChord('Dm'), cMajor)).toBe('ii');
    expect(chordToRoman(parseChord('G7'), cMajor)).toBe('V7');
    expect(chordToRoman(parseChord('Bdim'), cMajor)).toBe('viio');
    expect(chordToRoman(parseChord('Bdim7'), cMajor)).toBe('viio7');
    expect(chordToRoman(parseChord('Bm7b5'), cMajor)).toBe('viiø7');
    expect(chordToRoman(parseChord('Caug'), cMajor)).toBe('I+');
  });

  it('analyzes in D dorian', () => {
    expect(chordToRoman(parseChord('Dm'), dDorian)).toBe('i');
    expect(chordToRoman(parseChord('G'), dDorian)).toBe('IV');
    expect(chordToRoman(parseChord('C'), dDorian)).toBe('VII');
    expect(chordToRoman(parseChord('Bdim'), dDorian)).toBe('vio');
  });

  it('marks chromatic roots with accidentals', () => {
    expect(chordToRoman(parseChord('Bb'), cMajor)).toBe('bVII');
    expect(chordToRoman(parseChord('Db'), cMajor)).toBe('bII');
  });

  it('spells chromatic roots by the line of fifths, sharp side included', () => {
    // The raised fourth is the one sharp side of a major key: F# is six
    // fifths up from C and Gb six down, and practice takes the sharp.
    const all = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    expect(all.map((n) => chordToRoman(parseChord(n), cMajor))).toEqual([
      'I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII',
    ]);
    // Same scale a fifth up: the sharp lands on the new fourth degree.
    const gMajor = new Scale('G', 'major');
    expect(chordToRoman(parseChord('C#'), gMajor)).toBe('#IV');
    expect(chordToRoman(parseChord('F#'), gMajor)).toBe('VII');
    // Against a natural minor the raised sixth and seventh are sharps, not
    // a second flat spelling of degrees the scale already lowers.
    const aMinor = new Scale('A', 'minor');
    expect(chordToRoman(parseChord('F#dim'), aMinor)).toBe('#vio');
    expect(chordToRoman(parseChord('G#dim'), aMinor)).toBe('#viio');
    expect(chordToRoman(parseChord('Bb'), aMinor)).toBe('bII');
  });

  it('analyses every shipped scale, including those past seven degrees', () => {
    const numeralOf = (s: string) => /^[b#]?([ivxlIVXL]+)/.exec(s)![1].toUpperCase();
    let analysed = 0;
    for (const name of Object.keys(SCALES)) {
      const scale = new Scale('C', name);
      const numerals = diatonicTriads(scale).map((ch) => chordToRoman(ch, scale));
      expect(numerals, name).toHaveLength(scale.length);
      analysed += numerals.length;
    }
    // 34 scale entries, 232 degrees between them, none of which may throw.
    expect(analysed).toBe(232);

    const bebop = new Scale('C', 'bebop dominant');
    expect(diatonicTriads(bebop).map((ch) => numeralOf(chordToRoman(ch, bebop)))).toEqual([
      'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII',
    ]);
    const chromatic = new Scale('C', 'chromatic');
    expect(diatonicTriads(chromatic).map((ch) => numeralOf(chordToRoman(ch, chromatic)))).toEqual([
      'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
    ]);
    expect(romanToChord('VIII', bebop).root).toBe(11);
    expect(romanToChord('XII', chromatic).root).toBe(11);
    expect(() => romanToChord('XIII', chromatic)).toThrow(/out of range/);
    expect(() => romanToChord('IIII', chromatic)).toThrow(/invalid roman numeral/);
    expect(() => romanToChord('VV', chromatic)).toThrow(/invalid roman numeral/);
  });

  it('says what is actually wrong when no degree is within a semitone', () => {
    // hirajoshi is 0 2 3 7 8: F sits two semitones from either neighbour.
    const hira = new Scale('C', 'hirajoshi');
    let message = '';
    try {
      chordToRoman(parseChord('F'), hira);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe('chord root is not a scale degree or a semitone from one: 5');
  });

  it('round trips every chromatic root it can name, in every shipped scale', () => {
    let checked = 0;
    for (const name of Object.keys(SCALES)) {
      const scale = new Scale('C', name);
      for (let pc = 0; pc < 12; pc++) {
        const ch = chord(pc, 'maj');
        let numeral: string;
        try {
          numeral = chordToRoman(ch, scale);
        } catch {
          continue; // gap wider than a semitone, covered by the test above
        }
        const back = romanToChord(numeral, scale);
        expect(back.root, name + ' ' + numeral).toBe(pc);
        expect(back.type, name + ' ' + numeral).toBe('maj');
        checked++;
      }
    }
    // 34 scales x 12 roots, less the 6 the four Japanese pentatonics cannot
    // spell with a single accidental.
    expect(checked).toBe(402);
  });

  it('round trips diatonic sevenths through roman numerals', () => {
    for (const ch of diatonicSevenths(cMajor)) {
      const numeral = chordToRoman(ch, cMajor);
      const back = romanToChord(numeral, cMajor);
      expect(back.root).toBe(ch.root);
      expect(back.type).toBe(ch.type);
    }
  });
});
