/* Transcription of src/presets/instruments.ts: named instrument presets.
 *
 * All 50, over 8 families and the 11 engines the presets between them
 * name. The JS holds them as one array of objects, each with a params
 * record keyed by param name. Neither half of that survives the trip. A
 * record keyed by "pickPos" needs strings and a lookup, and one array of
 * objects that mentions every engine is the registry problem bank.h exists
 * to avoid: naming every engine forces the linker to keep every engine,
 * which is the 30296 bytes of flash against 3760 that bank.h's own comment
 * records.
 *
 * THE SHAPE, AND WHY THIS ONE
 *
 * Each engine has a different Params struct, so a single table cannot hold
 * them all. The two honest options are a tagged struct per engine or one
 * row with an engine tag and a payload wide enough for the widest engine.
 * This is the first, split in two parts:
 *
 *   kInstrumentPresets[]   one row per preset: id, label, family, an engine
 *                          tag, a slot, an insert fx tag and slot, the gain
 *                          trim and the octave shift. No engine params.
 *   kPluckPresetParams[]   the pluck rows' params, in Pluck::Params field
 *   kModalPresetParams[]   order. One table per engine, indexed by slot.
 *   ...
 *
 * A single row with a union payload would have to be as wide as the widest
 * engine, which is Fm at 20 floats, so 50 rows would carry 4000 bytes of
 * params where the eleven split tables carry 2044, and every sketch would
 * pay for all of it because it would all be one array. Split, a sketch that
 * plays the mallet presets references kModalPresetParams and nothing else,
 * and --gc-sections drops the other ten. That is the same argument
 * chords.h makes for keeping its name table out of the integer half.
 *
 * Measured on Cortex-M7 at -Os with -fdata-sections, one section per
 * table: index 1000, id and label strings 1061, pluck 240, string 380,
 * harmonic 252, additive 360, wavetable 44, modal 160, va 256, fm 240,
 * tube 40, formant 48, westcoast 24, chorus 64, tremolo 8, tape delay 12,
 * plate 48. A sketch that touches all of it pays 4237 bytes of flash plus
 * the lookup code. One that only ever calls ModalParamsOf pays the 160 of
 * the modal table and none of the other ten, and it pays the 1000 and the
 * 1061 only if it reads the index rather than reaching for
 * kModalPresetParams by slot.
 *
 * Nothing here is virtual and nothing is registered. Dispatch is the
 * caller's `if`, or bellows::Bank indexed by the engine tag, which is what
 * examples/21_Presets does.
 *
 * NO ENGINE HEADER IS INCLUDED, ON PURPOSE
 *
 * This file includes stdint.h and nothing else. It cannot include
 * engines/pluck.h anyway (Pluck is a template, so Pluck<110>::Params and
 * Pluck<20>::Params are different types and a table would have to pick
 * one), and not including it turns out to be the better property: a sketch
 * that never names an engine cannot be made to link one by asking for a
 * preset.
 *
 * The bridge is ApplyPreset, overloaded on the param struct and templated
 * on the destination:
 *
 *   const bellows::InstrumentPreset* pre = bellows::FindPreset("banjo");
 *   bellows::Pluck<110>::Params p;
 *   if (const auto* d = bellows::PluckParamsOf(*pre)) ApplyPreset(*d, &p);
 *
 * The destination type is deduced, so the field names are checked by the
 * compiler at the call site: rename Pluck::Params::pick_pos and every
 * sketch that applies a pluck preset fails to compile. That is the only
 * check available here, because a table of floats cannot know what it is
 * for, and it is why each param struct below carries the JS param name
 * next to each field. The names were taken from params.gen.h, which is
 * generated from the TypeScript ParamSpec arrays and is the authority on
 * which JS name is which C++ field. test/parity/presets.mjs reads that
 * same generated file and diffs every value below against the TypeScript,
 * so a mistranscribed number is a failing check rather than a preset that
 * sounds slightly wrong.
 *
 * WHAT IS NOT HERE
 *
 * Every preset is here. One insert effect is not: tapeDelay has no port.
 * The fx layer has StereoDelayExt, which has the time, the feedback and
 * the mix but none of the wow, flutter, saturation or tone, so
 * clean-electric keeps kFxTapeDelay and the three params that transfer,
 * and a sketch either substitutes a plain delay or leaves it dry. Nothing
 * here silently swaps one effect for another, which is why kFxTapeDelay is
 * a tag with a table and no ApplyPreset.
 *
 * GAIN AND OCTAVE ARE NOT ENGINE PARAMS
 *
 * gain is a channel trim (the JS default is 0.8, written out on every row
 * rather than implied) and octave is a suggested keyboard shift in
 * octaves. Both live in the index row because they mean the same thing
 * whatever the engine is, and neither is applied by ApplyPreset: the
 * caller multiplies and transposes, because this library has no mixer and
 * no keyboard. The additive rows have a `gain` of their own, which is the
 * engine's output param and a different number entirely.
 */
#pragma once
#include <stdint.h>

namespace bellows {

enum InstrumentFamily : uint8_t {
  kFamilyGuitars = 0,
  kFamilyStrings,
  kFamilyWinds,
  kFamilyBrass,
  kFamilyKeys,
  kFamilyMallets,
  kFamilyVoices,
  kFamilySynth,

  kFamilyCount
};

/* Engine tag. The enum is the index of a param table, so this names the
 * eleven engines the presets use and nothing else: the drum engines and
 * granular have ports (or do not) without a preset in this file asking for
 * them. New tags are appended, so an existing tag's value never moves. */
enum PresetEngine : uint8_t {
  kEnginePluck = 0,
  kEngineModal,
  kEngineVa,
  kEngineFm,
  kEngineTube,
  kEngineFormant,
  kEngineWestCoast,
  kEngineString,
  kEngineHarmonic,
  kEngineAdditive,
  kEngineWavetable,

