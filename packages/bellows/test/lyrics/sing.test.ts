import { describe, expect, it } from 'vitest';
import {
  MIN_CONSONANT,
  MIN_VOWEL,
  SHORTEST_VOWEL,
  planSung,
  splitDiphthong,
} from '../../src/lyrics/sing';
import {
  CONSONANT_DURATIONS,
  DEFAULT_CONSONANT_DURATION,
  SUNG_CONSONANT_SCALE,
  consonantDuration,
} from '../../src/lyrics/durations';
import type { Segment, SungNote, SungPlan, SungSpan, Syllable } from '../../src/lyrics/types';
import { TempoMap } from '../../src/seq/tempomap';
import { Tuning } from '../../src/theory/tuning';

/*
 * Syllables are built by hand here: the lyric front end is a separate
 * module with its own tests, and these tests are about timing only.
 */

const seg = (ipa: string): Segment => ({ ipa });

function syl(
  onset: string[],
  nucleus: string,
  coda: string[] = [],
  extra: Partial<Syllable> = {},
): Syllable {
  return {
    text: [...onset, nucleus, ...coda].join(''),
    onset: onset.map(seg),
    nucleus: { ipa: nucleus, stress: 1 },
    coda: coda.map(seg),
    wordEnd: true,
    phraseEnd: false,
    ...extra,
  };
}

const melisma = (nucleus: string): Syllable => ({
  text: '~',
  onset: [],
  nucleus: { ipa: nucleus },
  coda: [],
  melisma: true,
  wordEnd: true,
  phraseEnd: false,
});

const note = (time: number, dur: number, hz = 220, vel?: number): SungNote =>
  vel === undefined ? { time, dur, hz } : { time, dur, hz, vel };

/** The sung length of a consonant at the default scale. */
const sung = (ipa: string) => consonantDuration(ipa) * SUNG_CONSONANT_SCALE;

const len = (s: SungSpan) => s.end - s.start;

const allSpans = (plan: SungPlan) => plan.phrases.flatMap((p) => p.spans);
const nuclei = (plan: SungPlan) => allSpans(plan).filter((s) => s.kind === 'nucleus');

/** The structural promises every plan keeps, whatever went in. */
function checkPlan(plan: SungPlan): void {
  expect(Number.isFinite(plan.leadIn)).toBe(true);
  expect(plan.leadIn).toBeGreaterThanOrEqual(0);
  let prevEnd = -Infinity;
  for (const ph of plan.phrases) {
    expect(ph.spans.length).toBeGreaterThan(0);
    expect(ph.start).toBe(ph.spans[0].start);
    expect(ph.end).toBe(ph.spans[ph.spans.length - 1].end);
    /* One singer: a phrase never starts before the previous one has ended. */
    expect(ph.start).toBeGreaterThanOrEqual(prevEnd);
    prevEnd = ph.end;
    for (let s = 0; s < ph.spans.length; s++) {
      const sp = ph.spans[s];
      expect(Number.isFinite(sp.start)).toBe(true);
      expect(Number.isFinite(sp.end)).toBe(true);
      expect(sp.end).toBeGreaterThan(sp.start);
      if (s > 0) expect(sp.start).toBe(ph.spans[s - 1].end);
    }
    expect(ph.pitches.length).toBeGreaterThan(0);
    expect(ph.pitches[0].time).toBe(ph.start);
    for (let p = 0; p < ph.pitches.length; p++) {
      const pt = ph.pitches[p];
      expect(Number.isFinite(pt.time)).toBe(true);
      expect(Number.isFinite(pt.hz)).toBe(true);
      expect(pt.hz).toBeGreaterThan(0);
      expect(pt.time).toBeLessThanOrEqual(ph.end);
      if (p > 0) expect(pt.time).toBeGreaterThanOrEqual(ph.pitches[p - 1].time);
    }
    expect(Number.isFinite(ph.vel)).toBe(true);
    expect(ph.vel).toBeGreaterThanOrEqual(0);
    expect(ph.vel).toBeLessThanOrEqual(1);
  }
}

