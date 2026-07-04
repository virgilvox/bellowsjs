import { describe, it, expect } from 'vitest';
import { TempoMap } from '../../src/seq/tempomap';

describe('TempoMap constant tempo', () => {
  it('maps beats to seconds at 120 bpm', () => {
    const map = new TempoMap(120);
    expect(map.beatToSeconds(0)).toBe(0);
    expect(map.beatToSeconds(1)).toBeCloseTo(0.5, 12);
    expect(map.beatToSeconds(8)).toBeCloseTo(4, 12);
    expect(map.secondsToBeat(4)).toBeCloseTo(8, 12);
  });

  it('extends the constant tempo to negative beats', () => {
    const map = new TempoMap(60);
    expect(map.beatToSeconds(-2)).toBeCloseTo(-2, 12);
    expect(map.secondsToBeat(-2)).toBeCloseTo(-2, 12);
  });

  it('defaults to 120 bpm', () => {
    const map = new TempoMap();
    expect(map.beatToSeconds(2)).toBeCloseTo(1, 12);
  });
});

describe('TempoMap steps', () => {
  it('setBpm holds the previous tempo until the step beat', () => {
    const map = new TempoMap(120);
    map.setBpm(4, 60);
    // beats 0..4 at 120 (0.5 s per beat), then 60 (1 s per beat)
    expect(map.beatToSeconds(4)).toBeCloseTo(2, 12);
    expect(map.beatToSeconds(6)).toBeCloseTo(4, 12);
    expect(map.secondsToBeat(4)).toBeCloseTo(6, 12);
    expect(map.bpmAt(3.999)).toBeCloseTo(120, 9);
    expect(map.bpmAt(4)).toBeCloseTo(60, 12);
  });

  it('replaces a point set at the same beat', () => {
    const map = new TempoMap(120);
    map.setBpm(4, 60);
    map.setBpm(4, 240);
    expect(map.beatToSeconds(8)).toBeCloseTo(2 + 4 / 4, 12);
  });
});

describe('TempoMap linear ramps', () => {
  it('a 120 to 60 ramp over 8 beats takes the closed-form duration', () => {
    const map = new TempoMap(120);
    map.rampTo(8, 60);
    // t = (60 / k) * ln(T1 / T0), k = (60 - 120) / 8
    const k = (60 - 120) / 8;
    const expected = (60 / k) * Math.log(60 / 120);
    expect(map.beatToSeconds(8)).toBeCloseTo(expected, 12);
    // which is 8 * ln 2 seconds
    expect(map.beatToSeconds(8)).toBeCloseTo(8 * Math.LN2, 12);
    expect(map.secondsToBeat(expected)).toBeCloseTo(8, 12);
  });

  it('matches numeric integration of 60/bpm to 1e-6', () => {
    const map = new TempoMap(120);
    map.rampTo(8, 60);
    const steps = 1_000_000;
    const db = 8 / steps;
    let t = 0;
    for (let i = 0; i < steps; i++) {
      const b = (i + 0.5) * db;
      const bpm = 120 + ((60 - 120) / 8) * b;
      t += (60 / bpm) * db;
    }
    expect(Math.abs(map.beatToSeconds(8) - t)).toBeLessThan(1e-6);
  });

  it('mid-ramp bpm interpolates linearly', () => {
    const map = new TempoMap(120);
    map.rampTo(8, 60);
    expect(map.bpmAt(0)).toBeCloseTo(120, 12);
    expect(map.bpmAt(4)).toBeCloseTo(90, 12);
    expect(map.bpmAt(8)).toBeCloseTo(60, 12);
    expect(map.bpmAt(100)).toBeCloseTo(60, 12);
    expect(map.bpmAt(-5)).toBeCloseTo(120, 12);
  });

  it('handles a near-flat ramp through the constant limit', () => {
    const map = new TempoMap(120);
    map.rampTo(8, 120 + 1e-12);
    expect(map.beatToSeconds(8)).toBeCloseTo(4, 9);
    expect(map.secondsToBeat(4)).toBeCloseTo(8, 9);
  });
});

describe('TempoMap roundtrips', () => {
  it('beatToSeconds(secondsToBeat(t)) roundtrips to 1e-9 across mixed segments', () => {
    const map = new TempoMap(120);
    map.rampTo(4, 90);
    map.setBpm(6, 140);
    map.rampTo(10, 70);
    const total = map.beatToSeconds(14);
    for (let i = -50; i <= 300; i++) {
      const t = (i / 300) * total;
      expect(Math.abs(map.beatToSeconds(map.secondsToBeat(t)) - t)).toBeLessThan(1e-9);
    }
  });

  it('secondsToBeat(beatToSeconds(b)) roundtrips to 1e-9', () => {
    const map = new TempoMap(100);
    map.rampTo(3, 180);
    map.rampTo(7, 40);
    map.setBpm(9, 120);
    for (let i = -20; i <= 120; i++) {
      const b = i / 10;
      expect(Math.abs(map.secondsToBeat(map.beatToSeconds(b)) - b)).toBeLessThan(1e-9);
    }
  });

  it('cumulative times are strictly increasing across many points', () => {
    const map = new TempoMap(60);
    for (let i = 1; i <= 32; i++) {
      if (i % 2 === 0) map.rampTo(i, 60 + (i % 7) * 20);
      else map.setBpm(i, 40 + (i % 5) * 30);
    }
    let prev = -Infinity;
    for (let b = 0; b <= 33; b += 0.25) {
      const t = map.beatToSeconds(b);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});

describe('TempoMap validation', () => {
  it('rejects non-positive bpm and non-finite beats', () => {
    const map = new TempoMap(120);
    expect(() => map.setBpm(1, 0)).toThrow();
    expect(() => map.setBpm(1, -10)).toThrow();
    expect(() => map.rampTo(NaN, 100)).toThrow();
    expect(() => new TempoMap(0)).toThrow();
  });
});
