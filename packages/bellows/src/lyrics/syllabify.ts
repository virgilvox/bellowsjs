/*
 * The syllables of one word: its segments split into onset, nucleus and coda by the
 * maximal-onset principle with English onset clusters, and its spelling split to match, so
 * each note can show its part of the word ("twin", "kle").
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/src/phonetics/syllables.rs at
 * 1d3ea49 (TypeScript original at cd247a6^:src/engine/phonetics/syllables.ts). Changes from the
 * original: any one consonant but ŋ may open a syllable, and r and ɫ match the ɹ and l clusters,
 * so written IPA splits as English does; the spelling is read per character with accents folded,
 * and a diaeresis starts a vowel group ("na-ïve"). See THIRD_PARTY_NOTICES.md.
 */

import type { Segment, Syllable } from './types';
import { PAUSE, isVowel } from './ipa';

/** A syllable before it has its text and its place in the lyric. */
export type SyllableParts = Pick<Syllable, 'onset' | 'nucleus' | 'coda'>;

/*
 * English onsets as joined IPA (syllables.rs:20-27), kept whole so a [t, ʃ] pair still matches
 * "tʃ" as it does upstream. The single consonants in it are a subset of what legalOnset allows
 * on its own. Upstream allowed only these 23, which is every English consonant but ŋ, so
 * dictionary and letter-to-sound words split exactly as they do there; the wider rule matters
 * for IPA, where /ˈwɔɾɚ/ should sing wɔ.ɾɚ and not wɔɾ.ɚ.
 */
const ONSETS = new Set([
  'p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'l', 'ɹ',
  'w', 'j', 'tʃ', 'dʒ',
  'pl', 'bl', 'kl', 'gl', 'fl', 'sl', 'pɹ', 'bɹ', 'tɹ', 'dɹ', 'kɹ', 'gɹ', 'fɹ', 'θɹ', 'ʃɹ',
  'sp', 'st', 'sk', 'sm', 'sn', 'sw', 'sf', 'tw', 'kw', 'dw', 'gw', 'θw',
  'pj', 'bj', 'kj', 'gj', 'mj', 'nj', 'fj', 'vj', 'hj', 'lj',
  'spl', 'spɹ', 'stɹ', 'skɹ', 'skw', 'skj', 'spj',
]);

/** Written variants of the symbols the cluster list uses: IPA input often writes r for ɹ. */
const CLUSTER_SPELLING: ReadonlyMap<string, string> = new Map([
  ['r', 'ɹ'],
  ['ɫ', 'l'],
]);

const SONORANTS = new Set(Array.from('mɱnɳɲŋɴlɫɭʎɹɻrʀʙɾɽjwʋɥɰ'));
const FRICATIVES = new Set(Array.from('ɸβfvθðszʃʒʂʐçʝxɣχʁħʕhɦɬɮɕʑ'));

/** Nasals and approximants over fricatives over the rest, for a word that has no vowel. */
function sonority(ipa: string): number {
  return SONORANTS.has(ipa) ? 2 : FRICATIVES.has(ipa) ? 1 : 0;
}

/**
 * A word with no vowel as one syllable, carried by its most sonorous sound: "hmm" hums on its m,
 * "shh" and /pst/ hiss, so the word keeps its note rather than vanishing and moving every later
 * syllable one note early. Undefined for a word with no sounds at all.
 */
export function vowelless(segs: readonly Segment[]): SyllableParts | undefined {
  if (segs.length === 0) return undefined;
  let n = 0;
  for (let i = 1; i < segs.length; i++) if (sonority(segs[i].ipa) > sonority(segs[n].ipa)) n = i;
  return { onset: segs.slice(0, n), nucleus: segs[n], coda: segs.slice(n + 1) };
}

/** The longest onset clusters are three consonants long ("str"). */
const MAX_ONSET = 3;

/**
 * One word's segments to its syllables, one per vowel. Consonants before the first vowel open
 * the first syllable and consonants after the last close the last; between two vowels the
 * longest legal onset goes to the second and the rest close the first ("extra" is ɛk.stɹə).
 * A word with no vowel has no syllables.
 */
