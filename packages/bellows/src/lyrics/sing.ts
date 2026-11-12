/*
 * Sung timing: notes and syllables in, one timed phoneme span list per
 * breath out.
 *
 * The sung timing follows CHIMERA by Jameson Hodge
 * (crates/chimera/src/phonetics/sing.rs, `plan_song` and `fit`, at 1d3ea49;
 * TypeScript original at cd247a6^:src/engine/phonetics/sing.ts).
 * Reimplemented here. See THIRD_PARTY_NOTICES.md.
 *
 * The rules are the ones a singer follows:
 *
 *   - A note's vowel lands exactly on the note time. Its onset consonants
 *     are sung just before it, taking their time from the previous note,
 *     and they already carry the new pitch, so the pitch has arrived when
 *     the vowel starts.
 *   - A coda keeps the old pitch and finishes just before the next note's
 *     onset, or at the note's end on the last note of a phrase.
 *   - A fast passage squeezes. Between two beats sit a vowel, its coda and
 *     the next onset; when the consonants would leave the vowel less than
 *     MIN_VOWEL, they shrink in proportion, each down to MIN_CONSONANT, so
 *     the next vowel still lands on its beat and a run does not drift.
 *   - A diphthong holds its first vowel for 80% of the vowel time and
 *     glides to its second at the end of the note.
 *   - A melisma carries the vowel onto further notes, moving the pitch at
 *     each note time, and the coda waits for the last of them.
 *   - A phrase is one breath, ended by a syllable marked phraseEnd or by a
 *     rest.
 *
 * What differs from CHIMERA, and why. CHIMERA plays its plan on one
 * simulated airway, which blends whatever overlaps; bellows plays a phrase
 * as a pooled voice driven by sample-accurate Param events, so overlaps
 * would be two singers and drift would be audible against the beat.
 *
 *   - Vowels never drift. Where even floored consonants leave less than
 *     SHORTEST_VOWEL, CHIMERA keeps the vowel at that length and every
 *     later vowel lands late (its tests/sing_fast.rs allows 8 ms a note).
 *     Here the floored consonants and that shortest vowel shrink together
 *     in proportion to fit the time there is.
 *   - Squeezing never lengthens a consonant: one already shorter than the
 *     floor keeps its length, where CHIMERA's fit raises it to 12 ms.
 *   - Phrases never overlap. A phrase's last note stops no later than the
 *     next phrase's first sound, and at a phraseEnd the breath (CHIMERA's
 *     120 ms, or 30% of a shorter note) is kept clear before that sound,
 *     taken from the end of the note when the melody leaves no rest for
 *     it. CHIMERA reserves the breath at the note's end, and the next
 *     phrase's onset may then sound under it.
 *   - A phrase ended by a rest holds to its note's end. CHIMERA stops the
 *     last one up to 50 ms early for its breath release; here the engine's own
 *     release envelope follows the end.
 *   - A phrase that opens on a melisma, after a breath, sings its vowel
 *     again with no consonants. CHIMERA reaches back across the breath and
 *     sings the earlier syllable's coda a second time.
 *   - A segment's `dur` is honoured as an override. CHIMERA's sung path
 *     replaces it with the inventory default.
 *   - Notes arrive in seconds and Hz, already through the caller's tempo
 *     map and tuning, instead of beats at one bpm and MIDI numbers.
 *
 * This is a planner and runs off the audio thread; it allocates.
 */

import { clamp } from '../types';
import { SUNG_CONSONANT_SCALE, consonantDuration } from './durations';
import type {
  Segment,
  SungNote,
  SungPhrase,
  SungPitch,
  SungPlan,
  SungSpan,
  Syllable,
} from './types';

/** A sung vowel keeps at least this long (s) when a short note squeezes its consonants. */
export const MIN_VOWEL = 0.05;
/**
 * A squeezed consonant keeps at least this long (s). The shortest sung
 * consonant unsqueezed, the flap ɾ, is 20 ms.
 */
export const MIN_CONSONANT = 0.012;
/**
 * The vowel a note keeps when its consonants are at their floor (s).
 * Shorter than that, consonants and vowel shrink together.
 */
export const SHORTEST_VOWEL = 0.02;

