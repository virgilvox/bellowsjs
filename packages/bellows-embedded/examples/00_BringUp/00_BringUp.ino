/*
 * 00_BringUp: the first flash-and-listen session, as a checklist.
 *
 * Nothing in this repository has ever been flashed to a board and heard.
 * Every other number attached to this library is either a compile-time size
 * or a numerical comparison against the TypeScript. This sketch exists to
 * turn the first hour with real hardware into a fixed sequence of stages
 * with a stated pass condition each, rather than an open-ended session of
 * poking at a sketch that either makes a noise or does not.
 *
 * Read examples/00_BringUp/README.md alongside the serial output. It has
 * the wiring, the exact pio commands, and what to suspect when a stage
 * fails.
 *
 * Everything that makes a sound is in bringup.h. This file owns Serial,
 * millis() and the Teensy load counters, which is the same split the other
 * five examples use and is what keeps the audio timing independent of how
 * fast the USB host drains the serial buffer.
 *
 * WHAT THIS MEASURES THAT NOTHING ELSE DOES
 *
 * The last two stages play the same eight notes six octaves apart with
 * identical voices, identical polyphony and identical gain, and report
 * AudioProcessorUsageMax for each separately. The residual sum walks the
 * edges inside the kernel half-width, and the average count of those per
 * sample is exactly 2 * KERNEL_HALF * dt: 0.32 at A440, 5.1 at 7040 Hz. A
 * voice budget sized at A440 therefore costs more on a high lead, and the
 * ratio printed at the end of each pass is the number that sizes the budget
 * honestly. It is the ratio that matters and not any host ns figure: the
 * same class measured through two host harnesses differed by 2.6x.
 *
 * WIRING (Teensy 4.1 plus the Rev D audio shield)
 *   Shield on the header pins, headphones in the shield's jack, USB to the
 *   host. Nothing else is required. Open the serial monitor at 115200.
 *
 * MEASURED COST: see the table at the bottom of the README. This sketch is
 * instrumentation, not a size reference; the five numbered examples are the
 * ones docs/HARDWARE.md quotes and they are deliberately untouched.
 */

#include <Audio.h>
#include <string.h>

#include "bellows/platform/teensy.h"
#include "bringup.h"

static bringup::Rig rig;

static bellows::BellowsAudioStream<bringup::Rig> node(rig);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

/* Blocks handed to the audio library. The adapter needs two per update and
 * AudioOutputI2S holds a few; 24 leaves real headroom so that
 * AudioMemoryUsageMax climbing toward it means something went wrong rather
 * than that the allocation was always marginal. */
static const int kAudioBlocks = 24;

/* How long after a stage is requested before the load counters are reset.
 * The rig fades out over 10 ms and sits silent for 400 ms before the new
 * stage actually starts, so anything shorter than about 500 ms would be
 * measuring the gap. 900 ms also discards the note-on transient, which
 * makes each figure a steady-state cost. */
static const uint32_t kSettleMs = 900;

struct StageSpec {
  int id;
  uint32_t ms;
  const char* name;
  const char* hear;
  const char* pass;
};

static const StageSpec kStages[] = {
    {bringup::kSilence, 3000, "SILENCE (baseline)",
     "nothing at all: no hiss, no hum, no ticking",
     "silence, and a cpu max that is the audio graph's own cost"},

    {bringup::kSineA440, 6000, "SINE A440 (pitch reference)",
     "one steady sine tone, equal in both ears, no wobble and no buzz",
     "a guitar tuner or phone tuner app reads A4 within a couple of cents of 0"},

    {bringup::kSawA440, 5000, "SAW A440 (BLEP residual tables)",
     "the same pitch, now bright and buzzy, but even and clean",
     "the same A4 reading, with no grit or crackle riding on the tone"},

    {bringup::kKickOnly, 5000, "KICK",
     "one kick drum every 500 ms, tuned to 50 Hz",
     "a clean thump with a click on the front, and silence between hits"},

    {bringup::kKit, 6000, "DRUM KIT (euclidean patterns)",
     "kick, snare and hat over 16 sixteenths at 120 bpm",
     "steady time, every hit distinct, nothing dropped or doubled"},

    {bringup::kChord, 9000, "POLY CHORD (8 VA voices)",
     "an A minor 9 chord, three seconds on and three seconds off",
     "eight separate pitches, a smooth release, real silence between"},

    {bringup::kSweep, 7000, "PITCH SWEEP",
     "a saw gliding 55 Hz to 7040 Hz over six seconds, then repeating",
     "smooth the whole way up, no stepping, no whistle descending against it"},

    {bringup::kPolyLow, 6000, "POLY LOW (8 voices, 55 to 110 Hz)",
     "a low sustained eight note cluster, held steady",
     "steady sound, and a cpu max to compare against the next stage"},

    {bringup::kPolyHigh, 6000, "POLY HIGH (8 voices, 3520 to 7040 Hz)",
     "the same eight notes six octaves up: very bright, turn it down first",
     "steady sound, and the cpu max this whole session exists to get"},
};

