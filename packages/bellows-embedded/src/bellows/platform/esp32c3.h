/* ESP32-C3 glue: a bellows render behind the Arduino ESP_I2S class.
 *
 * The other two adapters are push shaped. The Teensy Audio Library calls
 * update() from a software interrupt and libDaisy calls a function pointer
 * from the SAI interrupt, so in both cases the hardware decides when the
 * render runs. ESP_I2S in Arduino-ESP32 core 3.3.10 has no callback at all.
 * Its only output path is
 *
 *     size_t I2SClass::write(const uint8_t* buf, size_t bytes);
 *
 * which loops on i2s_channel_write until every byte is queued
 * (ESP_I2S.cpp:1327). So this adapter is pull shaped: Fill() renders one
 * block, converts it, and writes it, and the write blocks until the DMA
 * queue has room. That blocking write is the clock. There is no timer, no
 * callback and no ring buffer of the adapter's own, and the caller drives
 * it from a loop that does nothing else.
 *
 * The block is written back to the caller with the same sample in both I2S
 * slots. On the board this header was written for, an NS4168 with its CTRL
 * pin unwired, the channel the amplifier selects is not knowable from
 * software, so a stereo render that lands in only one slot is a coin flip
 * between the mix and half the mix. Fill() sums to mono and duplicates.
 * That is a correctness requirement here, not a taste in mixing, and it is
 * why the slot mode below is stereo rather than I2S_SLOT_MODE_MONO: the
 * duplication happens in our own int16 buffer where it is visible, not in a
 * driver path whose behaviour depends on the I2S hardware revision.
 *
 * THERE IS NO FPU ON THIS PART, WHICH IS THE FIRST THING TO KNOW.
 *
 * The C3 is RV32IMC. There is no F extension and there never will be: the
 * toolchain's own -print-multi-lib lists single precision float only on the
 * rv32imafc and ilp32f multilibs, and the C3 is not one of them. Every
 * float add, multiply, divide and compare in this library therefore becomes
 * a call into libgcc's soft-float. That soft-float is the glibc soft-fp C
 * framework rather than hand written assembly, and the part has no Zbb, so
 * each normalization also calls __clzsi2. A single float multiply costs
 * about 108 instructions.
 *
 * What that means for the two halves of bellows is not the same answer.
 *
 * The control-rate half ports cleanly and is the reason to reach for this
 * library on this part at all. bellows/theory, bellows/seq and
 * bellows/core/prng.h are integer arithmetic over small constant tables and
 * run once per note event, not once per sample. Scales, chords, tunings,
 * Euclid, the arpeggiator, the cellular automata, the L-system and the
 * PRNG all cost effectively nothing here, and the PRNG stays bit identical
 * to the JavaScript so a stream recorded in the browser replays on the
 * board.
 *
 * The per-sample half is where this part bites, but the answer is NOT the
 * same for every engine, and an earlier revision of this banner said it was.
 * That revision measured Va and Kick and generalised from them, which is the
 * mistake this file now exists to not repeat: it told a reader to abandon
 * the library's per-sample path three hundred lines above a usage block that
 * instantiates a Pluck.
 *
 * At 160 MHz and 22050 Hz the budget is 7256 cycles per sample frame. This
 * core is in-order and single issue, so an instruction count is a LOWER
 * BOUND on cycles: N instructions cost at least N cycles, and more once
 * instruction fetch from XIP flash is counted. Every figure below is
 * instructions retired. None of them has run on hardware.
 *
 * A float Va voice does not fit and is not close: about 56000 instructions
 * per sample, at least 7.7 frames. BELLOWS_FAST_MATH=1 brings it to about
 * 32000, at least 4.4 frames. Va is the most expensive engine in the
 * library and is the wrong thing to generalise from.
 *
 * Pluck DOES fit. Measured by building a Pluck<110, 22050> sketch at the
 * FQBN in tools/check-esp32c3.sh and disassembling: 34 soft-float calls per
 * sample, 10 inlined into Process and 24 inside the out-of-line
 * DelayLineExt::ReadCubic, plus 212 instructions of its own. Priced against
 * the toolchain's own libgcc for rv32imc/ilp32 that is 2855 instructions per
 * sample, and with this adapter's 397 per frame, 3252 against 7256. One
 * voice is about 45 percent of the chip. Two is about 84 percent and is not
 * a commitment worth making without a board. Three does not fit. 92.6
 * percent of a Pluck sample is spent inside libgcc, not inside bellows.
 *
 * A single Kick is about 6330 instructions per sample, 6727 with the
 * adapter, which is 93 percent of the frame: one drum, no polyphony, no
 * margin.
 *
 * Modal, Tube and everything else are unmeasured on this target. MEASURE
 * before choosing Q15 rather than assuming, which is the whole lesson of
 * the paragraph above. If Q15 is the answer for your engine, note that this
 * adapter's own 397 instructions per frame are paid either way, which is
 * the argument for eventually writing an int16 pump of your own with the
 * same shape as Fill(). The other way out is a part with an FPU (ESP32-S3,
 * ESP32-P4, RP2350), where this same header works unchanged and none of the
 * warnings above apply.
 *
 * The soft-float routines live in ROM at 0x40000xxx and their bodies cannot
 * be disassembled from the image, so they were priced from the toolchain's
 * own libgcc for the same ISA and ABI, executed under an instruction-level
 * interpreter. The ROM holds different code, frozen from an earlier GCC. It
 * would have to be 2.6x costlier than what was priced before the one-voice
 * Pluck conclusion changed; the two-voice figure does not survive that band.
 *
 * The adapter's own float cost is small but it is not zero, and it is worth
 * knowing because it is paid whatever the render does. Measured by building
 * the tools/check-esp32c3.sh sketch with its Kick replaced by an empty
 * render, Arduino-ESP32 3.3.10 at -Os for the esp32c3 FQBN, and
 * disassembling: Fill() inlines into a loop() of 286
 * bytes, the two block clears become one memset, and the conversion loop
 * makes exactly seven soft-float calls per frame. In emitted order:
 * __addsf3 for l + r, __mulsf3 for the 0.5, __unordsf2 for the NaN test,
 * __gesf2 and __gtsf2 for the two clamp compares, __mulsf3 for the 32767,
 * and __fixsfsi for the cast. That is 448 calls per 64 frame block.
 *
 * Those routines link at 0x40000xxx, which is ROM, so they cost no flash
 * and cannot be substituted. Their cycle cost is therefore not countable
 * from the image; at the figure this project measured elsewhere, about 108
 * instructions for a float multiply, seven calls is on the order of 700
 * instructions per frame against a 7256 cycle frame budget. Call it a tenth
 * of the core, spent before any voice sounds. A fixed point render that
 * hands this adapter floats pays it too, which is the argument for
 * eventually writing an int16 pump of your own with the same shape as
 * Fill() once the instrument has settled.
 *
 * Set BELLOWS_FAST_MATH=1 on this part regardless of what else you do. At
 * the default of 0 every fm:: call site lands in newlib, and newlib's sinf
 * drags in __kernel_rem_pio2f and the soft double helpers behind it.
 *
 * Be precise about what the flag buys, because an earlier revision of this
 * line was not. For an engine that calls fm:: per sample it is close to the
 * difference between a sketch that makes a sound and one that does not. For
 * Pluck it changes the per-sample path by NOTHING: the FAST_MATH=0 and
 * FAST_MATH=1 render loops are instruction identical, because Pluck::Process
 * makes no fm:: calls at all. What the flag still buys there is 9234 bytes
 * of flash and a cheaper NoteOn. Set it anyway; do not credit it with a
 * per-sample win it did not deliver for your engine without checking.
 *
 * Also build -DBELLOWS_TEMPO_SCALAR=float, or do not include
 * bellows/seq/tempomap.h. That header defaults to double and calls log and
 * exp directly rather than through bellows::fm, deliberately, because a
 * timestamp needs more accuracy than the polynomials give. On a part with
 * no FPU that is soft double, which is worse again than soft float. The
 * header's own comment names the ESP32 as the case for the knob.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "bellows/config.h"
/* For bellows::detail::ToInt16, which lives above the TEENSYDUINO guard in
 * teensy.h precisely so that non-Teensy code can reach it. Off Teensy this
 * include is that one function plus config.h and nothing else. Its NaN
 * branch is not theoretical: a raw cast of NaN to int16_t is undefined and
 * was caught under UBSan, and the realistic source is a self-oscillating
 * filter or a divide in a feedback path handing us a NaN block. */
