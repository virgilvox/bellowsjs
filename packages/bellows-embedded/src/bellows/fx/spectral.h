/* Transcription of the streaming effects in src/fx/spectral.ts: pitch
 * shift, freeze, blur, robot, whisper and denoise. The offline time
 * stretch and pitch shift in the same file are not ported; they take a
 * whole buffer and return a new one.
 *
 * Every effect is the JS SpectralEffect: two StftProcessors, one per
 * channel, with Hann on both sides, and a dry delay of one window so the
 * mix blends time-aligned signals. The FFT size and hop are fixed per
 * effect exactly as the JS fixes them, in samples, at every rate: 2048 and
 * 512 for pitch shift, freeze, blur and denoise, 1024 and 256 for robot
 * and whisper. Latency is the FFT size.
 *
 * Storage. One effect at 2048 points is 26 to 33 thousand floats, 102 to
 * 130 KB, and one at 1024 is 47 KB, more than the internal SRAM of most
 * parts this library targets, so each XxxExt takes a caller buffer sized
 * by its Samples() and carves it, the PlateExt pattern: EXTMEM on a
 * Teensy 4.1, SDRAM on a Daisy, a calloc in the WebAssembly plugin. The
 * owning forms at the end (PitchShift, Freeze and the rest) hold the
 * buffer themselves for targets where it fits. Init returns false on a
 * short buffer, and Process is then a no-op.
 *
 * Randomness. Blur and whisper draw one phase per bin per frame from the
 * stream the JS names 'fx/blur/<seed>' and 'fx/whisper/<seed>', with
 * <seed> the integer part of the seed param, so the noise is the
 * browser's. The seed is a float here, so that holds for seeds up to
 * 2^24, the largest integer a float carries exactly; the JS takes them to
 * 1e9. The JS restarts the stream on every setParam('seed'), even to the
 * value it already had; SetParams can only see a change of value, so it
 * restarts on a change and Reseed() is there for a host that wants the JS
 * behaviour exactly.
 */
#pragma once
#include <math.h>
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/stft.h"

/*
 * The pitch shifter's phase advance, in double by default. See the note on
 * PitchShiftExt for the measurement. Build with
 * -DBELLOWS_SPECTRAL_PHASE=float on a part without a double FPU, where
 * double is emulated: the shift still works, and drifts from the JS phase
 * by about 2e-4 of the signal per second of held sound. Measured at -Os,
 * the pitch shifter alone: 14896 bytes of flash in double against 8408 in
 * float on Cortex-M7, 16016 against 10848 on Cortex-M4, the same RAM.
 * Most of the difference is newlib's double pow and its tables, called
 * once per SetParams for the ratio.
 */
#ifndef BELLOWS_SPECTRAL_PHASE
#define BELLOWS_SPECTRAL_PHASE double
#endif

