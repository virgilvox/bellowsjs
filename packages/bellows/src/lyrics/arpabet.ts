/*
 * ARPAbet, the phone set of the CMU Pronouncing Dictionary, to IPA segments.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/src/phonetics/english.rs at
 * 1d3ea49 (TypeScript original at cd247a6^:src/engine/phonetics/english.ts). Changes from the
 * original: a consonant carries no stress field. See THIRD_PARTY_NOTICES.md.
 *
 * A phone is an upper-case base with an optional stress digit, 0 unstressed, 1 primary,
 * 2 secondary ("AH0", "OW1"); the dictionary puts digits on vowels only. Unstressed AH is the
 * schwa and unstressed ER the r-coloured schwa, the CMUdict convention. A phone that is not
 * that shape, or names no ARPAbet sound, is skipped.
 */

import type { Segment } from './types';
import { isVowel } from './ipa';

const ARPA: ReadonlyMap<string, string> = new Map([
  ['AA', 'ɑ'], ['AE', 'æ'], ['AH', 'ʌ'], ['AO', 'ɔ'], ['AW', 'aʊ'], ['AY', 'aɪ'], ['EH', 'ɛ'],
  ['ER', 'ɝ'], ['EY', 'eɪ'], ['IH', 'ɪ'], ['IY', 'i'], ['OW', 'oʊ'], ['OY', 'ɔɪ'], ['UH', 'ʊ'],
  ['UW', 'u'],
  ['B', 'b'], ['CH', 'tʃ'], ['D', 'd'], ['DH', 'ð'], ['F', 'f'], ['G', 'g'], ['HH', 'h'],
  ['JH', 'dʒ'], ['K', 'k'], ['L', 'l'], ['M', 'm'], ['N', 'n'], ['NG', 'ŋ'], ['P', 'p'],
  ['R', 'ɹ'], ['S', 's'], ['SH', 'ʃ'], ['T', 't'], ['TH', 'θ'], ['V', 'v'], ['W', 'w'],
  ['Y', 'j'], ['Z', 'z'], ['ZH', 'ʒ'],
]);

const PHONE = /^([A-Z]+)([012])?$/;

/** "HH AH0 L OW1" to h ə l oʊ, the vowels stressed as the digits say. Never throws. */
export function arpabetToSegments(phones: string): Segment[] {
  const out: Segment[] = [];
  for (const ph of phones.trim().split(/\s+/)) {
    const m = PHONE.exec(ph);
    if (!m) continue;
    const base = m[1];
    const stress = m[2] === '1' ? 1 : m[2] === '2' ? 2 : 0;
    let ipa = ARPA.get(base);
    if (ipa === undefined) continue;
    if (stress === 0 && base === 'AH') ipa = 'ə';
    if (stress === 0 && base === 'ER') ipa = 'ɚ';
    out.push(isVowel(ipa) ? { ipa, stress } : { ipa });
  }
  return out;
}