describe('planSung: vowels on the beat', () => {
  /* A tempo ramp from 80 to 160 bpm, in seconds, through the caller's own
   * tempo map, and pitches from 19-EDO through the tuning layer. The planner
   * sees only the seconds and the Hz. */
  const tm = new TempoMap(80);
  tm.rampTo(12, 160);
  const beats = [0, 1, 1.5, 2, 3, 3.75, 4.5, 6, 7, 9];
  const times = beats.map((b) => 0.25 + tm.beatToSeconds(b));
  const edo19 = Tuning.edo(19);
  const steps = [-11, -8, -5, -3, 0, 3, 6, 8, 11, 13];
  const notes: SungNote[] = times.map((t, i) => ({
    time: t,
    dur: (i + 1 < times.length ? times[i + 1] : t + 0.6) - t,
    hz: edo19.freqOf(69 + steps[i]),
  }));
  /* "the sun is shi-ning on the wa-ter", with no-onset, no-coda and
   * diphthong syllables in it. */
  const syllables: Syllable[] = [
    syl(['ð'], 'ə'),
    syl(['s'], 'ʌ', ['n']),
    syl([], 'ɪ', ['z']),
    syl(['ʃ'], 'aɪ', [], { wordEnd: false }),
    syl(['n'], 'ɪ', ['ŋ']),
    syl([], 'ɔ', ['n']),
    syl(['ð'], 'ə'),
    syl(['w'], 'ɔ', [], { wordEnd: false }),
    syl(['ɾ'], 'ɝ'),
    syl(['h'], 'oʊ', ['m'], { phraseEnd: true }),
  ];
  const plan = planSung(notes, syllables);

  it('uses a grid that is uneven and a tuning that is not 12-EDO', () => {
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / (beats[i + 1] - beats[i]));
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeGreaterThan(1.5);
    const cents = notes.map((n) => 1200 * Math.log2(n.hz / 440));
    const off12 = cents.map((c) => Math.abs(c / 100 - Math.round(c / 100)));
    expect(off12.filter((x) => x > 0.05).length).toBeGreaterThan(5);
  });

  it('starts a nucleus span exactly on every note time', () => {
    checkPlan(plan);
    expect(plan.phrases.length).toBe(1);
    const starts = nuclei(plan).map((s) => s.start);
    for (const n of notes) expect(starts).toContain(n.time);
    /* exactly, not approximately: the nucleus start is the note time itself */
    for (const n of notes) expect(nuclei(plan).some((s) => Object.is(s.start, n.time))).toBe(true);
  });

  it('carries the tuning layer Hz into the pitches verbatim, one entry per note', () => {
    const hz = plan.phrases.flatMap((p) => p.pitches.map((x) => x.hz));
    expect(hz).toEqual(notes.map((n) => n.hz));
    for (let i = 0; i < notes.length; i++) expect(Object.is(hz[i], notes[i].hz)).toBe(true);
  });

  it('splits the diphthong and keeps every span a single phoneme', () => {
    const ipa = allSpans(plan).map((s) => s.ipa);
    expect(ipa).not.toContain('aɪ');
    expect(ipa).not.toContain('oʊ');
    expect(ipa).toContain('a');
    expect(ipa).toContain('ɪ');
  });
});

