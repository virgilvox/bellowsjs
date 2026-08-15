/* Transcription of src/dsp/wavetable.ts, the reading half.
 *
 * A WavetableMip is one or more single cycle frames plus band limited
 * copies per octave: level 0 keeps every harmonic below the table Nyquist,
 * each level below halves the highest kept harmonic down to 1. The
 * oscillator picks the level whose top harmonic stays under the output
 * Nyquist for the current frequency, then interpolates linearly across
 * phase and across frames for position scanning.
 *
 * The BUILDING half of that file does not come across. WavetableSet.
 * fromFrames runs a radix-2 FFT per frame per level, in Float64Array, and
 * allocates every level: 320 KB and about 80 FFTs for the default table.
 * There is no heap here and no reason to spend the cycles at boot, so the
 * mipmap is generated into flash by tools/gen-tables.mjs (which calls the
 * library's own fromFrames, so the truncation is not a second copy of the
 * algorithm) and this file only reads it. dsp/wavetable_tables.h carries
 * the default four frame morph table, and the generator's own comment
 * carries the measured cost of each table length.
 *
 * PHASE is a uint32 counter, not a float, for the reason config.h gives:
 * a float accumulator loses part of every increment as it approaches 1.0,
 * systematically, so the error grows with the length of the note. Here it
 * pays twice, because the counter IS the table index: the top log2(length)
 * bits are the sample index and the rest are the interpolation fraction, so
 * a lookup costs a shift and a mask rather than a float multiply, a floor
 * and a subtract.
 *
 * One thing the JS has that this does not: a set carries the sample rate it
 * was built at and picks mip levels with that rate, so feeding a set to a
 * voice running at another rate shifts the switch points by the ratio. A
 * table in flash has no rate of its own, so mip selection uses the rate the
 * oscillator was initialised with. For the default engine the two agree,
 * since the JS builds and caches one default set per sample rate.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/dsp/wavetable_tables.h"

namespace bellows {

/* Frames laid out [level][frame][sample], one contiguous blob. */
struct WavetableMip {
  const float* data;
  /* Highest harmonic kept at each level, strictly decreasing down to 1. */
  const int* max_harm;
  int levels;
  int frames;
  /* Single cycle length, a power of two, at least 4. */
  int length;
};

/* The default morph table: sine, triangle, saw, square. */
inline constexpr WavetableMip kWtMorph = {&kWtMorphData[0][0][0], kWtMorphMaxHarm, kWtMorphLevels,
                                          kWtMorphFrames, kWtMorphLength};

/* Index bits of a power of two length. Shifting a uint32 by 32 is
 * undefined, so this is also what keeps an oscillator that was never
 * initialised readable: it seeds index_bits_ from the default table. */
inline constexpr int WtIndexBits(int length) {
  int k = 0;
  while ((1 << k) < length) ++k;
  return k;
}

class WavetableOsc {
 public:
  void Init(float sample_rate) { Init(sample_rate, kWtMorph); }

  void Init(float sample_rate, const WavetableMip& table) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    SetTable(table);
  }

  void SetTable(const WavetableMip& t) {
    /*
     * The read below indexes with a shift and a mask, so a length that is
     * not a power of two would address outside the blob. The JS throws on
     * one; there is nothing to throw here, so a table that cannot be read
     * safely is replaced by the morph table rather than trusted. The
     * generator only ever emits powers of two, so this costs a handful of
     * bytes and fires only on a hand written mip.
     */
    const bool usable = t.data != nullptr && t.max_harm != nullptr && t.levels > 0 &&
                        t.frames > 0 && t.length >= 4 && (t.length & (t.length - 1)) == 0;
    t_ = usable ? t : kWtMorph;
    index_bits_ = WtIndexBits(t_.length);
    mask_ = static_cast<uint32_t>(t_.length - 1);
    level_ = LevelFor(hz_);
  }

  void SetFreq(float hz) {
    hz_ = hz;
    /* The JS clamps hz / sampleRate into 0..0.5; PhaseIncrement clamps at
     * the same half cycle per sample and returns 0 for anything that is not
     * positive, NaN included. */
    inc_ = PhaseIncrement(hz / sr_);
    level_ = LevelFor(hz);
  }

  /** 0..1 scan across frames, linear crossfade between neighbours. */
  void SetPosition(float pos) { pos_ = Clamp(pos, 0.0f, 1.0f); }

  void Reset(float phase = 0.0f) { phase_ = PhaseFromCycles(phase); }

  inline float Process() {
    const float* lvl = t_.data + static_cast<long>(level_) * t_.frames * t_.length;

    /* Top index_bits_ of the counter are the sample index, the rest are the
     * fraction between that sample and the next. Both exact, where the JS
     * multiplies its double phase by the length and floors it. */
    const uint32_t i0 = phase_ >> (32 - index_bits_);
    const uint32_t i1 = (i0 + 1u) & mask_;
    const float xf = static_cast<float>(phase_ << index_bits_) * kPhaseToUnit;

    /* pos_ is clamped into 0..1, so fpos lands in 0..frames-1 and the
     * truncation is a floor. ff > 0 therefore implies f0 <= frames - 2,
     * which is what keeps the second frame read in range: at pos_ = 1
     * exactly, fpos is exactly frames - 1 and ff is 0. */
    const float fpos = pos_ * static_cast<float>(t_.frames - 1);
    const int f0 = static_cast<int>(fpos);
    const float ff = fpos - static_cast<float>(f0);

    const float* a = lvl + static_cast<long>(f0) * t_.length;
    const float s0 = a[i0] + (a[i1] - a[i0]) * xf;
    float y = s0;
    if (ff > 0.0f) {
      const float* b = a + t_.length;
      const float s1 = b[i0] + (b[i1] - b[i0]) * xf;
      y = s0 + (s1 - s0) * ff;
    }

    /* The wrap is the unsigned overflow. */
    phase_ += inc_;
    return y;
  }

  int Level() const { return level_; }

 private:
  /** Smallest mip level whose top harmonic stays below the output Nyquist. */
  int LevelFor(float hz) const {
    if (hz <= 0.0f) return 0;
    const float allowed = sr_ / (2.0f * hz);
    const int last = t_.levels - 1;
    for (int l = 0; l <= last; ++l) {
      if (static_cast<float>(t_.max_harm[l]) <= allowed) return l;
    }
    /* Reached by a frequency above the Nyquist, and by a NaN one, since
     * every comparison above is false for a NaN. Both give the most band
     * limited level, which is what the JS does, and the index is in range
     * either way. */
    return last;
  }

  WavetableMip t_ = kWtMorph;
  float sr_ = 48000.0f;
  float hz_ = 0.0f, pos_ = 0.0f;
  uint32_t phase_ = 0u, inc_ = 0u, mask_ = static_cast<uint32_t>(kWtMorphLength - 1);
  int index_bits_ = WtIndexBits(kWtMorphLength), level_ = 0;
};

}  // namespace bellows
