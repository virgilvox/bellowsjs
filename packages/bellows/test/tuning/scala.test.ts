import { describe, expect, it } from 'vitest';
import { parseScl, parseKbm, tuningFromScala } from '../../src/theory/scala';
import { mtof } from '../../src/types';

/* 5-limit just major, with comments, blank lines, and trailing text. */
const JI_MAJOR_SCL = [
  '! major_ji.scl',
  '!',
  '5-limit just intonation major',
  ' 7',
  '!',
  '',
  ' 9/8',
  ' 5/4  just third',
  ' 4/3',
  '',
  ' 3/2',
  ' 5/3',
  ' 15/8',
  ' 2/1',
].join('\n');

/* 22-EDO written as cents lines. */
const EDO22_SCL = [
  '! 22edo.scl',
  '22 tone equal temperament',
  '22',
  ...Array.from({ length: 22 }, (_, i) => ((1200 * (i + 1)) / 22).toFixed(5)),
].join('\n');

describe('parseScl', () => {
  it('parses the 5-limit just major fixture', () => {
    const scl = parseScl(JI_MAJOR_SCL);
    expect(scl.description).toBe('5-limit just intonation major');
    expect(scl.size).toBe(7);
    expect(scl.notes).toHaveLength(7);
    expect(scl.notes[0]).toBeCloseTo(1200 * Math.log2(9 / 8), 9);
    expect(scl.notes[1]).toBeCloseTo(1200 * Math.log2(5 / 4), 9);
    expect(scl.notes[3]).toBeCloseTo(1200 * Math.log2(3 / 2), 9);
    expect(scl.notes[6]).toBe(1200);
  });

  it('parses the 22-EDO cents fixture', () => {
    const scl = parseScl(EDO22_SCL);
    expect(scl.description).toBe('22 tone equal temperament');
    expect(scl.size).toBe(22);
    for (let i = 0; i < 22; i++) {
      expect(Math.abs(scl.notes[i] - (1200 * (i + 1)) / 22)).toBeLessThan(1e-4);
    }
  });

  it('treats a bare integer as a ratio over 1', () => {
    const scl = parseScl('one note\n1\n2');
    expect(scl.notes[0]).toBe(1200);
  });

  it('allows a blank description line', () => {
    const scl = parseScl('! comment first\n\n2\n100.0\n1200.0');
    expect(scl.description).toBe('');
    expect(scl.size).toBe(2);
    expect(scl.notes[0]).toBe(100);
  });

  it('accepts cents like "700." and negative cents', () => {
    const scl = parseScl('d\n2\n700.\n-3.5');
    expect(scl.notes[0]).toBe(700);
    expect(scl.notes[1]).toBe(-3.5);
  });

  it('rejects a malformed note count', () => {
    expect(() => parseScl('desc\nabc\n')).toThrow(/note count/);
  });

  it('rejects a truncated pitch list', () => {
    expect(() => parseScl('desc\n3\n100.0\n200.0')).toThrow(/expected 3 pitches, found 2/);
  });

  it('rejects garbage pitch lines', () => {
    expect(() => parseScl('desc\n1\nfoo')).toThrow(/cannot parse pitch/);
    expect(() => parseScl('desc\n1\n12.3.4')).toThrow(/invalid cents/);
  });

  it('rejects zero and division-by-zero ratios', () => {
    expect(() => parseScl('desc\n1\n3/0')).toThrow(/invalid ratio/);
    expect(() => parseScl('desc\n1\n0/2')).toThrow(/invalid ratio/);
  });

  it('rejects an empty file', () => {
    expect(() => parseScl('!only a comment')).toThrow(/end of file/);
  });
});

/* White keys of a 12-key repeat mapped into a 7-note scale. */
const WHITE_KBM = [
  '! white.kbm',
  '12',
  '0',
  '127',
  '60',
  '69',
  '440.0',
  '7',
  '0',
  'x',
  '1',
  'x',
  '2',
  '3',
  'x',
  '4',
  'x',
  '5',
  'x',
  '6',
].join('\n');

