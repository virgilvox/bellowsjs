/* Teensy 4.x glue: one custom AudioStream node that runs a bellows render.
 *
 * The Teensy Audio Library is a graph of AudioStream objects. Every 128
 * frames a software interrupt walks the graph and calls update() on each
 * node in turn. A node produces audio by allocating output blocks, filling
 * their 16 bit integer data, transmitting them to its output channels, and
 * releasing its references. That is the whole contract, and this header is
 * the whole of the adapter.
 *
 * Two impedance mismatches have to be crossed here and nowhere else in the
 * library. The graph carries int16 at AUDIO_SAMPLE_RATE_EXACT (44100 class,
 * not 48000) while bellows renders float, so update() renders into a float
 * scratch pair and converts on the way out. The graph fixes the block at
 * AUDIO_BLOCK_SAMPLES, which is 128 by default. That costs nothing: the
 * bellows kernel already splits a block internally at event frames and
 * renders each span with an (l, r, from, to) range, so a fixed 128 frame
 * quantum needs no restructuring at all, only a caller that hands the
 * kernel 128 frames at a time.
 *
 * This file holds the only virtual function in the library. AudioStream
 * declares update() pure virtual and the graph dispatches through it, so
 * the vtable is Paul Stoffregen's, not ours, and it is crossed 344 times a
 * second rather than 44100. Nothing below update() is virtual, which is
 * what keeps the engines linkable one at a time.
 *
 * Placing large buffers in PSRAM. Teensy 4.1 takes up to 16 MB of QSPI
 * PSRAM on the two pads underneath the board, and the core exposes it as
 * the EXTMEM attribute. Every bellows class that needs real memory has an
 * Ext form that takes a caller-supplied pointer, so placement is the
 * sketch's decision and the library never learns the macro exists:
 *
 *     EXTMEM float delayL[1 << 18];
 *     EXTMEM float delayR[1 << 18];
 *     bellows::StereoDelayExt d;
 *     d.Init(AUDIO_SAMPLE_RATE_EXACT, delayL, delayR, 1 << 18, params);
 *
 * PSRAM is slower than OCRAM and is not cached for writes the way internal
 * RAM is, so put long delay and reverb tails there and keep short, hot
 * buffers (a pluck loop, a chorus line) in the default .bss.
 */
#pragma once

#if defined(__IMXRT1062__)

#include <Audio.h>
#include <stdint.h>
#include "bellows/config.h"

namespace bellows {

/* Frames per graph update, and the rate to hand Init(). Read the rate from
 * the core rather than writing 44100: the exact figure differs between
 * Teensy generations and drifting a fraction of a percent detunes every
 * oscillator in the sketch. */
inline constexpr int kTeensyBlockSize = AUDIO_BLOCK_SAMPLES;
inline float TeensySampleRate() { return AUDIO_SAMPLE_RATE_EXACT; }

/* Attribute for buffers that belong in PSRAM. Defined only when the Teensy
 * core is present, deliberately with no off-target fallback: a fallback
 * would quietly drop a megabyte of delay line into 512 KB of internal RAM
 * and the sketch would fail at link time with a far less obvious error. */
#ifndef BELLOWS_BIG_BUFFER
#define BELLOWS_BIG_BUFFER EXTMEM
#endif

namespace detail {
/* One scratch pair for the whole sketch, not one per stream. The audio
 * software interrupt calls update() on each node in sequence and never
 * re-enters, so two streams cannot be inside their conversion loops at the
 * same time. Sharing saves a kilobyte for every stream after the first. */
inline float teensy_scratch_l[AUDIO_BLOCK_SAMPLES];
inline float teensy_scratch_r[AUDIO_BLOCK_SAMPLES];

/* Hard clip, then scale. Wrapping an out of range sample would turn a
 * moment of overdrive into full-scale noise, which is the worst failure
 * mode available on a speaker. 32767 rather than 32768 so that +1.0 and
 * -1.0 stay symmetric. */
inline int16_t ToInt16(float x) {
  return static_cast<int16_t>(Clamp(x, -1.0f, 1.0f) * 32767.0f);
}
}  // namespace detail

/* Wraps any callable with the bellows render signature
 *
 *     void operator()(float* l, float* r, int from, int to)
 *
 * as a stereo source node. Render is a template parameter rather than a
 * function pointer or a base class so the call inlines and the linker still
 * sees exactly which engines the sketch reaches.
 *
 *     struct MyPatch {
 *       bellows::Kick kick;
 *       void operator()(float* l, float* r, int from, int to) {
 *         kick.Process(l, r, from, to);
 *       }
 *     };
 *     MyPatch patch;
 *     bellows::BellowsAudioStream<MyPatch> src(patch);
 *     AudioOutputI2S out;
 *     AudioConnection c0(src, 0, out, 0);
 *     AudioConnection c1(src, 1, out, 1);
 *
 *     void setup() {
 *       AudioMemory(12);
 *       patch.kick.Init(bellows::TeensySampleRate());
 *     }
 */
template <class Render>
class BellowsAudioStream : public AudioStream {
 public:
  explicit BellowsAudioStream(Render& render)
      : AudioStream(0, nullptr), render_(&render) {}

  void update() override {
    /* Bail before doing any DSP if the pool is dry. Running out here means
     * the sketch called AudioMemory() with too small a count. */
    audio_block_t* out_l = allocate();
    if (out_l == nullptr) return;
    audio_block_t* out_r = allocate();
    if (out_r == nullptr) {
      release(out_l);
      return;
    }

    float* l = detail::teensy_scratch_l;
    float* r = detail::teensy_scratch_r;
    /* Voices add into the buffers, so the block starts silent. */
    for (int i = 0; i < AUDIO_BLOCK_SAMPLES; ++i) {
      l[i] = 0.0f;
      r[i] = 0.0f;
    }

    (*render_)(l, r, 0, AUDIO_BLOCK_SAMPLES);

    for (int i = 0; i < AUDIO_BLOCK_SAMPLES; ++i) {
      out_l->data[i] = detail::ToInt16(l[i]);
      out_r->data[i] = detail::ToInt16(r[i]);
    }

    transmit(out_l, 0);
    transmit(out_r, 1);
    release(out_l);
    release(out_r);
  }

 private:
  Render* render_;
};

}  // namespace bellows

#endif  // __IMXRT1062__