/** The breath before a phrase that follows a phraseEnd (s), CHIMERA's reserve. */
const BREATH = 0.12;
/** ...but no more than this share of the note it is taken from. */
const BREATH_SHARE = 0.3;
/** A diphthong holds its first vowel for this share of the vowel time. */
const DIPHTHONG_HOLD = 0.8;
/** A gap longer than this (s) between one note's end and the next note is a rest. */
const REST = 0.001;
const DEFAULT_VEL = 0.8;
/** Top of the consonantScale range: 0 drops consonants, 4 is four times their spoken length. */
const MAX_CONSONANT_SCALE = 4;
/** Longest note (s), so an open-ended Infinity duration keeps the arithmetic finite. */
const LONGEST_NOTE = 86400;
/** Longest consonant override (s), for the same reason. */
const LONGEST_CONSONANT = 10;

/*
 * The two vowel targets of each diphthong, from CHIMERA's planner.rs
 * `expand`. American eɪ and oʊ glide toward i and u: CHIMERA found that
 * with ɪ and ʊ as targets they barely moved (e and ɪ share F2, per
 * Hillenbrand et al. 1995) and sounded like the steady eː and oː of Indian
 * English. The other offglides undershoot toward ɪ and ʊ.
 */
const DIPHTHONGS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['aɪ', ['a', 'ɪ']],
  ['aʊ', ['a', 'ʊ']],
  ['eɪ', ['e', 'i']],
  ['oʊ', ['o', 'u']],
  ['ɔɪ', ['ɔ', 'ɪ']],
]);

/** The two vowels a diphthong is sung as ("aɪ" to ["a", "ɪ"]), or undefined for a plain vowel. */
export function splitDiphthong(ipa: string): readonly [string, string] | undefined {
  return DIPHTHONGS.get(ipa);
}

/*
 * Sung when there are no words: CHIMERA's keyboard falls back to this
 * syllable (src/ui/singing.ts, AH), and it is the vocal engine's default
 * phoneme, so a plain note-on and a wordless plan agree.
 */
const AH: Syllable = {
  text: 'ah',
  onset: [],
  nucleus: { ipa: 'ɑ', stress: 1 },
  coda: [],
  wordEnd: true,
  phraseEnd: false,
};

export interface PlanSungOptions {
  /**
   * Scale on each consonant's default duration, 0..4. Default 0.8,
   * CHIMERA's sung k. A segment with its own `dur` is not scaled.
   */
  consonantScale?: number;
}

/** A note paired with its syllable, its numbers made safe. */
interface Placed {
  time: number;
  len: number;
  hz: number;
  vel: number;
  syl: Syllable;
}

/** A consonant and its duration, which the squeeze may shorten. */
interface Timed {
  ipa: string;
  dur: number;
}

/**
 * Time a sung line: each note's syllable laid out as phoneme spans around
 * the note time, one SungPhrase per breath.
 *
 * Notes are in absolute seconds and Hz, already through the caller's tempo
 * map and tuning. They are sung in time order whatever order they arrive
 * in, and the n-th note in time sings the n-th syllable. A note whose time
 * is not finite, or whose hz is not a finite positive number, cannot be
 * placed or pitched and is skipped. A NaN or negative dur is 0 and a NaN
 * vel is 0, the low end of their ranges.
 *
 * Counts that do not match follow CHIMERA, which pairs a demo song's notes
 * with its lyric as `syl[i % syl.length]` (src/ui/singing.ts and
 * crates/chimera-cli/src/render.rs): with more notes than syllables the
 * lyric starts again from its first syllable, and with more syllables than
 * notes the extra syllables are not sung. With no syllables at all every
 * note sings "ah", as CHIMERA's keyboard does when it has no words.
 * Nothing here throws.
 *
 * Every non-melisma note starts a nucleus span exactly at its note time,
 * unless the note leaves its vowel no time at all. Each phrase has one
 * pitch entry per note, in note order, carrying the note's Hz unchanged.
 * Spans in a phrase are contiguous, and a span that would last no time is
 * left out; a phrase with nothing left to sing is left out too.
 */
