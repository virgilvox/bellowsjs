/*
 * Text to pronunciation, for reading and checking what the voice will say before it says it. One call
 * runs the same path sing() does (the English reader through a dictionary or letter-to-sound rules,
 * IPA between slashes, lexical sets, the accent, the allophones) and returns it word by word, with an
 * IPA spelling. Read back between slashes it gives the same sounds, though an accent's diphthong
 * ("əʊ") reads back as two vowels, two notes, where the accent sang one.
 */

import type { LexicalSet } from './lexical-sets';
import type { PronouncingDictionary, Syllable } from './types';
import type { Accent } from './accents';
import { lyricsToSyllables } from './read';

export interface PronounceOptions {
  dictionary?: PronouncingDictionary;
  /** An accent id ('southern-british', 'australian', ...; see ACCENTS) or an Accent. Default General American. */
  accent?: Accent | string;
  /** The accent's t and l rules, default true. */
  allophones?: boolean;
}

export interface PronouncedWord {
  /** The word's spelling as the lyric split it ("twin-kle"). */
  text: string;
  /** IPA with stress marks and syllable dots ("ˈtwɪŋ.kəɫ"). */
  ipa: string;
  syllables: Syllable[];
  /** Each syllable's vowel's lexical set, undefined for IPA written between slashes. */
  sets: (LexicalSet | undefined)[];
}

export interface Pronunciation {
  words: PronouncedWord[];
  /** The whole text in IPA: words split by spaces, phrases by " | ". */
  ipa: string;
  /** Every syllable, in order, as sing() would take them. */
  syllables: Syllable[];
}

/**
 * How `text` is pronounced. The same syllables sing() sings, so `pronounce(text).syllables` can be
 * edited and handed to sing() in place of the text.
 */
export function pronounce(text: string, opts: PronounceOptions = {}): Pronunciation {
  const syllables = lyricsToSyllables(text, opts);
  const words: PronouncedWord[] = [];
  let current: Syllable[] = [];
  const parts: string[] = [];
  for (const syl of syllables) {
    current.push(syl);
    if (!syl.wordEnd) continue;
    const word = wordOf(current);
    words.push(word);
    parts.push(word.ipa, syl.phraseEnd ? ' | ' : ' ');
    current = [];
  }
  if (current.length > 0) {
    const word = wordOf(current);
    words.push(word);
    parts.push(word.ipa);
  }
  return { words, ipa: parts.join('').replace(/ \| $/, '').trim(), syllables };
}

/** `text` in IPA, as pronounce() spells it. */
export function toIPA(text: string, opts: PronounceOptions = {}): string {
  return pronounce(text, opts).ipa;
}

function wordOf(syllables: Syllable[]): PronouncedWord {
  const several = syllables.filter((s) => !s.melisma).length > 1;
  const ipa = syllables
    .filter((s) => !s.melisma)
    .map((s) => {
      const mark = several && s.nucleus.stress === 1 ? 'ˈ' : several && s.nucleus.stress === 2 ? 'ˌ' : '';
      const body = [...s.onset, s.nucleus, ...s.coda].map((seg) => seg.ipa).join('');
      return mark + body;
    })
    .join('.');
  return {
    text: syllables.map((s) => s.text).join('-'),
    ipa,
    syllables,
    sets: syllables.map((s) => s.nucleus.set),
  };
}
