/* Transcription of src/engines/granular.ts: a grain cloud over a mono
 * source buffer the caller owns.
 *
 * A voice keeps 64 grain slots and schedules new grains sample accurately
 * from a countdown driven by the density param. Each spawn draws four
 * values from the voice's stream (start jitter, pitch jitter, reverse,
 * pan) whatever the params are, so the stream stays aligned with the
 * TypeScript's across param changes. Grains window through a shared hann
 * table and read the buffer with linear interpolation.
 *
 * STREAM. The TypeScript voice draws from the stream the pool hands it,
 * with no fork: pass an Rng initialised with the voice's own label
 * (channel seed + "::v" + slot). The draws are taken as NextU32() / 2^32 in
 * double, which is exactly the JS value; Rng::Next() rounds to float, which
 * moves each grain's start by a few ten-thousandths of a frame and can flip
 * a reverse draw that lands next to the reverse param.
 *
 * PRECISION. Grain positions and the spawn countdown are 32.32 fixed point
 * in an int64, for the reason sampler.h gives: the TypeScript accumulates
 * them in double, and a float accumulator drifts against it. The countdown
 * matters most, because a spawn that lands one sample away from the
 * TypeScript's moves a whole grain. Spawn and note on work in double (the
 * grain length, start, step and the next countdown period), at most density
 * times a second; nothing per sample is double.
 *
 * The default TypeScript engine plays an internal one second test tone,
 * which FillTestTone writes into storage the caller provides. */
#pragma once
#include <math.h>
#include <stdint.h>
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"

namespace bellows {

namespace granular_detail {

constexpr int kHannN = 1024;

/* The shared window, 0.5 * (1 - cos(2 pi i / (N - 1))) worked in double and
 * stored as float, as the TypeScript's Float32Array holds it. Built on
 * first use, 4 KB. */
inline const float* Hann() {
  static float table[kHannN];
  static bool built = false;
  if (!built) {
    for (int i = 0; i < kHannN; ++i) {
      table[i] = static_cast<float>(0.5 * (1.0 - cos((6.283185307179586 * i) / (kHannN - 1))));
    }
    built = true;
  }
  return table;
}

}  // namespace granular_detail

class Granular {
 public:
  struct Params {
    float grain_size = 80.0f; /* ms */
    float density = 20.0f;    /* grains per second */
    float position = 0.25f;
    float spray = 0.05f;
    float pitch = 1.0f;
    float pitch_jitter = 0.0f; /* semitones */
    float spread = 0.5f;
    float reverse = 0.0f;
    float base_note = 69.0f;
    float level = 0.9f;
  };

  static constexpr int kMaxGrains = 64;

  /* The default engine's source: one second at 44.1 kHz of a 220 Hz tone
   * with its second harmonic and 10 ms edge fades. */
  static constexpr uint32_t kTestToneFrames = 44100;
  static constexpr float kTestToneRate = 44100.0f;

  static void FillTestTone(float* out) {
    const uint32_t n = kTestToneFrames;
    const uint32_t fade = 441; /* Math.round(0.01 * n) */
    const double two_pi = 6.283185307179586;
    for (uint32_t i = 0; i < n; ++i) {
      const double t = static_cast<double>(i) / 44100.0;
      double a = 1.0;
      if (i < fade) a = static_cast<double>(i) / fade;
      else if (i > n - fade) a = static_cast<double>(n - i) / fade;
      out[i] = static_cast<float>(a * (0.7 * sin(two_pi * 220.0 * t) + 0.2 * sin(two_pi * 440.0 * t)));
    }
  }

  void Init(float sample_rate, Rng* rng, const float* buffer, uint32_t frames, float buffer_rate) {
    Params d;
    Init(sample_rate, rng, buffer, frames, buffer_rate, d);
  }

  void Init(float sample_rate, Rng* rng, const float* buffer, uint32_t frames, float buffer_rate,
            const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    rng_ = rng;
    buf_ = buffer;
    frames_ = buffer ? frames : 0;
    buf_rate_ = buffer_rate;
    win_ = granular_detail::Hann();
    p_ = p;
    for (auto& g : grains_) g.live = false;
    live_grains_ = 0;
    gate_ = false;
    countdown_ = 0;
  }

  /* Live change, as setParam does in the JS: every param is read at the
   * next spawn, density also sets the next countdown period, and level is
   * read every sample. */
  void SetParams(const Params& p) { p_ = p; }

  void NoteOn(float freq, float vel) {
    vel_ = Clamp(vel, 0.0f, 1.0f);
    gate_ = true;
    /* mtof(baseNote), then the rate ratio, in double as the JS has it */
    const double base = 440.0 * exp2((static_cast<double>(p_.base_note) - 69.0) / 12.0);
    rate_base_ = (static_cast<double>(freq) / base) * (static_cast<double>(buf_rate_) / sr_);
    countdown_ = 0;
    for (auto& g : grains_) g.live = false;
    live_grains_ = 0;
  }

  void NoteOff() { gate_ = false; }

