/*
 * Contracts for the lyric layer: text and notes in, timed phonemes out.
 *
 * This layer knows nothing about audio, engines, kernels or clocks. It
 * speaks IPA strings and seconds and Hz. The caller resolves note times
 * through its tempo map and pitches through its tuning before anything
 * reaches here, so nothing in this directory assumes 12-EDO or a fixed
 * tempo, and the facade maps the IPA it produces onto whatever an engine
 * understands.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth,
 * crates/chimera/src/phonetics/mod.rs (Segment, Syllable) and syllables.rs
 * (the FrontEnd trait) at 1d3ea49 (TypeScript original at
 * cd247a6^:src/engine/phonetics/syllables.ts and planner.ts). Changes from
 * the original: Segment keeps only ipa, stress and dur; FrontEnd.continues
 * has no default; PronouncingDictionary and the Sung* plan types are new.
 * See THIRD_PARTY_NOTICES.md.
 */

/** One phoneme, as IPA. Diphthongs stay one segment ("aɪ") until the sung planner splits them. */
export interface Segment {
  ipa: string;
  /** Lexical stress of a vowel: 0 unstressed, 1 primary, 2 secondary. */
  stress?: 0 | 1 | 2;
  /** Duration override in seconds. */
  dur?: number;
}

/** A sung syllable: what one note (or a melisma of notes) carries. */
export interface Syllable {
  /** The part of the lyric's spelling shown on the note; "~" for a melisma or an unspelled part. */
  text: string;
  onset: Segment[];
  /** The vowel. A diphthong stays one nucleus ("aɪ"). */
  nucleus: Segment;
  coda: Segment[];
  /** Continue the previous syllable's vowel at a new pitch. */
  melisma?: boolean;
  /** Last syllable of a word. */
  wordEnd: boolean;
  /** A breath follows (comma, full stop, line break). */
  phraseEnd: boolean;
}

/**
 * A pronouncing dictionary: lowercase word to ARPAbet with stress digits,
 * the CMUdict format ("HH AH0 L OW1"). Injected, never fetched, so the
 * layer stays pure and ships no data.
 */
export type PronouncingDictionary = ReadonlyMap<string, string>;

/** A language front end: claims words written in its script and turns each into syllables. */
export interface FrontEnd {
  /** A word this front end reads starts with this character. */
  starts(c: string): boolean;
  /** This character continues a word this front end started. */
  continues(c: string): boolean;
  /** One word to its syllables. The router marks the last one as the word's end. */
  word(word: string): Syllable[];
}

/** A note to sing, already resolved to absolute seconds and Hz by the caller. */
export interface SungNote {
  /** Onset in seconds. The syllable's vowel lands here. */
  time: number;
  /** Duration in seconds. */
  dur: number;
  hz: number;
  /** 0..1, default 0.8. */
  vel?: number;
}

/** One timed phoneme. Spans in a phrase are contiguous and in order. */
export interface SungSpan {
  /** A single phoneme: diphthongs arrive here already split into their two vowels. */
  ipa: string;
  start: number;
  end: number;
  kind: 'onset' | 'nucleus' | 'coda';
}

/** A pitch target taking effect at a time. */
export interface SungPitch {
  time: number;
  hz: number;
}

/** A stretch sung on one breath: one voice from its first sound to its last. */
export interface SungPhrase {
  /** Start of the first span, which is before the first note when the phrase opens on consonants. */
  start: number;
  end: number;
  /** Velocity of the phrase's first note. */
  vel: number;
  spans: SungSpan[];
  /** First entry is the phrase's opening pitch, at `start`. */
  pitches: SungPitch[];
}

export interface SungPlan {
  phrases: SungPhrase[];
  /**
   * The longest time any phrase starts before its first note, in seconds.
   * Schedule the call at least this far ahead of the first beat, or the
   * opening consonants are in the past when they reach a realtime kernel.
   */
  leadIn: number;
}
