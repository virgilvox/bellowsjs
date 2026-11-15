import { describe, expect, it } from 'vitest';
import { lyricsToSyllables } from '../../src/lyrics/read';
import { ACCENTS, GENERAL_AMERICAN, readRealization, resolveAccent, type Accent } from '../../src/lyrics/accents';
import { LEXICAL_SETS, tagLexicalSets } from '../../src/lyrics/lexical-sets';
import { arpabetToSegments } from '../../src/lyrics/arpabet';
import { splitDiphthong, planSung } from '../../src/lyrics/sing';
import { pronounce, toIPA } from '../../src/lyrics/pronounce';
import { speechPlan } from '../../src/lyrics/speech';
import { vocalPhonemeIndex } from '../../src/engines/vocal-phonemes';
import { isVowel } from '../../src/lyrics/ipa';
import { sungIpa } from './helpers';

/* CMUdict pronunciations (first entries) of Wells's keywords and a few words for the consonant rules. */
const DICT: ReadonlyMap<string, string> = new Map(
  Object.entries({
    kit: 'K IH1 T', dress: 'D R EH1 S', trap: 'T R AE1 P', lot: 'L AA1 T', strut: 'S T R AH1 T', foot: 'F UH1 T',
    bath: 'B AE1 TH', cloth: 'K L AO1 TH', nurse: 'N ER1 S', fleece: 'F L IY1 S', face: 'F EY1 S', palm: 'P AA1 M',
    thought: 'TH AO1 T', goat: 'G OW1 T', goose: 'G UW1 S', price: 'P R AY1 S', choice: 'CH OY1 S', mouth: 'M AW1 TH',
    near: 'N IH1 R', square: 'S K W EH1 R', start: 'S T AA1 R T', north: 'N AO1 R TH', happy: 'HH AE1 P IY0',
    letter: 'L EH1 T ER0', comma: 'K AA1 M AH0', car: 'K AA1 R', far: 'F AA1 R', away: 'AH0 W EY1', water: 'W AO1 T ER0',
    think: 'TH IH1 NG K', this: 'DH IH1 S', brother: 'B R AH1 DH ER0', house: 'HH AW1 S', milk: 'M IH1 L K',
    little: 'L IH1 T AH0 L', football: 'F UH1 T B AO2 L', dance: 'D AE1 N S', ant: 'AE1 N T', calm: 'K AA1 M',
    cot: 'K AA1 T', caught: 'K AO1 T', dog: 'D AO1 G', hello: 'HH AH0 L OW1', world: 'W ER1 L D',
  }),
);
const read = (text: string, accent?: Accent | string) => lyricsToSyllables(text, { dictionary: DICT, accent });
const ipa = (text: string, accent?: Accent | string) => sungIpa(read(text, accent));

describe('lexical sets', () => {
  it('tags each of Wells’s keywords with its own set', () => {
    const words = 'kit dress trap lot strut foot bath cloth nurse fleece face palm thought goat goose price choice mouth near square start north happy letter comma';
    const syls = read(words);
    const sets = syls.filter((s) => s.nucleus.stress === 1 || s.wordEnd).map((s) => s.nucleus.set);
    // "happy", "letter", "comma" carry their weak set on the last syllable
    expect(sets).toEqual([
      'KIT', 'DRESS', 'TRAP', 'LOT', 'STRUT', 'FOOT', 'BATH', 'CLOTH', 'NURSE', 'FLEECE', 'FACE', 'PALM', 'THOUGHT',
      'GOAT', 'GOOSE', 'PRICE', 'CHOICE', 'MOUTH', 'NEAR', 'SQUARE', 'START', 'NORTH', 'TRAP', 'happY', 'DRESS',
      'lettER', 'LOT', 'commA',
    ]);
  });

  it('splits what General American merged: cot and calm, caught and cot, trap and bath', () => {
    const set = (word: string) => read(word)[0].nucleus.set;
    expect([set('cot'), set('calm')]).toEqual(['LOT', 'PALM']);
    expect([set('caught'), set('dog'), set('water')]).toEqual(['THOUGHT', 'CLOTH', 'THOUGHT']);
    expect([set('bath'), set('dance'), set('ant')]).toEqual(['BATH', 'BATH', 'TRAP']);
  });

  it('gives a schwa inside a word no set, so no accent re-voices it', () => {
    const segs = arpabetToSegments('L IH1 T AH0 L');
    tagLexicalSets('little', segs);
    expect(segs.filter((s) => isVowel(s.ipa)).map((s) => s.set)).toEqual(['KIT', undefined]);
  });

  it('covers 27 sets', () => {
    expect(LEXICAL_SETS).toHaveLength(27);
  });
});

