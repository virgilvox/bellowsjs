/*
 * IPA text to segments: stress marks, length, syllable dots, word gaps, pauses,
 * affricates and diphthongs, with every diacritic the voice cannot render dropped.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/src/phonetics/ipa.rs at
 * 1d3ea49 (TypeScript original at cd247a6^:src/engine/phonetics/ipa.ts). Changes from the
 * original: Segment has no sound-mark flags or word ends, so ʰ ˭ ʲ ʱ, nasal and breathy marks
 * are dropped and boundaries go to readIpa's `breaks`; only tʃ dʒ and the English diphthongs
 * join; an accented letter keeps its base; a syllabic consonant is sung on a ə before it; a
 * Latin or Greek letter outside the inventory is kept, to be reported, where upstream dropped
 * it. See THIRD_PARTY_NOTICES.md.
 *
 * Reading rules, in order of the scan:
 *
 * - ˈ (or ') and ˌ give primary and secondary stress to the next vowel. A consonant does not
 *   take it, so /ˈtwɪŋ/ stresses the ɪ, as dictionaries write it.
 * - ː (or :) lengthens the segment before it by 1.7, from CHIMERA's bases of 0.15 s for a
 *   vowel and 0.09 s for a consonant when it has no duration yet.
 * - A dot ends a syllable, whitespace ends a word, and a comma, | or ‖ ends a word and writes a
 *   '_' pause of 0.16 s (the vocal engine's silence phoneme).
 * - tʃ dʒ aɪ aʊ ɔɪ eɪ oʊ are one token each. CHIMERA also joins ts dz pf tɕ dʑ tʂ dʐ for German
 *   and Mandarin; here they stay two, because English /kæts/ is k æ t s and no bellows engine
 *   has those affricates. Tie bars are removed, so t͡ʃ reads as tʃ and t͡s as t s.
 * - Combining marks are read and dropped, except the syllabic mark (U+0329 below, U+030D
 *   above): a syllabic consonant has no vowel to carry a note, so /ˈbʌtn̩/ sings ˈbʌ.tən.
 * - A lower-case Latin or Greek letter that is not a known symbol (ʍ ɓ ʘ ǀ λ) is kept as a
 *   consonant. No voice here has a sound for it, but kept, it reaches the facade, which lists it
 *   in `unknown` and holds the sound before it for its time; dropped, a lyric lost a sound and
 *   nobody was told. Greek ε and α, the usual slips for ɛ and ɑ, read as those.
 * - Anything else that is not a known symbol is skipped: digits, capitals, modifier letters
 *   such as ʰ ʷ ʼ (marks on the sound before them), other scripts.
 *
 * Text is NFC-normalized first and then each letter that is not itself a known symbol is
 * decomposed, so a precomposed U+00E1 keeps its a, as a followed by U+0301 always did. CHIMERA
 * keeps the base of seven nasal and breathy vowels this way and drops every other accented
 * letter whole, which loses a tone-marked vowel and with it a sung syllable. ç (U+00E7) stays
 * whole, being a letter in its own right, and U+1E09 recomposes to ç before its acute drops.
 */

import type { Segment } from './types';

/** First characters of a vowel token (ipa.rs VOWEL_CHARS). */
const VOWEL_CHARS = 'iyɨʉɯuɪʏʊeøɘɵɤoəɛœɜɞʌɔæɐaɶɑɒɝɚ';

/** The single-character consonants of CHIMERA's inventory (inventory.rs base()). */
const CONSONANT_CHARS =
  'pbtdʈɖcɟkgqɢʔ' + 'mɱnɳɲŋɴ' + 'ɸβfvθðszʃʒʂʐçʝxɣχʁħʕhɦɬɮɕʑ' + 'wʋɹɻjɥɰlɫɭʎɾɽrʀʙ';

/** Tokens longer than one character. The scan takes the one that matches at a position. */
const MULTI = ['tʃ', 'dʒ', 'aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ'] as const;

/** Spellings of a known symbol by another code point. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['ɡ', 'g'],
  ['ʧ', 'tʃ'],
  ['ʤ', 'dʒ'],
  ['ε', 'ɛ'],
  ['α', 'ɑ'],
  // the reduced vowels of some dictionaries, and the old IPA letters for ɪ and ʊ
  ['ᵻ', 'ɪ'],
  ['ᵿ', 'ʊ'],
  ['ɩ', 'ɪ'],
  ['ɷ', 'ʊ'],
  // ligature affricates, read as their tie-bar spellings are
  ['ʦ', 'ts'],
  ['ʣ', 'dz'],
  ['ʨ', 'tɕ'],
  ['ʥ', 'dʑ'],
]);

/** A lower-case letter of the scripts IPA is written in, which is a sound even when it is not a known one. */
const IPA_LETTER = /^(?=[\p{Ll}\p{Lo}])[\p{Script=Latin}\p{Script=Greek}]$/u;