describe('planSung: onsets borrow time, codas give it back', () => {
  it('starts a "str" onset before its beat by the sum of its consonant durations', () => {
    const plan = planSung([note(1, 1)], [syl(['s', 't', 'ɹ'], 'ɔ', ['ŋ'])]);
    checkPlan(plan);
    const sum = sung('s') + sung('t') + sung('ɹ');
    expect(sum).toBeCloseTo(0.8 * (0.12 + 0.075 + 0.065), 12);
    const [ph] = plan.phrases;
    expect(ph.start).toBeCloseTo(1 - sum, 12);
    expect(plan.leadIn).toBeCloseTo(sum, 12);
    expect(ph.spans.slice(0, 3).map((s) => [s.ipa, s.kind])).toEqual([
      ['s', 'onset'],
      ['t', 'onset'],
      ['ɹ', 'onset'],
    ]);
    expect(len(ph.spans[0])).toBeCloseTo(sung('s'), 12);
    expect(len(ph.spans[1])).toBeCloseTo(sung('t'), 12);
    expect(ph.spans[2].end).toBe(1);
    /* the last note's coda finishes at the note's end */
    expect(ph.end).toBe(2);
    expect(ph.spans[ph.spans.length - 1]).toMatchObject({ ipa: 'ŋ', kind: 'coda' });
    expect(len(ph.spans[ph.spans.length - 1])).toBeCloseTo(sung('ŋ'), 12);
  });

  it('scales consonants by consonantScale', () => {
    const plan = planSung([note(1, 1)], [syl(['s', 't', 'ɹ'], 'ɔ')], { consonantScale: 1 });
    expect(plan.leadIn).toBeCloseTo(0.26, 12);
  });

  it('takes the onset from the previous note, and moves the pitch at its start', () => {
    const plan = planSung(
      [note(0, 0.5, 200), note(0.5, 0.5, 300)],
      [syl(['b'], 'ɑ', ['t']), syl(['s'], 'i')],
    );
    checkPlan(plan);
    const [ph] = plan.phrases;
    expect(ph.spans.map((s) => s.ipa)).toEqual(['b', 'ɑ', 't', 's', 'i']);
    const t = ph.spans[2];
    const s = ph.spans[3];
    expect(s.end).toBe(0.5);
    expect(s.start).toBeCloseTo(0.5 - sung('s'), 12);
    expect(t.end).toBe(s.start);
    expect(len(t)).toBeCloseTo(sung('t'), 12);
    /* the coda keeps the old pitch, the onset carries the new one */
    expect(ph.pitches).toEqual([
      { time: ph.start, hz: 200 },
      { time: s.start, hz: 300 },
    ]);
    expect(t.end).toBeLessThanOrEqual(ph.pitches[1].time);
  });

  it('gives a vowel with no onset its pitch on the beat', () => {
    const plan = planSung([note(0, 0.5, 200), note(0.5, 0.5, 300)], [syl([], 'ɑ'), syl([], 'i')]);
    checkPlan(plan);
    expect(plan.phrases[0].pitches).toEqual([
      { time: 0, hz: 200 },
      { time: 0.5, hz: 300 },
    ]);
    expect(plan.leadIn).toBe(0);
  });

  it('honours a segment duration override, unscaled', () => {
    const coda: Segment = { ipa: 's', dur: 0.3 };
    const s: Syllable = { ...syl([], 'ɑ'), coda: [coda] };
    const plan = planSung([note(0, 1)], [s]);
    const last = plan.phrases[0].spans[1];
    expect(last).toMatchObject({ ipa: 's', kind: 'coda', end: 1 });
    expect(len(last)).toBeCloseTo(0.3, 12);
  });
});

