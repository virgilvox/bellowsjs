/* Transcription of src/engines/sampler.ts: sample playback over zones of
 * audio the caller owns.
 *
 * A SampleZone points at float frames (flash arrays on a board, module
 * memory in the WebAssembly build) and carries the mapping the TypeScript
 * zone carries. A SamplerBank is a view over an array of them plus the round
 * robin counter; it owns nothing. Sampler is the voice: up to eight zones
 * layered per note, each read with the TypeScript's 4-point Catmull-Rom,
 * looped with its equal power crossfade, and shaped by the zone's AHDSR or
 * the voice's ADSR params.
 *
 * ROUND ROBIN STATE lives in the SamplerBank, not in the voice. The
 * TypeScript keeps one counter per makeSamplerEngine call and every voice
 * that def creates advances it on every note on, so successive notes cycle
 * across pooled voices, and two channels built from the same registered
 * bank share it. Give every voice of every channel playing one bank the same
 * SamplerBank and the cycle is the browser's.
 *
 * PRECISION. The TypeScript read position is a double. A float one loses
 * part of every increment to rounding once the position is in the
 * thousands, and the loss is systematic, so the pitch audibly drifts against
 * the reference over a long note. The position here is 32.32 fixed point in
 * an int64: the increment is exact for the life of the note, and only its
 * rounding to 2^-32 of a frame remains. The playback rate is worked out in
 * double at note on (one log2 per note, one exp2 per layer), because the
 * float version of the same formula is several ulps out, and that error is a
 * fixed pitch offset that accumulates exactly like the one the fixed point
 * removes. Measured on the sampler row of packages/bellows-wasm/test/banks.mjs:
 * 2.1e-3 with the note on in float, 4.8e-5 in double. The two double calls
 * cost 3.9 KB of flash on Cortex-M7 and 4.8 KB on Cortex-M4 over their float
 * forms (arm-none-eabi-g++ 11.3.1, the size report's flags). Nothing per
 * sample is double.
 *
 * Not carried over: the bank's velocity crossfade (SamplerBankOptions
 * velXfade). The kernel builds registered banks with the default of 0, a
 * hard switch, which is what ZonesFor does. A zone with no frames matches
 * and takes its layer slot as in the TypeScript but stays silent, where the
 * TypeScript reads an empty array once and emits one NaN sample. */
#pragma once
#include <math.h>
#include <stdint.h>
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/envelopes.h"

namespace bellows {

enum class LoopMode : uint8_t { kNone = 0, kLoop = 1, kLoopRelease = 2 };

/* Zone amplitude envelope, times in seconds, sustain 0..1 linear. */
struct SampleZoneEnv {
  float attack = 0.0f, hold = 0.0f, decay = 0.0f, sustain = 1.0f, release = 0.0f;
};

/* One zone: the TypeScript SampleZone with each optional field split into
 * a flag and a value. The defaults are what the TypeScript reads for an
 * absent field. data_r non-null makes the zone stereo, and both channels
 * are `frames` long. Loop points are frames, and a float holds them exactly
 * up to 2^24 (six minutes at 44.1 kHz). */
struct SampleZone {
  const float* data = nullptr;
  const float* data_r = nullptr;
  uint32_t frames = 0;
  float sample_rate = 44100.0f;
  float root_key = 60.0f;
  float fine_tune = 0.0f; /* cents, positive plays sharper */
  float key_lo = 0.0f, key_hi = 127.0f;
  float vel_lo = 0.0f, vel_hi = 127.0f;
  bool has_loop_start = false, has_loop_end = false;
  float loop_start = 0.0f; /* inclusive */
  float loop_end = 0.0f;   /* exclusive */
  LoopMode loop_mode = LoopMode::kNone;
  float gain_db = 0.0f;
  float pan = 0.0f;
  bool has_env = false;
  SampleZoneEnv env;
  bool has_round_robin = false;
  float round_robin_group = 0.0f;
  float seq_position = 1.0f; /* 1-based slot in the cycle */
};

/* The zones of one instrument and the round robin counter every voice
 * playing them shares. A view: the zones and their audio stay the
 * caller's, and must outlive every voice given this bank. */
class SamplerBank {
 public:
  void Init(const SampleZone* zones, int count) {
    zones_ = zones;
    count_ = zones ? count : 0;
    rr_ = 0;
  }