namespace bellows {

using SpectralPhase = BELLOWS_SPECTRAL_PHASE;

namespace spectral_detail {

/* Wrap to (-pi, pi]: x - 2 pi round(x / 2 pi), round as Math.round. */
inline float Princarg(float x) { return x - kTwoPi * floorf(x / kTwoPi + 0.5f); }

/* 2 pi in the phase type, built from integers: the library is compiled
 * with -fsingle-precision-constant, which would turn a double literal
 * into a float first. 7074237752028440 / 2^50 is the double nearest 2 pi,
 * and both integers convert exactly. */
inline constexpr SpectralPhase kTwoPiPhase =
    static_cast<SpectralPhase>(7074237752028440LL) / static_cast<SpectralPhase>(1125899906842624LL);

inline double PhaseFloor(double x) { return floor(x); }
inline float PhaseFloor(float x) { return floorf(x); }
/* 2^x, as Math.pow(2, x). */
inline double PhaseExp2(double x) { return pow(2.0, x); }
inline float PhaseExp2(float x) { return fm::Pow(2.0f, x); }

inline SpectralPhase PrincargPhase(SpectralPhase x) {
  return x - kTwoPiPhase * PhaseFloor(x / kTwoPiPhase + static_cast<SpectralPhase>(0.5f));
}

/*
 * The JS findPeaks, one peak at a time: the first local maximum at or
 * above `from` over a two-bin neighbourhood, or -1. Bins 0..1 and the
 * top two are never peaks. Walking it from 2 and then from each peak plus
 * one visits the same peaks in the same order as the JS list, without
 * the list.
 */
inline int NextPeak(const float* mag, int nb, int from) {
  for (int k = from < 2 ? 2 : from; k < nb - 2; ++k) {
    const float m = mag[k];
    if (m > 1e-9f && m > mag[k - 1] && m > mag[k - 2] && m >= mag[k + 1] && m >= mag[k + 2]) {
      return k;
    }
  }
  return -1;
}

/* "fx/blur/" + Math.floor(seed), as the JS string concatenation prints
 * it, into buf (at least 48 bytes). */
inline void SeedLabel(char* buf, const char* prefix, float seed) {
  int n = 0;
  for (const char* p = prefix; *p; ++p) buf[n++] = *p;
  const char* word = nullptr;
  if (isnan(seed)) word = "NaN";
  else if (isinf(seed)) word = seed > 0.0f ? "Infinity" : "-Infinity";
  if (word) {
    for (const char* p = word; *p; ++p) buf[n++] = *p;
    buf[n] = 0;
    return;
  }
  /* A float this large is an integer already, and past 2^63 the cast is
   * undefined; such a seed cannot reach this exactly through a float
   * anyway, so it is pinned rather than printed. */
  float f = floorf(seed);
  if (f > 9.2e18f) f = 9.2e18f;
  if (f < -9.2e18f) f = -9.2e18f;
  int64_t v = static_cast<int64_t>(f);
  if (v < 0) {
    buf[n++] = '-';
    v = -v;
  }
  char digits[24];
  int d = 0;
  do {
    digits[d++] = static_cast<char>('0' + static_cast<int>(v % 10));
    v /= 10;
  } while (v > 0);
  while (d > 0) buf[n++] = digits[--d];
  buf[n] = 0;
}

/*
 * The JS SpectralEffect: a StftProcessor per channel over one shared
 * StftCommon, and the dry delay. Process calls frame(re, im, ch) for each
 * completed frame, left before right, as the JS ticks them.
 *
 * Not copyable: the processors point at the StftCommon inside this
 * object, so a copy would run on the original's tables.
 */
class Pair {
 public:
  Pair() = default;
  Pair(const Pair&) = delete;
  Pair& operator=(const Pair&) = delete;

  static constexpr uint32_t Samples(uint32_t n, uint32_t hop) {
    return StftCommon::Samples(n, hop) + 2u * StftProcessorExt::Samples(n, hop) + 2u * n;
  }

  bool Init(uint32_t n, uint32_t hop, float* buf, uint32_t len) {
    ready_ = false;
    if (buf == nullptr || len < Samples(n, hop)) return false;
    float* at = buf;
    if (!common_.Init(n, hop, at, StftCommon::Samples(n, hop))) return false;
    at += StftCommon::Samples(n, hop);
    const uint32_t ch = StftProcessorExt::Samples(n, hop);
    if (!proc_l_.Init(&common_, at, ch)) return false;
    at += ch;
    if (!proc_r_.Init(&common_, at, ch)) return false;
    at += ch;
    dry_l_ = at;
    dry_r_ = at + n;
    dry_len_ = n;
    ready_ = true;
    Reset();
    return true;
  }

  bool Ready() const { return ready_; }
  uint32_t Bins() const { return common_.Bins(); }

  template <class F>
  void Process(float* l, float* r, int from, int to, float mix, F&& frame) {
    if (!ready_) return;
    uint32_t pos = dry_pos_;
    auto left = [&frame](float* re, float* im) { frame(re, im, 0); };
    auto right = [&frame](float* re, float* im) { frame(re, im, 1); };
    for (int i = from; i < to; ++i) {
      const float dl = dry_l_[pos];
      const float dr = dry_r_[pos];
      dry_l_[pos] = l[i];
      dry_r_[pos] = r[i];
      if (++pos == dry_len_) pos = 0;
      const float wl = proc_l_.Tick(l[i], left);
      const float wr = proc_r_.Tick(r[i], right);
      l[i] = dl + (wl - dl) * mix;
      r[i] = dr + (wr - dr) * mix;
    }
    dry_pos_ = pos;
  }

  void Reset() {
    if (!ready_) return;
    proc_l_.Reset();
    proc_r_.Reset();
    for (uint32_t i = 0; i < dry_len_; ++i) {
      dry_l_[i] = 0.0f;
      dry_r_[i] = 0.0f;
    }
    dry_pos_ = 0;
  }