describe('accents', () => {
  it('leaves General American as the reader gave it, the default', () => {
    const text = 'little star, far away, the water';
    expect(ipa(text, 'general-american')).toBe(ipa(text));
    expect(resolveAccent(undefined)).toBe(GENERAL_AMERICAN);
  });

  it('names only vowels the voice can sing', () => {
    for (const accent of Object.values(ACCENTS)) {
      for (const [set, spec] of Object.entries(accent.sets)) {
        for (const v of readRealization(spec!).vowels) {
          expect(vocalPhonemeIndex(v), `${accent.id} ${set} ${v}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('throws on an unknown accent id, naming the built-in ones', () => {
    expect(() => resolveAccent('martian')).toThrow(/southern-british/);
  });

  it('reads realizations: a vowel, a diphthong, a vowel with its r', () => {
    expect(readRealization('eː')).toEqual({ vowels: ['e'], r: undefined });
    expect(readRealization('əʊ')).toEqual({ vowels: ['ə', 'ʊ'], r: undefined });
    expect(readRealization('ʌɾ')).toEqual({ vowels: ['ʌ'], r: 'ɾ' });
    expect(() => readRealization('kæt')).toThrow();
  });

  it('Southern British: BATH with PALM’s vowel, GOAT as əʊ, non-rhotic with a linking r', () => {
    expect(ipa('bath trap goat nurse', 'southern-british')).toBe('bɑθ tɹap gəʊʔ nɜs');
    expect(ipa('car', 'southern-british')).toBe('kɑ');
    expect(ipa('far away', 'southern-british')).toBe('fɑɹ ə.weɪ');
    expect(ipa('letter', 'southern-british')).toBe('lɛ.tə');
  });

  it('Australian: fronted GOOSE, ɐʉ GOAT, flapped t', () => {
    expect(ipa('goose goat face price water', 'australian')).toBe('gʉs gɐʉt fæɪs pɹɒes wo.ɾə');
  });

  it('Irish: FACE and GOAT long monophthongs, TH stopped, clear l, rhotic', () => {
    expect(ipa('face goat think this milk little car', 'irish')).toBe('fes got tɪŋk dɪs mɪlk lɪ.təl kaɹ');
  });

  it('Scottish: tapped r, NURSE with its own r, FOOT and GOOSE alike', () => {
    expect(ipa('nurse foot goose brother', 'scottish')).toBe('nʌɾs fʉʔ gʉs bɾʌ.ðəɾ');
  });

  it('London: TH fronted, h dropped, glottal t, vocalized l', () => {
    expect(ipa('think brother house water milk', 'london')).toBe('fɪŋk bɹɐ.və æʊs wo.ʔə mɪwk');
  });

  it('leaves IPA between slashes as written in any accent', () => {
    expect(ipa('/ˈkɑɹ/', 'southern-british')).toBe('kɑɹ');
  });

  it('sets the accent’s diphthong hold on two-vowel vowels', () => {
    const s = read('goat', 'southern-british')[0];
    expect(s.nucleus.ipa).toBe('əʊ');
    expect(s.nucleus.hold).toBe(0.55);
    expect(read('goat')[0].nucleus.hold).toBeUndefined();
  });
});

describe('the sung planner with accents', () => {
  it('splits any two-vowel nucleus, General American’s five by their targets', () => {
    expect(splitDiphthong('eɪ')).toEqual(['e', 'i']);
    expect(splitDiphthong('əʊ')).toEqual(['ə', 'ʊ']);
    expect(splitDiphthong('ɑ')).toBeUndefined();
    expect(splitDiphthong('tʃ')).toBeUndefined();
  });

  it('glides at the segment’s hold', () => {
    const plan = planSung([{ time: 0, dur: 1, hz: 220 }], read('goat', 'southern-british'));
    const vowels = plan.phrases[0].spans.filter((s) => s.kind === 'nucleus');
    expect(vowels.map((s) => s.ipa)).toEqual(['ə', 'ʊ']);
    const total = vowels[1].end - vowels[0].start;
    expect((vowels[0].end - vowels[0].start) / total).toBeCloseTo(0.55, 1);
  });
});

describe('pronounce and toIPA', () => {
  it('spells text word by word with stress and syllables', () => {
    const p = pronounce('hello world', { dictionary: DICT });
    expect(p.words.map((w) => w.ipa)).toEqual(['hə.ˈloʊ', 'wɝɫd']);
    expect(p.ipa).toBe('hə.ˈloʊ wɝɫd');
    expect(p.words[0].sets).toEqual([undefined, 'GOAT']);
  });

  it('marks phrases and follows the accent', () => {
    expect(toIPA('hello, world', { dictionary: DICT, accent: 'southern-british' })).toBe('hə.ˈləʊ | wɜɫd');
  });
});

describe('speech', () => {
  it('times stressed syllables longer and lengthens the last', () => {
    // bare vowels, so only stress sets the length: twice as long stressed
    const bare = speechPlan(read('/ˈa.a.ˈa/')).notes;
    expect(bare[0].dur).toBeCloseTo(2 * bare[1].dur, 9);
    const { notes } = speechPlan(read('little star'));
    // the last syllable is two notes, its tone moving inside it
    expect(notes).toHaveLength(4);
    for (let i = 1; i < notes.length; i++) expect(notes[i].time).toBeCloseTo(notes[i - 1].time + notes[i - 1].dur, 9);
  });

  it('falls at the end of a statement and rises for a rising tune or a question', () => {
    const fall = speechPlan(read('far away'), { hz: 100 }).notes;
    expect(fall[fall.length - 1].hz).toBeLessThan(100);
    const rise = speechPlan(read('far away'), { hz: 100, prosody: ACCENTS.australian.prosody }).notes;
    expect(rise[rise.length - 1].hz).toBeGreaterThan(100);
    const q = speechPlan(read('far away'), { hz: 100 }, [true]).notes;
    expect(q[q.length - 1].hz).toBeGreaterThan(100);
  });

  it('rests between phrases and carries the last vowel as a melisma', () => {
    const plan = speechPlan(read('far, away'));
    expect(plan.notes.some((n) => n.rest)).toBe(true);
    expect(plan.notes.filter((n) => !n.rest)).toHaveLength(plan.syllables.length);
    expect(plan.syllables[plan.syllables.length - 1].melisma).toBe(true);
  });
});
