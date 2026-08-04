/* Transcription of src/dsp/oversample.ts.
 *
 * 2x and 4x oversampling with polyphase halfband FIR stages, for running
 * nonlinear processors (waveshapers, saturating filters) above the host
 * rate and rejecting the aliases on the way back down.
 *
 * The halfband kernel is a 33-tap Blackman-windowed sinc with cutoff at
 * a quarter of the high rate. Every even tap except the center is exactly
 * zero, so each stage runs as a 1-tap plus 16-tap polyphase pair. The odd
 * taps are renormalized so the filter has exactly unit DC gain. Measured
 * stopband rejection is better than 70 dB; the transition band spans
 * roughly 0.2 to 0.3 of the high rate.
 *
 * Factor 4 cascades two 2x stages. Each filter delays by 16 samples at
 * its own high rate, so the round trip (up then down) lands on an integer
 * number of input samples: 16 for 2x, 24 for 4x. That figure is kLatency.
 *
 * Two departures from the JS. The taps are computed there at module load
 * into a Float64Array; here they are a constexpr array so they land in
 * .rodata, 64 bytes of flash instead of 128 bytes of RAM plus the sinc
 * and window code to fill it. And the JS keeps a Map of buffer views
 * keyed by length so that returning "the first n * factor samples" does
 * not allocate a subarray every block. In C++ a pointer into the scratch
 * buffer already is that view, so the map has no reason to exist: Up()
 * returns the buffer and the caller knows the length is (to - from) times
 * the factor.
 *
 * The accumulators are float here rather than the JS double. Over 16
 * taps of a unit-gain filter the difference is far below the noise floor
 * of any converter, and doubles are soft-float on half the targets this
 * library runs on.
 */
#pragma once
#include <stdint.h>

namespace bellows {

/* Nonzero odd-index taps of the halfband kernel: indices 1, 3, ..., 31.
 * Symmetric, and they sum to exactly 0.5 so that with the 0.5 center tap
 * the whole filter has unit DC gain. */
inline constexpr int kHalfbandOddTaps = 16;
inline constexpr float kHalfbandOdd[kHalfbandOddTaps] = {
  -0.0000746390271f, 0.000853939594f, -0.00322899957f, 0.00878936037f,
  -0.0201708049f, 0.0424680634f, -0.0919110080f, 0.313274088f,
  0.313274088f, -0.0919110080f, 0.0424680634f, -0.0201708049f,
  0.00878936037f, -0.00322899957f, 0.000853939594f, -0.0000746390271f,
};
/* Center tap index of the 33-tap kernel; the even phase is a pure delay
 * of half that many samples at the low rate. */
inline constexpr int kHalfbandCenter = 16;

/* One 2x interpolation stage. Produces two outputs per input sample. */
class HalfbandUpStage {
 public:
  void Reset() {
    for (int i = 0; i < 32; ++i) hist_[i] = 0.0f;
    pos_ = 0;
  }

  void Process(const float* input, int from, int to, float* out, int out_from) {
    int pos = pos_;
    int o = out_from;
    for (int i = from; i < to; ++i) {
      hist_[pos] = input[i];
      /* Even phase: only the center tap survives, a pure delay. */
      out[o++] = hist_[static_cast<uint32_t>(pos - (kHalfbandCenter >> 1)) & 31u];
      float acc = 0.0f;
      /* Odd phase, scaled by 2 to make up for the zero stuffing. */
      for (int k = 0; k < kHalfbandOddTaps; ++k) {
        acc += kHalfbandOdd[k] * hist_[static_cast<uint32_t>(pos - k) & 31u];
      }
      out[o++] = 2.0f * acc;
      pos = (pos + 1) & 31;
    }
    pos_ = pos;
  }

 private:
  float hist_[32] = {};
  int pos_ = 0;
};

/* One 2x decimation stage. Consumes two inputs per output sample. */
class HalfbandDownStage {
 public:
  void Reset() {
    for (int i = 0; i < 32; ++i) {
      hist_e_[i] = 0.0f;
      hist_o_[i] = 0.0f;
    }
    pos_ = 0;
  }

