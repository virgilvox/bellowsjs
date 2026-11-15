# Accents and voices: plan (2026-11-14)

The owner's goal: any accent, and a voice customizable far enough that voices are discernibly
different. The trigger: every render sounds like "an old Irish man", and none of six variants
(diphthong timing, voice quality, pitch scoops; scratch accent/ab) removed it.

## What makes an accent and a voice (sourced)

- **Accents live mostly in the vowel system.** Each region realizes "the same" vowel differently,
  and listeners identify accents mostly from vowel quality; they identify more reliably when
  several cues reinforce one another (vowels, consonants, intonation). PNW vowel study
  (https://pmc.ncbi.nlm.nih.gov/articles/PMC3288672), Northern English attention study
  (https://eprints.whiterose.ac.uk/id/eprint/233826/6/fpsyg-16-1613018.pdf).
- **Which vowel a word takes is per accent too.** Wells's lexical sets (FACE, GOAT, BATH, LOT, NURSE,
  START...) name a word's vowel independently of how any accent says it, and accents differ both in
  the realization of each set and in which sets merge or split (TRAP and BATH, rhoticity).
  https://en.wikipedia.org/wiki/Lexical_set
- **Measured vowel data exists across accents:** Hillenbrand et al. 1995 (General American),
  Ferragne and Pellegrino 2010 (13 accents of the British Isles, https://core.ac.uk/download/47086396.pdf),
  with more for Australian, New Zealand and North American regions to collect.
- **Irish English specifically:** FACE and GOAT as long monophthongs [eː] [oː] in the south
  (https://Www.Wikipedia.org/wiki/South-West_Irish_English, citing Hickey 2007), TH-stopping (dental
  [t̪] [d̪] for th), clear /l/, rising nuclear accents on statements in the north (Grabe and Post,
  https://mail.sprosig.org/sp2002/pdf/grabe-post.pdf). Sean-nós singing: slides, grace notes and
  melisma (https://en.wikipedia.org/wiki/Sean-n%C3%B3s_singing).
- **Speaker identity, apart from accent:** vocal tract length (formant spacing) and F0 carry most of
  it; source detail (spectral balance, F0 flutter, HNR) adds the rest
  (https://www.isca-archive.org/eurospeech_2003/turk03b_eurospeech.pdf,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3849092).
- **Perceived age:** jitter, shimmer and HNR worsen with age in men (e.g.
  https://mail.ijhsr.org/IJHSR_Vol.13_Issue.5_May2023/IJHSR13.pdf); MDVP screening thresholds 1.04
  percent jitter, 3.81 percent shimmer (https://journal.fi/pk/article/download/8091/6205/20453).
- **Articulatory synthesizers fit articulator targets to measured vowels** by analysis by synthesis
  (VocalTractLab, https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf). No published
  system was found that does accents this way.

## What the voice does today (MEASURED, scratch accent/)

- Steady vowel targets match General American: F1 and F2 within 5 percent RMS of Hillenbrand's male
  means. Only /æ/ is off (F2 9 percent low).
- Diphthongs hold their first vowel for 80 percent (lyrics/sing.ts DIPHTHONG_HOLD), so "day" and
  "go" are near-monophthongs [eː] [oː]. Moving the hold to 50 percent only moves the jump.
- Default voice quality reads aged: jitter 1.4 percent, shimmer 5.5 to 6.2 percent (roughness 0.1,
  CHIMERA's mapping, which keeps a 2 percent shimmer floor even at roughness 0).
- The inventory is General American's only. Other vowel symbols are aliases onto it (ɒ is ɑ, ʉ is u,
  ɐ is ʌ), so no accent outside it can be produced by writing IPA.
- **The engine can produce any vowel once its tongue, jaw and lip targets are known.** A solver
  (geometry to area function to tube resonances, a 220 Hz yielding-wall correction on F1, then a
  bounded Nelder-Mead over jaw, tongue body x and y, tongue root, lip aperture and protrusion) found
  targets for British LOT, fronted GOOSE, non-rhotic NURSE and a centralized KIT; rendered by the
  engine they land within 1 to 8 percent of the target formants (e.g. LOT 609/945 Hz for 600/900).

## Architecture

Accent and voice are data, applied at the layer where each one physically lives.

1. **Lexicon to lexical sets** (lyric layer, main thread). Tag each vowel the reader produces with its
   lexical set, from spelling and phoneme (BATH is æ before f, s, θ, ns..., PALM and LOT split by
   spelling, and so on). The tag is accent-neutral.
2. **Accent rules** (lyric layer, data). An accent maps each lexical set to a realization (one vowel
   or a trajectory with its timing), and sets its consonant rules: rhoticity, t (flap, glottal, slit,
   released), l (clear, dark, vocalized), TH (fricative, stopped, fronted), h-dropping, yod. The
   allophone pass that exists (flaps, dark l) becomes the General American instance of this.
3. **Vowel targets by solving, not by table** (engine data, built offline). Every vowel quality an
   accent names is a formant target (F1, F2, F3, rounding) per body; the solver turns it into
   articulator targets, checked by rendering. The inventory grows past General American's; the
   aliases become real vowels.
4. **Diphthongs as trajectories**: onset, offset and a glide shape over the whole vowel, per accent and
   set, so American [eɪ] moves throughout while Irish [eː] holds.
5. **Prosody per accent** for speech: pitch-accent shapes, nuclear tones (falls; Belfast rises),
   declination, rhythm (stress-timed durations, vowel reduction), speech rate. Singing styles
   (classical, pop, sean-nós ornament) are their own preset of glide, overshoot and preparation.
6. **Voice identity** (engine params, continuous): tract scale, pharynx ratio, tongue radius, lip width
   (already in the geometry's setBody), F0 register and range, tension, breath, roughness, age.
   Accent and voice are independent, so any voice can speak any accent.

## Phases, each with a gate

1. **Find the Irishness.** Which cue carries it: consonants (TH strength, l, t), rhythm, or the vowel
   system. Gate: the owner's ear on single-cue clips, plus TH and l measured against human recordings.
2. **Solver in the build.** scripts/gen-vowels: formant targets per accent and body in, articulator
   rows out, with an engine render check. Gate: every solved vowel within 5 percent of target in F1
   and F2 through the engine.
3. **Lexical sets and accent rules** in the lyric layer, General American as the first accent and the
   default, byte-identical to today. Gate: the existing lyric tests unchanged, set tagging tested
   against a word list.
4. **Two more accents from published data** (Southern British from Ferragne and Pellegrino, Australian
   from Cox), with consonant rules and speech prosody. Gate: listeners (the owner) name them.
5. **Voice identity params** exposed and documented, presets for distinct voices. Gate: voices told
   apart blind.
6. **Diphthong trajectories and per-accent prosody templates.**

## Status (2026-11-14)

- **Phase 2 done.** `scripts/gen-extra-vowels.mjs` (npm run gen:vowels) solves twelve vowels (ɒ ɐ ɜ
  ʉ ɨ ɘ ɵ y ø œ ɯ ɤ) for each body and closes the loop through the engine with damped corrections.
  Rendered, every one lands within 4.2 percent of its F1 and F2 targets except the child body's y (F1
  about 12 percent high, that body's floor for a rounded close vowel). The model alone missed ɐ, ɨ
  and y by up to 14 percent. CHIMERA's data also had rows for eight of these symbols; the solved
  rows replace them.
- **Phase 3 done.** `lyrics/lexical-sets.ts` tags every vowel the English reader produces;
  `lyrics/accents.ts` holds the accents as data and `applyAccent` applies them before the allophone
  pass, which now takes the accent's t and l rules. General American output is unchanged (the lyric
  tests pass as they were, plus the new `set` field).
- **Phase 4 started**, from published lexical-set tables rather than measured formants: Southern
  British, London, Australian, New Zealand, Irish, Scottish and Southern US, each with consonant
  rules and a speech prosody. Not yet judged by ear.
- **Phase 6 partly done.** Any two-vowel nucleus glides, at the accent's hold. Speech prosody
  (`lyrics/speech.ts`, `Instrument.speak()`): stress-timed durations, final lengthening,
  declination, pitch accents and a final fall or rise per accent, a rise for "?".
- **New functions:** `pronounce()` and `toIPA()` show what will be said, with stress, syllables and
  sets.
- **Open:** phase 1 (which cue carries the Irishness of the default voice) and phase 5 (voice
  identity presets). The default voice's roughness still gives 1.4 percent jitter and 5.5 percent
  shimmer, above the MDVP thresholds, which reads as aged.
