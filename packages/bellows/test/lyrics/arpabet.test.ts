import { describe, expect, it } from 'vitest';
import { arpabetToSegments } from '../../src/lyrics/arpabet';
import { show } from './helpers';

const read = (p: string) => show(arpabetToSegments(p));

describe('arpabetToSegments', () => {
  it('maps every ARPAbet phone to IPA', () => {
    expect(read('AA1 AE1 AH1 AO1 AW1 AY1 EH1 ER1 EY1 IH1 IY1 OW1 OY1 UH1 UW1')).toBe(
      'ɑ1 æ1 ʌ1 ɔ1 aʊ1 aɪ1 ɛ1 ɝ1 eɪ1 ɪ1 i1 oʊ1 ɔɪ1 ʊ1 u1',
    );
    expect(
      read('B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH'),
    ).toBe('b tʃ d ð f g h dʒ k l m n ŋ p ɹ s ʃ t θ v w j z ʒ');
  });

  it('reads stress digits, with unstressed AH and ER as the schwas', () => {
    expect(read('HH EH1 V AH0 N L IY0')).toBe('h ɛ1 v ə0 n l i0');
    expect(read('AH0 AH1 AH2 ER0 ER1 ER2')).toBe('ə0 ʌ1 ʌ2 ɚ0 ɝ1 ɝ2');
    /* A vowel without a digit is unstressed; a consonant never carries stress. */
    expect(read('AA')).toBe('ɑ0');
    expect(arpabetToSegments('Y1')).toEqual([{ ipa: 'j' }]);
  });

  it('skips phones it cannot read and never throws', () => {
    expect(read('')).toBe('');
    expect(read('   \t ')).toBe('');
    expect(read('hh ah0 XX AY12 AH3 K1x 3')).toBe('');
    /* Names that are also object properties are not phones. */
    expect(read('CONSTRUCTOR PROTO TOSTRING')).toBe('');
  });
});