  kPresetEngineCount
};

/* Insert effect a preset asks for, applied before the gain trim. */
enum PresetFx : uint8_t {
  kFxNone = 0,
  kFxChorus,
  kFxTremolo,
  /* No tape delay is ported. See the header comment. */
  kFxTapeDelay,
  kFxPlate
};

/* ------------------------------------------------------------------ */
/* Engine params, one table per engine, one struct per engine.          */
/* Field order and field names are the C++ Params struct's, so applying  */
/* a preset is a copy top to bottom with nothing to line up by hand.     */
/* ------------------------------------------------------------------ */

struct PluckPresetParams {
  float damp;        /* JS damp */
  float pick_pos;    /* JS pickPos */
  float excite_type; /* JS exciteType */
  float decay;       /* JS decay, seconds */
  float level;       /* JS level */
};

/* Karplus-Strong, voiced by damping, pick position, excitation blend and
 * decay. excite_type 0 is a noise burst, 1 a bare impulse. */
inline constexpr PluckPresetParams kPluckPresetParams[] = {
    /* damp  pick_pos  excite_type  decay  level */
    {0.50f, 0.32f, 0.60f, 2.20f, 0.90f}, /* 0  nylon-guitar */
    {0.24f, 0.18f, 0.20f, 3.50f, 0.85f}, /* 1  steel-guitar */
    {0.26f, 0.16f, 0.20f, 3.20f, 0.80f}, /* 2  twelve-string */
    {0.78f, 0.12f, 0.35f, 0.35f, 0.95f}, /* 3  muted-electric */
    {0.30f, 0.14f, 0.15f, 3.00f, 0.85f}, /* 4  clean-electric */
    {0.55f, 0.25f, 0.45f, 2.20f, 0.95f}, /* 5  bass-guitar */
    {0.12f, 0.08f, 0.55f, 1.10f, 0.80f}, /* 6  banjo */
    {0.18f, 0.04f, 0.30f, 6.00f, 0.75f}, /* 7  sitar-drone */
    {0.42f, 0.42f, 0.75f, 1.80f, 0.85f}, /* 8  koto */
    {0.40f, 0.50f, 0.50f, 4.50f, 0.85f}, /* 9  harp */
    {0.30f, 0.07f, 1.00f, 0.90f, 0.90f}, /* 10 clavinet */
    {0.20f, 0.06f, 1.00f, 1.60f, 0.85f}, /* 11 harpsichord */
};

struct ModalPresetParams {
  float material;        /* JS material: 0 bar, 1 membrane, 2 bell, 3 glass, 4 wood */
  float decay;           /* JS decay, seconds, scaled by the material */
  float brightness;      /* JS brightness */
  float strike_hardness; /* JS strikeHardness */
  float level;           /* JS level */
};

/* The modal bank, voiced by material, decay and strike. woodblock's decay
 * of 2 nets about a 0.24 s ring because the wood material's own decay
 * multiplier is 0.12. */
inline constexpr ModalPresetParams kModalPresetParams[] = {
    /* material  decay  brightness  strike_hardness  level */
    {0.0f, 0.40f, 0.45f, 0.50f, 0.75f}, /* 0  marimba */
    {0.0f, 3.50f, 0.40f, 0.35f, 0.65f}, /* 1  vibraphone */
    {0.0f, 1.60f, 0.80f, 0.85f, 0.50f}, /* 2  glockenspiel */
    {2.0f, 5.00f, 0.50f, 0.70f, 0.55f}, /* 3  tubular-bells */
    {0.0f, 0.90f, 0.22f, 0.40f, 0.80f}, /* 4  kalimba */
    {2.0f, 1.10f, 0.62f, 0.45f, 0.70f}, /* 5  steel-drum */
    {4.0f, 2.00f, 0.60f, 0.90f, 0.85f}, /* 6  woodblock */
    {1.0f, 3.00f, 0.15f, 0.30f, 0.80f}, /* 7  timpani */
};

struct VaPresetParams {
  float shape;       /* JS shape: 0 saw, 3 sine */
  float detune;      /* JS detune, cents */
  float sub;         /* JS sub */
  float cutoff;      /* JS cutoff, Hz */
  float resonance;   /* JS resonance */
  float filter_type; /* JS filterType */
  float env_amount;  /* JS envAmount, octaves */
  float attack;      /* JS attack, seconds */
  float decay;       /* JS decay, seconds */
  float sustain;     /* JS sustain */
  float release;     /* JS release, seconds */
  float f_attack;    /* JS fAttack, seconds */
  float f_decay;     /* JS fDecay, seconds */
  float f_sustain;   /* JS fSustain */
  float f_release;   /* JS fRelease, seconds */
  float drift;       /* JS drift */
};

/* pan, vel_level and vel_filter exist on Va::Params and no preset sets
 * them, so ApplyPreset leaves them at the engine default, which is what
 * the JS does with a param a preset does not name.
 *
 * sub-bass names ten of the sixteen. The six it leaves out are written
 * here at the engine default rather than left implicit, because a row that
 * is only meaningful next to another file is not a row you can read. */
inline constexpr VaPresetParams kVaPresetParams[] = {
    /* shape detune  sub  cutoff  res  ftype  envAmt   a      d      s      r      fa     fd     fs     fr     drift */
    {0.0f, 9.0f, 0.20f, 3200.0f, 0.35f, 0.0f, 1.5f, 0.004f, 0.15f, 0.85f, 0.18f, 0.002f, 0.25f, 0.45f, 0.20f, 0.25f}, /* 0 analog-lead */
    {0.0f, 18.0f, 0.35f, 1600.0f, 0.12f, 0.0f, 1.0f, 0.600f, 0.40f, 0.85f, 1.10f, 0.900f, 0.50f, 0.60f, 0.80f, 0.40f}, /* 1 fat-saw-pad */
    {0.0f, 0.0f, 0.00f, 320.0f, 0.85f, 0.0f, 3.0f, 0.002f, 0.25f, 0.55f, 0.12f, 0.001f, 0.18f, 0.05f, 0.10f, 0.10f}, /* 2 acid-bass */
    {3.0f, 0.0f, 0.00f, 900.0f, 0.00f, 0.0f, 0.0f, 0.004f, 0.10f, 1.00f, 0.12f, 0.003f, 0.15f, 0.50f, 0.20f, 0.00f}, /* 3 sub-bass */
};

/* Fm::Params carries six operators. No preset uses more than four, so the
 * table stops at four and ApplyPreset leaves operators five and six at the
 * engine default, which is the default the JS falls back to for the same
 * unnamed params. fixed_hz is untouched for the same reason. */
inline constexpr int kFmPresetOps = 4;

struct FmPresetParams {
  float ops;        /* JS ops */
  float algorithm;  /* JS algorithm */
  float feedback;   /* JS feedback */
  float brightness; /* JS brightness */
  float attack;     /* JS attack, seconds */
  float decay;      /* JS decay, seconds */
  float sustain;    /* JS sustain */
  float release;    /* JS release, seconds */
  float m_attack;   /* JS mAttack, seconds */
  float m_decay;    /* JS mDecay, seconds */
  float m_sustain;  /* JS mSustain */
  float m_release;  /* JS mRelease, seconds */
  float ratio[kFmPresetOps]; /* JS ratio1 to ratio4 */
  float level[kFmPresetOps]; /* JS level1 to level4 */
};

inline constexpr FmPresetParams kFmPresetParams[] = {
    /* 0 fm-horn: serial 2-op at 1:1, moderate feedback. ratio3, ratio4,
     * level3 and level4 are unset in the JS, so they carry the ParamSpec
     * defaults (1, 1, 0.5, 0.4) and go nowhere at ops = 2. */
    {2.0f, 1.0f, 0.25f, 0.80f, 0.060f, 0.25f, 0.85f, 0.25f, 0.090f, 0.50f, 0.65f, 0.20f,
     {1.0f, 1.00f, 1.0f, 1.0f},
     {1.0f, 0.55f, 0.5f, 0.4f}},
    /* 1 dx-epiano: two carrier pairs, body at 1:1 plus a 14x tine ping */
    {4.0f, 5.0f, 0.10f, 0.90f, 0.002f, 1.40f, 0.20f, 0.35f, 0.001f, 0.30f, 0.00f, 0.20f,
     {1.0f, 1.00f, 1.0f, 14.0f},
     {1.0f, 0.40f, 0.55f, 0.10f}},
    /* 2 fm-bell-lead: near-3.5x modulator ratio for the FM bell clang */
    {2.0f, 1.0f, 0.15f, 1.00f, 0.002f, 2.00f, 0.00f, 0.60f, 0.001f, 1.10f, 0.00f, 0.50f,
     {1.0f, 3.53f, 1.0f, 1.0f},
     {1.0f, 0.45f, 0.5f, 0.4f}},
};

struct TubePresetParams {
  float breath;         /* JS breath */
  float noise;          /* JS noise */
  float level;          /* JS level */
  float glide;          /* JS glide, seconds */
  float legato_scratch; /* JS legatoScratch */
};

/* Reed tube. Both presets set legato_scratch to 0: the scratch cue is a
 * finger moving on a wound string, and these are keys. */
inline constexpr TubePresetParams kTubePresetParams[] = {
    /* breath  noise  level  glide  legato_scratch */
    {0.85f, 0.05f, 0.80f, 0.02f, 0.0f}, /* 0  clarinet */
    {0.70f, 0.12f, 0.75f, 0.02f, 0.0f}, /* 1  recorder */
};

struct FormantPresetParams {
  float vowel;         /* JS vowel, 0 to 4, morphed */
  float breath;        /* JS breath */
  float vibrato_rate;  /* JS vibratoRate, Hz */
  float vibrato_depth; /* JS vibratoDepth, semitones */
  float shape;         /* JS shape: below 0.5 saw, at or above square */
  float level;         /* JS level */
};

inline constexpr FormantPresetParams kFormantPresetParams[] = {
    /* vowel  breath  vibrato_rate  vibrato_depth  shape  level */
    {0.00f, 0.15f, 4.5f, 0.20f, 0.0f, 1.00f}, /* 0  choir-aah */
    {3.20f, 0.12f, 5.0f, 0.25f, 0.0f, 1.10f}, /* 1  voice-ooh, between o and u */
};

struct WestCoastPresetParams {
  float fold_amount; /* JS foldAmount */
  float fold_stages; /* JS foldStages */
  float fold_env;    /* JS foldEnv */
  float lpg_color;   /* JS lpgColor */
  float lpg_decay;   /* JS lpgDecay, seconds */
  float level;       /* JS level */
};

inline constexpr WestCoastPresetParams kWestCoastPresetParams[] = {
    /* fold_amount  fold_stages  fold_env  lpg_color  lpg_decay  level */
    {0.55f, 2.0f, 0.80f, 0.85f, 0.30f, 0.85f}, /* 0  west-coast-pluck */
};

/* The bowed waveguide, which the JS registers as 'string'. The C++ class
 * is Waveguide because String is a name an Arduino target already owns.
 * All 19 params are columns here: the four bowed rows name every one of
 * them, so leaving any out would only make the four rows unreadable. */
struct StringPresetParams {
  float damp;           /* JS damp */
  float sustain;        /* JS sustain */
  float dispersion;     /* JS dispersion */
  float bow;            /* JS bow */
  float bow_pressure;   /* JS bowPressure */
  float bow_speed;      /* JS bowSpeed */
  float level;          /* JS level */
  float body;           /* JS body */
  float body_size;      /* JS bodySize */
  float bow_noise;      /* JS bowNoise */
  float attack_bite;    /* JS attackBite */
  float vib_rate;       /* JS vibRate, Hz */
  float vib_depth;      /* JS vibDepth, cents */
  float vib_onset;      /* JS vibOnset, seconds */
  float bow_pos;        /* JS bowPos */
  float dynamics;       /* JS dynamics */
  float pol_detune;     /* JS polDetune, cents */
  float glide;          /* JS glide, seconds */
  float legato_scratch; /* JS legatoScratch */
};

/* body_size is the whole violin family in one number: 0 is the violin
 * body, 1 the double bass, and the wood modes slide down between them.
 * pizzicato-strings is the odd row: bow 0, so it is a plucked loop through
 * the same body bank, and the twelve params it does not name are written
 * out here at the engine default the way sub-bass's are above. */
inline constexpr StringPresetParams kStringPresetParams[] = {
    /* damp  sust  disp  bow   bowP  bowS  level body  bodyS bowN  bite  vibR  vibD  vibO  bowPos dyn   polD  glide scratch */
    {0.18f, 0.85f, 0.00f, 0.80f, 0.55f, 0.60f, 0.80f, 0.80f, 0.00f, 0.35f, 0.50f, 6.1f, 22.0f, 0.30f, 0.110f, 0.70f, 2.0f, 0.035f, 0.20f}, /* 0 violin */
    {0.28f, 0.85f, 0.00f, 0.80f, 0.60f, 0.55f, 0.80f, 0.80f, 0.18f, 0.35f, 0.45f, 5.6f, 20.0f, 0.30f, 0.115f, 0.70f, 2.0f, 0.040f, 0.20f}, /* 1 viola */
    {0.38f, 0.90f, 0.00f, 0.85f, 0.65f, 0.45f, 0.80f, 0.80f, 0.62f, 0.40f, 0.55f, 5.0f, 16.0f, 0.35f, 0.125f, 0.70f, 1.8f, 0.050f, 0.20f}, /* 2 cello */
    {0.50f, 0.90f, 0.05f, 0.85f, 0.70f, 0.35f, 0.85f, 0.70f, 1.00f, 0.45f, 0.60f, 4.5f, 10.0f, 0.40f, 0.140f, 0.70f, 1.5f, 0.060f, 0.20f}, /* 3 double-bass */
    {0.45f, 0.30f, 0.00f, 0.00f, 0.50f, 0.50f, 0.90f, 0.60f, 0.30f, 0.00f, 0.00f, 6.1f, 0.0f, 0.30f, 0.110f, 0.00f, 0.0f, 0.030f, 0.15f}, /* 4 pizzicato-strings */
};

struct HarmonicPresetParams {
  float brightness;    /* JS brightness */
  float even_odd;      /* JS evenOdd */
  float formant_shift; /* JS formantShift */
  float noise_mix;     /* JS noiseMix */
  float noise_color;   /* JS noiseColor */
  float portamento;    /* JS portamento, seconds */
  float attack;        /* JS attack, seconds */
  float release;       /* JS release, seconds */
  float level;         /* JS level */
};

/* Harmonic plus noise: the pipes are voiced by how much of the tone is
 * breath and where that breath sits, the brass by formant_shift, which
 * moves the spectral peak that makes a trumpet a trumpet. No preset names
 * portamento, so the column is the engine default of 0 on every row. */
inline constexpr HarmonicPresetParams kHarmonicPresetParams[] = {
    /* brightness  even_odd  formant_shift  noise_mix  noise_color  portamento  attack  release  level */
    {0.32f, 0.5f, 1.0f, 0.18f, 4.0f, 0.0f, 0.06f, 0.20f, 0.85f}, /* 0  concert-flute */
    {0.25f, 0.5f, 1.0f, 0.35f, 3.0f, 0.0f, 0.05f, 0.15f, 0.85f}, /* 1  pan-flute */
    {0.08f, 0.5f, 1.0f, 0.10f, 1.0f, 0.0f, 0.04f, 0.12f, 0.90f}, /* 2  ocarina */
    {0.35f, 0.5f, 1.0f, 0.40f, 2.5f, 0.0f, 0.09f, 0.30f, 0.85f}, /* 3  shakuhachi */
    {0.72f, 0.5f, 1.8f, 0.04f, 2.0f, 0.0f, 0.04f, 0.15f, 0.80f}, /* 4  trumpet */
    {0.55f, 0.5f, 0.9f, 0.05f, 2.0f, 0.0f, 0.07f, 0.20f, 0.85f}, /* 5  trombone */
    {0.62f, 0.5f, 1.4f, 0.06f, 2.0f, 0.0f, 0.09f, 0.25f, 0.85f}, /* 6  brass-section */
};

/*
 * Additive is the one engine whose params are mostly an array. Additive
 * ::Params carries partial[32], target[32] and detune[32] on top of seven
 * scalars, which is 103 JS param names and would be 384 bytes a row.
 *
 * Two facts cut that down. Every preset builds its spectrum with the JS
 * partials() helper, which sets partialN and targetN to the same value,
 * so one column serves both. And the longest list any preset gives is
 * church-organ's twelve, so a row carries twelve levels and ApplyPreset
 * writes zero from there to whatever kMaxPartials the destination has.
 * The zeroing is not an optimisation: partials() explicitly writes 0 out
 * to 32, because an unnamed additive partial defaults to a sawtooth's 1/n
 * and a sparse spectrum has to say so. detune is 0 on every preset, and
 * morph is named by none, so neither is a column and both keep the engine
 * default.
 */
inline constexpr int kAdditivePresetPartials = 12;

struct AdditivePresetParams {
  float inharm;                          /* JS inharm */
  float decay;                           /* JS decay, seconds */
  float rolloff;                         /* JS rolloff */
  float attack;                          /* JS attack, seconds */
  float release;                         /* JS release, seconds */
  float gain;                            /* JS gain, the engine's own output param */
  float partial[kAdditivePresetPartials]; /* JS partial1..12, and target1..12 */
};

/* decay 20 with an organ's rolloff of 1 is what "sustained while held"
 * looks like on an engine whose partials always decay. */
inline constexpr AdditivePresetParams kAdditivePresetParams[] = {
    /* 0 drawbar-organ: drawbar footages, fully sustained while held */
    {0.000f, 20.0f, 1.00f, 0.004f, 0.08f, 1.0f,
     {1.0f, 0.85f, 0.65f, 0.50f, 0.18f, 0.40f, 0.08f, 0.30f, 0.0f, 0.00f, 0.0f, 0.00f}},
    /* 1 church-organ: principal chorus with octave and mutation ranks */
    {0.000f, 20.0f, 1.00f, 0.040f, 0.30f, 1.0f,
     {1.0f, 0.75f, 0.40f, 0.60f, 0.15f, 0.35f, 0.08f, 0.30f, 0.0f, 0.12f, 0.0f, 0.18f}},
    /* 2 celesta */
    {0.001f, 1.8f, 0.55f, 0.001f, 0.40f, 1.0f,
     {1.0f, 0.20f, 0.05f, 0.12f, 0.00f, 0.00f, 0.00f, 0.00f, 0.0f, 0.00f, 0.0f, 0.00f}},
    /* 3 music-box: sparse stretched partials, tiny tine ping */
    {0.004f, 1.3f, 0.45f, 0.001f, 0.30f, 1.0f,
     {1.0f, 0.00f, 0.50f, 0.00f, 0.22f, 0.00f, 0.10f, 0.00f, 0.0f, 0.00f, 0.0f, 0.00f}},
    /* 4 whistle: a single sustained sine */
    {0.000f, 20.0f, 1.00f, 0.040f, 0.12f, 0.9f,
     {1.0f, 0.00f, 0.00f, 0.00f, 0.00f, 0.00f, 0.00f, 0.00f, 0.0f, 0.00f, 0.0f, 0.00f}},
};

struct WavetablePresetParams {
  float position;        /* JS position */
  float scan_rate;       /* JS scanRate, Hz */
  float scan_depth;      /* JS scanDepth */
  float env_to_position; /* JS envToPosition */
  float attack;          /* JS attack, seconds */
  float decay;           /* JS decay, seconds */
  float sustain;         /* JS sustain */
  float release;         /* JS release, seconds */
  float filter;          /* JS filter: a switch, in circuit at 0.5 and up */
  float cutoff;          /* JS cutoff, Hz */
  float resonance;       /* JS resonance */
};

/* pan is on Wavetable::Params, no preset names it, so it keeps the engine
 * default of centre. */
inline constexpr WavetablePresetParams kWavetablePresetParams[] = {
    /* position  scan_rate  scan_depth  env_to_position  a     d     s     r     filter cutoff  res */
    {0.25f, 0.20f, 0.35f, 0.25f, 0.70f, 0.40f, 0.85f, 1.20f, 1.0f, 3800.0f, 0.15f}, /* 0 motion-pad */
};

/* ------------------------------------------------------------------ */
/* Insert effects                                                       */
/* ------------------------------------------------------------------ */

struct ChorusPresetParams {
  float rate;     /* JS rate, Hz */
  float depth;    /* JS depth */
  float mix;      /* JS mix */
  float feedback; /* JS feedback */
};

inline constexpr ChorusPresetParams kChorusPresetParams[] = {
    /* rate  depth  mix   feedback */
    {0.80f, 0.35f, 0.55f, 0.0f}, /* 0  twelve-string, the octave course */
    {0.50f, 0.30f, 0.40f, 0.0f}, /* 1  brass-section, the ensemble spread */
    {0.70f, 0.30f, 0.30f, 0.0f}, /* 2  dx-epiano */
    {0.40f, 0.45f, 0.50f, 0.0f}, /* 3  choir-aah */
};

/* Tremolo::Params also has shape and phase. Both presets that use tremolo
 * ask for shape 0 (sine) and phase 0, which is the engine default, so
 * there is no column for either. */
struct TremoloPresetParams {
  float rate;  /* JS rate, Hz */
  float depth; /* JS depth */
};

inline constexpr TremoloPresetParams kTremoloPresetParams[] = {
    /* rate  depth */
    {4.50f, 0.40f}, /* 0  vibraphone, the motor */
};

/* PlateExt::Params also has damping, bandwidth and mod_depth. No string
 * preset names any of the three, so there is no column for them and they
 * keep the engine default. decay 0.42 measures about a 1.4 s RT60, which
 * is the room the violin family is asked to sit in rather than a reverb
 * anyone is meant to hear. */
struct PlatePresetParams {
  float decay;    /* JS decay */
  float predelay; /* JS predelay, seconds */
  float mix;      /* JS mix */
};

inline constexpr PlatePresetParams kPlatePresetParams[] = {
    /* decay  predelay  mix */
    {0.42f, 0.020f, 0.14f}, /* 0  violin */
    {0.42f, 0.020f, 0.14f}, /* 1  viola */
    {0.42f, 0.025f, 0.15f}, /* 2  cello */
    {0.42f, 0.025f, 0.12f}, /* 3  double-bass */
};

/* What survives of the JS tapeDelay, which has no port. wow 0.06,
 * flutter 0.08, saturation 0.3, tone 5500 and hiss 0 have nowhere to go:
 * StereoDelayExt is a clean delay. There is no ApplyPreset for this
 * struct, because writing three of eight params into a different effect
 * and calling it the preset would be the silent substitution this table
 * exists to avoid. */
struct TapeDelayPresetParams {
  float time;     /* JS time, seconds */
  float feedback; /* JS feedback */
  float mix;      /* JS mix */
};

inline constexpr TapeDelayPresetParams kTapeDelayPresetParams[] = {
    /* time  feedback  mix */
    {0.115f, 0.12f, 0.22f}, /* 0  clean-electric, one slap-back */
};

/* ------------------------------------------------------------------ */
/* The index                                                            */
/* ------------------------------------------------------------------ */

/*
 * One preset. Everything engine specific is behind `engine` and `slot`:
 * slot is the row in that engine's param table, not a row here.
 *
 * 20 bytes on a 32 bit target, 50 rows, so the index measures 1000 bytes
 * plus 1061 of id and label strings. A sketch that never calls FindPreset
 * or reads the array pays for none of it.
 */
struct InstrumentPreset {
  const char* id;    /* kebab-case, 'nylon-guitar' */
  const char* label; /* display, 'NYLON GUITAR' */
  InstrumentFamily family;
  PresetEngine engine;
  uint8_t slot;    /* row in the engine's param table */
  PresetFx fx;     /* insert effect, kFxNone for most */
  uint8_t fx_slot; /* row in that effect's param table, 0 when kFxNone */
  int8_t octave;   /* suggested keyboard shift, octaves */
  float gain;      /* channel trim; the JS default of 0.8 is written out */
};

/* In the order the JS declares them, which is family order. */
inline constexpr InstrumentPreset kInstrumentPresets[] = {
    /* id, label, family, engine, slot, fx, fx_slot, octave, gain */
    {"nylon-guitar", "NYLON GUITAR", kFamilyGuitars, kEnginePluck, 0, kFxNone, 0, 0, 0.85f},
    {"steel-guitar", "STEEL GUITAR", kFamilyGuitars, kEnginePluck, 1, kFxNone, 0, 0, 0.80f},
    {"twelve-string", "TWELVE STRING", kFamilyGuitars, kEnginePluck, 2, kFxChorus, 0, 0, 0.80f},
    {"muted-electric", "MUTED ELECTRIC", kFamilyGuitars, kEnginePluck, 3, kFxNone, 0, 0, 0.90f},
    {"clean-electric", "CLEAN ELECTRIC", kFamilyGuitars, kEnginePluck, 4, kFxTapeDelay, 0, 0, 0.80f},
    {"bass-guitar", "BASS GUITAR", kFamilyGuitars, kEnginePluck, 5, kFxNone, 0, -2, 0.90f},
    {"banjo", "BANJO", kFamilyGuitars, kEnginePluck, 6, kFxNone, 0, 0, 0.80f},
    {"sitar-drone", "SITAR DRONE", kFamilyGuitars, kEnginePluck, 7, kFxNone, 0, 0, 0.80f},
    {"koto", "KOTO", kFamilyGuitars, kEnginePluck, 8, kFxNone, 0, 0, 0.80f},
    {"harp", "HARP", kFamilyGuitars, kEnginePluck, 9, kFxNone, 0, 0, 0.80f},
    {"clavinet", "CLAVINET", kFamilyGuitars, kEnginePluck, 10, kFxNone, 0, 0, 0.80f},

    {"violin", "VIOLIN", kFamilyStrings, kEngineString, 0, kFxPlate, 0, 0, 0.94f},
    {"viola", "VIOLA", kFamilyStrings, kEngineString, 1, kFxPlate, 1, 0, 1.00f},
    {"cello", "CELLO", kFamilyStrings, kEngineString, 2, kFxPlate, 2, -1, 0.94f},
    {"double-bass", "DOUBLE BASS", kFamilyStrings, kEngineString, 3, kFxPlate, 3, -2, 0.66f},
    {"pizzicato-strings", "PIZZICATO STRINGS", kFamilyStrings, kEngineString, 4, kFxNone, 0, 0, 1.00f},

    {"concert-flute", "CONCERT FLUTE", kFamilyWinds, kEngineHarmonic, 0, kFxNone, 0, 1, 0.80f},
    {"pan-flute", "PAN FLUTE", kFamilyWinds, kEngineHarmonic, 1, kFxNone, 0, 1, 0.80f},
    {"clarinet", "CLARINET", kFamilyWinds, kEngineTube, 0, kFxNone, 0, 0, 0.80f},
    {"recorder", "RECORDER", kFamilyWinds, kEngineTube, 1, kFxNone, 0, 1, 0.80f},
    {"ocarina", "OCARINA", kFamilyWinds, kEngineHarmonic, 2, kFxNone, 0, 1, 0.80f},
    {"shakuhachi", "SHAKUHACHI", kFamilyWinds, kEngineHarmonic, 3, kFxNone, 0, 0, 0.80f},

    {"trumpet", "TRUMPET", kFamilyBrass, kEngineHarmonic, 4, kFxNone, 0, 0, 0.80f},
    {"trombone", "TROMBONE", kFamilyBrass, kEngineHarmonic, 5, kFxNone, 0, -1, 0.80f},
    {"brass-section", "BRASS SECTION", kFamilyBrass, kEngineHarmonic, 6, kFxChorus, 1, 0, 0.80f},
    {"fm-horn", "FM HORN", kFamilyBrass, kEngineFm, 0, kFxNone, 0, 0, 0.80f},

    {"dx-epiano", "DX E-PIANO", kFamilyKeys, kEngineFm, 1, kFxChorus, 2, 0, 0.80f},
    {"drawbar-organ", "DRAWBAR ORGAN", kFamilyKeys, kEngineAdditive, 0, kFxNone, 0, 0, 0.80f},
    {"church-organ", "CHURCH ORGAN", kFamilyKeys, kEngineAdditive, 1, kFxNone, 0, 0, 0.80f},
    {"harpsichord", "HARPSICHORD", kFamilyKeys, kEnginePluck, 11, kFxNone, 0, 0, 0.80f},
    {"celesta", "CELESTA", kFamilyKeys, kEngineAdditive, 2, kFxNone, 0, 1, 0.80f},
    {"music-box", "MUSIC BOX", kFamilyKeys, kEngineAdditive, 3, kFxNone, 0, 2, 0.80f},

    {"marimba", "MARIMBA", kFamilyMallets, kEngineModal, 0, kFxNone, 0, 0, 0.80f},
    {"vibraphone", "VIBRAPHONE", kFamilyMallets, kEngineModal, 1, kFxTremolo, 0, 0, 0.80f},
    {"glockenspiel", "GLOCKENSPIEL", kFamilyMallets, kEngineModal, 2, kFxNone, 0, 2, 0.80f},
    {"tubular-bells", "TUBULAR BELLS", kFamilyMallets, kEngineModal, 3, kFxNone, 0, 0, 0.80f},
    {"kalimba", "KALIMBA", kFamilyMallets, kEngineModal, 4, kFxNone, 0, 0, 0.80f},
    {"steel-drum", "STEEL DRUM", kFamilyMallets, kEngineModal, 5, kFxNone, 0, 0, 0.80f},
    {"woodblock", "WOODBLOCK", kFamilyMallets, kEngineModal, 6, kFxNone, 0, 0, 0.80f},
    {"timpani", "TIMPANI", kFamilyMallets, kEngineModal, 7, kFxNone, 0, -2, 0.80f},

    {"choir-aah", "CHOIR AAH", kFamilyVoices, kEngineFormant, 0, kFxChorus, 3, 0, 0.80f},
    {"voice-ooh", "VOICE OOH", kFamilyVoices, kEngineFormant, 1, kFxNone, 0, 0, 0.80f},
    {"whistle", "WHISTLE", kFamilyVoices, kEngineAdditive, 4, kFxNone, 0, 2, 0.80f},

    {"analog-lead", "ANALOG LEAD", kFamilySynth, kEngineVa, 0, kFxNone, 0, 0, 0.80f},
    {"fat-saw-pad", "FAT SAW PAD", kFamilySynth, kEngineVa, 1, kFxNone, 0, 0, 0.75f},
    {"acid-bass", "ACID BASS", kFamilySynth, kEngineVa, 2, kFxNone, 0, -1, 0.80f},
    {"sub-bass", "SUB BASS", kFamilySynth, kEngineVa, 3, kFxNone, 0, -2, 0.95f},
    {"west-coast-pluck", "WEST COAST PLUCK", kFamilySynth, kEngineWestCoast, 0, kFxNone, 0, 0, 0.80f},
    {"motion-pad", "MOTION PAD", kFamilySynth, kEngineWavetable, 0, kFxNone, 0, 0, 0.75f},
    {"fm-bell-lead", "FM BELL LEAD", kFamilySynth, kEngineFm, 2, kFxNone, 0, 0, 0.80f},
};

inline constexpr int kInstrumentPresetCount =
    static_cast<int>(sizeof(kInstrumentPresets) / sizeof(kInstrumentPresets[0]));

/* How many presets each engine's param table holds. Index order is
 * PresetEngine order. */
inline constexpr int kEnginePresetCount[kPresetEngineCount] = {
    static_cast<int>(sizeof(kPluckPresetParams) / sizeof(kPluckPresetParams[0])),
    static_cast<int>(sizeof(kModalPresetParams) / sizeof(kModalPresetParams[0])),
    static_cast<int>(sizeof(kVaPresetParams) / sizeof(kVaPresetParams[0])),
    static_cast<int>(sizeof(kFmPresetParams) / sizeof(kFmPresetParams[0])),
    static_cast<int>(sizeof(kTubePresetParams) / sizeof(kTubePresetParams[0])),
    static_cast<int>(sizeof(kFormantPresetParams) / sizeof(kFormantPresetParams[0])),
    static_cast<int>(sizeof(kWestCoastPresetParams) / sizeof(kWestCoastPresetParams[0])),
    static_cast<int>(sizeof(kStringPresetParams) / sizeof(kStringPresetParams[0])),
    static_cast<int>(sizeof(kHarmonicPresetParams) / sizeof(kHarmonicPresetParams[0])),
    static_cast<int>(sizeof(kAdditivePresetParams) / sizeof(kAdditivePresetParams[0])),
    static_cast<int>(sizeof(kWavetablePresetParams) / sizeof(kWavetablePresetParams[0])),
};

/*
 * The one thing a split table can get wrong is the slot, and a wrong slot
 * plays the wrong preset without any other symptom. So the slots are not
 * free numbers: the nth preset of an engine, in index order, must carry
 * slot n, and the count must land exactly on the end of that engine's
 * table. Both are checked here, at compile time, for nothing at runtime.
 */
constexpr bool PresetSlotsAreSequential() {
  int next[kPresetEngineCount] = {};
  for (int i = 0; i < kInstrumentPresetCount; ++i) {
    const int e = static_cast<int>(kInstrumentPresets[i].engine);
    if (e < 0 || e >= kPresetEngineCount) return false;
    if (kInstrumentPresets[i].slot != next[e]) return false;
    ++next[e];
  }
  for (int e = 0; e < kPresetEngineCount; ++e) {
    if (next[e] != kEnginePresetCount[e]) return false;
  }
  return true;
}

static_assert(PresetSlotsAreSequential(),
              "a preset slot does not match its engine's param table");

/* The same check for the insert effect tables, which are small enough to
 * get wrong by hand and have no other reader. Adding brass-section's
 * chorus in family order pushed dx-epiano and choir-aah down a slot each,
 * which is exactly the edit this catches. */
constexpr bool PresetFxSlotsAreValid() {
  const int chorus = static_cast<int>(sizeof(kChorusPresetParams) / sizeof(kChorusPresetParams[0]));
  const int trem = static_cast<int>(sizeof(kTremoloPresetParams) / sizeof(kTremoloPresetParams[0]));
  const int tape =
      static_cast<int>(sizeof(kTapeDelayPresetParams) / sizeof(kTapeDelayPresetParams[0]));
  const int plate = static_cast<int>(sizeof(kPlatePresetParams) / sizeof(kPlatePresetParams[0]));
  int n_chorus = 0, n_trem = 0, n_tape = 0, n_plate = 0;
  for (int i = 0; i < kInstrumentPresetCount; ++i) {
    const InstrumentPreset& p = kInstrumentPresets[i];
    switch (p.fx) {
      case kFxNone:
        if (p.fx_slot != 0) return false;
        break;
      case kFxChorus:
        if (p.fx_slot != n_chorus++) return false;
        break;
      case kFxTremolo:
        if (p.fx_slot != n_trem++) return false;
        break;
      case kFxTapeDelay:
        if (p.fx_slot != n_tape++) return false;
        break;
      case kFxPlate:
        if (p.fx_slot != n_plate++) return false;
        break;
    }
  }
  return n_chorus == chorus && n_trem == trem && n_tape == tape && n_plate == plate;
}

static_assert(PresetFxSlotsAreValid(), "a preset fx slot does not match its fx param table");

/* ------------------------------------------------------------------ */
/* Lookup                                                               */
/* ------------------------------------------------------------------ */

namespace preset_detail {

/* Local rather than theory/notes.h's detail::StrEq, so this header keeps
 * its promise of including nothing. Six lines is cheaper than a
 * dependency, and defining bellows::detail::StrEq a second time would be a
 * redefinition in any translation unit that has both. */
inline bool IdEq(const char* a, const char* b) {
  if (a == nullptr || b == nullptr) return false;
  while (*a != '\0' && *a == *b) {
    ++a;
    ++b;
  }
  return *a == *b;
}

}  // namespace preset_detail

/* Index of a preset by id, or -1. A linear scan of 50 rows: a sorted table
 * plus a binary search would turn 25 string compares on average into 6, on
 * a call that happens when a knob moves, and cost the guarantee that the
 * table reads in family order. */
inline int FindPresetIndex(const char* id) {
  if (id == nullptr) return -1;
  for (int i = 0; i < kInstrumentPresetCount; ++i) {
    if (preset_detail::IdEq(id, kInstrumentPresets[i].id)) return i;
  }
  return -1;
}

/* Preset by id, or nullptr. Where the JS throws, this returns nullptr:
 * there is nothing on a board to catch a throw. */
inline const InstrumentPreset* FindPreset(const char* id) {
  const int i = FindPresetIndex(id);
  return i < 0 ? nullptr : &kInstrumentPresets[i];
}

/* Preset by index, or nullptr when out of range. */
inline const InstrumentPreset* PresetAt(int i) {
  return (i < 0 || i >= kInstrumentPresetCount) ? nullptr : &kInstrumentPresets[i];
}

/* How many presets a family has. Every family has at least three, so a 0
 * from this means the argument was not a family. */
inline int PresetsInFamily(InstrumentFamily family) {
  int n = 0;
  for (int i = 0; i < kInstrumentPresetCount; ++i) {
    if (kInstrumentPresets[i].family == family) ++n;
  }
  return n;
}

/* Pointers to a family's presets, in table order. Writes at most cap and
 * returns how many, the same shape as DiatonicTriads in theory/chords.h. */
inline int PresetsInFamily(InstrumentFamily family, const InstrumentPreset** out, int cap) {
  if (out == nullptr || cap <= 0) return 0;
  int n = 0;
  for (int i = 0; i < kInstrumentPresetCount && n < cap; ++i) {
    if (kInstrumentPresets[i].family == family) out[n++] = &kInstrumentPresets[i];
  }
  return n;
}

/* The nth preset of a family, or nullptr. */
inline const InstrumentPreset* PresetInFamily(InstrumentFamily family, int n) {
  if (n < 0) return nullptr;
  for (int i = 0; i < kInstrumentPresetCount; ++i) {
    if (kInstrumentPresets[i].family == family && n-- == 0) return &kInstrumentPresets[i];
  }
  return nullptr;
}

/* ------------------------------------------------------------------ */
/* Params for a preset                                                  */
/*                                                                      */
/* One accessor per engine, returning nullptr when the preset belongs to */
/* a different engine. Calling one is what references that engine's      */
/* table, and is the only thing that does, so a sketch that asks only    */
/* for pluck params links only the pluck table.                          */
/* ------------------------------------------------------------------ */

inline const PluckPresetParams* PluckParamsOf(const InstrumentPreset& p) {
  return p.engine == kEnginePluck ? &kPluckPresetParams[p.slot] : nullptr;
}

inline const ModalPresetParams* ModalParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineModal ? &kModalPresetParams[p.slot] : nullptr;
}