export function syllabifySegments(segs: readonly Segment[]): SyllableParts[] {
  const vowels: number[] = [];
  for (let i = 0; i < segs.length; i++) if (isVowel(segs[i].ipa)) vowels.push(i);
  const out: SyllableParts[] = [];
  let start = 0;
  for (let n = 0; n < vowels.length; n++) {
    const v = vowels[n];
    let end = segs.length;
    if (n + 1 < vowels.length) {
      const next = vowels[n + 1];
      const between = next - (v + 1);
      let k = 0;
      for (let len = Math.min(MAX_ONSET, between); len >= 1; len--) {
        if (legalOnset(segs, next - len, next)) {
          k = len;
          break;
        }
      }
      end = next - k;
    }
    out.push({ onset: segs.slice(start, v), nucleus: segs[v], coda: segs.slice(v + 1, end) });
    start = end;
  }
  return out;
}

function legalOnset(segs: readonly Segment[], from: number, to: number): boolean {
  if (to - from === 1) {
    const ipa = segs[from].ipa;
    return ipa !== 'ŋ' && ipa !== PAUSE;
  }
  let joined = '';
  for (let i = from; i < to; i++) joined += CLUSTER_SPELLING.get(segs[i].ipa) ?? segs[i].ipa;
  return ONSETS.has(joined);
}

/** Digraphs that stay together at the start of the next chunk ("fa-ther", "any-where"). */
const DIGRAPHS = new Set(['th', 'sh', 'ch', 'ph', 'wh', 'ck', 'gh']);

/**
 * Split a written word into n chunks at its vowel letters, an approximate hyphenation for
 * display. A final silent e is not a syllable ("like"), but consonant plus "le" is ("twin-kle").
 * Between vowel groups a digraph goes right, one consonant goes right, and a longer run splits
 * in the middle ("lit-tle", "won-der"). A word with fewer vowel groups than n keeps its spelling
 * on the first chunk and "~" on the rest ("fire" sung on two notes is "fire", "~").
 */
export function splitSpelling(word: string, n: number): string[] {
  const count = Math.floor(n);
  if (!(count > 1) || !Number.isFinite(count)) return [word];
  const w = Array.from(word);
  const len = w.length;
  const groups: [number, number][] = [];
  for (let i = 0; i < len; ) {
    if (!isVowelLetter(w[i])) {
      i++;
      continue;
    }
    const s = i;
    do i++;
    while (i < len && isVowelLetter(w[i]) && !hasDiaeresis(w[i]));
    groups.push([s, i]);
  }
  /* The e is literal: an accented é is never silent ("ca-fé"). */
  const finalE = len >= 2 && (w[len - 1] === 'e' || w[len - 1] === 'E');
  const silentE = finalE && !isVowelLetter(w[len - 2]);
  const consonantLe =
    finalE &&
    len >= 3 &&
    (w[len - 2] === 'l' || w[len - 2] === 'L') &&
    !isVowelLetter(w[len - 3]) &&
    w[len - 3] !== 'l' &&
    w[len - 3] !== 'L';
  if (groups.length > 1 && silentE && !consonantLe && groups[groups.length - 1][0] + 1 === len) {
    groups.pop();
  }
  if (groups.length < count) {
    const out = [word];
    for (let i = 1; i < count; i++) out.push('~');
    return out;
  }
  while (groups.length > count) {
    const last = groups.pop()!;
    groups[groups.length - 1][1] = last[1];
  }
  const cuts = [0];
  for (let i = 0; i < groups.length - 1; i++) {
    const a = groups[i][1];
    const b = groups[i + 1][0];
    const gap = b - a;
    const digraph = gap >= 2 && DIGRAPHS.has((w[b - 2] + w[b - 1]).toLowerCase());
    cuts.push(digraph ? b - 2 : a + (gap <= 1 ? 0 : Math.floor(gap / 2)));
  }
  cuts.push(len);
  const out: string[] = [];
  for (let i = 0; i < cuts.length - 1; i++) out.push(w.slice(cuts[i], cuts[i + 1]).join(''));
  return out;
}

/** a e i o u y in either case, with any accent. */
function isVowelLetter(c: string): boolean {
  const base = c.length === 1 && c < '\u0080' ? c : c.normalize('NFD')[0];
  switch (base) {
    case 'a': case 'e': case 'i': case 'o': case 'u': case 'y':
    case 'A': case 'E': case 'I': case 'O': case 'U': case 'Y':
      return true;
    default:
      return false;
  }
}

/** A diaeresis says its vowel is a syllable of its own: "na-ïve", "Zo-ë". */
function hasDiaeresis(c: string): boolean {
  return c.length === 1 && c < '\u00C0' ? false : c.normalize('NFD').includes('\u0308');
}
