/*
 * English: a written word to its segments, and the front end that sings English lyrics.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/src/phonetics/english.rs
 * (EnglishG2P::word, the homographs and function words) and syllables.rs (the English front
 * end) at 1d3ea49 (TypeScript originals at cd247a6^:src/engine/phonetics/english.ts and
 * syllables.ts). Changes from the original: accented Latin letters fold to their base, so
 * "café" is one word and is looked up as "cafe"; the function words carry their own
 * pronunciations, read when no dictionary has the word. See THIRD_PARTY_NOTICES.md.
 *
 * A word is read from, in order: the homograph table, the injected dictionary, the function
 * words below, and the letter-to-sound rules. The dictionary is CMUdict's shape, lower-case
 * word to ARPAbet (parseCmudict reads the files CMU distributes); without one every other word
 * goes to the rules.
 * Upstream reduces monosyllabic function words to weak forms in speech ("of" as əv); sung,
 * they keep full vowels, so the front end leaves `reduce` off unless asked.
 */

import type { FrontEnd, PronouncingDictionary, Segment, Syllable } from './types';
import { arpabetToSegments } from './arpabet';
import { isVowel } from './ipa';
import { letterToSound } from './letter-to-sound';
import { splitSpelling, syllabifySegments, vowelless } from './syllabify';

export interface EnglishOptions {
  /** Lower-case word to ARPAbet with stress digits, as parseCmudict returns it. */
  dictionary?: PronouncingDictionary;
  /**
   * Weak forms for monosyllabic function words, as in running speech: every vowel unstressed,
   * and a lone ʌ æ ɑ ɛ ɔ u ʊ reduced to ə ("of" sings əv). Off by default: sung, they keep
   * full vowels.
   */
  reduce?: boolean;
}

/*
 * CMUdict lists the rarer reading of these first (the verb "wind", past-tense "read"), and the
 * first entry is the one a dictionary map keeps. Telling them apart needs grammar; the common
 * reading wins, with or without a dictionary.
 */
const HOMOGRAPHS: ReadonlyMap<string, string> = new Map([
  ['wind', 'W IH1 N D'],
  ['read', 'R IY1 D'],
  ['live', 'L IH1 V'],
  ['lead', 'L IY1 D'],
  ['close', 'K L OW1 Z'],
  ['wound', 'W UW1 N D'],
]);

/*
 * Upstream's function words, with a pronunciation each. They are the commonest words of any
 * lyric, and spelling predicts them worst: without a dictionary, which bellows does not ship,
 * the rules read 32 of these 66 wrongly, "the" as θi, "I" as ɪ, "you" as jaʊ, "to" as tɑ
 * (MEASURED). These are the usual readings, written out by hand, and each one agrees with the
 * first entry of the cmudict.dict copy CHIMERA ships (checked as data, 66 of 66), so a lyric
 * sings the same with or without a dictionary loaded. A loaded dictionary is still read first.
 */
const FUNCTION_WORDS: ReadonlyMap<string, string> = new Map([
  ['a', 'AH0'], ['an', 'AE1 N'], ['the', 'DH AH0'], ['of', 'AH1 V'], ['to', 'T UW1'],
  ['in', 'IH0 N'], ['on', 'AA1 N'], ['at', 'AE1 T'], ['by', 'B AY1'], ['for', 'F AO1 R'],
  ['from', 'F R AH1 M'], ['with', 'W IH1 DH'], ['as', 'AE1 Z'], ['and', 'AH0 N D'],
  ['or', 'AO1 R'], ['but', 'B AH1 T'], ['nor', 'N AO1 R'], ['so', 'S OW1'], ['if', 'IH1 F'],
  ['is', 'IH1 Z'], ['am', 'AE1 M'], ['are', 'AA1 R'], ['was', 'W AA1 Z'], ['were', 'W ER1'],
  ['be', 'B IY1'], ['been', 'B IH1 N'], ['do', 'D UW1'], ['does', 'D AH1 Z'], ['did', 'D IH1 D'],
  ['has', 'HH AE1 Z'], ['have', 'HH AE1 V'], ['had', 'HH AE1 D'], ['will', 'W IH1 L'],
  ['would', 'W UH1 D'], ['can', 'K AE1 N'], ['could', 'K UH1 D'], ['should', 'SH UH1 D'],
  ['shall', 'SH AE1 L'], ['may', 'M EY1'], ['might', 'M AY1 T'], ['must', 'M AH1 S T'],
  ['it', 'IH1 T'], ['its', 'IH1 T S'], ['i', 'AY1'], ['you', 'Y UW1'], ['he', 'HH IY1'],
  ['she', 'SH IY1'], ['we', 'W IY1'], ['they', 'DH EY1'], ['me', 'M IY1'], ['him', 'HH IH1 M'],
  ['her', 'HH ER1'], ['us', 'AH1 S'], ['them', 'DH EH1 M'], ['my', 'M AY1'], ['your', 'Y AO1 R'],
  ['his', 'HH IH1 Z'], ['our', 'AW1 ER0'], ['their', 'DH EH1 R'], ['this', 'DH IH1 S'],
  ['that', 'DH AE1 T'], ['than', 'DH AE1 N'], ['then', 'DH EH1 N'], ['there', 'DH EH1 R'],
  ['not', 'N AA1 T'], ['no', 'N OW1'],
]);