  int Count() const { return count_; }

  /* The counter value for the next note, advanced as the TypeScript's
   * `this.rr.count++` is: once per note on, whatever it matches. */
  uint32_t NextRoundRobin() { return rr_++; }

  /* zonesFor in the TypeScript, into out[0 .. max): every zone outside a
   * round robin group that matches, in bank order, then for each group in
   * the order its first matching member appears, the member at rr modulo
   * the group's matching size after a stable sort by seq_position. Returns
   * how many it wrote. Note on rate, no allocation. */
  int ZonesFor(int key, int vel, uint32_t rr, const SampleZone** out, int max) const {
    int n = 0;
    for (int j = 0; j < count_ && n < max; ++j) {
      const SampleZone& z = zones_[j];
      if (!Matches(z, key, vel) || z.has_round_robin) continue;
      out[n++] = &z;
    }
    for (int j = 0; j < count_ && n < max; ++j) {
      const SampleZone& z = zones_[j];
      if (!Matches(z, key, vel) || !z.has_round_robin) continue;
      if (SeenGroupBefore(j, key, vel)) continue;
      /* matching members of this group, from its first one on */
      uint32_t size = 0;
      for (int k = j; k < count_; ++k) {
        if (InGroup(zones_[k], z.round_robin_group, key, vel)) ++size;
      }
      const uint32_t want = rr % size;
      for (int k = j; k < count_; ++k) {
        if (!InGroup(zones_[k], z.round_robin_group, key, vel)) continue;
        if (RankInGroup(k, j, key, vel) == want) {
          out[n++] = &zones_[k];
          break;
        }
      }
    }
    return n;
  }

 private:
  static bool Matches(const SampleZone& z, int key, int vel) {
    const float k = static_cast<float>(key);
    const float v = static_cast<float>(vel);
    return !(k < z.key_lo || k > z.key_hi) && !(v < z.vel_lo || v > z.vel_hi);
  }

  static bool InGroup(const SampleZone& z, float group, int key, int vel) {
    return z.has_round_robin && z.round_robin_group == group && Matches(z, key, vel);
  }

  bool SeenGroupBefore(int j, int key, int vel) const {
    for (int k = 0; k < j; ++k) {
      if (InGroup(zones_[k], zones_[j].round_robin_group, key, vel)) return true;
    }
    return false;
  }

  /* Position of member k in the group's stable sort by seq_position: the
   * members that sort before it, by a smaller position or an equal one
   * earlier in the bank. first is the group's first matching member. */
  uint32_t RankInGroup(int k, int first, int key, int vel) const {
    const float group = zones_[k].round_robin_group;
    const float seq = zones_[k].seq_position;
    uint32_t rank = 0;
    for (int m = first; m < count_; ++m) {
      if (m == k || !InGroup(zones_[m], group, key, vel)) continue;
      const float s = zones_[m].seq_position;
      if (s < seq || (s == seq && m < k)) ++rank;
    }
    return rank;
  }

  const SampleZone* zones_ = nullptr;
  int count_ = 0;
  uint32_t rr_ = 0;
};

/* Adsr plus a hold stage, HoldAdsr in the TypeScript: once the attack
 * reaches peak the level stays at 1 for the hold time, then the Adsr
 * resumes with its decay. Release cancels any pending hold. */
class HoldAdsr {
 public:
  void Init(float sample_rate) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    adsr_.Init(sr_);
    hold_samples_ = 0;
    hold_left_ = 0;
    peaked_ = false;
  }

