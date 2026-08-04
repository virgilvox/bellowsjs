/* Transcription of src/theory/notes.ts. Pitch classes, note names,
 * interval names, and the parsers for both.
 *
 * MIDI convention: C4 = 60, so octave = floor(midi / 12) - 1. Accidentals
 * are plain ASCII, '#' for sharp and 'b' for flat, repeated for double
 * accidentals ('C##4', 'Ebb3'). Note letters may be upper or lower case;
 * a leading 'b' is always a letter and any 'b' after it is always a flat,
 * which is what makes "Bb4" unambiguous without lookahead.
 *
 * Everything here is integer arithmetic and pointers into flash. Nothing
 * allocates, nothing throws (there are no exceptions in this library), and
 * nothing touches a sample rate or an audio buffer. Parsers report failure
 * with a sentinel: kNoteInvalid from ParseNote, -1 from ParsePitchClass.
 *
 * Formatters write into a caller-supplied char buffer and return the
 * length written, always leaving the buffer NUL terminated. They never
 * write past cap - 1, so a short buffer truncates rather than corrupts.
 * A note name needs at most 6 bytes ("C##-1" plus NUL); 8 is a safe cap.
 *
 * The name tables are the only .rodata here, roughly 100 bytes of pointers
 * and characters. They are separate arrays from the arithmetic, so with
 * -fdata-sections a sketch that only does pitch math links none of them. */
#pragma once
#include <stdint.h>