inline const VaPresetParams* VaParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineVa ? &kVaPresetParams[p.slot] : nullptr;
}

inline const FmPresetParams* FmParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineFm ? &kFmPresetParams[p.slot] : nullptr;
}

inline const TubePresetParams* TubeParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineTube ? &kTubePresetParams[p.slot] : nullptr;
}

inline const FormantPresetParams* FormantParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineFormant ? &kFormantPresetParams[p.slot] : nullptr;
}

inline const WestCoastPresetParams* WestCoastParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineWestCoast ? &kWestCoastPresetParams[p.slot] : nullptr;
}

inline const StringPresetParams* StringParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineString ? &kStringPresetParams[p.slot] : nullptr;
}

inline const HarmonicPresetParams* HarmonicParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineHarmonic ? &kHarmonicPresetParams[p.slot] : nullptr;
}

inline const AdditivePresetParams* AdditiveParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineAdditive ? &kAdditivePresetParams[p.slot] : nullptr;
}

inline const WavetablePresetParams* WavetableParamsOf(const InstrumentPreset& p) {
  return p.engine == kEngineWavetable ? &kWavetablePresetParams[p.slot] : nullptr;
}

inline const ChorusPresetParams* ChorusParamsOf(const InstrumentPreset& p) {
  return p.fx == kFxChorus ? &kChorusPresetParams[p.fx_slot] : nullptr;
}