static const int kStageCount = sizeof(kStages) / sizeof(kStages[0]);

/* Per-pass results, kept so the summary can compare stages that are minutes
 * apart in the listening but adjacent in the decision. */
static float cpu_max[kStageCount];
static unsigned mem_max[kStageCount];
static float drift_pct[kStageCount];

static int stage_index = -1;
static uint32_t stage_requested_ms = 0;
static uint32_t settle_ms = 0;
static uint32_t settle_frames = 0;
static bool settled = false;
static uint32_t pass_number = 0;

static float sample_rate = 44100.0f;

/* Fixed label column, so the numbers line up in a terminal without relying
 * on printf field widths. Teensy's Print::printf float support has varied
 * between releases and this cannot afford to be one of them. */
static void Label(const char* text) {
  Serial.print("    ");
  Serial.print(text);
  const int n = static_cast<int>(strlen(text));
  for (int i = n; i < 20; ++i) Serial.print(' ');
}

static void Rule(char c) {
  for (int i = 0; i < 66; ++i) Serial.print(c);
  Serial.println();
}

static void PrintHeader() {
  Serial.println();
  Rule('=');
  Serial.println("bellows 00_BringUp");
  Rule('=');

  Label("sample rate");
  Serial.print(sample_rate, 4);
  Serial.println(" Hz");
  Serial.println("      from bellows::TeensySampleRate(). Every envelope");
  Serial.println("      coefficient, filter cutoff and delay length in the");
  Serial.println("      program is derived from this number. If the codec is");
  Serial.println("      actually clocked somewhere else, stage 2 reads sharp");
  Serial.println("      or flat on a tuner by exactly that ratio.");

  Label("pitch reference");
  Serial.print(bringup::kRefHz, 2);
  Serial.println(" Hz, which is A4. Stages 2 and 3 sustain it,");
  Serial.println("      so a guitar tuner or a phone tuner app should read A4");
  Serial.println("      at 0 cents. Any consistent cents error is the ratio");
  Serial.println("      between the rate above and the codec's real clock.");

  Label("block size");
  Serial.print(bellows::kTeensyBlockSize);
  Serial.println(" frames");

  Label("expected updates");
  Serial.print(sample_rate / bellows::kTeensyBlockSize, 2);
  Serial.println(" per second");

  Label("cpu clock");
  Serial.print(F_CPU_ACTUAL / 1000000);
  Serial.println(" MHz");

  Label("audio blocks");
  Serial.print(kAudioBlocks);
  Serial.println(" allocated by AudioMemory()");

  Serial.println();
  Serial.println("  How to read each stage result:");
  Serial.println("    cpu now / cpu max  AudioProcessorUsage and its maximum,");
  Serial.println("                       reset at the start of every stage so");
  Serial.println("                       each figure belongs to one stage. It");
  Serial.println("                       is time spent inside the audio");
  Serial.println("                       interrupt. Printing from loop() runs");
  Serial.println("                       below it, but USB interrupts do not,");
  Serial.println("                       so treat it as mostly independent of");
  Serial.println("                       serial traffic rather than immune.");
  Serial.println("    audio mem max      AudioMemoryUsageMax against the");
  Serial.println("                       allocation. Reaching it means the");
  Serial.println("                       pool ran to its limit, which makes a");
  Serial.println("                       failed allocate() possible. It does");
  Serial.println("                       not prove one happened.");
  Serial.println("    frames / drift     frames the render was asked for");
  Serial.println("                       against elapsed wall time. See the");
  Serial.println("                       note under the first result.");
  Serial.println();
}