#include "bellows/platform/teensy.h"

/* ARDUINO_ARCH_ESP32 rather than a C3-only define, for the same reason
 * daisy.h guards on STM32H750xx rather than on a libDaisy version macro:
 * the guard has to depend on the target, not on the sketch's include order.
 * Every Arduino-ESP32 build passes this one, and ESP_I2S is part of the
 * core for every variant that has I2S at all.
 *
 * So the guard is wider than the file name, on purpose. Nothing below is
 * specific to the C3; what is specific to the C3 is the absence of an FPU,
 * and that is a property of the render the sketch hands us rather than of
 * this adapter. On an S3 or a P4 this header works unchanged and the
 * soft-float warning in the banner does not apply. CONFIG_IDF_TARGET_ESP32C3
 * is the define to test if a sketch wants to branch on the part itself.
 *
 * BELLOWS_TARGET_ESP32C3 is the explicit opt in, for a build system that
 * does not pass the Arduino arch define. */
#if defined(BELLOWS_TARGET_ESP32C3) || defined(ARDUINO_ARCH_ESP32)

#include <ESP_I2S.h>

namespace bellows {

/* Frames per Fill(), and the rate to hand every Init().
 *
 * Both default to the library-wide knobs so a sketch that sets
 * -DBELLOWS_SAMPLE_RATE=22050 -DBELLOWS_BLOCK_SIZE=64 has stated each
 * number once. That matters more here than on the other two boards,
 * because there is no SDK constant to read either of them back from.
 *
 * On the rate, specifically. I2SClass::txSampleRate() exists and looks like
 * a readback, but ESP_I2S.cpp:1341 returns the number that was handed to
 * begin(), stored verbatim. It is an echo, not a measurement of where the
 * PLL landed, so it cannot serve the purpose hw.AudioSampleRate() serves on
 * a Daisy. This header owns the figure instead: Start() passes
 * kEsp32SampleRateHz to begin() and the sketch passes Esp32SampleRate() to
 * every Init(), so there is one source and it cannot drift.
 *
 * 22050 is the sensible default on a C3. It is reachable cleanly, since the
 * part has SOC_I2S_SUPPORTS_PLL_F160M and the default mclk multiple of 256
 * puts mclk at 5.6448 MHz off a fractional divider from 160 MHz, and going
 * to 44100 halves an already thin budget for nothing audible through a
 * small speaker. On a variant with an FPU, set it to whatever that part can
 * carry.
 *
 * On the block, 64 frames is 2.90 ms at 22050. Block size is not a
 * constraint on this library, because the kernel splits a block at event
 * frames and renders each span as its own (from, to) range, so the figure
 * is chosen for latency alone. Note that tying it to BELLOWS_BLOCK_SIZE
 * also sizes the oversampled effects for exactly the block they are handed:
 * BELLOWS_BLOCK_SIZE is the default kMaxBlock of fx/dynamics.h and
 * fx/saturator.h, and those are the only other readers of it. */
#ifndef BELLOWS_ESP32_SAMPLE_RATE
#define BELLOWS_ESP32_SAMPLE_RATE BELLOWS_SAMPLE_RATE
#endif
#ifndef BELLOWS_ESP32_BLOCK_SIZE
#define BELLOWS_ESP32_BLOCK_SIZE BELLOWS_BLOCK_SIZE
#endif

inline constexpr uint32_t kEsp32SampleRateHz = BELLOWS_ESP32_SAMPLE_RATE;
inline constexpr int kEsp32BlockSize = BELLOWS_ESP32_BLOCK_SIZE;
inline float Esp32SampleRate() { return static_cast<float>(kEsp32SampleRateHz); }

/* BELLOWS_BIG_BUFFER is deliberately NOT defined here, and it is not an
 * oversight to be corrected later.
 *
 * teensy.h defines it to EXTMEM only under __IMXRT1062__ and daisy.h to
 * DSY_SDRAM_BSS, and both refuse an off-target fallback for a reason that
 * applies to this board harder than to either of those: an empty fallback
 * would quietly put a megabyte of delay line in internal SRAM and turn an
 * obvious link failure into a mysterious one. An ESP32-C3 SuperMini has
 * 400 KB of SRAM and no PSRAM, so a sketch that asks for a big buffer
 * should fail to compile, which is what leaving this undefined does.
 *
 * A variant that does have PSRAM is a different board from this one and
 * should define the attribute itself. Note that the routing through the
 * cache makes it the wrong home for anything read more than once per
 * sample either way.
 *
 * RAM is not the wall on this part. CPU is. Four Tube voices plus this
 * adapter's scratch is under 8 KB against 400. What does not fit is cycles,
 * and the sizing knob that matters is not where a buffer lives but
 * StereoDelay<kMaxMs> and Pluck<kMinFreqHz>: the defaults size for 48000
 * and 20 Hz, so set both explicitly at every instantiation rather than
 * trusting -DBELLOWS_SAMPLE_RATE to reach them. */

/* Wraps any callable with the bellows render signature
 *
 *     void operator()(float* l, float* r, int from, int to)
 *
 * as an I2S output pump.
 *
 *     struct MyPatch {
 *       bellows::Pluck<110, 22050> v;
 *       void operator()(float* l, float* r, int from, int to) {
 *         v.Process(l, r, from, to);
 *       }
 *     };
 *     static I2SClass i2s;
 *     static MyPatch patch;
 *     static bellows::Esp32I2sAudio<MyPatch> audio;
 *
 *     void setup() {
 *       patch.v.Init(bellows::Esp32SampleRate(), &rng);
 *       audio.Start(i2s, patch, 10, 20, 21);   // bclk, lrclk, dout
 *     }
 *
 *     void loop() {
 *       audio.Fill();     // blocks on the DMA queue, which is the clock
 *     }
 *
 * Render is a template parameter rather than a virtual interface or a
 * function pointer, so the call inlines and the linker still keeps only the
 * engines the sketch reached. Unlike DaisyAudio there is no static render
 * pointer, because there is no bare C callback to carry a context through:
 * Fill() is called by the sketch and has `this`.
 *
 * TWO THINGS THE LOOP ABOVE GETS WRONG ON A REAL BOARD, both worth knowing
 * before the first bench session.
 *
 * One, the latency. ESP_I2S allocates its channel at dma_desc_num 6 and
 * dma_frame_num 240 (ESP_I2S.cpp:33), and there is no setter for either in
 * the public API. That is 1440 frames of reservoir, which at 22050 Hz is
 * 65 ms between a key press and a sound. It is fine for bring up, where the
 * deep reservoir is a feature because it hides every stall, and it is not
 * playable. Shrinking it means calling i2s_new_channel and
 * i2s_channel_init_std_mode from driver/i2s_std.h yourself with your own
 * i2s_chan_config_t, at which point this adapter is not the thing writing
 * the bytes any more and you want your own pump with the same shape as
 * Fill(). Grabbing i2s.txChan() does not help, since the channel is already
 * allocated by then.
 *
 * Two, where Fill() is called from. Arduino-ESP32's loopTask calls
 * yieldIfNecessary() at the top of every loop() iteration, and on a
 * CONFIG_FREERTOS_UNICORE build, which the C3 is, that does vTaskDelay(5)
 * every 2000 ms (cores/esp32/main.cpp:26-35 and :76-78). A render pumped
 * from loop() with a reservoir shallower than about 8 ms therefore drops
 * out every two seconds, forever, and it is not obvious where the noise is
 * coming from. The stock 65 ms reservoir swallows it, which is the second
 * reason bring up is comfortable and stage two is not. Once the buffering
 * comes down, move Fill() into its own FreeRTOS task at priority 2 and
 * leave the sensor polling in loop(). The division is self-policing: the
 * pump is asleep inside the blocking write for most of every block and
 * loop() gets that slack, so going over budget starves the sensors, which
 * is a loud failure rather than a subtle one.
 *
 * Never call Serial.print from whichever context runs Fill(). USB CDC on
 * this part blocks for milliseconds when the host is not draining, and no
 * amount of DMA saves a render from a host that has gone away.
 */
template <class Render>
class Esp32I2sAudio {
 public:
  static constexpr int kBlockSize = kEsp32BlockSize;

