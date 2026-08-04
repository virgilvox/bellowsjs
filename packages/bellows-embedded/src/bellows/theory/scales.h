/* Transcription of src/theory/scales.ts. Thirty-four scales and the
 * rooted Scale class.
 *
 * Intervals are semitone offsets from the root inside one octave, always
 * starting at 0 and strictly increasing. In the JS the table is a record
 * keyed by name; here it is an enum plus one flat array of steps with an
 * offset table, because a name-keyed table would force the strings into
 * every sketch that touches a scale. Sizes: the step data is 232 bytes,
 * the offset table 35, and the name table another 300 or so of pointers
 * and characters.
 *
 * That last number is why the names live in their own clearly marked
 * section at the bottom with nothing else depending on them. It is rule 7
 * applied to data rather than code: a sequencer that walks
 * kScaleDorian never links a single character of "ukrainian dorian",
 * while a sketch with a display and a scale menu opts into the whole
 * table by calling ScaleName once. Same header, two independent chunks of
 * .rodata, sorted out by -fdata-sections and --gc-sections.
 *
 * Scale itself holds no storage beyond a pointer into flash, a length, a
 * root, and a 12-bit membership mask, so it is 12 bytes and free to copy
 * around or keep several of. Nothing here allocates or touches audio. */
#pragma once
#include <stdint.h>

#include "bellows/theory/notes.h"

namespace bellows {

enum ScaleType : uint8_t {
  /* church modes */
  kScaleMajor = 0,
  kScaleIonian,
  kScaleDorian,
  kScalePhrygian,
  kScaleLydian,
  kScaleMixolydian,
  kScaleMinor,
  kScaleAeolian,
  kScaleLocrian,
  /* harmonic minor and its useful modes */
  kScaleHarmonicMinor,
  kScalePhrygianDominant,
  kScaleUkrainianDorian,
  /* melodic minor and its useful modes */
  kScaleMelodicMinor,
  kScaleLydianDominant,
  kScaleAltered,
  /* pentatonic and blues */
  kScaleMajorPentatonic,
  kScaleMinorPentatonic,
  kScaleBlues,
  /* bebop */
  kScaleBebopDominant,
  kScaleBebopMajor,
  /* symmetric */
  kScaleWholeTone,
  kScaleOctatonicHalfWhole,
  kScaleOctatonicWholeHalf,
  kScaleChromatic,
  /* Japanese pentatonics */
  kScaleHirajoshi,
  kScaleInSen,
  kScaleIwato,
  kScaleKumoi,
  /* others */
  kScaleDoubleHarmonic,
  kScaleHungarianMinor,
  kScaleNeapolitanMajor,
  kScaleNeapolitanMinor,
  kScalePrometheus,
  kScaleEnigmatic,