describe('planSung: fast passages', () => {
  /* A run of identical syllables, every `gap` seconds. */
  function run(gap: number, count: number, s: Syllable) {
    const notes = Array.from({ length: count }, (_, i) => note(0.5 + i * gap, gap, 200 + i));
    return { notes, plan: planSung(notes, [s]) };
  }

  it('squeezes consonants in proportion so each vowel keeps 50 ms on its beat', () => {
    /* coda p plus onset s k is 228 ms of consonants between beats 180 ms apart */
    const { notes, plan } = run(0.18, 6, syl(['s', 'k'], 'ɑ', ['p']));
    checkPlan(plan);
    const [ph] = plan.phrases;
    const natural = sung('p') + sung('s') + sung('k');
    expect(natural).toBeGreaterThan(0.18 - MIN_VOWEL);
    const ratio = (0.18 - MIN_VOWEL) / natural;
    const vowels = ph.spans.filter((s) => s.kind === 'nucleus');
    expect(vowels.map((v) => v.start)).toEqual(notes.map((n) => n.time));
    for (let k = 0; k < notes.length - 1; k++) {
      expect(len(vowels[k])).toBeCloseTo(MIN_VOWEL, 12);
      expect(len(vowels[k])).toBeGreaterThanOrEqual(MIN_VOWEL - 1e-12);
    }
    /* between two beats: p (coda), then s k (onset), each shrunk by the same ratio */
    const between = ph.spans.filter((s) => s.start >= notes[1].time && s.end <= notes[2].time);
    expect(between.map((s) => s.ipa)).toEqual(['ɑ', 'p', 's', 'k']);
    for (const c of between.slice(1)) {
      expect(len(c) / sung(c.ipa)).toBeCloseTo(ratio, 12);
      expect(len(c)).toBeGreaterThanOrEqual(MIN_CONSONANT);
    }
    /* the first onset is lead-in, not squeezed; the last coda has room */
    expect(plan.leadIn).toBeCloseTo(sung('s') + sung('k'), 12);
    expect(len(ph.spans[ph.spans.length - 1])).toBeCloseTo(sung('p'), 12);
  });

  it('stops each consonant at 12 ms, and the vowel gives way, still on its beat', () => {
    /* t | s t r in 100 ms: proportional shrinking would take t and r under 12 ms */
    const { notes, plan } = run(0.1, 8, syl(['s', 't', 'ɹ'], 'ʌ', ['t']));
    checkPlan(plan);
    const [ph] = plan.phrases;
    const vowels = ph.spans.filter((s) => s.kind === 'nucleus');
    expect(vowels.map((v) => v.start)).toEqual(notes.map((n) => n.time));
    const inner = ph.spans.filter((s) => s.kind !== 'nucleus' && s.start >= notes[0].time);
    for (const c of inner) expect(len(c)).toBeGreaterThanOrEqual(MIN_CONSONANT - 1e-12);
    expect(inner.some((c) => Math.abs(len(c) - MIN_CONSONANT) < 1e-12)).toBe(true);
    for (const v of vowels.slice(0, -1)) {
      expect(len(v)).toBeLessThan(MIN_VOWEL);
      expect(len(v)).toBeGreaterThanOrEqual(SHORTEST_VOWEL);
    }
  });

  it('keeps the beat even when the consonants cannot fit at their floor', () => {
    /* 40 ms notes: four 12 ms consonants and a 20 ms vowel need 68 ms */
    const { notes, plan } = run(0.04, 8, syl(['s', 't', 'ɹ'], 'ʌ', ['t']));
    checkPlan(plan);
    const [ph] = plan.phrases;
    const vowels = ph.spans.filter((s) => s.kind === 'nucleus');
    expect(vowels.map((v) => v.start)).toEqual(notes.map((n) => n.time));
    const share = 0.04 / (4 * MIN_CONSONANT + SHORTEST_VOWEL);
    for (const v of vowels.slice(0, -1)) expect(len(v)).toBeCloseTo(SHORTEST_VOWEL * share, 12);
    const inner = ph.spans.filter(
      (s) => s.kind !== 'nucleus' && s.start >= notes[0].time && s.end <= notes[7].time,
    );
    for (const c of inner) expect(len(c)).toBeCloseTo(MIN_CONSONANT * share, 12);
  });

  it('never lengthens a consonant already shorter than the floor', () => {
    const tiny = planSung(
      [note(0, 0.06), note(0.06, 0.06)],
      [syl(['k'], 'ɑ', ['t']), syl(['s', 't', 'ɹ'], 'ʌ')],
      { consonantScale: 0.1 },
    );
    checkPlan(tiny);
    for (const s of allSpans(tiny).filter((x) => x.kind !== 'nucleus')) {
      expect(len(s)).toBeLessThanOrEqual(consonantDuration(s.ipa) * 0.1 + 1e-12);
    }
  });
});