 private:
  StftCommon common_;
  StftProcessorExt proc_l_, proc_r_;
  float* dry_l_ = nullptr;
  float* dry_r_ = nullptr;
  uint32_t dry_len_ = 0, dry_pos_ = 0;
  bool ready_ = false;
};

/* Bins for an FFT size. */
inline constexpr uint32_t Bins(uint32_t n) { return n / 2u + 1u; }

}  // namespace spectral_detail

/* ------------------------------------------------------------------ */
/* Pitch shift                                                         */
/* ------------------------------------------------------------------ */

/*
 * Phase vocoder with identity phase locking (Laroche-Dolson): each
 * frame's spectral peaks are found, each peak's phase is advanced by its
 * instantaneous frequency times the ratio, and every bin in the peak's
 * region is moved to the shifted position and rotated by the one phasor
 * that puts the peak there.
 *
 * WHY THE PHASE ADVANCE IS DOUBLE. The stored phases are float, as they
 * are Float32Arrays in the JS, but the advance between them is computed in
 * SpectralPhase, double unless the build says otherwise, and so is the
 * ratio. In float it cannot be held: omega * hop reaches 1608 radians at
 * the top bin and true_omega * ratio * hop four times that, where floats
 * are 1.2e-4 and 4.9e-4 radians apart, so every frame adds a fixed error
 * to each partial and the accumulated phase keeps it. Measured on a held
 * VA saw chord with an 8 kHz cutoff, up 5 semitones at 48 kHz, as the
 * relative RMS of the difference from the JS over half second windows:
 * float 1.3e-4 at 0.5 s and 1.5e-3 at 7 s, double 8e-7 and 4e-6. The 0.8 s
 * parity row hides most of this (2.0e-5 float, 1.5e-5 double), because
 * its chord is released at half a second.
 *
 * What is left is the algorithm, not the port. Peak picking compares
 * neighbouring magnitudes, and in the bins far above the chord those
 * magnitudes are rounding noise in both builds, so the peaks found there
 * differ and a target bin can keep an offset phase after one. The JS does
 * the same against itself: with its input moved by one float ulp on a
 * third of the samples, the same chord at 96 kHz reads 1.4e-5 in the
 * first half second and 4.3e-4 by 3 s, where this port against the JS
 * reads 2.6e-5 and 1.5e-4.
 */
class PitchShiftExt {
 public:
  struct Params {
    float semitones = 0.0f;
    float mix = 1.0f;
  };

  static constexpr uint32_t kFftSize = 2048;
  static constexpr uint32_t kHop = 512;
  static constexpr uint32_t kBins = spectral_detail::Bins(kFftSize);
  /* The pair, then mag, pha, out_re, out_im, and prev and acc per channel. */
  static constexpr uint32_t Samples() {
    return spectral_detail::Pair::Samples(kFftSize, kHop) + 8u * kBins;
  }

  bool Init(float sample_rate, float* buf, uint32_t len) {
    Params d;
    return Init(sample_rate, buf, len, d);
  }

