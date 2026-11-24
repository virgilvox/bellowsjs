/*
 * The two engines that play recorded audio, and the banks that own it: a sampler bank holds the
 * zones of one registerBank message and their frames, a grain bank the buffer of one
 * registerGrain. The voices are bellows-embedded's Sampler and Granular reading that memory.
 *
 * Interface and lifetime rules are in unit.h. The exports at the bottom are the same calls for
 * JavaScript, in the style of abi.cpp.
 */
#include "bellows/engines/granular.h"
#include "bellows/engines/sampler.h"
#include "unit.h"

namespace bwasm {

struct Bank {
  enum Kind { kSampler, kGrain } kind = kSampler;
  /* sampler */
  bellows::SampleZone* zones = nullptr;
  int zone_count = 0;
  bellows::SamplerBank map;
  /* grain */
  float* data = nullptr;
  uint32_t frames = 0;
  float rate = 44100.0f;
};

namespace {

/* The plain 'granular' engine's source, made on first use and kept for the module's life. */
const float* TestTone() {
  static float* tone = nullptr;
  if (!tone) {
    tone = static_cast<float*>(malloc(bellows::Granular::kTestToneFrames * sizeof(float)));
    if (tone) bellows::Granular::FillTestTone(tone);
  }
  return tone;
}

void FreeZoneData(bellows::SampleZone& z) {
  float* l = const_cast<float*>(z.data);
  float* r = const_cast<float*>(z.data_r);
  free(l);
  if (r != l) free(r);
  z.data = nullptr;
  z.data_r = nullptr;
  z.frames = 0;
}

inline bool Given(float v) { return !isnan(v); }

}  // namespace

Bank* NewSamplerBank(int zone_count) {
  if (zone_count < 0) return nullptr;
  auto* b = new Bank;
  b->kind = Bank::kSampler;
  if (zone_count > 0) {
    b->zones = static_cast<bellows::SampleZone*>(malloc(static_cast<size_t>(zone_count) * sizeof(bellows::SampleZone)));
    if (!b->zones) {
      delete b;
      return nullptr;
    }
    for (int i = 0; i < zone_count; ++i) {
      b->zones[i] = bellows::SampleZone();
      /* empty until set: a key range no key reaches */
      b->zones[i].key_lo = 1.0f;
      b->zones[i].key_hi = 0.0f;
    }
  }
  b->zone_count = zone_count;
  b->map.Init(b->zones, zone_count);
  return b;
}

bool SetSamplerZone(Bank* bank, int index, const float* f, int field_count, float* data_l, float* data_r,
                    uint32_t frames) {
  if (!bank || bank->kind != Bank::kSampler || index < 0 || index >= bank->zone_count) return false;
  if (!f || field_count < kZoneFieldCount || (!data_l && frames > 0)) return false;
  bellows::SampleZone& z = bank->zones[index];
  FreeZoneData(z);
  z = bellows::SampleZone();
  z.data = data_l;
  z.data_r = data_r;
  z.frames = frames;
  z.sample_rate = f[kZoneSampleRate];
  z.root_key = f[kZoneRootKey];
  z.fine_tune = Given(f[kZoneFineTune]) ? f[kZoneFineTune] : 0.0f;
  z.key_lo = f[kZoneKeyLo];
  z.key_hi = f[kZoneKeyHi];
  z.vel_lo = f[kZoneVelLo];
  z.vel_hi = f[kZoneVelHi];
  z.has_loop_start = Given(f[kZoneLoopStart]);
  z.loop_start = z.has_loop_start ? f[kZoneLoopStart] : 0.0f;
  z.has_loop_end = Given(f[kZoneLoopEnd]);
  z.loop_end = z.has_loop_end ? f[kZoneLoopEnd] : 0.0f;
  const float mode = f[kZoneLoopMode];
  z.loop_mode = mode == 1.0f ? bellows::LoopMode::kLoop
                             : (mode == 2.0f ? bellows::LoopMode::kLoopRelease : bellows::LoopMode::kNone);
  z.gain_db = Given(f[kZoneGainDb]) ? f[kZoneGainDb] : 0.0f;
  z.pan = Given(f[kZonePan]) ? f[kZonePan] : 0.0f;
  z.has_env = Given(f[kZoneEnvAttack]);
  if (z.has_env) {
    z.env.attack = f[kZoneEnvAttack];
    z.env.hold = f[kZoneEnvHold];
    z.env.decay = f[kZoneEnvDecay];
    z.env.sustain = f[kZoneEnvSustain];
    z.env.release = f[kZoneEnvRelease];
  }
  z.has_round_robin = Given(f[kZoneRoundRobinGroup]);
  z.round_robin_group = z.has_round_robin ? f[kZoneRoundRobinGroup] : 0.0f;
  z.seq_position = Given(f[kZoneSeqPosition]) ? f[kZoneSeqPosition] : 1.0f;
  return true;
}

Bank* NewGrainBank(float* data, uint32_t frames, float sample_rate) {
  auto* b = new Bank;
  b->kind = Bank::kGrain;
  b->data = data;
  b->frames = data ? frames : 0;
  b->rate = sample_rate;
  return b;
}

void FreeBank(Bank* bank) {
  if (!bank) return;
  for (int i = 0; i < bank->zone_count; ++i) FreeZoneData(bank->zones[i]);
  free(bank->zones);
  free(bank->data);
  delete bank;
}

Voice* NewBankVoice(int unit, float sr, const char* label, const float* vals, Bank* bank) {
  using namespace bellows;
  switch (unit) {
    case kUnitSampler: {
      if (!bank || bank->kind != Bank::kSampler) return nullptr;
      auto* w = Make<Sampler, ParamsSampler>(vals);
      w->v.Init(sr, &bank->map, w->p);
      return w;
    }
    case kUnitGranular: {
      if (bank && bank->kind != Bank::kGrain) return nullptr;
      const float* data = bank ? bank->data : TestTone();
      const uint32_t frames = bank ? bank->frames : (data ? Granular::kTestToneFrames : 0);
      const float rate = bank ? bank->rate : Granular::kTestToneRate;
      auto* w = Make<Granular, ParamsGranular>(vals);
      /* the TypeScript voice draws from the pool's stream for its slot, unforked */
      w->rng.Init(label);
      w->v.Init(sr, &w->rng, data, frames, rate, w->p);
      return w;
    }
    default:
      return nullptr;
  }
}

}  // namespace bwasm

