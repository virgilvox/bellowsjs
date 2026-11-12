/*
 * Cases ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/tests/golden/phonetics-*.json
 * at 1d3ea49 (recorded from its TypeScript engine). Changes from the original: consonants carry
 * no stress field, the flags bellows does not model are dropped, and the cases a deliberate
 * change of the port touches are moved to the module tests, beside what upstream did. See
 * THIRD_PARTY_NOTICES.md.
 *
 * Agreement with CHIMERA, the port's source. The fixtures hold 3148 cases, all compared once,
 * outside the repository, when the layer was ported; these are the ones kept as tests, and the
 * repository carries none of CHIMERA's fixture files.
 */

import { describe, expect, it } from 'vitest';
import { tokenizeIpa } from '../../src/lyrics/ipa';
import { arpabetToSegments } from '../../src/lyrics/arpabet';
import { letterToSound } from '../../src/lyrics/letter-to-sound';
import { pronounceEnglish } from '../../src/lyrics/english';
import { splitSpelling, syllabifySegments } from '../../src/lyrics/syllabify';
import { lyricsToSyllables } from '../../src/lyrics/read';
import { show, shownText, sungIpa } from './helpers';

/* Entries of the cmudict.dict copy CHIMERA ships, for the cases that use the dictionary. */
const DICT: ReadonlyMap<string, string> = new Map([
  ['a', 'AH0'],
  ['and', 'AH0 N D'],
  ['anywhere', 'EH1 N IY0 W EH2 R'],
  ['b', 'B IY1'],
  ['extra', 'EH1 K S T R AH0'],
  ['hello', 'HH AH0 L OW1'],
  ['of', 'AH1 V'],
  ['rhythm', 'R IH1 DH AH0 M'],
  ['strengths', 'S T R EH1 NG K TH S'],
  ['the', 'DH AH0'],
  ['them', 'DH EH1 M'],
  ['to', 'T UW1'],
  ['twinkle', 'T W IH1 NG K AH0 L'],
  ['you', 'Y UW1'],
]);

describe('tokenizeIpa against phonetics-ipa.json', () => {
  const CASES: [string, string][] = [
    ['', ''],
    [' ', ''],
    ['ˈhɛloʊ ˈwɝld', 'h ɛ1 l oʊ0 w ɝ1 l d'],
    ['ʃi sɛlz ˈɑpɑ', 'ʃ i0 s ɛ0 l z ɑ1 p ɑ0'],
    ['ˈθɪŋk ə ˈbæd ˈkæt', 'θ ɪ1 ŋ k ə0 b æ1 d k æ1 t'],
    ['ˈmʌni ˈtʃɪp ˈʒu ˈvæn', 'm ʌ1 n i0 tʃ ɪ1 p ʒ u1 v æ1 n'],
    ['ˌɪntɚˈnæʃənəl', 'ɪ2 n t ɚ0 n æ1 ʃ ə0 n ə0 l'],
    ["'ata", 'a1 t a0'],
    ['a:ta', 'a0:0.255 t a0'],
    ['aːːt', 'a0:0.4335 t'],
    ['ː', ''],
    ['aɪ aʊ ɔɪ eɪ oʊ', 'aɪ0 aʊ0 ɔɪ0 eɪ0 oʊ0'],
    ['t͜ʃa', 'tʃ a0'],
    ['ʧa ʤa', 'tʃ a0 dʒ a0'],
    ['ɡæp', 'g æ0 p'],
    [',,||', '_:0.16 _:0.16 _:0.16 _:0.16'],
    ['ˈaˌbˈc', 'a1 b c'],
    ['ã ẽ õ', 'a0 e0 o0'],
    ['kʰa', 'k a0'],
    ['pʼa', 'p a0'],
    ['\u{1F600}a\u{1F600}', 'a0'],
    ['A B C', ''],
    ['HELLO', ''],
    ['taɪm', 't aɪ0 m'],
    ['aɪɪ', 'aɪ0 ɪ0'],
    ['oʊː', 'oʊ0:0.255'],
    ['ʊə', 'ʊ0 ə0'],
    ['a;b', 'a0 b'],
    ['kʷa', 'k a0'],
    ['ⁿda', 'd a0'],
    ['ɔ̃', 'ɔ0'],
    ['ça', 'ç a0'],
    ['ʁʐjgdɻɖʤzlʋβ', 'ʁ ʐ j g d ɻ ɖ dʒ z l ʋ β'],
  ];
  it.each(CASES)('%j', (input, expected) => {
    expect(show(tokenizeIpa(input))).toBe(expected);
  });
});

