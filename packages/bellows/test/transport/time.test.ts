import { describe, it, expect } from 'vitest';
import { parseTime, beatsPerBar, DEFAULT_METER, type Meter } from '../../src/seq/time';

describe('beatsPerBar', () => {
  it('converts written meters to quarter-note beats', () => {
    expect(beatsPerBar({ num: 4, den: 4 })).toBe(4);
    expect(beatsPerBar({ num: 3, den: 4 })).toBe(3);
    expect(beatsPerBar({ num: 6, den: 8 })).toBe(3);
    expect(beatsPerBar({ num: 7, den: 8 })).toBe(3.5);
    expect(beatsPerBar({ num: 2, den: 2 })).toBe(4);
  });

  it('rejects degenerate meters', () => {
    expect(() => beatsPerBar({ num: 0, den: 4 })).toThrow();
    expect(() => beatsPerBar({ num: 4, den: 0 })).toThrow();
  });
});

describe('parseTime', () => {
  it('passes numbers through as beats', () => {
    expect(parseTime(2)).toBe(2);
    expect(parseTime(0)).toBe(0);
    expect(parseTime(-1.5)).toBe(-1.5);
  });

  it('rejects non-finite numbers', () => {
    expect(() => parseTime(NaN)).toThrow();
    expect(() => parseTime(Infinity)).toThrow();
  });

  it('parses numeric strings as beats', () => {
    expect(parseTime('3')).toBe(3);
    expect(parseTime('2.5')).toBe(2.5);
    expect(parseTime('-1')).toBe(-1);
  });

  it('parses plain note values against a 4-beat whole note', () => {
    expect(parseTime('1n')).toBe(4);
    expect(parseTime('2n')).toBe(2);
    expect(parseTime('4n')).toBe(1);
    expect(parseTime('8n')).toBe(0.5);
    expect(parseTime('16n')).toBe(0.25);
    expect(parseTime('32n')).toBe(0.125);
  });

  it('parses dotted values in both spellings', () => {
    expect(parseTime('4n.')).toBe(1.5);
    expect(parseTime('4nd')).toBe(1.5);
    expect(parseTime('8n.')).toBe(0.75);
    expect(parseTime('2nd')).toBe(3);
  });

  it('parses triplets as two thirds of the plain value', () => {
    expect(parseTime('8t')).toBeCloseTo(1 / 3, 12);
    expect(parseTime('4t')).toBeCloseTo(2 / 3, 12);
    expect(parseTime('16t')).toBeCloseTo(1 / 6, 12);
  });

  it('parses measures through the meter', () => {
    expect(parseTime('2m')).toBe(8);
    expect(parseTime('2m', { num: 3, den: 4 })).toBe(6);
    expect(parseTime('1m', { num: 6, den: 8 })).toBe(3);
    expect(parseTime('0.5m')).toBe(2);
  });

  it('parses fractions of a whole note', () => {
    expect(parseTime('3/8')).toBe(1.5);
    expect(parseTime('1/4')).toBe(1);
    expect(parseTime('5/16')).toBe(1.25);
  });

  it('parses zero-based bar:beat:sixteenth positions', () => {
    expect(parseTime('0:0:0')).toBe(0);
    expect(parseTime('2:1:2')).toBe(9.5);
    expect(parseTime('1:0:0')).toBe(4);
    expect(parseTime('0:3:3')).toBe(3.75);
  });

  it('positions respect the meter', () => {
    const waltz: Meter = { num: 3, den: 4 };
    expect(parseTime('2:1:2', waltz)).toBe(7.5);
    expect(parseTime('1:0:0', { num: 6, den: 8 })).toBe(3);
  });

  it('the default meter is 4/4', () => {
    expect(parseTime('1m', DEFAULT_METER)).toBe(4);
    expect(parseTime('1m')).toBe(4);
  });

  it('throws on garbage', () => {
    expect(() => parseTime('')).toThrow();
    expect(() => parseTime('xyz')).toThrow();
    expect(() => parseTime('4x')).toThrow();
    expect(() => parseTime('n4')).toThrow();
    expect(() => parseTime('0n')).toThrow();
    expect(() => parseTime('1/0')).toThrow();
    expect(() => parseTime('1:2')).toThrow();
    expect(() => parseTime('4n..')).toThrow();
    expect(() => parseTime('4m.')).toThrow();
    expect(() => parseTime('1:2:3:4')).toThrow();
  });
});
