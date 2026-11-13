import { describe, expect, it } from 'vitest';
import { lyricsToSyllables, readLyrics } from '../../src/lyrics/read';
import { ipaFrontEnd, ipaToSyllables } from '../../src/lyrics/ipa-front-end';
import { englishFrontEnd } from '../../src/lyrics/english';
import { isVowel } from '../../src/lyrics/ipa';
import type { FrontEnd, Syllable } from '../../src/lyrics/types';
import { rng } from '../../src/core/prng';
import { shownText, sungIpa } from './helpers';

/* CMUdict entries (cmudict.dict, first pronunciations) for the lyrics below. */
const DICT: ReadonlyMap<string, string> = new Map([
  ['heavenly', 'HH EH1 V AH0 N L IY0'],
  ['twinkle', 'T W IH1 NG K AH0 L'],
  ['little', 'L IH1 T AH0 L'],
  ['star', 'S T AA1 R'],
  ['how', 'HH AW1'],
  ['i', 'AY1'],
  ['wonder', 'W AH1 N D ER0'],
  ['what', 'W AH1 T'],
  ['you', 'Y UW1'],
  ['are', 'AA1 R'],
  ['the', 'DH AH0'],
  ['wind', 'W AY1 N D'],
]);

const sing = (text: string) => lyricsToSyllables(text, { dictionary: DICT });