static void AnnounceStage(int i) {
  const StageSpec& s = kStages[i];
  Serial.println();
  Rule('-');
  Serial.print("stage ");
  Serial.print(i + 1);
  Serial.print(" of ");
  Serial.print(kStageCount);
  Serial.print("  ");
  Serial.print(s.name);
  Serial.print("  (");
  Serial.print(s.ms / 1000);
  Serial.println(" s)");
  Serial.print("  hear: ");
  Serial.println(s.hear);
  Serial.print("  PASS: ");
  Serial.println(s.pass);
}

/* The dropout indicator, and what it is worth.
 *
 * The rig counts frames the render was actually asked to produce. The audio
 * library calls update() once per 128 frame block, so over a measured
 * window the frame count should equal elapsed_ms * sample_rate / 1000. Two
 * real failures move it: a graph that cannot finish a block inside its
 * 2.9 ms budget gets its software interrupt run less often, and an
 * exhausted block pool makes the adapter return before rendering anything.
 * Both show up here as a negative drift.
 *
 * What it does not prove. It cannot see a single missed block: one block in
 * a six second window is 0.05 percent, which is inside the measurement's own
 * noise, since the counter is read from the main thread while the interrupt
 * writes it and millis() has 1 ms granularity. It also says nothing about
 * whether the samples were correct, only that they were asked for. A codec
 * that is muted, mis-clocked or wired to the wrong pins produces a perfect
 * drift of zero. The ear is the instrument for that, which is why every
 * stage above states what it should sound like.
 */
static void PrintDropout(uint32_t frames, uint32_t elapsed_ms, unsigned mem, float* drift_out) {
  const double expected = static_cast<double>(elapsed_ms) * sample_rate / 1000.0;
  const double drift = expected > 0.0
                           ? (static_cast<double>(frames) - expected) * 100.0 / expected
                           : 0.0;
  *drift_out = static_cast<float>(drift);

  Label("frames rendered");
  Serial.print(frames);
  Serial.print("  expected ");
  Serial.print(static_cast<uint32_t>(expected + 0.5));
  Serial.print("  drift ");
  Serial.print(drift, 3);
  Serial.println(" %");

  Label("dropouts");
  if (mem >= static_cast<unsigned>(kAudioBlocks)) {
    Serial.println("FAIL: audio block pool exhausted, blocks were lost");
  } else if (drift < -0.5) {
    Serial.println("FAIL: frame shortfall, the graph is missing updates");
  } else if (drift < -0.1) {
    Serial.println("WATCH: small shortfall, rerun before believing it");
  } else {
    Serial.println("none detected");
  }
}

static void ReportStage(int i) {
  /* Read every counter before printing anything: Serial.print is slow
   * enough that a stage would otherwise be measured over a different window
   * than the frame count it is compared against. */
  const float usage_now = AudioProcessorUsage();
  const float usage_max = AudioProcessorUsageMax();
  const unsigned mem = AudioMemoryUsageMax();
  const uint32_t frames = rig.Frames() - settle_frames;
  const uint32_t elapsed = millis() - settle_ms;

  cpu_max[i] = usage_max;
  mem_max[i] = mem;

  Serial.println("  result:");
  Label("cpu now");
  Serial.print(usage_now, 2);
  Serial.println(" %");
  Label("cpu max");
  Serial.print(usage_max, 2);
  Serial.println(" %");
  Label("audio mem max");
  Serial.print(mem);
  Serial.print(" of ");
  Serial.print(kAudioBlocks);
  Serial.println(" blocks");
  Label("voices sounding");
  Serial.println(rig.ActiveVoices());
  PrintDropout(frames, elapsed, mem, &drift_pct[i]);
}

