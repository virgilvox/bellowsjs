/*
 * Letter-to-sound rules: a pronunciation for an English word no dictionary has, or for every
 * word when no dictionary is given. Crude but deterministic; a dictionary or /IPA/ in the lyric
 * is the way to get a word exactly.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/src/phonetics/english.rs at
 * 1d3ea49 (TypeScript original at cd247a6^:src/engine/phonetics/english.ts). Changes from the
 * original: a doubled consonant sounds once; "he", "the" say i, "my", "fly" say aɪ and "la",
 * "spa" say ɑ; "le" is a syllable only after a consonant. See THIRD_PARTY_NOTICES.md.
 *
 * Each rule is (before, letters, after, phones). At each position the rules are tried in table
 * order and the first whose letters and contexts match wins; a position no rule matches is
 * skipped. Contexts: '#' the word boundary, 'V' a vowel letter (a e i o u y), 'C' any other
 * character, anything else a literal letter. The first vowel takes primary stress.
 *
 * Upstream loads CMUdict at start-up, so these rules rarely run there. Bellows ships no
 * dictionary, so here they are the default, and the changes are the ones that cost a sung line
 * a note or a word. Each was measured against the 117,493 lower-case alphabetic words of the
 * cmudict.dict copy CHIMERA ships (first pronunciation of each word):
 *
 * - Doubled consonants. English doubles a consonant letter to keep the vowel before it short
 *   ("hopping", not "hoping"), so the rules must see both letters but the word has one
 *   consonant. Upstream sang two, a coda and an onset, which on a stop is two closures. Equal
 *   adjacent consonants are merged as the phones are emitted, which also merges "c" + "qu" and
 *   "x" + "c" ("acquire", "excel").
 * - A final e after one or two consonants that open the word is the word's only vowel, so it
 *   is not silent: "he", "she", "the", "me", "we", "be". Upstream gave them no vowel, so they
 *   had no syllable and vanished from a lyric; that was 6 of 161 common lyric words and 224
 *   dictionary words, now 0 and 198. The vowel matches CMUdict on 14 of these 27 dictionary
 *   words, up from 1.
 * - A final y after one to three consonants that open the word says aɪ: "my", "by", "fly",
 *   "try", "spry". Upstream sang them with i, which matched CMUdict on 0 of 28; now 27.
 * - A final a after one or two consonants that open the word says ɑ: "la", "ma", "pa", "spa",
 *   "bra". Upstream sang æ, so `sing('la la la')` sang "lææ", matching CMUdict on 0 of its 36
 *   such words; now 23, the rest being letter names ("dna", "nba") and "ca", "sta".
 * - "le" at the end is a syllable after a consonant ("twin-kle") but not after a vowel, where
 *   the e is silent ("smile", "while", "pale"). Same syllable count as CMUdict on 422 of 529
 *   vowel + "le" words, up from 75, and unchanged on the 1,768 consonant + "le" words.
 */

import type { Segment } from './types';
import { isVowel } from './ipa';

type Rule = readonly [before: string, letters: string, after: string, phones: string];

