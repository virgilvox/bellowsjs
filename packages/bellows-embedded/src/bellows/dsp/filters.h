/* Transcription of src/dsp/filters.ts: Svf (Simper trapezoidal SVF),
 * LadderFilter (Huovilainen, 2x internal), OnePole, DcBlocker.
 *
 * Each is its own header-visible class with no virtuals and no shared
 * base, so pulling in Svf never drags LadderFilter into the link. */
#pragma once
#include <math.h>

namespace bellows {

enum class SvfMode { kLp, kHp, kBp, kNotch, kPeak, kAllpass, kBell, kLowShelf, kHighShelf };

class Svf {
 public:
  void Init(float sample_rate) {
    sr_ = sample_rate;
    Update();
  }

  void SetMode(SvfMode m) {
    mode_ = m;
    Update();
  }

  void Set(float cutoff_hz, float q, float gain_db = 0.0f) {
    fc_ = cutoff_hz;
    q_ = q;
    gain_db_ = gain_db;
    Update();
  }

  inline float Process(float x) {
    float v3 = x - ic2_;
    float v1 = a1_ * ic1_ + a2_ * v3;
    float v2 = ic2_ + a2_ * ic1_ + a3_ * v3;
    ic1_ = 2.0f * v1 - ic1_;
    ic2_ = 2.0f * v2 - ic2_;
    return m0_ * x + m1_ * v1 + m2_ * v2;
  }

  void Reset() {
    ic1_ = 0.0f;
    ic2_ = 0.0f;
  }

 private:
  void Update() {
    float fc = fc_ < 1e-3f ? 1e-3f : (fc_ > sr_ * 0.49f ? sr_ * 0.49f : fc_);
    float q = q_ < 1e-3f ? 1e-3f : q_;
    float w = 3.14159265358979f * (fc / sr_);
    float g = tanf(w);
    float k = 1.0f / q;
    switch (mode_) {
      case SvfMode::kLp: m0_ = 0; m1_ = 0; m2_ = 1; break;
      case SvfMode::kBp: m0_ = 0; m1_ = 1; m2_ = 0; break;
      case SvfMode::kHp: m0_ = 1; m1_ = -k; m2_ = -1; break;
      case SvfMode::kNotch: m0_ = 1; m1_ = -k; m2_ = 0; break;
      case SvfMode::kPeak: m0_ = 1; m1_ = -k; m2_ = -2; break;
      case SvfMode::kAllpass: m0_ = 1; m1_ = -2 * k; m2_ = 0; break;
      case SvfMode::kBell: {
        float A = powf(10.0f, gain_db_ / 40.0f);
        k = 1.0f / (q * A);
        m0_ = 1; m1_ = k * (A * A - 1.0f); m2_ = 0;
        break;
      }
      case SvfMode::kLowShelf: {
        float A = powf(10.0f, gain_db_ / 40.0f);
        g = tanf(w) / sqrtf(A);
        m0_ = 1; m1_ = k * (A - 1.0f); m2_ = A * A - 1.0f;
        break;
      }
      case SvfMode::kHighShelf: {
        float A = powf(10.0f, gain_db_ / 40.0f);
        g = tanf(w) * sqrtf(A);
        m0_ = A * A; m1_ = k * (1.0f - A) * A; m2_ = 1.0f - A * A;
        break;
      }
    }
    a1_ = 1.0f / (1.0f + g * (g + k));
    a2_ = g * a1_;
    a3_ = g * a2_;
  }

  float sr_ = 48000.0f;
  SvfMode mode_ = SvfMode::kLp;
  float fc_ = 1000.0f, q_ = 0.70710678f, gain_db_ = 0.0f;
  float a1_ = 0, a2_ = 0, a3_ = 0, m0_ = 0, m1_ = 0, m2_ = 1;
  float ic1_ = 0, ic2_ = 0;
};

class LadderFilter {
 public:
  void Init(float sample_rate) {
    sr_ = sample_rate;
    Set(1000.0f, 0.0f);
  }

  void Set(float cutoff_hz, float resonance, float drive = 1.0f) {
    float fs2 = sr_ * 2.0f;
    float fc = cutoff_hz < 1e-3f ? 1e-3f : (cutoff_hz > sr_ * 0.45f ? sr_ * 0.45f : cutoff_hz);
    g_ = 1.0f - expf((-2.0f * 3.14159265358979f * fc) / fs2);
    float r = resonance < 0.0f ? 0.0f : (resonance > 1.05f ? 1.05f : resonance);
    k_ = 4.0f * r;
    drive_ = drive < 1e-3f ? 1e-3f : drive;
  }

  inline float Process(float x) {
    Tick(x);
    return Tick(x);
  }

  void Reset() { s1_ = s2_ = s3_ = s4_ = 0.0f; }

 private:
  inline float Tick(float x) {
    float u = tanhf(drive_ * (x - k_ * (s4_ - 0.5f * x)));
    s1_ += g_ * (u - tanhf(s1_));
    s2_ += g_ * (tanhf(s1_) - tanhf(s2_));
    s3_ += g_ * (tanhf(s2_) - tanhf(s3_));
    s4_ += g_ * (tanhf(s3_) - tanhf(s4_));
    return s4_;
  }

  float sr_ = 48000.0f, g_ = 0, k_ = 0, drive_ = 1;
  float s1_ = 0, s2_ = 0, s3_ = 0, s4_ = 0;
};

class OnePole {
 public:
  void Init(float sample_rate) {
    sr_ = sample_rate;
    SetLowpass(1000.0f);
  }
  void SetLowpass(float hz) { a_ = Coef(hz); hp_ = false; }
  void SetHighpass(float hz) { a_ = Coef(hz); hp_ = true; }
  inline float Process(float x) {
    y_ += a_ * (x - y_);
    return hp_ ? x - y_ : y_;
  }
  void Reset() { y_ = 0.0f; }

 private:
  float Coef(float hz) {
    float fc = hz < 1e-3f ? 1e-3f : (hz > sr_ * 0.49f ? sr_ * 0.49f : hz);
    return 1.0f - expf((-2.0f * 3.14159265358979f * fc) / sr_);
  }
  float sr_ = 48000.0f, a_ = 1.0f, y_ = 0.0f;
  bool hp_ = false;
};

class DcBlocker {
 public:
  void Init(float sample_rate) {
    float r = 1.0f - (0.005f * 44100.0f) / sample_rate;
    r_ = r < 0.9f ? 0.9f : (r > 0.99999f ? 0.99999f : r);
  }
  inline float Process(float x) {
    float y = x - x1_ + r_ * y1_;
    x1_ = x;
    y1_ = y;
    return y;
  }
  void Reset() { x1_ = y1_ = 0.0f; }

 private:
  float r_ = 0.995f, x1_ = 0.0f, y1_ = 0.0f;
};

}  // namespace bellows
