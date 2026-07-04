import { describe, expect, it } from 'vitest';
import { SCALES, Scale } from '../../src/theory/scales';

describe('SCALES', () => {
  it('has at least 30 entries', () => {
    expect(Object.keys(SCALES).length).toBeGreaterThanOrEqual(30);
  });

  it('every entry starts at 0 and is strictly increasing within one octave', () => {
    for (const [name, intervals] of Object.entries(SCALES)) {
      expect(intervals[0], name).toBe(0);
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i], name).toBeGreaterThan(intervals[i - 1]);
        expect(intervals[i], name).toBeLessThan(12);
      }
    }
  });

  it('has the expected fixtures', () => {
    expect(SCALES['harmonic minor']).toEqual([0, 2, 3, 5, 7, 8, 11]);
    expect(SCALES['altered']).toEqual([0, 1, 3, 4, 6, 8, 10]);
    expect(SCALES['lydian dominant']).toEqual([0, 2, 4, 6, 7, 9, 10]);
    expect(SCALES['whole tone']).toHaveLength(6);
    expect(SCALES['chromatic']).toHaveLength(12);
    expect(SCALES['blues']).toEqual([0, 3, 5, 6, 7, 10]);
    expect(SCALES['bebop dominant']).toHaveLength(8);
    expect(SCALES['hirajoshi']).toHaveLength(5);
  });

  it('modes are rotations of the parent scale', () => {
    // dorian is major rotated by one degree
    const major = SCALES['major'];
    const dorian = SCALES['dorian'];
    const rotated = major.map((_, i) => (major[(i + 1) % 7] - major[1] + 12) % 12).sort((a, b) => a - b);
    expect(dorian.slice()).toEqual(rotated);
  });
});

describe('Scale', () => {
  it('rejects unknown scale names', () => {
    expect(() => new Scale('C', 'nope')).toThrow();
  });

  it('generates C major degrees', () => {
    const s = new Scale('C', 'major');
    expect(s.degrees(1, 4)).toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(s.degrees(2, 4)).toHaveLength(14);
    expect(s.length).toBe(7);
    expect(s.intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('wraps degrees into neighboring octaves, negatives included', () => {
    const s = new Scale('C', 'major');
    expect(s.degreeToMidi(0, 4)).toBe(60);
    expect(s.degreeToMidi(7, 4)).toBe(72);
    expect(s.degreeToMidi(9, 4)).toBe(76);
    expect(s.degreeToMidi(-1, 4)).toBe(59);
    expect(s.degreeToMidi(-7, 4)).toBe(48);
  });

  it('accepts roots as pitch class names, note names, and numbers', () => {
    expect(new Scale('F#', 'minor pentatonic').degreeToMidi(0)).toBe(66);
    expect(new Scale('A2', 'minor').degreeToMidi(0)).toBe(45);
    expect(new Scale(2, 'dorian').degreeToMidi(0, 3)).toBe(50);
    expect(new Scale(45, 'minor').degreeToMidi(0)).toBe(45);
  });

  it('contains checks pitch class membership', () => {
    const s = new Scale('C', 'major');
    expect(s.contains(62)).toBe(true);
    expect(s.contains(63)).toBe(false);
    expect(s.contains(50)).toBe(true);
    const d = new Scale('D', 'dorian');
    expect(d.contains(60)).toBe(true); // C is in D dorian
    expect(d.contains(61)).toBe(false);
  });

  it('quantizes to the nearest scale tone, ties resolving down', () => {
    const s = new Scale('C', 'major');
    expect(s.quantize(64)).toBe(64); // already in scale
    expect(s.quantize(61)).toBe(60); // tie between C and D goes down
    expect(s.quantize(66)).toBe(65); // tie between F and G goes down
    expect(s.quantize(63)).toBe(62); // tie between D and E goes down
  });

  it('quantizes in sparse scales', () => {
    const s = new Scale('C', 'minor pentatonic'); // 0 3 5 7 10
    expect(s.quantize(61)).toBe(60);
    expect(s.quantize(62)).toBe(63);
    expect(s.quantize(69)).toBe(70); // A: G is 2 away, Bb is 1 away
  });
});