inline const TremoloPresetParams* TremoloParamsOf(const InstrumentPreset& p) {
  return p.fx == kFxTremolo ? &kTremoloPresetParams[p.fx_slot] : nullptr;
}

inline const PlatePresetParams* PlateParamsOf(const InstrumentPreset& p) {
  return p.fx == kFxPlate ? &kPlatePresetParams[p.fx_slot] : nullptr;
}

inline const TapeDelayPresetParams* TapeDelayParamsOf(const InstrumentPreset& p) {
  return p.fx == kFxTapeDelay ? &kTapeDelayPresetParams[p.fx_slot] : nullptr;
}

/* ------------------------------------------------------------------ */
/* Applying                                                             */
/*                                                                      */
/* The destination is a template parameter, never a named type, so this   */
/* header still includes no engine. Pass Pluck<110>::Params and the      */
/* field names are checked against that instantiation; pass anything     */
/* without a `damp` and it does not compile.                            */
/*                                                                      */
/* Fields a preset never names are not written, so they keep the         */
/* engine's own default. That is the JS rule ("params not named fall     */
/* back to the engine defaults") and the reason these take a pointer to  */
/* a default constructed Params rather than returning one.               */
/* ------------------------------------------------------------------ */

template <class P>
inline void ApplyPreset(const PluckPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->damp = src.damp;
  dst->pick_pos = src.pick_pos;
  dst->excite_type = src.excite_type;
  dst->decay = src.decay;
  dst->level = src.level;
}

