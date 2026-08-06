/* Transcription of src/engines/modal.ts.
 *
 * A bank of up to 24 exponentially decaying two pole resonators,
 * y = 2 r cos(w) y1 - r^2 y2 + g x, excited by a short strike burst.
 * The radius comes from the T60: r = exp(-ln(1000) / (T60 * fs)), which
 * is the definition of a 60 dB decay in T60 seconds, and ln(1000) is
 * where the 6.907755 comes from. Mode gains are multiplied by sin(w) to
 * normalize the two pole's resonant gain, so the table gain sets the
 * ring amplitude directly rather than being tilted by frequency.
 *
 * The material param picks a preset mode table (frequency ratios, per
 * mode gains, per mode decay scaling): 0 bar (free-free ratios),
 * 1 membrane (Bessel ratios), 2 bell (with the minor third partial at
 * 2.4), 3 glass, 4 wood. strike_hardness shortens and sharpens the
 * strike pulse (harder = brighter), decay scales every mode's T60,
 * brightness tilts mode gains around the fundamental, and the NoteOn
 * frequency scales the whole bank. Modes that would land above 0.45 fs
 * are muted rather than aliased.
 *
 * Two departures from the JS, both for memory. The material tables are
 * ragged there and fixed width here: every material carries a count plus
 * padded arrays of eight, since the widest shipped material (membrane)
 * has eight modes. A count plus fixed rows beats an array of pointers
 * because it stays one contiguous .rodata blob with no relocations.
 * Second, the JS precomputes the strike pulse into a Float32Array at
 * NoteOn (about 1.1 KB per voice at 48 kHz); here the raised cosine is
 * evaluated as it is consumed. The rng draw order inside a note is
 * unchanged, so the excitation is identical, and a voice costs no strike
 * buffer at all.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"

namespace bellows {

/* State is sized for 24 modes so a user can extend the tables without
 * touching the voice; the shipped materials use at most eight. */
inline constexpr int kModalMaxModes = 24;
inline constexpr int kModalTableModes = 8;

struct ModalMaterial {
  uint8_t count;
  /* Overall decay multiplier for the material. */
  float decay_base;
  float ratios[kModalTableModes];
  float gains[kModalTableModes];
  /* Per mode T60 multiplier relative to the base decay. */
  float decays[kModalTableModes];
};

inline constexpr ModalMaterial kModalMaterials[] = {
    /* Free-free bar transverse modes. */
    {6,
     1.0f,
     {1.0f, 2.756f, 5.404f, 8.933f, 13.345f, 18.638f, 0.0f, 0.0f},
     {1.0f, 0.7f, 0.45f, 0.3f, 0.18f, 0.1f, 0.0f, 0.0f},
     {1.0f, 0.7f, 0.5f, 0.35f, 0.25f, 0.18f, 0.0f, 0.0f}},
    /* Circular membrane, Bessel zero ratios. */
    {8,
     0.4f,
     {1.0f, 1.594f, 2.136f, 2.296f, 2.653f, 2.918f, 3.156f, 3.501f},
     {1.0f, 0.8f, 0.65f, 0.5f, 0.4f, 0.32f, 0.25f, 0.2f},
     {1.0f, 0.85f, 0.7f, 0.65f, 0.55f, 0.5f, 0.45f, 0.4f}},
    /* Bell partials with the minor third at 2.4. */
    {6,
     1.8f,
     {1.0f, 2.0f, 2.4f, 3.0f, 4.5f, 5.33f, 0.0f, 0.0f},
     {1.0f, 0.85f, 0.6f, 0.5f, 0.3f, 0.25f, 0.0f, 0.0f},
     {1.0f, 0.8f, 0.7f, 0.55f, 0.4f, 0.35f, 0.0f, 0.0f}},
    /* Glass: sparse, nearly undamped upper modes. */
    {5,
     1.3f,
     {1.0f, 2.32f, 4.25f, 6.63f, 9.38f, 0.0f, 0.0f, 0.0f},
     {1.0f, 0.55f, 0.3f, 0.18f, 0.1f, 0.0f, 0.0f, 0.0f},
     {1.0f, 0.75f, 0.5f, 0.35f, 0.25f, 0.0f, 0.0f, 0.0f}},
    /* Wood: fast decay, faster still in the upper modes. */
    {5,
     0.12f,
     {1.0f, 2.572f, 4.644f, 6.984f, 9.723f, 0.0f, 0.0f, 0.0f},
     {1.0f, 0.6f, 0.35f, 0.2f, 0.12f, 0.0f, 0.0f, 0.0f},
     {1.0f, 0.35f, 0.18f, 0.1f, 0.06f, 0.0f, 0.0f, 0.0f}},
};

inline constexpr int kModalMaterialCount =
    static_cast<int>(sizeof(kModalMaterials) / sizeof(kModalMaterials[0]));

class Modal {
 public:
  struct Params {
    float material = 0.0f;
    float decay = 2.0f;
    float brightness = 0.5f;
    float strike_hardness = 0.6f;
    float level = 0.6f;
  };

