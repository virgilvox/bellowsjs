import { describe, expect, it } from 'vitest';
import { splitSpelling, syllabifySegments } from '../../src/lyrics/syllabify';
import { arpabetToSegments } from '../../src/lyrics/arpabet';
import { tokenizeIpa } from '../../src/lyrics/ipa';
import type { Segment } from '../../src/lyrics/types';

const parts = (segs: Segment[]) =>
  syllabifySegments(segs).map((p) =>
    [p.onset, [p.nucleus], p.coda].map((xs) => xs.map((x) => x.ipa).join('')).join('|'),
  );
const arpa = (p: string) => parts(arpabetToSegments(p));
const ipa = (s: string) => parts(tokenizeIpa(s));

describe('syllabifySegments', () => {
  it('gives the longest legal English onset to the next vowel', () => {
    expect(arpa('T W IH1 NG K AH0 L')).toEqual(['tw|ɪ|ŋ', 'k|ə|l']);
    expect(arpa('EH1 K S T R AH0')).toEqual(['|ɛ|k', 'stɹ|ə|']);
    expect(arpa('S T R EH1 NG K TH S')).toEqual(['stɹ|ɛ|ŋkθs']);
    expect(arpa('EH1 N IY0 W EH2 R')).toEqual(['|ɛ|', 'n|i|', 'w|ɛ|ɹ']);
    /* ŋ never opens an English syllable. */
    expect(arpa('S IH1 NG ER0')).toEqual(['s|ɪ|ŋ', '|ɚ|']);
  });

  it('keeps a diphthong as one nucleus and returns nothing for a word with no vowel', () => {
    expect(arpa('F AY1 ER0')).toEqual(['f|aɪ|', '|ɚ|']);
    expect(parts([])).toEqual([]);
    expect(arpa('HH M M')).toEqual([]);
  });

  it('lets any one consonant but ŋ open a syllable, so written IPA splits as spoken', () => {
    /* Upstream's onset list has none of ɾ ʔ x, so these closed the syllable before. */
    expect(ipa('ˈwɔɾɚ')).toEqual(['w|ɔ|', 'ɾ|ɚ|']);
    expect(ipa('ˈʌʔoʊ')).toEqual(['|ʌ|', 'ʔ|oʊ|']);
    expect(ipa('ˈbaxə')).toEqual(['b|a|', 'x|ə|']);
  });

  it('matches r and ɫ against the ɹ and l clusters', () => {
    expect(ipa('ˈɛntri')).toEqual(['|ɛ|n', 'tr|i|']);
    expect(ipa('ˈɛkstra')).toEqual(['|ɛ|k', 'str|a|']);
    expect(ipa('ˈʌpɫaɪ')).toEqual(['|ʌ|', 'pɫ|aɪ|']);
  });

  it('shares segment objects with its input and nothing between syllables', () => {
    const segs = arpabetToSegments('T W IH1 NG K AH0 L');
    const [a, b] = syllabifySegments(segs);
    expect(a.nucleus).toBe(segs[2]);
    expect(a.coda).not.toBe(b.onset);
  });
});

describe('splitSpelling', () => {
  it('cuts between vowel groups as CHIMERA does', () => {
    expect(splitSpelling('twinkle', 2)).toEqual(['twin', 'kle']);
    expect(splitSpelling('father', 2)).toEqual(['fa', 'ther']);
    expect(splitSpelling('anywhere', 3)).toEqual(['a', 'ny', 'where']);
    expect(splitSpelling('fire', 2)).toEqual(['fire', '~']);
  });

  it('reads accented vowels as vowels, and a diaeresis as a new syllable', () => {
    expect(splitSpelling('café', 2)).toEqual(['ca', 'fé']);
    expect(splitSpelling('naïve', 2)).toEqual(['na', 'ïve']);
    expect(splitSpelling('Zoë', 2)).toEqual(['Zo', 'ë']);
    expect(splitSpelling('jalapeño', 4)).toEqual(['ja', 'la', 'pe', 'ño']);
    /* Upstream found vowels in the lower-cased word, which is a letter longer, and cut "tanb". */
    expect(splitSpelling('İstanbul', 3)).toEqual(['İs', 'tan', 'bul']);
  });

  it('returns the word whole for a count of one or less, or one that is not a number', () => {
    for (const n of [1, 0, -3, 1.9, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(splitSpelling('twinkle', n), String(n)).toEqual(['twinkle']);
    }
    expect(splitSpelling('twinkle', 2.7)).toEqual(['twin', 'kle']);
    expect(splitSpelling('', 2)).toEqual(['', '~']);
  });

  it('never splits a character in two', () => {
    expect(splitSpelling('a\u{1F600}a', 2)).toEqual(['a', '\u{1F600}a']);
    expect(splitSpelling('a\u{1F600}\u{1F600}a', 2)).toEqual(['a\u{1F600}', '\u{1F600}a']);
  });
});