template <class P>
inline void ApplyPreset(const ModalPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->material = src.material;
  dst->decay = src.decay;
  dst->brightness = src.brightness;
  dst->strike_hardness = src.strike_hardness;
  dst->level = src.level;
}

template <class P>
inline void ApplyPreset(const VaPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->shape = src.shape;
  dst->detune = src.detune;
  dst->sub = src.sub;
  dst->cutoff = src.cutoff;
  dst->resonance = src.resonance;
  dst->filter_type = src.filter_type;
  dst->env_amount = src.env_amount;
  dst->attack = src.attack;
  dst->decay = src.decay;
  dst->sustain = src.sustain;
  dst->release = src.release;
  dst->f_attack = src.f_attack;
  dst->f_decay = src.f_decay;
  dst->f_sustain = src.f_sustain;
  dst->f_release = src.f_release;
  dst->drift = src.drift;
  /* pan, vel_level and vel_filter: no preset names them. */
}

template <class P>
inline void ApplyPreset(const FmPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->ops = src.ops;
  dst->algorithm = src.algorithm;
  dst->feedback = src.feedback;
  dst->brightness = src.brightness;
  dst->attack = src.attack;
  dst->decay = src.decay;
  dst->sustain = src.sustain;
  dst->release = src.release;
  dst->m_attack = src.m_attack;
  dst->m_decay = src.m_decay;
  dst->m_sustain = src.m_sustain;
  dst->m_release = src.m_release;
  for (int i = 0; i < kFmPresetOps; ++i) {
    dst->ratio[i] = src.ratio[i];
    dst->level[i] = src.level[i];
  }
  /* Operators 5 and 6 and every fixed_hz keep the engine default. */
}

