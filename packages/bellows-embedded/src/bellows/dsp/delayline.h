/* Transcription of src/dsp/delayline.ts.
 *
 * Two forms. DelayLine<N> owns a power-of-two buffer in .bss.
 * DelayLineExt takes caller-provided storage, so the user decides
 * placement (DMAMEM, EXTMEM, DSY_SDRAM_BSS). Nothing here allocates. */
#pragma once
#include <stdint.h>

namespace bellows {

namespace detail {
constexpr uint32_t NextPow2(uint32_t v) {
  uint32_t n = 1;
  while (n < v) n <<= 1;
  return n;
}
}  // namespace detail

class DelayLineExt {
 public:
  /* cap must be a power of two. */
  void Init(float* buf, uint32_t cap) {
    buf_ = buf;
    mask_ = cap - 1;
    max_ = cap - 4;
    w_ = 0;
    Clear();
  }

  void Clear() {
    for (uint32_t i = 0; i <= mask_; ++i) buf_[i] = 0.0f;
    w_ = 0;
  }

  inline void Write(float x) {
    buf_[w_] = x;
    w_ = (w_ + 1) & mask_;
  }

  inline float ReadInt(int32_t d) const {
    if (d < 0) d = 0;
    else if (d > static_cast<int32_t>(max_) + 2) d = max_ + 2;
    return buf_[(w_ - 1 - d) & mask_];
  }

  inline float ReadLinear(float d) const {
    if (d < 0.0f) d = 0.0f;
    else if (d > static_cast<float>(max_)) d = static_cast<float>(max_);
    int32_t di = static_cast<int32_t>(d);
    float f = d - static_cast<float>(di);
    float a = buf_[(w_ - 1 - di) & mask_];
    float b = buf_[(w_ - 2 - di) & mask_];
    return a + f * (b - a);
  }

  inline float ReadCubic(float d) const {
    if (d < 1.0f) d = 1.0f;
    else if (d > static_cast<float>(max_)) d = static_cast<float>(max_);
    int32_t di = static_cast<int32_t>(d);
    float f = d - static_cast<float>(di);
    int32_t base = static_cast<int32_t>(w_) - 1 - di;
    float y0 = buf_[(base + 1) & mask_];
    float y1 = buf_[base & mask_];
    float y2 = buf_[(base - 1) & mask_];
    float y3 = buf_[(base - 2) & mask_];
    float c1 = 0.5f * (y2 - y0);
    float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
    float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  uint32_t MaxDelay() const { return max_; }

 private:
  float* buf_ = nullptr;
  uint32_t mask_ = 0;
  uint32_t max_ = 0;
  int32_t w_ = 0;
};

/* Owning form. kSamples is rounded up to a power of two. */
template <uint32_t kSamples>
class DelayLine : public DelayLineExt {
 public:
  static constexpr uint32_t kCap = detail::NextPow2(kSamples + 4);
  void Init() { DelayLineExt::Init(store_, kCap); }

 private:
  float store_[kCap];
};

}  // namespace bellows
