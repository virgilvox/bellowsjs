/* Generated from the ParamSpec arrays in packages/bellows. Do not edit.
 *
 * This file exists for parity, not for the audio path. The TypeScript
 * library is the single source of truth for every param name, range and
 * default; the C++ port copies them by hand into each class's nested
 * struct Params. Nothing here is meant to be included by an engine.
 * Regenerate after any ParamSpec change (node tools/gen-tables.mjs): if a
 * param was added, renamed or re-defaulted in TypeScript and the C++ side
 * was not updated, it shows up in this diff. tools/gen-tables.mjs --check
 * fails when the committed copy is stale, so CI catches the omission, and
 * tools/check-params.mjs reads the c++ field column back out and fails when
 * a copied default no longer equals the number above it, so the copy is
 * checked by a machine and not by whoever happens to read the diff.
 *
 * Param names are comments, never data. A string table of param names
 * would put every name of every unit in flash and invite a string keyed
 * lookup, which is exactly what the port exists to avoid. Only the
 * defaults are emitted as constants, so a caller can seed a Params
 * struct or a preset from the same numbers the JS uses. */
#pragma once

namespace bellows {
namespace params {
/* va: Virtual Analog
 * bellows/engines/va.h class Va, 19 params.
 *   name        min  max    default  c++ field    unit
 *   shape       0    3      0        shape
 *   detune      0    100    7        detune       cents
 *   sub         0    1      0        sub
 *   cutoff      20   20000  9000     cutoff       Hz
 *   resonance   0    1      0.2      resonance
 *   filterType  0    1      0        filter_type
 *   envAmount   -6   6      0        env_amount   oct
 *   attack      0    10     0.005    attack       s
 *   decay       0    10     0.1      decay        s
 *   sustain     0    1      0.8      sustain
 *   release     0    10     0.2      release      s
 *   fAttack     0    10     0.003    f_attack     s
 *   fDecay      0    10     0.15     f_decay      s
 *   fSustain    0    1      0.5      f_sustain
 *   fRelease    0    10     0.2      f_release    s
 *   drift       0    1      0        drift
 *   pan         -1   1      0        pan
 *   velLevel    0    1      0.5      vel_level
 *   velFilter   0    4      0        vel_filter   oct
 */
inline constexpr int kEngineVaParamCount = 19;
inline constexpr float kEngineVaDefaults[kEngineVaParamCount] = {
  0.0f, 7.0f, 0.0f, 9000.0f, 0.2f, 0.0f, 0.0f, 0.005f,
  0.1f, 0.8f, 0.2f, 0.003f, 0.15f, 0.5f, 0.2f, 0.0f,
  0.0f, 0.5f, 0.0f
};

/* fm: FM
 * bellows/engines/fm.h class Fm, 30 params.
 *   name        min  max    default  c++ field   unit
 *   ops         2    6      4        ops
 *   algorithm   1    8      1        algorithm
 *   feedback    0    1      0        feedback
 *   brightness  0    2      0.5      brightness
 *   attack      0    10     0.003    attack      s
 *   decay       0    10     0.3      decay       s
 *   sustain     0    1      0.7      sustain
 *   release     0    10     0.3      release     s
 *   mAttack     0    10     0.002    m_attack    s
 *   mDecay      0    10     0.4      m_decay     s
 *   mSustain    0    1      0.5      m_sustain
 *   mRelease    0    10     0.2      m_release   s
 *   ratio1      0    16     1        ratio[]
 *   level1      0    1      1        level[]
 *   fixed1      0    10000  0        -           Hz
 *   ratio2      0    16     1        ratio[]
 *   level2      0    1      0.6      level[]
 *   fixed2      0    10000  0        -           Hz
 *   ratio3      0    16     1        ratio[]
 *   level3      0    1      0.5      level[]
 *   fixed3      0    10000  0        -           Hz
 *   ratio4      0    16     1        ratio[]
 *   level4      0    1      0.4      level[]
 *   fixed4      0    10000  0        -           Hz
 *   ratio5      0    16     1        ratio[]
 *   level5      0    1      0.4      level[]
 *   fixed5      0    10000  0        -           Hz
 *   ratio6      0    16     1        ratio[]
 *   level6      0    1      0.3      level[]
 *   fixed6      0    10000  0        -           Hz
 *
 * No C++ field of that name: fixed1, fixed2, fixed3, fixed4, fixed5, fixed6
 * C++ fields with no ParamSpec: fixed_hz
 */
inline constexpr int kEngineFmParamCount = 30;
inline constexpr float kEngineFmDefaults[kEngineFmParamCount] = {
  4.0f, 1.0f, 0.0f, 0.5f, 0.003f, 0.3f, 0.7f, 0.3f,
  0.002f, 0.4f, 0.5f, 0.2f, 1.0f, 1.0f, 0.0f, 1.0f,
  0.6f, 0.0f, 1.0f, 0.5f, 0.0f, 1.0f, 0.4f, 0.0f,
  1.0f, 0.4f, 0.0f, 1.0f, 0.3f, 0.0f
};

/* additive: Additive
 * bellows/engines/additive.h class Additive, 103 params.
 *   name       min   max   default               c++ field  unit
 *   morph      0     1     0                     morph
 *   inharm     0     0.02  0                     inharm
 *   decay      0.01  20    2                     decay      s
 *   rolloff    0.3   1     0.8                   rolloff
 *   attack     0     10    0.002                 attack     s
 *   release    0     10    0.3                   release    s
 *   gain       0     2     1                     gain
 *   partial1   0     1     1                     partial[]
 *   target1    0     1     1                     target[]
 *   detune1    -100  100   0                     detune[]   cents
 *   partial2   0     1     0.5                   partial[]
 *   target2    0     1     0                     target[]
 *   detune2    -100  100   0                     detune[]   cents
 *   partial3   0     1     0.3333333333333333    partial[]
 *   target3    0     1     0                     target[]
 *   detune3    -100  100   0                     detune[]   cents
 *   partial4   0     1     0.25                  partial[]
 *   target4    0     1     0                     target[]
 *   detune4    -100  100   0                     detune[]   cents
 *   partial5   0     1     0.2                   partial[]
 *   target5    0     1     0                     target[]
 *   detune5    -100  100   0                     detune[]   cents
 *   partial6   0     1     0.16666666666666666   partial[]
 *   target6    0     1     0                     target[]
 *   detune6    -100  100   0                     detune[]   cents
 *   partial7   0     1     0.14285714285714285   partial[]
 *   target7    0     1     0                     target[]
 *   detune7    -100  100   0                     detune[]   cents
 *   partial8   0     1     0.125                 partial[]
 *   target8    0     1     0                     target[]
 *   detune8    -100  100   0                     detune[]   cents
 *   partial9   0     1     0.1111111111111111    partial[]
 *   target9    0     1     0                     target[]
 *   detune9    -100  100   0                     detune[]   cents
 *   partial10  0     1     0.1                   partial[]
 *   target10   0     1     0                     target[]
 *   detune10   -100  100   0                     detune[]   cents
 *   partial11  0     1     0.09090909090909091   partial[]
 *   target11   0     1     0                     target[]
 *   detune11   -100  100   0                     detune[]   cents
 *   partial12  0     1     0.08333333333333333   partial[]
 *   target12   0     1     0                     target[]
 *   detune12   -100  100   0                     detune[]   cents
 *   partial13  0     1     0.07692307692307693   partial[]
 *   target13   0     1     0                     target[]
 *   detune13   -100  100   0                     detune[]   cents
 *   partial14  0     1     0.07142857142857142   partial[]
 *   target14   0     1     0                     target[]
 *   detune14   -100  100   0                     detune[]   cents
 *   partial15  0     1     0.06666666666666667   partial[]
 *   target15   0     1     0                     target[]
 *   detune15   -100  100   0                     detune[]   cents
 *   partial16  0     1     0.0625                partial[]
 *   target16   0     1     0                     target[]
 *   detune16   -100  100   0                     detune[]   cents
 *   partial17  0     1     0.058823529411764705  partial[]
 *   target17   0     1     0                     target[]
 *   detune17   -100  100   0                     detune[]   cents
 *   partial18  0     1     0.05555555555555555   partial[]
 *   target18   0     1     0                     target[]
 *   detune18   -100  100   0                     detune[]   cents
 *   partial19  0     1     0.05263157894736842   partial[]
 *   target19   0     1     0                     target[]
 *   detune19   -100  100   0                     detune[]   cents
 *   partial20  0     1     0.05                  partial[]
 *   target20   0     1     0                     target[]
 *   detune20   -100  100   0                     detune[]   cents
 *   partial21  0     1     0.047619047619047616  partial[]
 *   target21   0     1     0                     target[]
 *   detune21   -100  100   0                     detune[]   cents
 *   partial22  0     1     0.045454545454545456  partial[]
 *   target22   0     1     0                     target[]
 *   detune22   -100  100   0                     detune[]   cents
 *   partial23  0     1     0.043478260869565216  partial[]
 *   target23   0     1     0                     target[]
 *   detune23   -100  100   0                     detune[]   cents
 *   partial24  0     1     0.041666666666666664  partial[]
 *   target24   0     1     0                     target[]
 *   detune24   -100  100   0                     detune[]   cents
 *   partial25  0     1     0.04                  partial[]
 *   target25   0     1     0                     target[]
 *   detune25   -100  100   0                     detune[]   cents
 *   partial26  0     1     0.038461538461538464  partial[]
 *   target26   0     1     0                     target[]
 *   detune26   -100  100   0                     detune[]   cents
 *   partial27  0     1     0.037037037037037035  partial[]
 *   target27   0     1     0                     target[]
 *   detune27   -100  100   0                     detune[]   cents
 *   partial28  0     1     0.03571428571428571   partial[]
 *   target28   0     1     0                     target[]
 *   detune28   -100  100   0                     detune[]   cents
 *   partial29  0     1     0.034482758620689655  partial[]
 *   target29   0     1     0                     target[]
 *   detune29   -100  100   0                     detune[]   cents
 *   partial30  0     1     0.03333333333333333   partial[]
 *   target30   0     1     0                     target[]
 *   detune30   -100  100   0                     detune[]   cents
 *   partial31  0     1     0.03225806451612903   partial[]
 *   target31   0     1     0                     target[]
 *   detune31   -100  100   0                     detune[]   cents
 *   partial32  0     1     0.03125               partial[]
 *   target32   0     1     0                     target[]
 *   detune32   -100  100   0                     detune[]   cents
 *
 * C++ fields with no ParamSpec: Params, target, detune
 */
inline constexpr int kEngineAdditiveParamCount = 103;
inline constexpr float kEngineAdditiveDefaults[kEngineAdditiveParamCount] = {
  0.0f, 0.0f, 2.0f, 0.8f, 0.002f, 0.3f, 1.0f, 1.0f,
  1.0f, 0.0f, 0.5f, 0.0f, 0.0f, 0.3333333333333333f, 0.0f, 0.0f,
  0.25f, 0.0f, 0.0f, 0.2f, 0.0f, 0.0f, 0.16666666666666666f, 0.0f,
  0.0f, 0.14285714285714285f, 0.0f, 0.0f, 0.125f, 0.0f, 0.0f, 0.1111111111111111f,
  0.0f, 0.0f, 0.1f, 0.0f, 0.0f, 0.09090909090909091f, 0.0f, 0.0f,
  0.08333333333333333f, 0.0f, 0.0f, 0.07692307692307693f, 0.0f, 0.0f, 0.07142857142857142f, 0.0f,
  0.0f, 0.06666666666666667f, 0.0f, 0.0f, 0.0625f, 0.0f, 0.0f, 0.058823529411764705f,
  0.0f, 0.0f, 0.05555555555555555f, 0.0f, 0.0f, 0.05263157894736842f, 0.0f, 0.0f,
  0.05f, 0.0f, 0.0f, 0.047619047619047616f, 0.0f, 0.0f, 0.045454545454545456f, 0.0f,
  0.0f, 0.043478260869565216f, 0.0f, 0.0f, 0.041666666666666664f, 0.0f, 0.0f, 0.04f,
  0.0f, 0.0f, 0.038461538461538464f, 0.0f, 0.0f, 0.037037037037037035f, 0.0f, 0.0f,
  0.03571428571428571f, 0.0f, 0.0f, 0.034482758620689655f, 0.0f, 0.0f, 0.03333333333333333f, 0.0f,
  0.0f, 0.03225806451612903f, 0.0f, 0.0f, 0.03125f, 0.0f, 0.0f
};

/* wavetable: Wavetable
 * bellows/engines/wavetable.h class Wavetable, 12 params.
 *   name           min  max    default  c++ field        unit
 *   position       0    1      0        position
 *   scanRate       0    20     0.5      scan_rate        Hz
 *   scanDepth      0    1      0        scan_depth
 *   envToPosition  -1   1      0        env_to_position
 *   attack         0    10     0.005    attack           s
 *   decay          0    10     0.1      decay            s
 *   sustain        0    1      0.8      sustain
 *   release        0    10     0.2      release          s
 *   filter         0    1      0        filter
 *   cutoff         20   20000  8000     cutoff           Hz
 *   resonance      0    1      0.1      resonance
 *   pan            -1   1      0        pan
 */
inline constexpr int kEngineWavetableParamCount = 12;
inline constexpr float kEngineWavetableDefaults[kEngineWavetableParamCount] = {
  0.0f, 0.5f, 0.0f, 0.0f, 0.005f, 0.1f, 0.8f, 0.2f,
  0.0f, 8000.0f, 0.1f, 0.0f
};

/* kick: Kick
 * bellows/engines/drums.h class Kick, 4 params.
 *   name        min    max  default  c++ field    unit
 *   clickTune   1      16   6        click_tune
 *   pitchDecay  0.005  0.5  0.05     pitch_decay  s
 *   decay       0.05   2    0.4      decay        s
 *   drive       0      10   2        drive
 */
inline constexpr int kEngineKickParamCount = 4;
inline constexpr float kEngineKickDefaults[kEngineKickParamCount] = {
  6.0f, 0.05f, 0.4f, 2.0f
};

/* snare: Snare
 * bellows/engines/drums.h class Snare, 3 params.
 *   name   min   max  default  c++ field  unit
 *   tone   0     1    0.5      tone
 *   decay  0.05  1    0.18     decay      s
 *   snap   0.02  1    0.15     snap       s
 */
inline constexpr int kEngineSnareParamCount = 3;
inline constexpr float kEngineSnareDefaults[kEngineSnareParamCount] = {
  0.5f, 0.18f, 0.15f
};

/* hat: Hat
 * bellows/engines/drums.h class Hat, 2 params.
 *   name   min   max  default  c++ field  unit
 *   decay  0.02  2    0.08     decay      s
 *   tone   0.2   2    1        tone
 */
inline constexpr int kEngineHatParamCount = 2;
inline constexpr float kEngineHatDefaults[kEngineHatParamCount] = {
  0.08f, 1.0f
};

/* pluck: Pluck
 * bellows/engines/pluck.h class Pluck, 5 params.
 *   name        min   max   default  c++ field    unit
 *   damp        0     1     0.35     damp
 *   pickPos     0     0.95  0.28     pick_pos
 *   exciteType  0     1     0        excite_type
 *   decay       0.05  20    2.5      decay        s
 *   level       0     1     0.9      level
 */
inline constexpr int kEnginePluckParamCount = 5;
inline constexpr float kEnginePluckDefaults[kEnginePluckParamCount] = {
  0.35f, 0.28f, 0.0f, 2.5f, 0.9f
};

/* string: Waveguide String
 * bellows/engines/waveguide.h class Waveguide, 19 params.
 *   name           min   max  default  c++ field       unit
 *   damp           0     1    0.35     damp
 *   sustain        0     1    0.6      sustain
 *   dispersion     0     1    0        dispersion
 *   bow            0     1    0        bow
 *   bowPressure    0     1    0.5      bow_pressure
 *   bowSpeed       0     1    0.5      bow_speed
 *   level          0     1    0.9      level
 *   body           0     1    0        body
 *   bodySize       0     1    0        body_size
 *   bowNoise       0     1    0        bow_noise
 *   attackBite     0     1    0        attack_bite
 *   vibRate        3     9    6.1      vib_rate        Hz
 *   vibDepth       0     50   0        vib_depth       cents
 *   vibOnset       0     1    0.3      vib_onset       s
 *   bowPos         0.06  0.2  0.11     bow_pos
 *   dynamics       0     1    0        dynamics
 *   polDetune      0     5    0        pol_detune      cents
 *   glide          0     0.5  0.03     glide           s
 *   legatoScratch  0     1    0.15     legato_scratch
 */
inline constexpr int kEngineStringParamCount = 19;
inline constexpr float kEngineStringDefaults[kEngineStringParamCount] = {
  0.35f, 0.6f, 0.0f, 0.0f, 0.5f, 0.5f, 0.9f, 0.0f,
  0.0f, 0.0f, 0.0f, 6.1f, 0.0f, 0.3f, 0.11f, 0.0f,
  0.0f, 0.03f, 0.15f
};

/* tube: Waveguide Tube
 * bellows/engines/tube.h class Tube, 5 params.
 *   name           min  max  default  c++ field       unit
 *   breath         0    1    0.85     breath
 *   noise          0    1    0.1      noise
 *   level          0    1    0.7      level
 *   glide          0    0.5  0.03     glide           s
 *   legatoScratch  0    1    0.15     legato_scratch
 */
inline constexpr int kEngineTubeParamCount = 5;
inline constexpr float kEngineTubeDefaults[kEngineTubeParamCount] = {
  0.85f, 0.1f, 0.7f, 0.03f, 0.15f
};

/* modal: Modal
 * bellows/engines/modal.h class Modal, 5 params.
 *   name            min   max  default  c++ field        unit
 *   material        0     4    0        material
 *   decay           0.05  30   2        decay            s
 *   brightness      0     1    0.5      brightness
 *   strikeHardness  0     1    0.6      strike_hardness
 *   level           0     1    0.6      level
 */
inline constexpr int kEngineModalParamCount = 5;
inline constexpr float kEngineModalDefaults[kEngineModalParamCount] = {
  0.0f, 2.0f, 0.5f, 0.6f, 0.6f
};

/* westcoast: West Coast
 * bellows/engines/westcoast.h class WestCoast, 6 params.
 *   name        min   max  default  c++ field    unit
 *   foldAmount  0     1    0.35     fold_amount
 *   foldStages  1     6    2        fold_stages
 *   foldEnv     0     1    0.5      fold_env
 *   lpgColor    0     1    0.7      lpg_color
 *   lpgDecay    0.02  5    0.5      lpg_decay    s
 *   level       0     1    0.8      level
 */
inline constexpr int kEngineWestcoastParamCount = 6;
inline constexpr float kEngineWestcoastDefaults[kEngineWestcoastParamCount] = {
  0.35f, 2.0f, 0.5f, 0.7f, 0.5f, 0.8f
};

/* formant: Formant
 * bellows/engines/formant.h class Formant, 6 params.
 *   name          min  max  default  c++ field      unit
 *   vowel         0    4    0        vowel
 *   breath        0    1    0.1      breath
 *   vibratoRate   0    12   5        vibrato_rate   Hz
 *   vibratoDepth  0    2    0.25     vibrato_depth  st
 *   shape         0    1    0        shape
 *   level         0    2    1        level
 */
inline constexpr int kEngineFormantParamCount = 6;
inline constexpr float kEngineFormantDefaults[kEngineFormantParamCount] = {
  0.0f, 0.1f, 5.0f, 0.25f, 0.0f, 1.0f
};

/* harmonic: Harmonic plus Noise
 * bellows/engines/harmonic.h class Harmonic, 9 params.
 *   name          min    max  default  c++ field      unit
 *   brightness    0      1    0.5      brightness
 *   evenOdd       0      1    0.5      even_odd
 *   formantShift  0.25   4    1        formant_shift
 *   noiseMix      0      1    0.1      noise_mix
 *   noiseColor    0.25   16   2        noise_color
 *   portamento    0      4    0        portamento     s
 *   attack        0.001  4    0.01     attack         s
 *   release       0.01   8    0.3      release        s
 *   level         0      1    0.8      level
 */
inline constexpr int kEngineHarmonicParamCount = 9;
inline constexpr float kEngineHarmonicDefaults[kEngineHarmonicParamCount] = {
  0.5f, 0.5f, 1.0f, 0.1f, 2.0f, 0.0f, 0.01f, 0.3f,
  0.8f
};

/* delay: Stereo Delay
 * bellows/fx/delay.h class StereoDelayExt, 6 params.
 *   name           min    max    default  c++ field       unit
 *   timeL          0.001  4      0.35     time_l          s
 *   timeR          0.001  4      0.5      time_r          s
 *   feedback       0      0.99   0.4      feedback
 *   crossFeedback  0      1      0        cross_feedback
 *   damping        200    20000  8000     damping         Hz
 *   mix            0      1      0.35     mix
 */
inline constexpr int kEffectDelayParamCount = 6;
inline constexpr float kEffectDelayDefaults[kEffectDelayParamCount] = {
  0.35f, 0.5f, 0.4f, 0.0f, 8000.0f, 0.35f
};

/* plate: Plate Reverb
 * bellows/fx/plate.h class PlateExt, 6 params.
 *   name       min  max   default  c++ field  unit
 *   decay      0    0.98  0.5      decay
 *   damping    0    0.99  0.3      damping
 *   bandwidth  0    1     0.9995   bandwidth
 *   predelay   0    0.25  0        predelay   s
 *   modDepth   0    2     1        mod_depth
 *   mix        0    1     0.35     mix
 */
inline constexpr int kEffectPlateParamCount = 6;
inline constexpr float kEffectPlateDefaults[kEffectPlateParamCount] = {
  0.5f, 0.3f, 0.9995f, 0.0f, 1.0f, 0.35f
};

/* compressor: Compressor
 * bellows/fx/dynamics.h class Compressor, 8 params.
 *   name       min     max   default  c++ field  unit
 *   threshold  -60     0     -18      -          dB
 *   ratio      1       20    4        ratio
 *   knee       0       24    6        -          dB
 *   attack     0.0001  0.5   0.01     attack     s
 *   release    0.01    2     0.2      release    s
 *   makeup     -1      24    0        -          dB
 *   lookahead  0       0.01  0        lookahead  s
 *   mix        0       1     1        mix
 *
 * No C++ field of that name: threshold, knee, makeup
 * C++ fields with no ParamSpec: threshold_db, knee_db, makeup_db
 */
inline constexpr int kEffectCompressorParamCount = 8;
inline constexpr float kEffectCompressorDefaults[kEffectCompressorParamCount] = {
  -18.0f, 4.0f, 6.0f, 0.01f, 0.2f, 0.0f, 0.0f, 1.0f
};

/* limiter: Limiter
 * bellows/fx/dynamics.h class Limiter, 3 params.
 *   name      min    max  default  c++ field  unit
 *   ceiling   -24    0    -0.3     -          dB
 *   release   0.001  1    0.05     release    s
 *   truePeak  0      1    0        -
 *
 * No C++ field of that name: ceiling, truePeak
 * C++ fields with no ParamSpec: ceiling_db
 */
inline constexpr int kEffectLimiterParamCount = 3;
inline constexpr float kEffectLimiterDefaults[kEffectLimiterParamCount] = {
  -0.3f, 0.05f, 0.0f
};

/* gate: Gate
 * bellows/fx/dynamics.h class Gate, 5 params.
 *   name       min     max  default  c++ field  unit
 *   threshold  -80     0    -40      -          dB
 *   attack     0.0001  0.1  0.001    attack     s
 *   hold       0       1    0.05     hold       s
 *   release    0.001   2    0.1      release    s
 *   range      -80     0    -60      -          dB
 *
 * No C++ field of that name: threshold, range
 * C++ fields with no ParamSpec: threshold_db, range_db
 */
inline constexpr int kEffectGateParamCount = 5;
inline constexpr float kEffectGateDefaults[kEffectGateParamCount] = {
  -40.0f, 0.001f, 0.05f, 0.1f, -60.0f
};

/* chorus: Chorus
 * bellows/fx/modfx.h class Chorus, 4 params.
 *   name      min   max  default  c++ field  unit
 *   rate      0.01  10   0.5      rate       Hz
 *   depth     0     1    0.5      depth
 *   mix       0     1    0.5      mix
 *   feedback  0     0.5  0        feedback
 */
inline constexpr int kEffectChorusParamCount = 4;
inline constexpr float kEffectChorusDefaults[kEffectChorusParamCount] = {
  0.5f, 0.5f, 0.5f, 0.0f
};

/* flanger: Flanger
 * bellows/fx/modfx.h class Flanger, 6 params.
 *   name      min   max  default  c++ field  unit
 *   rate      0.01  10   0.25     rate       Hz
 *   depth     0     1    0.7      depth
 *   manual    0     1    0.25     manual
 *   feedback  0     0.9  0.4      feedback
 *   mix       0     1    0.5      mix
 *   invert    0     1    0        invert
 */
inline constexpr int kEffectFlangerParamCount = 6;
inline constexpr float kEffectFlangerDefaults[kEffectFlangerParamCount] = {
  0.25f, 0.7f, 0.25f, 0.4f, 0.5f, 0.0f
};

/* tremolo: Tremolo
 * bellows/fx/modfx.h class Tremolo, 4 params.
 *   name   min   max  default  c++ field  unit
 *   rate   0.05  40   4        rate       Hz
 *   depth  0     1    0.8      depth
 *   shape  0     4    0        shape
 *   phase  0     1    0        phase
 */
inline constexpr int kEffectTremoloParamCount = 4;
inline constexpr float kEffectTremoloDefaults[kEffectTremoloParamCount] = {
  4.0f, 0.8f, 0.0f, 0.0f
};

/* autopan: Autopan
 * bellows/fx/modfx.h class AutoPan, 3 params.
 *   name   min   max  default  c++ field  unit
 *   rate   0.05  20   1        rate       Hz
 *   depth  0     1    1        depth
 *   shape  0     4    0        shape
 */
inline constexpr int kEffectAutopanParamCount = 3;
inline constexpr float kEffectAutopanDefaults[kEffectAutopanParamCount] = {
  1.0f, 1.0f, 0.0f
};

/* ringmod: Ring Mod
 * bellows/fx/modfx.h class RingMod, 2 params.
 *   name  min  max   default  c++ field  unit
 *   freq  1    8000  440      freq       Hz
 *   mix   0    1     1        mix
 */
inline constexpr int kEffectRingmodParamCount = 2;
inline constexpr float kEffectRingmodDefaults[kEffectRingmodParamCount] = {
  440.0f, 1.0f
};

/* eq: Parametric EQ
 * bellows/fx/eq.h class Eq6, 24 params.
 *   name       min  max    default  c++ field  unit
 *   b0freq     20   20000  80       -          Hz
 *   b0gain     -24  24     0        -          dB
 *   b0q        0.1  12     0.707    -
 *   b0enabled  0    1      1        -
 *   b1freq     20   20000  250      -          Hz
 *   b1gain     -24  24     0        -          dB
 *   b1q        0.1  12     1        -
 *   b1enabled  0    1      1        -
 *   b2freq     20   20000  800      -          Hz
 *   b2gain     -24  24     0        -          dB
 *   b2q        0.1  12     1        -
 *   b2enabled  0    1      1        -
 *   b3freq     20   20000  2500     -          Hz
 *   b3gain     -24  24     0        -          dB
 *   b3q        0.1  12     1        -
 *   b3enabled  0    1      1        -
 *   b4freq     20   20000  6000     -          Hz
 *   b4gain     -24  24     0        -          dB
 *   b4q        0.1  12     1        -
 *   b4enabled  0    1      1        -
 *   b5freq     20   20000  12000    -          Hz
 *   b5gain     -24  24     0        -          dB
 *   b5q        0.1  12     0.707    -
 *   b5enabled  0    1      1        -
 *
 * No C++ field of that name: b0freq, b0gain, b0q, b0enabled, b1freq, b1gain, b1q, b1enabled, b2freq, b2gain, b2q, b2enabled, b3freq, b3gain, b3q, b3enabled, b4freq, b4gain, b4q, b4enabled, b5freq, b5gain, b5q, b5enabled
 * C++ fields with no ParamSpec: band
 */
inline constexpr int kEffectEqParamCount = 24;
inline constexpr float kEffectEqDefaults[kEffectEqParamCount] = {
  80.0f, 0.0f, 0.707f, 1.0f, 250.0f, 0.0f, 1.0f, 1.0f,
  800.0f, 0.0f, 1.0f, 1.0f, 2500.0f, 0.0f, 1.0f, 1.0f,
  6000.0f, 0.0f, 1.0f, 1.0f, 12000.0f, 0.0f, 0.707f, 1.0f
};

/* saturator: Saturator
 * bellows/fx/saturator.h class Saturator, 5 params.
 *   name    min  max  default  c++ field  unit
 *   drive   0.1  20   2        drive
 *   curve   0    3    0        curve
 *   tone    -1   1    0        tone
 *   output  -24  24   0        -          dB
 *   mix     0    1    1        mix
 *
 * No C++ field of that name: output
 * C++ fields with no ParamSpec: output_db
 */
inline constexpr int kEffectSaturatorParamCount = 5;
inline constexpr float kEffectSaturatorDefaults[kEffectSaturatorParamCount] = {
  2.0f, 0.0f, 0.0f, 0.0f, 1.0f
};

/* Not ported to C++ yet, listed so the gap stays visible:
 *   engines: clap, tom, noise, granular
 *   effects: tapeDelay, multitap, fdn, transient, phaser, freqshift, pitchshift, freeze, blur, robot, whisper, denoise
 */

}  // namespace params
}  // namespace bellows