template <class P>
inline void ApplyPreset(const TubePresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->breath = src.breath;
  dst->noise = src.noise;
  dst->level = src.level;
  dst->glide = src.glide;
  dst->legato_scratch = src.legato_scratch;
}

template <class P>
inline void ApplyPreset(const FormantPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->vowel = src.vowel;
  dst->breath = src.breath;
  dst->vibrato_rate = src.vibrato_rate;
  dst->vibrato_depth = src.vibrato_depth;
  dst->shape = src.shape;
  dst->level = src.level;
}

template <class P>
inline void ApplyPreset(const WestCoastPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->fold_amount = src.fold_amount;
  dst->fold_stages = src.fold_stages;
  dst->fold_env = src.fold_env;
  dst->lpg_color = src.lpg_color;
  dst->lpg_decay = src.lpg_decay;
  dst->level = src.level;
}

template <class P>
inline void ApplyPreset(const StringPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->damp = src.damp;
  dst->sustain = src.sustain;
  dst->dispersion = src.dispersion;
  dst->bow = src.bow;
  dst->bow_pressure = src.bow_pressure;
  dst->bow_speed = src.bow_speed;
  dst->level = src.level;
  dst->body = src.body;
  dst->body_size = src.body_size;
  dst->bow_noise = src.bow_noise;
  dst->attack_bite = src.attack_bite;
  dst->vib_rate = src.vib_rate;
  dst->vib_depth = src.vib_depth;
  dst->vib_onset = src.vib_onset;
  dst->bow_pos = src.bow_pos;
  dst->dynamics = src.dynamics;
  dst->pol_detune = src.pol_detune;
  dst->glide = src.glide;
  dst->legato_scratch = src.legato_scratch;
}