describe('lyricsToSyllables, the conventions', () => {
  it('sings a lyric through the dictionary, one syllable per vowel', () => {
    const syls = sing('Twinkle twinkle little star, how I wonder what you are.');
    expect(shownText(syls)).toBe(
      'Twin-kle twin-kle lit-tle star /how I won-der what you are /',
    );
    // dark l and the flap of "little" (allophones.ts)
    expect(sungIpa(syls)).toBe('twɪŋ.kəɫ twɪŋ.kəɫ lɪ.ɾəɫ stɑɹ haʊ aɪ wʌn.dɚ wʌt ju ɑɹ');
    expect(syls[0].nucleus).toEqual({ ipa: 'ɪ', stress: 1 });
  });

  it('reads "heavenly" from a fixture dictionary', () => {
    const syls = lyricsToSyllables('heavenly', { dictionary: new Map([['heavenly', 'HH EH1 V AH0 N L IY0']]) });
    expect(shownText(syls)).toBe('hea-ven-ly ');
    expect(sungIpa(syls)).toBe('hɛ.vən.li');
    expect(syls.map((s) => s.nucleus.stress)).toEqual([1, 0, 0]);
  });

  it('falls back to letter-to-sound for a word the dictionary lacks, or with none', () => {
    expect(sungIpa(lyricsToSyllables('heavenly'))).toBe('hɛ.vɛn.li');
    expect(sungIpa(sing('zorblat'))).toBe('zɔɹ.blæt');
  });

  it('splits a word at a typed hyphen', () => {
    const syls = sing('ti-ger ti-ger burn-ing bright');
    expect(shownText(syls)).toBe('ti-ger ti-ger burn-ing bright ');
    expect(syls.filter((s) => s.wordEnd).length).toBe(4);
  });

  it('carries the vowel onto the next note at a free-standing "-" or "~"', () => {
    const syls = sing('how I - wonder ~ ~');
    expect(shownText(syls)).toBe('how I ~~ won-der ~~ ~~ ');
    const m = syls[2];
    expect(m).toEqual({
      text: '~', onset: [], nucleus: { ipa: 'aɪ', stress: 1 }, coda: [], melisma: true,
      wordEnd: true, phraseEnd: false,
    });
    /* A copy: changing one note's vowel does not change the other's. */
    m.nucleus.ipa = 'a';
    expect(syls[1].nucleus.ipa).toBe('aɪ');
    /* Only true syllables carry the melisma field. */
    expect(syls.filter((s) => 'melisma' in s).length).toBe(3);
  });

  it('reads a dash or tilde touching a word, or doubled, as nothing', () => {
    expect(shownText(sing('star -how star- how -- you ~star'))).toBe('star how star how you star ');
    /* Nothing to carry at the start of a lyric. */
    expect(sing('- ~ star')).toHaveLength(1);
  });

  it('ends a phrase at . , ; : ! ? and a line break', () => {
    for (const p of ['.', ',', ';', ':', '!', '?', '\n']) {
      const syls = sing(`star${p} star`);
      expect(syls.map((s) => s.phraseEnd), JSON.stringify(p)).toEqual([true, false]);
    }
    expect(shownText(sing('...?! star!!\n\n'))).toBe('star /');
  });

  it('reads a curly apostrophe as a straight one', () => {
    expect(sing('don’t stop')).toEqual(sing("don't stop"));
  });

  it('skips digits, symbols and scripts no front end reads', () => {
    expect(shownText(sing('123 star 4 you'))).toBe('star you ');
    expect(shownText(sing('日本 star \u{1F600} # % @ you'))).toBe('star you ');
  });

  it('reads accented Latin words whole and keeps their spelling', () => {
    const syls = lyricsToSyllables('naïve café', {
      dictionary: new Map([['naive', 'N AY2 IY1 V'], ['cafe', 'K AH0 F EY1']]),
    });
    expect(shownText(syls)).toBe('na-ïve ca-fé ');
    expect(sungIpa(syls)).toBe('naɪ.iv kə.feɪ');
  });

  it('sings function words and "la" as a dictionary would, with none loaded', () => {
    /*
     * Cases from CHIMERA's golden fixtures (phonetics-syllables.json), with what upstream sang
     * after each: its letter-to-sound rules read I, of, and, a, you and la wrongly.
     */
    const CASES: [string, string, string][] = [
      [
        'Breathe in, breathe out, I am made of air. Tongue and lips and throat, singing anywhere.',
        'Breathe in /breathe out /I am made of air /Ton-gue and lips and throat /sin-ging a-ny-where /',
        // upstream: ... ɪ æm meɪd ɑf eɪɹ tɑŋ.gu ænd lɪps ænd ...
        'bɹið ɪn bɹið aʊt aɪ æm meɪd ʌv eɪɹ tɑŋ.gu ənd lɪps ənd θɹoʊt sɪŋ.ɪŋ ɛ.ni.wɛɹ',
      ],
      // upstream: æ æ æ; a letter with no vowel now keeps its note on its own sound rather than vanishing
      ['a -b c- d - e ~f g~ ~', 'a b c d ~~ f g ~~ ', 'ə b k d d f g g'],
      ['a-', 'a ', 'ə'], // upstream: æ
      ['123 numbers 4 you', 'num-bers you ', 'nʌm.bɝz ju'], // upstream: nʌm.bɝs jaʊ
      ['la la la - - la', 'la la la ~~ ~~ la ', 'lɑ lɑ lɑ ɑ ɑ lɑ'], // upstream: læ læ læ æ æ læ
    ];
    for (const [text, shown, sung] of CASES) {
      const syls = lyricsToSyllables(text);
      expect(shownText(syls), text).toBe(shown);
      expect(sungIpa(syls), text).toBe(sung);
    }
  });

  it('gives an empty lyric for text with nothing to sing, and never throws', () => {
    for (const t of ['', ' ', '...', '?!;:,.', '\n\n', '-', '~', '--', '123', '日本語', '\u{1F600}\u{1F600}',
      '/', '//', '/ /', '\uD800', '\u0301', "'", '- ~ - ~']) {
      expect(lyricsToSyllables(t), JSON.stringify(t)).toEqual([]);
    }
  });

  it('is deterministic and keeps every syllable well formed on arbitrary text', () => {
    const r = rng('test/lyrics/read');
    const alphabet = Array.from(
      "abcdefghijklmnopqrstuvwxyzAEIOUY'-~ .,;:!?\n/ˈˌː.ɪəʃŋɹæɑ\u0329\u0301éï日\u{1F600}123",
    );
    for (let n = 0; n < 400; n++) {
      let text = '';
      const len = r.int(40);
      for (let k = 0; k < len; k++) text += r.pick(alphabet);
      const a = lyricsToSyllables(text);
      expect(lyricsToSyllables(text)).toEqual(a);
      for (const s of a) {
        // a vowel, or the one sound that carries a word with none ("hmm", /pst/)
        expect(isVowel(s.nucleus.ipa) || s.onset.concat(s.coda).every((x) => !isVowel(x.ipa)), JSON.stringify(text)).toBe(true);
        for (const x of [...s.onset, ...s.coda]) expect(isVowel(x.ipa)).toBe(false);
        expect(typeof s.wordEnd).toBe('boolean');
        expect(typeof s.phraseEnd).toBe('boolean');
      }
      if (a.length > 0) expect(a[a.length - 1].wordEnd).toBe(true);
    }
  });
});