  bool Init(float sample_rate, float* buf, uint32_t len, const Params& p) {
    (void)sample_rate; /* the algorithm is in samples; nothing depends on the rate */
    ready_ = false;
    if (buf == nullptr || len < Samples() || !pair_.Init(kFftSize, kHop, buf, len)) return false;
    float* at = buf + spectral_detail::Pair::Samples(kFftSize, kHop);
    mag_ = at;
    pha_ = at + kBins;
    out_re_ = at + 2u * kBins;
    out_im_ = at + 3u * kBins;
    prev_[0] = at + 4u * kBins;
    prev_[1] = at + 5u * kBins;
    acc_[0] = at + 6u * kBins;
    acc_[1] = at + 7u * kBins;
    ready_ = true;
    SetParams(p);
    Reset();
    return true;
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.semitones = Clamp(p_.semitones, -24.0f, 24.0f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    ratio_ = spectral_detail::PhaseExp2(static_cast<SpectralPhase>(p_.semitones) /
                                        static_cast<SpectralPhase>(12));
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    pair_.Process(l, r, from, to, p_.mix, [this](float* re, float* im, int ch) { Frame(re, im, ch); });
  }

  void Reset() {
    if (!ready_) return;
    pair_.Reset();
    for (uint32_t k = 0; k < kBins; ++k) {
      prev_[0][k] = prev_[1][k] = 0.0f;
      acc_[0][k] = acc_[1][k] = 0.0f;
    }
  }

 private:
  void Frame(float* re, float* im, int ch) {
    using spectral_detail::PrincargPhase;
    using P = SpectralPhase;
    const int nb = static_cast<int>(kBins);
    const P hop = static_cast<P>(kHop);
    float* mag = mag_;
    float* pha = pha_;
    float* prev = prev_[ch];
    float* acc = acc_[ch];
    for (int k = 0; k < nb; ++k) {
      mag[k] = fm::Sqrt(re[k] * re[k] + im[k] * im[k]);
      pha[k] = fm::Atan2(im[k], re[k]);
    }
    int p = spectral_detail::NextPeak(mag, nb, 2);
    if (p >= 0) {
      float* out_re = out_re_;
      float* out_im = out_im_;
      for (int k = 0; k < nb; ++k) out_re[k] = out_im[k] = 0.0f;
      const P ratio = ratio_;
      int before = -1;
      while (p >= 0) {
        const int after = spectral_detail::NextPeak(mag, nb, p + 1);
        /* Regions partition the bins exactly: the boundary bin between two
         * peaks belongs to the lower region, and the next region starts one
         * bin above it. Sharing a bin would add its energy twice. */
        const int lo = before < 0 ? 0 : ((before + p) >> 1) + 1;
        const int hi = after < 0 ? nb - 1 : (p + after) >> 1;
        const P omega = spectral_detail::kTwoPiPhase * static_cast<P>(p) / static_cast<P>(kFftSize);
        const P delta =
            PrincargPhase(static_cast<P>(pha[p]) - static_cast<P>(prev[p]) - omega * hop);
        const P true_omega = omega + delta / hop;
        const int tp =
            static_cast<int>(spectral_detail::PhaseFloor(static_cast<P>(p) * ratio + static_cast<P>(0.5f)));
        if (tp >= 0 && tp <= nb - 1) {
          /* Advance the accumulated synthesis phase at the target bin by the
           * shifted frequency, then rotate the whole region by the single
           * phasor that puts the peak there (identity locking). */
          const P a = PrincargPhase(static_cast<P>(acc[tp]) + true_omega * ratio * hop);
          acc[tp] = static_cast<float>(a);
          const float rot = static_cast<float>(a - static_cast<P>(pha[p]));
          const float cr = fm::Cos(rot);
          const float ci = fm::Sin(rot);
          const int off = tp - p;
          int k0 = lo;
          int k1 = hi;
          if (k0 + off < 0) k0 = -off;
          if (k1 + off > nb - 1) k1 = nb - 1 - off;
          for (int k = k0; k <= k1; ++k) {
            const int t = k + off;
            out_re[t] += re[k] * cr - im[k] * ci;
            out_im[t] += re[k] * ci + im[k] * cr;
          }
        }
        before = p;
        p = after;
      }
      for (int k = 0; k < nb; ++k) {
        re[k] = out_re[k];
        im[k] = out_im[k];
      }
      im[0] = 0.0f;
      im[nb - 1] = 0.0f;
    }
    for (int k = 0; k < nb; ++k) prev[k] = pha[k];
  }

  Params p_;
  spectral_detail::Pair pair_;
  float* mag_ = nullptr;
  float* pha_ = nullptr;
  float* out_re_ = nullptr;
  float* out_im_ = nullptr;
  float* prev_[2] = {nullptr, nullptr};
  float* acc_[2] = {nullptr, nullptr};
  SpectralPhase ratio_ = 1;
  bool ready_ = false;
};

/* ------------------------------------------------------------------ */
/* Freeze                                                              */
/* ------------------------------------------------------------------ */

/*
 * While freeze is above 0.5, holds the magnitudes of the frame it was
 * switched on at and keeps advancing each bin's phase by the per-hop
 * advance measured just before, so the held sound keeps its pitch. Below
 * 0.5 it passes the signal through and keeps measuring.
 *
 * All float. A held bin repeats one measured advance every hop, so a
 * rounding difference in that one measurement grows with the hold, but no
 * faster than the JS's own: after 7 s of hold at 48 kHz this reads 1.2e-4
 * against the JS, and the JS against itself with its input moved one
 * float ulp reads 8e-5. The phase angles here stay inside a few radians,
 * where float keeps 2e-7, unlike the pitch shifter's.
 */
class FreezeExt {
 public:
  struct Params {
    float freeze = 0.0f;
    float mix = 1.0f;
  };