describe('planSung: melisma and diphthongs', () => {
  it('holds the vowel across a melisma, two pitches, and the coda after the second note', () => {
    const plan = planSung(
      [note(0.3, 0.5, 200), note(0.8, 0.5, 300)],
      [syl(['l'], 'ɔ', ['t']), melisma('ɔ')],
    );
    checkPlan(plan);
    const [ph] = plan.phrases;
    expect(ph.spans.map((s) => [s.ipa, s.kind])).toEqual([
      ['l', 'onset'],
      ['ɔ', 'nucleus'],
      ['t', 'coda'],
    ]);
    const vowel = ph.spans[1];
    expect(vowel.start).toBe(0.3);
    expect(vowel.end).toBeGreaterThan(0.8);
    expect(ph.spans[2].start).toBeGreaterThan(0.8);
    expect(ph.end).toBe(1.3);
    expect(ph.pitches).toEqual([
      { time: ph.start, hz: 200 },
      { time: 0.8, hz: 300 },
    ]);
  });

  it('waits for the last note of a longer melisma, and its glide comes at the end', () => {
    const plan = planSung(
      [note(0, 0.4, 200), note(0.4, 0.4, 250), note(0.8, 0.4, 300)],
      [syl([], 'aɪ', ['t']), melisma('aɪ'), melisma('aɪ')],
    );
    checkPlan(plan);
    const [ph] = plan.phrases;
    expect(ph.spans.map((s) => s.ipa)).toEqual(['a', 'ɪ', 't']);
    const vowelEnd = 1.2 - sung('t');
    expect(ph.spans[0]).toMatchObject({ start: 0, kind: 'nucleus' });
    expect(ph.spans[0].end).toBeCloseTo(0.8 + 0.8 * (vowelEnd - 0.8), 12);
    expect(ph.spans[1].end).toBeCloseTo(vowelEnd, 12);
    expect(ph.pitches.map((p) => [p.time, p.hz])).toEqual([
      [0, 200],
      [0.4, 250],
      [0.8, 300],
    ]);
  });

  it('splits each diphthong at CHIMERA\'s 80/20 point into its two targets', () => {
    expect(splitDiphthong('aɪ')).toEqual(['a', 'ɪ']);
    expect(splitDiphthong('aʊ')).toEqual(['a', 'ʊ']);
    expect(splitDiphthong('eɪ')).toEqual(['e', 'i']);
    expect(splitDiphthong('oʊ')).toEqual(['o', 'u']);
    expect(splitDiphthong('ɔɪ')).toEqual(['ɔ', 'ɪ']);
    expect(splitDiphthong('ɑ')).toBeUndefined();
    for (const d of ['aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ']) {
      const plan = planSung([note(1, 1)], [syl([], d)]);
      checkPlan(plan);
      const [a, b] = plan.phrases[0].spans;
      const parts = splitDiphthong(d) as [string, string];
      expect([a.ipa, b.ipa]).toEqual(parts);
      expect(a.start).toBe(1);
      expect(a.end).toBeCloseTo(1.8, 12);
      expect(b.end).toBe(2);
    }
  });

  it('splits the vowel time the coda leaves, not the whole note', () => {
    const plan = planSung([note(0, 1)], [syl([], 'eɪ', ['t'])]);
    const [e, i, t] = plan.phrases[0].spans;
    const vowel = 1 - sung('t');
    expect(e.end).toBeCloseTo(0.8 * vowel, 12);
    expect(i.end).toBeCloseTo(vowel, 12);
    expect(t).toMatchObject({ ipa: 't', end: 1 });
  });

  it('starts a phrase that opens on a melisma with its own vowel and no consonants', () => {
    /* "goat, ~": the t was sung before the breath and is not sung again */
    const plan = planSung(
      [note(0, 0.5), note(1, 0.5)],
      [syl(['g'], 'oʊ', ['t'], { phraseEnd: true }), melisma('oʊ')],
    );
    checkPlan(plan);
    expect(plan.phrases.length).toBe(2);
    expect(plan.phrases[0].spans.map((s) => s.ipa)).toEqual(['g', 'o', 'u', 't']);
    expect(plan.phrases[1].spans.map((s) => s.ipa)).toEqual(['o', 'u']);
    expect(plan.phrases[1].start).toBe(1);
  });
});