namespace bellows {

/* Returned by ParseNote for a null or malformed string. Chosen so it can
 * never collide with a real MIDI index, including the negative indices a
 * microtonal tuning can legitimately produce. */
inline constexpr int kNoteInvalid = INT32_MIN;

/* Positive modulo 12. The JS ((n % 12) + 12) % 12, which C's % does not
 * give you for negative operands. */
inline constexpr int Mod12(int n) { return ((n % 12) + 12) % 12; }

/* Floor division, shared by every wrapping operation in the theory layer.
 * C truncates toward zero, so -1 / 7 is 0 where Math.floor gives -1, and
 * that difference is exactly what makes degree -1 land in the octave
 * below rather than on the root. */
inline constexpr int FloorDiv(int a, int b) {
  int q = a / b;
  return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q;
}

/* Pitch class 0..11 of a MIDI note. */
inline constexpr int PitchClass(int midi) { return Mod12(midi); }

/* Octave number of a MIDI note. OctaveOf(60) == 4. */
inline constexpr int OctaveOf(int midi) { return FloorDiv(midi, 12) - 1; }

/* Semitone offset of a natural note letter, or -1 when c is not A..G. */
inline constexpr int LetterPitchClass(char c) {
  if (c >= 'a' && c <= 'g') c = static_cast<char>(c - 'a' + 'A');
  switch (c) {
    case 'C': return 0;
    case 'D': return 2;
    case 'E': return 4;
    case 'F': return 5;
    case 'G': return 7;
    case 'A': return 9;
    case 'B': return 11;
    default: return -1;
  }
}

namespace detail {

/* Small string helpers so this layer needs neither <string.h> nor any of
 * newlib's formatted output, which would cost more flash than the whole
 * theory layer put together. */

inline bool StrEq(const char* a, const char* b) {
  if (a == nullptr || b == nullptr) return false;
  while (*a != '\0' && *a == *b) {
    ++a;
    ++b;
  }
  return *a == *b;
}

inline int AppendStr(char* out, int cap, int n, const char* s) {
  if (out == nullptr || cap <= 0 || s == nullptr) return n;
  while (*s != '\0' && n < cap - 1) out[n++] = *s++;
  out[n] = '\0';
  return n;
}

inline int AppendInt(char* out, int cap, int n, int v) {
  if (out == nullptr || cap <= 0) return n;
  char tmp[12];
  int k = 0;
  bool neg = v < 0;
  /* Negate in unsigned so the most negative int does not overflow. */
  uint32_t uv = neg ? 0u - static_cast<uint32_t>(v) : static_cast<uint32_t>(v);
  if (uv == 0u) tmp[k++] = '0';
  while (uv > 0u) {
    tmp[k++] = static_cast<char>('0' + (uv % 10u));
    uv /= 10u;
  }
  if (neg && n < cap - 1) out[n++] = '-';
  while (k > 0 && n < cap - 1) out[n++] = tmp[--k];
  out[n] = '\0';
  return n;
}

/* Consume a run of '#' and 'b' starting at s[i], returning the net
 * semitone offset and advancing i past it. */
inline int ScanAccidentals(const char* s, int* i) {
  int off = 0;
  while (s[*i] == '#' || s[*i] == 'b') {
    off += s[*i] == '#' ? 1 : -1;
    ++(*i);
  }
  return off;
}

}  // namespace detail

/* Parse a pitch class name like "C", "F#", "Bb", "Ebb" to 0..11.
 * Returns -1 for null, trailing garbage, or a bad letter. */
inline int ParsePitchClass(const char* s) {
  if (s == nullptr) return -1;
  int pc = LetterPitchClass(s[0]);
  if (pc < 0) return -1;
  int i = 1;
  pc += detail::ScanAccidentals(s, &i);
  if (s[i] != '\0') return -1;
  return Mod12(pc);
}

/* Parse a note name with octave ("C#4", "Db-1", "g3") to a MIDI number.
 * Returns kNoteInvalid for null or malformed input. The octave digit run
 * is capped at four digits, which is far past any usable pitch and keeps
 * the accumulator from overflowing on hostile input. */
inline int ParseNote(const char* s) {
  if (s == nullptr) return kNoteInvalid;
  int pc = LetterPitchClass(s[0]);
  if (pc < 0) return kNoteInvalid;
  int i = 1;
  pc += detail::ScanAccidentals(s, &i);
  bool neg = false;
  if (s[i] == '-') {
    neg = true;
    ++i;
  }
  if (s[i] < '0' || s[i] > '9') return kNoteInvalid;
  int oct = 0;
  int digits = 0;
  while (s[i] >= '0' && s[i] <= '9') {
    if (++digits > 4) return kNoteInvalid;
    oct = oct * 10 + (s[i] - '0');
    ++i;
  }
  if (s[i] != '\0') return kNoteInvalid;
  if (neg) oct = -oct;
  return (oct + 1) * 12 + pc;
}

/* True when the string carries an explicit octave, so callers can tell
 * "F#" from "F#4" without parsing twice. */
inline bool HasOctave(const char* s) {
  if (s == nullptr) return false;
  for (int i = 0; s[i] != '\0'; ++i) {
    if (s[i] >= '0' && s[i] <= '9') return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Name tables. Referenced only by the formatters below, so a sketch     */
/* that does pitch math and never prints links none of these bytes.      */
/* ------------------------------------------------------------------ */

/* Pitch class spellings using sharps. */
inline constexpr const char* const kSharpNames[12] = {
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
};

/* Pitch class spellings using flats. */
inline constexpr const char* const kFlatNames[12] = {
    "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
};

/* Interval names for 0..11 semitones. The tritone is spelled A4 so that
 * compound intervals extend cleanly: A4 plus an octave is A11. */
inline constexpr const char* const kIntervalNames[12] = {
    "P1", "m2", "M2", "m3", "M3", "P4", "A4", "P5", "m6", "M6", "m7", "M7",
};

/* Name a pitch class, sharp spelling by default. The result points into
 * flash and is valid forever, so there is nothing to copy or free. */
inline const char* PitchClassName(int pc, bool prefer_flats = false) {
  const int i = Mod12(pc);
  return prefer_flats ? kFlatNames[i] : kSharpNames[i];
}

/* Name a MIDI note with its octave: NoteName(61, buf, 8) writes "C#4".
 * Returns the number of characters written, not counting the NUL. */
inline int NoteName(int midi, char* out, int cap, bool prefer_flats = false) {
  if (out == nullptr || cap <= 0) return 0;
  out[0] = '\0';
  int n = detail::AppendStr(out, cap, 0, PitchClassName(Mod12(midi), prefer_flats));
  return detail::AppendInt(out, cap, n, OctaveOf(midi));
}

/* Simple interval name for 0..11 semitones, sign and octaves ignored. */
inline const char* IntervalNameSimple(int semitones) {
  const int s = semitones < 0 ? -semitones : semitones;
  return kIntervalNames[s % 12];
}

/* Name an interval in semitones. Compound intervals bump the degree by 7
 * per octave: 12 is P8, 14 is M9, 19 is P12. Negative input is named by
 * its magnitude. Six bytes of buffer covers every reasonable interval. */
inline int IntervalName(int semitones, char* out, int cap) {
  if (out == nullptr || cap <= 0) return 0;
  out[0] = '\0';
  const int s = semitones < 0 ? -semitones : semitones;
  const int octaves = s / 12;
  const char* simple = kIntervalNames[s % 12];
  if (octaves == 0) return detail::AppendStr(out, cap, 0, simple);
  /* Split "m3" into quality 'm' and degree 3, then extend the degree. */
  int degree = 0;
  for (int i = 1; simple[i] != '\0'; ++i) degree = degree * 10 + (simple[i] - '0');
  int n = 0;
  if (n < cap - 1) out[n++] = simple[0];
  out[n] = '\0';
  return detail::AppendInt(out, cap, n, degree + 7 * octaves);
}

}  // namespace bellows
