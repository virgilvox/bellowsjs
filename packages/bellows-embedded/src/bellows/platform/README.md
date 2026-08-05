# platform

Two glue headers, one per SDK. They hold the only code in the library that
knows what a board is. Everything under `bellows/dsp`, `bellows/engines` and
`bellows/fx` is plain C++17 that runs the same on a Teensy, a Daisy, a
desktop test binary, or the offline renderer.

Both headers are wrapped in a target guard and have no fallback path. Off
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

`Render` is any callable with the library render signature:

```cpp
void operator()(float* l, float* r, int from, int to);
```

It is a template parameter rather than a virtual interface so the call
inlines and the linker keeps only the engines you actually reached. Voices
add into the range and effects process it in place, exactly as in the
TypeScript, which is why both adapters clear the block first.

## Block size and sample rate

| | block | sample rate | format |
| --- | --- | --- | --- |
| Teensy 4.x | 128 frames, fixed at `AUDIO_BLOCK_SAMPLES` | `AUDIO_SAMPLE_RATE_EXACT`, 44100 class | int16, converted in the adapter |
| Daisy Seed | 1 to 256 frames, default 48 | 8, 16, 32, 48 or 96 kHz, default 48000 | float, passed straight through |

Read the rate from the SDK (`bellows::TeensySampleRate()`,
`hw.AudioSampleRate()`) and pass that to every `Init()`. Writing 44100 by
hand detunes the whole sketch by whatever the SAI or I2S clock actually
settled on.

Block size is not a constraint on this library. The kernel splits a block at
event frames and renders each span as its own `(from, to)` range, so a fixed
128 frame quantum and a configurable 48 frame one both work with no
restructuring.

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

Put the two tables next to each other and the point of the header-only,
no-registry design shows up as a number: the entire ported engine set is
34 KB. It fits in the Daisy Seed's 128 KB of internal flash with room to
spare, so a Daisy sketch built on this library needs no bootloader and no
QSPI execute in place at all. The tight target is RAM, and RAM is buffers,
and buffers are the caller's to place.