export function planSung(
  notes: readonly SungNote[],
  syllables: readonly Syllable[],
  opts: PlanSungOptions = {},
): SungPlan {
  const scale = clamp(opts.consonantScale ?? SUNG_CONSONANT_SCALE, 0, MAX_CONSONANT_SCALE);
  const placed = place(notes, syllables);
  const n = placed.length;
  if (n === 0) return { phrases: [], leadIn: 0 };

  /* Where each breath ends: at a phraseEnd, at a rest, or at the last note. */
  const phraseEnds = new Array<boolean>(n);
  for (let k = 0; k < n; k++) {
    const p = placed[k];
    phraseEnds[k] = k === n - 1 || p.syl.phraseEnd || placed[k + 1].time - (p.time + p.len) > REST;
  }

  /*
   * Each note's consonants. A melisma has no onset, and a note followed by
   * a melisma in its phrase has no coda: the coda of the syllable that
   * began the chain sounds after the chain's last note. The chain stops at
   * the start of the phrase, since a breath ends the vowel it carried.
   */
  const onset: Timed[][] = new Array(n);
  const coda: Timed[][] = new Array(n);
  let first = 0;
  for (let k = 0; k < n; k++) {
    if (k > 0 && phraseEnds[k - 1]) first = k;
    onset[k] = placed[k].syl.melisma === true ? [] : timed(placed[k].syl.onset, scale);
    const held = !phraseEnds[k] && placed[k + 1].syl.melisma === true;
    coda[k] = held ? [] : timed(chainStart(placed, k, first).coda, scale);
  }

  /*
   * Squeeze, then find where each note's sound ends. Inside a phrase that
   * is where the next onset starts. At the end of a phrase it is the
   * note's end, pulled back if needed so the next phrase's first sound,
   * and the breath before it after a phraseEnd, come after it.
   */
  const soundEnds = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const p = placed[k];
    if (!phraseEnds[k]) {
      const next = placed[k + 1].time;
      fit(coda[k].concat(onset[k + 1]), next - p.time);
      soundEnds[k] = Math.max(p.time, next - total(onset[k + 1]));
    } else if (k + 1 < n) {
      const next = placed[k + 1].time;
      const room = next - p.time;
      const len = Math.min(p.len, room);
      const breath = p.syl.phraseEnd ? Math.min(BREATH, BREATH_SHARE * len) : 0;
      fit(coda[k].concat(onset[k + 1]), room - breath);
      fit(coda[k], len);
      soundEnds[k] = Math.max(p.time, Math.min(p.time + len, next - total(onset[k + 1]) - breath));
    } else {
      fit(coda[k], p.len);
      soundEnds[k] = p.time + p.len;
    }
  }

  const phrases: SungPhrase[] = [];
  let leadIn = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (!phraseEnds[j]) j++;
    const phrase = layPhrase(placed, onset, coda, soundEnds, i, j);
    if (phrase !== undefined) {
      phrases.push(phrase);
      leadIn = Math.max(leadIn, placed[i].time - phrase.start);
    }
    i = j + 1;
  }
  return { phrases, leadIn };
}

/** Valid notes in time order, each with its syllable. */
function place(notes: readonly SungNote[], syllables: readonly Syllable[]): Placed[] {
  const valid: SungNote[] = [];
  for (const nt of notes) {
    if (Number.isFinite(nt.time) && Number.isFinite(nt.hz) && nt.hz > 0) valid.push(nt);
  }
  /* Array.prototype.sort is stable, so notes at the same time keep their order. */
  valid.sort((a, b) => a.time - b.time);
  const lyric = syllables.length > 0 ? syllables : [AH];
  return valid.map((nt, i) => ({
    time: nt.time,
    len: clamp(nt.dur, 0, LONGEST_NOTE),
    hz: nt.hz,
    vel: clamp(nt.vel ?? DEFAULT_VEL, 0, 1),
    syl: lyric[i % lyric.length],
  }));
}

/** The syllable that began the melisma chain note k is in, not looking back past `first`. */
function chainStart(placed: readonly Placed[], k: number, first: number): Syllable {
  let b = k;
  while (b > first && placed[b].syl.melisma === true) b--;
  return placed[b].syl;
}

function timed(segs: readonly Segment[], scale: number): Timed[] {
  const out: Timed[] = [];
  for (const s of segs) {
    const d = s.dur;
    const dur =
      typeof d === 'number' && Number.isFinite(d)
        ? clamp(d, 0, LONGEST_CONSONANT)
        : consonantDuration(s.ipa) * scale;
    out.push({ ipa: s.ipa, dur });
  }
  return out;
}

function total(group: readonly Timed[]): number {
  let s = 0;
  for (const c of group) s += c.dur;
  return s;
}

