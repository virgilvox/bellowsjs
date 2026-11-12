import { describe, expect, it } from 'vitest';
import { englishFrontEnd, pronounceEnglish } from '../../src/lyrics/english';
import { letterToSound } from '../../src/lyrics/letter-to-sound';
import { parseCmudict } from '../../src/lyrics/cmudict';
import { show, sungIpa } from './helpers';

/* A few CMUdict entries (cmudict.dict, first pronunciations), enough to test without the
 * dictionary. "read" is listed with its rarer reading first, as CMUdict lists it. */
const DICT: ReadonlyMap<string, string> = new Map([
  ['heavenly', 'HH EH1 V AH0 N L IY0'],
  ['twinkle', 'T W IH1 NG K AH0 L'],
  ['little', 'L IH1 T AH0 L'],
  ['read', 'R EH1 D'],
  ['wind', 'W AY1 N D'],
  ['cafe', 'K AH0 F EY1'],
  ['naive', 'N AY2 IY1 V'],
  ['of', 'AH1 V'],
  ['and', 'AH0 N D'],
  ['you', 'Y UW1'],
  ['them', 'DH EH1 M'],
  ['hello', 'HH AH0 L OW1'],
  ['empty', ''],
  ['constructor', 'K AH0 N S T R AH1 K T ER0'],
]);

const say = (w: string, opts = {}) => show(pronounceEnglish(w, { dictionary: DICT, ...opts }));