describe('letterToSound against phonetics-g2p.json', () => {
  const CASES: [string, string][] = [
    ['world', 'w ɔ1 ɹ l d'],
    ['water', 'w eɪ1 t ɚ0'],
    ['city', 's aɪ1 t i0'],
    ['people', 'p ɛ1 ɑ0 p ə0 ɫ'],
    ['thing', 'θ ɪ1 ŋ'],
    ['night', 'n aɪ1 t'],
    ['queen', 'k w i1 n'],
    ['singing', 's ɪ1 ŋ g ɪ0 ŋ'],
    ['twinkle', 't w ɪ1 n k ə0 ɫ'],
    ['wonder', 'w ɑ1 n d ɚ0'],
    ['zorblat', 'z ɔ1 ɹ b l æ0 t'],
    ['quixotical', 'k w aɪ1 k s oʊ0 t aɪ0 k æ0 l'],
    ['phlogistic', 'f l oʊ1 dʒ ɪ0 s t ɪ0 k'],
    ['xylophonic', 'k s aɪ1 l ɑ0 f oʊ0 n ɪ0 k'],
    ['chairsch', 'tʃ eɪ1 ɹ s k'],
    ['ough', 'oʊ1'],
    ['HELLO', ''],
    ['', ''],
    ["don't", 'd ɑ1 n t'],
    ['yoyo', 'j ɔɪ1 ɑ0'],
    ['cye', 's aɪ1'],
    ['ngle', 'ŋ g ə1 ɫ'],
    ['tioner', 'ʃ ə1 n ɚ0'],
    ['sionel', 'ʒ ə1 n ɛ0 l'],
    ['breathe', 'b ɹ i1 θ'],
    ['tongue', 't ɑ1 ŋ g u0'],
    ['fire', 'f ɝ1'],
    ['flower', 'f l aʊ1 ɚ0'],
    ['anywhere', 'eɪ1 n aɪ0 w ɛ0 ɹ'],
  ];
  it.each(CASES)('%j', (word, expected) => {
    expect(show(letterToSound(word))).toBe(expected);
  });
});

describe('pronounceEnglish against phonetics-g2p.json', () => {
  it('reads homographs and hyphens without a dictionary', () => {
    expect(show(pronounceEnglish('hyphen-ated'))).toBe('h aɪ1 f ɛ0 n eɪ1 t d');
    expect(show(pronounceEnglish("'tis"))).toBe('t ɪ1 z');
    expect(show(pronounceEnglish('WiNd'))).toBe('w ɪ1 n d');
  });

  const REDUCE: [string, string, string][] = [
    ['of', 'ʌ1 v', 'ə0 v'],
    ['and', 'ə0 n d', 'ə0 n d'],
    ['the', 'ð ə0', 'ð ə0'],
    ['you', 'j u1', 'j u0'],
    ['to', 't u1', 't u0'],
    ['a', 'ə0', 'ə0'],
    ['them', 'ð ɛ1 m', 'ð ə0 m'],
    ['hello', 'h ə0 l oʊ1', 'h ə0 l oʊ1'],
  ];
  it.each(REDUCE)('%j full and reduced', (word, full, reduced) => {
    expect(show(pronounceEnglish(word, { dictionary: DICT }))).toBe(full);
    expect(show(pronounceEnglish(word, { dictionary: DICT, reduce: true }))).toBe(reduced);
  });
});

describe('arpabetToSegments against phonetics-g2p.json', () => {
  const CASES: [string, string][] = [
    ['', ''],
    ['  ', ''],
    ['HH AH0 L OW1', 'h ə0 l oʊ1'],
    [' W ER1 L D ', 'w ɝ1 l d'],
    ['AH0\tB\r', 'ə0 b'],
    ['XX Y1 AY12 aa1 AH3 ER0 ER2 AH2', 'j ɚ0 ɝ2 ʌ2'],
    ['AY1 BC\uFEFFD', 'aɪ1 d'],
    ['K AE1 T', 'k æ1 t'],
    ['B0 D1 NG2 ZH', 'b d ŋ ʒ'],
  ];
  it.each(CASES)('%j', (phones, expected) => {
    expect(show(arpabetToSegments(phones))).toBe(expected);
  });
});

