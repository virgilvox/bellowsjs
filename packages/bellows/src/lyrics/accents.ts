/*
 * Accents as data. An accent says how each lexical set (lexical-sets.ts) is voiced, whether r after a
 * vowel is said, and how it treats t, l, th, r and h. The English reader speaks General American and
 * tags every vowel with its set; applyAccent re-voices those tags across a phrase, then the allophone
 * pass (allophones.ts) applies the accent's t and l. IPA written between slashes has no sets and is
 * sung as written.
 *
 * Realizations are IPA. One vowel is a monophthong ("e" for Irish FACE); two vowels are a diphthong
 * that glides from the first to the second, the first held for `hold` of the vowel's time ("əʊ" for
 * Southern British GOAT); a final r ("ʌɾ" for Scottish NURSE) is an r the accent says after the vowel,
 * which replaces the r General American had there or adds one where it had none (General American
 * NURSE has its r inside the vowel). A length mark is read and dropped, since a sung note sets the
 * vowel's length. Every vowel named must be one the vocal engine has (vocal-phonemes.ts): the General
 * American set plus ɒ ɐ ɜ ʉ ɨ ɘ ɵ y ø œ ɯ ɤ, solved from formants (scripts/gen-extra-vowels.mjs).
 *
 * Sources for the tables: J. C. Wells, Accents of English (1982), and the lexical-set tables of the
 * Wikipedia articles on each accent, which cite Cruttenden (Gimson's Pronunciation of English, 2014)
 * for Southern British, Cox and Palethorpe (2007) for Australian, Bauer et al. (2007) for New Zealand,
 * Hickey (2007) for Irish, Stuart-Smith (2004) for Scottish, Wells and Tollfree for London, and Thomas
 * (2004) for the American South. They are broad transcriptions of each accent's mainstream form, not
 * of any one speaker.
 */

import type { LexicalSet } from './lexical-sets';
import type { Segment, Syllable } from './types';
import { isVowel } from './ipa';

/** How /t/ between vowels and before consonants comes out. */
export type TRule =
  /** "water" with a tap, as in North America and Australia. */
  | 'flap'
  /** Every /t/ released. */
  | 'released'
  /** A glottal stop before a consonant ("football", "that one"), released elsewhere. */
  | 'glottal-coda'
  /** A glottal stop before a consonant, a pause, or an unstressed vowel ("water", "bottle", "that"). */
  | 'glottal';
/** How /l/ comes out. */
export type LRule =
  /** Dark after a vowel, clear before one: General American, Southern British. */
  | 'dark-coda'
  /** Clear everywhere: Irish, Welsh. */
  | 'clear'
  /** Dark everywhere: Scottish, much of the American South. */
  | 'dark'
  /** Vocalized to a w-like glide after a vowel ("milk", "bottle"), dark-coda otherwise: London. */
  | 'vocalized';
/** How the dental fricatives come out. */
export type ThRule =
  | 'fricative'
  /** As stops: "think" tink, "this" dis (Irish, many Caribbean and African accents). */
  | 'stop'
  /** Fronted: "think" fink, "brother" bruvver; "this" keeps a d at the start of a word (London). */
  | 'front';
/** How /r/ comes out where it is said. */
export type RRule = 'approximant' | 'tap';

/** How an accent speaks a phrase (lyrics/speech.ts). Singing follows the melody instead. */
export interface Prosody {
  /** The phrase's last tone, from its last stressed syllable: a fall, or a rise (Australian and Belfast statements). */
  tune: 'fall' | 'rise';
  /** Height of a pitch accent on a stressed syllable over the baseline, semitones. */
  range: number;
  /** How far the baseline sinks across a phrase, semitones. */
  declination: number;
  /** Speaking rate, 1 for General American's. */
  rate: number;
}

export interface Accent {
  id: string;
  name: string;
  /** Says r after a vowel ("car", "card"). A non-rhotic accent still links it before a vowel ("far away"). */
  rhotic: boolean;
  /** Each lexical set's realization, IPA. A set left out keeps General American's vowel. */
  sets: Partial<Record<LexicalSet, string>>;
  /**
   * Share of a diphthong's time held on its first vowel, 0 to 1. Left out, General American's 0.8
   * (lyrics/sing.ts). Accents whose diphthongs move through the whole vowel sit near 0.5.
   */
  hold?: number;
  /** Per-set holds over `hold`. */
  holds?: Partial<Record<LexicalSet, number>>;
  t: TRule;
  l: LRule;
  th: ThRule;
  r: RRule;
  /** Drops h at the start of a word ("house" ouse). */
  hDrop?: boolean;
  /** Speech melody and rate; General American's when left out. */
  prosody?: Prosody;
}