  void Set(float attack, float hold, float decay, float sustain, float release) {
    /* the TypeScript Adsr ignores a call carrying any non-finite argument */
    if (isfinite(attack) && isfinite(decay) && isfinite(sustain) && isfinite(release)) {
      adsr_.Set(attack, decay, sustain, release);
    }
    /* Math.max(0, Math.round(hold * rate)), bounded so the cast is defined */
    const float h = floorf(hold * sr_ + 0.5f);
    hold_samples_ = h > 0.0f ? (h < 1.0e9f ? static_cast<int32_t>(h) : 1000000000) : 0;
  }

  void Trigger() {
    adsr_.Reset();
    adsr_.Trigger();
    hold_left_ = 0;
    peaked_ = false;
  }

  void Release() {
    hold_left_ = 0;
    peaked_ = true;
    adsr_.Release();
  }

  inline float Next() {
    if (hold_left_ > 0) {
      --hold_left_;
      return 1.0f;
    }
    const float v = adsr_.Process();
    if (!peaked_ && v >= 1.0f) {
      peaked_ = true;
      hold_left_ = hold_samples_;
    }
    return v;
  }

  bool Active() const { return hold_left_ > 0 || adsr_.Active(); }

 private:
  float sr_ = 48000.0f;
  Adsr adsr_;
  int32_t hold_samples_ = 0, hold_left_ = 0;
  bool peaked_ = false;
};

class Sampler {
 public:
  struct Params {
    float attack = 0.002f;
    float decay = 0.1f;
    float sustain = 1.0f;
    float release = 0.25f;
    float loop_xfade = 8.0f; /* ms */
    float veltrack = 100.0f; /* % */
    float gain = 0.0f;       /* dB */
    float pan = 0.0f;
  };

  static constexpr int kMaxLayers = 8;

  void Init(float sample_rate, SamplerBank* bank) {
    Params d;
    Init(sample_rate, bank, d);
  }

  void Init(float sample_rate, SamplerBank* bank, const Params& p) {
    sr_ = SafeRate(sample_rate, static_cast<float>(BELLOWS_SAMPLE_RATE));
    bank_ = bank;
    p_ = p;
    for (auto& lay : layers_) {
      lay.zone = nullptr;
      lay.playing = false;
      lay.env.Init(sr_);
    }
  }

  /* Live change, as setParam does in the JS: the four envelope params
   * reshape the layers that play on the voice's envelope (a zone with its
   * own keeps it); the rest are read at the next note on. */
  void SetParams(const Params& p) {
    p_ = p;
    for (auto& lay : layers_) {
      if (lay.playing && lay.zone && !lay.zone->has_env) {
        lay.env.Set(p_.attack, 0.0f, p_.decay, p_.sustain, p_.release);
      }
    }
  }

  void NoteOn(float freq, float vel) {
    /* ftom, in double: see PRECISION above */
    const double played = 69.0 + 12.0 * log2(static_cast<double>(freq) / 440.0);
    const int key = RoundClampKey(played);
    const float v127 = Clamp(floorf(vel * 127.0f + 0.5f), 0.0f, 127.0f);
    const int vel127 = static_cast<int>(v127);
    const SampleZone* zones[kMaxLayers];
    const uint32_t rr = bank_ ? bank_->NextRoundRobin() : 0u;
    const int n = bank_ ? bank_->ZonesFor(key, vel127, rr, zones, kMaxLayers) : 0;
    const float vel_gain = 1.0f - (p_.veltrack / 100.0f) * (1.0f - vel * vel);
    const float engine_gain = fm::DbToGain(p_.gain) * vel_gain;
    for (int i = 0; i < kMaxLayers; ++i) {
      Layer& lay = layers_[i];
      lay.zone = i < n ? zones[i] : nullptr;
      if (!lay.zone) {
        lay.playing = false;
        continue;
      }
      StartLayer(lay, *lay.zone, played, engine_gain);
    }
  }

