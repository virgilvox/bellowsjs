/*
 * daisy_onekick: 01_OneKick on a Daisy Seed.
 *
 * The point of this file is what is not in it. It is the board half of
 * examples/01_OneKick, and it includes that example's onekick.h unchanged,
 * from its own folder, with no Daisy-specific define and no shim. The
 * Teensy sketch next to it does the same thing through an AudioStream
 * node. Two boards, two codecs, two sample rates, one voice class.
 *
 * MEASURED, libDaisy 8.1.0 at commit c02245d, arm-none-eabi-g++ 9.2.1,
 * libDaisy built at -O3 and this file at -O2, linked against
 * STM32H750IB_flash.lds with --gc-sections:
 *
 *     FLASH   75784 B of 131072    57.8 %
 *     SRAM    13956 B of 524288     2.7 %
 *
 * That is the whole firmware: HAL, codec driver, SAI, DMA, USB stack and
 * bellows together. Building the identical program with the callback body
 * emptied and every bellows include removed gives 70100 B of .text against
 * this program's 74016 B, so the kick and the adapter are 3916 B of flash
 * and 160 B of RAM on top of libDaisy. 100 of those 160 bytes are newlib's
 * impure_data, dragged in the first time anything calls libm, not bellows
 * state: the Voice object itself is 56 bytes.
 *
 * It fits in the H750's 128 KB of internal flash with 54 KB spare, so no
 * bootloader and no QSPI execute in place is needed. Flash it with
 * `make program-dfu` and the board in DFU mode (BOOT then RESET).
 *
 * WIRING
 *   Audio out is the Seed's own codec: pins 18 and 19 are line out left
 *   and right. Nothing else is required.
 */

#include "bellows/platform/daisy.h"
#include "onekick.h"

/* File scope, not main() locals. The audio callback reads the render
 * through a static pointer and the DMA keeps running after main() would
 * return, so the render has to outlive every stack frame. */
static daisy::DaisySeed hw;
static onekick::Voice voice;

int main() {
  hw.Init();
  hw.SetAudioBlockSize(bellows::kDaisyDefaultBlockSize);

  /* Read the rate back rather than writing 48000. SetAudioBlockSize and
   * the SAI clock settle where the PLL puts them, and every envelope
   * coefficient in the voice is derived from this number. */
  voice.Init(hw.AudioSampleRate());

  bellows::DaisyAudio<onekick::Voice>::Start(hw, voice);

  /* Trigger runs from the main loop while the SAI DMA interrupt renders the
   * same object, and the note-on it calls sets several fields in sequence
   * without a lock, so the audio ISR can land in the middle of one. The
   * worst case is one glitched block on a retrigger, never corruption,
   * because nothing in the voice reallocates or frees. It is called out
   * here because this file is the reference Daisy port and 01_OneKick.ino
   * has the same shape on Teensy: a program that retriggers on a musically
   * important beat should raise its own flag here and consume it at the top
   * of the render instead. */
  for (;;) {
    voice.Trigger(50.0f, 0.9f);
    hw.DelayMs(500);
  }
}