  static constexpr uint32_t kFftSize = 2048;
  static constexpr uint32_t kHop = 512;
  static constexpr uint32_t kBins = spectral_detail::Bins(kFftSize);
  /* The pair, then pha, and prev, delta, held magnitude and acc per channel. */
  static constexpr uint32_t Samples() {
    return spectral_detail::Pair::Samples(kFftSize, kHop) + 9u * kBins;
  }

  bool Init(float sample_rate, float* buf, uint32_t len) {
    Params d;
    return Init(sample_rate, buf, len, d);
  }

  bool Init(float sample_rate, float* buf, uint32_t len, const Params& p) {
    (void)sample_rate;
    ready_ = false;
    if (buf == nullptr || len < Samples() || !pair_.Init(kFftSize, kHop, buf, len)) return false;
    float* at = buf + spectral_detail::Pair::Samples(kFftSize, kHop);
    pha_ = at;
    at += kBins;
    for (int c = 0; c < 2; ++c) {
      prev_[c] = at;
      delta_[c] = at + kBins;
      mag_[c] = at + 2u * kBins;
      acc_[c] = at + 3u * kBins;
      at += 4u * kBins;
    }
    ready_ = true;
    SetParams(p);
    Reset();
    return true;
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    on_ = p_.freeze > 0.5f;
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    pair_.Process(l, r, from, to, p_.mix, [this](float* re, float* im, int ch) { Frame(re, im, ch); });
  }

  void Reset() {
    if (!ready_) return;
    pair_.Reset();
    for (int c = 0; c < 2; ++c) {
      captured_[c] = false;
      for (uint32_t k = 0; k < kBins; ++k) {
        prev_[c][k] = delta_[c][k] = mag_[c][k] = acc_[c][k] = 0.0f;
      }
    }
  }

 private:
  void Frame(float* re, float* im, int ch) {
    using spectral_detail::Princarg;
    const int nb = static_cast<int>(kBins);
    float* pha = pha_;
    float* prev = prev_[ch];
    float* delta = delta_[ch];
    for (int k = 0; k < nb; ++k) pha[k] = fm::Atan2(im[k], re[k]);
    if (!on_) {
      /* Track the per-hop phase advance so a freeze can start any time. */
      captured_[ch] = false;
      for (int k = 0; k < nb; ++k) {
        delta[k] = Princarg(pha[k] - prev[k]);
        prev[k] = pha[k];
      }
      return; /* passthrough */
    }
    float* mag = mag_[ch];
    float* acc = acc_[ch];
    if (!captured_[ch]) {
      captured_[ch] = true;
      for (int k = 0; k < nb; ++k) {
        mag[k] = fm::Sqrt(re[k] * re[k] + im[k] * im[k]);
        delta[k] = Princarg(pha[k] - prev[k]);
        acc[k] = pha[k];
        prev[k] = pha[k];
      }
      return; /* this frame already is the held frame */
    }
    for (int k = 0; k < nb; ++k) {
      const float a = Princarg(acc[k] + delta[k]);
      acc[k] = a;
      re[k] = mag[k] * fm::Cos(a);
      im[k] = mag[k] * fm::Sin(a);
    }
    im[0] = 0.0f;
    im[nb - 1] = 0.0f;
  }

  Params p_;
  spectral_detail::Pair pair_;
  float* pha_ = nullptr;
  float* prev_[2] = {nullptr, nullptr};
  float* delta_[2] = {nullptr, nullptr};
  float* mag_[2] = {nullptr, nullptr};
  float* acc_[2] = {nullptr, nullptr};
  bool captured_[2] = {false, false};
  bool on_ = false;
  bool ready_ = false;
};

/* ------------------------------------------------------------------ */
/* Blur                                                                */
/* ------------------------------------------------------------------ */

/*
 * Smears the magnitudes over time with a one pole per bin (amount 0..1 is
 * an averaging time of 0..2 s) and resynthesises them with random phase.
 */
class BlurExt {
 public:
  struct Params {
    float amount = 0.5f;
    float mix = 1.0f;
    float seed = 1.0f;
  };

  static constexpr uint32_t kFftSize = 2048;
  static constexpr uint32_t kHop = 512;
  static constexpr uint32_t kBins = spectral_detail::Bins(kFftSize);
  /* The pair, then the running average per channel. */
  static constexpr uint32_t Samples() {
    return spectral_detail::Pair::Samples(kFftSize, kHop) + 2u * kBins;
  }

