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
  // English endings and spellings ahead of the general rules, each group scored against the CMU dictionary
  // over 115,507 words and two lists of 827 common and lyric words (no list word lost; MEASURED 2026-11-13)
  // monosyllable -ed/-es keep their vowel (red, bed, yes)
  ['#C', 'ed', '#', 'ɛ d'], ['#CC', 'ed', '#', 'ɛ d'], ['#CCC', 'ed', '#', 'ɛ d'], ['#C', 'es', '#', 'ɛ s'],
  ['#CC', 'es', '#', 'ɛ s'], ['#y', 'es', '#', 'ɛ s'],
  // -ed after t/d is ɪd, after voiceless is t
  ['t', 'ed', '#', 'ɪ d'], ['d', 'ed', '#', 'ɪ d'], ['k', 'ed', '#', 't'], ['p', 'ed', '#', 't'],
  ['s', 'ed', '#', 't'], ['f', 'ed', '#', 't'], ['x', 'ed', '#', 't'], ['h', 'ed', '#', 't'], ['c', 'ed', '#', 't'],
  // -es after sibilants is ɪz (kisses, roses, changes)
  ['s', 'es', '#', 'ɪ z'], ['z', 'es', '#', 'ɪ z'], ['x', 'es', '#', 'ɪ z'], ['h', 'es', '#', 'ɪ z'],
  ['c', 'es', '#', 'ɪ z'], ['g', 'es', '#', 'ɪ z'],
  // final s after a voiced consonant letter is z
  ['r', 's', '#', 'z'], ['l', 's', '#', 'z'], ['m', 's', '#', 'z'], ['n', 's', '#', 'z'], ['d', 's', '#', 'z'],
  ['g', 's', '#', 'z'], ['b', 's', '#', 'z'], ['v', 's', '#', 'z'], ['w', 's', '#', 'z'],
  // final -us is s (bus, chorus)
  ['u', 's', '#', 's'],
  // ng is ŋ before s/ing/ly/ed, n before k is ŋ
  ['', 'ng', 's#', 'ŋ'], ['', 'ng', 'ing', 'ŋ'], ['', 'ng', 'ly', 'ŋ'], ['', 'ng', 'ed#', 'ŋ'], ['', 'n', 'k', 'ŋ'],
  // ew is u, j u after f p m h; iew is j u
  ['', 'iew', '', 'j u'], ['f', 'ew', '', 'j u'], ['p', 'ew', '', 'j u'], ['m', 'ew', '', 'j u'],
  ['h', 'ew', '', 'j u'], ['', 'ew', '', 'u'],
  // -ous/-cious/-tious
  ['', 'cious', '', 'ʃ ə s'], ['', 'tious', '', 'ʃ ə s'], ['', 'ous', '#', 'ə s'],
  // ow: aʊ after word-initial h n c w v, oʊ before s/ing/ly/ed
  ['#h', 'ow', '', 'aʊ'], ['#n', 'ow', '', 'aʊ'], ['#c', 'ow', '', 'aʊ'], ['#w', 'ow', '', 'aʊ'],
  ['#v', 'ow', '', 'aʊ'], ['#all', 'ow', '', 'aʊ'], ['', 'ow', 's#', 'oʊ'], ['', 'ow', 'ing', 'oʊ'],
  ['', 'ow', 'ly', 'oʊ'], ['', 'ow', 'ed#', 'oʊ'],
  // own is oʊ n after l h n gr thr and word-initially
  ['#', 'ow', 'n', 'oʊ'], ['l', 'ow', 'n', 'oʊ'], ['h', 'ow', 'n', 'oʊ'], ['n', 'ow', 'n', 'oʊ'],
  ['gr', 'ow', 'n', 'oʊ'], ['thr', 'ow', 'n', 'oʊ'],
  // final o is oʊ
  ['', 'o', '#', 'oʊ'],
  // old/olt is oʊ
  ['', 'o', 'ld', 'oʊ'], ['', 'o', 'lt', 'oʊ'],
  // ind/ild is aɪ
  ['', 'i', 'nd#', 'aɪ'], ['', 'i', 'nds#', 'aɪ'], ['', 'i', 'nding', 'aɪ'], ['', 'i', 'ndly', 'aɪ'],
  ['', 'i', 'ndness', 'aɪ'], ['', 'i', 'ld#', 'aɪ'], ['', 'i', 'ldly', 'aɪ'],
  // all/alk is ɔ
  ['', 'all', '#', 'ɔ l'], ['', 'all', 's#', 'ɔ l'], ['', 'all', 'ing', 'ɔ l'], ['', 'all', 'ed#', 'ɔ l'],
  ['', 'alk', '', 'ɔ k'],
  // war is w ɔ ɹ, wa+CC is w ɑ
  ['w', 'ar', '', 'ɔ ɹ'], ['w', 'a', 'CC', 'ɑ'], ['w', 'a', 'C#', 'ɑ'],
  // ea is ɛ before d#, dy, lth, th#, ther, v+y/en, sant, sure
  ['', 'ea', 'd#', 'ɛ'], ['', 'ea', 'dy', 'ɛ'], ['', 'ea', 'lth', 'ɛ'], ['', 'ea', 'th#', 'ɛ'],
  ['', 'ea', 'ther', 'ɛ'], ['', 'ea', 'vy', 'ɛ'], ['', 'ea', 'ven', 'ɛ'], ['', 'ea', 'sant', 'ɛ'],
  ['', 'ea', 'sure', 'ɛ'], ['', 'ea', 'dow', 'ɛ'],
  // oo is ʊ before k, in good wood hood stood foot; door floor
  ['', 'oo', 'k', 'ʊ'], ['g', 'oo', 'd', 'ʊ'], ['w', 'oo', 'd', 'ʊ'], ['h', 'oo', 'd', 'ʊ'], ['t', 'oo', 'd', 'ʊ'],
  ['f', 'oo', 't', 'ʊ'], ['d', 'oo', 'r', 'ɔ'], ['fl', 'oo', 'r', 'ɔ'],
  // o is ʌ in love, above, cover, some, come, wonder, money, honey, month, other
  ['l', 'o', 've', 'ʌ'], ['l', 'o', 'vi', 'ʌ'], ['b', 'o', 've#', 'ʌ'], ['c', 'o', 'ver', 'ʌ'],
  ['s', 'o', 'me', 'ʌ'], ['c', 'o', 'me', 'ʌ'], ['w', 'o', 'n', 'ʌ'], ['', 'o', 'ney', 'ʌ'], ['', 'o', 'nth', 'ʌ'],
  ['', 'o', 'ther', 'ʌ'], ['', 'o', 'thing', 'ʌ'],
  // th is ð before er and in final the
  ['', 'th', 'er', 'ð'], ['', 'th', 'e#', 'ð'],
  // ear is ɝ before l n ch th; heart
  ['', 'ear', 'l', 'ɝ'], ['', 'ear', 'n', 'ɝ'], ['', 'ear', 'ch', 'ɝ'], ['', 'ear', 'th', 'ɝ'],
  ['h', 'ear', 'd#', 'ɝ'], ['h', 'ear', 't', 'ɑ ɹ'],
  // are# is ɛ ɹ, a before rr is æ
  ['C', 'are', '#', 'ɛ ɹ'], ['', 'a', 'rr', 'æ'],
  // ar+V is ɛ ɹ
  ['C', 'a', 'rV', 'ɛ'],
  // ire is aɪ ɹ, one syllable as a sung word keeps one note (fire, tire, inspire); sure
  ['', 'i', 're#', 'aɪ'], ['V', 'sure', '', 'ʒ ɚ'], ['#', 's', 'ure', 'ʃ'], ['', 'ure', '#', 'ʊ ɹ'],
  // i is ɪ in -ity, -tive; -ily is ə
  ['', 'i', 'ty#', 'ɪ'], ['t', 'i', 've#', 'ɪ'], ['C', 'i', 'ly#', 'ə'],
  // i+v+V is ɪ
  ['', 'i', 'ver', 'ɪ'], ['', 'i', 'ven', 'ɪ'],
  // initial a+CV is ə (but a_e is eɪ); initial awa is ə
  ['#', 'a', 'Ce#', 'eɪ'], ['#', 'a', 'wa', 'ə'], ['#', 'a', 'CV', 'ə'],
  // u+CV is j u after initial, m f p b c h
  ['#', 'u', 'CV', 'j u'], ['m', 'u', 'CV', 'j u'], ['f', 'u', 'CV', 'j u'], ['p', 'u', 'CV', 'j u'],
  ['b', 'u', 'CV', 'j u'], ['c', 'u', 'CV', 'j u'], ['h', 'u', 'CV', 'j u'],
  // ou: soul, touch, young, double, country; ought
  ['', 'ough', 't', 'ɔ'], ['', 'ou', 'l', 'oʊ'], ['', 'ou', 'ng', 'ʌ'], ['', 'ou', 'ble', 'ʌ'],
  ['', 'ou', 'ntry', 'ʌ'],
  // our is ɔ ɹ after f p y c s
  ['f', 'our', '', 'ɔ ɹ'], ['p', 'our', '', 'ɔ ɹ'], ['c', 'our', '', 'ɔ ɹ'], ['s', 'our', '', 'ɔ ɹ'],
  // initial gi is g
  ['#', 'g', 'i', 'g'],
  // wor+C is w ɝ
  ['w', 'or', 'n', 'ɔ ɹ'], ['w', 'or', 'C', 'ɝ'],
  // er+r is ɛ; -ery/-ory after VC are ɚ
  ['', 'er', 'r', 'ɛ'], ['VC', 'er', 'y#', 'ɚ'], ['VC', 'or', 'y#', 'ɚ'], ['VC', 'or', 'ies#', 'ɚ'],
  // ange is eɪ n dʒ, angel
  ['', 'a', 'nge#', 'eɪ'], ['', 'a', 'nges#', 'eɪ'], ['', 'a', 'nged#', 'eɪ'], ['', 'a', 'ngel', 'eɪ'],
  ['', 'n', 'ge#', 'n'], ['', 'n', 'ges#', 'n'], ['', 'n', 'ged#', 'n'], ['', 'n', 'gel', 'n'],
  // final mn is m
  ['m', 'n', '#', ''],
  // initial gu+V is g
  ['#gu', 'y', '#', 'aɪ'], ['#', 'gu', 'V', 'g'],
  // eau is j u
  ['', 'eau', 't', 'j u'],
  // initial al before so w r m th is ɔ l
  ['#', 'al', 'so', 'ɔ l'], ['#', 'al', 'w', 'ɔ l'], ['#', 'al', 'r', 'ɔ l'], ['#', 'al', 'mo', 'ɔ l'],
  ['#', 'al', 'th', 'ɔ l'],
  // voiced s in Vse# and easo
  ['Co', 's', 'e#', 'z'], ['Ci', 's', 'e#', 'z'], ['au', 's', 'e#', 'z'], ['ai', 's', 'e#', 'z'],
  ['oi', 's', 'e#', 'z'], ['ea', 's', 'on', 'z'],
  // here/where/sphere
  ['#h', 'ere', '#', 'ɪ ɹ'], ['h', 'ere', '#', 'ɛ ɹ'], ['', 'ere', '#', 'ɪ ɹ'],
  // ost after m p h is oʊ; only
  ['m', 'o', 'st', 'oʊ'], ['p', 'o', 'st', 'oʊ'], ['h', 'o', 'st', 'oʊ'], ['#', 'o', 'nly', 'oʊ'],
  // silent e before a suffix (lonely, lovely, hopeful)
  ['VC', 'e', 'ly#', ''], ['VC', 'e', 'ful', ''], ['VC', 'e', 'ness', ''], ['VC', 'e', 'ment', ''],
  ['VC', 'e', 'less', ''],
  // water, father
  ['w', 'a', 'ter', 'ɔ'], ['f', 'a', 'ther', 'ɑ'],
  // short vowel before C+ow (shadow, widow)
  ['', 'a', 'Cow', 'æ'], ['', 'i', 'Cow', 'ɪ'],
  // ir+V is ɪ ɹ (spirit, miracle)
  ['', 'i', 'rV', 'ɪ'],
  // for- prefix before ev/g is f ɚ
  ['#f', 'or', 'ev', 'ɚ'], ['#f', 'or', 'g', 'ɚ'],
  // interjections: final h after a vowel is silent, oh is oʊ, aa is ɑ, ye, hey
  ['#', 'o', 'h#', 'oʊ'], ['V', 'h', '#', ''], ['', 'aa', '', 'ɑ'], ['#y', 'e', '#', 'i'], ['#h', 'ey', '#', 'eɪ'],
  ['', 'eah', '#', 'æ'],
  // the general rules
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
  // primary stress on the first full vowel: a reduced first vowel (about, forget) is unstressed
  // (MEASURED against the CMU dictionary: the stressed syllable right in 83 percent of polysyllables, from 78)
  let at = phones.findIndex((p) => isVowel(p) && p !== 'ə' && p !== 'ɚ');
  if (at < 0) at = phones.findIndex((p) => isVowel(p));
  for (let k = 0; k < phones.length; k++) {
    const ipa = phones[k];
    if (!isVowel(ipa)) out.push({ ipa });
    else out.push({ ipa, stress: k === at ? 1 : 0 });
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
