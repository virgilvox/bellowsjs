/* Transcription of src/dsp/delayline.ts.
 *
 * Two forms. DelayLine<N> owns its buffer in .bss. DelayLineExt takes
 * caller-provided storage, so the user decides placement (DMAMEM, EXTMEM,
 * DSY_SDRAM_BSS). Nothing here allocates.
 *
 * The buffer is sized exactly, not rounded up to a power of two.
 *
 * Rounding up is the usual trick because it makes the wrap a bitwise AND,
 * and it is what this file used to do. It is also the single largest
 * consumer of RAM in the whole library, and the rounding wastes up to 49
 * percent of it: a 500 ms stereo delay at 48 kHz needs 24004 samples per
 * side and a power-of-two ring gives it 32768, so 262144 bytes are
 * reserved to hold 192032 bytes of audio. Across the plate tank, the
 * chorus and flanger lines, the pluck loop and the tube bore, that
 * rounding was costing more than every table in the library put together.
 *
 * Exact sizing costs one conditional add per read instead of the AND.
 * Every index this class forms lies in [-(cap-1), cap-1]: reads clamp the
 * delay to max_ = cap - 4, and ReadCubic reaches at most two samples
 * further back, so a single add is always enough to bring an index back
 * into range. No modulo, no loop, no division.
 *
 * The samples it returns are unchanged. The ring holds the same history at
 * the same offsets and only the modulus differs, so this is a pure memory
 * change and the parity rows should not move at all. */
#pragma once
#include <stdint.h>

namespace bellows {

class DelayLineExt {
 public:
  /* cap is exact. It no longer has to be a power of two. */
  void Init(float* buf, uint32_t cap) {
    buf_ = buf;
    cap_ = cap;
    max_ = cap - 4;
    w_ = 0;
    Clear();
  }

  void Clear() {
    for (uint32_t i = 0; i < cap_; ++i) buf_[i] = 0.0f;
    w_ = 0;
  }

  inline void Write(float x) {
    buf_[w_] = x;
    if (++w_ == static_cast<int32_t>(cap_)) w_ = 0;
  }

  inline float ReadInt(int32_t d) const {
    if (d < 0) d = 0;
    else if (d > static_cast<int32_t>(max_) + 2) d = max_ + 2;
    return buf_[Wrap(w_ - 1 - d)];
  }

  inline float ReadLinear(float d) const {
    if (d < 0.0f) d = 0.0f;
    else if (d > static_cast<float>(max_)) d = static_cast<float>(max_);
    int32_t di = static_cast<int32_t>(d);
    float f = d - static_cast<float>(di);
    float a = buf_[Wrap(w_ - 1 - di)];
    float b = buf_[Wrap(w_ - 2 - di)];
    return a + f * (b - a);
  }

  inline float ReadCubic(float d) const {
    if (d < 1.0f) d = 1.0f;
    else if (d > static_cast<float>(max_)) d = static_cast<float>(max_);
    int32_t di = static_cast<int32_t>(d);
    float f = d - static_cast<float>(di);
    int32_t base = static_cast<int32_t>(w_) - 1 - di;
    float y0 = buf_[Wrap(base + 1)];
    float y1 = buf_[Wrap(base)];
    float y2 = buf_[Wrap(base - 1)];
    float y3 = buf_[Wrap(base - 2)];
    float c1 = 0.5f * (y2 - y0);
    float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
    float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  uint32_t MaxDelay() const { return max_; }

 private:
  /* One conditional add in place of the mask. See the note at the top for
   * why a single add is always sufficient here. */
  inline uint32_t Wrap(int32_t i) const {
    return static_cast<uint32_t>(i < 0 ? i + static_cast<int32_t>(cap_) : i);
  }

  float* buf_ = nullptr;
  uint32_t cap_ = 0;
  uint32_t max_ = 0;
  int32_t w_ = 0;
};

/* Owning form. kSamples of usable delay, plus the four the cubic read
 * reaches past, and not one word more. */
template <uint32_t kSamples>
class DelayLine : public DelayLineExt {
 public:
  static constexpr uint32_t kCap = kSamples + 4;
  void Init() { DelayLineExt::Init(store_, kCap); }

 private:
  float store_[kCap];
};

}  // namespace bellows