static void PrintSummary() {
  Serial.println();
  Rule('=');
  Serial.print("SUMMARY, pass ");
  Serial.println(pass_number);
  Rule('=');

  Serial.println("  stage                                       cpu max  mem  drift %");
  for (int i = 0; i < kStageCount; ++i) {
    Serial.print("  ");
    Serial.print(kStages[i].name);
    const int n = static_cast<int>(strlen(kStages[i].name));
    for (int k = n; k < 42; ++k) Serial.print(' ');
    Serial.print(cpu_max[i], 2);
    Serial.print("    ");
    Serial.print(mem_max[i]);
    Serial.print("     ");
    Serial.println(drift_pct[i], 3);
  }

  /* The headline. Both stages ran eight Va voices with the same parameters
   * and the same gain; only the pitch differed, by six octaves. The baseline
   * is the silent stage, so subtracting it leaves the cost of the DSP rather
   * than the cost of having an audio graph at all. */
  const float base = cpu_max[0];
  const float low = cpu_max[kStageCount - 2] - base;
  const float high = cpu_max[kStageCount - 1] - base;

  Serial.println();
  Rule('-');
  Serial.println("  BLEP PITCH COST, the number this session exists to get");
  Rule('-');
  Label("graph baseline");
  Serial.print(base, 2);
  Serial.println(" % (silence)");
  Label("8 voices low");
  Serial.print(low, 2);
  Serial.println(" % over baseline, 55 to 110 Hz");
  Label("8 voices high");
  Serial.print(high, 2);
  Serial.println(" % over baseline, 3520 to 7040 Hz");

  Label("ratio");
  if (low > 0.01f) {
    Serial.print(high / low, 2);
    Serial.println("x for the same polyphony six octaves up");
  } else {
    Serial.println("not measurable, the low figure is too small");
  }

  /* Voices that fit at the top of the keyboard, leaving ten percent of the
   * block budget for everything the sketch is not doing here. */
  Label("voice ceiling");
  if (high > 0.01f) {
    const float voices = 8.0f * (90.0f - base) / high;
    Serial.print(static_cast<int>(voices));
    Serial.println(" voices at 7 kHz before the block budget runs out");
  } else {
    Serial.println("not measurable");
  }

  Serial.println();
  Serial.println("  A bare saw oscillator is about 3.7x from A440 to 7 kHz");
  Serial.println("  on the host. Expect less than that here:");
  Serial.println("  these are whole voices, and the ladder filter, envelopes");
  Serial.println("  and control-rate update cost the same at both pitches.");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  /* Bounded wait. A board on a bench power supply with no host attached must
   * still make a sound, so this cannot block forever on Serial. */
  const uint32_t start = millis();
  while (!Serial && (millis() - start) < 4000) {
  }

  AudioMemory(kAudioBlocks);
  codec.enable();
  codec.volume(0.6f);

  sample_rate = bellows::TeensySampleRate();
  rig.Init(sample_rate);

  PrintHeader();
}

void loop() {
  const uint32_t now = millis();

  if (stage_index < 0) {
    ++pass_number;
    stage_index = 0;
    stage_requested_ms = now;
    settled = false;
    rig.SetStage(kStages[0].id);
    AnnounceStage(0);
    return;
  }

  if (!settled && (now - stage_requested_ms) >= kSettleMs) {
    /* Reset both maxima here rather than at the request, so the fade, the
     * inter-stage gap and the note-on transient are all outside the window
     * and every figure is attributable to one steady stage. */
    AudioProcessorUsageMaxReset();
    AudioMemoryUsageMaxReset();
    settle_ms = now;
    settle_frames = rig.Frames();
    settled = true;
    return;
  }

  if ((now - stage_requested_ms) >= kStages[stage_index].ms) {
    ReportStage(stage_index);
    ++stage_index;
    if (stage_index >= kStageCount) {
      rig.SetStage(bringup::kSilence);
      PrintSummary();
      Serial.println("  restarting the sequence, unplug when you are done");
      stage_index = -1;
      return;
    }
    stage_requested_ms = millis();
    settled = false;
    rig.SetStage(kStages[stage_index].id);
    AnnounceStage(stage_index);
  }
}
