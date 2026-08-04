/* Transcription of src/dsp/envelopes.ts plus the ExpDecay from
 * src/engines/drums.ts. */
#pragma once
#include <math.h>

namespace bellows {

class Adsr {
 public:
  enum class Stage { kIdle, kAttack, kDecay, kSustain, kRelease };

  void Init(float sample_rate) {
    sr_ = sample_rate;
    Set(0.01f, 0.1f, 0.7f, 0.2f);
  }

  void Set(float a, float d, float s, float r) {
    a_ = Coef(a, kAttackRate);
    d_ = Coef(d, kSettleRate);
    r_ = Coef(r, kSettleRate);
    sus_ = s < 0.0f ? 0.0f : (s > 1.0f ? 1.0f : s);
  }

  void Trigger() { stage_ = Stage::kAttack; }
  void Release() { if (stage_ != Stage::kIdle) stage_ = Stage::kRelease; }
  void Reset() { stage_ = Stage::kIdle; lvl_ = 0.0f; }

  inline float Process() {
    switch (stage_) {
      case Stage::kIdle:
        return 0.0f;
      case Stage::kAttack:
        lvl_ += a_ * (kAttackTarget - lvl_);
        if (lvl_ >= 1.0f) { lvl_ = 1.0f; stage_ = Stage::kDecay; }
        return lvl_;
      case Stage::kDecay:
        lvl_ += d_ * (sus_ - lvl_);
        if (fabsf(lvl_ - sus_) < 1e-4f) { lvl_ = sus_; stage_ = Stage::kSustain; }
        return lvl_;
      case Stage::kSustain:
        lvl_ = sus_;
        return lvl_;
      case Stage::kRelease:
        lvl_ -= r_ * lvl_;
        if (lvl_ < 1e-4f) { lvl_ = 0.0f; stage_ = Stage::kIdle; }
        return lvl_;
    }
    return 0.0f;
  }

  bool Active() const { return stage_ != Stage::kIdle; }
  float Level() const { return lvl_; }

 private:
  static constexpr float kAttackTarget = 1.5f;
  static constexpr float kAttackRate = 1.09861228866811f;   /* ln 3 */
  static constexpr float kSettleRate = 4.60517018598809f;   /* ln 100 */

  float Coef(float t, float rate) const {
    if (t <= 0.0f) return 1.0f;
    return 1.0f - expf(-rate / (t * sr_));
  }

  float sr_ = 48000.0f;
  Stage stage_ = Stage::kIdle;
  float lvl_ = 0.0f, sus_ = 1.0f, a_ = 1.0f, d_ = 1.0f, r_ = 1.0f;
};

class ExpDecay {
 public:
  void Init(float sample_rate) { sr_ = sample_rate; }
  void SetTime(float sec) {
    coef_ = sec <= 0.0f ? 0.0f : expf(-6.90775527898214f / (sec * sr_));
  }
  void Trigger(float v = 1.0f) { level_ = v; }
  inline float Process() {
    float y = level_;
    level_ = y * coef_;
    return y;
  }
  float Level() const { return level_; }

 private:
  float sr_ = 48000.0f, level_ = 0.0f, coef_ = 0.0f;
};

class Smoother {
 public:
  void Init(float sample_rate, float time_sec) {
    coef_ = time_sec <= 0.0f ? 1.0f : 1.0f - expf(-1.0f / (time_sec * sample_rate));
  }
  void SetTarget(float v) { target_ = v; }
  void Snap(float v) { target_ = v; v_ = v; }
  inline float Process() {
    v_ += coef_ * (target_ - v_);
    return v_;
  }
  float Value() const { return v_; }

 private:
  float coef_ = 1.0f, target_ = 0.0f, v_ = 0.0f;
};

}  // namespace bellows