  /* Bind the I2S object and the render without touching the hardware, for
   * a sketch that configures the channel itself. Both must outlive the
   * pump, which in practice means file scope, never a setup() local. */
  void Init(I2SClass& i2s, Render& render) {
    i2s_ = &i2s;
    render_ = &render;
  }

  /* Bind, set the pins and start the channel in one call, the same shape as
   * DaisyAudio::Start(hw, render). Returns what begin() returned: false
   * means the channel did not come up and i2s.lastError() carries the
   * esp_err_t.
   *
   * Stereo slots at 16 bits, which is what the NS4168 and every other
   * three-wire I2S amplifier of that class expects, and what makes the
   * both-slots rule below expressible. On a C3 this is also the cheap path:
   * the part is SOC_I2S_HW_VERSION_2, so every _mono_hw_workaround and
   * _8bit_hw_packing branch inside write() is compiled out and a 16-bit
   * stereo write goes straight down the plain loop with no repacking. */
  bool Start(I2SClass& i2s, Render& render, int bclk, int lrclk, int dout) {
    Init(i2s, render);
    i2s.setPins(static_cast<int8_t>(bclk), static_cast<int8_t>(lrclk),
                static_cast<int8_t>(dout));
    return i2s.begin(I2S_MODE_STD, kEsp32SampleRateHz, I2S_DATA_BIT_WIDTH_16BIT,
                     I2S_SLOT_MODE_STEREO);
  }