describe('planSung: phrases', () => {
  it('ends a phrase at a rest', () => {
    const plan = planSung([note(0, 0.5), note(0.7, 0.5)], [syl(['l'], 'ɑ'), syl(['m'], 'i')]);
    checkPlan(plan);
    expect(plan.phrases.length).toBe(2);
    /* the rest holds the next onset, so the first phrase sings to its note end */
    expect(plan.phrases[0].end).toBe(0.5);
    expect(plan.phrases[1].start).toBeCloseTo(0.7 - sung('m'), 12);
    expect(plan.leadIn).toBeCloseTo(Math.max(sung('l'), sung('m')), 12);
  });

  it('treats a gap of 1 ms or less as legato and anything longer as a rest', () => {
    const s = [syl([], 'ɑ'), syl([], 'i')];
    expect(planSung([note(0, 0.5), note(0.5009, 0.5)], s).phrases.length).toBe(1);
    expect(planSung([note(0, 0.5), note(0.5011, 0.5)], s).phrases.length).toBe(2);
    /* inside a phrase the vowel holds through the gap to the next beat */
    expect(planSung([note(0, 0.5), note(0.5009, 0.5)], s).phrases[0].spans[0].end).toBe(0.5009);
  });

  it('ends a phrase at phraseEnd with no rest, and takes the breath from the note', () => {
    const plan = planSung(
      [note(0, 1, 200), note(1, 1, 300)],
      [syl([], 'ɑ', [], { phraseEnd: true }), syl([], 'o')],
    );
    checkPlan(plan);
    expect(plan.phrases.length).toBe(2);
    const [a, b] = plan.phrases;
    expect(a.end).toBeCloseTo(1 - 0.12, 12);
    expect(b.start).toBe(1);
    expect(a.pitches).toEqual([{ time: 0, hz: 200 }]);
    expect(b.pitches).toEqual([{ time: 1, hz: 300 }]);
  });

  it('leaves the breath before the next phrase\'s onset, not under it', () => {
    const plan = planSung(
      [note(0, 1), note(1, 1)],
      [syl([], 'ɑ', ['n'], { phraseEnd: true }), syl(['s', 't', 'ɹ'], 'ɔ')],
    );
    checkPlan(plan);
    const [a, b] = plan.phrases;
    expect(b.start).toBeCloseTo(1 - (sung('s') + sung('t') + sung('ɹ')), 12);
    expect(b.start - a.end).toBeCloseTo(0.12, 12);
  });

  it('scales the breath to a short note', () => {
    const plan = planSung(
      [note(0, 0.2), note(0.2, 0.2)],
      [syl([], 'ɑ', [], { phraseEnd: true }), syl([], 'o')],
    );
    checkPlan(plan);
    expect(plan.phrases[1].start - plan.phrases[0].end).toBeCloseTo(0.3 * 0.2, 12);
  });

  it('takes vel from the first note of each phrase, 0.8 by default, clamped', () => {
    const plan = planSung(
      [note(0, 0.5, 220, 0.3), note(0.5, 0.5, 220, 0.9), note(2, 0.5), note(3, 0.5, 220, 7)],
      [syl([], 'ɑ'), syl([], 'i'), syl([], 'u'), syl([], 'e')],
    );
    expect(plan.phrases.map((p) => p.vel)).toEqual([0.3, 0.8, 1]);
  });

  it('reports the longest lead-in over phrases', () => {
    const plan = planSung(
      [note(0, 0.5), note(2, 0.5), note(4, 0.5)],
      [syl(['m'], 'ɑ'), syl(['s', 't', 'ɹ'], 'i'), syl([], 'u')],
    );
    checkPlan(plan);
    expect(plan.phrases.length).toBe(3);
    expect(plan.leadIn).toBeCloseTo(sung('s') + sung('t') + sung('ɹ'), 12);
  });

  it('keeps spans contiguous and ordered across a varied passage', () => {
    const notes = [
      note(0, 0.3),
      note(0.3, 0.12),
      note(0.42, 0.5),
      note(1.2, 0.08),
      note(1.28, 0.6),
      note(1.88, 0.4),
      note(2.28, 0.05),
      note(2.33, 0.9),
    ];
    const syllables = [
      syl(['s', 'p', 'ɹ'], 'ɪ', ['ŋ']),
      syl(['k'], 'ɑ', ['m', 'z']),
      melisma('ɑ'),
      syl(['θ'], 'ɝ', ['d'], { phraseEnd: true }),
      syl(['ʃ', 'w'], 'aɪ', ['n', 't', 's']),
      syl([], 'ə'),
      syl(['tʃ'], 'u', ['z']),
      syl(['l'], 'ɔɪ', ['l']),
    ];
    const plan = planSung(notes, syllables);
    checkPlan(plan);
    const starts = nuclei(plan).map((s) => s.start);
    for (const [k, n] of notes.entries()) {
      if (!syllables[k].melisma) expect(starts).toContain(n.time);
    }
  });
});

