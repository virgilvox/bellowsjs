/*
 * The C ABI the JavaScript side drives: bellows-embedded's engines and effects behind handles.
 *
 * A voice or an effect is created by unit number (units.gen.h) with every param value in the
 * TypeScript spec order, and from then on is touched only through these calls. Audio crosses in
 * one buffer the module owns, bw_io(): kIoFrames of left followed by kIoFrames of right. A voice
 * renders into it from silence and the caller adds it into its own output, which is the voice
 * contract (voices add); an effect processes it in place, which is the effect contract.
 */
#include "unit.h"

void* operator new(__SIZE_TYPE__ n) { return malloc(n); }
void operator delete(void* p) noexcept { free(p); }
void operator delete(void* p, __SIZE_TYPE__) noexcept { free(p); }

namespace bwasm {
float g_io[2 * kIoFrames];
}  // namespace bwasm

/* ---------------- exports ---------------- */

#define BW_EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern "C" void __wasm_call_ctors(void);

BW_EXPORT(bw_init) void bw_init() { __wasm_call_ctors(); }
BW_EXPORT(bw_io) float* bw_io() { return bwasm::g_io; }
BW_EXPORT(bw_io_frames) int bw_io_frames() { return bwasm::kIoFrames; }
BW_EXPORT(bw_unit_count) int bw_unit_count() { return bwasm::kUnitCount; }

BW_EXPORT(bw_voice_new)
bwasm::Voice* bw_voice_new(int unit, float sr, const char* label, const float* vals, int variant) {
  return bwasm::NewVoice(unit, sr, label, vals, variant);
}
BW_EXPORT(bw_voice_on) void bw_voice_on(bwasm::Voice* v, float hz, float vel) { v->On(hz, vel); }
BW_EXPORT(bw_voice_off) void bw_voice_off(bwasm::Voice* v) { v->Off(); }
BW_EXPORT(bw_voice_set) void bw_voice_set(bwasm::Voice* v, int i, float x) { v->Set(i, x); }
BW_EXPORT(bw_voice_active) int bw_voice_active(bwasm::Voice* v) { return v->Active() ? 1 : 0; }
/* Renders n frames (at most kIoFrames) from silence into bw_io(); returns Active() after. */
BW_EXPORT(bw_voice_run) int bw_voice_run(bwasm::Voice* v, int n) {
  float* l = bwasm::g_io;
  float* r = bwasm::g_io + bwasm::kIoFrames;
  for (int i = 0; i < n; ++i) l[i] = r[i] = 0.0f;
  v->Run(l, r, n);
  return v->Active() ? 1 : 0;
}
BW_EXPORT(bw_voice_free) void bw_voice_free(bwasm::Voice* v) { delete v; }

BW_EXPORT(bw_fx_new) bwasm::Fx* bw_fx_new(int unit, float sr, const float* vals, float aux) {
  return bwasm::NewFx(unit, sr, vals, aux);
}
BW_EXPORT(bw_fx_set) void bw_fx_set(bwasm::Fx* f, int i, float x) { f->Set(i, x); }
BW_EXPORT(bw_fx_reset) void bw_fx_reset(bwasm::Fx* f) { f->Reset(); }
/* Processes n frames (at most kIoFrames) of bw_io() in place. */
BW_EXPORT(bw_fx_run) void bw_fx_run(bwasm::Fx* f, int n) {
  f->Run(bwasm::g_io, bwasm::g_io + bwasm::kIoFrames, n);
}
BW_EXPORT(bw_fx_free) void bw_fx_free(bwasm::Fx* f) { delete f; }
