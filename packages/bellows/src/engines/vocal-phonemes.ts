/*
 * The phonemes the vocal engine can render, and the index each one answers
 * to on the engine's `phoneme` parameter.
 *
 * Parameters are numbers, so a phoneme crosses into the kernel as its index
 * in VOCAL_PHONEMES, carried by an ordinary Param event. That keeps a sung
 * phrase on the same sample-accurate event path as every other automation,
 * in realtime and offline alike.
 *
 * APPEND ONLY. A saved patch or a recorded event stream stores the index,
 * so reordering this list changes what old material sings.
 *
 * What each sound is made of (its articulators, targets and gestures)
 * lives in engines/vocal-tables.gen.ts and engines/vocal-planner.ts. This
 * file keeps what a caller needs without the engine: the list, the class
 * of each sound, and the stop release rules src/sing.ts times sung
 * releases by. The classes, the voicing and the release rules follow
 * CHIMERA by Jameson Hodge (crates/chimera/src/phonetics/inventory.rs and
 * phonetics/planner.rs, at 1d3ea49). Reimplemented here. See
 * THIRD_PARTY_NOTICES.md.
 */

export const VOCAL_PHONEMES = [
  /* 0: silence inside a phrase, voicing and noise off */
  '_',
  /* 1 to 14: vowels. Diphthongs are sung as two of these. */
  'ɑ', 'æ', 'ʌ', 'ɔ', 'ɛ', 'ɝ', 'ɪ', 'i', 'ʊ', 'u', 'e', 'o', 'a', 'ə',
  /* 15 to 20: stops */
  'p', 'b', 't', 'd', 'k', 'g',
  /* 21 to 29: fricatives */
  'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h',
  /* 30 to 31: affricates */
  'tʃ', 'dʒ',
  /* 32 to 34: nasals */
  'm', 'n', 'ŋ',
  /* 35 to 38: approximants */
  'l', 'ɹ', 'w', 'j',
  /* 39 to 40: flap and glottal stop */
  'ɾ', 'ʔ',
  /* 41: the velarized (dark) lateral of a syllable coda, "tell", "milk" */
  'ɫ',
] as const;

export type VocalPhoneme = (typeof VOCAL_PHONEMES)[number];