/* ---------------- exports ---------------- */

#ifndef BW_EXPORT
#define BW_EXPORT(name) extern "C" __attribute__((export_name(#name)))
#endif

BW_EXPORT(bw_bank_zone_fields) int bw_bank_zone_fields() { return bwasm::kZoneFieldCount; }
BW_EXPORT(bw_bank_sampler_new) bwasm::Bank* bw_bank_sampler_new(int zone_count) {
  return bwasm::NewSamplerBank(zone_count);
}
/* 1 when the zone was set and the bank now owns data_l and data_r, 0 when the caller still does. */
BW_EXPORT(bw_bank_sampler_zone)
int bw_bank_sampler_zone(bwasm::Bank* bank, int index, const float* fields, int field_count, float* data_l,
                         float* data_r, uint32_t frames) {
  return bwasm::SetSamplerZone(bank, index, fields, field_count, data_l, data_r, frames) ? 1 : 0;
}
BW_EXPORT(bw_bank_grain_new) bwasm::Bank* bw_bank_grain_new(float* data, uint32_t frames, float sample_rate) {
  return bwasm::NewGrainBank(data, frames, sample_rate);
}
BW_EXPORT(bw_bank_free) void bw_bank_free(bwasm::Bank* bank) { bwasm::FreeBank(bank); }
BW_EXPORT(bw_voice_new_bank)
bwasm::Voice* bw_voice_new_bank(int unit, float sr, const char* label, const float* vals, bwasm::Bank* bank) {
  return bwasm::NewBankVoice(unit, sr, label, vals, bank);
}