/*
 * Fit the consonants between a vowel's beat and the next one into `span`.
 * CHIMERA's rule first: if they leave the vowel less than MIN_VOWEL they
 * shrink by one common ratio, each stopping at MIN_CONSONANT. The floors
 * can still leave less than SHORTEST_VOWEL; then everything, that vowel
 * included, shrinks by one more ratio to fit, so the next beat holds. Both
 * steps are continuous in `span`, so a slightly faster run is only slightly
 * tighter.
 */
function fit(group: Timed[], span: number): void {
  const cons = total(group);
  const room = span - MIN_VOWEL;
  if (cons <= room || cons <= 0) return;
  const ratio = Math.max(0, room) / cons;
  let floored = 0;
  for (const c of group) {
    c.dur = Math.max(Math.min(c.dur, MIN_CONSONANT), c.dur * ratio);
    floored += c.dur;
  }
  const need = floored + SHORTEST_VOWEL;
  if (need > span) {
    const share = Math.max(0, span) / need;
    for (const c of group) c.dur *= share;
  }
}

/** Lay out one phrase, notes i..j, from the squeezed consonants and each note's end. */
function layPhrase(
  placed: readonly Placed[],
  onset: readonly Timed[][],
  coda: readonly Timed[][],
  soundEnds: readonly number[],
  i: number,
  j: number,
): SungPhrase | undefined {
  const spans: SungSpan[] = [];
  const beat = placed[i].time;
  const start = beat - total(onset[i]);
  const pitches: SungPitch[] = [{ time: start, hz: placed[i].hz }];
  layConsonants(spans, onset[i], start, beat, 'onset');
  for (let k = i; k <= j; k++) {
    const p = placed[k];
    const end = soundEnds[k];
    const vowelEnd = Math.max(p.time, end - total(coda[k]));
    const chainEnds = k === j || placed[k + 1].syl.melisma !== true;
    const continues = k > i && p.syl.melisma === true;
    layNucleus(spans, p.syl.nucleus.ipa, p.time, vowelEnd, chainEnds, continues);
    layConsonants(spans, coda[k], vowelEnd, end, 'coda');
    if (k < j) {
      /* the onset moves the pitch at its first consonant; with no onset, on the beat */
      pitches.push({ time: end, hz: placed[k + 1].hz });
      layConsonants(spans, onset[k + 1], end, placed[k + 1].time, 'onset');
    }
  }
  if (spans.length === 0) return undefined;
  return {
    start: spans[0].start,
    end: spans[spans.length - 1].end,
    vel: placed[i].vel,
    spans,
    pitches,
  };
}

/*
 * Consonants end to end from `from`, the last one ending exactly at `to`,
 * so the next span starts on an exact anchor (a beat, or the start of the
 * next onset) whatever rounding the sums picked up.
 */
function layConsonants(
  spans: SungSpan[],
  group: readonly Timed[],
  from: number,
  to: number,
  kind: 'onset' | 'coda',
): void {
  let t = from;
  for (let g = 0; g < group.length; g++) {
    const end = g === group.length - 1 ? to : Math.min(to, t + group[g].dur);
    if (end > t) spans.push({ ipa: group[g].ipa, start: t, end, kind });
    t = end;
  }
}

/*
 * A note's vowel from its beat to `to`. A diphthong glides at the end of
 * the note that ends its chain; earlier notes of a melisma hold its first
 * vowel. A melisma note continues the span before it when that is the same
 * vowel, so a held vowel is one span however many notes it crosses.
 */
function layNucleus(
  spans: SungSpan[],
  ipa: string,
  from: number,
  to: number,
  chainEnds: boolean,
  continues: boolean,
): void {
  const parts = splitDiphthong(ipa);
  if (parts !== undefined && chainEnds) {
    const glide = from + DIPHTHONG_HOLD * (to - from);
    layVowel(spans, parts[0], from, glide, continues);
    layVowel(spans, parts[1], glide, to, false);
  } else {
    layVowel(spans, parts === undefined ? ipa : parts[0], from, to, continues);
  }
}

function layVowel(
  spans: SungSpan[],
  ipa: string,
  from: number,
  to: number,
  continues: boolean,
): void {
  if (!(to > from)) return;
  const prev = spans[spans.length - 1];
  const same = prev !== undefined && prev.kind === 'nucleus' && prev.ipa === ipa;
  if (continues && same && prev.end === from) {
    prev.end = to;
    return;
  }
  spans.push({ ipa, start: from, end: to, kind: 'nucleus' });
}
