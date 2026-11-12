import { describe, expect, it } from 'vitest';
import { parseCmudict } from '../../src/lyrics/cmudict';
import { pronounceEnglish } from '../../src/lyrics/english';
import { show } from './helpers';

/* The cmudict-0.7b layout: ;;; comments, upper case, two spaces, numbered alternates. */
const DICT_07B = [
  ';;; # CMUdict  --  Major Version: 0.07',
  ';;; ',
  '#HASH-MARK  HH AE1 M AA2 R K',
  "'BOUT  B AW1 T",
  'HEAVENLY  HH EH1 V AH0 N L IY0',
  'HELLO  HH AH0 L OW1',
  'HELLO(1)  HH EH0 L OW1',
  'READ  R EH1 D',
  'READ(2)  R IY1 D',
  'TWINKLE  T W IH1 NG K AH0 L',
  '',
  'TWINKLE  T W IH1 NG K L',
  'BROKEN',
].join('\r\n');

describe('parseCmudict', () => {
  it('reads cmudict-0.7b: comments skipped, keys lower-cased, the first pronunciation kept', () => {
    const d = parseCmudict(DICT_07B);
    expect(d.get('heavenly')).toBe('HH EH1 V AH0 N L IY0');
    expect(d.get('hello')).toBe('HH AH0 L OW1');
    expect(d.get('read')).toBe('R EH1 D');
    expect(d.get('twinkle')).toBe('T W IH1 NG K AH0 L');
    expect(d.get("'bout")).toBe('B AW1 T');
    expect(d.get('#hash-mark')).toBe('HH AE1 M AA2 R K');
    expect(d.has('hello(1)')).toBe(false);
    expect(d.has('broken')).toBe(false);
    expect([...d.keys()].every((k) => k === k.toLowerCase())).toBe(true);
    expect(d.size).toBe(6);
  });

  it('reads cmudict.dict, with single spaces and end-of-line comments', () => {
    const d = parseCmudict(
      'abkhazian AE0 B K AA1 Z IY0 AH0 N # place, russia\nhello HH AH0 L OW1\nhello(2) HH EH0 L OW1\n',
    );
    expect(d.get('abkhazian')).toBe('AE0 B K AA1 Z IY0 AH0 N');
    expect(d.get('hello')).toBe('HH AH0 L OW1');
    expect(d.size).toBe(2);
  });

  it('reads a tab-separated copy and tidies the spacing of the phones', () => {
    const d = parseCmudict('twinkle\tT W IH1 NG K AH0 L\nstar \t S  T AA1 R  \n');
    expect(d.get('twinkle')).toBe('T W IH1 NG K AH0 L');
    expect(d.get('star')).toBe('S T AA1 R');
  });

  it('gives an empty map for text with no entries, and never throws', () => {
    for (const t of ['', '\n\n', ';;; only a comment', 'WORD', '日本語', '\uD800']) {
      expect(parseCmudict(t).size, JSON.stringify(t)).toBe(0);
    }
  });

  it('is the dictionary the English front end looks words up in', () => {
    const dictionary = parseCmudict(DICT_07B);
    expect(show(pronounceEnglish('Heavenly', { dictionary }))).toBe('h ɛ1 v ə0 n l i0');
  });
});
