import { describe, expect, it } from 'vitest';
import { letterToSound } from '../../src/lyrics/letter-to-sound';
import { syllabifySegments } from '../../src/lyrics/syllabify';
import { show } from './helpers';

const read = (w: string) => show(letterToSound(w));
const syllables = (w: string) => syllabifySegments(letterToSound(w)).length;

describe('letterToSound', () => {
  it('stresses the first vowel and leaves consonants without a stress field', () => {
    expect(read('zorblat')).toBe('z ɔ1 ɹ b l æ0 t');
    for (const s of letterToSound('quixotical')) {
      if (s.stress === undefined) expect(['k', 'w', 's', 't', 'l']).toContain(s.ipa);
    }
  });

  it('sounds a doubled consonant once', () => {
    /* Upstream: h ɛ1 l l ɑ0, l ɪ1 t t ə0 ɫ, n ɪ1 g g ə0 ɫ, ɹ æ1 b b ɪ0 t. */
    expect(read('hello')).toBe('h ɛ1 l ɑ0');
    expect(read('little')).toBe('l ɪ1 t ə0 ɫ');
    expect(read('kniggle')).toBe('n ɪ1 g ə0 ɫ');
    expect(read('wrabbit')).toBe('ɹ æ1 b ɪ0 t');
    /* The doubling still keeps the vowel short: "hopping" is not "hoping". */
    expect(read('hopping')).toBe('h ɑ1 p ɪ0 ŋ');
    expect(read('hoping')).toBe('h oʊ1 p ɪ0 ŋ');
    /* Letters that spell the same consonant side by side merge too. */
    expect(read('acquire')).toBe('æ1 k w ɝ0');
    expect(read('excel')).toBe('ɛ1 k s ɛ0 l');
    /* Vowels are never merged: "skiing" is two syllables. */
    expect(syllables('skiing')).toBe(2);
  });

  it('gives a word whose only vowel letter is a final e or y a vowel', () => {
    /* Upstream gave he, she, the, me, we, be no vowel, so they vanished from a lyric. */
    expect(read('he')).toBe('h i1');
    expect(read('she')).toBe('ʃ i1');
    expect(read('the')).toBe('θ i1');
    for (const w of ['me', 'we', 'be']) expect(syllables(w), w).toBe(1);
    /* Upstream sang my, fly, try as "mee", "flee", "tree". */
    expect(read('my')).toBe('m aɪ1');
    expect(read('fly')).toBe('f l aɪ1');
    expect(read('spry')).toBe('s p ɹ aɪ1');
    /* Longer words keep the old rules: final e silent, final y is i. */
    expect(read('like')).toBe('l aɪ1 k');
    expect(read('happy')).toBe('h æ1 p i0');
    expect(read('city')).toBe('s aɪ1 t i0');
  });

  it('reads a final a after the opening consonants as ɑ, so "la" is not "læ"', () => {
    /* Upstream: l æ1, m æ1, s p æ1. */
    expect(read('la')).toBe('l ɑ1');
    expect(read('ma')).toBe('m ɑ1');
    expect(read('spa')).toBe('s p ɑ1');
    expect(read('bra')).toBe('b ɹ ɑ1');
    /* only a word's last letter, after only consonants */
    expect(read('lab')).toBe('l æ1 b');
    expect(read('sofa')).toBe('s oʊ1 f æ0');
  });

  it('sounds a final "le" as a syllable only after a consonant', () => {
    expect(read('twinkle')).toBe('t w ɪ1 n k ə0 ɫ');
    expect(syllables('apple')).toBe(2);
    /* Upstream sang smile and while as two syllables. */
    expect(read('smile')).toBe('s m aɪ1 l');
    expect(syllables('while')).toBe(1);
    expect(syllables('pale')).toBe(1);
  });

  it('reads only lower-case letters, skipping anything else, and never throws', () => {
    expect(read('HELLO')).toBe('');
    expect(read('')).toBe('');
    expect(read("'")).toBe('');
    expect(read('123')).toBe('');
    expect(read('\u{1F600}')).toBe('');
    expect(read("don't")).toBe('d ɑ1 n t');
  });
});
