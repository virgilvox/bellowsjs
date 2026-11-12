import { describe, expect, it } from 'vitest';
import {
  BREAK_NONE,
  BREAK_SYLLABLE,
  BREAK_WORD,
  isVowel,
  readIpa,
  tokenizeIpa,
} from '../../src/lyrics/ipa';
import { rng } from '../../src/core/prng';
import { show } from './helpers';

const read = (s: string) => show(tokenizeIpa(s));

/* Every symbol the tokenizer knows, one code point each: CHIMERA's vowel letters and the
 * single-character consonants of its inventory. */
const VOWEL_SYMBOLS = 'iyɨʉɯuɪʏʊeøɘɵɤoəɛœɜɞʌɔæɐaɶɑɒɝɚ';
const CONSONANT_SYMBOLS =
  'pbtdʈɖcɟkgqɢʔmɱnɳɲŋɴɸβfvθðszʃʒʂʐçʝxɣχʁħʕhɦɬɮɕʑwʋɹɻjɥɰlɫɭʎɾɽrʀʙ';

describe('tokenizeIpa', () => {
  it('reads every symbol it knows back as itself', () => {
    /* Guards the decomposition step: a known letter must survive NFC and NFD whole. */
    for (const v of VOWEL_SYMBOLS) expect(tokenizeIpa(v), v).toEqual([{ ipa: v, stress: 0 }]);
    for (const c of CONSONANT_SYMBOLS) expect(tokenizeIpa(c), c).toEqual([{ ipa: c }]);
  });

  it('gives a stress mark to the next vowel, past any consonants', () => {
    expect(read('ˈtwɪŋ')).toBe('t w ɪ1 ŋ');
    expect(read('ˌɪntɚˈnæʃənəl')).toBe('ɪ2 n t ɚ0 n æ1 ʃ ə0 n ə0 l');
    expect(read("'ata")).toBe('a1 t a0');
    /* A consonant has no stress field at all, not a zero. */
    expect(tokenizeIpa('ˈta')[0]).toEqual({ ipa: 't' });
  });

  it('lengthens the segment before a length mark from CHIMERA bases', () => {
    expect(read('a:ta')).toBe('a0:0.255 t a0');
    expect(read('aːːt')).toBe('a0:0.4335 t');
    expect(tokenizeIpa('sː')[0].dur).toBeCloseTo(0.09 * 1.7, 12);
    expect(read('ː')).toBe('');
  });

  it('joins tʃ, dʒ and the diphthongs, and reads tie bars and ligatures', () => {
    expect(read('aɪ aʊ ɔɪ eɪ oʊ')).toBe('aɪ0 aʊ0 ɔɪ0 eɪ0 oʊ0');
    expect(read('t͡ʃa d͜ʒa ʧa ʤa')).toBe('tʃ a0 dʒ a0 tʃ a0 dʒ a0');
    expect(read('ɡæp')).toBe('g æ0 p');
    /* ligature affricates read as their tie-bar spellings do, never as unknown letters */
    expect(read('ʦa ʣa')).toBe(read('t͡sa d͡za'));
    expect(read('ʦa')).toBe('t s a0');
  });

  it('reads the reduced vowels of some dictionaries and the old letters for ɪ and ʊ as vowels', () => {
    expect(read('ˈwɑntᵻd')).toBe(read('ˈwɑntɪd'));
    expect(read('bɩt bɷk ᵿ')).toBe('b ɪ0 t b ʊ0 k ʊ0');
  });

  it('keeps ts, dz and pf as two segments, unlike upstream', () => {
    expect(read('ˈkæts')).toBe('k æ1 t s');
    expect(read('tʃ dʒ ts dz pf')).toBe('tʃ dʒ t s d z p f');
    expect(read('t͡sa')).toBe('t s a0');
  });

  it('writes a pause for a comma or bar, and records dots and spaces as breaks', () => {
    expect(read('a, b | c ‖ d')).toBe('a0 _:0.16 b _:0.16 c _:0.16 d');
    const { segments, breaks } = readIpa('ˈtwɪŋ.kəl stɑɹ');
    expect(show(segments)).toBe('t w ɪ1 ŋ k ə0 l s t ɑ0 ɹ');
    expect(breaks).toEqual([
      BREAK_NONE, BREAK_NONE, BREAK_NONE, BREAK_SYLLABLE,
      BREAK_NONE, BREAK_NONE, BREAK_WORD,
      BREAK_NONE, BREAK_NONE, BREAK_NONE, BREAK_NONE,
    ]);
    /* A space after a dot is still a word break. */
    expect(readIpa('a. b').breaks[0]).toBe(BREAK_WORD);
  });

  it('drops diacritics but keeps the letter they sit on, however it is encoded', () => {
    expect(read('ã ẽ õ ɔ̃')).toBe('a0 e0 o0 ɔ0');
    expect(read('kʰa pʼa kʷa ⁿda')).toBe('k a0 p a0 k a0 d a0');
    /* Upstream drops a precomposed á whole, and a tone-marked vowel with it. */
    expect(read('á')).toBe('a0');
    expect(read('a\u0301')).toBe('a0');
    expect(read('mǎ')).toBe('m a0');
    /* ç is a letter of its own, and ḉ is ç with an acute. */
    expect(read('ça ḉa')).toBe('ç a0 ç a0');
  });

  it('sings a syllabic consonant on a ə before it', () => {
    expect(read('ˈbʌtn̩')).toBe('b ʌ1 t ə0 n');
    expect(read('ˈlɪtl̩')).toBe('l ɪ1 t ə0 l');
    expect(read('ŋ̍')).toBe('ə0 ŋ');
    /* The pending stress goes to the vowel the mark makes. */
    expect(read('ˈn̩')).toBe('ə1 n');
    /* A vowel is syllabic already. */
    expect(read('a̩')).toBe('a0');
  });

  it('skips what is not IPA: digits, capitals, other scripts, symbols', () => {
    expect(read('123 ABC HELLO 日本 \u{1F600} # @')).toBe('');
    expect(read('\u{1F600}a\u{1F600}')).toBe('a0');
    /* modifier letters mark the sound before them and are dropped with it kept */
    expect(read('kʰa kʷa pʼa')).toBe('k a0 k a0 p a0');
  });

  it('keeps a Latin or Greek letter it has no symbol for, as a consonant, so it can be reported', () => {
    /* Upstream dropped these: /ʍɑt/ sang ɑ t and nothing said a sound was gone. */
    expect(read('ʍɑt')).toBe('ʍ ɑ0 t');
    expect(read('ɓaɗa')).toBe('ɓ a0 ɗ a0');
    expect(read('ǀa ʘa')).toBe('ǀ a0 ʘ a0');
    expect(read('λa')).toBe('λ a0');
    /* Greek epsilon and alpha are the usual slips for ɛ and ɑ */
    expect(read('pεt fαð')).toBe('p ɛ0 t f ɑ0 ð');
  });

  it('never throws and is deterministic on arbitrary text', () => {
    const r = rng('test/lyrics/ipa');
    const alphabet = Array.from(
      VOWEL_SYMBOLS + CONSONANT_SYMBOLS + 'ˈˌ\'ː:.,| \t\n\u0303\u0329\u0361\u035C\u0301ʰʲ\u{1F600}日Aé9-/',
    );
    for (let n = 0; n < 500; n++) {
      let s = '';
      const len = r.int(24);
      for (let k = 0; k < len; k++) s += r.pick(alphabet);
      const a = readIpa(s);
      expect(readIpa(s)).toEqual(a);
      expect(a.breaks.length).toBe(a.segments.length);
      for (const seg of a.segments) {
        expect(seg.ipa.length).toBeGreaterThan(0);
        if (isVowel(seg.ipa)) expect([0, 1, 2]).toContain(seg.stress);
        else expect(seg.stress).toBeUndefined();
      }
    }
    expect(tokenizeIpa('')).toEqual([]);
    expect(tokenizeIpa('\uD800')).toEqual([]);
  });
});

describe('isVowel', () => {
  it('knows vowels and diphthongs by their first character', () => {
    for (const v of ['a', 'ə', 'ɚ', 'ɝ', 'aɪ', 'oʊ', 'y', 'ø']) expect(isVowel(v), v).toBe(true);
    for (const c of ['t', 'tʃ', 'ɹ', 'j', 'w', 'ŋ', '_', '']) expect(isVowel(c), c).toBe(false);
  });
});
