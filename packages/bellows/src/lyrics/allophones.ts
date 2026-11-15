/*
 * American English allophones, applied across a phrase: /t d/ between a vowel
 * (or ɹ) and an unstressed vowel become the flap ɾ ("water", "little",
 * "got it"), except at the start of a word, and /l/ that ends a syllable
 * becomes velarized ɫ ("tell", "little", "milk"). Those are General American's rules
 * and the default; an accent (accents.ts) picks others: t released, or glottal before a
 * consonant (Southern British, Scottish), or also before a pause and between vowels (London); l clear
 * everywhere (Irish), dark everywhere (Scottish), or vocalized after a vowel (London).
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
import type { LRule, TRule } from './accents';
import { isVowel } from './ipa';

/** Which t and l rules to apply; General American's when left out. */
export interface AllophoneRules {
  t?: TRule;
  l?: LRule;
}

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
export function applyAllophones(
  syllables: readonly Syllable[],
  english: (s: Syllable) => boolean,
  rules: AllophoneRules = {},
): void {
  const t = rules.t ?? 'flap';
  const l = rules.l ?? 'dark-coda';
  let run: Slot[] = [];
  const flush = () => {
    if (run.length > 0) rewrite(run, t, l);
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

function rewrite(segs: Slot[], t: TRule, l: LRule): void {
  if (t === 'flap') {
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
  } else if (t === 'glottal' || t === 'glottal-coda') {
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i].seg;
      const before = segs[i - 1].seg.ipa;
      if (s.ipa !== 't' || !(isVowel(before) || before === 'n' || before === 'l')) continue;
      const next = segs[i + 1]?.seg;
      // "football", "that one": before a consonant other than r, w, j (which keep "true", "twin" whole); London also before a pause
      const coda =
        next === undefined ? t === 'glottal' : !isVowel(next.ipa) && !CLUSTERS_WITH_T.has(next.ipa);
      // "water", "bottle" (as wɔʔə, bɒʔəl): between a vowel and an unstressed one inside a word
      const between =
        t === 'glottal' &&
        next !== undefined &&
        isVowel(next.ipa) &&
        !(next.stress !== undefined && next.stress !== 0) &&
        !segs[i - 1].wordEnd &&
        isVowel(segs[i - 1].seg.ipa);
      if (coda || between) s.ipa = 'ʔ';
    }
  }
  if (l === 'clear') return;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].seg.ipa !== 'l') continue;
    const nextVowel = i + 1 < segs.length && isVowel(segs[i + 1].seg.ipa);
    const coda = !nextVowel || segs[i].wordEnd;
    if (l === 'dark') segs[i].seg.ipa = 'ɫ';
    // coda /l/, before a consonant, a pause or the end of a word, is velarized (or, in London, a w-like glide)
    else if (coda) segs[i].seg.ipa = l === 'vocalized' ? 'w' : 'ɫ';
  }
}

/** Consonants a /t/ joins in an onset ("true", "twin"), which keep it from glottalling. */
const CLUSTERS_WITH_T = new Set(['ɹ', 'w', 'j']);