  void NoteOff() {
    for (auto& lay : layers_) {
      if (!lay.playing) continue;
      lay.env.Release();
      if (lay.zone && lay.zone->loop_mode == LoopMode::kLoopRelease) lay.looping = false;
    }
  }

  void Process(float* l, float* r, int from, int to) {
    for (auto& lay : layers_) {
      if (!lay.playing || !lay.zone) continue;
      const SampleZone& zone = *lay.zone;
      const float* data = zone.data;
      const float* data_r = lay.stereo ? zone.data_r : data;
      const uint32_t frames = zone.frames;
      const int64_t rate = lay.rate;
      const int64_t xf_start = lay.loop_end - lay.xf_fixed;
      int64_t pos = lay.pos;
      for (int i = from; i < to; ++i) {
        const float g = lay.env.Next();
        if (!lay.env.Active()) {
          lay.playing = false;
          break;
        }
        float sl, sr;
        if (lay.looping && lay.xf > 0.0f && pos >= xf_start) {
          const float t = (static_cast<float>(pos - xf_start) * kPhaseToUnit / lay.xf) * kHalfPi;
          const float w_out = fm::Cos(t);
          const float w_in = fm::Sin(t);
          const int64_t pre = pos - lay.loop_len;
          sl = w_out * ReadCubic(data, frames, pos) + w_in * ReadCubic(data, frames, pre);
          sr = lay.stereo ? w_out * ReadCubic(data_r, frames, pos) + w_in * ReadCubic(data_r, frames, pre) : sl;
        } else {
          sl = ReadCubic(data, frames, pos);
          sr = lay.stereo ? ReadCubic(data_r, frames, pos) : sl;
        }
        l[i] += sl * lay.gain_l * g;
        r[i] += sr * lay.gain_r * g;
        pos += rate;
        if (lay.looping) {
          /* the TypeScript's `while (pos >= loopEnd) pos -= loopLen`, as the
           * remainder it lands on, so an absurd rate cannot spin here */
          if (pos >= lay.loop_end) pos = lay.loop_start + (pos - lay.loop_start) % lay.loop_len;
        } else if (pos >= lay.end_pos) {
          lay.playing = false;
          break;
        }
      }
      lay.pos = pos;
    }
  }

  bool Active() const {
    for (const auto& lay : layers_) if (lay.playing) return true;
    return false;
  }

 private:
  static constexpr float kHalfPi = 1.57079632679490f;
  static constexpr double kFixedOne = 4294967296.0; /* 2^32 */

  /* One playing zone. Positions are frames in 32.32 fixed point. */
  struct Layer {
    const SampleZone* zone = nullptr;
    HoldAdsr env;
    bool playing = false, stereo = false, looping = false;
    int64_t pos = 0, rate = 0;
    int64_t loop_start = 0, loop_end = 0, loop_len = 0, end_pos = 0;
    /* crossfade window in source frames, 0 disables the fade */
    float xf = 0.0f;
    int64_t xf_fixed = 0;
    float gain_l = 0.0f, gain_r = 0.0f;
  };

  /* Frames to 32.32. NaN (a NaN or negative note frequency) lands on 0 and
   * magnitudes on 2^30 frames, so the conversion is always defined and a
   * position plus a rate cannot overflow. 2^30 frames is more float audio
   * than a 32-bit address space holds. */
  static int64_t ToFixed(double frames) {
    if (!(frames == frames)) return 0;
    const double lim = 1073741824.0;
    const double f = frames > lim ? lim : (frames < -lim ? -lim : frames);
    return static_cast<int64_t>(floor(f * kFixedOne + 0.5));
  }

  /* clamp(Math.round(x), 0, 127), with NaN landing on 0 as clamp() sends it */
  static int RoundClampKey(double x) {
    const double r = floor(x + 0.5);
    if (!(r >= 0.0)) return 0;
    return r > 127.0 ? 127 : static_cast<int>(r);
  }

