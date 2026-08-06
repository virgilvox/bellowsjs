/* Transcription of src/theory/chords.ts. Chord types, chord building,
 * diatonic harmony, roman numerals, symbol parsing, and detection.
 *
 * The twenty-five interval sets are a flat table with an offset index, the
 * same shape as the scale table and for the same reason: a record keyed by
 * "m7b5" would drag every chord name into every sketch. Table order is
 * also preference order for DetectChord, earlier entries win ties, which
 * is why the plain triads sit at the top.
 *
 * A Chord is a value: root pitch class, type, and up to eight semitone
 * offsets copied inline. That costs twelve bytes and makes chords free to
 * return, keep in an array, and pass around, which matters because the
 * diatonic builders produce chords whose intervals are not in the table at
 * all. Stacking thirds through a scale gives whatever the scale gives, and
 * in something like hungarian minor that is regularly a stack with no
 * name; those come back as kChordUnknown with their intervals intact and
 * still play correctly.
 *
 * Everything is integer arithmetic on pitch classes. Nothing here
 * allocates, nothing throws, and nothing touches a sample rate. Where the
 * JS throws, these functions return false or an empty string and leave
 * their output alone.
 *
 * As in scales.h, the strings live in a clearly marked section at the
 * bottom. The integer half (building chords, stacking diatonic harmony,
 * detecting a chord type from a set of pitch classes) never refers to
 * them, so a sequencer that voices ii-V-I by enum links no characters at
 * all. Only printing or parsing a symbol pulls the name table in. */
#pragma once
#include <stdint.h>

#include "bellows/theory/notes.h"
#include "bellows/theory/scales.h"

namespace bellows {

enum ChordType : uint8_t {
  kChordMaj = 0,
  kChordMin,
  kChordDom7,
  kChordMaj7,
  kChordMin7,
  kChordDim,
  kChordAug,
  kChordSus2,
  kChordSus4,
  kChordDim7,
  kChordMin7b5,
  kChordMinMaj7,
  kChordMaj6,
  kChordMin6,
  kChordAdd9,
  kChordMaj9,
  kChordMin9,
  kChordDom9,
  kChordDom11,
  kChordDom13,
  kChordDom7b9,
  kChordDom7s9,
  kChordDom7s11,
  kChordAug7,
  kChordAugMaj7,

  kChordCount,
  /* An interval stack with no named type, the '?' of the JS. */
  kChordUnknown = 255
};

/* Every chord's intervals end to end, in ChordType order. */
inline constexpr int8_t kChordSteps[] = {
    0, 4, 7,             /* maj */
    0, 3, 7,             /* min */
    0, 4, 7, 10,         /* 7 */
    0, 4, 7, 11,         /* maj7 */
    0, 3, 7, 10,         /* m7 */
    0, 3, 6,             /* dim */
    0, 4, 8,             /* aug */
    0, 2, 7,             /* sus2 */
    0, 5, 7,             /* sus4 */
    0, 3, 6, 9,          /* dim7 */
    0, 3, 6, 10,         /* m7b5 */
    0, 3, 7, 11,         /* mMaj7 */
    0, 4, 7, 9,          /* 6 */
    0, 3, 7, 9,          /* m6 */
    0, 4, 7, 14,         /* add9 */
    0, 4, 7, 11, 14,     /* maj9 */
    0, 3, 7, 10, 14,     /* m9 */
    0, 4, 7, 10, 14,     /* 9 */
    0, 4, 7, 10, 14, 17, /* 11 */
    0, 4, 7, 10, 14, 21, /* 13 */
    0, 4, 7, 10, 13,     /* 7b9 */
    0, 4, 7, 10, 15,     /* 7#9 */
    0, 4, 7, 10, 18,     /* 7#11 */
    0, 4, 8, 10,         /* aug7 */
    0, 4, 8, 11,         /* maj7#5, the diatonic III of harmonic minor */
};

/* Start of each chord in kChordSteps, terminated so the length of type c
 * is kChordOffset[c + 1] - kChordOffset[c]. */
inline constexpr uint8_t kChordOffset[kChordCount + 1] = {
    0,  3,  6,  10, 14, 18, 21, 24, 27, 30, 34, 38, 42,
    46, 50, 54, 59, 64, 69, 75, 81, 86, 91, 96, 100, 104,
};

static_assert(kChordOffset[kChordCount] == sizeof(kChordSteps) / sizeof(kChordSteps[0]),
              "chord offset table does not match the step table");

inline const int8_t* ChordTypeSteps(ChordType t) {
  return t < kChordCount ? kChordSteps + kChordOffset[t] : nullptr;
}

inline int ChordTypeLength(ChordType t) {
  return t < kChordCount ? kChordOffset[t + 1] - kChordOffset[t] : 0;
}

/*
 * A built chord. Intervals are semitone offsets from the root, copied out
 * of the table (or computed by the diatonic builders) so a Chord stands on
 * its own with no pointer back into anything.
 */
struct Chord {
  /* Six is the widest named type (11 and 13); eight leaves room for a
   * diatonic stack of eight scale thirds without a bounds surprise. */
  static constexpr int kMaxNotes = 8;

