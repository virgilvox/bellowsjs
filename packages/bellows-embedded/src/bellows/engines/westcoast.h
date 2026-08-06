/* Transcription of src/engines/westcoast.ts.
 *
 * Triangle core oscillator into an iterated wavefolder into a low pass
 * gate. The fold gain rides an Adsr (fold_env sets how much of it), so
 * notes open up and relax like a Buchla timbre sweep.
 *
 * The low pass gate is an Svf lowpass whose cutoff and level both follow
 * a vactrol model: two cascaded one poles with a fast rise and a slow,
 * level dependent fall. The time constant grows as the stage level drops
 * (tau1 = decay * (0.2 + 0.8 * (1 - s1))), which is what gives a real
 * vactrol its behaviour of letting go quickly from bright and then
 * crawling through the dark tail. lpg_color 0 is a plain VCA (filter
 * open, level follows the vactrol), 1 is all filter (cutoff follows,
 * level barely). lpg_decay sets the fall time scale.
 *
 * The JS interpolates the cutoff geometrically with exp(log a * (1 - c)
 * + log b * c). Here the same interpolation runs in log2, because the
 * two endpoints are constants whose log2 can be written down (16000 and
 * the vactrol curve 40 * 500^v), so a per-control-tick pow and two logs
 * collapse into one Exp2.
 *
 * Fall coefficients, the Svf and the output gain refresh once every 16
 * samples; the vactrol state itself ticks every sample, so the envelope
 * shape is unchanged.
 */
#pragma once
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/oscillators.h"
#include "bellows/dsp/oversample.h"
#include "bellows/dsp/waveshaper.h"

namespace bellows {

class WestCoast {
 public:
  struct Params {
    float fold_amount = 0.35f;
    float fold_stages = 2.0f;
    float fold_env = 0.5f;
    float lpg_color = 0.7f;
    float lpg_decay = 0.5f;
    float level = 0.8f;
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    p_ = p;
    osc_.Init(sample_rate);
    osc_.SetShape(BlepShape::kTriangle);
    lpg_.Init(sample_rate);
    lpg_.SetMode(SvfMode::kLp);
    os_.Init();
    fold_env_gen_.Init(sample_rate);
    fold_env_gen_.Set(0.003f, 0.25f, 0.5f, 0.12f);
    rise1_ = 1.0f - fm::Exp(-1.0f / (0.0015f * sample_rate));
    rise2_ = 1.0f - fm::Exp(-1.0f / (0.003f * sample_rate));
  }

  void SetParams(const Params& p) { p_ = p; }

  void NoteOn(float freq, float vel) {
    vel_ = Clamp(vel, 0.0f, 1.0f);
    gate_ = true;
    live_ = true;
    osc_.SetFreq(freq);
    osc_.Reset(0.0f);
    lpg_.Reset();
    s1_ = 0.0f;
    s2_ = 0.0f;
    ctrl_ = 0;
    fold_env_gen_.Reset();
    fold_env_gen_.Trigger();
  }

  void NoteOff() {
    gate_ = false;
    fold_env_gen_.Release();
  }

  void Process(float* l, float* r, int from, int to) {
    if (!live_) return;
    int stages = ClampI(static_cast<int>(p_.fold_stages + 0.5f), 1, 6);
    float fold_amt = Clamp(p_.fold_amount, 0.0f, 1.0f);
    float env_mix = Clamp(p_.fold_env, 0.0f, 1.0f);
    float level = p_.level * vel_;
    /* Chunked so a chunk never crosses a control tick, which is what keeps
     * the low pass gate at the base rate: inside a chunk the Svf
     * coefficients and amp_ do not move, so only the fold needs 4x. */
    int i = from;
    while (i < to) {
      if (ctrl_ <= 0) {
        Control();
        ctrl_ = kCtrl;
      }
      int n = to - i;
      if (n > ctrl_) n = ctrl_;
      if (n > kOsBlock) n = kOsBlock;

      for (int j = 0; j < n; ++j) {
        /* vactrol tick: fast rise toward the gate, slow nonlinear fall */
        float target = gate_ ? vel_ : 0.0f;
        s1_ += (target > s1_ ? rise1_ : fall1_) * (target - s1_);
        s2_ += (s1_ > s2_ ? rise2_ : fall2_) * (s1_ - s2_);

        float fe = fold_env_gen_.Process();
        gain_buf_[j] = 1.0f + fold_amt * kMaxFold * (1.0f - env_mix + env_mix * fe);
        osc_buf_[j] = osc_.ProcessTriangle();
      }

      /* One fold gain per INPUT sample, held across its four oversampled
       * ones. The gain is an envelope, so a zero order hold on it is
       * inaudible; the corner in Foldback is what needed the headroom. */
      float* up = os_.Up(osc_buf_, 0, n);
      for (int j = 0; j < n; ++j) {
        float gain = gain_buf_[j];
        const int base = j * 4;
        for (int k = 0; k < 4; ++k) {
          float x = up[base + k];
          for (int s = 0; s < stages; ++s) x = Foldback(x, gain);
          up[base + k] = x;
        }
      }
      os_.Down(up, fold_buf_, 0, n);

      const float amp = amp_;
      for (int j = 0; j < n; ++j) {
        float o = lpg_.Process(fold_buf_[j]) * amp * level;
        l[i + j] += o;
        r[i + j] += o;
      }

      ctrl_ -= n;
      i += n;
    }
    if (!gate_ && s2_ < kSilence && s1_ < kSilence) live_ = false;
  }