  bool Init(float sample_rate, float* buf, uint32_t len) {
    Params d;
    return Init(sample_rate, buf, len, d);
  }

  bool Init(float sample_rate, float* buf, uint32_t len, const Params& p) {
    ready_ = false;
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    hop_sec_ = static_cast<float>(kHop) / sr_;
    if (buf == nullptr || len < Samples() || !pair_.Init(kFftSize, kHop, buf, len)) return false;
    float* at = buf + spectral_detail::Pair::Samples(kFftSize, kHop);
    avg_[0] = at;
    avg_[1] = at + kBins;
    ready_ = true;
    p_ = p;
    Reseed();
    SetParams(p);
    Reset();
    return true;
  }

  void SetParams(const Params& p) {
    const bool reseed = isnan(p.seed) != isnan(p_.seed) || (!isnan(p.seed) && floorf(p.seed) != floorf(p_.seed));
    p_ = p;
    p_.amount = Clamp(p_.amount, 0.0f, 1.0f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    /* amount 0..1 maps to a magnitude averaging time of 0..2 seconds. */
    const float time_sec = p_.amount * 2.0f;
    coeff_ = time_sec < 1e-3f ? 1.0f : 1.0f - fm::Exp(-hop_sec_ / time_sec);
    if (reseed) Reseed();
  }

  /* Restart the phase stream at the current seed, as the JS does on every
   * setParam('seed'). */
  void Reseed() {
    char label[64];
    spectral_detail::SeedLabel(label, "fx/blur/", p_.seed);
    rng_.Init(label);
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    pair_.Process(l, r, from, to, p_.mix, [this](float* re, float* im, int ch) { Frame(re, im, ch); });
  }

  /* Clears the averages; the phase stream runs on, as in the JS. */
  void Reset() {
    if (!ready_) return;
    pair_.Reset();
    for (uint32_t k = 0; k < kBins; ++k) avg_[0][k] = avg_[1][k] = 0.0f;
  }

 private:
  void Frame(float* re, float* im, int ch) {
    const int nb = static_cast<int>(kBins);
    float* avg = avg_[ch];
    const float coeff = coeff_;
    for (int k = 0; k < nb; ++k) {
      const float m = fm::Sqrt(re[k] * re[k] + im[k] * im[k]);
      const float a = avg[k] + coeff * (m - avg[k]);
      avg[k] = a;
      const float ph = rng_.Next() * kTwoPi;
      re[k] = a * fm::Cos(ph);
      im[k] = a * fm::Sin(ph);
    }
    im[0] = 0.0f;
    im[nb - 1] = 0.0f;
  }

  Params p_;
  spectral_detail::Pair pair_;
  Rng rng_;
  float* avg_[2] = {nullptr, nullptr};
  float sr_ = 48000.0f, hop_sec_ = 0.0f, coeff_ = 1.0f;
  bool ready_ = false;
};

/* ------------------------------------------------------------------ */
/* Robot                                                               */
/* ------------------------------------------------------------------ */

/*
 * Keeps each frame's magnitudes and throws its phase away, which leaves a
 * pulse per hop: a monotone at sample rate / 256.
 */
class RobotExt {
 public:
  struct Params {
    float mix = 1.0f;
  };

  static constexpr uint32_t kFftSize = 1024;
  static constexpr uint32_t kHop = 256;
  static constexpr uint32_t kBins = spectral_detail::Bins(kFftSize);
  static constexpr uint32_t Samples() { return spectral_detail::Pair::Samples(kFftSize, kHop); }

  bool Init(float sample_rate, float* buf, uint32_t len) {
    Params d;
    return Init(sample_rate, buf, len, d);
  }

  bool Init(float sample_rate, float* buf, uint32_t len, const Params& p) {
    (void)sample_rate;
    ready_ = false;
    if (buf == nullptr || len < Samples() || !pair_.Init(kFftSize, kHop, buf, len)) return false;
    ready_ = true;
    SetParams(p);
    Reset();
    return true;
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    pair_.Process(l, r, from, to, p_.mix, [](float* re, float* im, int) {
      /* Zero phase in a center-of-window sense: alternating signs are the
       * linear phase that parks the pulse mid-frame, where the synthesis
       * window has gain. Plain zero phase would put it at the frame edge
       * and the Hann window would erase it. */
      for (uint32_t k = 0; k < kBins; ++k) {
        const float m = fm::Sqrt(re[k] * re[k] + im[k] * im[k]);
        re[k] = (k & 1u) == 0u ? m : -m;
        im[k] = 0.0f;
      }
    });
  }