template <class P>
inline void ApplyPreset(const HarmonicPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->brightness = src.brightness;
  dst->even_odd = src.even_odd;
  dst->formant_shift = src.formant_shift;
  dst->noise_mix = src.noise_mix;
  dst->noise_color = src.noise_color;
  dst->portamento = src.portamento;
  dst->attack = src.attack;
  dst->release = src.release;
  dst->level = src.level;
}

/*
 * Additive. The loop runs to the DESTINATION's partial count, taken from
 * the array it was handed rather than assumed to be 32, and writes zero
 * past the twelve the table carries. Stopping at twelve instead would
 * leave partials 13 and up at Additive::Params' default, which is a
 * sawtooth's 1/n, and every organ here would come out with a spectrum it
 * never asked for. morph and detune[] keep the engine default.
 */
/*
 * Element count of an array, and it will not compile for a pointer.
 *
 * The obvious sizeof(x) / sizeof(x[0]) is correct here and silently wrong the
 * day a destination type holds a pointer instead of an array: it computes 2 on
 * a 64-bit host and 1 on the board, and the loop below would then fill two of
 * thirty-two partials with no diagnostic. Deducing the bound makes that a
 * compile error rather than a quiet half-empty spectrum.
 */
template <class T, int N>
constexpr int CountOf(T (&)[N]) {
  return N;
}