  kScaleCount
};

/* Every scale's steps end to end, in ScaleType order. */
inline constexpr uint8_t kScaleSteps[] = {
    0, 2, 4, 5, 7, 9, 11,             /* major */
    0, 2, 4, 5, 7, 9, 11,             /* ionian */
    0, 2, 3, 5, 7, 9, 10,             /* dorian */
    0, 1, 3, 5, 7, 8, 10,             /* phrygian */
    0, 2, 4, 6, 7, 9, 11,             /* lydian */
    0, 2, 4, 5, 7, 9, 10,             /* mixolydian */
    0, 2, 3, 5, 7, 8, 10,             /* minor */
    0, 2, 3, 5, 7, 8, 10,             /* aeolian */
    0, 1, 3, 5, 6, 8, 10,             /* locrian */
    0, 2, 3, 5, 7, 8, 11,             /* harmonic minor */
    0, 1, 4, 5, 7, 8, 10,             /* phrygian dominant */
    0, 2, 3, 6, 7, 9, 10,             /* ukrainian dorian */
    0, 2, 3, 5, 7, 9, 11,             /* melodic minor */
    0, 2, 4, 6, 7, 9, 10,             /* lydian dominant */
    0, 1, 3, 4, 6, 8, 10,             /* altered */
    0, 2, 4, 7, 9,                    /* major pentatonic */
    0, 3, 5, 7, 10,                   /* minor pentatonic */
    0, 3, 5, 6, 7, 10,                /* blues */
    0, 2, 4, 5, 7, 9, 10, 11,         /* bebop dominant */
    0, 2, 4, 5, 7, 8, 9, 11,          /* bebop major */
    0, 2, 4, 6, 8, 10,                /* whole tone */
    0, 1, 3, 4, 6, 7, 9, 10,          /* octatonic half-whole */
    0, 2, 3, 5, 6, 8, 9, 11,          /* octatonic whole-half */
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, /* chromatic */
    0, 2, 3, 7, 8,                    /* hirajoshi */
    0, 1, 5, 7, 10,                   /* in-sen */
    0, 1, 5, 6, 10,                   /* iwato */
    0, 2, 3, 7, 9,                    /* kumoi */
    0, 1, 4, 5, 7, 8, 11,             /* double harmonic */
    0, 2, 3, 6, 7, 8, 11,             /* hungarian minor */
    0, 1, 3, 5, 7, 9, 11,             /* neapolitan major */
    0, 1, 3, 5, 7, 8, 11,             /* neapolitan minor */
    0, 2, 4, 6, 9, 10,                /* prometheus */
    0, 1, 4, 6, 8, 10, 11,            /* enigmatic */
};

/* Start of each scale in kScaleSteps, with a terminating entry so the
 * length of scale s is kScaleOffset[s + 1] - kScaleOffset[s]. */
inline constexpr uint8_t kScaleOffset[kScaleCount + 1] = {
    0,   7,   14,  21,  28,  35,  42,  49,  56,  63,  70,  77,
    84,  91,  98,  105, 110, 115, 121, 129, 137, 143, 151, 159,
    171, 176, 181, 186, 191, 198, 205, 212, 219, 225, 232,
};

static_assert(kScaleOffset[kScaleCount] == sizeof(kScaleSteps) / sizeof(kScaleSteps[0]),
              "scale offset table does not match the step table");

inline constexpr const uint8_t* ScaleSteps(ScaleType t) { return kScaleSteps + kScaleOffset[t]; }
inline constexpr int ScaleLength(ScaleType t) { return kScaleOffset[t + 1] - kScaleOffset[t]; }

/*
 * A rooted scale.
 *
 * The root is a pitch class 0..11, or a MIDI note of 12 and up which also
 * sets the default octave (matching the JS, where a number below 12 is
 * read as a pitch class and defaults to octave 4). InitFromName takes the
 * string forms, "F#" or "C4".
 */
class Scale {
 public:
  Scale() { Init(0, kScaleMajor); }

  void Init(int root, ScaleType type) {
    root_pc_ = static_cast<uint8_t>(Mod12(root));
    default_octave_ = static_cast<int8_t>((root >= 12 || root < 0) ? OctaveOf(root) : 4);
    SetType(type);
  }

  /* Root from a name: "F#" keeps octave 4, "C4" or "Db-1" sets it.
   * Returns false and leaves the scale untouched on a parse failure,
   * which is how a bad string reports itself with no exceptions. */
  bool InitFromName(const char* root, ScaleType type) {
    if (HasOctave(root)) {
      const int midi = ParseNote(root);
      if (midi == kNoteInvalid) return false;
      Init(Mod12(midi), type);
      default_octave_ = static_cast<int8_t>(OctaveOf(midi));
      return true;
    }
    const int pc = ParsePitchClass(root);
    if (pc < 0) return false;
    Init(pc, type);
    return true;
  }

  /* Swap the scale keeping the root and octave, the cheap way to run a
   * modal interchange. */
  void SetType(ScaleType type) {
    type_ = type;
    steps_ = ScaleSteps(type);
    len_ = static_cast<uint8_t>(ScaleLength(type));
    mask_ = 0;
    for (int i = 0; i < len_; ++i) mask_ |= static_cast<uint16_t>(1u << Mod12(steps_[i]));
  }