/**
 * Common words the letter-to-sound rules cannot read and contractions, from the CMU dictionary (BSD),
 * never weakened. Where CMU lists a one-syllable form (fire, hour, desire) it is the one taken: a sung
 * word keeps one note. MEASURED against the CMU dictionary, with these and the 2026-11-13 rules: 77.0
 * percent of 469 common and lyric words exact (49.7 before), 74.8 percent of 397 inflected ones (9.6).
 */
const IRREGULAR: ReadonlyMap<string, string> = new Map([
  ['one', 'W AH1 N'], ['once', 'W AH1 N S'], ['what', 'W AH1 T'], ['who', 'HH UW1'], ['two', 'T UW1'],
  ['into', 'IH1 N T UW0'], ['through', 'TH R UW1'], ['where', 'W EH1 R'], ['these', 'DH IY1 Z'],
  ['those', 'DH OW1 Z'], ['thee', 'DH IY1'], ['thou', 'DH AW1'], ['thy', 'DH AY1'], ['thine', 'DH AY1 N'],
  ['though', 'DH OW1'], ['people', 'P IY1 P AH0 L'], ['eye', 'AY1'], ['eyes', 'AY1 Z'], ['said', 'S EH1 D'],
  ['any', 'EH1 N IY0'], ['many', 'M EH1 N IY0'], ['anywhere', 'EH1 N IY0 W EH2 R'],
  ['anything', 'EH1 N IY0 TH IH2 NG'], ['anyone', 'EH1 N IY0 W AH2 N'], ['everything', 'EH1 V R IY0 TH IH2 NG'],
  ['everywhere', 'EH1 V R IY0 W EH2 R'], ['everyone', 'EH1 V R IY0 W AH2 N'], ['great', 'G R EY1 T'],
  ['friend', 'F R EH1 N D'], ['hour', 'AW1 R'], ['whole', 'HH OW1 L'], ['woman', 'W UH1 M AH0 N'],
  ['women', 'W IH1 M AH0 N'], ['touch', 'T AH1 CH'], ['ocean', 'OW1 SH AH0 N'], ['together', 'T AH0 G EH1 DH ER0'],
  ['get', 'G EH1 T'], ['forget', 'F ER0 G EH1 T'], ['give', 'G IH1 V'], ['again', 'AH0 G EH1 N'],
  ['against', 'AH0 G EH1 N S T'], ['because', 'B IH0 K AO1 Z'], ['even', 'IY1 V IH0 N'], ['busy', 'B IH1 Z IY0'],
  ['sure', 'SH UH1 R'], ['sugar', 'SH UH1 G ER0'], ['enough', 'IH0 N AH1 F'], ['young', 'Y AH1 NG'],
  ['done', 'D AH1 N'], ['gone', 'G AO1 N'], ['none', 'N AH1 N'], ['bear', 'B EH1 R'], ['wear', 'W EH1 R'],
  ['break', 'B R EY1 K'], ['guy', 'G AY1'], ['buy', 'B AY1'], ['lose', 'L UW1 Z'], ['move', 'M UW1 V'],
  ['goes', 'G OW1 Z'], ['door', 'D AO1 R'], ['fire', 'F AY1 R'], ['desire', 'D IH0 Z AY1 R'], ["i'm", 'AY1 M'],
  ["i'll", 'AY1 L'], ["i've", 'AY1 V'], ["i'd", 'AY1 D'], ["you're", 'Y UH1 R'], ["you'll", 'Y UW1 L'],
  ["you've", 'Y UW1 V'], ["we're", 'W IY1 R'], ["we'll", 'W IY1 L'], ["they're", 'DH EH1 R'], ["don't", 'D OW1 N T'],
  ["won't", 'W OW1 N T'], ["can't", 'K AE1 N T'], ["isn't", 'IH1 Z AH0 N T'], ["it's", 'IH1 T S'],
  ["that's", 'DH AE1 T S'], ["there's", 'DH EH1 R Z'], ["let's", 'L EH1 T S'], ["ain't", 'EY1 N T'],
  ["didn't", 'D IH1 D AH0 N T'], ["doesn't", 'D AH1 Z AH0 N T'], ["wasn't", 'W AA1 Z AH0 N T'],
  ["couldn't", 'K UH1 D AH0 N T'], ["wouldn't", 'W UH1 D AH0 N T'], ["shouldn't", 'SH UH1 D AH0 N T'],
  ["he's", 'HH IY1 Z'], ["she's", 'SH IY1 Z'], ["what's", 'W AH1 T S'], ["o'er", 'OW1 R'], ["ne'er", 'N EH1 R'],
  ["e'er", 'EH1 R'],
]);