describe('planSung: what it is given', () => {
  it('is deterministic and leaves its inputs alone', () => {
    const notes = [note(0, 0.25, 200), note(0.25, 0.25, 260), note(0.5, 0.75, 300)];
    const syllables = [syl(['s', 't'], 'eɪ', ['k']), melisma('eɪ'), syl(['h'], 'oʊ', ['m'])];
    const before = structuredClone({ notes, syllables });
    const a = planSung(notes, syllables);
    const b = planSung(notes, syllables);
    expect(b).toEqual(a);
    expect({ notes, syllables }).toEqual(before);
  });

  it('cycles the lyric when there are more notes than syllables', () => {
    const notes = [0, 1, 2, 3, 4].map((t) => note(t * 0.5, 0.5));
    const plan = planSung(notes, [syl(['l'], 'ɑ'), syl(['m'], 'i')]);
    checkPlan(plan);
    expect(nuclei(plan).map((s) => s.ipa)).toEqual(['ɑ', 'i', 'ɑ', 'i', 'ɑ']);
  });

  it('leaves extra syllables unsung when there are more syllables than notes', () => {
    const three = [syl([], 'ɑ'), syl([], 'i'), syl([], 'u')];
    const plan = planSung([note(0, 0.5), note(0.5, 0.5)], three);
    checkPlan(plan);
    expect(nuclei(plan).map((s) => s.ipa)).toEqual(['ɑ', 'i']);
  });

  it('sings ah on every note when there are no syllables', () => {
    const notes = [note(0, 0.5, 200), note(0.5, 0.5, 300)];
    const plan = planSung(notes, []);
    checkPlan(plan);
    expect(allSpans(plan).map((s) => [s.ipa, s.kind, s.start])).toEqual([
      ['ɑ', 'nucleus', 0],
      ['ɑ', 'nucleus', 0.5],
    ]);
  });

  it('pairs syllables with notes in time order', () => {
    const plan = planSung([note(1, 0.5, 300), note(0, 0.5, 200)], [syl([], 'ɑ'), syl([], 'i')]);
    checkPlan(plan);
    expect(nuclei(plan).map((s) => [s.ipa, s.start])).toEqual([
      ['ɑ', 0],
      ['i', 1],
    ]);
    expect(plan.phrases.map((p) => p.pitches[0].hz)).toEqual([200, 300]);
  });

  it('returns an empty plan for empty input', () => {
    expect(planSung([], [])).toEqual({ phrases: [], leadIn: 0 });
    expect(planSung([], [syl(['s'], 'ɑ')])).toEqual({ phrases: [], leadIn: 0 });
  });

  it('survives zero-duration notes without NaN', () => {
    const cases: SungNote[][] = [
      [note(1, 0)],
      [note(0, 0), note(0, 0), note(0, 0)],
      [note(0, 0), note(0, 0.5), note(0.5, 0)],
      [note(0, 0.5), note(0.5, 0), note(0.5, 0.5)],
    ];
    const syllables = [syl(['s', 't'], 'ɑ', ['k', 's']), syl(['p'], 'aɪ', ['t'])];
    for (const notes of cases) {
      const plan = planSung(notes, syllables);
      checkPlan(plan);
      expect(JSON.stringify(plan)).not.toMatch(/null|NaN/);
    }
  });

  it('sings a syllable with no onset and no coda as its vowel alone', () => {
    const plan = planSung([note(0.5, 0.5)], [syl([], 'u')]);
    checkPlan(plan);
    expect(plan.phrases).toEqual([
      {
        start: 0.5,
        end: 1,
        vel: 0.8,
        spans: [{ ipa: 'u', start: 0.5, end: 1, kind: 'nucleus' }],
        pitches: [{ time: 0.5, hz: 220 }],
      },
    ]);
    expect(plan.leadIn).toBe(0);
  });

  it('skips notes it cannot place or pitch, and sends NaN fields to the low end', () => {
    const notes: SungNote[] = [
      { time: NaN, dur: 0.5, hz: 220 },
      { time: 0, dur: NaN, hz: 220 },
      { time: 0.5, dur: 0.5, hz: 0 },
      { time: 0.5, dur: 0.5, hz: Infinity },
      { time: 1, dur: Infinity, hz: 220, vel: NaN },
      { time: 2e6, dur: 0.5, hz: 330 },
    ];
    const plan = planSung(notes, [syl(['s'], 'ɑ', ['t'])], { consonantScale: NaN });
    checkPlan(plan);
    expect(JSON.stringify(plan)).not.toMatch(/null|NaN/);
    const hz = plan.phrases.flatMap((p) => p.pitches.map((x) => x.hz));
    expect(hz.every((h) => h === 220 || h === 330)).toBe(true);
    /* consonantScale NaN is 0: no consonants are sung */
    expect(allSpans(plan).every((s) => s.kind === 'nucleus')).toBe(true);
  });
});

