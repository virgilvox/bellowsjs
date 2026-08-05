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
 * The rate sweep asserts nothing about the audio. Sound is what the parity
 * harness is for. This one exists to make ASan and UBSan speak, so it must
 * be built with them: `npm run memsafety`. Built without them it proves
 * nothing, which is why the build script owns the flags rather than the
 * reader. (The contract checks at the top of main do assert values, because
 * two of them describe faults no sanitizer on this host can see.)
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
 *
 * IT ALSO CARRIES THE CHECKS THAT NEED A HOST RUN AND HAVE NOWHERE ELSE TO
 * GO. The parity harness compares numbers against the TypeScript, so it can
 * only ever check things the TypeScript also has; several defects are about
 * what this port does where the JS has no equivalent (an undefined cast, a
 * struct written on a failure path, a bound the JS enforces by throwing, a
 * hash whose value depends on the compiler). Those live at the top of main
 * as CheckX functions, before the rate sweep. Two of them (ToInt16 and the
 * oversampler bound) are gated by the sanitizers themselves rather than by
 * an assertion, which is why they are here and not in a plain test.
 */
#include <atomic>
#include <chrono>
#include <math.h>
#include <stdio.h>
#include <thread>

#include "bellows/core/prng.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/lfo.h"
#include "bellows/dsp/oversample.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"
#include "bellows/fx/saturator.h"
#include "bellows/io/midi_parse.h"
#include "bellows/kernel.h"
#include "bellows/platform/teensy.h"

/* The one example the size report does not build and the only stage
 * machine in the tree. Reached by path because the build line carries
 * -I src and nothing else, and adding a second include root to it would
 * make every sketch able to include an example by accident. */
#include "../../examples/00_BringUp/bringup.h"

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

/* Same, for the checks whose values are hashes and sample counts rather
 * than audio. A float cannot hold a uint32 seed without rounding it. */
