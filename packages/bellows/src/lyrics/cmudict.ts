/*
 * The CMU Pronouncing Dictionary's text format, read into the map the English front end looks
 * words up in. Bellows ships no dictionary (CMUdict is 3.3 MB raw and BSD-licensed); a caller
 * that wants one fetches or bundles the text and passes the result of parseCmudict as
 * `dictionary`.
 *
 * Written for bellows. CHIMERA reads its own tab-separated copy instead
 * (crates/chimera/src/phonetics/english.rs, load_dict); this reads the files CMU distributes.
 *
 * Accepted, line by line:
 *
 * - cmudict-0.7b: upper-case "WORD  PHONES" with two spaces, ";;;" comment lines.
 * - cmudict.dict (the cmusphinx repository): lower-case "word PHONES" with one space, and an
 *   optional "# comment" after the phones.
 * - Any "word<TAB>PHONES" copy, CHIMERA's included.
 *
 * Keys are lower-cased. An alternate pronunciation, "WORD(2)", is ignored, and so is any later
 * line for a word already read: the first pronunciation wins, which in CMUdict is the most
 * common one. Entries that name punctuation ("#HASH-MARK") are kept; a "#" only starts a
 * comment after the word. A line with no phones is skipped.
 */

const ENTRY = /^(\S+)\s+(.+)$/;
const ALTERNATE = /\(\d+\)$/;

/** CMUdict text to a map from lower-case word to its ARPAbet phones. Never throws. */
export function parseCmudict(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';;;')) continue;
    const m = ENTRY.exec(line);
    if (!m) continue;
    const word = m[1];
    if (ALTERNATE.test(word)) continue;
    const hash = m[2].indexOf('#');
    const phones = (hash < 0 ? m[2] : m[2].slice(0, hash)).trim().split(/\s+/).join(' ');
    if (phones === '') continue;
    const key = word.toLowerCase();
    if (!out.has(key)) out.set(key, phones);
  }
  return out;
}