/** Spellings that mean a phoneme above. */
const ALIASES: Readonly<Record<string, VocalPhoneme>> = {
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

const INDEX = new Map<string, number>(VOCAL_PHONEMES.map((s, i) => [s, i]));

/** Index of an IPA symbol on the `phoneme` parameter, through the aliases; -1 if the engine has no such sound. */
export function vocalPhonemeIndex(ipa: string): number {
  const direct = INDEX.get(ipa);
  if (direct !== undefined) return direct;
  const alias = ALIASES[ipa];
  return alias === undefined ? -1 : (INDEX.get(alias) ?? -1);
}

/** The default phoneme, an open /ɑ/, so a plain note-on sings "ah". */
export const VOCAL_DEFAULT_PHONEME = 1;

/* ------------------------------------------------------------------ */
/* Classes and release times                                           */
/* ------------------------------------------------------------------ */

export type VocalClass =
  | 'silence'
  | 'vowel'
  | 'stop'
  | 'fricative'
  | 'affricate'
  | 'nasal'
  | 'approximant'
  | 'flap'
  | 'glottal';

/** One phoneme's class, voicing and release time. */
export interface VocalAcoustics {
  readonly ipa: VocalPhoneme;
  readonly cls: VocalClass;
  readonly voiced: boolean;
  /** 1 for a stop English aspirates (p t k), 0 otherwise. */
  readonly aspiration: number;
  /** Seconds from a stop's release to voicing (Lisker and Abramson 1964, word-initial English means); 0 for the rest. */
  readonly vot: number;
}

type Row = { cls: VocalClass; voiced: boolean; aspiration?: number; vot?: number };
const V: Row = { cls: 'vowel', voiced: true };

/*
 * VOT: 58, 70 and 80 ms for /p t k/, which are aspirated, and 1, 5 and 21
 * ms for /b d g/, the means usually quoted from Lisker and Abramson
 * (1964), A cross-language study of voicing in initial stops, Word 20,
 * 384-422 (CHIMERA's planner uses 50 ms for all three, planner.rs:492).
 * The classes and voicing agree with CHIMERA's inventory; /h/ is
 * 'glottal' there and here.
 */
const SOUNDS: Readonly<Record<VocalPhoneme, Row>> = {
  _: { cls: 'silence', voiced: false },
  ɑ: V, æ: V, ʌ: V, ɔ: V, ɛ: V, ɝ: V, ɪ: V, i: V, ʊ: V, u: V, e: V, o: V, a: V, ə: V,
  p: { cls: 'stop', voiced: false, aspiration: 1, vot: 0.058 },
  b: { cls: 'stop', voiced: true, vot: 0.001 },
  t: { cls: 'stop', voiced: false, aspiration: 1, vot: 0.07 },
  d: { cls: 'stop', voiced: true, vot: 0.005 },
  k: { cls: 'stop', voiced: false, aspiration: 1, vot: 0.08 },
  g: { cls: 'stop', voiced: true, vot: 0.021 },
  f: { cls: 'fricative', voiced: false },
  v: { cls: 'fricative', voiced: true },
  θ: { cls: 'fricative', voiced: false },
  ð: { cls: 'fricative', voiced: true },
  s: { cls: 'fricative', voiced: false },
  z: { cls: 'fricative', voiced: true },
  ʃ: { cls: 'fricative', voiced: false },
  ʒ: { cls: 'fricative', voiced: true },
  h: { cls: 'glottal', voiced: false },
  tʃ: { cls: 'affricate', voiced: false },
  dʒ: { cls: 'affricate', voiced: true },
  m: { cls: 'nasal', voiced: true },
  n: { cls: 'nasal', voiced: true },
  ŋ: { cls: 'nasal', voiced: true },
  l: { cls: 'approximant', voiced: true },
  ɹ: { cls: 'approximant', voiced: true },
  w: { cls: 'approximant', voiced: true },
  j: { cls: 'approximant', voiced: true },
  ɾ: { cls: 'flap', voiced: true },
  ʔ: { cls: 'glottal', voiced: false },
  ɫ: { cls: 'approximant', voiced: true },
};

/** One row per entry of VOCAL_PHONEMES, in the same order. */
export const VOCAL_ACOUSTICS: readonly VocalAcoustics[] = VOCAL_PHONEMES.map((ipa): VocalAcoustics => {
  const s = SOUNDS[ipa];
  return { ipa, cls: s.cls, voiced: s.voiced, aspiration: s.aspiration ?? 0, vot: s.vot ?? 0 };
});

/**
 * Release to voicing of a stop that is not aspirated, in seconds: CHIMERA's
 * 12 ms for an unaspirated stop (crates/chimera/src/phonetics/planner.rs:340-349).
 */
export const VOCAL_UNASPIRATED_VOT = 0.012;

const S_INDEX = INDEX.get('s') ?? -1;
/* What a stop's release is held for, by the sound it opens into: 0 nothing, 1 a vowel or silence, 2 an approximant. */
const RELEASE_INTO = new Uint8Array(VOCAL_ACOUSTICS.length);
const IS_STOP = new Uint8Array(VOCAL_ACOUSTICS.length);
VOCAL_ACOUSTICS.forEach((row, i) => {
  RELEASE_INTO[i] = row.cls === 'vowel' || row.cls === 'silence' ? 1 : row.cls === 'approximant' ? 2 : 0;
  IS_STOP[i] = row.cls === 'stop' ? 1 : 0;
});

function inTable(i: number): boolean {
  return i >= 0 && i < VOCAL_ACOUSTICS.length && i === Math.floor(i);
}

/**
 * Whether the vocal engine aspirates the release of the stop at index
 * `stop`, `prev` being the sound before it (-1 at the start of a note): a
 * voiceless stop, except after /s/, where English does not aspirate (/sp
 * st sk/, CHIMERA's rule, planner.rs:340). One rule for the engine and for
 * src/sing.ts, which times sung releases by it.
 */
export function vocalReleaseAspirated(stop: number, prev: number): boolean {
  return inTable(stop) && IS_STOP[stop] === 1 && VOCAL_ACOUSTICS[stop].aspiration > 0 && prev !== S_INDEX;
}

/**
 * Seconds the vocal engine holds voicing at the stop's own level after
 * releasing the stop at index `stop` into the sound at `next`: the stop's
 * VOT before a vowel or silence when the release is aspirated, else
 * VOCAL_UNASPIRATED_VOT (or the stop's VOT if shorter); before an
 * approximant the short one either way, because a long aspiration would
 * devoice the whole glide of /tw/ or /kl/, which English devoices only at
 * its start. CHIMERA aspirates only before a vowel (planner.rs:341). 0
 * before any other consonant, where the release opens into that sound.
 */
export function vocalReleaseVot(stop: number, prev: number, next: number): number {
  if (!inTable(stop) || IS_STOP[stop] !== 1 || !inTable(next)) return 0;
  const into = RELEASE_INTO[next];
  if (into === 0) return 0;
  const vot = VOCAL_ACOUSTICS[stop].vot;
  if (into === 1 && vocalReleaseAspirated(stop, prev)) return vot;
  return vot < VOCAL_UNASPIRATED_VOT ? vot : VOCAL_UNASPIRATED_VOT;
}