/** General American's speech melody: a fall at the end of a statement, accents about four semitones high. */
export const DEFAULT_PROSODY: Prosody = { tune: 'fall', range: 4, declination: 2, rate: 1 };

export const GENERAL_AMERICAN: Accent = {
  id: 'general-american',
  name: 'General American',
  rhotic: true,
  sets: {},
  t: 'flap',
  l: 'dark-coda',
  th: 'fricative',
  r: 'approximant',
};

export const SOUTHERN_BRITISH: Accent = {
  id: 'southern-british',
  name: 'Southern British',
  rhotic: false,
  sets: {
    KIT: 'ɪ', DRESS: 'ɛ', TRAP: 'a', LOT: 'ɒ', STRUT: 'ɐ', FOOT: 'ʊ', BATH: 'ɑː', CLOTH: 'ɒ', NURSE: 'ɜː',
    FLEECE: 'iː', FACE: 'eɪ', PALM: 'ɑː', THOUGHT: 'oː', GOAT: 'əʊ', GOOSE: 'ʉː', PRICE: 'aɪ', CHOICE: 'ɔɪ',
    MOUTH: 'aʊ', NEAR: 'ɪə', SQUARE: 'ɛː', START: 'ɑː', NORTH: 'oː', FORCE: 'oː', CURE: 'oː', happY: 'i',
    lettER: 'ə', commA: 'ə',
  },
  hold: 0.55,
  t: 'glottal-coda',
  l: 'dark-coda',
  th: 'fricative',
  r: 'approximant',
  prosody: { tune: 'fall', range: 6, declination: 3, rate: 1 },
};

export const LONDON: Accent = {
  id: 'london',
  name: 'London',
  rhotic: false,
  sets: {
    KIT: 'ɪ', DRESS: 'e', TRAP: 'æ', LOT: 'ɒ', STRUT: 'ɐ', FOOT: 'ʊ', BATH: 'ɑː', CLOTH: 'ɒ', NURSE: 'ɜː',
    FLEECE: 'əi', FACE: 'æɪ', PALM: 'ɑː', THOUGHT: 'oː', GOAT: 'ʌʊ', GOOSE: 'ʉː', PRICE: 'ɑɪ', CHOICE: 'oɪ',
    MOUTH: 'æʊ', NEAR: 'ɪə', SQUARE: 'eː', START: 'ɑː', NORTH: 'oː', FORCE: 'oː', CURE: 'oː', happY: 'i',
    lettER: 'ə', commA: 'ə',
  },
  hold: 0.5,
  t: 'glottal',
  l: 'vocalized',
  th: 'front',
  r: 'approximant',
  hDrop: true,
  prosody: { tune: 'fall', range: 5, declination: 2, rate: 1.05 },
};

export const AUSTRALIAN: Accent = {
  id: 'australian',
  name: 'Australian',
  rhotic: false,
  sets: {
    KIT: 'ɪ', DRESS: 'e', TRAP: 'æ', LOT: 'ɔ', STRUT: 'ɐ', FOOT: 'ʊ', BATH: 'ɐː', CLOTH: 'ɔ', NURSE: 'ɵː',
    FLEECE: 'ɪi', FACE: 'æɪ', PALM: 'ɐː', THOUGHT: 'oː', GOAT: 'ɐʉ', GOOSE: 'ʉː', PRICE: 'ɒe', CHOICE: 'oɪ',
    MOUTH: 'æɔ', NEAR: 'ɪə', SQUARE: 'eː', START: 'ɐː', NORTH: 'oː', FORCE: 'oː', CURE: 'oː', happY: 'i',
    lettER: 'ə', commA: 'ə',
  },
  hold: 0.45,
  t: 'flap',
  l: 'dark-coda',
  th: 'fricative',
  r: 'approximant',
  prosody: { tune: 'rise', range: 4, declination: 1.5, rate: 1 },
};

