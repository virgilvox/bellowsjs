/*
 * 17_WorkstationI2S: 07_Workstation into an I2S amplifier, summed to mono.
 *
 * The full patch this time, with nothing filtered out. 16_WorkstationPiezo
 * had to throw away everything below 1.2 kHz because a disc cannot
 * reproduce it; a MAX98357A driving a speaker can, so the kick at 50 Hz
 * and the bass line at 110 to 262 Hz come back.
 *
 * WIRING (Teensy 4.0)
 *   Teensy 7  (OUT1A / TX)  -> DIN
 *   Teensy 21 (BCLK)        -> BCLK
 *   Teensy 20 (LRCLK)       -> LRC
 *   Teensy 5V (VIN pin)     -> VIN
 *   Teensy GND              -> GND
 *   speaker across the breakout's + and -
 *
 *   Power from 5V and not from the Teensy's 3.3V regulator. A MAX98357A is
 *   a 3W amplifier and at real volume it pulls far more than that
 *   regulator wants to give. A brownout does not look like a power
 *   problem, it looks like the audio glitching on loud notes.
 *
 *   No MCLK and no I2C. The breakout has no control interface, which is
 *   why there is no codec object here and nothing to enable: the level in
 *   the patch is the level you get.
 *
 * WHY THIS SUMS TO MONO ITSELF
 *
 * The amplifier is mono and its SD pin picks what it does with the two
 * channels: average them, or take left, or take right, according to the
 * voltage on it. The Adafruit board carries a 1M pullup there, and which
 * of those three that lands on is exactly the sort of thing worth not
 * guessing about.
 *
 * So this renders the same signal on both channels. Then every SD setting
 * gives the same result and the pin stops mattering. It also removes the
 * failure that firmware built for a piezo would hit here: the piezo chain
 * ends with r = -l, deliberately, to double the swing across a disc, and
 * an amplifier that averages L and R would sum that to exact silence.
 *
 * The cost is the stereo image, which is the delay send's cross-feed and
 * nothing else in this patch. On one speaker there was no image anyway.
 *
 * A NEW PIECE EVERY TIME IT POWERS UP
 *
 * Piece::Compose(seed) redraws the arrangement rather than just the dice:
 * the mode, the four bar progression, all five euclidean rhythms, the
 * motif the Markov chain trains on, and the tempo. So two boots are two
 * pieces, not one piece played twice with different noise.
 *
 * The seed still decides everything, which is the library's whole promise,
 * so it is printed at startup. Write down a number you liked and put it in
 * kPinnedSeed to hear that piece again.
 */

#include <Audio.h>

#include "bellows/platform/teensy.h"
#include "../07_Workstation/workstation.h"

/* 0 draws a fresh seed at power up. Set it to a number the sketch printed
 * to play that arrangement again. */
static constexpr uint32_t kPinnedSeed = 0;

static workstation::Piece piece;

/*
 * A seed that differs every time the board powers up.
 *
 * There is no real entropy source here worth the name. A Teensy 4.0 has no
 * battery-backed clock unless you fit one, so time starts at the same
 * place on every boot, and the cycle counter at the top of setup() is very
 * nearly deterministic for the same reason.
 *
 * What is genuinely noisy is an unconnected analog pin: the bottom bits of
 * a floating ADC read are thermal and pickup noise rather than a value.
 * A0 to A3 are pins 14 to 17 and are free here. Deliberately NOT A6 and
 * A7, which are pins 20 and 21, because those are carrying LRCLK and BCLK
 * to the amplifier.
 *
 * This mixes 64 of those reads with the cycle counter through an FNV
 * step. It is good enough to make two power ups different, which is all it
 * is for. It is not random in any sense worth defending, and nothing here
 * should be used to make a decision that matters.
 */
static uint32_t BootSeed() {
  uint32_t h = 2166136261u;
  for (int i = 0; i < 64; ++i) {
    const int a = analogRead(A0 + (i & 3));
    h ^= static_cast<uint32_t>(a) & 0x0fu;
    h *= 16777619u;
    h ^= ARM_DWT_CYCCNT;
    h *= 16777619u;
    delayMicroseconds(97);
  }
  /* 0 means "draw one" to the caller, so never hand back 0. */
  return h == 0u ? 1u : h;
}

/* Renders the piece, then folds it down. Same signature, so it drops
 * straight into BellowsAudioStream in place of the patch it wraps. */
struct Mono {
  void operator()(float* l, float* r, int from, int to) {
    piece(l, r, from, to);
    for (int i = from; i < to; ++i) {
      const float m = 0.5f * (l[i] + r[i]);
      l[i] = m;
      r[i] = m;
    }
  }
};

static Mono mono;
static bellows::BellowsAudioStream<Mono> node(mono);

/* No AudioControlSGTL5000 and no codec.enable(). That absence is the whole
 * difference between this and the audio shield sketch. */
static AudioOutputI2S out;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  Serial.begin(115200);
  /* Five parts and a send bus is more work per callback than one voice. */
  const float sr = bellows::TeensySampleRate();
  piece.Init(sr, 96);

  const uint32_t seed = kPinnedSeed != 0u ? kPinnedSeed : BootSeed();
  piece.Compose(seed);

  /* AudioMemory LAST, and this ordering is load bearing.
   *
   * BellowsAudioStream::update() returns early only while allocate() is
   * null, which is to say only until AudioMemory() runs. After that the
   * audio interrupt renders whatever it is pointed at, so anything
   * initialised below this line can be rendered before it is ready. A
   * delay line that has not been given its buffer reads through a null
   * pointer, which on an IMXRT1062 is executable memory rather than a
   * trap page. */
  AudioMemory(24);

  if (!piece.Trained()) Serial.println("workstation: markov table full, melody is truncated");
  Serial.println("07_Workstation -> I2S amp, summed to mono");
  Serial.print("sample rate ");
  Serial.println(sr);
  Serial.print("seed ");
  Serial.print(seed);
  Serial.println("   put this in kPinnedSeed to hear it again");
}

void loop() {
  /* The sequencer runs inside the audio callback, so the loop only
   * reports. AudioProcessorUsageMax is the number Milestone 1 exists to
   * collect, and this is the heaviest sketch in the set. */
  delay(2000);
  Serial.print("bar ");
  Serial.print(piece.Bar() + 1);
  Serial.print("/4  voices ");
  Serial.print(piece.Voices());
  Serial.print("  cpu ");
  Serial.print(AudioProcessorUsage(), 1);
  Serial.print("%  peak ");
  Serial.print(AudioProcessorUsageMax(), 1);
  Serial.print("%  mem ");
  Serial.print(AudioMemoryUsageMax());
  Serial.println();
}