const VOWELS = new Set(Array.from(VOWEL_CHARS));
const KNOWN = new Set<string>([...VOWEL_CHARS, ...CONSONANT_CHARS, ...MULTI]);

/** The silence a comma or a bar writes, as the vocal engine's '_' phoneme. */
export const PAUSE = '_';
const PAUSE_DUR = 0.16;
/** Bases the length mark scales when a segment has no duration yet (ipa.rs). */
const LONG_VOWEL_BASE = 0.15;
const LONG_CONSONANT_BASE = 0.09;
const LENGTH_FACTOR = 1.7;

const SYLLABIC_BELOW = '\u0329';
const SYLLABIC_ABOVE = '\u030D';
const TIE_BARS = /[\u035C\u0361]/g;

/** What follows a segment in written IPA. */
export const BREAK_NONE = 0;
export const BREAK_SYLLABLE = 1;
export const BREAK_WORD = 2;

export interface IpaReading {
  /** The segments in order, with a '_' segment for each pause. */
  segments: Segment[];
  /** breaks[i] is BREAK_NONE, BREAK_SYLLABLE or BREAK_WORD: what follows segments[i]. */
  breaks: number[];
}

/** A vowel or diphthong symbol, by its first character. */
export function isVowel(ipa: string): boolean {
  const first = ipa.codePointAt(0);
  return first !== undefined && VOWELS.has(String.fromCodePoint(first));
}

/** IPA text to its segments, in order. Never throws; unknown characters are skipped. */
export function tokenizeIpa(input: string): Segment[] {
  return readIpa(input).segments;
}

/** IPA text to its segments and the syllable and word boundaries written between them. */
export function readIpa(input: string): IpaReading {
  const s = Array.from(prepare(input));
  const segments: Segment[] = [];
  const breaks: number[] = [];
  let stress: 0 | 1 | 2 = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === 'ˈ' || ch === "'") {
      stress = 1;
      i++;
      continue;
    }
    if (ch === 'ˌ') {
      stress = 2;
      i++;
      continue;
    }
    if (ch === '.') {
      markBreak(breaks, BREAK_SYLLABLE);
      i++;
      continue;
    }
    if (ch === ',' || ch === '|' || ch === '‖') {
      markBreak(breaks, BREAK_WORD);
      segments.push({ ipa: PAUSE, dur: PAUSE_DUR });
      breaks.push(BREAK_NONE);
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      markBreak(breaks, BREAK_WORD);
      i++;
      continue;
    }
    if (ch === 'ː' || ch === ':') {
      const last = segments[segments.length - 1];
      if (last) {
        const base = isVowel(last.ipa) ? LONG_VOWEL_BASE : LONG_CONSONANT_BASE;
        last.dur = (last.dur ?? base) * LENGTH_FACTOR;
      }
      i++;
      continue;
    }
    let tok = ch;
    for (const m of MULTI) if (startsAt(s, i, m)) tok = m;
    i += tok === ch ? 1 : Array.from(tok).length;
    let syllabic = false;
    while (i < s.length && isCombining(s[i])) {
      if (s[i] === SYLLABIC_BELOW || s[i] === SYLLABIC_ABOVE) syllabic = true;
      i++;
    }
    if (!KNOWN.has(tok) && !IPA_LETTER.test(tok)) continue;
    if (isVowel(tok)) {
      segments.push({ ipa: tok, stress });
      breaks.push(BREAK_NONE);
      stress = 0;
      continue;
    }
    if (syllabic) {
      segments.push({ ipa: 'ə', stress });
      breaks.push(BREAK_NONE);
      stress = 0;
    }
    segments.push({ ipa: tok });
    breaks.push(BREAK_NONE);
  }
  return { segments, breaks };
}

function markBreak(breaks: number[], kind: number): void {
  const last = breaks.length - 1;
  if (last >= 0 && breaks[last] < kind) breaks[last] = kind;
}

function startsAt(s: readonly string[], i: number, token: string): boolean {
  let k = i;
  for (const c of token) {
    if (s[k] !== c) return false;
    k++;
  }
  return true;
}

function isCombining(c: string): boolean {
  return c >= '\u0300' && c <= '\u036F';
}

/** NFC, then each unknown letter decomposed so its base survives, then aliases and tie bars. */
function prepare(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFC')) {
    if (KNOWN.has(ch)) {
      out += ch;
      continue;
    }
    const alias = ALIASES.get(ch);
    if (alias !== undefined) {
      out += alias;
      continue;
    }
    const parts = Array.from(ch.normalize('NFD'));
    if (parts.length > 1) {
      /* ḉ is ç plus an acute: keep the letter the first mark makes, when that is a symbol. */
      const head = (parts[0] + parts[1]).normalize('NFC');
      if (KNOWN.has(head)) {
        out += head + parts.slice(2).join('');
        continue;
      }
    }
    out += parts.join('');
  }
  return out.replace(TIE_BARS, '');
}
