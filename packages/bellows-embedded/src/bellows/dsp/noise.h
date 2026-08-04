/* Transcription of src/dsp/noise.ts. The Rng is held by reference so a
 * voice's stream stays forkable and deterministic. */
#pragma once
#include <math.h>
#include "bellows/core/prng.h"

namespace bellows {

enum class NoiseColor { kWhite, kPink, kBrown, kVelvet, kCrackle };

class NoiseGen {
 public:
  void Init(float sample_rate, NoiseColor color, Rng* rng) {
    sr_ = sample_rate;
    color_ = color;
    rng_ = rng;
    velvet_p_ = 2000.0f / sample_rate;
    crackle_p_ = 8.0f / sample_rate;
    crackle_decay_ = expf(-1.0f / (0.002f * sample_rate));
  }

  void SetColor(NoiseColor c) {
    color_ = c;
    b0_ = b1_ = b2_ = b3_ = b4_ = b5_ = b6_ = 0.0f;
    brown_ = 0.0f;
    env_ = 0.0f;
    sign_ = 1.0f;
  }

  inline float Process() {
    switch (color_) {
      case NoiseColor::kWhite:
        return rng_->Bipolar();
      case NoiseColor::kPink: {
        float w = rng_->Bipolar();
        b0_ = 0.99886f * b0_ + w * 0.0555179f;
        b1_ = 0.99332f * b1_ + w * 0.0750759f;
        b2_ = 0.969f * b2_ + w * 0.153852f;
        b3_ = 0.8665f * b3_ + w * 0.3104856f;
        b4_ = 0.55f * b4_ + w * 0.5329522f;
        b5_ = -0.7616f * b5_ - w * 0.016898f;
        float pink = (b0_ + b1_ + b2_ + b3_ + b4_ + b5_ + b6_ + w * 0.5362f) * 0.11f;
        b6_ = w * 0.115926f;
        return pink;
      }
      case NoiseColor::kBrown: {
        float w = rng_->Bipolar();
        brown_ = (brown_ + 0.02f * w) / 1.02f;
        return brown_ * 3.5f;
      }
      case NoiseColor::kVelvet: {
        float r = rng_->Next();
        if (r >= velvet_p_) return 0.0f;
        return r < velvet_p_ * 0.5f ? 1.0f : -1.0f;
      }
      case NoiseColor::kCrackle: {
        if (rng_->Next() < crackle_p_) {
          env_ = 0.3f + 0.7f * rng_->Next();
          sign_ = rng_->Next() < 0.5f ? -1.0f : 1.0f;
        }
        float y = sign_ * env_;
        env_ *= crackle_decay_;
        return y;
      }
    }
    return 0.0f;
  }

 private:
  float sr_ = 48000.0f;
  NoiseColor color_ = NoiseColor::kWhite;
  Rng* rng_ = nullptr;
  float b0_ = 0, b1_ = 0, b2_ = 0, b3_ = 0, b4_ = 0, b5_ = 0, b6_ = 0;
  float brown_ = 0, env_ = 0, sign_ = 1;
  float velvet_p_ = 0, crackle_p_ = 0, crackle_decay_ = 0;
};

}  // namespace bellows
