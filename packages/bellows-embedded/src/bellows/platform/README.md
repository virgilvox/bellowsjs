# platform

Three glue headers, one per SDK. They hold the only code in the library that
knows what a board is. Everything under `bellows/dsp`, `bellows/engines` and
`bellows/fx` is plain C++17 that runs the same on a Teensy, a Daisy, an
ESP32, a desktop test binary, or the offline renderer.

All three are wrapped in a target guard and have no fallback path. Off
target they expand to nothing, measured at 16 bytes of flash and 4 bytes of
RAM, which is the empty translation unit floor. Including
`bellows/platform/teensy.h` in a Daisy build is not an error, it is a no-op.

## What the adapters do

`teensy.h` gives you `bellows::BellowsAudioStream<Render>`, a custom
`AudioStream` node for the Teensy Audio Library graph. Wire it to
`AudioOutputI2S` with two `AudioConnection` objects and it becomes a stereo
source. Its `update()` zeroes a shared float scratch pair, calls your render,
converts to int16 with a hard clip, transmits both blocks and releases them.

`daisy.h` gives you `bellows::DaisyAudio<Render>`, whose static `Callback`
matches `daisy::AudioHandle::AudioCallback`. It zeroes `out[0]` and `out[1]`
and calls your render directly into them. libDaisy is float already and
hands the two channels as separate pointers, so there is no conversion and
no copy. `DaisyAudio<Render>::Start(hw, render)` binds the render and starts
the stream in one call; `hw` is a template parameter, so the header names no
board type and the same call works for a Seed, a PatchSM or a Pod.

The zeroing is not defensive. libDaisy's non-interleaved path builds the
output buffer as an uninitialized stack array in `hid/audio.cpp` and
reinterleaves whatever the callback leaves there, so a render that only adds
into the block would otherwise play back stack garbage.

Verified against libDaisy 8.1.0 (commit `c02245d`) for Cortex-M7 with
`-mfpu=fpv5-d16 -mfloat-abi=hard`: all five example renders compile through
`DaisyAudio`, and `examples/daisy_onekick` links as a complete Daisy Seed
image.

`esp32c3.h` gives you `bellows::Esp32I2sAudio<Render>`, which wraps the
Arduino `I2SClass` from the ESP_I2S library. It is the odd one out in shape:
the other two are push adapters, called by an interrupt the SDK owns, and
ESP_I2S in core 3.3.10 has no callback at all. Its only output path is a
`write()` that loops on `i2s_channel_write` until every byte is queued. So
this one is a pull adapter. `Start(i2s, render, bclk, lrclk, dout)` binds the
render, sets the pins and starts the channel, matching the shape of
`DaisyAudio::Start(hw, render)`; `Init(i2s, render)` binds without touching
the hardware, for a sketch that configures the channel itself. Then the
caller runs `Fill()` in a loop. `Fill()` zeroes a float scratch pair, calls
the render, converts to int16 with a hard clip, and writes. The write blocks
until the DMA queue has room, and that is the clock: no timer, no callback,
no ring buffer of the adapter's own.

Unlike `DaisyAudio` there is no static render pointer, because there is no
bare C callback to carry a context through. `Fill()` is called by the sketch
and has `this`, so the scratch is a member rather than shared across the
sketch the way `teensy.h` shares its pair. That divergence is deliberate.
The Teensy sharing is safe because the audio software interrupt calls
`update()` on each node in sequence and never re-enters; FreeRTOS is
preemptive and the recommended structure puts the pump in its own task, so
there is no such guarantee here and 768 bytes per instance is cheaper than
an intermittent noise bug.

`Fill()` also sums to mono and writes the same sample into both I2S slots.
That is a correctness requirement on the board this was written for rather
than a taste in mixing: an NS4168 with its CTRL pin unwired picks a channel
that is not knowable from software, so a stereo image would be a coin flip
between the mix and half the mix. The slot mode stays stereo rather than
`I2S_SLOT_MODE_MONO` so the duplication happens in the adapter's own int16
buffer, where it is visible, instead of in a driver path whose behaviour
depends on the I2S hardware revision.