void CheckU32(bool ok, const char* what, uint32_t got, uint32_t want) {
  if (ok) return;
  printf("  FAIL %s: got 0x%08x, wanted 0x%08x\n", what, got, want);
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

/* ------------------------------------------------------------------ */
/* Xmur3 does not depend on what plain char is                          */
/* ------------------------------------------------------------------ */

/*
 * The label hash is the whole determinism contract: the same label has to
 * give the same stream in the browser and on the board. It used to read
 * the label through plain char, whose signedness the standard leaves to
 * the implementation. Signed on x86-64, where test/parity/render.cpp is
 * built and where the prng row is proved bit exact; unsigned on ARM EABI,
 * which is every target this library ships to. Any label byte at or above
 * 0x80 therefore seeded two different streams, and the parity harness is
 * structurally unable to see it because it only ever builds for the host.
 *
 * So this check does not ask the host what it thinks. It computes the
 * hash BOTH ways, on purpose, and shows: the two ways really do differ on
 * a high byte (otherwise the rest proves nothing); the old formulation
 * follows whichever way this compiler happens to choose; and Xmur3 now
 * follows the unsigned one whatever the compiler chose. Compile this file
 * with -fsigned-char and again with -funsigned-char and every line still
 * passes, which is the part a single-platform run cannot show.
 */
enum class CharKind { kSigned, kUnsigned };

uint32_t XmurAs(const char* s, CharKind kind) {
  uint32_t h = 1779033703u;
  uint32_t len = 0;
  for (const char* p = s; *p; ++p) ++len;
  h ^= len;
  for (const char* p = s; *p; ++p) {
    const uint32_t byte = kind == CharKind::kSigned
                              ? static_cast<uint32_t>(static_cast<signed char>(*p))
                              : static_cast<uint32_t>(static_cast<unsigned char>(*p));
    h = (h ^ byte) * 3432918353u;
    h = (h << 13) | (h >> 19);
  }
  h = (h ^ (h >> 16)) * 2246822507u;
  h = (h ^ (h >> 13)) * 3266489909u;
  return h ^ (h >> 16);
}

/* Verbatim the line prng.h used to carry, kept so the check can show that
 * it moves with the compiler and that Xmur3 no longer does. */
uint32_t XmurPlainChar(const char* s) {
  uint32_t h = 1779033703u;
  uint32_t len = 0;
  for (const char* p = s; *p; ++p) ++len;
  h ^= len;
  for (const char* p = s; *p; ++p) {
    h = (h ^ static_cast<uint32_t>(*p)) * 3432918353u;
    h = (h << 13) | (h >> 19);
  }
  h = (h ^ (h >> 16)) * 2246822507u;
  h = (h ^ (h >> 13)) * 3266489909u;
  return h ^ (h >> 16);
}

void CheckHashSignedness() {
  /* "cafe" with an acute accent, UTF-8, so byte 3 is 0xC3 and byte 4 is
   * 0xA9. Any non-ASCII character in a label produces bytes like these. */
  static const char kHigh[] = "caf\xc3\xa9";
  static const char kAscii[] = "bringup";

  const uint32_t high_signed = XmurAs(kHigh, CharKind::kSigned);
  const uint32_t high_unsigned = XmurAs(kHigh, CharKind::kUnsigned);
  Check(high_signed != high_unsigned, "the two signedness choices differ on a high byte",
        static_cast<float>(high_signed != high_unsigned), 1.0f);
  CheckU32(high_signed == 0x33bbfd30u, "signed-char hash of the probe label", high_signed,
           0x33bbfd30u);
  CheckU32(high_unsigned == 0x1ab6029eu, "unsigned-char hash of the probe label", high_unsigned,
           0x1ab6029eu);

  /* Not vacuous the other way either: on an ASCII label the two agree, so
   * a mistake in XmurAs that made everything differ would show here. */
  CheckU32(XmurAs(kAscii, CharKind::kSigned) == XmurAs(kAscii, CharKind::kUnsigned),
           "the two agree on an ASCII label", XmurAs(kAscii, CharKind::kSigned),
           XmurAs(kAscii, CharKind::kUnsigned));

  /* What plain char is here, decided by the standard's own test rather
   * than by naming the platform. */
  const bool plain_is_signed = static_cast<char>(0xff) < 0;
  const CharKind plain = plain_is_signed ? CharKind::kSigned : CharKind::kUnsigned;
  CheckU32(XmurPlainChar(kHigh) == XmurAs(kHigh, plain),
           "the old line follows this compiler's plain char", XmurPlainChar(kHigh),
           XmurAs(kHigh, plain));

  /* The fix. Xmur3 follows the standard, not the compiler. */
  CheckU32(bellows::Xmur3(kHigh) == high_unsigned, "Xmur3 hashes bytes as unsigned",
           bellows::Xmur3(kHigh), high_unsigned);
  CheckU32(bellows::Xmur3(kAscii) == 0xe9e81acau, "Xmur3 still matches the JS on ASCII",
           bellows::Xmur3(kAscii), 0xe9e81acau);

  /* The seed is only interesting because of the numbers that come out of
   * it, so take the first draw of each stream too. */
  bellows::Rng a, b;
  a.Init(kHigh);
  b.Init(high_signed);
  Check(a.NextU32() != b.NextU32(), "and the diverged seed really is a diverged stream", 1.0f,
        1.0f);

  printf("  ok %-14s plain char is %s here; high byte 0x%08x signed, 0x%08x unsigned\n", "Xmur3",
         plain_is_signed ? "signed" : "unsigned", high_signed, high_unsigned);
}

/* ------------------------------------------------------------------ */
/* midi::Parse leaves *out untouched when it returns false              */
/* ------------------------------------------------------------------ */

/*
 * The doc comment always claimed this and the code did not do it: channel,
 * data1, data2 and bend14 were written before the switch, so every
 * truncation path left the struct half written under a stale kind. The
 * struct is poisoned with a message no input here produces, so "untouched"
 * is something the check can see rather than a default it cannot tell from
 * a write.
 */
void CheckMidiParseUntouched() {
  using bellows::midi::Kind;
  using bellows::midi::MidiMessage;
  using bellows::midi::Parse;

  const uint8_t kRejected[][3] = {
      {0x90, 60, 0},   /* note-on, velocity byte missing */
      {0x80, 60, 0},   /* note-off, same */
      {0xa0, 60, 0},   {0xb0, 7, 0},  {0xe0, 0, 0}, /* pitch bend, LSB only */
      {0xc0, 0, 0},                                 /* program change, no data */
      {0xd0, 0, 0},                                 /* channel pressure, no data */
      {0xf8, 0, 0},                                 /* clock: a system message */
      {0x40, 60, 100},                              /* running status, no status byte */
  };
  const int kLens[] = {2, 2, 2, 2, 2, 1, 1, 3, 3};

  for (int i = 0; i < 9; ++i) {
    MidiMessage m;
    m.kind = Kind::kProgramChange;
    m.channel = 9;
    m.data1 = 77;
    m.data2 = 88;
    m.bend14 = 1234;
    const bool ok = Parse(kRejected[i], kLens[i], &m);
    Check(!ok, "rejected message returns false", ok ? 1.0f : 0.0f, 0.0f);
    /* A bitmask so the failure says which field moved: 1 kind, 2 channel,
     * 4 data1, 8 data2, 16 bend14. */
    uint32_t moved = 0;
    if (m.kind != Kind::kProgramChange) moved |= 1u;
    if (m.channel != 9) moved |= 2u;
    if (m.data1 != 77) moved |= 4u;
    if (m.data2 != 88) moved |= 8u;
    if (m.bend14 != 1234) moved |= 16u;
    CheckU32(moved == 0, "rejected message leaves *out untouched", moved, 0u);
  }

  /* And the accepting paths still write every field, so the check above
   * cannot be passing because Parse stopped writing anything at all. */
  MidiMessage m;
  const uint8_t on[] = {0x92, 60, 100};
  Check(Parse(on, 3, &m) && m.kind == Kind::kNoteOn && m.channel == 2 && m.data1 == 60 &&
            m.data2 == 100 && m.bend14 == 8192,
        "note-on is parsed whole", static_cast<float>(m.data2), 100.0f);
  const uint8_t off[] = {0x92, 60, 0};
  Check(Parse(off, 3, &m) && m.kind == Kind::kNoteOff, "velocity zero is a note-off",
        static_cast<float>(static_cast<int>(m.kind)),
        static_cast<float>(static_cast<int>(Kind::kNoteOff)));
  const uint8_t press[] = {0xd3, 64, 0};
  Check(Parse(press, 2, &m) && m.kind == Kind::kChannelPressure && m.data2 == 64,
        "channel pressure mirrors data1 into data2", static_cast<float>(m.data2), 64.0f);
  const uint8_t bend[] = {0xe0, 0x00, 0x60};
  Check(Parse(bend, 3, &m) && m.kind == Kind::kPitchBend && m.bend14 == 12288,
        "pitch bend is 14 bit", static_cast<float>(m.bend14), 12288.0f);

  printf("  ok %-14s 9 rejected inputs left the message untouched\n", "midi::Parse");
}

/* ------------------------------------------------------------------ */
/* The Teensy int16 conversion is defined for every float                */
/* ------------------------------------------------------------------ */

/*
 * bellows::Clamp is comparison based, so Clamp(NaN, -1, 1) is NaN and the
 * cast that follows it was undefined. UBSan gates this one directly: built
 * without the isnan test, the NaN line below aborts with "nan is outside
 * the range of representable values of type 'short'" rather than failing an
 * assertion. The assertions are here for the value, not the fault, because
 * on Cortex-M7 the same cast quietly yields 0 and a run on the board would
 * show nothing wrong.
 */
void CheckToInt16() {
  using bellows::detail::ToInt16;
  Check(ToInt16(0.0f) == 0, "silence converts to zero", ToInt16(0.0f), 0.0f);
  Check(ToInt16(1.0f) == 32767, "+1.0 is full scale", ToInt16(1.0f), 32767.0f);
  Check(ToInt16(-1.0f) == -32767, "-1.0 is symmetric with it", ToInt16(-1.0f), -32767.0f);
  Check(ToInt16(4.0f) == 32767, "overdrive clips rather than wrapping", ToInt16(4.0f), 32767.0f);
  Check(ToInt16(-4.0f) == -32767, "and clips on the way down", ToInt16(-4.0f), -32767.0f);
  Check(ToInt16(INFINITY) == 32767, "+inf clips", ToInt16(INFINITY), 32767.0f);
  Check(ToInt16(-INFINITY) == -32767, "-inf clips", ToInt16(-INFINITY), -32767.0f);
  Check(ToInt16(NAN) == 0, "NaN is silence, not an undefined cast", ToInt16(NAN), 0.0f);
  Check(ToInt16(0.5f) == 16383, "and the scale is unchanged in between", ToInt16(0.5f), 16383.0f);
  printf("  ok %-14s NaN, both infinities and both clips are defined\n", "ToInt16");
}

/* ------------------------------------------------------------------ */
/* Oversampler refuses to write past its scratch                        */
/* ------------------------------------------------------------------ */

/*
 * src/dsp/oversample.ts throws 'Oversampler block exceeds maxBlock' at the
 * top of up() and down(). An MCU cannot throw, so the C++ truncates the
 * span instead. On the heap so ASan has redzones around buf2_ and buf4_:
 * without the clamp this is a heap-buffer-overflow of 384 floats, with it
 * the tail of the span comes through untouched. The sentinel is what makes
 * the truncation visible; the round-trip comparison is what keeps the
 * check from passing on a version that processes nothing at all.
 */
void CheckOversamplerBound() {
  constexpr int kMax = 32;
  constexpr int kSpan = 128;
  using OS = bellows::Oversampler<4, kMax>;
  auto* os = new OS();
  os->Init();

  auto* in = new float[kSpan];
  auto* out = new float[kSpan];
  const float kSentinel = -12.5f;
  /* Slow sine: the halfband pair reconstructs it to well inside the
   * tolerance below, so the surviving samples can be compared to the
   * input rather than merely being non-sentinel. */
  for (int i = 0; i < kSpan; ++i) {
    in[i] = 0.5f * sinf(static_cast<float>(i) * 0.05f);
    out[i] = kSentinel;
  }

  float* up = os->Up(in, 0, kSpan);
  os->Down(up, out, 0, kSpan);

  int written = 0;
  for (int i = 0; i < kSpan; ++i) {
    if (out[i] != kSentinel) written = i + 1;
  }
  Check(written <= kMax, "Down writes at most kMaxBlock samples", static_cast<float>(written),
        static_cast<float>(kMax));
  Check(out[kSpan - 1] == kSentinel, "and nothing past the bound", out[kSpan - 1], kSentinel);

  /* Past the 24-sample round-trip latency the output is the input again,
   * so the truncated block is a real block and not zeros. */
  const int lag = OS::kLatency;
  float worst = 0.0f;
  for (int i = lag; i < kMax; ++i) {
    const float e = fabsf(out[i] - in[i - lag]);
    if (e > worst) worst = e;
  }
  Check(worst < 5.0e-3f, "the samples inside the bound are the real round trip", worst, 5.0e-3f);

  delete[] out;
  delete[] in;
  delete os;
  printf("  ok %-14s span %d clamped to %d, round trip error %.1e\n", "Oversampler", kSpan, kMax,
         static_cast<double>(worst));
}

/* ------------------------------------------------------------------ */
/* Lfo sample and hold modulates without an injected Rng                */
/* ------------------------------------------------------------------ */

/*
 * With a null Rng the C++ held_ was 0 forever, so kSampleHold was a
 * constant and Tremolo (whose Init defaults the Rng to nullptr) produced a
 * fixed gain while looking like it was modulating. The JS constructor
 * substitutes rng('lfo/sh'), so the fix is to substitute the same stream,
 * and the second half of this check is what says "the same": an LFO handed
 * an explicit 'lfo/sh' stream has to produce the identical sequence.
 */
void CheckLfoSampleHold() {
  constexpr int kN = 2048;
  constexpr float kRate = 48000.0f;

  bellows::Lfo silent;
  silent.Init(kRate);
  silent.SetShape(bellows::LfoShape::kSampleHold);
  silent.SetFreq(1000.0f); /* 48 samples a cycle, so 42 holds in kN */

  bellows::Rng explicit_rng;
  explicit_rng.Init("lfo/sh");
  bellows::Lfo injected;
  injected.Init(kRate, &explicit_rng);
  injected.SetShape(bellows::LfoShape::kSampleHold);
  injected.SetFreq(1000.0f);

  float lo = 2.0f, hi = -2.0f;
  int steps = 0, mismatches = 0;
  float prev = silent.Process();
  float first = injected.Process();
  if (first != prev) mismatches++;
  for (int i = 1; i < kN; ++i) {
    const float y = silent.Process();
    if (injected.Process() != y) mismatches++;
    if (y != prev) steps++;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
    prev = y;
  }

  Check(steps > 8, "sample and hold with no Rng actually steps", static_cast<float>(steps), 8.0f);
  Check(hi - lo > 0.5f, "and covers a real span of the bipolar range", hi - lo, 0.5f);
  CheckU32(mismatches == 0, "the default stream is the JS 'lfo/sh' stream",
           static_cast<uint32_t>(mismatches), 0u);

  /* The shape the finding is about: a Tremolo built the documented way. */
  auto* trem = new bellows::Tremolo();
  trem->Init(kRate);
  bellows::Tremolo::Params p;
  p.rate = 1000.0f; /* clamped to 100 Hz, so 480 samples a hold */
  p.depth = 1.0f;
  p.shape = bellows::LfoShape::kSampleHold;
  trem->SetParams(p);
  float gmin = 2.0f, gmax = -2.0f;
  /* 64 blocks is 8192 samples, 17 holds: enough that the span is a
   * property of the shape rather than of which two values came first. */
  for (int b = 0; b < 64; ++b) {
    for (int i = 0; i < kBlock; ++i) {
      g_l[i] = 1.0f;
      g_r[i] = 1.0f;
    }
    trem->Process(g_l, g_r, 0, kBlock);
    for (int i = 0; i < kBlock; ++i) {
      if (g_l[i] < gmin) gmin = g_l[i];
      if (g_l[i] > gmax) gmax = g_l[i];
    }
  }
  /* The broken shape was a constant 1 - depth/2, so any span at all
   * catches it; 0.5 is asked for because a working one covers most of the
   * range and a barely-moving one would be its own defect. */
  Check(gmax - gmin > 0.5f, "a default Tremolo in sample and hold modulates", gmax - gmin, 0.5f);
  delete trem;

  printf("  ok %-14s %d holds, span %.2f, tremolo gain %.2f..%.2f\n", "Lfo S+H", steps,
         static_cast<double>(hi - lo), static_cast<double>(gmin), static_cast<double>(gmax));
}

/* ------------------------------------------------------------------ */
/* The kernel, scheduled the way its signature says                     */
/* ------------------------------------------------------------------ */

/*
 * test/sketches/s9n_kernel.cpp was the only kernel call site in the tree
 * and it passed (note_id, hz, vel, frame) to a function that takes
 * (frame, note_id, hz, vel). It compiled because float to uint16_t is a
 * legal implicit conversion in a call, and it rendered 5.4x full scale
 * from notes at 0.9 and 0.7 Hz. Nothing ran it, so nothing said so.
 *
 * This is the same three events written correctly, and it asserts the two
 * things the argument order decides: the block is a sane amplitude, and
 * the second note is inaudible until frame 40, which is the block
 * splitting the sketch's comment claims. A swapped call puts both notes
 * at frame 0 and fails the second check as well as the first.
 */
void CheckKernelSchedule() {
  using K = bellows::Kernel<bellows::Kick, 4, 32, 4>;
  auto* both = new K();
  auto* first_only = new K();
  both->Init(kDesignRate);
  both->InitVoices(kDesignRate);
  first_only->Init(kDesignRate);
  first_only->InitVoices(kDesignRate);

  both->PushNoteOn(0, 50, 55.0f, 0.9f);
  both->PushNoteOn(40, 60, 110.0f, 0.7f);
  both->PushNoteOff(96, 50);
  first_only->PushNoteOn(0, 50, 55.0f, 0.9f);

  float bl[kBlock], br[kBlock], fl[kBlock], fr[kBlock];
  both->Process(bl, br, kBlock);
  first_only->Process(fl, fr, kBlock);

  float peak = 0.0f;
  for (int i = 0; i < kBlock; ++i) {
    if (fabsf(bl[i]) > peak) peak = fabsf(bl[i]);
    if (fabsf(br[i]) > peak) peak = fabsf(br[i]);
  }
  Check(peak > 0.05f, "the kernel rendered something", peak, 0.05f);
  Check(peak < 1.5f, "and one Kick at velocity 0.9 is not 5x full scale", peak, 1.5f);

  int same = 0;
  for (int i = 0; i < 40; ++i) {
    if (bl[i] == fl[i] && br[i] == fr[i]) same++;
  }
  Check(same == 40, "the second note is silent until its frame", static_cast<float>(same), 40.0f);
  int differ = 0;
  for (int i = 40; i < kBlock; ++i) {
    if (bl[i] != fl[i]) differ++;
  }
  Check(differ > 0, "and audible from it, so the block really was split",
        static_cast<float>(differ), 1.0f);

  printf("  ok %-14s peak %.3f, split at frame 40, %d frames changed after it\n", "Kernel",
         static_cast<double>(peak), differ);
  delete first_only;
  delete both;
}

/* ------------------------------------------------------------------ */
/* The bring-up rig's stage machine                                     */
/* ------------------------------------------------------------------ */

/*
 * SetStage() is called from loop() and AdvancePhase() runs in the audio
 * interrupt. They used to write phase_ and target_ both, so an interrupt
 * landing inside SetStage could store kRunning last and lose the fade-out,
 * and because the early-out compared against pending_ the next request for
 * the same stage was a no-op: the rig stayed on the old stage while the
 * .ino printed numbers under the new stage's name. SetStage now publishes
 * a request with one release store and the interrupt owns the machine.
 *
 * What this checks is the request path: a request is honoured, it is not
 * honoured instantly (the fade and the gap come first), a repeat is a
 * no-op, and a second request before the first lands wins. It does NOT
 * reproduce the interleaving, which needs two real contexts; a host run
 * with one thread sees the same sequence either way. The race is closed by
 * structure instead, single writer plus single-word publication, which is
 * the kind of claim a comment has to carry rather than a test.
 *
 * A short rate keeps the 400 ms gap to 40 blocks so this costs 0.05 s.
 */
void CheckBringUpStages() {
  constexpr float kRate = 12800.0f; /* gap 5120 frames, 40 blocks */
  auto* rig = new bringup::Rig();
  rig->Init(kRate);

  auto run = [&](int blocks) {
    for (int b = 0; b < blocks; ++b) {
      for (int i = 0; i < kBlock; ++i) {
        g_l[i] = 0.0f;
        g_r[i] = 0.0f;
      }
      (*rig)(g_l, g_r, 0, kBlock);
    }
  };
  auto settle = [&](int stage, int cap) {
    int blocks = 0;
    while (rig->CurrentStage() != stage && blocks < cap) {
      run(1);
      ++blocks;
    }
    return blocks;
  };

  Check(rig->CurrentStage() == bringup::kSilence, "the rig starts silent",
        static_cast<float>(rig->CurrentStage()), static_cast<float>(bringup::kSilence));

  rig->SetStage(bringup::kSineA440);
  run(1);
  Check(rig->CurrentStage() == bringup::kSilence, "a request does not take effect instantly",
        static_cast<float>(rig->CurrentStage()), static_cast<float>(bringup::kSilence));
  const int took = settle(bringup::kSineA440, 200);
  Check(rig->CurrentStage() == bringup::kSineA440, "and it is honoured",
        static_cast<float>(rig->CurrentStage()), static_cast<float>(bringup::kSineA440));
  Check(took >= 39, "after the fade and the whole gap", static_cast<float>(took), 39.0f);
  Check(rig->Running(), "and the rig reports itself running", rig->Running() ? 1.0f : 0.0f, 1.0f);

  /* Every remaining stage in order, which is what the .ino does. */
  for (int s = bringup::kSawA440; s < bringup::kStageCount; ++s) {
    rig->SetStage(s);
    const int n = settle(s, 200);
    Check(rig->CurrentStage() == s, "every stage is reachable in order",
          static_cast<float>(rig->CurrentStage()), static_cast<float>(s));
    Check(n > 0 && n < 200, "and lands inside the cap", static_cast<float>(n), 200.0f);
    /* Asking again for the stage it is already on changes nothing. */
    rig->SetStage(s);
    run(2);
    Check(rig->CurrentStage() == s, "a repeat request is a no-op",
          static_cast<float>(rig->CurrentStage()), static_cast<float>(s));
  }

  /* A second request before the first has landed: the last one wins and
   * the abandoned one is never entered. */
  rig->SetStage(bringup::kKickOnly);
  run(3);
  rig->SetStage(bringup::kChord);
  int seen_kick = 0;
  for (int b = 0; b < 200 && rig->CurrentStage() != bringup::kChord; ++b) {
    run(1);
    if (rig->CurrentStage() == bringup::kKickOnly) seen_kick++;
  }
  Check(rig->CurrentStage() == bringup::kChord, "the later request wins",
        static_cast<float>(rig->CurrentStage()), static_cast<float>(bringup::kChord));
  Check(seen_kick == 0, "and the abandoned one is never entered", static_cast<float>(seen_kick),
        0.0f);

  printf("  ok %-14s %d stages, %d blocks to the first\n", "bringup::Rig", bringup::kStageCount,
         took);
  delete rig;
}

/*
 * The same rig with the render running in a second thread, which is the
 * only check in this repository that can see a data race at all.
 *
 * A thread is not an interrupt, but it is the same hazard: two contexts
 * storing to the stage machine with no ordering between them. The loop
 * side asks for a stage and waits for it, the way 00_BringUp.ino does,
 * and a request that never lands is the wedge the finding describes,
 * because SetStage's early-out makes every later request for the same
 * stage a no-op.
 *
 * Measured on this host, 400 requests at a 1280 Hz rate so the gap is four
 * blocks: the version before the fix wedged 64 and 67 times in two runs of
 * 400 (47 and 50 of them on kPolyHigh, the slowest stage and so the widest
 * window), and the version after it wedged 0 in six runs. A passing build
 * has two orders of magnitude of headroom on the budget below, so the
 * check can only fail for the reason it is looking for.
 *
 * Detection is probabilistic, which is why the deterministic request path
 * check above exists as well: this one can only ever say "it happened",
 * never "it cannot happen".
 */
void CheckBringUpUnderRenderThread() {
  constexpr int kRequests = 400;
  /* 250 ms against a measured worst wait of 3 ms under the sanitizers, and
   * the run gives up after three losses: a wedged build otherwise spends
   * the budget twice per request and takes minutes to report. */
  constexpr int kBudgetMs = 250;
  constexpr int kMaxWedges = 3;
  auto* rig = new bringup::Rig();
  rig->Init(1280.0f);

  std::atomic<bool> stop{false};
  std::thread audio([&] {
    float l[kBlock], r[kBlock];
    while (!stop.load(std::memory_order_relaxed)) {
      for (int i = 0; i < kBlock; ++i) {
        l[i] = 0.0f;
        r[i] = 0.0f;
      }
      (*rig)(l, r, 0, kBlock);
    }
  });

  using clock = std::chrono::steady_clock;
  int wedged = 0;
  long worst_ms = 0;
  for (int p = 0; p < kRequests; ++p) {
    const int want = 1 + (p % (bringup::kStageCount - 1));
    rig->SetStage(want);
    const auto t0 = clock::now();
    long ms = 0;
    while (rig->CurrentStage() != want && ms < kBudgetMs) {
      ms = std::chrono::duration_cast<std::chrono::milliseconds>(clock::now() - t0).count();
    }
    if (ms > worst_ms) worst_ms = ms;
    if (rig->CurrentStage() != want) {
      ++wedged;
      /* Recover through a different stage, since asking for this one
       * again is exactly the no-op the wedge consists of. */
      rig->SetStage(bringup::kSilence);
      const auto t1 = clock::now();
      while (rig->CurrentStage() != bringup::kSilence &&
             std::chrono::duration_cast<std::chrono::milliseconds>(clock::now() - t1).count() <
                 kBudgetMs) {
      }
      if (wedged >= kMaxWedges) break;
    }
  }

  stop.store(true);
  audio.join();
  Check(wedged == 0, "no stage request is lost to the render thread", static_cast<float>(wedged),
        0.0f);
  printf("  %-2s %-14s %d requests across the thread boundary, %d lost, worst wait %ld ms\n",
         wedged == 0 ? "ok" : "--", "bringup race", kRequests, wedged, worst_ms);
  delete rig;
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
  printf("defined behaviour and documented contracts\n");
  CheckHashSignedness();
  CheckMidiParseUntouched();
  CheckToInt16();
  CheckOversamplerBound();
  CheckLfoSampleHold();
  CheckKernelSchedule();
  CheckBringUpStages();
  CheckBringUpUnderRenderThread();

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
