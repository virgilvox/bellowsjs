/*
 * Written IPA as a lyric: a word between slashes, /ˈtwɪŋ.kəl/, sets its sounds directly, so a
 * lyric needs no dictionary to get a word right. What the tokenizer does with marks and with
 * symbols no voice has is in ipa.ts.
 *
 * Written for bellows: CHIMERA's router (crates/chimera/src/phonetics/syllables.rs) has no IPA
 * reader. It reads with the tokenizer and syllabifier ported from CHIMERA (ipa.ts and
 * syllabify.ts), and has the FrontEnd shape CHIMERA's front ends have.
 *
 * Where a word has syllable dots, the dots decide: /ˈsɪs.tɚ/ sings sɪs.tɚ where maximal onset
 * alone would give sɪ.stɚ. A dotted chunk with two vowels is split by maximal onset inside it,
 * and a chunk with no vowel joins the coda before it (or the onset after it, at the start of a
 * word), because a note needs a vowel to carry it. A word without dots is split by maximal
 * onset. Spaces separate words and a comma or bar ends a phrase, so a whole transcribed line can
 * go between one pair of slashes. Each syllable shows its IPA, led by ˈ or ˌ when stressed.
 */

import type { FrontEnd, Segment, Syllable } from './types';
import { BREAK_SYLLABLE, BREAK_WORD, PAUSE, readIpa } from './ipa';
import { syllabifySegments, vowelless, type SyllableParts } from './syllabify';

const SLASH = '/';

/**
 * Claims /…/. The slash is not a character it continues, which tells the router the word is
 * delimited: it closes at the next slash on the same line (see readLyrics).
 */
export const ipaFrontEnd: FrontEnd = {
  starts: (c) => c === SLASH,
  continues: (c) => c !== SLASH && c !== '\n' && c !== '\r',
  word: (word) => ipaToSyllables(stripSlashes(word)),
};

/** IPA text, without slashes, to sung syllables. Never throws; unknown characters are skipped. */
export function ipaToSyllables(ipa: string): Syllable[] {
  const { segments, breaks } = readIpa(ipa);
  const out: Syllable[] = [];
  let chunks: Segment[][] = [[]];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.ipa === PAUSE) {
      /* readIpa ends the word before a pause, so the word is already closed. */
      if (out.length > 0) out[out.length - 1].phraseEnd = true;
      continue;
    }
    chunks[chunks.length - 1].push(seg);
    if (breaks[i] === BREAK_WORD || i === segments.length - 1) {
      closeWord(chunks, out);
      chunks = [[]];
    } else if (breaks[i] === BREAK_SYLLABLE) {
      chunks.push([]);
    }
  }
  return out;
}

function closeWord(chunks: Segment[][], out: Syllable[]): void {
  const parts = chunks.length > 1 ? byChunks(chunks) : syllabifySegments(chunks[0]);
  /* a symbol no voice has keeps its note and reaches the facade's unknown list instead of vanishing */
  if (parts.length === 0) {
    const carried = vowelless(chunks.flat());
    if (!carried) return;
    parts.push(carried);
  }
  for (let i = 0; i < parts.length; i++) {
    const { onset, nucleus, coda } = parts[i];
    out.push({
      text: shown(parts[i]),
      onset,
      nucleus,
      coda,
      wordEnd: i === parts.length - 1,
      phraseEnd: false,
    });
  }
}

/** Syllables as the dots divide them. */
function byChunks(chunks: Segment[][]): SyllableParts[] {
  const out: SyllableParts[] = [];
  let carry: Segment[] = [];
  for (const chunk of chunks) {
    const parts = syllabifySegments(chunk);
    if (parts.length === 0) {
      if (out.length > 0) out[out.length - 1].coda.push(...chunk);
      else carry.push(...chunk);
      continue;
    }
    if (carry.length > 0) {
      parts[0].onset.unshift(...carry);
      carry = [];
    }
    out.push(...parts);
  }
  return out;
}

function shown(s: SyllableParts): string {
  let text = s.nucleus.stress === 1 ? 'ˈ' : s.nucleus.stress === 2 ? 'ˌ' : '';
  for (const seg of s.onset) text += seg.ipa;
  text += s.nucleus.ipa;
  for (const seg of s.coda) text += seg.ipa;
  return text;
}

function stripSlashes(word: string): string {
  const from = word.startsWith(SLASH) ? 1 : 0;
  const to = word.length > from && word.endsWith(SLASH) ? word.length - 1 : word.length;
  return word.slice(from, to);
}