describe('pronounceEnglish', () => {
  it('looks a word up in the dictionary, lower-cased, with edge apostrophes dropped', () => {
    expect(say('heavenly')).toBe('h ɛ1 v ə0 n l i0');
    expect(say('HeAvEnLy')).toBe('h ɛ1 v ə0 n l i0');
    expect(say("'twinkle'")).toBe('t w ɪ1 ŋ k ə0 l');
    /* A word with no entry goes to the rules. */
    expect(say('zorblat')).toBe(show(letterToSound('zorblat')));
    /* So does an entry with no phones. */
    expect(say('empty')).toBe(show(letterToSound('empty')));
  });

  it('reads homographs the common way, with or without a dictionary', () => {
    expect(say('read')).toBe('ɹ i1 d');
    expect(say('wind')).toBe('w ɪ1 n d');
    expect(show(pronounceEnglish('read'))).toBe('ɹ i1 d');
    expect(show(pronounceEnglish('WiNd'))).toBe('w ɪ1 n d');
    expect(show(pronounceEnglish('live'))).toBe('l ɪ1 v');
    expect(show(pronounceEnglish('lead'))).toBe('l i1 d');
    expect(show(pronounceEnglish('close'))).toBe('k l oʊ1 z');
    expect(show(pronounceEnglish('wound'))).toBe('w u1 n d');
  });

  it('keeps full vowels unless asked for the weak forms of function words', () => {
    expect(say('of')).toBe('ʌ1 v');
    expect(say('of', { reduce: true })).toBe('ə0 v');
    expect(say('them', { reduce: true })).toBe('ð ə0 m');
    /* "you" loses its stress but keeps its vowel. */
    expect(say('you', { reduce: true })).toBe('j u0');
    expect(say('and', { reduce: true })).toBe('ə0 n d');
    /* Not a function word. */
    expect(say('hello', { reduce: true })).toBe('h ə0 l oʊ1');
  });

  it('reads the function words as a dictionary does, with no dictionary loaded', () => {
    /* Upstream's rules read these θi, ɪ, jaʊ, tɑ, ɑf, æ, ænd: 32 of its 66 function words wrong. */
    const bare = (w: string) => show(pronounceEnglish(w));
    expect(bare('the')).toBe('ð ə0');
    expect(bare('I')).toBe('aɪ1');
    expect(bare('you')).toBe('j u1');
    expect(bare('to')).toBe('t u1');
    expect(bare('of')).toBe('ʌ1 v');
    expect(bare('a')).toBe('ə0');
    expect(bare('they')).toBe('ð eɪ1');
    expect(bare('no')).toBe('n oʊ1');
    /* the same as through the dictionary, so a lyric sings alike with one loaded or not */
    for (const w of ['of', 'and', 'the', 'you', 'to', 'a', 'them']) expect(bare(w), w).toBe(say(w));
    /* a loaded dictionary still comes first, and the weak forms still apply */
    expect(show(pronounceEnglish('the', { dictionary: parseCmudict('THE  DH IY1\n') }))).toBe('ð i1');
    expect(show(pronounceEnglish('them', { reduce: true }))).toBe('ð ə0 m');
  });

  it('reads a hyphenated word part by part when the dictionary lacks it', () => {
    expect(say('twinkle-little')).toBe('t w ɪ1 ŋ k ə0 l l ɪ1 t ə0 l');
    expect(show(pronounceEnglish('re-read'))).toBe('ɹ i1 ɹ i1 d');
  });

  it('folds accents to look a loanword up, and prefers an entry spelled with them', () => {
    expect(say('café')).toBe('k ə0 f eɪ1');
    expect(say('Naïve')).toBe('n aɪ2 i1 v');
    const accented = new Map([['café', 'K AE1 F EY0']]);
    expect(show(pronounceEnglish('café', { dictionary: accented }))).toBe('k æ1 f eɪ0');
    /* Without a dictionary the folded spelling goes to the rules. */
    expect(show(pronounceEnglish('naïve'))).toBe(show(letterToSound('naive')));
  });

  it('is safe with words that are also object property names', () => {
    expect(say('constructor')).toBe('k ə0 n s t ɹ ʌ1 k t ɚ0');
    for (const w of ['__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
      expect(() => pronounceEnglish(w), w).not.toThrow();
      expect(() => pronounceEnglish(w, { dictionary: DICT, reduce: true }), w).not.toThrow();
    }
  });

  it('never throws on empty, punctuation, digits or other scripts', () => {
    for (const w of ['', "'", "''", '-', '--', '123', '日本', '\u{1F600}', '\uD800', 'ß']) {
      expect(() => pronounceEnglish(w, { dictionary: DICT }), JSON.stringify(w)).not.toThrow();
    }
    expect(pronounceEnglish("''")).toEqual([]);
  });
});

describe('englishFrontEnd', () => {
  const fe = englishFrontEnd({ dictionary: DICT });

  it('claims Latin letters and apostrophes, continued by hyphens and accents', () => {
    for (const c of ['a', 'Z', "'", 'é', 'ñ', 'İ', 'Ü']) expect(fe.starts(c), c).toBe(true);
    for (const c of ['-', '~', '1', ' ', '.', 'ß', 'æ', 'ɪ', '日', '\u0301', '/']) {
      expect(fe.starts(c), c).toBe(false);
    }
    for (const c of ['-', 'a', "'", '\u0301', 'é']) expect(fe.continues(c), c).toBe(true);
    for (const c of [' ', '~', '1', '/', ',']) expect(fe.continues(c), c).toBe(false);
  });

  it('splits by pronunciation and spells each syllable to match', () => {
    const syls = fe.word('Twinkle');
    expect(syls.map((s) => s.text)).toEqual(['Twin', 'kle']);
    expect(sungIpa(syls)).toBe('twɪŋ.kəl');
    /* The router marks the word end, not the front end. */
    expect(syls.every((s) => !s.wordEnd && !s.phraseEnd && s.melisma === undefined)).toBe(true);
  });

  it('splits at typed hyphens, each part showing its whole spelling', () => {
    expect(fe.word('ti-ger').map((s) => s.text)).toEqual(['ti', 'ger']);
    /* A part with two sung syllables shows "~" on the second. */
    expect(fe.word('heavenly-twinkle').map((s) => s.text)).toEqual([
      'heavenly', '~', '~', 'twinkle', '~',
    ]);
    expect(fe.word('a-').map((s) => s.text)).toEqual(['a']);
  });

  it('keeps the written accents on the notes', () => {
    expect(fe.word('café').map((s) => s.text)).toEqual(['ca', 'fé']);
    expect(fe.word('naïve').map((s) => s.text)).toEqual(['na', 'ïve']);
  });
});
