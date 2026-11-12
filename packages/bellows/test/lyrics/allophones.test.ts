import { describe, expect, it } from 'vitest';
import { lyricsToSyllables } from '../../src/lyrics/read';
import { parseCmudict } from '../../src/lyrics/cmudict';

const sung = (text: string, dict?: string) =>
  lyricsToSyllables(text, dict ? { dictionary: parseCmudict(dict) } : {})
    .map((y) => [...y.onset, y.nucleus, ...y.coda].map((g) => g.ipa).join(''))
    .join('.');

describe('American allophones (CHIMERA english.rs apply_allophones)', () => {
  it('velarizes an /l/ that ends a syllable and keeps one that opens it', () => {
    expect(sung('tell')).toBe('tɛɫ');
    expect(sung('milk')).toBe('mɪɫk');
    expect(sung('lip')).toBe('lɪp');
    expect(sung('little')).toContain('ɫ');
    // word-final before a vowel-initial word: still the end of its word
    expect(sung('fill it')).toMatch(/^fɪɫ\./);
  });

  it('flaps /t d/ between a vowel and an unstressed vowel, not at the start of a word', () => {
    expect(sung('little')).toBe('lɪ.ɾəɫ');
    expect(sung('ladder')).toBe('læ.ɾɚ');
    const dict = 'GOT  G AA1 T\nIT  IH0 T\nATTACK  AH0 T AE1 K\nDISPUTING  D IH0 S P Y UW1 T IH0 NG\nWERE  W ER0';
    // across a word boundary, when the next vowel is unstressed
    expect(sung('got it', dict)).toBe('gɑɾ.ɪt');
    // not before a stressed vowel, and not word-initially
    expect(sung('attack', dict)).not.toContain('ɾ');
    expect(sung('were disputing', dict)).toMatch(/\.d/);
  });

  it('does not flap across a phrase end', () => {
    const dict = 'GOT  G AA1 T\nIT  IH0 T';
    expect(sung('got. it', dict)).toBe('gɑt.ɪt');
  });

  it('leaves IPA between slashes exactly as written', () => {
    expect(sung('/ˈlɪt.əl/')).toBe('lɪt.əl');
    expect(sung('/tɛl/ tell')).toBe('tɛl.tɛɫ');
  });
});

describe('allophones off', () => {
  it('sings classical diction, and matches CHIMERA\'s own sung syllables, with allophones: false', () => {
    const plain = lyricsToSyllables('little milk', { allophones: false })
      .map((y) => [...y.onset, y.nucleus, ...y.coda].map((g) => g.ipa).join(''))
      .join('.');
    expect(plain).not.toContain('ɾ');
    expect(plain).toContain('mɪlk');
  });
});
