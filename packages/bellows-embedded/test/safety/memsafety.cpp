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
 *
 * The sweeps also carry values that are not numbers at all. Every rate and
 * every frequency here used to be finite and positive, and that is exactly
 * why the harness could not see the NaN pitch fault: an engine's clamps are
 * written with `<` and `>`, both of which are false for NaN, so a NaN walks
 * through a clamp unchanged and reaches a read position. Casting it to an
 * integer index is undefined, and on x86-64 it is INT_MIN, which no wrap can
 * fold back. Measured: Pluck<20,48000>::NoteOn(NAN, 1) segfaulted (exit 139)
 * built -target x86_64-apple-macos11 and merely emitted NaN on arm64, where
 * the cast saturates to 0. An arm64-only run therefore proves nothing about
 * the cast, which is why CheckDelayClamps below asserts the clamped VALUE
 * instead of waiting for a fault.
 *
 * WHAT IS DRIVEN, so the opening line can be checked rather than believed:
 * DelayLineExt, Pluck, Tube, StereoDelay, Chorus, Flanger, Compressor,
 * Limiter (plain and oversampled), Gate, Plate, Saturator (4x and fused 1x),
 * Eq6 and Eq3. The three at the end were added because the list used to stop
 * at Gate while claiming to cover the buffer owners, and Plate is the
 * closest analogue to the Pluck fault: its store_ is carved from
 * TotalSamples(kSampleRate) while every index inside comes from the runtime
 * rate. Still not driven: the drum, FM, modal, formant, VA and westcoast
 * engines, none of which own a rate-sized buffer.
 */
#include <math.h>
#include <stdio.h>

#include "bellows/core/prng.h"
#include "bellows/dsp/delayline.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"
#include "bellows/fx/saturator.h"

