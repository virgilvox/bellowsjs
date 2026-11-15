/*
 * Speech as notes: the syllables of a spoken phrase timed and pitched the way an accent speaks, so the
 * sung planner (sing.ts) can say them. English is stress-timed: a stressed syllable takes about twice
 * an unstressed one's vowel time, and the last syllable of a phrase lengthens (phrase-final
 * lengthening, Klatt 1976). Pitch follows a simple autosegmental reading of English intonation
 * (Pierrehumbert 1980, in the shape ToBI writes): a baseline that sinks across the phrase
 * (declination), a pitch accent on each stressed syllable, and on the phrase's last stressed syllable
 * the nuclear tone that ends it, a fall to below the baseline or a rise above it.
 *
 * The figures are this module's, chosen to sound like ordinary read speech at a given rate, not
 * fitted to a corpus: vowels of 0.18 s stressed and 0.09 s unstressed, final lengthening of 1.5, and
 * each consonant's spoken duration (durations.ts) added to the note it closes or opens.
 */

import type { Syllable, SungNote } from './types';
import type { Prosody } from './accents';
import { DEFAULT_PROSODY } from './accents';
import { consonantDuration } from './durations';

const STRESSED_VOWEL = 0.18;
const UNSTRESSED_VOWEL = 0.09;
const FINAL_LENGTHENING = 1.5;
/** The pause after a phrase, s. */
const PHRASE_PAUSE = 0.28;

export interface SpeechOptions {
  /** The speaker's baseline pitch, Hz. Default 110. */
  hz?: number;
  /** Rate over the accent's own, 1 normal, 2 twice as fast. */
  rate?: number;
  /** The melody; the accent's, or General American's. */
  prosody?: Prosody;
  /** End the last phrase rising, as a yes-no question does. Default: the text ends with "?". */
  question?: boolean;
}

/** A spoken note: a syllable's, or a rest (`hz` 0) for the pause after a phrase. Times from 0, s. */
export interface SpokenNote extends SungNote {
  rest?: boolean;
}

/** Speech ready for the sung planner: the syllables (with a held copy where a tone moves inside one) and a note each. */
export interface SpeechPlan {
  syllables: Syllable[];
  /** One per syllable, plus the rests between phrases. */
  notes: SpokenNote[];
}

/**
 * Time and pitch each syllable as speech. `questions` marks, per phrase, the ones that end rising (a
 * yes-no question), whatever the accent's tune. A nuclear tone on a phrase's last syllable moves
 * within it, so that syllable is sung as two notes, its vowel carried onto the second as a melisma.
 */
export function speechPlan(
  syllables: readonly Syllable[],
  opts: SpeechOptions = {},
  questions: readonly boolean[] = [],
): SpeechPlan {
  const pro = opts.prosody ?? DEFAULT_PROSODY;
  const hz = opts.hz !== undefined && opts.hz > 0 ? opts.hz : 110;
  const rate = Math.max(0.1, (opts.rate ?? 1) * pro.rate);
  const out: SpokenNote[] = [];
  const sylOut: Syllable[] = [];
  let t = 0;
  let phrase = 0;
  for (let start = 0; start < syllables.length; ) {
    let end = start;
    while (end < syllables.length - 1 && !syllables[end].phraseEnd) end++;
    const span = syllables.slice(start, end + 1);
    const rising = questions[phrase] ?? pro.tune === 'rise';
    const { pitches, endTone } = phrasePitches(span, pro, rising);
    for (let k = 0; k < span.length; k++) {
      const syl = span[k];
      const last = k === span.length - 1;
      const stressed = syl.nucleus.stress !== undefined && syl.nucleus.stress > 0;
      let vowel = syl.nucleus.dur ?? (stressed ? STRESSED_VOWEL : UNSTRESSED_VOWEL);
      if (last) vowel *= FINAL_LENGTHENING;
      let consonants = 0;
      for (const c of syl.coda) consonants += c.dur ?? consonantDuration(c.ipa);
      // the next syllable's opening consonants come out of this note
      if (!last) for (const c of span[k + 1].onset) consonants += c.dur ?? consonantDuration(c.ipa);
      if (last && endTone !== undefined) {
        // the tone moves inside the syllable: its first half at the accent, the rest carried to the end tone
        const first = (0.45 * vowel) / rate;
        const second = (0.55 * vowel + consonants) / rate;
        sylOut.push({ ...syl, coda: [], phraseEnd: false, wordEnd: false });
        sylOut.push({ text: '~', onset: [], nucleus: { ...syl.nucleus }, coda: syl.coda, melisma: true, wordEnd: syl.wordEnd, phraseEnd: syl.phraseEnd });
        out.push({ time: t, dur: first, hz: hz * 2 ** (pitches[k] / 12) });
        out.push({ time: t + first, dur: second, hz: hz * 2 ** (endTone / 12) });
        t += first + second;
        continue;
      }
      const dur = (vowel + consonants) / rate;
      sylOut.push(syl);
      out.push({ time: t, dur, hz: hz * 2 ** (pitches[k] / 12) });
      t += dur;
    }
    if (end < syllables.length - 1) {
      // the pause, and room for the next phrase's opening consonants
      let lead = 0;
      for (const c of syllables[end + 1].onset) lead += c.dur ?? consonantDuration(c.ipa);
      const dur = PHRASE_PAUSE / rate + lead;
      out.push({ time: t, dur, hz: 0, rest: true });
      t += dur;
    }
    phrase++;
    start = end + 1;
  }
  return { syllables: sylOut, notes: out };
}

/**
 * Each syllable's pitch in semitones from the baseline, and, when the nuclear syllable is the last,
 * the tone its vowel moves to.
 */
function phrasePitches(span: readonly Syllable[], pro: Prosody, rising: boolean): { pitches: number[]; endTone?: number } {
  const n = span.length;
  let nuclear = -1;
  for (let k = n - 1; k >= 0; k--) {
    const s = span[k].nucleus.stress;
    if (s !== undefined && s > 0) {
      nuclear = k;
      break;
    }
  }
  if (nuclear < 0) nuclear = n - 1;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const base = n > 1 ? -pro.declination * (k / (n - 1)) : 0;
    const stress = span[k].nucleus.stress ?? 0;
    let st = base;
    if (k < nuclear) {
      // prenuclear accents, the first highest, secondary stress lower
      if (stress === 1) st += pro.range * (k === firstStressed(span) ? 1 : 0.7);
      else if (stress === 2) st += pro.range * 0.35;
    } else if (k === nuclear) {
      st += rising ? -0.25 * pro.range : pro.range;
    } else {
      // the tail falls to below the baseline or climbs, spread across what is left
      const along = (k - nuclear) / (n - 1 - nuclear);
      st += rising ? pro.range * (0.4 + 0.8 * along) : -0.6 * pro.range * along - 0.2 * pro.range;
    }
    out.push(st);
  }
  if (nuclear < n - 1) return { pitches: out };
  // a nuclear tone on the last syllable moves within it
  return { pitches: out, endTone: rising ? -pro.declination + pro.range : -pro.declination - 0.4 * pro.range };
}

function firstStressed(span: readonly Syllable[]): number {
  for (let k = 0; k < span.length; k++) if (span[k].nucleus.stress === 1) return k;
  return -1;
}