/** Vowels a weak form reduces to schwa; i ɪ eɪ aɪ oʊ keep their quality. */
const REDUCES = new Set(['ʌ', 'æ', 'ɑ', 'ɛ', 'ɔ', 'u', 'ʊ']);
/** Function words whose weak form keeps its vowel ("you", "to" do not become jə, tə here). */
const KEEPS_VOWEL = new Set(['you', 'do', 'to', 'who', 'not', 'no']);

const COMBINING = /[\u0300-\u036F]/g;
const EDGE_APOSTROPHES = /^'+|'+$/g;

/**
 * One English word to segments with lexical stress. Letters are lower-cased and apostrophes
 * at either end dropped ("'tis", "dancin'"). A hyphenated word the dictionary lacks is read part
 * by part. Never throws; a word with nothing readable gives [].
 */
export function pronounceEnglish(word: string, opts: EnglishOptions = {}): Segment[] {
  const clean = word.toLowerCase().replace(EDGE_APOSTROPHES, '');
  const folded = clean.normalize('NFD').replace(COMBINING, '');
  const entry = HOMOGRAPHS.get(folded) ?? lookup(opts.dictionary, clean, folded) ?? FUNCTION_WORDS.get(folded) ?? IRREGULAR.get(folded);
  if (entry) {
    const segs = arpabetToSegments(entry);
    if (opts.reduce && FUNCTION_WORDS.has(folded)) weaken(segs, folded);
    return segs;
  }
  if (clean.includes('-')) {
    const out: Segment[] = [];
    for (const part of clean.split('-')) out.push(...pronounceEnglish(part, opts));
    return out;
  }
  return letterToSound(folded);
}

function lookup(
  dictionary: PronouncingDictionary | undefined,
  clean: string,
  folded: string,
): string | undefined {
  if (!dictionary) return undefined;
  /* A dictionary may spell a loanword with its accent; CMUdict spells it without. */
  return dictionary.get(clean) || (folded !== clean ? dictionary.get(folded) : undefined);
}

function weaken(segs: Segment[], word: string): void {
  let vowels = 0;
  for (const s of segs) if (isVowel(s.ipa)) vowels++;
  for (const s of segs) {
    if (!isVowel(s.ipa)) continue;
    s.stress = 0;
    if (vowels === 1 && REDUCES.has(s.ipa) && !KEEPS_VOWEL.has(word)) s.ipa = 'ə';
  }
}

/**
 * The English front end: claims words of Latin letters and apostrophes, continued by hyphens
 * and combining accents. A hyphen inside a word splits syllables explicitly ("ti-ger"), each
 * part showing its whole spelling; otherwise the pronunciation decides the syllables and the
 * spelling is split to match ("twin", "kle").
 */
export function englishFrontEnd(opts: EnglishOptions = {}): FrontEnd {
  return {
    starts: isEnglishLetter,
    continues: (c) => c === '-' || isEnglishLetter(c) || (c >= '\u0300' && c <= '\u036F'),
    word: (word) => englishSyllables(word, opts),
  };
}

function englishSyllables(word: string, opts: EnglishOptions): Syllable[] {
  const parts = word.split('-').filter((p) => p !== '');
  const out: Syllable[] = [];
  for (const part of parts) {
    const segs = pronounceEnglish(part, opts);
    const syllables = syllabifySegments(segs);
    if (syllables.length === 0) {
      const carried = vowelless(segs);
      if (carried) syllables.push(carried);
    }
    const spelling = parts.length > 1 ? [part] : splitSpelling(part, syllables.length);
    for (let i = 0; i < syllables.length; i++) {
      const { onset, nucleus, coda } = syllables[i];
      out.push({ text: spelling[i] ?? '~', onset, nucleus, coda, wordEnd: false, phraseEnd: false });
    }
  }
  return out;
}

/** A-Z, a-z, an apostrophe, or a precomposed Latin letter with accents ("é", "ñ", "İ"). */
function isEnglishLetter(c: string): boolean {
  if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === "'") return true;
  if (c < '\u00C0') return false;
  const d = c.normalize('NFD');
  if (d.length < 2) return false;
  const base = d[0];
  if (!((base >= 'a' && base <= 'z') || (base >= 'A' && base <= 'Z'))) return false;
  for (let i = 1; i < d.length; i++) if (d[i] < '\u0300' || d[i] > '\u036F') return false;
  return true;
}
