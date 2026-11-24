/* Transcription of StftProcessor and colaNorm from src/dsp/stft.ts.
 *
 * Streaming analysis, modify, resynthesis: one sample in, one sample out,
 * and every hop samples a windowed frame goes through the forward
 * transform, a spectral callback that edits the size/2 + 1 bins in place,
 * the inverse transform and overlap-add. Synthesis divides by the exact
 * per-position sum of analysis window times synthesis window (ColaNorm),
 * so an unmodified frame reconstructs at unity gain. Hann on both sides,
 * as the JS defaults to and as every spectral effect uses.
 *
 * Same timing as the JS, sample for sample: latency is one full window,
 * the first frame runs after the first hop samples with the rest of the
 * window still zero, and the first hop outputs are silence. Measured
 * against stft.ts at 1024/256 and 2048/512 on a sine plus noise, with and
 * without half the bins zeroed: within 3.6e-7 of full scale at every
 * sample, 1.9e-7 relative RMS (test/spectral-dsp.mjs in bellows-wasm).
 *
 * Stft and Istft, the analysis-only and synthesis-only halves in the JS,
 * are not ported: no ported unit uses them, and Stft's frame queue is a
 * growing list, which has no counterpart without an allocator.
 *
 * Storage is split in two. StftCommon is what any number of processors of
 * one size and hop can share: the window, the reciprocal COLA sum, the
 * transform tables and the frame scratch, safe to share because a frame
 * runs to completion inside Tick. StftProcessorExt is one channel's
 * state: the input window, the finished output and the overlap-add
 * accumulator. Both carve a caller buffer sized by their Samples(), and a
 * short buffer or an impossible size and hop makes Init return false.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/dsp/fft.h"

namespace bellows {

/*
 * Steady-state overlap-add gain at each offset j in [0, hop): the sum over
 * frame offsets k of win_a[j + k hop] * win_s[j + k hop]. For Hann on both
 * sides at hop = n/4 this is the constant 1.5.
 */
inline void ColaNorm(const float* win_a, const float* win_s, uint32_t n, uint32_t hop,
                     float* norm) {
  for (uint32_t j = 0; j < hop; ++j) {
    float s = 0.0f;
    for (uint32_t k = j; k < n; k += hop) s += win_a[k] * win_s[k];
    norm[j] = s;
  }
}

class StftCommon {
 public:
  /* Window, reciprocal COLA sum, transform, frame scratch, the two bin
   * arrays. */
  static constexpr uint32_t Samples(uint32_t n, uint32_t hop) {
    return n + hop + RealFft::Samples(n) + n + 2u * (n / 2u + 1u);
  }

  /*
   * False for a size that is not a power of two of at least 2, a hop
   * outside [1, n], a short buffer, or a window and hop that cannot
   * reconstruct: the JS throws in each of those cases. The last is an
   * overlap-add sum at or below 1e-6 at some offset, which is where the
   * JS draws the line (COLA_GUARD in stft.ts); Hann reaches it at
   * hop = n, where the window is zero at its first sample.
   */
  bool Init(uint32_t n, uint32_t hop, float* buf, uint32_t len) {
    n_ = 0;
    if (n < 2u || !fft_detail::IsPow2(n) || hop < 1u || hop > n) return false;
    if (buf == nullptr || len < Samples(n, hop)) return false;
    const uint32_t bins = n / 2u + 1u;
    win_ = buf;
    inv_norm_ = win_ + n;
    float* fft_buf = inv_norm_ + hop;
    scratch_ = fft_buf + RealFft::Samples(n);
    re_ = scratch_ + n;
    im_ = re_ + bins;
    if (!fft_.Init(n, fft_buf, RealFft::Samples(n))) return false;
    Hann(win_, n);
    ColaNorm(win_, win_, n, hop, inv_norm_);
    for (uint32_t j = 0; j < hop; ++j) {
      if (!(inv_norm_[j] > 1e-6f)) return false;
      inv_norm_[j] = 1.0f / inv_norm_[j];
    }
    n_ = n;
    hop_ = hop;
    bins_ = bins;
    return true;
  }

  uint32_t Size() const { return n_; }
  uint32_t Hop() const { return hop_; }
  uint32_t Bins() const { return bins_; }

 private:
  friend class StftProcessorExt;
  RealFft fft_;
  float* win_ = nullptr;
  float* inv_norm_ = nullptr;
  float* scratch_ = nullptr;
  float* re_ = nullptr;
  float* im_ = nullptr;
  uint32_t n_ = 0, hop_ = 0, bins_ = 0;
};

class StftProcessorExt {
 public:
  /* Input window, finished output, overlap-add accumulator. */
  static constexpr uint32_t Samples(uint32_t n, uint32_t hop) { return n + hop + n; }

  /* common must be initialised and outlive this. Clears the state. */
  bool Init(StftCommon* common, float* buf, uint32_t len) {
    c_ = nullptr;
    if (common == nullptr || common->Size() == 0u || buf == nullptr) return false;
    const uint32_t n = common->Size();
    const uint32_t hop = common->Hop();
    if (len < Samples(n, hop)) return false;
    in_ = buf;
    out_ = in_ + n;
    acc_ = out_ + hop;
    c_ = common;
    rover_start_ = n - hop;
    Reset();
    return true;
  }

  /* Input to output delay in samples: one full window. */
  uint32_t Latency() const { return c_ ? c_->n_ : 0u; }

  /*
   * Feed one sample, get one sample delayed by Latency(). Every hop
   * samples, spectral(re, im) is called with the bins of the frame that
   * just completed and edits them in place.
   */
  template <class F>
  float Tick(float x, F&& spectral) {
    if (c_ == nullptr) return 0.0f;
    const float y = out_[rover_ - rover_start_];
    in_[rover_] = x;
    if (++rover_ == c_->n_) {
      Frame(spectral);
      rover_ = rover_start_;
    }
    return y;
  }

  void Reset() {
    if (c_ == nullptr) return;
    const uint32_t n = c_->n_;
    for (uint32_t i = 0; i < n; ++i) in_[i] = 0.0f;
    for (uint32_t i = 0; i < c_->hop_; ++i) out_[i] = 0.0f;
    for (uint32_t i = 0; i < n; ++i) acc_[i] = 0.0f;
    rover_ = rover_start_;
  }

 private:
  template <class F>
  void Frame(F& spectral) {
    StftCommon& c = *c_;
    const uint32_t n = c.n_;
    const uint32_t hop = c.hop_;
    float* sc = c.scratch_;
    const float* w = c.win_;
    for (uint32_t j = 0; j < n; ++j) sc[j] = in_[j] * w[j];
    c.fft_.Forward(sc, c.re_, c.im_);
    spectral(c.re_, c.im_);
    c.fft_.Inverse(c.re_, c.im_, sc);
    float* acc = acc_;
    for (uint32_t j = 0; j < n; ++j) acc[j] += sc[j] * w[j];
    for (uint32_t j = 0; j < hop; ++j) out_[j] = acc[j] * c.inv_norm_[j];
    for (uint32_t j = 0; j + hop < n; ++j) acc[j] = acc[j + hop];
    for (uint32_t j = n - hop; j < n; ++j) acc[j] = 0.0f;
    for (uint32_t j = 0; j + hop < n; ++j) in_[j] = in_[j + hop];
  }

  StftCommon* c_ = nullptr;
  float* in_ = nullptr;
  float* out_ = nullptr;
  float* acc_ = nullptr;
  uint32_t rover_start_ = 0, rover_ = 0;
};

}  // namespace bellows