  bool Active() const { return live_; }

 private:
  static constexpr float kSilence = 1e-4f;
  /* Control rate divider for the vactrol fall coefficients and the Svf. */
  static constexpr int kCtrl = 16;
  /*
   * The fold chain runs at 4x, mirroring src/engines/westcoast.ts.
   *
   * Foldback is a periodic triangle wrap, so every fold is an infinite-slope
   * corner and each of the up-to-six stages multiplies the harmonic count
   * again. Measured in the TypeScript at the shipped default, alias energy
   * against harmonic energy went from -47.0 dB to -72.8 dB at 110 Hz and
   * from -10.6 dB to -34.6 dB at 1760 Hz. 16x was measured too and bought
   * nothing further at the default, so 4x is where the curve flattens.
   *
   * Blocks are bounded by kCtrl because the chunk loop never crosses a
   * control tick.
   */
  static constexpr int kOsBlock = kCtrl;
  static constexpr float kMaxFold = 7.0f;
  /* log2(16000): the cutoff with the gate wide open. */
  static constexpr float kOpenLog2 = 13.965784284662087f;
  /* The vactrol cutoff curve 40 * 500^v, in log2. */
  static constexpr float kVactrolBaseLog2 = 5.321928094887363f;  /* log2 40  */
  static constexpr float kVactrolSpanLog2 = 8.965784284662087f;  /* log2 500 */

  /* Refresh the level dependent fall coefficients, the Svf, and the gain. */
  void Control() {
    float decay = Clamp(p_.lpg_decay, 0.02f, 5.0f);
    /* Vactrol fall slows as the light fades: the time constant grows as
     * the stage level drops, which is the nonlinear tail. */
    float tau1 = decay * (0.2f + 0.8f * (1.0f - s1_));
    float tau2 = decay * 0.35f * (0.3f + 0.7f * (1.0f - s2_));
    fall1_ = 1.0f - fm::Exp(-1.0f / (tau1 * sr_));
    fall2_ = 1.0f - fm::Exp(-1.0f / (tau2 * sr_));

    float v = Clamp(s2_, 0.0f, 1.0f);
    float color = Clamp(p_.lpg_color, 0.0f, 1.0f);
    /* cutoff: fully open at color 0, riding the vactrol at color 1 */
    float vactrol_log2 = kVactrolBaseLog2 + v * kVactrolSpanLog2;
    lpg_.Set(fm::Exp2(kOpenLog2 * (1.0f - color) + vactrol_log2 * color), 0.6f);
    /* level: linear-in-vactrol VCA at color 0, mostly filter at color 1 */
    amp_ = fm::Pow(v, 1.0f - 0.7f * color);
  }

  float sr_ = 48000.0f;
  Params p_;
  BlepOsc osc_;
  /* Preallocated, like everything else here: nothing allocates. */
  Oversampler<4, kOsBlock> os_;
  float osc_buf_[kOsBlock] = {};
  float gain_buf_[kOsBlock] = {};
  float fold_buf_[kOsBlock] = {};
  Svf lpg_;
  Adsr fold_env_gen_;

  /* vactrol: gate -> stage1 -> stage2 */
  float s1_ = 0.0f, s2_ = 0.0f;
  float rise1_ = 0.0f, rise2_ = 0.0f;
  float fall1_ = 0.0f, fall2_ = 0.0f;
  int ctrl_ = 0;
  float amp_ = 0.0f;

  float vel_ = 1.0f;
  bool gate_ = false, live_ = false;
};

}  // namespace bellows