describe('sung consonant durations', () => {
  it('keeps CHIMERA\'s inventory durations and its sung scale', () => {
    expect(SUNG_CONSONANT_SCALE).toBe(0.8);
    expect(DEFAULT_CONSONANT_DURATION).toBe(0.07);
    expect(CONSONANT_DURATIONS.s).toBe(0.12);
    expect(CONSONANT_DURATIONS.t).toBe(0.075);
    expect(CONSONANT_DURATIONS['tʃ']).toBe(0.15);
    expect(CONSONANT_DURATIONS['ɾ']).toBe(0.025);
    expect(CONSONANT_DURATIONS['ʔ']).toBe(0.06);
    expect(CONSONANT_DURATIONS['ɹ']).toBe(0.065);
    expect(Object.keys(CONSONANT_DURATIONS).length).toBe(71);
    for (const d of Object.values(CONSONANT_DURATIONS)) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(0.2);
    }
  });

  it('reads other spellings of a consonant as the consonant', () => {
    expect(consonantDuration('ɡ')).toBe(consonantDuration('g'));
    expect(consonantDuration('t͡ʃ')).toBe(consonantDuration('tʃ'));
    expect(consonantDuration('ʧ')).toBe(consonantDuration('tʃ'));
    expect(consonantDuration('tʰ')).toBe(consonantDuration('t'));
    expect(consonantDuration('pʲ')).toBe(consonantDuration('p'));
  });

  it('falls back to 70 ms for a sound it does not know', () => {
    expect(consonantDuration('ǃ')).toBe(0.07);
    expect(consonantDuration('')).toBe(0.07);
    expect(consonantDuration('constructor')).toBe(0.07);
  });
});