namespace {

constexpr int kBlock = 128;
/* The template design rate, and the rate Pluck::Init substitutes when it is
 * handed one that is not finite and positive. */
constexpr float kDesignRate = 48000.0f;
/* 24000 is half the design rate, 192000 is four times it. NAN, 0 and a
 * negative rate are the shapes an SDK query returns when it fails. */
const float kRates[] = {24000.0f, 44100.0f, 48000.0f,      96000.0f,
                        192000.0f, NAN,      0.0f,         -48000.0f};
constexpr int kNumRates = sizeof(kRates) / sizeof(kRates[0]);

/*
 * Below kMinFreqHz on purpose, and above the Nyquist guard on purpose. The
 * overflow was reached by asking for a note the buffer could not hold, so a
 * sweep that stays inside the documented range cannot find it. NAN and a
 * negative frequency are here for the same reason: a MIDI-to-hertz helper
 * fed a bad note number produces both.
 */
const float kFreqs[] = {1.0f,    8.0f,    15.0f,   20.0f,     27.5f, 55.0f,
                        440.0f,  4186.0f, 20000.0f, 96000.0f, NAN,   -440.0f};
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

/*
 * The delay line's read clamps, checked directly rather than through an
 * engine.
 *
 * ASan cannot gate this on its own. On arm64 static_cast<int32_t>(NaN)
 * saturates to 0, so an unclamped NaN delay reads buf_[w_ - 1], which is in
 * bounds and raises nothing; only x86-64 forms the wild index that faults.
 * A gate that fires on one host and not the other is not a gate, so this
 * asserts the value the clamp is supposed to produce instead: with the
 * clamp, ReadCubic(NAN) has to equal ReadCubic at the floor, because NaN is
 * replaced before the cast. Without it, f = NaN - 0 is NaN and the cubic
 * polynomial returns NaN on both architectures.
 *
 * The buffer is a distinct ramp per slot, so equality here means the same
 * sample was read, not that both reads happened to land on zeros. A run
 * against a silent line would pass for the wrong reason.
 */
void CheckDelayClamps() {
  constexpr uint32_t kCap = 64;
  auto* buf = new float[kCap];
  bellows::DelayLineExt dl;
  dl.Init(buf, kCap);
  for (uint32_t i = 0; i < kCap; ++i) dl.Write(1.0f + static_cast<float>(i) * 0.25f);

  const float cubic_floor = dl.ReadCubic(1.0f);
  const float linear_floor = dl.ReadLinear(0.0f);
  const float cubic_max = dl.ReadCubic(static_cast<float>(dl.MaxDelay()));
  const float linear_max = dl.ReadLinear(static_cast<float>(dl.MaxDelay()));

  Check(cubic_floor != 0.0f, "ReadCubic floor is a real sample", cubic_floor, 1.0f);
  Check(linear_floor != 0.0f, "ReadLinear floor is a real sample", linear_floor, 1.0f);

  Check(dl.ReadCubic(NAN) == cubic_floor, "ReadCubic(NaN) clamps to the floor",
        dl.ReadCubic(NAN), cubic_floor);
  Check(dl.ReadLinear(NAN) == linear_floor, "ReadLinear(NaN) clamps to the floor",
        dl.ReadLinear(NAN), linear_floor);
  Check(dl.ReadCubic(-INFINITY) == cubic_floor, "ReadCubic(-inf) clamps to the floor",
        dl.ReadCubic(-INFINITY), cubic_floor);
  Check(dl.ReadLinear(-INFINITY) == linear_floor, "ReadLinear(-inf) clamps to the floor",
        dl.ReadLinear(-INFINITY), linear_floor);
  Check(dl.ReadCubic(INFINITY) == cubic_max, "ReadCubic(+inf) clamps to max", dl.ReadCubic(INFINITY),
        cubic_max);
  Check(dl.ReadLinear(INFINITY) == linear_max, "ReadLinear(+inf) clamps to max",
        dl.ReadLinear(INFINITY), linear_max);

  printf("  ok %-14s cap=%u max=%u\n", "DelayLineExt", kCap, dl.MaxDelay());
  delete[] buf;
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
     * mutation passed while the one that dropped both aborted.
     *
     * The earlier version of this check asserted MinFreq()'s formula, which
     * is not the guard NoteOn applies. Measured: reverting only the call
     * site (`float lo = MinFreq();` back to `kMinFreqHz`) and leaving
     * MinFreq() and the length clamp alone still exited 0. So ask the voice
     * what pitch it settled on and check THAT period fits the loop. The
     * requests below are all outside the playable range, which is the only
     * way the clamp is reached at all.
     *
     * kMaxPeriod - 4 is the bound the engine clamps to, not the delay
     * line's full usable range: DelayLine<kMaxPeriod> has max_ = kMaxPeriod,
     * four samples longer (measured 2404 against the 2400 used here). The
     * shorter figure is deliberate, so the check uses it.
     *
     * The rate the voice is running at is not always the rate passed in:
     * Init substitutes the design rate for anything that is not finite and
     * positive, so the period must be measured against that same rate.
     */
    const float usable = static_cast<float>(P::kMaxPeriod - 4);
    const float eff = (rate > 0.0f && isfinite(rate)) ? rate : kDesignRate;
    static const float kBadReqs[] = {1.0f, 0.0f, -440.0f, NAN, INFINITY, 1.0e9f};
    for (int i = 0; i < 6; ++i) {
      v->NoteOn(kBadReqs[i], 1.0f);
      const float period = eff / v->Freq();
      Check(period > 0.0f && period <= usable + 0.5f, "Pluck clamped note fits the loop",
            period, usable);
    }
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
  {
    /*
     * The closest analogue to the Pluck fault, and the reason the harness
     * had to grow: store_ is carved from TotalSamples(kSampleRate) while
     * every index inside comes from the RUNTIME rate. It is safe only
     * because Init() refuses the carve when it does not fit and Process()
     * returns early on !ready_, so drive it at rates on both sides of the
     * cliff and assert which side it landed on. Without the Ready() check
     * the run above 48000 would be a no-op passing for the wrong reason.
     */
    using R = bellows::Plate<48000, 250>;
    auto* fx = new R();
    const bool ok = fx->Init(rate);
    const bool want_ready = (rate > 0.0f && isfinite(rate) && rate <= kDesignRate);
    Check(ok == fx->Ready(), "Plate Init agrees with Ready", ok ? 1.0f : 0.0f,
          fx->Ready() ? 1.0f : 0.0f);
    Check(fx->Ready() == want_ready, "Plate carve fits exactly when the rate allows",
          fx->Ready() ? 1.0f : 0.0f, want_ready ? 1.0f : 0.0f);
    R::Params lo, hi;
    lo.decay = 0.0f;
    lo.damping = 0.0f;
    lo.predelay = 0.0f;
    lo.mod_depth = 0.0f;
    lo.mix = 0.0f;
    /* Past every documented ceiling: 250 ms of predelay is the template
     * bound and mod_depth 2 is the excursion the tank allpasses sized for. */
    hi.decay = 1.0f;
    hi.damping = 1.0f;
    hi.predelay = 1.0f;
    hi.mod_depth = 4.0f;
    hi.mix = 1.0f;
    DriveFx(fx, "Plate", rate, lo, hi);
    delete fx;
  }
  {
    /* Owns two oversampler buffers and two latency lines, all sized from
     * kMaxBlock rather than the rate, so the partial ranges DriveFx runs
     * matter more here than the rate sweep does. */
    using S = bellows::Saturator<4, kBlock>;
    auto* fx = new S();
    fx->Init(rate);
    S::Params lo, hi;
    lo.drive = 0.0f;
    lo.tone = -2.0f;
    lo.mix = 0.0f;
    lo.curve = bellows::SatCurve::kFold;
    hi.drive = 100.0f;
    hi.tone = 2.0f;
    hi.output_db = 48.0f;
    hi.mix = 1.0f;
    hi.curve = bellows::SatCurve::kCheby;
    DriveFx(fx, "Saturator/4x", rate, lo, hi);
    delete fx;
  }
  {
    /* The fused path: no scratch and no latency line, a different body. */
    using S = bellows::Saturator<1, kBlock>;
    auto* fx = new S();
    fx->Init(rate);
    S::Params lo, hi;
    lo.drive = 0.0f;
    lo.mix = 0.0f;
    hi.drive = 100.0f;
    hi.mix = 1.0f;
    hi.curve = bellows::SatCurve::kSoft;
    DriveFx(fx, "Saturator/1x", rate, lo, hi);
    delete fx;
  }
  {
    /* Six Svf bands in series. No buffer of its own, but the band
     * coefficients come from freq / rate, which is where a rate the caller
     * did not expect turns into a filter that never settles. */
    using E = bellows::Eq6;
    auto* fx = new E();
    fx->Init(rate);
    E::Params lo, hi;
    for (int i = 0; i < bellows::kEqBands; ++i) {
      lo.band[i].gain_db = -24.0f;
      lo.band[i].q = 0.1f;
      /* Above Nyquist at every rate in the sweep. */
      hi.band[i].freq = 200000.0f;
      hi.band[i].gain_db = 24.0f;
      hi.band[i].q = 40.0f;
    }
    DriveFx(fx, "Eq6", rate, lo, hi);
    delete fx;
  }
  {
    using E = bellows::Eq3;
    auto* fx = new E();
    fx->Init(rate);
    E::Params lo, hi;
    lo.low_gain = -24.0f;
    lo.mid_gain = -24.0f;
    lo.mid_q = 0.1f;
    lo.high_gain = -24.0f;
    hi.low_freq = 200000.0f;
    hi.mid_freq = 200000.0f;
    hi.high_freq = 200000.0f;
    hi.low_gain = 24.0f;
    hi.mid_gain = 24.0f;
    hi.mid_q = 40.0f;
    hi.high_gain = 24.0f;
    DriveFx(fx, "Eq3", rate, lo, hi);
    delete fx;
  }
}

}  // namespace

int main() {
  printf("delay line clamps\n");
  CheckDelayClamps();
  for (int i = 0; i < kNumRates; ++i) RunRate(kRates[i]);
  if (g_failures != 0) {
    printf("\nmemsafety: %d invariant failure(s)\n", g_failures);
    return 1;
  }
  printf("\nmemsafety: no sanitizer report and no invariant failure across %d rates\n", kNumRates);
  return 0;
}