  void Init(float sample_rate, Rng* rng) {
    Params d;
    Init(sample_rate, rng, d);
  }

  void Init(float sample_rate, Rng* rng, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    rng_ = rng;
    p_ = p;
    track_coef_ = fm::Exp(-1.0f / (kTrackTau * sample_rate));
  }

  void SetParams(const Params& p) {
    p_ = p;
    if (live_) UpdateModes();
  }

  void NoteOn(float freq, float vel) {
    freq_ = Clamp(freq, 20.0f, sr_ * 0.4f);
    vel_ = Clamp(vel, 0.0f, 1.0f);
    gate_ = true;
    live_ = true;
    for (int k = 0; k < kModalMaxModes; ++k) {
      y1_[k] = 0.0f;
      y2_[k] = 0.0f;
    }
    UpdateModes();

    /* Raised cosine strike pulse, unit area, so mode amplitudes stay
     * comparable across hardness. Softer = longer = darker. */
    float hard = Clamp(p_.strike_hardness, 0.0f, 1.0f);
    float dur_sec = 0.004f * fm::Pow(0.1f, hard); /* 0.0004 / 0.004 */
    int len = static_cast<int>(dur_sec * sr_ + 0.5f);
    if (len < 2) len = 2;
    strike_len_ = len;
    strike_pos_ = 0;
    strike_amp_ = (2.0f * vel_) / static_cast<float>(len);
    strike_w_ = kTwoPi / static_cast<float>(len);
    tracker_ = vel_ > 0.01f ? vel_ : 0.01f;
  }

  void NoteOff() {
    gate_ = false;
    /* Cap decay so gated playing damps the tail. */
    UpdateModes();
  }

  void Process(float* l, float* r, int from, int to) {
    if (!live_) return;
    const float level = p_.level;
    const int count = mode_count_;
    for (int i = from; i < to; ++i) {
      float x = 0.0f;
      if (strike_pos_ < strike_len_) {
        float shape = 0.5f * (1.0f - fm::Cos(strike_w_ * static_cast<float>(strike_pos_)));
        float jitter = 1.0f + 0.25f * rng_->Bipolar();
        x = shape * jitter * strike_amp_;
        ++strike_pos_;
      }
      float sum = 0.0f;
      for (int k = 0; k < count; ++k) {
        float y = c1_[k] * y1_[k] - c2_[k] * y2_[k] + g_[k] * x;
        y2_[k] = y1_[k];
        y1_[k] = y;
        sum += y;
      }
      float o = sum * level;
      l[i] += o;
      r[i] += o;
      float as = sum < 0.0f ? -sum : sum;
      tracker_ = as > tracker_ ? as : tracker_ * track_coef_;
    }
    if (tracker_ < kSilence && strike_pos_ >= strike_len_) live_ = false;
  }

  bool Active() const { return live_; }

 private:
  static constexpr float kTrackTau = 0.06f;
  static constexpr float kSilence = 1e-4f;
  /* Decay cap applied at NoteOff, seconds. */
  static constexpr float kReleaseT60 = 0.3f;

  void UpdateModes() {
    const ModalMaterial& mat =
        kModalMaterials[ClampI(static_cast<int>(floorf(p_.material)), 0, kModalMaterialCount - 1)];
    float tilt = 2.0f * (Clamp(p_.brightness, 0.0f, 1.0f) - 0.5f);
    int count = mat.count < kModalMaxModes ? mat.count : kModalMaxModes;
    mode_count_ = count;
    for (int k = 0; k < count; ++k) {
      float f = freq_ * mat.ratios[k];
      if (f >= sr_ * 0.45f) {
        c1_[k] = 0.0f;
        c2_[k] = 0.0f;
        g_[k] = 0.0f;
        continue;
      }
      float w = (kTwoPi * f) / sr_;
      float t60 = Clamp(p_.decay, 0.05f, 30.0f) * mat.decay_base * mat.decays[k];
      if (!gate_ && t60 > kReleaseT60) t60 = kReleaseT60;
      float r = fm::Exp(-kLn1000 / (t60 * sr_));
      c1_[k] = 2.0f * r * fm::Cos(w);
      c2_[k] = r * r;
      g_[k] = mat.gains[k] * fm::Pow(mat.ratios[k], tilt) * fm::Sin(w);
    }
  }

  float sr_ = 48000.0f;
  Rng* rng_ = nullptr;
  Params p_;

  float c1_[kModalMaxModes] = {};
  float c2_[kModalMaxModes] = {};
  float g_[kModalMaxModes] = {};
  float y1_[kModalMaxModes] = {};
  float y2_[kModalMaxModes] = {};
  int mode_count_ = 0;

  int strike_len_ = 0, strike_pos_ = 0;
  float strike_amp_ = 0.0f, strike_w_ = 0.0f;

  float freq_ = 220.0f, vel_ = 1.0f;
  bool gate_ = false, live_ = false;
  float tracker_ = 0.0f, track_coef_ = 0.0f;
};

}  // namespace bellows