  /* readCubic: Catmull-Rom at a fixed point position, indices clamped at
   * the edges. The TypeScript clamps y0 only below and y2, y3 only above,
   * because the positions it reaches cannot leave the data any other way;
   * both ends are clamped here so a bad zone cannot read out of bounds. */
  static float ReadCubic(const float* d, uint32_t frames, int64_t pos) {
    const int64_t i = pos >> 32;
    const float t = static_cast<float>(static_cast<uint32_t>(pos)) * kPhaseToUnit;
    const int64_t last = static_cast<int64_t>(frames) - 1;
    const float y0 = d[Edge(i - 1, last)];
    const float y1 = d[Edge(i, last)];
    const float y2 = d[Edge(i + 1, last)];
    const float y3 = d[Edge(i + 2, last)];
    return y1 + 0.5f * t * (y2 - y0 + t * (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3 + t * (3.0f * (y1 - y2) + y3 - y0)));
  }

  static int64_t Edge(int64_t i, int64_t last) { return i < 0 ? 0 : (i > last ? last : i); }

  void StartLayer(Layer& lay, const SampleZone& zone, double played, float engine_gain) {
    if (!zone.data || zone.frames == 0) {
      lay.playing = false;
      return;
    }
    const double semis = played - zone.root_key + zone.fine_tune / 100.0;
    lay.rate = ToFixed(exp2(semis / 12.0) * (static_cast<double>(zone.sample_rate) / sr_));
    lay.pos = 0;
    lay.stereo = zone.data_r != nullptr;
    const double data_len = static_cast<double>(zone.frames);
    lay.end_pos = ToFixed(data_len - 1.0);

    const float total = fm::DbToGain(zone.gain_db) * engine_gain;
    const float pan = Clamp(zone.pan + p_.pan, -1.0f, 1.0f);
    if (lay.stereo) {
      /* stereo zones keep unity per channel at center; pan is a balance */
      lay.gain_l = total * (1.0f - pan < 1.0f ? 1.0f - pan : 1.0f);
      lay.gain_r = total * (1.0f + pan < 1.0f ? 1.0f + pan : 1.0f);
    } else {
      const float angle = ((pan + 1.0f) * kPi) / 4.0f;
      lay.gain_l = total * fm::Cos(angle);
      lay.gain_r = total * fm::Sin(angle);
    }

    const double ls = zone.has_loop_start ? zone.loop_start : 0.0;
    const double le = zone.has_loop_end ? zone.loop_end : data_len;
    lay.looping = zone.loop_mode != LoopMode::kNone && le > ls + 1.0 && le <= data_len && ls >= 0.0;
    lay.xf = 0.0f;
    lay.xf_fixed = 0;
    if (lay.looping) {
      lay.loop_start = ToFixed(ls);
      lay.loop_end = ToFixed(le);
      lay.loop_len = lay.loop_end - lay.loop_start;
      /* the pre-loop read needs xf frames before the loop start */
      double xf = (static_cast<double>(p_.loop_xfade) / 1000.0) * zone.sample_rate;
      const double len = le - ls;
      if (len - 1.0 < xf) xf = len - 1.0;
      if (ls < xf) xf = ls;
      if (xf >= 1.0) {
        lay.xf = static_cast<float>(xf);
        lay.xf_fixed = ToFixed(xf);
      }
    }

    if (zone.has_env) {
      lay.env.Set(zone.env.attack, zone.env.hold, zone.env.decay, zone.env.sustain, zone.env.release);
    } else {
      lay.env.Set(p_.attack, 0.0f, p_.decay, p_.sustain, p_.release);
    }
    lay.env.Trigger();
    lay.playing = true;
  }

  float sr_ = 48000.0f;
  SamplerBank* bank_ = nullptr;
  Params p_;
  Layer layers_[kMaxLayers];
};

}  // namespace bellows