  int RootPc() const { return root_pc_; }
  ScaleType Type() const { return type_; }
  int Length() const { return len_; }
  int DefaultOctave() const { return default_octave_; }
  const uint8_t* Intervals() const { return steps_; }
  int Interval(int i) const { return steps_[i]; }

  /* MIDI note for a scale degree. Degree 0 is the root; degrees wrap into
   * neighbouring octaves, so degree -1 is the top of the octave below and
   * degree Length() is the root an octave up. */
  int DegreeToMidi(int degree, int octave) const {
    const int n = len_;
    const int wrap = FloorDiv(degree, n);
    const int idx = degree - wrap * n;
    return (octave + 1) * 12 + root_pc_ + steps_[idx] + wrap * 12;
  }

  int DegreeToMidi(int degree) const { return DegreeToMidi(degree, default_octave_); }

  /* True when the note's pitch class belongs to the scale. */
  bool Contains(int midi) const {
    return ((mask_ >> Mod12(midi - root_pc_)) & 1u) != 0u;
  }

  /* Nearest scale tone to a MIDI note. Ties resolve downward. */
  int Quantize(int midi) const {
    if (Contains(midi)) return midi;
    for (int d = 1; d <= 6; ++d) {
      if (Contains(midi - d)) return midi - d;
      if (Contains(midi + d)) return midi + d;
    }
    return midi;
  }

  /* Fill out with every degree over a span of octaves, ascending from the
   * base octave. Writes at most cap notes and returns how many. The JS
   * returns a fresh array; here the caller owns the storage, as with every
   * other buffer in this library. */
  int Degrees(int octaves, int* out, int cap, int base_octave) const {
    if (out == nullptr || cap <= 0) return 0;
    int count = octaves * len_;
    if (count > cap) count = cap;
    if (count < 0) count = 0;
    for (int i = 0; i < count; ++i) out[i] = DegreeToMidi(i, base_octave);
    return count;
  }

  int Degrees(int octaves, int* out, int cap) const {
    return Degrees(octaves, out, cap, default_octave_);
  }

 private:
  const uint8_t* steps_ = kScaleSteps;
  uint16_t mask_ = 0;
  uint8_t root_pc_ = 0;
  uint8_t len_ = 7;
  ScaleType type_ = kScaleMajor;
  int8_t default_octave_ = 4;
};

/* ------------------------------------------------------------------ */
/* Names. This is the only part of the header that costs string bytes;  */
/* nothing above refers to it, so it links only if you call one of      */
/* these two functions. Keep it that way when adding scales.            */
/* ------------------------------------------------------------------ */

inline constexpr const char* const kScaleNames[kScaleCount] = {
    "major",
    "ionian",
    "dorian",
    "phrygian",
    "lydian",
    "mixolydian",
    "minor",
    "aeolian",
    "locrian",
    "harmonic minor",
    "phrygian dominant",
    "ukrainian dorian",
    "melodic minor",
    "lydian dominant",
    "altered",
    "major pentatonic",
    "minor pentatonic",
    "blues",
    "bebop dominant",
    "bebop major",
    "whole tone",
    "octatonic half-whole",
    "octatonic whole-half",
    "chromatic",
    "hirajoshi",
    "in-sen",
    "iwato",
    "kumoi",
    "double harmonic",
    "hungarian minor",
    "neapolitan major",
    "neapolitan minor",
    "prometheus",
    "enigmatic",
};

inline const char* ScaleName(ScaleType t) {
  return t < kScaleCount ? kScaleNames[t] : "";
}

/* Look a scale up by the same string the JS uses as its record key.
 * Returns false when nothing matches, leaving *out alone. */
inline bool ScaleFromName(const char* name, ScaleType* out) {
  if (name == nullptr || out == nullptr) return false;
  for (int i = 0; i < kScaleCount; ++i) {
    if (detail::StrEq(name, kScaleNames[i])) {
      *out = static_cast<ScaleType>(i);
      return true;
    }
  }
  return false;
}

}  // namespace bellows
