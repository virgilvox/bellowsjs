import { describe, expect, it } from 'vitest';
import { mod12 } from '../../src/theory/notes';
import { invert, negativeHarmony, voiceLead } from '../../src/theory/voicelead';

describe('invert', () => {
  it('moves bottom notes up for positive inversions', () => {
    expect(invert([60, 64, 67], 1)).toEqual([64, 67, 72]);
    expect(invert([60, 64, 67], 2)).toEqual([67, 72, 76]);
    expect(invert([60, 64, 67], 3)).toEqual([72, 76, 79]);
  });

  it('moves top notes down for negative inversions', () => {
    expect(invert([60, 64, 67], -1)).toEqual([55, 60, 64]);
    expect(invert([60, 64, 67], -2)).toEqual([52, 55, 60]);
  });

  it('sorts input and leaves it untouched', () => {
    const src = [67, 60, 64];
    expect(invert(src, 0)).toEqual([60, 64, 67]);
    expect(src).toEqual([67, 60, 64]);
  });
});

describe('negativeHarmony', () => {
  it('reflects around the root-fifth axis of the key', () => {
    // in C: C <-> G, E <-> Eb
    expect(negativeHarmony(60, 60)).toBe(67);
    expect(negativeHarmony(67, 60)).toBe(60);
    expect(negativeHarmony(64, 60)).toBe(63);
  });

  it('maps the C major triad to a C minor shape around C', () => {
    const out = [60, 64, 67].map((m) => negativeHarmony(m, 60)).sort((a, b) => a - b);
    expect(out.map(mod12).sort((a, b) => a - b)).toEqual([0, 3, 7]);
  });

  it('maps the G major triad (V of C) to an F minor shape', () => {
    const out = [67, 71, 74].map((m) => negativeHarmony(m, 60));
    const pcs = out.map(mod12).sort((a, b) => a - b);
    expect(pcs).toEqual([0, 5, 8]); // F, Ab, C
  });

  it('is an involution', () => {
    for (const m of [48, 55, 60, 63, 72, 81]) {
      expect(negativeHarmony(negativeHarmony(m, 62), 62)).toBe(m);
    }
  });
});

describe('voiceLead', () => {
  const naiveCost = (prev: number[], chordPcs: number[]) => {
    // nearest chord tone per voice, the mockup strategy
    let total = 0;
    for (const v of prev) {
      let best = Infinity;
      for (let m = v - 11; m <= v + 11; m++) {
        if (chordPcs.includes(mod12(m))) best = Math.min(best, Math.abs(m - v));
      }
      total += best;
    }
    return total;
  };

  it('moves C to F with minimal motion (second inversion F)', () => {
    const out = voiceLead([60, 64, 67], [[65, 69, 72]]);
    expect(out).toEqual([60, 65, 69]);
  });

  it('moves C to G through first inversion', () => {
    const out = voiceLead([60, 64, 67], [[67, 71, 74]]);
    expect(out).toEqual([59, 62, 67]);
  });

  it('never exceeds the naive nearest-note cost', () => {
    const cases: [number[], number[]][] = [
      [[60, 64, 67], [65, 69, 72]],
      [[60, 64, 67], [67, 71, 74]],
      [[62, 65, 69], [60, 64, 67]],
      [[59, 62, 67], [57, 60, 64]],
    ];
    for (const [prev, cand] of cases) {
      const out = voiceLead(prev, [cand]);
      let motion = 0;
      for (let i = 0; i < out.length; i++) motion += Math.abs(out[i] - prev[i]);
      expect(motion).toBeLessThanOrEqual(naiveCost(prev, cand.map(mod12)));
    }
  });

  it('keeps every note inside the range', () => {
    const out = voiceLead([60, 64, 67], [[67, 71, 74]], { low: 60, high: 76 });
    for (const m of out) {
      expect(m).toBeGreaterThanOrEqual(60);
      expect(m).toBeLessThanOrEqual(76);
    }
    expect(out.map(mod12).sort((a, b) => a - b)).toEqual([2, 7, 11]);
  });

  it('doubles a chord tone when the previous voicing has more voices', () => {
    const out = voiceLead([60, 64, 67, 72], [[67, 71, 74]]);
    expect(out).toHaveLength(4);
    for (const m of out) expect([7, 11, 2]).toContain(mod12(m));
    // all three chord pitch classes still present
    const pcs = new Set(out.map(mod12));
    expect(pcs.size).toBe(3);
  });

  it('picks the closer of several candidate chords', () => {
    const f = [65, 69, 72];
    const fSharp = [66, 70, 73];
    const out = voiceLead([60, 65, 69], [fSharp, f]);
    // staying on F costs nothing, F# costs at least 3
    expect(out).toEqual([60, 65, 69]);
  });

  it('is deterministic', () => {
    const a = voiceLead([60, 64, 67], [[65, 69, 72], [67, 71, 74]]);
    const b = voiceLead([60, 64, 67], [[65, 69, 72], [67, 71, 74]]);
    expect(a).toEqual(b);
  });

  it('centers the first chord when there is no previous voicing', () => {
    const out = voiceLead([], [[60, 64, 67]], { low: 48, high: 84 });
    expect(out.map(mod12).sort((a, b) => a - b)).toEqual([0, 4, 7]);
    const mean = out.reduce((s, m) => s + m, 0) / out.length;
    expect(Math.abs(mean - 66)).toBeLessThanOrEqual(4);
  });

  it('throws when nothing fits the range', () => {
    expect(() => voiceLead([60], [[60]], { low: 60, high: 59 })).toThrow();
  });
});
