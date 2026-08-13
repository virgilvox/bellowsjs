/* The note source shared by every patch in the 20_Instruments example.
 *
 * The patches are sounds. This is the music, kept in one file so that
 * comparing two patches compares the instruments and not the parts they
 * happen to be playing, the same argument 10_AudioShield makes for the
 * output examples sharing one chord.
 *
 * Everything is scale degrees, never note numbers, and a degree becomes a
 * frequency through bellows::DegreeFreq with a Scale and a Tuning. Swap
 * edo12_ for a 19-EDO tuning and the whole example moves into it, every
 * patch, without a line of the arrangement changing. That is the point
 * 04_ScalesAndTuning makes at length and this one gets for free.
 *
 * A patch declares what KIND of part it wants, and gets a different one:
 *
 *   kChord       a voicing on the bar, held. Pads, keys, choirs.
 *   kMelody      a line on a euclidean rhythm. Leads, bells, winds.
 *   kBass        roots and fifths, low and short.
 *   kPercussion  a gate per pad, no pitch from here.
 *
 * That is four parts rather than one because an electric piano and a
 * clarinet do not want the same notes, and giving them the same notes is
 * how a patch library ends up sounding like one patch.
 */
#pragma once

#include <stdint.h>

#include "bellows/seq/euclid.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

namespace player {

enum class Kind : uint8_t { kChord, kMelody, kBass, kPercussion };

inline constexpr int kSteps = 16;
inline constexpr int kBars = 4;

/* i VI iv v in A natural minor, one chord a bar. */
inline constexpr int kProgression[kBars] = {0, 5, 3, 4};

/* A sixteen step line in degrees relative to the bar's chord. Rests are
 * kRest, which is outside any degree the scale can produce. */
inline constexpr int kRest = -99;
inline constexpr int kLine[kSteps] = {0,  kRest, 4, kRest, 2, kRest, kRest, 7,
                                      4, kRest, 2, 0,     kRest, 4, kRest, 2};

/* Root index of the scale in the tuning. 57 is A3 in 12-EDO. */
inline constexpr int kRootIndex = 57;

class Player {
 public:
  void Init() {
    scale_.Init(kRootIndex, bellows::kScaleMinor);
    edo12_.InitEdo(12, 440.0f, 69);
    melody_gate_.Generate(9, kSteps, 2);
    bass_gate_.Generate(3, kSteps);
    kick_gate_.Generate(5, kSteps);
    snare_gate_.Generate(4, kSteps, 4);
    hat_gate_.Generate(11, kSteps, 1);
  }

  int Octave() const { return scale_.Length(); }
  int Chord(int bar) const { return kProgression[bar % kBars]; }

  /* Frequency of a degree, through the tuning layer. */
  float Hz(int degree) const {
    return bellows::DegreeFreq(edo12_, kRootIndex, scale_.Intervals(), scale_.Length(), degree);
  }

  /* Three voices of the bar's chord, an octave up. Written into `out` as
   * degrees; returns how many. */
  int ChordDegrees(int bar, int* out) const {
    const int c = Chord(bar);
    const int oct = scale_.Length();
    out[0] = c + oct;
    out[1] = c + 2 + oct;
    out[2] = c + 4 + oct;
    return 3;
  }

  /* Melody degree for a step, or kRest. Two octaves above the root. */
  int MelodyDegree(int bar, int step) const {
    if (!melody_gate_.At(step)) return kRest;
    const int d = kLine[step % kSteps];
    if (d == kRest) return kRest;
    return Chord(bar) + d + 2 * scale_.Length();
  }

  /* Bass degree for a step, or kRest. An octave below the root. */
  int BassDegree(int bar, int step) const {
    if (!bass_gate_.At(step)) return kRest;
    return Chord(bar) - scale_.Length();
  }

  bool Kick(int step) const { return kick_gate_.At(step); }
  bool Snare(int step) const { return snare_gate_.At(step); }
  bool Hat(int step) const { return hat_gate_.At(step); }

 private:
  bellows::Scale scale_;
  bellows::Tuning12 edo12_;
  bellows::Euclid<kSteps> melody_gate_;
  bellows::Euclid<kSteps> bass_gate_;
  bellows::Euclid<kSteps> kick_gate_;
  bellows::Euclid<kSteps> snare_gate_;
  bellows::Euclid<kSteps> hat_gate_;
};

}  // namespace player