  uint8_t root = 0;
  ChordType type = kChordMaj;
  uint8_t count = 3;
  int8_t intervals[kMaxNotes] = {0, 4, 7, 0, 0, 0, 0, 0};

  /* MIDI notes with the root placed in the given octave. Writes at most
   * cap notes and returns how many. */
  int Midi(int octave, int* out, int cap) const {
    if (out == nullptr || cap <= 0) return 0;
    const int base = (octave + 1) * 12 + root;
    int n = count < cap ? count : cap;
    for (int i = 0; i < n; ++i) out[i] = base + intervals[i];
    return n;
  }

  int Midi(int* out, int cap) const { return Midi(4, out, cap); }

  /* True when the chord has a minor or diminished third above its root,
   * the test that decides lowercase in a roman numeral. */
  bool IsMinorish() const {
    bool has3 = false, has4 = false;
    for (int i = 0; i < count; ++i) {
      if (intervals[i] == 3) has3 = true;
      if (intervals[i] == 4) has4 = true;
    }
    return has3 && !has4;
  }
};

/* Build a chord from a root pitch class and a type. */
inline Chord MakeChord(int root, ChordType type) {
  Chord c;
  c.root = static_cast<uint8_t>(Mod12(root));
  c.type = type;
  const int8_t* steps = ChordTypeSteps(type);
  const int n = ChordTypeLength(type);
  c.count = static_cast<uint8_t>(n);
  for (int i = 0; i < n; ++i) c.intervals[i] = steps[i];
  return c;
}

/* Build a chord from an explicit interval stack, the escape hatch for
 * voicings the table does not name. The type is looked up so a stack that
 * happens to be a known shape still reports itself as one. */
inline Chord MakeChordFromIntervals(int root, const int8_t* intervals, int count);

/* Identify an interval stack, or kChordUnknown when nothing matches. The
 * comparison is exact and order sensitive, matching the JS stackType.
 * Search order does not matter here: every stack in the table is
 * distinct, so at most one can match. */
inline ChordType ChordTypeOfIntervals(const int8_t* intervals, int count) {
  if (intervals == nullptr) return kChordUnknown;
  for (int t = 0; t < kChordCount; ++t) {
    const ChordType ct = static_cast<ChordType>(t);
    if (ChordTypeLength(ct) != count) continue;
    const int8_t* iv = ChordTypeSteps(ct);
    bool same = true;
    for (int i = 0; i < count; ++i) {
      if (iv[i] != intervals[i]) {
        same = false;
        break;
      }
    }
    if (same) return ct;
  }
  return kChordUnknown;
}

inline Chord MakeChordFromIntervals(int root, const int8_t* intervals, int count) {
  Chord c;
  c.root = static_cast<uint8_t>(Mod12(root));
  if (count > Chord::kMaxNotes) count = Chord::kMaxNotes;
  if (count < 0) count = 0;
  c.count = static_cast<uint8_t>(count);
  for (int i = 0; i < count; ++i) c.intervals[i] = intervals[i];
  c.type = ChordTypeOfIntervals(c.intervals, count);
  return c;
}

/* ------------------------------------------------------------------ */
/* Diatonic harmony                                                     */
/* ------------------------------------------------------------------ */

/* The chord on a scale degree, built by stacking scale thirds. notes is 3
 * for a triad, 4 for a seventh, 5 for a ninth, and so on up the scale. */
inline Chord DiatonicChord(const Scale& scale, int degree, int notes) {
  if (notes > Chord::kMaxNotes) notes = Chord::kMaxNotes;
  if (notes < 1) notes = 1;
  const int root = scale.DegreeToMidi(degree);
  int8_t rel[Chord::kMaxNotes];
  for (int i = 0; i < notes; ++i) {
    rel[i] = static_cast<int8_t>(scale.DegreeToMidi(degree + 2 * i) - root);
  }
  return MakeChordFromIntervals(Mod12(root), rel, notes);
}

/* Triads on every degree of a scale. Writes at most cap chords, returns
 * how many. */
inline int DiatonicTriads(const Scale& scale, Chord* out, int cap) {
  if (out == nullptr || cap <= 0) return 0;
  int n = scale.Length();
  if (n > cap) n = cap;
  for (int d = 0; d < n; ++d) out[d] = DiatonicChord(scale, d, 3);
  return n;
}

/* Seventh chords on every degree of a scale. */
inline int DiatonicSevenths(const Scale& scale, Chord* out, int cap) {
  if (out == nullptr || cap <= 0) return 0;
  int n = scale.Length();
  if (n > cap) n = cap;
  for (int d = 0; d < n; ++d) out[d] = DiatonicChord(scale, d, 4);
  return n;
}

/* ------------------------------------------------------------------ */
/* Detection                                                            */
/* ------------------------------------------------------------------ */

/* The order DetectChord tries types in, which is not the order they are
 * declared in.
 *
 * The JS walks Object.keys(CHORD_TYPES), and JavaScript enumerates keys
 * that look like array indices first, in numeric order, before the rest
 * in insertion order. So "6", "7", "9", "11" and "13" jump to the front
 * of the record no matter where they are written in the file, and the
 * "record order" the JS comment talks about is not the order on the page.
 * That is only visible when two different roots both fit and neither is
 * the bass, where {E, G, A, C} comes back as C6 rather than Am7, but a
 * port that quietly disagreed with the browser about a chord name would
 * be a nasty thing to debug. Reproducing it costs one 24 byte table and
 * leaves the enum in the order a musician would expect to read it. */
inline constexpr ChordType kChordDetectOrder[kChordCount] = {
    kChordMaj6,    kChordDom7,   kChordDom9,    kChordDom11,
    kChordDom13,   kChordMaj,    kChordMin,     kChordMaj7,
    kChordMin7,    kChordDim,    kChordAug,     kChordSus2,
    kChordSus4,    kChordDim7,   kChordMin7b5,  kChordMinMaj7,
    kChordMin6,    kChordAdd9,   kChordMaj9,    kChordMin9,
    kChordDom7b9,  kChordDom7s9, kChordDom7s11, kChordAug7,
};

/* Find the root and type spelled by a set of pitch classes, or return
 * false when no known type matches exactly. The first element is the bass
 * and its pitch class is preferred as root when several roots fit, which
 * is the scoring rule from the JS: bass root beats table order, table
 * order breaks the rest.
 *
 * This is the integer half of the JS detectChord. Turning the answer into
 * a symbol is ChordName, in the string section below, so a sketch that
 * only wants to know "is this a dominant seventh" pays nothing for text. */
inline bool DetectChord(const int* pitch_classes, int count, int* out_root, ChordType* out_type) {
  if (pitch_classes == nullptr || count < 1) return false;
  int8_t pcs[12];
  int n = 0;
  for (int i = 0; i < count && n < 12; ++i) {
    const int8_t pc = static_cast<int8_t>(Mod12(pitch_classes[i]));
    bool seen = false;
    for (int j = 0; j < n; ++j) {
      if (pcs[j] == pc) {
        seen = true;
        break;
      }
    }
    if (!seen) pcs[n++] = pc;
  }
  if (n == 0) return false;

  int best_score = 0x7fffffff;
  int best_root = -1;
  ChordType best_type = kChordUnknown;
  for (int r = 0; r < n; ++r) {
    const int root = pcs[r];
    for (int t = 0; t < kChordCount; ++t) {
      const ChordType ct = kChordDetectOrder[t];
      if (ChordTypeLength(ct) != n) continue;
      const int8_t* iv = ChordTypeSteps(ct);
      bool match = true;
      for (int i = 0; i < n && match; ++i) {
        const int8_t want = static_cast<int8_t>(Mod12(root + iv[i]));
        bool found = false;
        for (int j = 0; j < n; ++j) {
          if (pcs[j] == want) {
            found = true;
            break;
          }
        }
        if (!found) match = false;
      }
      if (!match) continue;
      const int score = (root == pcs[0] ? 0 : 100) + t;
      if (score < best_score) {
        best_score = score;
        best_root = root;
        best_type = ct;
      }
    }
  }
  if (best_root < 0) return false;
  if (out_root != nullptr) *out_root = best_root;
  if (out_type != nullptr) *out_type = best_type;
  return true;
}

/* ------------------------------------------------------------------ */
/* Names, symbols, and roman numerals.                                  */
/* Everything below costs string bytes; nothing above refers to it.      */
/* ------------------------------------------------------------------ */

inline constexpr const char* const kChordNames[kChordCount] = {
    "maj",  "min", "7",    "maj7", "m7",  "dim", "aug",  "sus2",
    "sus4", "dim7", "m7b5", "mMaj7", "6",  "m6",  "add9", "maj9",
    "m9",   "9",   "11",   "13",   "7b9", "7#9", "7#11", "aug7",
    "maj7#5",
};

/* Half diminished, written out as its UTF-8 bytes so the header does not
 * depend on the source encoding of whoever edits it next. Displays that
 * only speak ASCII should print "m7b5" from kChordNames instead. */
inline constexpr const char kHalfDimSign[] = "\xc3\xb8";

inline const char* ChordTypeName(ChordType t) {
  return t < kChordCount ? kChordNames[t] : "?";
}

/* Chord symbol suffix for a type: maj prints as nothing, min as "m". */
inline const char* ChordTypeSuffix(ChordType t) {
  if (t == kChordMaj) return "";
  if (t == kChordMin) return "m";
  return ChordTypeName(t);
}

inline bool ChordTypeFromName(const char* name, ChordType* out) {
  if (name == nullptr || out == nullptr) return false;
  for (int i = 0; i < kChordCount; ++i) {
    if (detail::StrEq(name, kChordNames[i])) {
      *out = static_cast<ChordType>(i);
      return true;
    }
  }
  return false;
}

/* Format a chord as a symbol: MakeChord(6, kChordMin7b5) prints "F#m7b5".
 * Eight bytes of buffer covers every type in the table. */
inline int ChordName(const Chord& ch, char* out, int cap, bool prefer_flats = false) {
  if (out == nullptr || cap <= 0) return 0;
  out[0] = '\0';
  int n = detail::AppendStr(out, cap, 0, PitchClassName(ch.root, prefer_flats));
  return detail::AppendStr(out, cap, n, ChordTypeSuffix(ch.type));
}

/* Name the chord spelled by a set of pitch classes, writing the symbol
 * into out. Returns 0 when nothing matches, the null of the JS. */
inline int DetectChordName(const int* pitch_classes, int count, char* out, int cap,
                           bool prefer_flats = false) {
  int root = 0;
  ChordType type = kChordUnknown;
  if (out == nullptr || cap <= 0) return 0;
  out[0] = '\0';
  if (!DetectChord(pitch_classes, count, &root, &type)) return 0;
  return ChordName(MakeChord(root, type), out, cap, prefer_flats);
}

/* Parse a chord symbol like "F#m7b5", "Ebmaj7", "Am", "C". Returns false
 * on a bad root or an unknown type and leaves *out alone.
 *
 * The root scan has to stop pulling accidentals at the right place: in
 * "Ebb" the second b is a flat, but in "Cm7b5" the b belongs to the type.
 * The JS regex has the same greediness and resolves it the same way, by
 * taking the run and letting the type lookup fail if it took too much.
 * Every type name in the table starts with a letter or a digit, never
 * with '#' or 'b', so the split is unambiguous in practice. */
inline bool ParseChord(const char* symbol, Chord* out) {
  if (symbol == nullptr || out == nullptr) return false;
  int pc = LetterPitchClass(symbol[0]);
  if (pc < 0) return false;
  int i = 1;
  pc += detail::ScanAccidentals(symbol, &i);
  const char* rest = symbol + i;

  ChordType type = kChordMaj;
  if (rest[0] == '\0' || detail::StrEq(rest, "M")) {
    type = kChordMaj;
  } else if (detail::StrEq(rest, "m") || detail::StrEq(rest, "min")) {
    type = kChordMin;
  } else if (detail::StrEq(rest, "mmaj7") || detail::StrEq(rest, "mM7")) {
    type = kChordMinMaj7;
  } else if (!ChordTypeFromName(rest, &type)) {
    return false;
  }
  *out = MakeChord(Mod12(pc), type);
  return true;
}

inline constexpr const char* const kRomanNumerals[7] = {"I", "II", "III", "IV", "V", "VI", "VII"};

/* Roman numeral suffix for a type. Types with no entry fall back to their
 * chord symbol suffix, as the JS does with its ?? on ROMAN_SUFFIX. */
inline const char* RomanSuffix(ChordType t) {
  switch (t) {
    case kChordMaj:
    case kChordMin: return "";
    case kChordDim: return "o";
    case kChordAug: return "+";
    case kChordDom7:
    case kChordMin7: return "7";
    case kChordMaj7:
    case kChordMinMaj7: return "maj7";
    case kChordDim7: return "o7";
    case kChordMin7b5: return "\xc3\xb8" "7";
    case kChordAug7: return "+7";
    case kChordMaj6:
    case kChordMin6: return "6";
    case kChordDom9:
    case kChordMin9: return "9";
    default: return ChordTypeSuffix(t);
  }
}

/* Roman numeral for a chord in a scale: lowercase for minor and
 * diminished qualities, 'o' for diminished, the half diminished sign for
 * m7b5, '+' for augmented. A chromatic root takes a 'b' or '#' prefix
 * relative to the nearest degree. Returns 0 when the root does not map to
 * any degree within a semitone, where the JS throws. Twelve bytes of
 * buffer is enough for anything the table can produce. */
inline int ChordToRoman(const Chord& ch, const Scale& scale, char* out, int cap) {
  if (out == nullptr || cap <= 0) return 0;
  out[0] = '\0';
  const int len = scale.Length();
  const int roman_count = 7;
  const char* accidental = "";
  int degree = -1;
  for (int d = 0; d < len && degree < 0; ++d) {
    if (Mod12(scale.DegreeToMidi(d)) == ch.root) degree = d;
  }
  if (degree < 0) {
    for (int d = 0; d < len && degree < 0; ++d) {
      if (Mod12(scale.DegreeToMidi(d) - 1) == ch.root) {
        degree = d;
        accidental = "b";
      }
    }
  }
  if (degree < 0) {
    for (int d = 0; d < len && degree < 0; ++d) {
      if (Mod12(scale.DegreeToMidi(d) + 1) == ch.root) {
        degree = d;
        accidental = "#";
      }
    }
  }
  if (degree < 0 || degree >= roman_count) return 0;

  int n = detail::AppendStr(out, cap, 0, accidental);
  const char* numeral = kRomanNumerals[degree];
  const bool lower = ch.IsMinorish();
  for (int i = 0; numeral[i] != '\0' && n < cap - 1; ++i) {
    const char c = numeral[i];
    out[n++] = lower ? static_cast<char>(c - 'A' + 'a') : c;
  }
  out[n] = '\0';
  return detail::AppendStr(out, cap, n, RomanSuffix(ch.type));
}

/* Type named by a roman numeral suffix. Case of the numeral decides the
 * quality where the suffix does not. */
inline bool RomanSuffixType(const char* suffix, bool lower, ChordType* out) {
  if (suffix == nullptr || out == nullptr) return false;
  if (suffix[0] == '\0') {
    *out = lower ? kChordMin : kChordMaj;
    return true;
  }
  if (detail::StrEq(suffix, "o") || detail::StrEq(suffix, "dim")) {
    *out = kChordDim;
  } else if (detail::StrEq(suffix, "o7") || detail::StrEq(suffix, "dim7")) {
    *out = kChordDim7;
  } else if (detail::StrEq(suffix, kHalfDimSign) || detail::StrEq(suffix, "\xc3\xb8" "7")) {
    *out = kChordMin7b5;
  } else if (detail::StrEq(suffix, "+")) {
    *out = kChordAug;
  } else if (detail::StrEq(suffix, "+7")) {
    *out = kChordAug7;
  } else if (detail::StrEq(suffix, "7")) {
    *out = lower ? kChordMin7 : kChordDom7;
  } else if (detail::StrEq(suffix, "9")) {
    *out = lower ? kChordMin9 : kChordDom9;
  } else if (detail::StrEq(suffix, "6")) {
    *out = lower ? kChordMin6 : kChordMaj6;
  } else if (detail::StrEq(suffix, "maj7")) {
    *out = lower ? kChordMinMaj7 : kChordMaj7;
  } else if (!ChordTypeFromName(suffix, out)) {
    return false;
  }
  return true;
}

/* Chord for a roman numeral in a scale: "V7", "ii", "viio7", "bVII",
 * "IVsus4". Returns false for a malformed numeral, a mixed case one, a
 * degree past the end of the scale, or an unknown suffix. */
inline bool RomanToChord(const char* numeral, const Scale& scale, Chord* out) {
  if (numeral == nullptr || out == nullptr) return false;
  int i = 0;
  int offset = 0;
  if (numeral[0] == 'b') {
    offset = -1;
    i = 1;
  } else if (numeral[0] == '#') {
    offset = 1;
    i = 1;
  }
  char base[8];
  int k = 0;
  bool any_lower = false, any_upper = false;
  while (numeral[i] == 'i' || numeral[i] == 'v' || numeral[i] == 'I' || numeral[i] == 'V') {
    if (k >= 7) return false;
    const char c = numeral[i];
    if (c == 'i' || c == 'v') any_lower = true;
    else any_upper = true;
    base[k++] = (c == 'i') ? 'I' : (c == 'v') ? 'V' : c;
    ++i;
  }
  if (k == 0 || (any_lower && any_upper)) return false;
  base[k] = '\0';

  int degree = -1;
  for (int d = 0; d < 7; ++d) {
    if (detail::StrEq(base, kRomanNumerals[d])) {
      degree = d;
      break;
    }
  }
  if (degree < 0 || degree >= scale.Length()) return false;

  ChordType type = kChordMaj;
  if (!RomanSuffixType(numeral + i, any_lower, &type)) return false;
  *out = MakeChord(Mod12(scale.DegreeToMidi(degree) + offset), type);
  return true;
}

}  // namespace bellows
