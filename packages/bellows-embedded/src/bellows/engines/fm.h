/* Transcription of src/engines/fm.ts.
 *
 * Six phase modulation operators, each a sine oscillator driven through
 * ProcessPm plus an Adsr, a frequency ratio or a fixed frequency, an
 * output level, and optionally self feedback. Routing is a declarative
 * table per operator count: which operators modulate operator i, which
 * operators reach the output, and which one carries the self loop.
 * Operators are evaluated from the highest index down so a modulator's
 * output from the current sample feeds its target with no unit delay,
 * the way the DX chips do it. That evaluation order is the whole reason
 * the loop counts backwards, so do not "tidy" it forwards.
 *
 * Topologies: 2 ops get a serial and a parallel algorithm, 4 ops get the
 * eight TX81Z style algorithms (reconstructed from the DX11/TX81Z
 * charts), 6 ops get DX7 algorithms 1, 5, 16 and 32. The algorithm param
 * is one based to match hardware naming and is clamped to the table.
 *
 * The JS holds mods[i] as a ragged array of operator indices. Here it is
 * a bitmask byte per operator: bit m of mods[i] means operator m
 * modulates operator i. A mask costs one byte instead of a pointer plus
 * a length, the whole algorithm table lands in .rodata as nine bytes per
 * entry, and nothing has to be walked at construction. Summation order
 * is the only thing a mask gives up, and a sum of phase modulation terms
 * is commutative, so the output is unchanged. Carriers get the same
 * treatment, with their population count stored alongside because the
 * output gain is 1/carriers.
 *
 * Envelopes are grouped, not per op: carriers share attack/decay/
 * sustain/release, modulators share m_attack/m_decay/m_sustain/
 * m_release. An operator's role follows the current algorithm's carrier
 * mask.
 *
 * Velocity: carrier level scales linearly with velocity. Modulation
 * depth scales by pow(velocity, brightness), so brightness 0 ignores
 * velocity and larger values darken soft notes.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/oscillators.h"

namespace bellows {

/* Radians of phase modulation per unit of modulator output. */
inline constexpr float kFmModDepth = 4.0f;
/* Radians of self feedback at feedback = 1, averaged over two samples. */
inline constexpr float kFmFbDepth = kPi;

struct FmAlgo {
  /* mods[i] bit m: operator m phase modulates operator i. */
  uint8_t mods[6];
  /* Bit c: operator c reaches the output. */
  uint8_t carriers;
  uint8_t carrier_count;
  /* Operator with the self feedback loop. */
  uint8_t feedback;
};

inline constexpr FmAlgo kFmAlgos2[] = {
    /* 1: 2>1 */
    {{0x02, 0, 0, 0, 0, 0}, 0x01, 1, 1},
    /* 2: two parallel carriers */
    {{0x00, 0, 0, 0, 0, 0}, 0x03, 2, 1},
};

/* Four op set, TX81Z style, 0 indexed. Feedback sits on op 4 (index 3). */
inline constexpr FmAlgo kFmAlgos4[] = {
    /* 1: 4>3>2>1 */
    {{0x02, 0x04, 0x08, 0, 0, 0}, 0x01, 1, 3},
    /* 2: 2>1 and 4>3>1 */
    {{0x06, 0x00, 0x08, 0, 0, 0}, 0x01, 1, 3},
    /* 3: 3>2>1 and 4>1 */
    {{0x0a, 0x04, 0x00, 0, 0, 0}, 0x01, 1, 3},
    /* 4: 4>3>2, carriers 1 and 2 */
    {{0x00, 0x04, 0x08, 0, 0, 0}, 0x03, 2, 3},
    /* 5: 2>1 and 4>3, carriers 1 and 3 */
    {{0x02, 0x00, 0x08, 0, 0, 0}, 0x05, 2, 3},
    /* 6: 4 modulates carriers 1, 2 and 3 */
    {{0x08, 0x08, 0x08, 0, 0, 0}, 0x07, 3, 3},
    /* 7: 4>3, carriers 1, 2 and 3 */
    {{0x00, 0x00, 0x08, 0, 0, 0}, 0x07, 3, 3},
    /* 8: four parallel carriers */
    {{0x00, 0x00, 0x00, 0, 0, 0}, 0x0f, 4, 3},
};

/* Six op set: DX7 algorithms 1, 5, 16, 32. Feedback on op 6 (index 5). */
inline constexpr FmAlgo kFmAlgos6[] = {
    /* DX7 1: 2>1 and 6>5>4>3, carriers 1 and 3 */
    {{0x02, 0x00, 0x08, 0x10, 0x20, 0x00}, 0x05, 2, 5},
    /* DX7 5: 2>1, 4>3, 6>5, carriers 1, 3 and 5 */
    {{0x02, 0x00, 0x08, 0x00, 0x20, 0x00}, 0x15, 3, 5},
    /* DX7 16: 2, 3 and 5 modulate 1; 4>3; 6>5; carrier 1 */
    {{0x16, 0x00, 0x08, 0x00, 0x20, 0x00}, 0x01, 1, 5},
    /* DX7 32: six parallel carriers */
    {{0x00, 0x00, 0x00, 0x00, 0x00, 0x00}, 0x3f, 6, 5},
};

class Fm {
 public:
  static constexpr int kMaxOps = 6;

