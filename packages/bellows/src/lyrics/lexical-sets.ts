/*
 * Wells's lexical sets (J. C. Wells, Accents of English, 1982): a name for the vowel a word has,
 * independent of how any one accent says it. The letter-to-sound rules and the dictionary speak General
 * American; tagging each vowel with its set is what lets an accent say it its own way (accents.ts):
 * British "bath" with PALM's vowel, Australian "goose" fronted, Irish "face" a long monophthong.
 *
 * A set comes from the General American vowel, the r after it, its stress and, where General American has
 * merged what other accents keep apart, the spelling: LOT ("cot", spelled o) against PALM ("calm",
 * spelled a), THOUGHT ("caught": au, aw, al, ough) against CLOTH ("cloth", "dog", "long"), and TRAP
 * against BATH, the set Southern British says with PALM's vowel. BATH is partly lexical, so it is the
 * phonetic rule ("staff", "path", "glass", "ask": a before f, th or s that ends the syllable) plus a word
 * list for the n clusters ("dance", "plant", "can't", but not "ant").
 */

import type { Segment } from './types';
import { isVowel } from './ipa';

/** Wells's 24 lexical sets and the three weak ones (happY, lettER, commA). */
export type LexicalSet =
  | 'KIT'
  | 'DRESS'
  | 'TRAP'
  | 'LOT'
  | 'STRUT'
  | 'FOOT'
  | 'BATH'
  | 'CLOTH'
  | 'NURSE'
  | 'FLEECE'
  | 'FACE'
  | 'PALM'
  | 'THOUGHT'
  | 'GOAT'
  | 'GOOSE'
  | 'PRICE'
  | 'CHOICE'
  | 'MOUTH'
  | 'NEAR'
  | 'SQUARE'
  | 'START'
  | 'NORTH'
  | 'FORCE'
  | 'CURE'
  | 'happY'
  | 'lettER'
  | 'commA';

export const LEXICAL_SETS: readonly LexicalSet[] = [
  'KIT', 'DRESS', 'TRAP', 'LOT', 'STRUT', 'FOOT', 'BATH', 'CLOTH', 'NURSE', 'FLEECE', 'FACE', 'PALM',
  'THOUGHT', 'GOAT', 'GOOSE', 'PRICE', 'CHOICE', 'MOUTH', 'NEAR', 'SQUARE', 'START', 'NORTH', 'FORCE',
  'CURE', 'happY', 'lettER', 'commA',
];

/* BATH before an n cluster is lexical: these take it in Southern British, "ant", "cancer", "romance" do not. */
const BATH_WORDS = new Set([
  'dance', 'dancer', 'dancing', 'chance', 'glance', 'lance', 'prance', 'trance', 'france', 'advance', 'enhance',
  'plant', 'grant', 'slant', 'chant', 'aunt', "can't", "shan't", 'branch', 'answer', 'example', 'sample', 'demand',
  'command', 'commander', 'remand', 'rather', 'father', 'half', 'calf', 'laugh', 'laughter', 'banana', 'drama',
]);
/* A before f, th or s and then a vowel stays TRAP ("classic", "passage", "gaffe" aside): these are BATH anyway. */
const BATH_BEFORE_VOWEL = new Set(['after', 'nasty', 'master', 'disaster', 'plaster', 'pastor', 'rafter', 'castle', 'fasten']);

/* THOUGHT's spellings; "wa" too, since General American's ɔ after it is THOUGHT ("water", "walk"). */
const THOUGHT_SPELLING = /au|aw|al[lkt]|ough|augh|oa|wa/;

/**
 * Tag every vowel of one word's segments (General American, as the reader produced them) with its
 * lexical set, in place. `word` is the spelling, lower-cased.
 */
export function tagLexicalSets(word: string, segs: Segment[]): void {
  const w = word.toLowerCase();
  const vowels: number[] = [];
  for (let i = 0; i < segs.length; i++) if (isVowel(segs[i].ipa)) vowels.push(i);
  for (let n = 0; n < vowels.length; n++) {
    const i = vowels[n];
    const seg = segs[i];
    const next = segs[i + 1]?.ipa;
    const after = segs[i + 2]?.ipa;
    const r = next === 'ɹ';
    // an r that closes the syllable: the word ends there or a consonant follows ("car", "card"), not "carry"
    const rCoda = r && (after === undefined || !isVowel(after));
    const stressed = seg.stress !== undefined && seg.stress > 0;
    const last = n === vowels.length - 1;
    seg.set = classify(seg.ipa, { w, next, after, rCoda, stressed, last });
  }
}

function classify(
  v: string,
  c: { w: string; next?: string; after?: string; rCoda: boolean; stressed: boolean; last: boolean },
): LexicalSet | undefined {
  switch (v) {
    case 'i':
      if (c.rCoda) return 'NEAR';
      return !c.stressed && c.last ? 'happY' : 'FLEECE';
    case 'ɪ':
      return c.rCoda ? 'NEAR' : 'KIT';
    case 'ɛ':
      return c.rCoda ? 'SQUARE' : 'DRESS';
    case 'eɪ':
      return c.rCoda ? 'SQUARE' : 'FACE';
    case 'æ': {
      if (BATH_WORDS.has(c.w) || BATH_BEFORE_VOWEL.has(c.w)) return 'BATH';
      const fric = c.next === 'f' || c.next === 'θ' || c.next === 's';
      if (fric && (c.after === undefined || !isVowel(c.after))) return 'BATH';
      return 'TRAP';
    }
    case 'ɑ':
      if (c.rCoda) return 'START';
      // "watch", "want", "quality": a after w is LOT's vowel
      if (/(w|qu)a/.test(c.w)) return 'LOT';
      if (c.w.includes('o') && !/a(?!u|w)/.test(c.w)) return 'LOT';
      if (c.w.includes('a') && !c.w.includes('o')) return 'PALM';
      return 'LOT';
    case 'ɔ':
      if (c.rCoda) return 'NORTH';
      return THOUGHT_SPELLING.test(c.w) ? 'THOUGHT' : 'CLOTH';
    case 'oʊ':
      return c.rCoda ? 'FORCE' : 'GOAT';
    case 'ʌ':
      return 'STRUT';
    case 'ʊ':
      return c.rCoda ? 'CURE' : 'FOOT';
    case 'u':
      return c.rCoda ? 'CURE' : 'GOOSE';
    case 'ɝ':
    case 'ɚ':
      return c.stressed ? 'NURSE' : 'lettER';
    case 'ə':
      // commA is a schwa that ends a word ("comma", "sofa"); one before a consonant ("little", "away") has no set
      return c.last && c.next === undefined ? 'commA' : undefined;
    case 'aɪ':
      return 'PRICE';
    case 'aʊ':
      return 'MOUTH';
    case 'ɔɪ':
      return 'CHOICE';
    default:
      return undefined;
  }
}