export const NEW_ZEALAND: Accent = {
  id: 'new-zealand',
  name: 'New Zealand',
  rhotic: false,
  sets: {
    KIT: 'ɘ', DRESS: 'e', TRAP: 'ɛ', LOT: 'ɒ', STRUT: 'ɐ', FOOT: 'ʊ', BATH: 'ɐː', CLOTH: 'ɒ', NURSE: 'øː',
    FLEECE: 'ɪi', FACE: 'æɪ', PALM: 'ɐː', THOUGHT: 'oː', GOAT: 'ɐʉ', GOOSE: 'ʉː', PRICE: 'ɒe', CHOICE: 'oe',
    MOUTH: 'æʊ', NEAR: 'iə', SQUARE: 'iə', START: 'ɐː', NORTH: 'oː', FORCE: 'oː', CURE: 'ʉə', happY: 'i',
    lettER: 'ɘ', commA: 'ɘ',
  },
  hold: 0.45,
  t: 'flap',
  l: 'dark',
  th: 'fricative',
  r: 'approximant',
  prosody: { tune: 'rise', range: 3.5, declination: 1.5, rate: 1.05 },
};

export const IRISH: Accent = {
  id: 'irish',
  name: 'Irish',
  rhotic: true,
  sets: {
    KIT: 'ɪ', DRESS: 'ɛ', TRAP: 'a', LOT: 'ɑ', STRUT: 'ɐ', FOOT: 'ʊ', BATH: 'aː', CLOTH: 'ɒ', FLEECE: 'iː',
    FACE: 'eː', PALM: 'aː', THOUGHT: 'ɒː', GOAT: 'oː', GOOSE: 'uː', PRICE: 'ɑɪ', CHOICE: 'ɒɪ', MOUTH: 'ɐʊ',
    NEAR: 'i', SQUARE: 'e', START: 'a', NORTH: 'ɒ', FORCE: 'o', CURE: 'u', happY: 'i',
  },
  hold: 0.6,
  t: 'released',
  l: 'clear',
  th: 'stop',
  r: 'approximant',
  prosody: { tune: 'fall', range: 5, declination: 2, rate: 1.05 },
};

export const SCOTTISH: Accent = {
  id: 'scottish',
  name: 'Scottish',
  rhotic: true,
  sets: {
    KIT: 'ɘ', DRESS: 'ɛ', TRAP: 'a', LOT: 'ɔ', STRUT: 'ʌ', FOOT: 'ʉ', BATH: 'a', CLOTH: 'ɔ', NURSE: 'ʌɾ',
    FLEECE: 'i', FACE: 'e', PALM: 'a', THOUGHT: 'ɔ', GOAT: 'o', GOOSE: 'ʉ', PRICE: 'ʌɪ', CHOICE: 'ɔɪ',
    MOUTH: 'ʌʉ', NEAR: 'iɾ', SQUARE: 'eɾ', START: 'aɾ', NORTH: 'ɔɾ', FORCE: 'oɾ', CURE: 'ʉɾ', happY: 'e',
    lettER: 'əɾ', commA: 'ʌ',
  },
  hold: 0.5,
  t: 'glottal-coda',
  l: 'dark',
  th: 'fricative',
  r: 'tap',
  prosody: { tune: 'fall', range: 4, declination: 2, rate: 1 },
};

export const SOUTHERN_US: Accent = {
  id: 'southern-us',
  name: 'Southern US',
  rhotic: true,
  sets: {
    DRESS: 'ɛ', TRAP: 'æ', BATH: 'æ', FACE: 'ɛɪ', THOUGHT: 'ɒɔ', CLOTH: 'ɒɔ', GOAT: 'ɜʉ', GOOSE: 'ʉ',
    PRICE: 'aː', MOUTH: 'æʊ', CHOICE: 'oɪ',
  },
  hold: 0.5,
  t: 'flap',
  l: 'dark',
  th: 'fricative',
  r: 'approximant',
  prosody: { tune: 'fall', range: 5, declination: 2, rate: 0.85 },
};

/** The built-in accents, by id. */
export const ACCENTS: Readonly<Record<string, Accent>> = Object.freeze(
  Object.fromEntries(
    [GENERAL_AMERICAN, SOUTHERN_BRITISH, LONDON, AUSTRALIAN, NEW_ZEALAND, IRISH, SCOTTISH, SOUTHERN_US].map((a) => [a.id, a]),
  ),
);

/** An accent by id, or the accent itself; General American when left out. Throws on an unknown id. */
export function resolveAccent(accent: Accent | string | undefined): Accent {
  if (accent === undefined) return GENERAL_AMERICAN;
  if (typeof accent !== 'string') return accent;
  const found = ACCENTS[accent];
  if (!found) throw new Error(`unknown accent "${accent}"; built in: ${Object.keys(ACCENTS).join(', ')}`);
  return found;
}