  void Reset() {
    if (!ready_) return;
    pair_.Reset();
  }

 private:
  Params p_;
  spectral_detail::Pair pair_;
  bool ready_ = false;
};

/* ------------------------------------------------------------------ */
/* Whisper                                                             */
/* ------------------------------------------------------------------ */

/* Keeps each frame's magnitudes and gives every bin a random phase. */
class WhisperExt {
 public:
  struct Params {
    float mix = 1.0f;
    float seed = 1.0f;
  };

  static constexpr uint32_t kFftSize = 1024;
  static constexpr uint32_t kHop = 256;
  static constexpr uint32_t kBins = spectral_detail::Bins(kFftSize);
  static constexpr uint32_t Samples() { return spectral_detail::Pair::Samples(kFftSize, kHop); }

  bool Init(float sample_rate, float* buf, uint32_t len) {
    Params d;
    return Init(sample_rate, buf, len, d);
  }

  bool Init(float sample_rate, float* buf, uint32_t len, const Params& p) {
    (void)sample_rate;
    ready_ = false;
    if (buf == nullptr || len < Samples() || !pair_.Init(kFftSize, kHop, buf, len)) return false;
    ready_ = true;
    p_ = p;
    Reseed();
    SetParams(p);
    Reset();
    return true;
  }

  void SetParams(const Params& p) {
    const bool reseed = isnan(p.seed) != isnan(p_.seed) || (!isnan(p.seed) && floorf(p.seed) != floorf(p_.seed));
    p_ = p;
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
    if (reseed) Reseed();
  }

  /* Restart the phase stream at the current seed, as the JS does on every
   * setParam('seed'). */
  void Reseed() {
    char label[64];
    spectral_detail::SeedLabel(label, "fx/whisper/", p_.seed);
    rng_.Init(label);
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    pair_.Process(l, r, from, to, p_.mix, [this](float* re, float* im, int) {
      for (uint32_t k = 0; k < kBins; ++k) {
        const float m = fm::Sqrt(re[k] * re[k] + im[k] * im[k]);
        const float ph = rng_.Next() * kTwoPi;
        re[k] = m * fm::Cos(ph);
        im[k] = m * fm::Sin(ph);
      }
      im[0] = 0.0f;
      im[kBins - 1u] = 0.0f;
    });
  }

  /* The phase stream runs on, as in the JS. */
  void Reset() {
    if (!ready_) return;
    pair_.Reset();
  }

 private:
  Params p_;
  spectral_detail::Pair pair_;
  Rng rng_;
  bool ready_ = false;
};

/* ------------------------------------------------------------------ */
/* Denoise                                                             */
/* ------------------------------------------------------------------ */

/*
 * Spectral subtraction against a per-bin noise floor: the running minimum
 * of each bin's smoothed magnitude, rising slowly so it recovers after a
 * loud passage. amount scales the floor that is taken off.
 */
class DenoiseExt {
 public:
  struct Params {
    float amount = 1.0f;
    float mix = 1.0f;
  };

  static constexpr uint32_t kFftSize = 2048;
  static constexpr uint32_t kHop = 512;
  static constexpr uint32_t kBins = spectral_detail::Bins(kFftSize);
  /* The pair, then the smoothed magnitude and the floor per channel. */
  static constexpr uint32_t Samples() {
    return spectral_detail::Pair::Samples(kFftSize, kHop) + 4u * kBins;
  }

  bool Init(float sample_rate, float* buf, uint32_t len) {
    Params d;
    return Init(sample_rate, buf, len, d);
  }

  bool Init(float sample_rate, float* buf, uint32_t len, const Params& p) {
    ready_ = false;
    const float sr = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    const float hop_sec = static_cast<float>(kHop) / sr;
    rise_ = fm::Pow(10.0f, (kRiseDbPerSec * hop_sec) / 20.0f);
    smooth_coeff_ = 1.0f - fm::Exp(-hop_sec / kSmoothSec);
    if (buf == nullptr || len < Samples() || !pair_.Init(kFftSize, kHop, buf, len)) return false;
    float* at = buf + spectral_detail::Pair::Samples(kFftSize, kHop);
    smooth_[0] = at;
    smooth_[1] = at + kBins;
    floor_[0] = at + 2u * kBins;
    floor_[1] = at + 3u * kBins;
    ready_ = true;
    SetParams(p);
    Reset();
    return true;
  }