describe('parseKbm', () => {
  it('parses the white-key fixture', () => {
    const kbm = parseKbm(WHITE_KBM);
    expect(kbm.mapSize).toBe(12);
    expect(kbm.firstNote).toBe(0);
    expect(kbm.lastNote).toBe(127);
    expect(kbm.middleNote).toBe(60);
    expect(kbm.refNote).toBe(69);
    expect(kbm.refFreq).toBe(440);
    expect(kbm.octaveDegree).toBe(7);
    expect(kbm.mapping).toEqual([0, null, 1, null, 2, 3, null, 4, null, 5, null, 6]);
  });

  it('fills missing trailing mapping entries as unmapped', () => {
    const kbm = parseKbm('3\n0\n127\n60\n69\n440.0\n3\n0\n1');
    expect(kbm.mapping).toEqual([0, 1, null]);
  });

  it('parses a size-zero (linear) mapping', () => {
    const kbm = parseKbm('0\n0\n127\n60\n69\n432.0\n0');
    expect(kbm.mapSize).toBe(0);
    expect(kbm.refFreq).toBe(432);
    expect(kbm.mapping).toEqual([]);
  });

  it('rejects truncated headers', () => {
    expect(() => parseKbm('12\n0\n127')).toThrow(/end of file.*middle note/);
  });

  it('rejects non-integer fields and bad frequencies', () => {
    expect(() => parseKbm('twelve\n0\n127\n60\n69\n440.0\n12')).toThrow(/map size/);
    expect(() => parseKbm('0\n0\n127\n60\n69\n-5\n0')).toThrow(/reference frequency/);
    expect(() => parseKbm('2\n0\n127\n60\n69\n440.0\n2\n0\nfoo')).toThrow(/mapping entry/);
  });
});

describe('tuningFromScala', () => {
  it('reproduces standard midi from a 12-EDO scl with no kbm', () => {
    const scl = parseScl(
      ['12-edo', '12', ...Array.from({ length: 12 }, (_, i) => `${(i + 1) * 100}.0`)].join('\n'),
    );
    const t = tuningFromScala(scl);
    expect(t.size).toBe(12);
    for (let m = 21; m <= 108; m++) {
      expect(Math.abs(t.freqOf(m) - mtof(m))).toBeLessThan(1e-9);
    }
  });

  it('anchors the default mapping at reference note 69 = 440', () => {
    const scl = parseScl(JI_MAJOR_SCL);
    const t = tuningFromScala(scl);
    expect(t.freqOf(69)).toBeCloseTo(440, 9);
    // degree 9 above the middle note is an octave plus a just third: 5/2
    expect(Math.abs(t.freqOf(69) / t.freqOf(60) - 5 / 2)).toBeLessThan(1e-9);
    expect(t.freqOf(60)).toBeCloseTo(176, 9);
  });

  it('follows a kbm keyboard mapping with unmapped keys', () => {
    const scl = parseScl(JI_MAJOR_SCL);
    const t = tuningFromScala(scl, parseKbm(WHITE_KBM));
    // reference: note 69 is white-key degree 5, ratio 5/3 above middle C
    expect(t.freqOf(69)).toBeCloseTo(440, 9);
    expect(t.freqOf(60)).toBeCloseTo(264, 9);
    expect(Math.abs(t.freqOf(62) / t.freqOf(60) - 9 / 8)).toBeLessThan(1e-9);
    expect(Math.abs(t.freqOf(64) / t.freqOf(60) - 5 / 4)).toBeLessThan(1e-9);
    expect(Math.abs(t.freqOf(72) / t.freqOf(60) - 2)).toBeLessThan(1e-9);
    // black keys are unmapped
    expect(Number.isNaN(t.freqOf(61))).toBe(true);
    expect(Number.isNaN(t.freqOf(66))).toBe(true);
  });

  it('shifts the reference through a linear kbm', () => {
    const scl = parseScl(EDO22_SCL);
    const kbm = parseKbm('0\n0\n127\n60\n69\n432.0\n0');
    const t = tuningFromScala(scl, kbm);
    expect(t.freqOf(69)).toBeCloseTo(432, 9);
    expect(t.freqOf(69 + 22)).toBeCloseTo(864, 6);
    expect(t.centsOf(70) - t.centsOf(69)).toBeCloseTo(1200 / 22, 3);
  });

  it('respects a moved middle note', () => {
    const scl = parseScl(JI_MAJOR_SCL);
    const kbm = parseKbm('0\n0\n127\n57\n57\n220.0\n0');
    const t = tuningFromScala(scl, kbm);
    expect(t.freqOf(57)).toBeCloseTo(220, 9);
    expect(Math.abs(t.freqOf(58) / t.freqOf(57) - 9 / 8)).toBeLessThan(1e-9);
  });

  it('rejects an unmapped reference note', () => {
    const scl = parseScl(JI_MAJOR_SCL);
    // reference note 61 falls on an unmapped key of the white-key mapping
    const kbm = parseKbm(WHITE_KBM.replace('\n69\n', '\n61\n'));
    expect(() => tuningFromScala(scl, kbm)).toThrow(/not mapped/);
  });

  it('rejects an empty or descending scale', () => {
    expect(() => tuningFromScala(parseScl('empty\n0'))).toThrow(/no notes/);
    expect(() => tuningFromScala(parseScl('bad\n1\n-100.0'))).toThrow(/period/);
  });
});
