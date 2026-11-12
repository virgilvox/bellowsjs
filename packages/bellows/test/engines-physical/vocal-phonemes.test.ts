/*
 * The phoneme list the vocal engine answers to, its classes and the stop
 * release rules src/sing.ts times sung releases by.
 */

import { describe, expect, it } from 'vitest';
import {
  VOCAL_ACOUSTICS,
  VOCAL_DEFAULT_PHONEME,
  VOCAL_PHONEMES,
  VOCAL_UNASPIRATED_VOT,
  vocalPhonemeIndex,
  vocalReleaseAspirated,
  vocalReleaseVot,
} from '../../src/engines/vocal-phonemes';
import { VOCAL_INVENTORY, VOCAL_TABLE_PHONEMES } from '../../src/engines/vocal-tables.gen';

describe('VOCAL_PHONEMES', () => {
  it('is append only: the 41 indices the formant voice shipped keep their sounds, and ɫ is appended', () => {
    expect(VOCAL_PHONEMES.slice(0, 41).join(' ')).toBe(
      '_ ɑ æ ʌ ɔ ɛ ɝ ɪ i ʊ u e o a ə p b t d k g f v θ ð s z ʃ ʒ h tʃ dʒ m n ŋ l ɹ w j ɾ ʔ',
    );
    expect(VOCAL_PHONEMES[41]).toBe('ɫ');
    expect(VOCAL_PHONEMES.length).toBe(42);
    expect(VOCAL_PHONEMES[VOCAL_DEFAULT_PHONEME]).toBe('ɑ');
  });

  it('has a row of class and release time for every phoneme, and the engine\'s tables in the same order', () => {
    expect(VOCAL_ACOUSTICS.length).toBe(VOCAL_PHONEMES.length);
    expect([...VOCAL_TABLE_PHONEMES]).toEqual([...VOCAL_PHONEMES]);
    VOCAL_ACOUSTICS.forEach((row, i) => expect(row.ipa).toBe(VOCAL_PHONEMES[i]));
  });

  it('agrees with CHIMERA\'s inventory on class and voicing', () => {
    const cls: Record<string, string> = { tap: 'flap', lateral: 'approximant' };
    VOCAL_ACOUSTICS.forEach((row, i) => {
      const inv = VOCAL_INVENTORY[i];
      expect(cls[inv.manner] ?? inv.manner, row.ipa).toBe(row.cls);
      if (row.cls !== 'silence') expect(inv.voiced, row.ipa).toBe(row.voiced);
    });
    expect(VOCAL_INVENTORY[VOCAL_PHONEMES.indexOf('ɫ')].dominant.length).toBeGreaterThan(VOCAL_INVENTORY[VOCAL_PHONEMES.indexOf('l')].dominant.length);
  });
});

describe('vocalPhonemeIndex', () => {
  it('resolves every symbol to its own index, every alias to its target, and nothing else', () => {
    VOCAL_PHONEMES.forEach((ipa, i) => expect(vocalPhonemeIndex(ipa)).toBe(i));
    const aliases: Record<string, string> = {
      ɚ: 'ɝ',
      ɜ: 'ɝ',
      ɡ: 'g',
      r: 'ɹ',
      ɒ: 'ɑ',
      ɐ: 'ʌ',
      ʧ: 'tʃ',
      ʤ: 'dʒ',
      ɨ: 'ɪ',
      ʉ: 'u',
      y: 'i',
    };
    for (const [alias, target] of Object.entries(aliases)) {
      expect(vocalPhonemeIndex(alias), alias).toBe(VOCAL_PHONEMES.indexOf(target as (typeof VOCAL_PHONEMES)[number]));
      expect(vocalPhonemeIndex(alias)).toBeGreaterThanOrEqual(0);
    }
    for (const unknown of ['x', 'ʀ', '', 'aɪ', 'ts']) expect(vocalPhonemeIndex(unknown)).toBe(-1);
    /* the dark l is its own sound now, at the end of the list */
    expect(vocalPhonemeIndex('ɫ')).toBe(VOCAL_PHONEMES.length - 1);
    expect(vocalPhonemeIndex('ɫ')).not.toBe(vocalPhonemeIndex('l'));
  });
});

describe('stop releases', () => {
  const i = (ipa: string) => vocalPhonemeIndex(ipa);
  const vot = (ipa: string) => VOCAL_ACOUSTICS[i(ipa)].vot;

  it('aspirates a voiceless stop except after /s/, and never a voiced one', () => {
    for (const stop of ['p', 't', 'k']) {
      expect(vocalReleaseAspirated(i(stop), -1), stop).toBe(true);
      expect(vocalReleaseAspirated(i(stop), i('ɑ')), stop).toBe(true);
      expect(vocalReleaseAspirated(i(stop), i('s')), `s${stop}`).toBe(false);
    }
    for (const stop of ['b', 'd', 'g']) expect(vocalReleaseAspirated(i(stop), -1), stop).toBe(false);
    for (const other of ['s', 'tʃ', 'ɑ', 'ɾ', 'ʔ']) expect(vocalReleaseAspirated(i(other), -1), other).toBe(false);
  });

  it('holds the whole VOT into a vowel or silence, the short one into a glide, nothing into another consonant', () => {
    expect(vocalReleaseVot(i('t'), -1, i('ɑ'))).toBe(vot('t'));
    expect(vocalReleaseVot(i('k'), i('ŋ'), i('ə'))).toBe(vot('k'));
    expect(vocalReleaseVot(i('p'), -1, i('_'))).toBe(vot('p'));
    expect(vocalReleaseVot(i('t'), i('s'), i('ɑ'))).toBe(VOCAL_UNASPIRATED_VOT);
    // /tw/, /kl/, /pɹ/: a brief release, then the voiced glide
    for (const glide of ['w', 'l', 'ɹ', 'j']) expect(vocalReleaseVot(i('t'), -1, i(glide)), glide).toBe(VOCAL_UNASPIRATED_VOT);
    // a voiced stop keeps its own VOT when that is the shorter
    expect(vocalReleaseVot(i('d'), -1, i('ɑ'))).toBe(vot('d'));
    expect(vocalReleaseVot(i('g'), -1, i('ɑ'))).toBe(Math.min(vot('g'), VOCAL_UNASPIRATED_VOT));
    for (const next of ['p', 'tʃ', 's', 'm', 'h']) expect(vocalReleaseVot(i('t'), -1, i(next)), next).toBe(0);
    // only stops are released this way
    expect(vocalReleaseVot(i('s'), -1, i('ɑ'))).toBe(0);
    expect(vocalReleaseVot(i('tʃ'), -1, i('ɑ'))).toBe(0);
  });

  it('answers 0 and false outside the table', () => {
    for (const bad of [-1, VOCAL_ACOUSTICS.length, 1.5, NaN]) {
      expect(vocalReleaseVot(bad, -1, i('ɑ'))).toBe(0);
      expect(vocalReleaseVot(i('t'), -1, bad)).toBe(0);
      expect(vocalReleaseAspirated(bad, -1)).toBe(false);
    }
  });
});