const RULES: readonly Rule[] = [
  ['', 'tion', '', 'ʃ ə n'], ['', 'sion', '', 'ʒ ə n'], ['', 'ture', '', 'tʃ ɚ'],
  ['', 'ough', '#', 'oʊ'], ['', 'augh', '', 'ɔ'], ['', 'igh', '', 'aɪ'], ['', 'eigh', '', 'eɪ'],
  ['', 'tch', '', 'tʃ'], ['', 'dge', '', 'dʒ'], ['', 'sch', '', 's k'], ['', 'ch', '', 'tʃ'],
  ['', 'sh', '', 'ʃ'], ['', 'th', '', 'θ'], ['', 'ph', '', 'f'], ['', 'wh', '', 'w'],
  ['', 'ck', '', 'k'], ['', 'ng', '#', 'ŋ'], ['', 'ng', '', 'ŋ g'], ['', 'qu', '', 'k w'],
  ['#', 'kn', '', 'n'], ['#', 'wr', '', 'ɹ'], ['', 'gh', '', ''], ['', 'ee', '', 'i'],
  ['', 'ea', '', 'i'], ['', 'oo', '', 'u'], ['', 'ou', '', 'aʊ'], ['', 'ow', '#', 'oʊ'],
  ['', 'ow', '', 'aʊ'], ['', 'oi', '', 'ɔɪ'], ['', 'oy', '', 'ɔɪ'], ['', 'ai', '', 'eɪ'],
  ['', 'ay', '', 'eɪ'], ['', 'au', '', 'ɔ'], ['', 'aw', '', 'ɔ'], ['', 'ie', '#', 'aɪ'],
  ['', 'ie', '', 'i'], ['', 'ei', '', 'eɪ'], ['', 'ey', '#', 'i'], ['', 'oa', '', 'oʊ'],
  ['', 'ue', '#', 'u'], ['', 'er', '#', 'ɚ'], ['', 'er', 'C', 'ɝ'], ['', 'ir', '', 'ɝ'],
  ['', 'ur', '', 'ɝ'], ['', 'or', '', 'ɔ ɹ'], ['', 'ar', '', 'ɑ ɹ'], ['C', 'le', '#', 'ə ɫ'],
  ['', 'ed', '#', 'd'], ['', 'es', '#', 'z'], ['C', 's', '#', 's'], ['V', 's', '#', 'z'],
  ['#C', 'y', '#', 'aɪ'], ['#CC', 'y', '#', 'aɪ'], ['#CCC', 'y', '#', 'aɪ'], ['', 'y', '#', 'i'],
  ['#', 'y', '', 'j'], ['C', 'y', '', 'aɪ'], ['#C', 'e', '#', 'i'], ['#CC', 'e', '#', 'i'],
  ['', 'e', '#', ''], ['#C', 'a', '#', 'ɑ'], ['#CC', 'a', '#', 'ɑ'], ['', 'a', 'CV', 'eɪ'],
  ['', 'a', '', 'æ'], ['', 'e', '', 'ɛ'],
  ['', 'i', 'CV', 'aɪ'], ['', 'i', '', 'ɪ'], ['', 'o', 'CV', 'oʊ'], ['', 'o', '', 'ɑ'],
  ['', 'u', 'CV', 'u'], ['', 'u', '', 'ʌ'], ['', 'y', '', 'ɪ'], ['', 'c', 'e', 's'],
  ['', 'c', 'i', 's'], ['', 'c', 'y', 's'], ['', 'c', '', 'k'], ['', 'g', 'e', 'dʒ'],
  ['', 'g', 'i', 'dʒ'], ['', 'g', '', 'g'], ['', 'x', '', 'k s'], ['', 'j', '', 'dʒ'],
  ['', 'q', '', 'k'], ['', 'b', '', 'b'], ['', 'd', '', 'd'], ['', 'f', '', 'f'],
  ['', 'h', '', 'h'], ['', 'k', '', 'k'], ['', 'l', '', 'l'], ['', 'm', '', 'm'],
  ['', 'n', '', 'n'], ['', 'p', '', 'p'], ['', 'r', '', 'ɹ'], ['', 's', '', 's'],
  ['', 't', '', 't'], ['', 'v', '', 'v'], ['', 'w', '', 'w'], ['', 'z', '', 'z'],
];

/** The phones of each rule, split once. */
const PHONES: readonly (readonly string[])[] = RULES.map((r) => (r[3] ? r[3].split(' ') : []));

/** A lower-case word to segments by rule. Never throws; characters no rule reads are skipped. */
export function letterToSound(word: string): Segment[] {
  const phones: string[] = [];
  let i = 0;
  while (i < word.length) {
    let matched = false;
    for (let r = 0; r < RULES.length; r++) {
      const [before, letters, after] = RULES[r];
      if (!word.startsWith(letters, i)) continue;
      if (!contextMatches(word, i - 1, before, -1)) continue;
      if (!contextMatches(word, i + letters.length, after, 1)) continue;
      for (const p of PHONES[r]) {
        if (!isVowel(p) && p === phones[phones.length - 1]) continue;
        phones.push(p);
      }
      i += letters.length;
      matched = true;
      break;
    }
    if (!matched) i++;
  }
  const out: Segment[] = [];
  let stressed = false;
  for (const ipa of phones) {
    if (!isVowel(ipa)) {
      out.push({ ipa });
      continue;
    }
    out.push({ ipa, stress: stressed ? 0 : 1 });
    stressed = true;
  }
  return out;
}

function isVowelLetter(c: string | undefined): boolean {
  return c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' || c === 'y';
}

/**
 * Whether the context string matches the word read from `at` in direction `dir` (1 forward
 * from the letters' end, -1 backward from their start). The word is indexed in UTF-16 code
 * units, as upstream's was.
 */
function contextMatches(word: string, at: number, context: string, dir: 1 | -1): boolean {
  let pos = at;
  for (let k = 0; k < context.length; k++) {
    const c = dir === 1 ? context[k] : context[context.length - 1 - k];
    const ch = pos >= 0 && pos < word.length ? word[pos] : undefined;
    if (c === '#') {
      if (ch !== undefined) return false;
    } else if (c === 'V') {
      if (!isVowelLetter(ch)) return false;
    } else if (c === 'C') {
      if (ch === undefined || isVowelLetter(ch)) return false;
    } else if (ch !== c) {
      return false;
    }
    pos += dir;
  }
  return true;
}
