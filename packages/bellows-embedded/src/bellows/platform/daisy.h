/* Daisy Seed glue: a bellows render behind a libDaisy audio callback.
 *
 * libDaisy hands the callback float buffers at the rate and block size the
 * sketch asked for, so almost nothing has to be crossed here. The
 * non-interleaved form of AudioHandle::AudioCallback gives out[0] and
 * out[1] as separate float arrays of `size` frames, which is the bellows
 * render contract (l, r, from, to) already, one channel pointer per side
 * and an index range. The adapter zeroes the block, because voices add
 * rather than overwrite, and calls the render straight into the hardware
 * buffers. No conversion, no scratch, no copy.
 *
 * The one wrinkle is that AudioCallback is a plain function pointer, not a
 * std::function, so a capturing lambda cannot be passed to StartAudio. The
 * render is therefore held in an inline static pointer and the callback is
 * a static member. Render stays a template parameter so the call inlines
 * and the linker still sees exactly which engines the sketch reaches.
 *
 * Placing large buffers in SDRAM. The Seed carries 64 MB of it, addressed
 * through the DSY_SDRAM_BSS attribute, which is enough that the memory
 * arithmetic this library is otherwise careful about mostly stops
 * mattering here:
 *
 *     DSY_SDRAM_BSS float delayL[1 << 20];
 *     DSY_SDRAM_BSS float delayR[1 << 20];
 *     bellows::StereoDelayExt d;
 *     d.Init(hw.AudioSampleRate(), delayL, delayR, 1 << 20, params);
 *
 * SDRAM is off chip and uncached, so it is the right home for delay and
 * reverb tails read once per sample and the wrong home for a wavetable or
 * a pluck loop read four times per sample. Those stay in the 512 KB of
 * internal SRAM, which is the default .bss.
 */
#pragma once

/* libDaisy does have a version macro, LIBDAISY_VER_MAJ in src/version.h,
 * but it is only reachable through the umbrella src/daisy.h and not
 * through daisy_seed.h, which is what this header includes. Guarding on it
 * would mean the guard passed or failed depending on the sketch's include
 * order. So this guards instead on the part define that every libDaisy
 * build passes (-DSTM32H750xx), plus an explicit opt in for build systems
 * that do not. Define BELLOWS_TARGET_DAISY yourself if you are on an H750
 * board that is not a Daisy, or if your Makefile spells the part
 * differently. */
#if defined(BELLOWS_TARGET_DAISY) || defined(STM32H750xx)

#include <stddef.h>
#include "daisy_seed.h"

namespace bellows {

/* Defaults libDaisy boots with, matching AudioHandle::Config. Both are
 * settable, with a wrinkle each.
 *
 * SetAudioBlockSize takes 1 to 256 frames. The ceiling is not a round
 * number someone chose, it is kAudioMaxBufferSize / 4 in hid/audio.cpp,
 * where the DMA buffer is 1024 samples covering two channels double
 * buffered. Asking for more does not fail loudly: SetBlockSize clamps to
 * the maximum and returns an ERR nobody usually reads, so call
 * hw.AudioBlockSize() back if the exact figure matters.
 *
 * On DaisySeed, SetAudioSampleRate takes a SaiHandle::Config::SampleRate
 * enumerator rather than a number, so hw.SetAudioSampleRate(48000) does not
 * compile there. It is an enum class, so the enumerators need qualifying:
 * SaiHandle::Config::SampleRate::SAI_48KHZ. This is not universal, and
 * Start() below is deliberately board agnostic: DaisyPatchSM carries a
 * float overload as well, where passing 48000 is fine. Either way, read the
 * rate back as a float with hw.AudioSampleRate() and hand that to Init()
 * rather than assuming, since the SAI clock lands where the PLL puts it.
 *
 * Block size is free to choose because the bellows kernel already splits a
 * block at event frames and renders each span as its own (from, to)
 * range. */
inline constexpr int kDaisyDefaultBlockSize = 48;
inline constexpr float kDaisyDefaultSampleRate = 48000.0f;

/* Attribute for buffers that belong in SDRAM. Defined only when libDaisy
 * is present, deliberately with no off-target fallback: a fallback would
 * quietly drop four megabytes of delay line into 512 KB of SRAM. */
#ifndef BELLOWS_BIG_BUFFER
#define BELLOWS_BIG_BUFFER DSY_SDRAM_BSS
#endif

/* Wraps any callable with the bellows render signature
 *
 *     void operator()(float* l, float* r, int from, int to)
 *
 * as a libDaisy audio callback.
 *
 *     struct MyPatch {
 *       bellows::Kick kick;
 *       void operator()(float* l, float* r, int from, int to) {
 *         kick.Process(l, r, from, to);
 *       }
 *     };
 *     static daisy::DaisySeed hw;
 *     static MyPatch patch;
 *
 *     int main() {
 *       hw.Init();
 *       hw.SetAudioBlockSize(bellows::kDaisyDefaultBlockSize);
 *       patch.kick.Init(hw.AudioSampleRate());
 *       bellows::DaisyAudio<MyPatch>::Start(hw, patch);
 *       for (;;) {}
 *     }
 *
 * Start() takes the board by template parameter rather than naming
 * daisy::DaisySeed, so the adapter never learns which board it is on and
 * the same line works for DaisyPatchSM, DaisyPod and a hand-rolled
 * AudioHandle. Init() plus a bare hw.StartAudio(Callback) is the same
 * thing spelled out, for a sketch that wants to swap callbacks later.
 *
 * Either way the non-interleaved StartAudio overload is the one selected,
 * because Callback matches AudioHandle::AudioCallback exactly. The
 * interleaving overload hands one LRLR buffer, which would force a
 * deinterleave pass into scratch and undo the point of this adapter.
 */
template <class Render>
class DaisyAudio {
 public:
  /* Call before StartAudio. The render must outlive the audio stream,
   * which in practice means a file scope or main() local, never a
   * temporary. */
  void Init(Render& render) { render_ = &render; }

  /* Bind the render and start the stream in one call. Board is a template
   * parameter so this header still names no board type: anything with a
   * StartAudio(AudioHandle::AudioCallback) works. Same lifetime rule as
   * Init(), the render must outlive the stream. */
  template <class Board>
  static void Start(Board& hw, Render& render) {
    render_ = &render;
    hw.StartAudio(Callback);
  }

  static void Callback(::daisy::AudioHandle::InputBuffer in,
                       ::daisy::AudioHandle::OutputBuffer out, size_t size) {
    (void)in;
    if (render_ == nullptr) return;
    float* l = out[0];
    float* r = out[1];
    /* Voices add into the buffers, so the block starts silent. This is
     * load-bearing rather than tidy: libDaisy builds the non-interleaved
     * output as an uninitialized stack array in hid/audio.cpp and
     * reinterleaves whatever the callback leaves behind, so skipping the
     * clear sends stack garbage to the codec, not silence. */
    for (size_t i = 0; i < size; ++i) {
      l[i] = 0.0f;
      r[i] = 0.0f;
    }
    (*render_)(l, r, 0, static_cast<int>(size));
  }

 private:
  /* Static because AudioCallback is a bare function pointer with nowhere
   * to carry a context argument. One render per Render type, which is the
   * one stream libDaisy runs. */
  inline static Render* render_ = nullptr;
};

}  // namespace bellows

#endif  // BELLOWS_TARGET_DAISY || STM32H750xx