  void Process(float* l, float* r, int from, int to) {
    if (!gate_ && live_grains_ == 0) return;
    const int64_t last = (static_cast<int64_t>(frames_) - 2) * kOne;
    const float win_scale = static_cast<float>(granular_detail::kHannN - 1);
    const float level = p_.level;
    for (int i = from; i < to; ++i) {
      if (gate_) {
        countdown_ -= kOne;
        while (countdown_ <= 0) {
          Spawn();
          const double density = ClampD(p_.density, 0.5, 400.0);
          countdown_ += ToFixed(static_cast<double>(sr_) / density);
        }
      }
      float sl = 0.0f, sr = 0.0f;
      for (auto& g : grains_) {
        if (!g.live) continue;
        const float wi = (static_cast<float>(g.age) / static_cast<float>(g.dur)) * win_scale;
        const int w_idx = static_cast<int>(wi);
        const float wf = wi - static_cast<float>(w_idx);
        const float w = win_[w_idx] + wf * (win_[w_idx + 1] - win_[w_idx]);
        const int64_t pi = g.pos >> 32;
        const float pf = static_cast<float>(static_cast<uint32_t>(g.pos)) * kPhaseToUnit;
        const float s = (buf_[pi] + pf * (buf_[pi + 1] - buf_[pi])) * w * g.amp;
        sl += s * g.gl;
        sr += s * g.gr;
        g.pos += g.step;
        g.age++;
        if (g.age >= g.dur - 1 || g.pos < 0 || g.pos >= last) {
          g.live = false;
          live_grains_--;
        }
      }
      l[i] += sl * level;
      r[i] += sr * level;
    }
  }

  bool Active() const { return gate_ || live_grains_ > 0; }

 private:
  static constexpr int64_t kOne = static_cast<int64_t>(1) << 32;

  struct Grain {
    bool live = false;
    int64_t pos = 0, step = 0; /* frames, 32.32 */
    int32_t age = 0, dur = 0;
    float amp = 0.0f, gl = 0.0f, gr = 0.0f;
  };

  /* Frames to 32.32, NaN to 0 and magnitudes bounded at 2^30 frames, as in
   * sampler.h, so the conversion is always defined and a position plus a
   * step cannot overflow. */
  static int64_t ToFixed(double frames) {
    if (!(frames == frames)) return 0;
    const double lim = 1073741824.0;
    const double f = frames > lim ? lim : (frames < -lim ? -lim : frames);
    return static_cast<int64_t>(floor(f * 4294967296.0 + 0.5));
  }

  /* clamp() in double, NaN to lo */
  static double ClampD(double v, double lo, double hi) { return !(v >= lo) ? lo : (v > hi ? hi : v); }

  /* rng() in the JS: the u32 over 2^32, exact in double */
  double Draw() { return static_cast<double>(rng_->NextU32()) * (1.0 / 4294967296.0); }

  void Spawn() {
    /* fixed draw order and count keeps the stream aligned across params */
    const double pos_jit = 2.0 * Draw() - 1.0;
    const double pitch_jit = 2.0 * Draw() - 1.0;
    const double rev_draw = Draw();
    const double pan_draw = 2.0 * Draw() - 1.0;

    Grain* slot = nullptr;
    for (auto& g : grains_) {
      if (!g.live) {
        slot = &g;
        break;
      }
    }
    if (!slot || frames_ < 2) return; /* cloud saturated, drop the grain */

    const double dur_sec = ClampD(p_.grain_size, 10.0, 500.0) / 1000.0;
    const double dur = floor(dur_sec * sr_ + 0.5);
    const double start = ClampD(p_.position + ClampD(p_.spray, 0.0, 1.0) * pos_jit, 0.0, 1.0);
    double step = rate_base_ * ClampD(p_.pitch, 0.25, 4.0);
    const double jitter = ClampD(p_.pitch_jitter, 0.0, 12.0) * pitch_jit;
    if (jitter != 0.0) step *= exp2(jitter / 12.0);
    if (rev_draw < ClampD(p_.reverse, 0.0, 1.0)) step = -step;

    const double pan = 0.5 + 0.5 * ClampD(p_.spread, 0.0, 1.0) * pan_draw;
    const float theta = static_cast<float>(pan * 1.5707963267948966);

    slot->live = true;
    slot->pos = ToFixed(start * (static_cast<double>(frames_) - 2.0));
    slot->step = ToFixed(step);
    slot->age = 0;
    slot->dur = dur > 2.0 ? static_cast<int32_t>(dur) : 2;
    const double cloud = p_.density * dur_sec;
    slot->amp = static_cast<float>(vel_ / sqrt(cloud > 1.0 ? cloud : 1.0));
    slot->gl = fm::Cos(theta);
    slot->gr = fm::Sin(theta);
    live_grains_++;
  }

  float sr_ = 48000.0f;
  Rng* rng_ = nullptr;
  const float* buf_ = nullptr;
  uint32_t frames_ = 0;
  float buf_rate_ = 44100.0f;
  const float* win_ = nullptr;
  Params p_;
  Grain grains_[kMaxGrains];
  int live_grains_ = 0;
  bool gate_ = false;
  float vel_ = 1.0f;
  double rate_base_ = 1.0;
  int64_t countdown_ = 0;
};

}  // namespace bellows