describe('IPA between slashes', () => {
  it('sings a word written between slashes as written', () => {
    const syls = lyricsToSyllables('sing /ˈtwɪŋ.kəl/ star');
    expect(shownText(syls)).toBe('sing ˈtwɪŋ-kəl star ');
    expect(syls[1].onset.map((s) => s.ipa)).toEqual(['t', 'w']);
    expect(syls[1].nucleus).toEqual({ ipa: 'ɪ', stress: 1 });
    expect(syls[2].nucleus).toEqual({ ipa: 'ə', stress: 0 });
  });

  it('lets syllable dots decide the split, and maximal onset decide without them', () => {
    expect(sungIpa(lyricsToSyllables('/ˈsɪs.tɚ/'))).toBe('sɪs.tɚ');
    expect(sungIpa(lyricsToSyllables('/ˈsɪstɚ/'))).toBe('sɪ.stɚ');
    expect(sungIpa(lyricsToSyllables('/ˈɛk.stɹə/'))).toBe('ɛk.stɹə');
    /* A dotted chunk with no vowel cannot carry a note: it joins its neighbour. */
    expect(sungIpa(lyricsToSyllables('/ˈtwɪŋ.kl/'))).toBe('twɪŋkl');
    expect(sungIpa(lyricsToSyllables('/s.tɑɹ/'))).toBe('stɑɹ');
    /* A dotted chunk with two vowels is split inside by maximal onset. */
    expect(sungIpa(lyricsToSyllables('/ˈhɛloʊ.wɝld/'))).toBe('hɛ.loʊ.wɝld');
  });

  it('sings a syllabic consonant on its own note', () => {
    expect(shownText(lyricsToSyllables('/ˈbʌtn̩/'))).toBe('ˈbʌ-tən ');
  });

  it('reads spaces as words and a comma or bar as a phrase end', () => {
    const syls = lyricsToSyllables('/ðə ˈkæt, sæt | daʊn/ now');
    expect(shownText(syls)).toBe('ðə ˈkæt /sæt /daʊn now ');
    expect(syls.map((s) => s.wordEnd)).toEqual([true, true, true, true, true]);
  });

  it('works beside the other conventions', () => {
    const syls = lyricsToSyllables('/ˈlɑ/ - - /ˈlɑ/, star');
    expect(shownText(syls)).toBe('ˈlɑ ~~ ~~ ˈlɑ /star ');
    expect(syls[1].nucleus).toEqual({ ipa: 'ɑ', stress: 1 });
  });

  it('leaves a slash that cannot open or close a word as plain text', () => {
    expect(shownText(lyricsToSyllables('rock and/or roll'))).toBe(
      shownText(lyricsToSyllables('rock and or roll')),
    );
    expect(shownText(lyricsToSyllables('in 3/4 time'))).toBe('in time ');
    /* A slash pair must hug its word, and close on the same line. */
    expect(shownText(lyricsToSyllables('/ star /'))).toBe('star ');
    expect(shownText(lyricsToSyllables('/star\nstar/'))).toBe('star /star ');
    expect(shownText(lyricsToSyllables('/ˈla'))).toBe('la ');
  });

  it('gives a word with no vowel its note, carried by its last sound', () => {
    /* a hum sings; a letter no voice has keeps its note and reaches the facade's unknown list */
    expect(sungIpa(ipaToSyllables('m'))).toBe('m');
    const s = lyricsToSyllables('la /ʍ/ la');
    expect(s.map((y) => y.nucleus.ipa)).toEqual(['ɑ', 'ʍ', 'ɑ']);
    expect(s[1].wordEnd).toBe(true);
    expect(lyricsToSyllables('/ˈwɑntᵻd/')).toHaveLength(2);
  });

  it('reads IPA on its own through ipaToSyllables', () => {
    expect(sungIpa(ipaToSyllables('ˈtwɪŋ.kəl ˈtwɪŋ.kəl'))).toBe('twɪŋ.kəl twɪŋ.kəl');
    expect(ipaToSyllables('')).toEqual([]);
    /* no vowel: the note goes to the most sonorous sound */
    expect(ipaToSyllables('pst').map((y) => [y.onset.length, y.nucleus.ipa, y.coda.length])).toEqual([[1, 's', 1]]);
  });
});

describe('readLyrics with other front ends', () => {
  it('sends each word to the first front end that claims it', () => {
    const shout: FrontEnd = {
      starts: (c) => c >= 'a' && c <= 'z',
      continues: (c) => c >= 'a' && c <= 'z',
      word: (w): Syllable[] => [
        { text: w.toUpperCase(), onset: [], nucleus: { ipa: 'a', stress: 1 }, coda: [], wordEnd: false, phraseEnd: false },
      ],
    };
    expect(shownText(readLyrics('la la', [shout, englishFrontEnd()]))).toBe('LA LA ');
    expect(shownText(readLyrics('la la', [englishFrontEnd(), shout]))).toBe('la la ');
    /* Without the IPA front end, slashes are plain text: the l is all English reads, and it keeps its note. */
    expect(shownText(readLyrics('/ˈlɑ/', [englishFrontEnd()]))).toBe('l ');
    expect(shownText(readLyrics('/ˈlɑ/', [ipaFrontEnd]))).toBe('ˈlɑ ');
  });

  it('reads a delimited word for any front end that does not continue its opening mark', () => {
    const hum: FrontEnd = {
      starts: (c) => c === '%',
      continues: (c) => c !== '%' && c !== '\n',
      word: (w): Syllable[] => [
        { text: w, onset: [{ ipa: 'h' }], nucleus: { ipa: 'ə', stress: 0 }, coda: [{ ipa: 'm' }], wordEnd: false, phraseEnd: false },
      ],
    };
    expect(shownText(readLyrics('%mmm% 100%', [hum]))).toBe('%mmm% ');
  });
});
