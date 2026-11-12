import type { Segment, Syllable } from '../../src/lyrics/types';

/**
 * Segments as "h ɛ1 l oʊ0": a vowel carries its stress digit and a consonant none, so a
 * consonant that grew a stress field shows up as a digit. A duration follows a colon.
 */
export function show(segs: readonly Segment[]): string {
  return segs
    .map((s) => s.ipa + (s.stress ?? '') + (s.dur !== undefined ? `:${s.dur}` : ''))
    .join(' ');
}

/** Syllables as sung IPA: "twɪn.kəɫ lɪt.təɫ", a dot inside a word and a space after its end. */
export function sungIpa(syls: readonly Syllable[]): string {
  let out = '';
  syls.forEach((s, i) => {
    for (const x of s.onset) out += x.ipa;
    out += s.nucleus.ipa;
    for (const x of s.coda) out += x.ipa;
    if (i < syls.length - 1) out += s.wordEnd ? ' ' : '.';
  });
  return out;
}

/**
 * Syllables as shown on notes: "Twin-kle star /how", a hyphen inside a word, a space after its
 * end, a slash after a phrase end, and a "~" before a melisma (whose own text is "~").
 */
export function shownText(syls: readonly Syllable[]): string {
  let out = '';
  for (const s of syls) {
    out += (s.melisma ? '~' : '') + s.text + (s.wordEnd ? ' ' : '-') + (s.phraseEnd ? '/' : '');
  }
  return out;
}