  struct Params {
    float ops = 4.0f;
    float algorithm = 1.0f;
    float feedback = 0.0f;
    float brightness = 0.5f;
    float attack = 0.003f, decay = 0.3f, sustain = 0.7f, release = 0.3f;
    float m_attack = 0.002f, m_decay = 0.4f, m_sustain = 0.5f, m_release = 0.2f;
    float ratio[kMaxOps] = {1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f};
    float level[kMaxOps] = {1.0f, 0.6f, 0.5f, 0.4f, 0.4f, 0.3f};
    float fixed_hz[kMaxOps] = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
  };

  void Init(float sample_rate) {
    Params d;
    Init(sample_rate, d);
  }

  void Init(float sample_rate, const Params& p) {
    p_ = p;
    for (int i = 0; i < kMaxOps; ++i) {
      ops_[i].osc.Init(sample_rate);
      ops_[i].env.Init(sample_rate);
    }
    Apply();
  }

  void SetParams(const Params& p) {
    p_ = p;
    Apply();
  }

  void NoteOn(float freq, float vel) {
    freq_ = freq;
    vel_ = vel;
    mod_vel_gain_ = fm::Pow(vel > 1e-3f ? vel : 1e-3f, p_.brightness);
    for (int i = 0; i < kMaxOps; ++i) {
      Op& op = ops_[i];
      op.osc.Reset(0.0f);
      op.env.Reset();
      op.out = 0.0f;
      op.prev = 0.0f;
      SetOpFreq(op, freq);
      if (i < op_count_) op.env.Trigger();
    }
  }

  void NoteOff() {
    for (int i = 0; i < op_count_; ++i) ops_[i].env.Release();
  }

  void Process(float* l, float* r, int from, int to) {
    if (!Active()) return;
    const FmAlgo& algo = *algo_;
    const int n = op_count_;
    const float fb = p_.feedback * kFmFbDepth * 0.5f;
    const float mod_gain = kFmModDepth * mod_vel_gain_;
    const float out_gain = carrier_gain_ * vel_ * kSqrtHalf;
    for (int i = from; i < to; ++i) {
      /* Highest index first: a modulator computed this sample reaches its
       * carrier this sample, so only the feedback op sees a delay. */
      for (int o = n - 1; o >= 0; --o) {
        Op& op = ops_[o];
        float pm = 0.0f;
        for (uint8_t m = algo.mods[o], s = 0; m != 0; m >>= 1, ++s) {
          if (m & 1u) pm += ops_[s].out;
        }
        pm *= mod_gain;
        if (o == static_cast<int>(algo.feedback) && fb > 0.0f) pm += fb * (op.out + op.prev);
        float y = op.osc.ProcessPm(pm) * op.level * op.env.Process();
        op.prev = op.out;
        op.out = y;
      }
      float y = 0.0f;
      for (uint8_t c = algo.carriers, s = 0; c != 0; c >>= 1, ++s) {
        if (c & 1u) y += ops_[s].out;
      }
      y *= out_gain;
      l[i] += y;
      r[i] += y;
    }
  }

  bool Active() const {
    for (uint8_t c = algo_->carriers, s = 0; c != 0; c >>= 1, ++s) {
      if ((c & 1u) && ops_[s].env.Active()) return true;
    }
    return false;
  }

 private:
  struct Op {
    SineOsc osc;
    Adsr env;
    float ratio = 1.0f;
    float fixed_hz = 0.0f;
    float level = 1.0f;
    float out = 0.0f;
    float prev = 0.0f;
  };

  static void SetOpFreq(Op& op, float base_hz) {
    op.osc.SetFreq(op.fixed_hz > 0.0f ? op.fixed_hz : base_hz * op.ratio);
  }

  /* The op count snaps to 2, 4 or 6 because each has its own table. */
  static int SnapOpCount(float v) {
    if (v < 3.0f) return 2;
    if (v < 5.0f) return 4;
    return 6;
  }

  void Apply() {
    op_count_ = SnapOpCount(p_.ops);
    const FmAlgo* table = op_count_ == 2 ? kFmAlgos2 : (op_count_ == 4 ? kFmAlgos4 : kFmAlgos6);
    int len = op_count_ == 2 ? 2 : (op_count_ == 4 ? 8 : 4);
    int idx = ClampI(static_cast<int>(p_.algorithm + 0.5f) - 1, 0, len - 1);
    algo_ = &table[idx];
    carrier_gain_ = 1.0f / static_cast<float>(algo_->carrier_count);
    for (int i = 0; i < op_count_; ++i) {
      Op& op = ops_[i];
      op.ratio = p_.ratio[i];
      op.fixed_hz = p_.fixed_hz[i];
      op.level = p_.level[i];
      SetOpFreq(op, freq_);
      if ((algo_->carriers >> i) & 1u) {
        op.env.Set(p_.attack, p_.decay, p_.sustain, p_.release);
      } else {
        op.env.Set(p_.m_attack, p_.m_decay, p_.m_sustain, p_.m_release);
      }
    }
  }

  Params p_;
  Op ops_[kMaxOps];
  const FmAlgo* algo_ = &kFmAlgos4[0];
  int op_count_ = 4;
  float carrier_gain_ = 1.0f;
  float freq_ = 440.0f;
  float vel_ = 1.0f;
  float mod_vel_gain_ = 1.0f;
};

}  // namespace bellows