  void SetParams(const Params& p) {
    p_ = p;
    p_.amount = Clamp(p_.amount, 0.0f, 4.0f);
    p_.mix = Clamp(p_.mix, 0.0f, 1.0f);
  }

  bool Ready() const { return ready_; }

  void Process(float* l, float* r, int from, int to) {
    if (!ready_) return;
    pair_.Process(l, r, from, to, p_.mix, [this](float* re, float* im, int ch) { Frame(re, im, ch); });
  }

  void Reset() {
    if (!ready_) return;
    pair_.Reset();
    for (int c = 0; c < 2; ++c) {
      warmup_[c] = 0;
      for (uint32_t k = 0; k < kBins; ++k) {
        smooth_[c][k] = 0.0f;
        floor_[c][k] = INFINITY;
      }
    }
  }

 private:
  /* Residual magnitude never drops below this fraction of the input. */
  static constexpr float kFloor = 0.02f;
  /* Noise floor estimate rise rate in dB per second. */
  static constexpr float kRiseDbPerSec = 1.5f;
  /* One-pole magnitude smoothing time feeding the minimum tracker. */
  static constexpr float kSmoothSec = 0.05f;
  /* Frames to wait before the floor starts capturing, covering the STFT
   * ramp-in and the smoother's own convergence from zero. */
  static constexpr int kWarmupFrames = 10;

  void Frame(float* re, float* im, int ch) {
    const int nb = static_cast<int>(kBins);
    float* smooth = smooth_[ch];
    float* floor = floor_[ch];
    const float a = smooth_coeff_;
    const float rise = rise_;
    const float amount = p_.amount;
    /* During warmup the frames are the zero-padded STFT ramp-in and the
     * smoother is still converging from zero, so the floor must not
     * capture yet or it would lock onto a near-zero estimate. */
    const bool capture = warmup_[ch] >= kWarmupFrames;
    if (!capture) ++warmup_[ch];
    for (int k = 0; k < nb; ++k) {
      const float m = fm::Sqrt(re[k] * re[k] + im[k] * im[k]);
      /* Smooth the magnitude, track its running minimum with a slow
       * exponential rise so the floor recovers after loud passages. */
      const float sm = smooth[k] + a * (m - smooth[k]);
      smooth[k] = sm;
      float f = floor[k];
      if (capture) {
        f = sm < f ? sm : f * rise + 1e-9f;
        floor[k] = f;
      }
      if (isinf(f)) continue; /* warmup: pass the bin through */
      float target = m - amount * f;
      const float least = m * kFloor;
      if (target < least) target = least;
      const float g = m > 1e-12f ? target / m : 0.0f;
      re[k] *= g;
      im[k] *= g;
    }
  }

  Params p_;
  spectral_detail::Pair pair_;
  float* smooth_[2] = {nullptr, nullptr};
  float* floor_[2] = {nullptr, nullptr};
  int warmup_[2] = {0, 0};
  float rise_ = 1.0f, smooth_coeff_ = 1.0f;
  bool ready_ = false;
};

/* ------------------------------------------------------------------ */
/* Owning forms                                                        */
/* ------------------------------------------------------------------ */

/* Each holds its buffer, Samples() floats: 104472 bytes for Blur, 112672
 * for Denoise, 129072 for PitchShift, 133172 for Freeze, and 48144 for
 * Robot and Whisper. The two channels share one window, one transform and
 * one set of frame scratch, which the JS builds once per channel. */
template <class Ext>
class SpectralOwned : public Ext {
 public:
  static constexpr uint32_t kStoreSamples = Ext::Samples();

  bool Init(float sample_rate) {
    typename Ext::Params d;
    return Init(sample_rate, d);
  }

  bool Init(float sample_rate, const typename Ext::Params& p) {
    return Ext::Init(sample_rate, store_, kStoreSamples, p);
  }

 private:
  float store_[kStoreSamples];
};

using PitchShift = SpectralOwned<PitchShiftExt>;
using Freeze = SpectralOwned<FreezeExt>;
using Blur = SpectralOwned<BlurExt>;
using Robot = SpectralOwned<RobotExt>;
using Whisper = SpectralOwned<WhisperExt>;
using Denoise = SpectralOwned<DenoiseExt>;

}  // namespace bellows
