/*
 * Memory-safety harness for the buffer-owning classes.
 *
 * Every class here sizes its storage from a TEMPLATE int and then computes
 * indices from the float handed to Init(). Nothing in the type system makes
 * the two agree, so a caller who reads the rate back from the SDK (which
 * both docs/HARDWARE.md and src/bellows/platform/README.md tell them to do)
 * can hand a class a rate it was not sized for. Pluck<20, 48000> at
 * Init(192000) used to write 4792 floats past excite_[]: a real
 * heap-buffer-overflow, not a clamp.
 *
 * Nothing caught that. npm run parity compares numbers at one rate, and
 * ./tools/check-header.sh instantiates nothing, so template bodies were
 * dead-stripped before they could run. This harness is the missing gate: it
 * constructs each class on the HEAP so the sanitizers get redzones around
 * it, drives it at rates above and below the one it was sized for, and
 * sweeps the params that choose an index.
 *
 * It asserts nothing about the audio. Sound is what the parity harness is
 * for. This one exists to make ASan and UBSan speak, so it must be built
 * with them: `npm run memsafety`. Built without them it proves nothing,
 * which is why the build script owns the flags rather than the reader.
 *
 * Rates are chosen around the design rate deliberately. Below it every
 * buffer is oversized and nothing can overflow, which is the case that
 * passes for free; the interesting side is above, and 4x is past the point
 * where a period no longer fits at all.
 */
#include <stdio.h>

#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/modfx.h"