template <class P>
inline void ApplyPreset(const AdditivePresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->inharm = src.inharm;
  dst->decay = src.decay;
  dst->rolloff = src.rolloff;
  dst->attack = src.attack;
  dst->release = src.release;
  dst->gain = src.gain;
  const int n = CountOf(dst->partial);
  for (int i = 0; i < n; ++i) {
    const float v = i < kAdditivePresetPartials ? src.partial[i] : 0.0f;
    dst->partial[i] = v;
    dst->target[i] = v;
  }
}

template <class P>
inline void ApplyPreset(const WavetablePresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->position = src.position;
  dst->scan_rate = src.scan_rate;
  dst->scan_depth = src.scan_depth;
  dst->env_to_position = src.env_to_position;
  dst->attack = src.attack;
  dst->decay = src.decay;
  dst->sustain = src.sustain;
  dst->release = src.release;
  dst->filter = src.filter;
  dst->cutoff = src.cutoff;
  dst->resonance = src.resonance;
  /* pan: no preset names it. */
}

template <class P>
inline void ApplyPreset(const ChorusPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->rate = src.rate;
  dst->depth = src.depth;
  dst->mix = src.mix;
  dst->feedback = src.feedback;
}

template <class P>
inline void ApplyPreset(const TremoloPresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->rate = src.rate;
  dst->depth = src.depth;
  /* shape and phase stay at the engine default, sine at phase 0. */
}

template <class P>
inline void ApplyPreset(const PlatePresetParams& src, P* dst) {
  if (dst == nullptr) return;
  dst->decay = src.decay;
  dst->predelay = src.predelay;
  dst->mix = src.mix;
  /* damping, bandwidth and mod_depth stay at the engine default. */
}

/* ------------------------------------------------------------------ */
/* Names. Everything below costs string bytes; nothing above refers to   */
/* it, so a sketch that plays presets by index links no characters at    */
/* all beyond the ids and labels it prints.                              */
/* ------------------------------------------------------------------ */

inline constexpr const char* const kFamilyNames[kFamilyCount] = {
    "guitars", "strings", "winds", "brass", "keys", "mallets", "voices", "synth",
};

inline const char* FamilyName(InstrumentFamily f) {
  return f < kFamilyCount ? kFamilyNames[f] : "?";
}

/* These are the JS engine ids, so 'string' rather than the C++ class name
 * Waveguide. The port's own name for a unit is not what a preset means. */
inline constexpr const char* const kPresetEngineNames[kPresetEngineCount] = {
    "pluck",     "modal",  "va",       "fm",       "tube", "formant",
    "westcoast", "string", "harmonic", "additive", "wavetable",
};

inline const char* PresetEngineName(PresetEngine e) {
  return e < kPresetEngineCount ? kPresetEngineNames[e] : "?";
}

inline bool FamilyFromName(const char* name, InstrumentFamily* out) {
  if (name == nullptr || out == nullptr) return false;
  for (int i = 0; i < kFamilyCount; ++i) {
    if (preset_detail::IdEq(name, kFamilyNames[i])) {
      *out = static_cast<InstrumentFamily>(i);
      return true;
    }
  }
  return false;
}

}  // namespace bellows
