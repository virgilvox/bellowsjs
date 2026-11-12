/*
 * American English allophones, applied across a phrase: /t d/ between a vowel
 * (or ɹ) and an unstressed vowel become the flap ɾ ("water", "little",
 * "got it"), except at the start of a word, and /l/ that ends a syllable
 * becomes velarized ɫ ("tell", "little", "milk").
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth, crates/chimera/src/phonetics/english.rs
 * (apply_allophones, lines 268-292) at 1d3ea49. Changes from the original: it runs over sung
 * syllables instead of a flat segment list, a phrase at a time, and only over syllables the
 * English front end read, so IPA written between slashes is sung exactly as written. See
 * THIRD_PARTY_NOTICES.md.
 *
 * Both rules need the next sound, which can be in the next word ("got it" flaps across the
 * space), so they cannot live inside a front end that reads one word at a time; that is why the
 * first port of the English front end lost them, and why this pass runs after the router.
 */

import type { Segment, Syllable } from './types';
import { isVowel } from './ipa';

interface Slot {
  seg: Segment;
  /** Last segment of its word. */
  wordEnd: boolean;
}

/**
 * Rewrite the segments of `syllables` in place where the rules apply. `english` says which
 * syllables the English front end produced; runs of them are processed phrase by phrase, and
 * anything else (IPA, a melisma) ends a run.
 */
export function applyAllophones(syllables: readonly Syllable[], english: (s: Syllable) => boolean): void {
  let run: Slot[] = [];
  const flush = () => {
    if (run.length > 0) rewrite(run);
    run = [];
  };
  for (const syl of syllables) {
    if (!english(syl) || syl.melisma) {
      flush();
      continue;
    }
    const segs = [...syl.onset, syl.nucleus, ...syl.coda];
    segs.forEach((seg, i) => run.push({ seg, wordEnd: syl.wordEnd && i === segs.length - 1 }));
    if (syl.phraseEnd) flush();
  }
  flush();
}

function rewrite(segs: Slot[]): void {
  for (let i = 1; i + 1 < segs.length; i++) {
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const s = segs[i].seg;
    if ((s.ipa === 't' || s.ipa === 'd') && (isVowel(prev.seg.ipa) || prev.seg.ipa === 'ɹ') && isVowel(next.seg.ipa)) {
      const nextStressed = next.seg.stress !== undefined && next.seg.stress !== 0;
      // not at the start of a word: "were disputing" keeps its /d/
      if (!nextStressed && !prev.wordEnd) s.ipa = 'ɾ';
    }
  }
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].seg.ipa !== 'l') continue;
    const nextVowel = i + 1 < segs.length && isVowel(segs[i + 1].seg.ipa);
    // coda /l/, before a consonant, a pause or the end of a word, is velarized
    if (!nextVowel || segs[i].wordEnd) segs[i].seg.ipa = 'ɫ';
  }
}