Verified with Arduino-ESP32 3.3.10 on FQBN
`esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio,FlashFreq=40,JTAGAdapter=builtin`:
one `Kick` through `Esp32I2sAudio` links as a complete ESP32-C3 image.
`./tools/check-esp32c3.sh` is that build plus the off-target guard check, and
skips the second half with a message when `arduino-cli` is absent.

`Render` is any callable with the library render signature:

```cpp
void operator()(float* l, float* r, int from, int to);
```

It is a template parameter rather than a virtual interface so the call
inlines and the linker keeps only the engines you actually reached. Voices
add into the range and effects process it in place, exactly as in the
TypeScript, which is why all three adapters clear the block first.

## Block size and sample rate

| | block | sample rate | format |
| --- | --- | --- | --- |
| Teensy 4.x | 128 frames, fixed at `AUDIO_BLOCK_SAMPLES` | `AUDIO_SAMPLE_RATE_EXACT`, 44100 class | int16, converted in the adapter |
| Daisy Seed | 1 to 256 frames, default 48 | 8, 16, 32, 48 or 96 kHz, default 48000 | float, passed straight through |
| ESP32 | `BELLOWS_ESP32_BLOCK_SIZE`, default `BELLOWS_BLOCK_SIZE` | `BELLOWS_ESP32_SAMPLE_RATE`, default `BELLOWS_SAMPLE_RATE` | int16 mono, duplicated into both slots |

Read the rate from the SDK (`bellows::TeensySampleRate()`,
`hw.AudioSampleRate()`) and pass that to every `Init()`. Writing 44100 by
hand detunes the whole sketch by whatever the SAI or I2S clock actually
settled on.

The ESP32 row is the exception, and it is worth knowing why rather than
copying the pattern. `I2SClass::txSampleRate()` exists and looks like a
readback, but it returns the number handed to `begin()`, stored verbatim. It
is an echo, not a measurement of where the PLL landed, so it cannot do what
`hw.AudioSampleRate()` does on a Daisy. The header owns the figure instead:
`Start()` passes `kEsp32SampleRateHz` to `begin()` and the sketch passes
`bellows::Esp32SampleRate()` to every `Init()`, so there is one source and it
cannot drift. Both knobs default to the library-wide ones, so a sketch built
with `-DBELLOWS_SAMPLE_RATE=22050 -DBELLOWS_BLOCK_SIZE=64` has stated each
number once.

22050 Hz and 64 frames are the sensible figures on a C3. 22050 is reachable
cleanly, since the part has `SOC_I2S_SUPPORTS_PLL_F160M` and the default mclk
multiple of 256 puts mclk at 5.6448 MHz off a fractional divider from
160 MHz, and 64 frames is 2.90 ms of latency. Tying the block to
`BELLOWS_BLOCK_SIZE` also sizes the oversampled effects for exactly the block
they are handed, since that macro is the default `kMaxBlock` of
`fx/dynamics.h` and `fx/saturator.h` and those are its only other readers.

Block size is not a constraint on this library. The kernel splits a block at
event frames and renders each span as its own `(from, to)` range, so a fixed
128 frame quantum and a configurable 48 frame one both work with no
restructuring.

What is a constraint on the ESP32 is the buffering underneath. ESP_I2S
allocates its channel at 6 descriptors of 240 frames with no setter for
either, which at 22050 Hz is 65 ms of reservoir between a key press and a
sound. That is comfortable for bring up, where the depth hides every stall,
and it is not playable. Shrinking it means calling `i2s_new_channel` and
`i2s_channel_init_std_mode` yourself, at which point this adapter is no
longer the thing writing the bytes and you want your own pump with the same
shape as `Fill()`. Grabbing `i2s.txChan()` does not help, since the channel
is already allocated by then.

## Where large buffers live

Nothing in the library allocates. Anything that needs real memory has an
`Ext` form taking a caller-supplied pointer and length, plus a thin owning
template that sizes storage from a template parameter. Placement is the
sketch's decision, which is what lets a buffer land in memory the library has
never heard of.

Teensy 4.1, up to 16 MB of QSPI PSRAM you solder to the pads underneath:

```cpp
EXTMEM float delayL[1 << 18];
EXTMEM float delayR[1 << 18];
bellows::StereoDelayExt d;
d.Init(bellows::TeensySampleRate(), delayL, delayR, 1 << 18, params);
```

Daisy Seed, 64 MB of SDRAM:

```cpp
DSY_SDRAM_BSS float delayL[1 << 20];
DSY_SDRAM_BSS float delayR[1 << 20];
bellows::StereoDelayExt d;
d.Init(hw.AudioSampleRate(), delayL, delayR, 1 << 20, params);
```

Both attributes are aliased to `BELLOWS_BIG_BUFFER` inside the guard, for
sketches that want to build for both boards. Off target the alias does not
exist, on purpose: a fallback would quietly put a megabyte of delay line in
internal RAM and turn an obvious link failure into a mysterious one.

`esp32c3.h` defines no alias at all, which is the same rule reaching its
conclusion. An ESP32-C3 SuperMini has 400 KB of SRAM and no PSRAM, so a
sketch that asks for a big buffer should fail to compile, and leaving the
macro undefined is what makes it. A variant that does have PSRAM is a
different board and should define the attribute itself, remembering that the
routing through the cache makes it the wrong home for anything read more
than once per sample.

The rule for choosing is access rate, not size. External memory is uncached
and costs on every read, so it suits delay and reverb tails that are read
once per sample. A pluck loop or a wavetable read several times per sample
stays in internal RAM, which is the default `.bss`.

## What it costs

Measured with `arm-none-eabi-g++` 11.3 at `-Os` for Cortex-M7, linked with
`--gc-sections`. Unused code is stripped, so these are floors for a program
that reaches exactly that much of the library.

| build | flash | RAM |
| --- | --- | --- |
| kick only | 3760 B | 1100 B |
| 3 piece kit | 28248 B | 1500 B |
| 8 voice VA poly, EQ, 250 ms delay | 30688 B | 135176 B |
| everything ported so far plus fx | 34240 B | 208520 B |
| the same kick through a string registry instead of a bank | 30296 B | 30828 B |

That last row is the reason there is no registry in this library. One kick,
reached by string id through a table of five engines, costs eight times the
flash and thirty four times the RAM of the same kick used directly, because
naming every engine forces the linker to keep every engine, every constant
table and every delay buffer, including the ones the program can never
reach. `bellows/bank.h` gives the same runtime index dispatch for the cost of
a few integer compares.

The RAM figures are dominated by buffers, not by code. The 8 voice VA row is
mostly the 250 ms stereo delay at 48 kHz, which is 96000 floats.

## Board budgets

| board | flash | RAM |
| --- | --- | --- |
| Teensy 4.1 | 8 MB | 1 MB (512 KB ITCM plus 512 KB OCRAM), plus up to 16 MB QSPI PSRAM you solder on |
| Daisy Seed | 128 KB internal, plus 8 MB QSPI executed in place through the bootloader | 512 KB SRAM plus 64 MB SDRAM |
| RP2350 | external QSPI flash | 520 KB SRAM |
| ESP32-S3 | external flash | 512 KB SRAM plus up to 8 MB octal PSRAM |
| ESP32-C3 SuperMini | 4 MB external QSPI | 400 KB SRAM, no PSRAM |

Put the two tables next to each other and the point of the header-only,
no-registry design shows up as a number: the entire ported engine set is
34 KB. It fits in the Daisy Seed's 128 KB of internal flash with room to
spare, so a Daisy sketch built on this library needs no bootloader and no
QSPI execute in place at all. On those four boards the tight target is RAM,
and RAM is buffers, and buffers are the caller's to place.

The C3 row is the one that breaks that reading, and the next section is why.

## The ESP32-C3 has no FPU

`esp32c3.h` exists, it links, and it will happily pump silence at 22050 Hz.
What it will not do is carry the float DSP half of this library, and the
reason is structural rather than something tuning reaches.

The C3 is RV32IMC. There is no F extension and there never will be: the
toolchain's own `-print-multi-lib` lists single precision float only on the
`rv32imafc` and `ilp32f` multilibs, and the C3 is not one of them. So every
float add, multiply, divide and compare becomes a call into libgcc's
soft-float, which on this part is the glibc soft-fp C framework rather than
hand written assembly, and with no Zbb each normalization calls `__clzsi2`
as well. One float multiply is about 108 instructions.

