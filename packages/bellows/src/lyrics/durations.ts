/*
 * How long each consonant lasts, in seconds, keyed by IPA, and how much
 * shorter it is when sung.
 *
 * Ported from CHIMERA by Jameson Hodge (MIT),
 * https://github.com/jamesondh/chimera-vocal-synth,
 * crates/chimera/src/phonetics/inventory.rs at 1d3ea49 (TypeScript original
 * at cd247a6^:src/engine/phonetics/inventory.ts). Changes from the original:
 * only each phoneme's default duration (its `dur` field) is kept, as a plain
 * table; the sung scales and the 70 ms fallback come from sing.rs, the
 * alternate spellings from ipa.rs. See THIRD_PARTY_NOTICES.md.
 *
 * Where the numbers come from. CHIMERA times speech with the Klatt (1979)
 * segment duration rules as MITalk sets them out (Allen, Hunnicutt and
 * Klatt 1987, ch. 9): DUR = MIN + (INH - MIN) * PRCNT, an inherent and a
 * minimum duration per phoneme scaled by a product of context factors
 * (crates/chimera/src/phonetics/durations.rs). Singing does not use those
 * rules, because the note decides how long the vowel lasts. CHIMERA's sung
 * planner gives each consonant the default duration its inventory lists
 * for the articulatory model, times a scale k ("sung consonants are a
 * little shorter than spoken ones"), and this table is those defaults.
 * They are CHIMERA's own values, not Klatt's: of the 27 consonants both
 * tables list, p, t and k agree with Klatt's inherent durations, 15 are
 * longer here (s 120 ms against 105, tʃ 150 against 70) and 9 are shorter
 * (ɹ 65 against 80, j 55 against 80).
 */

/** Default duration in seconds of each consonant CHIMERA's inventory knows, by IPA. */
export const CONSONANT_DURATIONS: Readonly<Record<string, number>> = Object.freeze({
  /* stops */
  p: 0.085,
  b: 0.07,
  t: 0.075,
  d: 0.06,
  ʈ: 0.075,
  ɖ: 0.065,
  c: 0.08,
  ɟ: 0.07,
  k: 0.08,
  g: 0.07,
  q: 0.085,
  ɢ: 0.075,
  ʔ: 0.06,
  /* nasals */
  m: 0.075,
  ɱ: 0.075,
  n: 0.07,
  ɳ: 0.07,
  ɲ: 0.075,
  ŋ: 0.08,
  ɴ: 0.08,
  /* fricatives */
  ɸ: 0.11,
  β: 0.09,
  f: 0.11,
  v: 0.08,
  θ: 0.11,
  ð: 0.07,
  s: 0.12,
  z: 0.09,
  ʃ: 0.12,
  ʒ: 0.09,
  ʂ: 0.12,
  ʐ: 0.09,
  ç: 0.12,
  ʝ: 0.09,
  x: 0.12,
  ɣ: 0.09,
  χ: 0.12,
  ʁ: 0.09,
  ħ: 0.12,
  ʕ: 0.09,
  h: 0.09,
  ɦ: 0.08,
  ɬ: 0.12,
  ɮ: 0.09,
  /* affricates */
  ts: 0.14,
  dz: 0.12,
  tʃ: 0.15,
  dʒ: 0.13,
  /* Mandarin: alveolo-palatal fricatives and affricates, retroflex affricates */
  ɕ: 0.12,
  ʑ: 0.09,
  tɕ: 0.14,
  dʑ: 0.12,
  tʂ: 0.14,
  dʐ: 0.12,
  pf: 0.14,
  /* approximants, laterals, taps, trills */
  w: 0.06,
  ʋ: 0.06,
  ɹ: 0.065,
  ɻ: 0.065,
  j: 0.055,
  ɥ: 0.055,
  ɰ: 0.06,
  l: 0.065,
  ɫ: 0.075,
  ɭ: 0.065,
  ʎ: 0.07,
  ɾ: 0.025,
  ɽ: 0.03,
  r: 0.11,
  ʀ: 0.11,
  ʙ: 0.12,
});

/** A sound the table does not list: CHIMERA's fallback in sing.rs `cdur`. */
export const DEFAULT_CONSONANT_DURATION = 0.07;

/** CHIMERA's k for a planned song (sing.rs `plan_song`). */
export const SUNG_CONSONANT_SCALE = 0.8;

/** CHIMERA's k for live playing, a key press at a time (sing.rs `plan_note_on`). */
export const LIVE_CONSONANT_SCALE = 0.7;

/* A Map, so a lookup can never land on an Object.prototype member. */
const TABLE = new Map<string, number>(Object.entries(CONSONANT_DURATIONS));

/*
 * Other spellings of the same sound: the script g CHIMERA's ipa.rs folds to
 * ASCII g, and the six affricate ligatures U+02A3 to U+02A8.
 */
const SPELLINGS = new Map<string, string>([
  ['ɡ', 'g'],
  ['ʣ', 'dz'],
  ['ʤ', 'dʒ'],
  ['ʥ', 'dʑ'],
  ['ʦ', 'ts'],
  ['ʧ', 'tʃ'],
  ['ʨ', 'tɕ'],
]);

/*
 * Spacing modifier letters (aspiration ʰ, palatalization ʲ, length ː,
 * stress marks) and combining diacritics (tie bars, the voiceless ring).
 * None of them changes which consonant it is, so a lookup that misses
 * retries on the bare letters.
 */
const MARKS = /[ʰ-˿̀-ͯ]/g;

function lookup(ipa: string): number | undefined {
  const d = TABLE.get(ipa);
  if (d !== undefined) return d;
  const alias = SPELLINGS.get(ipa);
  return alias === undefined ? undefined : TABLE.get(alias);
}

/**
 * Default duration in seconds of a consonant, before any sung scale.
 * Unknown sounds get DEFAULT_CONSONANT_DURATION.
 */
export function consonantDuration(ipa: string): number {
  return lookup(ipa) ?? lookup(ipa.replace(MARKS, '')) ?? DEFAULT_CONSONANT_DURATION;
}