  void Process(const float* input, int in_from, int count, float* out, int out_from) {
    int pos = pos_;
    int i = in_from;
    for (int m = 0; m < count; ++m) {
      hist_e_[pos] = input[i++];
      hist_o_[pos] = input[i++];
      /* y[m] = 0.5 v[2m - 16] + sum_k h[2k + 1] v[2m - 2k - 1] */
      float acc = 0.5f * hist_e_[static_cast<uint32_t>(pos - (kHalfbandCenter >> 1)) & 31u];
      for (int k = 0; k < kHalfbandOddTaps; ++k) {
        acc += kHalfbandOdd[k] * hist_o_[static_cast<uint32_t>(pos - k - 1) & 31u];
      }
      out[out_from + m] = acc;
      pos = (pos + 1) & 31;
    }
    pos_ = pos;
  }

 private:
  float hist_e_[32] = {};
  float hist_o_[32] = {};
  int pos_ = 0;
};

namespace detail {

/* Second 2x stage, present only at factor 4. Specializing it away is what
 * keeps a 2x Oversampler from carrying 384 bytes of dead history. */
template <bool kOn>
struct SecondStage {
  HalfbandUpStage up;
  HalfbandDownStage down;
};
template <>
struct SecondStage<false> {};

}  // namespace detail

/*
 * kFactor is 2 or 4. kMaxBlock is the longest span Up() or Down() will
 * ever be handed, which sizes the scratch at compile time.
 *
 * The 2x scratch does double duty. At factor 4 it holds the intermediate
 * 2x signal while upsampling, and the intermediate 2x signal again while
 * downsampling; the two lifetimes never overlap because Up() is finished
 * with it by the time it returns.
 */
template <int kFactor = 4, int kMaxBlock = 128>
class Oversampler {
 public:
  static_assert(kFactor == 2 || kFactor == 4, "Oversampler factor must be 2 or 4");
  static_assert(kMaxBlock >= 1, "Oversampler kMaxBlock must be at least 1");

  /* Round-trip delay of up followed by down, in input-rate samples. */
  static constexpr int kLatency = (kFactor == 4) ? 24 : 16;
  static constexpr int kFactorValue = kFactor;

  void Init() { Reset(); }

  void Reset() {
    up1_.Reset();
    down1_.Reset();
    if constexpr (kFactor == 4) {
      stage2_.up.Reset();
      stage2_.down.Reset();
    }
  }

  /* Upsample input[from..to). Returns the internal buffer holding
   * (to - from) * kFactor samples, valid until the next call. */
  float* Up(const float* input, int from, int to) {
    const int n = to - from;
    up1_.Process(input, from, to, buf2_, 0);
    if constexpr (kFactor == 4) {
      stage2_.up.Process(buf2_, 0, n * 2, buf4_, 0);
      return buf4_;
    } else {
      return buf2_;
    }
  }

  /* Downsample `processed` ((to - from) * kFactor samples starting at 0)
   * into out[from..to). */
  void Down(const float* processed, float* out, int from, int to) {
    const int n = to - from;
    if constexpr (kFactor == 4) {
      stage2_.down.Process(processed, 0, n * 2, buf2_, 0);
      down1_.Process(buf2_, 0, n, out, from);
    } else {
      down1_.Process(processed, 0, n, out, from);
    }
  }

 private:
  /* One float rather than zero at factor 2: a zero-length array is not
   * legal C++, and the alternative specialization costs more source than
   * the four bytes it saves. */
  static constexpr int kBuf4Len = (kFactor == 4) ? kMaxBlock * 4 : 1;

  HalfbandUpStage up1_;
  HalfbandDownStage down1_;
  detail::SecondStage<kFactor == 4> stage2_;
  float buf2_[kMaxBlock * 2] = {};
  float buf4_[kBuf4Len] = {};
};

}  // namespace bellows