At 160 MHz and 22050 Hz the budget is 7256 cycles per sample frame. This core
is in-order and single issue, so an instruction count is a lower bound on
cycles: N instructions cost at least N cycles, and more once instruction fetch
from XIP flash is counted. Every figure here is instructions retired, measured
by building at the check script's FQBN and disassembling. None has run on
hardware.

The answer is not the same for every engine, and an earlier revision of this
section said it was. It measured `Va`, generalised, and concluded that nothing
per-sample fits.

| per sample frame | instructions | percent of 7256 |
| --- | --- | --- |
| this adapter alone | 397 | 5.5 |
| 1 `Pluck<110, 22050>` plus adapter | 3252 | 44.8 |
| 2 `Pluck` plus adapter | 6107 | 84.2 |
| 3 `Pluck` plus adapter | 8962 | 123.5 |
| 1 `Kick` plus adapter | 6727 | 92.7 |
| 1 float `Va` voice | about 56000 | at least 770 |

So one `Pluck` fits with room, two is a commitment not worth making without a
board, and three does not. A single `Kick` leaves no margin. `Va` is out by a
factor of eight and is the most expensive engine in the library, which is
exactly why generalising from it was wrong. `BELLOWS_FAST_MATH=1` brings `Va`
to about 32000, still at least 4.4 frames.

92.6 percent of a `Pluck` sample and 88 percent of a `Va` sample are inside
libgcc rather than inside bellows, so tuning the bellows side moves very
little. Voices scale linearly: per-voice cost in the four-voice build is
within 0.4 percent of the single-voice build.

The soft-float routines live in ROM at `0x40000xxx` and their bodies cannot be
disassembled from the image, so they were priced from the toolchain's own
libgcc for the same ISA and ABI. The ROM holds different code, frozen from an
earlier GCC. It would have to be 2.6x costlier before the one-voice `Pluck`
conclusion changed; the two-voice figure does not survive that band.

The adapter's own share is small but it is not free, and it is paid whatever
the render does. Measured by building the check sketch with an empty render,
at `-Os`, and disassembling: `Fill()` inlines into a `loop()` of 286 bytes,
the two block clears fold into one `memset`, and the conversion loop makes
exactly seven soft-float calls per frame, in order `__addsf3`, `__mulsf3`,
`__unordsf2`, `__gesf2`, `__gtsf2`, `__mulsf3`, `__fixsfsi`. That is 448
calls per 64 frame block. They link at `0x40000xxx`, which is ROM, so they
cost no flash and cannot be substituted.

What does port cleanly is the half that is not per-sample, and it is the half
no other embedded audio library has. `bellows/theory`, `bellows/seq` and
`bellows/core/prng.h` are integer arithmetic over small constant tables and
run once per note event: scales, chords, tunings, euclidean rhythms, the
arpeggiator, the cellular automata, the L-system, and a PRNG that stays bit
identical to the JavaScript so a stream recorded in the browser replays on
the board. Keep all of that. Whether you also write the per-sample path fresh
in Q15 on the firmware side depends on the engine, and the table above is how
to decide rather than a blanket yes: a Q15 render that hands this adapter
floats still pays its 397 instructions a frame, which is the argument for
eventually writing an int16 pump of your own with the same shape as `Fill()`.

Two flags are not optional on any ESP32 without an FPU. Build
`-DBELLOWS_FAST_MATH=1`, because at the default of 0 every `fm::` call site
lands in newlib and newlib's `sinf` drags in `__kernel_rem_pio2f` and the soft
double helpers behind it. Be precise about what it buys, though: for `Pluck`
it changes the per-sample path by nothing at all, since `Pluck::Process` makes
no `fm::` calls and the two render loops are instruction identical. There it
buys 9234 bytes of flash and a cheaper `NoteOn`. Build `-DBELLOWS_TEMPO_SCALAR=float`, or do
not include `bellows/seq/tempomap.h` at all, because that header defaults to
`double` and calls `log` and `exp` directly rather than through `bellows::fm`
on purpose, which on this part means soft double.

None of the above applies to an ESP32-S3 or a P4. The guard is
`ARDUINO_ARCH_ESP32` rather than a C3-only define, so the same header works
unchanged on a variant that has an FPU, and on those the float engines are
reachable. What is specific to the C3 is the absence, and that is a property
of the render the sketch hands the adapter rather than of the adapter.
