# Bellows for microcontrollers

The DSP core of [bellowsjs](https://bellows.live) as a header-only C++17 library, plus the music
theory and sequencing layers that no other Arduino audio library has.

```cpp
#include <bellows/engines/drums.h>

bellows::Kick kick;

void setup() { kick.Init(48000.0f); }

// inside your audio callback
kick.Process(bufL, bufR, 0, blockSize);
```

That sketch costs **3760 bytes of flash and 1100 bytes of RAM**. Wrapping it the way the
`01_OneKick` example does, in a render class with non-default parameters, costs 16 bytes more.
That is the whole point of the design.

## Why another embedded audio library

[DaisySP](https://github.com/electro-smith/DaisySP) already gives you excellent DSP primitives,
and [Mozzi](https://sensorium.github.io/Mozzi/) already covers the low end. Neither of them
knows what a dorian scale, a voice-leading cost, a 31-EDO tuning, or a euclidean rhythm is.
Bellows does, and those layers are nearly free: a few hundred bytes of flash tables and integer
math.

The other thing it brings is a determinism contract. Every stochastic decision draws from a
named, forkable PRNG, and the C++ PRNG is a bit-exact transcription of the JavaScript one, so
the same seed gives the same stream on a laptop and on a board.

## You pay only for what you include

This is enforced by structure, not by hope. Measured with `arm-none-eabi-g++` 11.3.1 at `-Os` for
Cortex-M7, freestanding, no Arduino core. The compiler version is part of the measurement: a
different one moves most of these rows by tens to hundreds of bytes, and `docs/HARDWARE.md` has
the comparison.

| Sketch | flash | RAM |
| --- | --- | --- |
| baseline harness | 60 B | 1028 B |
| `Kick` | 3760 B | 1100 B |
| `Kick` + `Snare` + `Hat` | 28248 B | 1532 B |
| `Pluck<80>` (80 Hz lowest note) | 6840 B | 8388 B |
| `Pluck<20>` (20 Hz lowest note) | 6728 B | 29988 B |
| `Va` | 28640 B | 1376 B |
| `Eq3` | 7072 B | 1392 B |
| `StereoDelay<100>` | 1768 B | 39584 B |
| `StereoDelay<500>` | 1760 B | 193184 B |
| `theory/` (scales, chords, tunings, notes) | 2624 B | 116 B |
| `seq/` (euclid, arp, CA, lsystem, tempomap) | 5296 B | 900 B |
| `Fm` | 5384 B | 1536 B |
| `Plate` | 5824 B | 156736 B |
| `kernel` | 6208 B | 2492 B |
| everything, constructed and driven | 35096 B | 223324 B |

Run `./tools/size-report.sh` to reproduce it, or `./tools/check-header.sh bellows/engines/va.h`
for one module.

The two knobs that matter are visible in that table. `Pluck<kMinFreqHz>` sizes its delay loop
from the lowest note you intend to play, and `StereoDelay<kMaxMs>` sizes its buffers from the
longest delay you intend to set. Neither is a runtime parameter, because neither can be.

## The rule that makes it work

**No global registry.** The JavaScript library resolves engines by string id through a registry
that names every engine. Doing that in C++ means the linker must keep every engine, every
constant table and every delay buffer, including ones the program can never reach:

| Playing one kick | flash | RAM |
| --- | --- | --- |
| `Kick` used directly | 3760 B | 1100 B |
| through `Bank<Kick>`, dispatched by runtime index | 3760 B | 1104 B |
| through a string-keyed registry of five engines | 30488 B | 30872 B |

8.1 times the flash and 28.1 times the RAM for the same sound. So there is no registry
here. `bellows/bank.h` gives you the same ergonomics for free:

```cpp
#include <bellows/bank.h>
#include <bellows/engines/drums.h>

bellows::Bank<bellows::Kick, bellows::Snare, bellows::Hat> kit;

void trigger(int slot, float hz, float vel) {
  kit.With(slot, [&](auto& v) { v.NoteOn(hz, vel); });   // runtime index, zero cost
}
```

Adding an engine to that template is the only way to add it to your binary.

## Memory is yours

Nothing here calls `new` or `malloc`. Anything large comes in two forms: an owning template that
sizes storage from a template parameter, and an `Ext` class that takes your buffer, so you decide
where it lives.

```cpp
// Teensy 4.1: delay lines in soldered PSRAM, voices in fast DTCM
EXTMEM float delayL[1 << 18];
EXTMEM float delayR[1 << 18];
bellows::StereoDelayExt delay;
delay.Init(sampleRate, delayL, delayR, 1 << 18, params);

// Daisy: same call, SDRAM section
float DSY_SDRAM_BSS delayL[1 << 20];
```

The library never names `EXTMEM` or `DSY_SDRAM_BSS`. It takes a pointer and a power-of-two
length.

## Supported targets

Two tables, and the order is deliberate: what has been built, then what a data sheet says
could be built. They disagree in places and the first one wins.

### Measured, by building every example for every board

`examples/build-matrix.sh` compiles all 17 examples for all seven Teensy parts with the
Arduino core and the Audio Library linked in, which is 119 firmware builds. This is that
sweep, counted:

| Board | Examples that build | RAM refused | Declined on purpose |
| --- | --- | --- | --- |
| Teensy 4.1 | 16 of 17 | 0 | `12_DacOut` |
| Teensy 4.0 | 16 of 17 | 0 | `12_DacOut` |
| Teensy MicroMod | 16 of 17 | 0 | `12_DacOut` |
| Teensy 3.6 | 16 of 17 | `21_Presets` | 0 |
| Teensy 3.5 | 16 of 17 | `21_Presets` | 0 |
| Teensy 3.2 | 12 of 17 | 5 | 0 |
| Teensy LC | 3 of 17 | 14 | 0 |

`12_DacOut` declines with an `#error` because a Teensy 4.x has no DAC at all, which is
categorical rather than a matter of memory. Teensy 3.2 refuses the three workstation
programs, the patch library and the preset tour; the largest single object in the first of
those is a 500 ms stereo delay line at 187 KB, against the 64 KB the whole part has. Teensy
LC builds `01_OneKick`, `02_DrumMachine` and `06_FirstSteps` and nothing else, at 81.6 to
88.1 percent of its 8 KB.

**Daisy Seed** is not in that matrix because it is not a Teensy. `examples/daisy_onekick`
links `01_OneKick` as a real Daisy Seed image against libDaisy 8.1.0, and all five logic
headers compile against the Daisy adapter for the STM32H750. Only that one has been linked
all the way to an image.

The per-example, per-board grid is in `examples/README.md`.

### What builds means, and what it does not

A build proves the code is valid for the part and fits in its memory. It says nothing about
whether the part keeps up, and Teensy LC and 3.2 have no floating point unit at all, so they
emulate every operation this library performs in software.

**One board has been run.** A Teensy 4.0 at 600 MHz playing `17_WorkstationI2S`, the
heaviest program in the set, at 44.1 kHz through a MAX98357A: 33.8 to 46.5 percent CPU, a
47.3 percent running maximum, 2 of 24 audio blocks. Measured twice, on two builds and two
arrangements. `docs/HARDWARE.md` has both runs and their caveats. Nothing else here has been
flashed and heard, which is what `examples/00_BringUp` exists for.

### Read off data sheets, and not yet built

| Tier | Boards | What could run |
| --- | --- | --- |
| Full | Daisy Seed / Seed3 / Seed2 DFM | everything, with room to spare |
| Most | ESP32-P4, ESP32-S3 with PSRAM, RP2350 | cap polyphony around 8, audit double usage first |
| Control only | RP2040, ESP32 classic, SAMD51, nRF52840 | a couple of voices at best |
| Not viable | Uno, Nano, Uno R4 | no FPU, too little RAM. Use Mozzi. |

This table is about what a part could hold and not about what has been run, and **only Teensy
and Daisy have a platform layer**: `src/bellows/platform/` contains `teensy.h` and `daisy.h`
and nothing else. Targeting an ESP32 or an RP2350 means writing that layer first, whatever
the row says.

Needs C++17, which every current core for these parts provides. No exceptions, no RTTI, no STL
containers, no heap.

On a Daisy Seed the whole ported engine set is about 34 KB, which fits in the STM32H750's 128 KB
of internal flash with room to spare, so it needs no bootloader at all.

## Build flags

| Flag | Default | Effect |
| --- | --- | --- |
| `BELLOWS_FAST_MATH` | `0` | `1` swaps libm for polynomial approximations. Measured end to end: the kick sketch is 3760 bytes at the default and 936 with the flag. Accuracy is measured against libm by `npm run fastmath` and gated in CI (Sin 3.6e-6, Log2 1.9e-6, pitch within 0.015 cents), but it is not bit-identical to the JavaScript. |
| `BELLOWS_SAMPLE_RATE` | `48000` | Only sizes compile-time buffers. `Init()` still takes the real rate. |
| `BELLOWS_BLOCK_SIZE` | `128` | Matches the AudioWorklet quantum and the Teensy Audio Library block. |

In PlatformIO put them in `build_flags`. In the Arduino IDE, edit `src/bellows/config.h` or
define them before including any bellows header.

## Installing

**Arduino IDE.** It is in the Library Manager. Open Sketch, Include Library, Manage
Libraries, search for `Bellows`, install. Or from the command line:

```
arduino-cli lib install Bellows
```

**PlatformIO.** It is in the registry:

```ini
lib_deps = virgilvox/Bellows
```

Pin a version with `virgilvox/Bellows@0.1.2` if you want one. To build against a working copy
instead, point `lib_extra_dirs` at `packages/bellows-embedded` in a clone of the monorepo, or
take `main` directly with `lib_deps = https://github.com/virgilvox/bellowsjs.git#main`.

The layout is the Arduino 1.5 format: everything is under `src/`, so
`#include <bellows/engines/drums.h>` resolves once the library is installed, and
`#include <Bellows.h>` pulls in the convenience umbrella header that `library.properties`
names in `includes=`. Include `<Bellows.h>` first, before any `<bellows/...>` header: the
Arduino builder attributes a sketch's includes to libraries by name, and a nested path alone
does not tell it which library to add to the include path. There are no `.cpp` files at all,
which is why `dot_a_linkage` is not set: it asks the builder to archive compiled library
sources into a `.a`, and there are none to archive.

**This path is tested now, and it was broken until it was.** Every build in this repository
went through PlatformIO for the whole life of the port, which passes an include path that
hides two separate Arduino packaging faults, and both were live: no example included
`<Bellows.h>`, and six examples reached a sibling folder for a shared header. Installed into a
sketchbook, every single example failed to compile. Both are fixed, `tools/check-package.mjs`
gates them, and the check that matters is done against the published artifact rather than the
source tree, once per release: install the version the registry serves into an empty sketchbook
and compile every example. Last run at 0.1.2, `arduino-cli lib install Bellows@0.1.2`, and 16
of the 17 compiled for a Teensy 4.1. The seventeenth is `12_DacOut`, which declines with an
`#error` because a Teensy 4.x has no DAC. `05_MidiInstrument` needs Tools, USB Type, Serial +
MIDI, which is `--fqbn teensy:avr:teensy41:usb=serialmidi` on the command line, and is not a
defect either.

**Two channels, one library, and the examples are not byte-identical between them.** Six
examples share a patch with a sibling folder, for instance
`#include "../10_AudioShield/audioshield.h"`, so that comparing two output examples compares
converters rather than programs. PlatformIO compiles a folder in place and resolves that. The
Arduino IDE preprocesses a sketch into a build directory first and does not, measured rather
than assumed, so the Arduino package carries a copy of the header next to each sketch with the
include rewritten. `tools/build-mirror.sh` does that on every release, from the shared header,
so the copies cannot drift. Everything else is the same file.

## Relationship to the JavaScript library

`packages/bellows` is the source of truth for the DSP. This package is a transcription, kept
honest by `tools/gen-tables.mjs`, which regenerates the constant tables and the parameter tables
from the TypeScript and fails on divergence when run with `--check`.

Event-level determinism is exact: the PRNG is bit-identical and `KernelEvent` uses the same
numeric encoding, so a stream recorded in the browser replays on the board. Sample-level output
is not bit-identical, because the JavaScript computes in double and this computes in float. That
split is deliberate and documented in `docs/HARDWARE.md`.

`npm run parity` proves it rather than claiming it, by rendering the same note from both
implementations and diffing them:

```
module        rel rms   max abs     gate  result
prng          0.00e+0   0.00e+0        0  pass  must be bit exact
kick          9.79e-5   7.90e-5    0.001  pass
va            2.19e-3   6.30e-3     0.01  pass
pluck         4.96e-6   1.94e-6  0.00005  pass
theory        9.42e-8   7.32e-4 0.000001  pass  12/19/24/31/53-EDO and 5-limit JI
fm            5.25e-4   9.84e-4    0.005  pass
modal         1.23e-4   9.42e-5    0.001  pass
formant       1.39e-5   1.37e-5  0.00015  pass
eq            2.88e-7   1.79e-7 0.000003  pass
delay         9.54e-8   4.66e-8 0.000001  pass
plate         1.34e-5   1.00e-5  0.00015  pass
```

41 rows in all, plus `npm run tables`, which compares the parts that make no sound
(scales, chords, euclid, arp, cellular automata, the tempo map, MIDI parsing) exactly rather
than by tolerance: 428 rows, 0 mismatched.

`npm run presets` is the third of these, for `bellows/presets/instruments.h`: 50 presets,
1054 values compared, 0 failures. It applies every preset through `ApplyPreset` and diffs the
result against `packages/bellows/src/presets/instruments.ts`, mapping each JS param name onto
its C++ field with the `c++ field` column of the generated `params.gen.h` rather than a second
copy of the mapping. A mistranscribed preset is otherwise inaudible as wrong: the instrument
plays, in a voice nobody chose.

The theory row covers pitch rather than audio, because a wrong tuning table is silent and no
test that listens to a buffer can catch it.

## Layout

```
src/Bellows.h              umbrella, convenient and not cheap: read its header comment
src/bellows/
  config.h                 build flags, shared constants, Clamp
  bank.h                   compile-time engine bank, the registry replacement
  voicepool.h              VoicePool<Voice, kPoly>
  kernel.h                 sample-accurate event queue and block splitting
  core/    prng.h fastmath.h
  dsp/     delayline filters envelopes noise oscillators waveshaper lfo oversample
  engines/ drums pluck va fm modal westcoast formant tube
  fx/      delay eq saturator dynamics modfx plate
  theory/  notes scales chords tuning
  seq/     euclid arp automata lsystem tempomap
  io/      midi_parse.h
  platform/teensy.h daisy.h
tools/     size-report.sh check-header.sh gen-tables.mjs
test/      sketches used by the size report
examples/  Arduino sketches
```

See `docs/HARDWARE.md` in the repository root for the port analysis, the board budgets, and the
measurements behind every number here.

Apache-2.0, same as the rest of bellows.
