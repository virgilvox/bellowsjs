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

  /*
   * motionCost's unequal-size branch. It is entered only when the previous
   * voicing has FEWER voices than the chord has pitch classes: voiceLead
   * sizes candidates to max(prev.length, pcs.length), so the doubling case
   * above (more voices than pitch classes) takes the equal branch instead.
   * Nothing reached this branch before these three.
   */
  /*
   * Shape alone does not gate this branch: zeroing its motion term leaves
   * every candidate tied at cost 0, the first one wins, and a test that
   * only checks length, pitch classes and ordering still passes. So these
   * two assert the cost the branch actually computes, the total distance
   * from each new note to its nearest old voice. The bounds are the
   * measured values (5 and 6); the mutant scores 27 and 16.
   */
  const motionFrom = (prev: number[], out: number[]): number =>
    out.reduce((sum, m) => sum + Math.min(...prev.map((p) => Math.abs(m - p))), 0);

  it('grows the voicing when the chord has more pitch classes than the previous voicing', () => {
    const prev = [60, 67];
    const out = voiceLead(prev, [[60, 64, 67, 70]]);
    expect(out).toHaveLength(4);
    expect(out.map(mod12).sort((a, b) => a - b)).toEqual([0, 4, 7, 10]);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    // both previous voices are held, and the two new notes fill in around them
    expect(out).toContain(60);
    expect(out).toContain(67);
    expect(motionFrom(prev, out)).toBeLessThanOrEqual(5);
    expect(out).toEqual([58, 60, 64, 67]);
  });

  it('grows from three voices to a five note chord inside the range', () => {
    const prev = [55, 60, 64];
    const out = voiceLead(prev, [[60, 62, 66, 69, 71]], { low: 48, high: 84 });
    expect(out).toHaveLength(5);
    expect(new Set(out.map(mod12)).size).toBe(5);
    for (const m of out) {
      expect(m).toBeGreaterThanOrEqual(48);
      expect(m).toBeLessThanOrEqual(84);
    }
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    expect(motionFrom(prev, out)).toBeLessThanOrEqual(6);
    expect(out).toEqual([54, 57, 59, 60, 62]);
  });

  it('crossPenalty is inert, because a sorted-to-ascending nearest match never crosses', () => {
    /*
     * Both inputs to the assignment are ascending, so the nearest-old-voice
     * index is monotone non-decreasing and the crossing loop never adds
     * anything. This pins it: if the option ever becomes live, this fails
     * and whoever made it live has to say so on purpose. See the finding in
     * docs/AUDIT-2.md for the exhaustive measurement behind the claim.
     */
    const chords = [[60, 64, 67, 70], [59, 62, 65, 69], [60, 63, 67, 70], [60, 62, 66, 69, 71]];
    for (const prev of [[60], [60, 67], [55, 60, 64], [52, 59, 68]]) {
      for (const cand of chords) {
        for (const low of [40, 48]) {
          const off = voiceLead(prev, [cand], { low, high: 84, crossPenalty: 0 });
          const huge = voiceLead(prev, [cand], { low, high: 84, crossPenalty: 1000 });
          expect(huge).toEqual(off);
        }
      }
    }
  });
});