  /* Render one block and write it. BLOCKS until the DMA queue has taken
   * every byte, which is the point: this call paces the whole sketch.
   *
   * The ceiling on that block is 1000 ms, not forever. ESP_I2S passes
   * Stream::_timeout to i2s_channel_write and never declares its own, so it
   * inherits the Arduino Stream default of 1000 (cores/esp32/Stream.h:62).
   * The wait is on an ISR event rather than a spin, so the calling task
   * sleeps and the rest of the system runs.
   *
   * Returns false if the pump was never bound, or if the write came up
   * short, which means the channel is not running or the timeout expired.
   * i2s.lastError() carries the reason. */
  bool Fill() {
    if (i2s_ == nullptr || render_ == nullptr) return false;

    /* Voices add into the range rather than overwriting it, so the block
     * starts silent. This is load-bearing rather than tidy, exactly as in
     * the other two adapters: these are plain member arrays, so a block
     * that is not cleared plays back whatever the previous one left, and on
     * the very first call whatever the linker left in .bss. */
    for (int i = 0; i < kEsp32BlockSize; ++i) {
      l_[i] = 0.0f;
      r_[i] = 0.0f;
    }

    (*render_)(l_, r_, 0, kEsp32BlockSize);

    /* Sum to mono, then write the SAME sample into both slots.
     *
     * The NS4168's CTRL pin is not wired on the board this was written for,
     * so which slot it takes is unknown and a stereo image would be a coin
     * flip. Duplicating here makes the answer the same either way.
     *
     * The 0.5 is a sum, not an attenuation, and it lands where you want it:
     * bellows voices pan centre by adding 0.70710678 into each of l and r,
     * so a centred voice comes out of this at 0.70710678, the same level it
     * would have had in either channel of a stereo out. A hard panned
     * source loses 6 dB, which is the correct answer for a mono fold.
     *
     * Clip after the sum rather than before. Two channels at 0.8 sum to
     * 0.8, so clipping first would flatten peaks that the fold was about to
     * make legal anyway. ToInt16 does the hard clip and the NaN guard.
     *
     * This spends two soft-float multiplies per frame where one would do,
     * since 0.5 and ToInt16's 32767 could fold to a single 16383.5. Folding
     * them would mean clamping against +/-32767 after the scale instead of
     * against +/-1 before it, which is a second conversion function with
     * its own NaN branch, and that branch is the one thing here that has
     * already been caught wrong once under UBSan. One multiply out of the
     * seven soft-float calls this loop makes per frame is not worth forking
     * the audited path for. */
    for (int i = 0; i < kEsp32BlockSize; ++i) {
      const int16_t m = detail::ToInt16((l_[i] + r_[i]) * 0.5f);
      pcm_[2 * i] = m;
      pcm_[2 * i + 1] = m;
    }

    const size_t bytes = sizeof(pcm_);
    return i2s_->write(reinterpret_cast<const uint8_t*>(pcm_), bytes) == bytes;
  }

 private:
  Render* render_ = nullptr;
  I2SClass* i2s_ = nullptr;

  /* Scratch as members, which is where this adapter parts company with
   * teensy.h. That header shares one scratch pair across every stream in
   * the sketch, and it is right to, because the audio software interrupt
   * calls update() on each node in sequence and never re-enters, so two
   * streams cannot be inside their conversion loops at once. There is no
   * such guarantee here. FreeRTOS is preemptive, the recommended structure
   * puts the pump in its own task, and a second pump in another task at
   * another priority would interleave with the first. 64 frames costs
   * 768 bytes per instance, which against 400 KB is not worth a hazard that
   * would present as intermittent noise.
   *
   * Nothing here allocates, and nothing in the library it drives does
   * either. These are plain arrays sized at compile time. */
  float l_[kEsp32BlockSize];
  float r_[kEsp32BlockSize];
  /* Interleaved, because write() takes bytes and the driver expects L,R
   * pairs. Both entries of each pair hold the same value. */
  int16_t pcm_[2 * kEsp32BlockSize];
};

}  // namespace bellows

#endif  // BELLOWS_TARGET_ESP32C3 || ARDUINO_ARCH_ESP32