describe('splitSpelling against phonetics-syllables.json', () => {
  const CASES: [string, number, string[]][] = [
    ['twinkle', 2, ['twin', 'kle']],
    ['little', 2, ['lit', 'tle']],
    ['wonder', 2, ['won', 'der']],
    ['are', 1, ['are']],
    ['like', 2, ['like', '~']],
    ['anywhere', 3, ['a', 'ny', 'where']],
    ['father', 2, ['fa', 'ther']],
    ['everything', 3, ['e', 've', 'rything']],
    ['everything', 4, ['e', 've', 'ry', 'thing']],
    ['beautiful', 3, ['beau', 'ti', 'ful']],
    ['queue', 2, ['queue', '~']],
    ['rhythm', 2, ['rhythm', '~']],
    ['table', 2, ['tab', 'le']],
    ['simple', 2, ['sim', 'ple']],
    ['file', 2, ['file', '~']],
    ['LITTLE', 2, ['LIT', 'TLE']],
    ['CAKE', 2, ['CAKE', '~']],
    ['', 2, ['', '~']],
    ['a', 3, ['a', '~', '~']],
    ['strengths', 2, ['strengths', '~']],
    ['rocket', 2, ['ro', 'cket']],
    ['laughing', 2, ['lau', 'ghing']],
    ['telephone', 3, ['te', 'le', 'phone']],
    ['telephone', 4, ['telephone', '~', '~', '~']],
    ['Shine', 2, ['Shine', '~']],
    ['thrhe', 2, ['thrhe', '~']],
    ['babybaby', 4, ['ba', 'by', 'ba', 'by']],
    ['x', 0, ['x']],
  ];
  it.each(CASES)('%j in %i', (word, n, expected) => {
    expect(splitSpelling(word, n)).toEqual(expected);
  });
});

describe('syllabifySegments against phonetics-syllables.json', () => {
  const CASES: [string, string[]][] = [
    ['twinkle', ['tw|ɪ1|ŋ', 'k|ə0|l']],
    ['extra', ['|ɛ1|k', 'stɹ|ə0|']],
    ['strengths', ['stɹ|ɛ1|ŋkθs']],
    ['anywhere', ['|ɛ1|', 'n|i0|', 'w|ɛ2|ɹ']],
    ['rhythm', ['ɹ|ɪ1|', 'ð|ə0|m']],
    ['zorblat', ['z|ɔ1|ɹ', 'bl|æ0|t']],
    ['a', ['|ə0|']],
    ['b', ['b|i1|']],
  ];
  it.each(CASES)('%j', (word, expected) => {
    const got = syllabifySegments(pronounceEnglish(word, { dictionary: DICT })).map(
      (p) =>
        `${p.onset.map((s) => s.ipa).join('')}|${p.nucleus.ipa}${p.nucleus.stress}|` +
        p.coda.map((s) => s.ipa).join(''),
    );
    expect(got).toEqual(expected);
  });
});

describe('lyricsToSyllables without a dictionary against phonetics-syllables.json', () => {
  const CASES: [string, string, string][] = [
    ['ti-ger ti-ger burn-ing bright', 'ti-ger ti-ger burn-ing bright ', 'tɪ.dʒɚ tɪ.dʒɚ bɝn.ɪŋ bɹaɪt'],
    ['- leading dash', 'lea-ding dash ', 'li.dɪŋ dæʃ'],
    ['~', '', ''],
    ['fire hour flower', 'fire hour flo-wer ', 'fɝ haʊɹ flaʊ.ɚ'],
    ['don’t stop believin\'', "don't stop be-lie-vin' ", 'dɑnt stɑp bɛ.li.vɪn'],
    ['constructor toString __proto__', 'cons-truc-tor toS-tring pro-to ', 'kɑn.stɹʌk.tɔɹ tɑ.stɹɪŋ pɹoʊ.tɑ'],
    ['zorblat fnord-ish', 'zor-blat fnord-ish ', 'zɔɹ.blæt fnɔɹd.ɪʃ'],
    ['AMAZING grace HOW sweet', 'A-MA-ZING grace HOW sweet ', 'eɪ.meɪ.zɪŋ gɹeɪs hoʊ swit'],
    ['-', '', ''],
    ['--', '', ''],
    ['x - y', 'y ', 'i'],
    ['x -- y', 'y ', 'i'],
    ['every everything everywhere', 'e-ve-ry e-ve-ry-thing e-ve-ry-where ', 'ɛ.vɛ.ɹi ɛ.vɛ.ɹaɪ.θɪŋ ɛ.vɛ.ɹaɪ.wɛɹ'],
    ['strength twelfths rhythm', 'strength twelfths rhythm ', 'stɹɛŋgθ twɛlfθs ɹhaɪθm'],
    ['queue quiet quite', 'queue-~ quiet quite ', 'kwɛ.u kwit kwaɪt'],
    ['', '', ''],
    ['Ah~ ah ~ ah', 'Ah ah ~~ ah ', 'æh æh æ æh'],
    ['\tTab\tseparated - words\t', 'Tab se-pa-rated ~~ words ', 'tæb sɛ.pɑ.ɹeɪtd eɪ wɔɹds'],
    ['one - two', 'one ~~ two ', 'oʊn oʊ twɑ'],
    ['one ~ two', 'one ~~ two ', 'oʊn oʊ twɑ'],
  ];
  it.each(CASES)('%j', (text, shown, sung) => {
    // upstream's sung syllables carry no allophones (CHIMERA applies them to speech only)
    const syls = lyricsToSyllables(text, { allophones: false });
    expect(shownText(syls)).toBe(shown);
    expect(sungIpa(syls)).toBe(sung);
  });
});
