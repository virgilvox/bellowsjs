/*
 * Lyrics to sung syllables: the router that walks a lyric, hands each word to the front end
 * that claims it, and keeps the conventions every language shares.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/src/phonetics/syllables.rs
 * (lyric_tokens, read_lyrics, lyrics_to_syllables) at 1d3ea49 (TypeScript original at
 * cd247a6^:src/engine/phonetics/syllables.ts). Changes from the original: front ends may read
 * delimited words, which /IPA/ uses; the text is NFC-normalized; Korean is not ported.
 * See THIRD_PARTY_NOTICES.md.
 *
 * Conventions, as in vocaloid editors and CHIMERA:
 *
 * - A hyphen inside a word splits it into syllables explicitly: "ti-ger" is two notes.
 * - A free-standing "-" or "~" is a melisma: the previous syllable's vowel carries on to the
 *   next note, as a syllable with no consonants, text "~" and `melisma` set.
 * - . , ; : ! ? and a line break end a phrase: the syllable before them has `phraseEnd`, a breath.
 * - A curly apostrophe reads as a straight one ("don’t").
 * - Characters no front end claims (digits, symbols, scripts with no front end) are skipped.
 *
 * Delimited words are bellows' addition, for the /IPA/ front end. A front end that does not
 * continue the character it starts on reads a word between two of that character, and is
 * handed the word with both. The word opens at the start of the text or after a character that
 * is not a letter, mark or digit, and before one that is not a space; it closes at the same
 * character after one that is not a space, before the front end stops continuing (for IPA,
 * before the line ends). An opening character with no close is skipped like any other
 * unclaimed character, so "and/or" and "3/4" stay plain text. FrontEnd's character tests are
 * stateless and cannot say where a word ends, which is why the router owns this rule.
 */

import type { FrontEnd, PronouncingDictionary, Syllable } from './types';
import { englishFrontEnd } from './english';
import { ipaFrontEnd } from './ipa-front-end';
import { applyAllophones } from './allophones';

const SPACE = /\s/;
/** A word character in any script: a delimited word may not open right after one. */
const WORDLIKE = /[\p{L}\p{M}\p{N}]/u;

function isPhrasePunct(c: string): boolean {
  return (
    c === '.' || c === ',' || c === ';' || c === ':' || c === '!' || c === '?' || c === '\n'
  );
}

/**
 * Lyric text to syllables, each word read by the first front end that claims its first
 * character. Deterministic, and never throws on text: empty, punctuation-only or unreadable
 * input gives [].
 */
export function readLyrics(text: string, frontEnds: readonly FrontEnd[]): Syllable[] {
  const s = Array.from(text.normalize('NFC').replace(/’/g, "'"));
  const out: Syllable[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const fe = frontEnds.find((f) => f.starts(c));
    if (fe) {
      const end = fe.continues(c) ? openWordEnd(s, i, fe) : delimitedWordEnd(s, i, fe);
      if (end > i) {
        addWord(out, fe.word(s.slice(i, end).join('')));
        i = end;
        continue;
      }
    }
    if (isPhrasePunct(c)) {
      if (out.length > 0) out[out.length - 1].phraseEnd = true;
    } else if (isMelisma(s, i)) {
      const prev = out[out.length - 1];
      if (prev) {
        out.push({
          text: '~',
          onset: [],
          nucleus: { ...prev.nucleus },
          coda: [],
          melisma: true,
          wordEnd: prev.wordEnd,
          phraseEnd: false,
        });
      }
    }
    i++;
  }
  return out;
}

/**
 * Lyric text to syllables with the built-in front ends: English, through the dictionary when
 * one is given and letter-to-sound rules otherwise, and IPA between slashes. The English words
 * then get American flaps and dark l (allophones.ts) unless `allophones` is false, which is
 * how CHIMERA's own sung syllables come out and how classical diction sings; IPA is sung as
 * written either way.
 */
export function lyricsToSyllables(
  text: string,
  opts: {
    dictionary?: PronouncingDictionary;
    /** American flaps and dark l on English words, default true; false for classical diction, as CHIMERA sings. */
    allophones?: boolean;
  } = {},
): Syllable[] {
  const english = englishFrontEnd({ dictionary: opts.dictionary });
  const read = new WeakSet<Syllable>();
  const tagged: FrontEnd = {
    starts: english.starts,
    continues: english.continues,
    word: (w) => {
      const syllables = english.word(w);
      for (const syl of syllables) read.add(syl);
      return syllables;
    },
  };
  const out = readLyrics(text, [tagged, ipaFrontEnd]);
  // flaps and dark l need the next sound, which can be in the next word (allophones.ts)
  if (opts.allophones !== false) applyAllophones(out, (syl) => read.has(syl));
  return out;
}

function addWord(out: Syllable[], syllables: Syllable[]): void {
  if (syllables.length === 0) return;
  syllables[syllables.length - 1].wordEnd = true;
  for (const syl of syllables) out.push(syl);
}

/** Exclusive end of a word that runs while its front end continues it. */
function openWordEnd(s: readonly string[], i: number, fe: FrontEnd): number {
  let j = i + 1;
  while (j < s.length && fe.continues(s[j])) j++;
  return j;
}

/** Exclusive end of a delimited word opening at i, past its closing character; i if none. */
function delimitedWordEnd(s: readonly string[], i: number, fe: FrontEnd): number {
  const mark = s[i];
  if (i > 0 && WORDLIKE.test(s[i - 1])) return i;
  if (i + 1 >= s.length || s[i + 1] === mark || SPACE.test(s[i + 1])) return i;
  let j = i + 1;
  while (j < s.length && s[j] !== mark && fe.continues(s[j])) j++;
  if (j >= s.length || s[j] !== mark || SPACE.test(s[j - 1])) return i;
  return j + 1;
}

function isMelisma(s: readonly string[], i: number): boolean {
  const c = s[i];
  if (c !== '-' && c !== '~') return false;
  const before = i === 0 || SPACE.test(s[i - 1]);
  const after = i + 1 === s.length || SPACE.test(s[i + 1]);
  return before && after;
}