/** A realization read into its vowels and the r after them. */
export interface Realization {
  vowels: string[];
  /** The r the accent says after the vowel, or undefined. */
  r?: string;
}

const LENGTH = /[ːˑ:]/g;

/** "əʊ" to { vowels: ['ə', 'ʊ'] }, "ʌɾ" to { vowels: ['ʌ'], r: 'ɾ' }. */
export function readRealization(ipa: string): Realization {
  const chars = Array.from(ipa.replace(LENGTH, ''));
  let r: string | undefined;
  const last = chars[chars.length - 1];
  if (last === 'ɹ' || last === 'ɾ' || last === 'r') {
    r = last === 'r' ? 'ɹ' : last;
    chars.pop();
  }
  const vowels = chars.filter((c) => isVowel(c));
  if (vowels.length === 0 || vowels.length > 2 || vowels.length !== chars.length) {
    throw new Error(`accent realization "${ipa}" is not one or two vowels and an optional r`);
  }
  return { vowels, r };
}

const R_SOUNDS = new Set(['ɹ', 'ɾ', 'r']);

/**
 * Re-voice the English syllables of a lyric in `accent`, in place: vowels by lexical set, r after a
 * vowel, th, r and h. The t and l rules belong to the allophone pass that follows (allophones.ts),
 * since they need the same neighbours flapping does. `english` says which syllables the English
 * reader produced; the rest are left alone.
 */
export function applyAccent(syllables: readonly Syllable[], english: (s: Syllable) => boolean, accent: Accent): void {
  for (let i = 0; i < syllables.length; i++) {
    const syl = syllables[i];
    if (!english(syl) || syl.melisma) continue;
    const next = syllables[i + 1];
    const linked = !syl.phraseEnd && next !== undefined && english(next) && !next.melisma && next.onset.length === 0;
    voiceVowel(syl, accent, linked);
    consonants(syl, accent, i === 0 || syllables[i - 1].wordEnd);
  }
}

function voiceVowel(syl: Syllable, accent: Accent, linked: boolean): void {
  const n = syl.nucleus;
  const set = n.set;
  const spec = set === undefined ? undefined : accent.sets[set];
  // an r-colored General American vowel loses its color in an accent that names its set
  const hadR = n.ipa === 'ɝ' || n.ipa === 'ɚ';
  if (spec !== undefined) {
    const real = readRealization(spec);
    n.ipa = real.vowels.join('');
    if (real.r !== undefined) {
      const r = accent.r === 'tap' ? 'ɾ' : real.r;
      if (syl.coda.length > 0 && R_SOUNDS.has(syl.coda[0].ipa)) syl.coda[0].ipa = r;
      else syl.coda.unshift({ ipa: r });
    } else if (hadR && !accent.rhotic && linked) {
      // linking r: "better off", "her own"
      syl.coda.unshift({ ipa: 'ɹ' });
    }
  }
  if (!accent.rhotic) dropCodaR(syl, linked);
  if (Array.from(n.ipa).length === 2 && set !== undefined) {
    const hold = accent.holds?.[set] ?? accent.hold;
    if (hold !== undefined) n.hold = Math.max(0, Math.min(1, hold));
  }
}

/** A non-rhotic accent says r only before a vowel: "car" and "card" lose it, "far away" keeps it. */
function dropCodaR(syl: Syllable, linked: boolean): void {
  for (let k = syl.coda.length - 1; k >= 0; k--) {
    if (!R_SOUNDS.has(syl.coda[k].ipa)) continue;
    const last = k === syl.coda.length - 1;
    if (last && linked) continue;
    syl.coda.splice(k, 1);
  }
}

function consonants(syl: Syllable, accent: Accent, wordStart: boolean): void {
  const parts: Segment[][] = [syl.onset, syl.coda];
  for (const segs of parts) {
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const first = wordStart && segs === syl.onset && k === 0;
      if (accent.th === 'stop') {
        if (s.ipa === 'θ') s.ipa = 't';
        else if (s.ipa === 'ð') s.ipa = 'd';
      } else if (accent.th === 'front') {
        if (s.ipa === 'θ') s.ipa = 'f';
        else if (s.ipa === 'ð') s.ipa = first ? 'd' : 'v';
      }
      if (accent.r === 'tap' && s.ipa === 'ɹ') s.ipa = 'ɾ';
    }
  }
  if (accent.hDrop && wordStart && syl.onset.length > 0 && syl.onset[0].ipa === 'h') syl.onset.shift();
}