namespace {

constexpr int kBlock = 128;
/* 24000 is half the design rate, 192000 is four times it. */
const float kRates[] = {24000.0f, 44100.0f, 48000.0f, 96000.0f, 192000.0f};
constexpr int kNumRates = sizeof(kRates) / sizeof(kRates[0]);

/*
 * Below kMinFreqHz on purpose, and above the Nyquist guard on purpose. The
 * overflow was reached by asking for a note the buffer could not hold, so a
 * sweep that stays inside the documented range cannot find it.
 */
const float kFreqs[] = {1.0f, 8.0f, 15.0f, 20.0f, 27.5f, 55.0f, 440.0f, 4186.0f, 20000.0f, 96000.0f};
constexpr int kNumFreqs = sizeof(kFreqs) / sizeof(kFreqs[0]);

float g_l[kBlock];
float g_r[kBlock];
int g_failures = 0;

void Check(bool ok, const char* what, float got, float want) {
  if (ok) return;
  printf("  FAIL %s: got %g, wanted %g\n", what, static_cast<double>(got),
         static_cast<double>(want));
  g_failures++;
}

/* Signal, not silence: a gate that runs on zeros exercises the branches a
 * limiter or a gate takes when there is nothing to do. */
void FillInput(int n) {
  for (int i = 0; i < kBlock; ++i) {
    float x = (i % 32) * 0.0625f - 1.0f;
    g_l[i] = x * (n % 3 == 0 ? 1.5f : 0.4f);
    g_r[i] = -x * (n % 5 == 0 ? 2.0f : 0.3f);
  }
}

/* Every voice: note on across the sweep, run blocks, note off, run more. */
template <typename V>
void DriveVoice(V* v, const char* name, float rate) {
  static const float kVels[] = {0.0f, 0.5f, 1.0f};
  int blocks = 0;
  for (int f = 0; f < kNumFreqs; ++f) {
    for (int vi = 0; vi < 3; ++vi) {
      const float vel = kVels[vi];
      v->NoteOn(kFreqs[f], vel);
      for (int b = 0; b < 4; ++b) {
        FillInput(blocks++);
        v->Process(g_l, g_r, 0, kBlock);
      }
      v->NoteOff();
      for (int b = 0; b < 2; ++b) {
        FillInput(blocks++);
        v->Process(g_l, g_r, 0, kBlock);
      }
      /* Partial ranges: the kernel splits blocks at event boundaries, so
       * (from, to) is not always (0, kBlock) in the real render loop. */
      v->NoteOn(kFreqs[f], vel);
      v->Process(g_l, g_r, 7, 63);
      v->Process(g_l, g_r, 63, kBlock);
    }
  }
  printf("  ok %-14s rate=%-8.0f blocks=%d\n", name, rate, blocks);
}

/* Every effect: params at both extremes, then blocks. */
template <typename FX, typename P>
void DriveFx(FX* fx, const char* name, float rate, const P& lo, const P& hi) {
  for (int pass = 0; pass < 2; ++pass) {
    fx->SetParams(pass == 0 ? lo : hi);
    for (int b = 0; b < 8; ++b) {
      FillInput(b);
      fx->Process(g_l, g_r, 0, kBlock);
    }
    FillInput(99);
    fx->Process(g_l, g_r, 11, 77);
  }
  printf("  ok %-14s rate=%-8.0f\n", name, rate);
}

void RunRate(float rate) {
  printf("rate %.0f (design 48000)\n", rate);
  bellows::Rng rng;
  rng.Init("memsafety");

  {
    using P = bellows::Pluck<20, 48000>;
    auto* v = new P();
    v->Init(rate, &rng);
    /*
     * The sanitizers alone do not gate this. Clamping the excitation LENGTH
     * keeps the writes in bounds, so a build that dropped the pitch clamp
     * and kept only the length guard ran clean here: measured, that
     * mutation passed while the one that dropped both aborted. The
     * invariant the pitch clamp actually carries is that the period the
     * lowest playable note asks for still fits the loop, so assert that
     * directly rather than trusting an overflow to appear.
     */
    const float usable = static_cast<float>(P::kMaxPeriod - 4);
    const float period = rate / v->MinFreq();
    Check(period <= usable + 0.5f, "Pluck bottom note fits the loop", period, usable);
    DriveVoice(v, "Pluck", rate);
    delete v;
  }
  {
    auto* v = new bellows::Tube<20, 48000>();
    v->Init(rate, &rng);
    DriveVoice(v, "Tube", rate);
    delete v;
  }
  {
    using D = bellows::StereoDelay<500, 48000>;
    auto* fx = new D();
    fx->Init(rate);
    D::Params lo, hi;
    lo.time_l = 0.0f;
    lo.time_r = 0.0f;
    lo.feedback = 0.0f;
    /* Past the 500 ms the template sized for, which is the same shape of
     * mismatch one step removed. */
    hi.time_l = 2.0f;
    hi.time_r = 2.0f;
    hi.feedback = 0.99f;
    hi.cross_feedback = 0.99f;
    DriveFx(fx, "StereoDelay", rate, lo, hi);
    delete fx;
  }
  {
    using C = bellows::Chorus<48000>;
    auto* fx = new C();
    fx->Init(rate);
    C::Params lo, hi;
    lo.rate = 0.0f;
    lo.depth = 0.0f;
    hi.rate = 20.0f;
    hi.depth = 1.0f;
    hi.feedback = 0.95f;
    DriveFx(fx, "Chorus", rate, lo, hi);
    delete fx;
  }
  {
    using F = bellows::Flanger<48000>;
    auto* fx = new F();
    fx->Init(rate);
    F::Params lo, hi;
    lo.rate = 0.0f;
    lo.depth = 0.0f;
    lo.manual = 0.0f;
    hi.rate = 20.0f;
    hi.depth = 1.0f;
    hi.manual = 1.0f;
    hi.feedback = 0.95f;
    DriveFx(fx, "Flanger", rate, lo, hi);
    delete fx;
  }
  {
    using K = bellows::Compressor<10, 48000>;
    auto* fx = new K();
    fx->Init(rate);
    K::Params lo, hi;
    lo.lookahead = 0.0f;
    lo.attack = 0.0f;
    /* Well past kMaxLookaheadMs, which is where the index comes from. */
    hi.lookahead = 1.0f;
    hi.ratio = 20.0f;
    hi.threshold_db = -60.0f;
    DriveFx(fx, "Compressor", rate, lo, hi);
    delete fx;
  }
  {
    using L = bellows::Limiter<48000>;
    auto* fx = new L();
    fx->Init(rate);
    L::Params lo, hi;
    lo.ceiling_db = -24.0f;
    lo.release = 0.001f;
    hi.ceiling_db = 0.0f;
    hi.release = 1.0f;
    DriveFx(fx, "Limiter", rate, lo, hi);
    delete fx;
  }
  {
    /* The oversampled path owns two more buffers than the plain one. */
    using L = bellows::Limiter<48000, true>;
    auto* fx = new L();
    fx->Init(rate);
    L::Params lo, hi;
    lo.ceiling_db = -24.0f;
    hi.ceiling_db = 0.0f;
    DriveFx(fx, "Limiter/tp", rate, lo, hi);
    delete fx;
  }
  {
    /* Not a template and owns no line, so it cannot have the mismatch. It is
     * here because it is one of the effects no numeric harness drives. */
    using G = bellows::Gate;
    auto* fx = new G();
    fx->Init(rate);
    G::Params lo, hi;
    lo.threshold_db = -60.0f;
    lo.hold = 0.0f;
    hi.threshold_db = 0.0f;
    hi.hold = 1.0f;
    DriveFx(fx, "Gate", rate, lo, hi);
    delete fx;
  }
}

}  // namespace

int main() {
  for (int i = 0; i < kNumRates; ++i) RunRate(kRates[i]);
  if (g_failures != 0) {
    printf("\nmemsafety: %d invariant failure(s)\n", g_failures);
    return 1;
  }
  printf("\nmemsafety: no sanitizer report and no invariant failure across %d rates\n", kNumRates);
  return 0;
}
