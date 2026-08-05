# HARDWARE

What it takes to run bellows on a microcontroller, which parts port and which do not, and the
design of `packages/bellows-embedded`. Every number here is measured, not estimated: the C++ is
compiled with `arm-none-eabi-g++` 11.3 at `-Os` with `-ffunction-sections -fdata-sections
-Wl,--gc-sections`, linked freestanding against a 1 MB RAM and 8 MB flash script, with no
Arduino core and no BSP, so the figures are the library and nothing else.

Reproduce any of it with:

```
cd packages/bellows-embedded
./tools/size-report.sh              # Cortex-M7, the Teensy 4.1 and Daisy target
./tools/size-report.sh cortex-m4    # single-precision FPU
./tools/check-header.sh bellows/engines/va.h
```

## The short version

Compute is not the constraint and never was. Code size is not the constraint either: the whole
ported engine set is about 34 KB of flash, which fits in the Daisy Seed's 128 KB of internal
flash with room to spare. The constraints are delay memory and, on non-M7 parts, double
precision. Both are now build-time knobs.

## Why the port is mostly already designed

The TypeScript carries the shape of an embedded audio callback already. `Voice.process(l, r,
from, to)` adds into an output buffer, `Effect.process(l, r, from, to)` works in place, voices
are pooled with an `active` flag for reclamation, sample rate arrives at construction, and
nothing allocates at steady state. Offline rendering runs the same kernel through a plain loop
driven by the same message stream. Most libraries fail a hardware port on architecture. This one
fails it only on language and word size.

The parts that do not carry over are the parts that are about being in a browser: string-keyed
`setParam`, the `Record<string, number>` params bag, `defEngine`/`defEffect` serializing
functions through `toString()`, and the global registry in `src/core/register.ts`.

## The seven rules of the embedded library

These are measured decisions, not style preferences.

1. **Header only.** Arduino compiles every `.cpp` under a library's `src/` recursively whether
   you included it or not, so a `.cpp` per engine puts every engine in every sketch. Headers
   with inline functions and templates sidestep the build system entirely and behave the same in
   the Arduino IDE, `arduino-cli` and PlatformIO with no configuration.

2. **No global registry and no self registration.** This is the one that decides everything
   else. Measured on Cortex-M7:

   | Playing one kick | flash | RAM |
   | --- | --- | --- |
   | `Kick` used directly | 3760 B | 1100 B |
   | through `Bank<Kick>` with a runtime index | 3760 B | 1104 B |
   | through a string-keyed registry of five engines | 30264 B | 37580 B |

   Eight times the flash and thirty-four times the RAM for the same sound. A registry names
   every engine, so the linker must keep every engine, every constant table and every delay
   buffer, including ones the program can never reach. `bellows/bank.h` gives the same
   `getEngine(id)` ergonomics at literally zero cost.

3. **No virtual functions on the audio path** and no shared base class between engines. A vtable
   pins every virtual method the moment anything takes the object's address.

4. **The caller owns large memory.** Following the rule DaisySP states and this library adopts:
   either a template size parameter, or a caller-supplied buffer and length. Never `new`, never
   `malloc`. This is what lets a user place a delay buffer in `EXTMEM` on Teensy or
   `DSY_SDRAM_BSS` on Daisy without the library knowing those macros exist.

5. **Params are structs, not string maps.** A nested `struct Params` with named float fields and
   defaults matching the `ParamSpec` defaults exactly.

6. **Constant tables live in flash.** Anything the TypeScript builds into a typed array at
   module load becomes `inline constexpr float` in `.rodata`. The BLEP residuals are the big
   one: 32 KB of `Float64Array` built at module load in JS, 16 KB of const `float` in flash here.

7. **One header per concept, and headers include only what they use.** This is why
   `engines/pluck.h` costs 6.6 KB and `engines/va.h` costs 28.5 KB: pluck does not pull in the
   BLEP tables.

## Where the flash actually goes

Symbol breakdown of the VA voice sketch, 28528 bytes total:

```
kBlepStep            8196 B   Kaiser-sinc BLEP residual table
kBlepRamp            8196 B   BLAMP residual table
__kernel_rem_pio2f   1624 B   newlib sinf argument reduction
powf                  800 B
__adddf3 / __subdf3  ~1270 B  soft double helpers newlib drags in
------------------------------
tables plus libm    ~21.5 KB
Va, Ladder, Adsr, Svf code    ~7 KB
```

The DSP code is small. Tables and libm are three quarters of it. That leads to the second-largest
single win available:

```
sinf + cosf + tanhf + powf + expf from newlib   5056 B
the polynomial equivalents in core/fastmath.h    196 B
```

Twenty-five times, about 4.9 KB recovered, and considerably faster. The whole library calls
transcendentals through `bellows::fm::`, so `-D BELLOWS_FAST_MATH=1` switches it in one flag.
Measured end to end on the kick sketch: 3760 bytes at the default, 1448 with the flag.

The default is off, because exact libm keeps renders closer to the JS. It is also off because
the flag is the dangerous one, and this is worth stating plainly. The first draft of
`core/fastmath.h` shipped a minimax cubic for `Log2` that was wrong by 0.302 across the mantissa
range: `log2(1.5)` returned 0.407 instead of 0.585, a 213 cent pitch error, and since `Pow` is
`Exp2(Log2(b) * e)` every `Pow` in the library inherited it. It moved a formant frequency by 6.5
percent and a modal strike duration by 8 percent. Nothing caught it, because a wrong polynomial
still compiles, still runs fast, and still makes sound.

That is why `test/parity/fastmath_test.cpp` exists and runs in CI. It measures every function in
the file against libm over the domain the DSP actually drives, and fails on regression:

| Function | measured | gate |
| --- | --- | --- |
| `Sin`, `Cos` | 3.6e-6 abs | 2e-5 |
| `Tanh` | 9.6e-5 abs | 1e-4 |
| `Exp2` | 1.7e-5 abs | 1e-4 |
| `Log2` | 1.9e-6 abs | 1e-5 |
| `Pow` | 1.4e-5 rel | 5e-4 |
| `CentsRatio` | 0.015 cents | 0.15 cents |

The pitch helper is gated in cents on purpose, because that is the only unit in which "is this
good enough" has an answer.

## Double precision

The TypeScript uses `Float64Array` in more places than is obvious: FFT twiddles, the additive
engine's phase and decay state, the harmonic engine, the waveguide body-mode coefficients, the
frequency shifter's biquad state, the FDN and plate length and gain tables, and the BLEP tables
themselves. On Cortex-M7 that is all free. Elsewhere it is not.

Same 64-tap recursion, `float` state versus `double` state:

| Target | float | double | penalty |
| --- | --- | --- | --- |
| Cortex-M7 fpv5-d16 (Teensy 4.1, Daisy) | 332 B | 356 B | 1.07x |
| Cortex-M4 fpv4-sp-d16 (single-precision FPU) | 332 B | 2020 B | 6.08x |
| Cortex-M0+ no FPU (RP2040) | 2080 B | 4772 B | 2.29x |

On M7 doubles are hardware, which is why the tempo integral and the theory math can stay `double`
and keep event timing bit-identical to the JS. On any single-precision part a double in an inner
loop is six times the flash and a soft-float call per operation. RP2350's M33 is the
single-precision case, so the M4 row is the right proxy for it.

## Memory, which is the actual constraint

The stereo delay, sized as the JS hardcodes it:

| Configuration | RAM |
| --- | --- |
| `StereoDelay<100>` | 39 KB |
| `StereoDelay<250>` | 96 KB |
| `StereoDelay<500>` | 189 KB |
| `StereoDelay<4000>`, the JS maximum | link error: overflows 1 MB by 1,049,728 B |

A 4 second stereo delay wants 2.0 MB, which independently confirms the 2048 KB measured against
the browser build in `docs/AUDIT.md`. As a template parameter it becomes a knob, and the same
change recovers the waste in the browser.

The other knob that matters is the loop length of the physical models. `Pluck<20>` reserves for a
20 Hz fundamental and costs 36.7 KB per voice; `Pluck<80>` costs 10 KB. Eight-voice polyphony is
the difference between 294 KB and 80 KB.

## Per module, measured

Every row is a sketch in `test/sketches/` that constructs the module and runs a block through
it, so these are real costs and not a floor. Reproduce with `./tools/size-report.sh`.

| Module | flash | RAM | notes |
| --- | --- | --- | --- |
| `theory/` (scales, chords, tuning, notes) | 2616 B | 116 B | the differentiator, and it is nearly free |
| `fx/dynamics` | 4104 B | 10016 B | compressor, limiter lookahead line |
| `fx/modfx` | 4904 B | 17672 B | chorus, flanger, tremolo, autopan, ringmod |
| `engines/tube` | 5000 B | 2460 B | `Tube<80>` bore |
| `seq/` (euclid, arp, CA, lsystem, tempomap) | 5296 B | 900 B | fixed capacity, no allocation |
| `engines/fm` | 5384 B | 1536 B | SineOsc only, so no BLEP tables |
| `fx/saturator` | 5544 B | 10136 B | with the oversampler |
| `fx/plate` | 5656 B | 156728 B | Dattorro tank, the RAM is the tank |
| `engines/modal` | 5944 B | 1584 B | five material tables in flash |
| `kernel` | 6208 B | 2492 B | event queue plus block splitting |
| `engines/westcoast` | 27064 B | 1200 B | BLEP tables dominate |
| `engines/formant` | 28312 B | 1496 B | BLEP tables dominate |

The BLEP tables are 16 KB and shared, so the first module that needs them pays and every later
one is nearly free. `fm`, `modal`, `tube` and `pluck` do not need them at all, which is why an
FM plus pluck instrument is under 12 KB while a formant voice alone is 28 KB.

The theory row is the one to notice. Scales, chords, tunings and note parsing together are
2.6 KB of flash and 116 bytes of RAM.

## Making it smaller

Where the bytes are, measured with `arm-none-eabi-nm --size-sort` on `s5_all`, the sketch that
constructs and drives everything at once:

| | share of flash |
| --- | --- |
| `kBlepStep` and `kBlepRamp` residual tables | 47 % |
| newlib libm (`sinf`, `powf`, `__kernel_rem_pio2f`, soft-double helpers) | 18 % |
| every line of bellows DSP | 35 % |

The DSP code is not the weight and never was. Individual functions are 400 to 500 bytes:
`Svf::Update` is 444, `NoiseGen::Process` is 528. Two constant tables and one delay buffer are
the library's size, which is why the wins below are all about storage rather than about
arithmetic, and why no rewrite of the DSP in another language or another architecture would move
any of them.

**Delay buffers are sized exactly.** They used to round up to a power of two so the wrap could be
a bitwise AND, which cost up to 49 percent of the largest RAM consumer in the library. Exact
sizing costs one conditional add per read instead. Measured: `s5_all` 300144 to 223280 bytes
(25 percent), the plate tank 222684 to 156728 (29 percent), a 100 ms stereo delay 66688 to 39584
(40 percent). Flash is a wash. The samples are identical, so every parity row reads exactly what
it read before.

**Pick the oscillator shape at the call site when you know it.** `BlepOsc::Process()` switches on
a runtime shape, so it names every shape and the linker has to keep both residual tables, 16 KB,
even in a program that only ever plays a saw. `ProcessSaw()`, `ProcessSquare()`,
`ProcessTriangle()` and `ProcessSine()` are the same arithmetic with the shape fixed, so
`--gc-sections` can drop what is unreachable. Measured on a one-oscillator sketch:

| call | flash | tables kept |
| --- | --- | --- |
| `Process()` | 19000 B | both |
| `ProcessSaw()` | 8540 B | step only |
| `ProcessTriangle()` | 8624 B | ramp only |
| `ProcessSine()` | 1984 B | neither |

This is rule 2 applied one level down. A runtime switch over shapes costs what a runtime registry
of engines costs, for the same reason, at a smaller scale.

### Measured and deliberately not taken

Compressing the residual tables further does work acoustically and does not survive parity. Half
the step table is genuinely redundant (the residual is odd to 2.9e-15), and cubic interpolation
at a quarter of the resolution with int16 storage holds alias rejection at exactly -86.6 dB in
514 bytes against 8196. But it moves the C++ 7.08e-4 away from the TypeScript, which walks
through the formant gate (1.5e-4) and the snare gate (3.0e-4). Taking only the symmetry is
5.95e-5, which fits, but it spends about half the formant headroom to save 4 KB. Neither trade
looks worth it while flash is the constraint nobody is actually hitting; revisit if a target
appears where 4 KB decides something.

Swapping the tabulated BLEP for a closed-form method (polyBLEP, DPW, PTR/EPTR) is the other
obvious idea and is worse than it looks. The literature puts fourth-order polyBLEP at
perceptually alias-free to about 4 kHz, and the four-point polyBLEP was measured here at about
-37 dB against the -86.6 dB the tabulated kernel holds. It would trade the property the spectrum
gates exist to protect for less than table compression gives, and table compression is the thing
already ruled out above.

## Realistic firmware profiles

Each row names the sketch in `test/sketches/` that produces it, so a row cannot drift away from
anything the size report actually builds:

| Profile | sketch | flash | RAM |
| --- | --- | --- | --- |
| kick only | `s1_kick` | 3760 B | 1100 B |
| kick only, `BELLOWS_FAST_MATH=1` | `s1_kick` with the flag | 1448 B | 1100 B |
| three piece kit | `s2_kit` | 28280 B | 1500 B |
| kit plus EQ and a 250 ms delay | `p1_drums` | 29448 B | 98680 B |
| 8 voice VA poly, EQ, 250 ms delay | `p2_poly8` | 31136 B | 100184 B |
| 8 VA plus 8 `Pluck<80>` plus kit, EQ, delay | `p3_workstation` | 34592 B | 160216 B |
| everything constructed and driven at once | `s5_all` | 34904 B | 223280 B |

And the shipped examples, whose numbers come from the same logic headers the sketches compile,
so they cannot drift from the code:

| Example | flash | RAM |
| --- | --- | --- |
| `01_OneKick` | 3776 B | 1100 B |
| `02_DrumMachine` (bank plus euclid) | 29696 B | 1588 B |
| `03_PolySynth` (`VoicePool<Va, 8>`) | 30360 B | 3776 B |
| `04_ScalesAndTuning` | 8080 B | 36928 B |
| `05_MidiInstrument` | 30296 B | 3792 B |

Against real boards, using the largest profile:

| Board | Flash | RAM | flash used | RAM used |
| --- | --- | --- | --- | --- |
| Teensy 4.1 | 8 MB | 1 MB (512 ITCM + 512 OCRAM), plus soldered PSRAM to 16 MB | 0.4 % | 20 % |
| Daisy Seed / Seed3 | 128 KB internal, 8 MB QSPI | 512 KB SRAM, 64 MB SDRAM | fits in internal flash, 94 KB spare | 40 % |
| RP2350 | external, 2 to 16 MB | 520 KB | under 1 % | 40 % |
| ESP32-S3 | 8 to 16 MB | 512 KB, plus 8 MB octal PSRAM | under 1 % | 40 % |

The Daisy row is the striking one. The STM32H750 has only 128 KB of internal flash, which is why
libDaisy ships a bootloader that executes in place from the 8 MB QSPI. The whole ported engine
set is 34 KB, so it fits in internal flash and needs no bootloader at all.

Restated plainly: on every viable board, bellows uses well under one percent of flash and under
half the RAM, and delay buffers are the only thing that moves the needle.

## Does it actually build as firmware

Every number above is the library measured in isolation, freestanding, with no Arduino core.
That is the right way to attribute cost, and it is not the same question as "does this flash".

All five examples were built against the real Teensy core and Audio Library with PlatformIO
(`platform = teensy`, `board = teensy41`, `framework = arduino`). Complete firmware, Arduino
core and audio library included:

| Example | flash total | RAM1 used | RAM1 free |
| --- | --- | --- | --- |
| `01_OneKick` | 36860 B | 27208 B | 482400 B |
| `02_DrumMachine` | 66556 B | 56808 B | 463968 B |
| `03_PolySynth` | 67580 B | 58296 B | 461920 B |
| `04_ScalesAndTuning` | 41980 B | 68136 B | 445504 B |
| `05_MidiInstrument` | 68604 B | 59624 B | 461568 B |

Teensy 4.1 has 8 MB of flash and 512 KB of RAM1 plus 512 KB of RAM2, so the largest of these
leaves about 8.06 MB of flash and 445 KB of RAM1 free, with RAM2 essentially untouched.

Whole-firmware figures move with the Arduino core, so the revision is part of the measurement:
`platform = teensy` 5.1.0, `framework-arduinoteensy` 1.160.0,
`toolchain-gccarmnoneeabi-teensy` 1.110301.0. An earlier revision of this table was about 1024
bytes of flash and 900 bytes of RAM1 lower across four of the five rows for that reason, which
looks like a regression and is not one. The per-module table above is freestanding and does not
move with the core, which is why it is the one to compare against when auditing a DSP change.

Two things this exercise found that a freestanding build cannot. `board_build.usb_type` is
silently ignored by the PlatformIO teensy platform, so `05_MidiInstrument` needs
`-D USB_MIDI_SERIAL` in `build_flags` or `usbMIDI` is undeclared. And the platform still
defaults to `gnu++14` on some releases, so `build_unflags` has to remove it rather than just
setting `-std=gnu++17`. `examples/platformio.ini` carries both.

### Daisy

The Daisy path has now been built end to end against the real SDK: libDaisy 8.1.0 (commit
`c02245d`), Cortex-M7 with `-mfpu=fpv5-d16 -mfloat-abi=hard`, `arm-none-eabi-g++` 9.2.1.
`examples/daisy_onekick` links as a complete Daisy Seed firmware image, and all five example
render classes compile through `DaisyAudio` for the STM32H750.

| Program | FLASH | of 128 KB | SRAM | of 512 KB |
| --- | --- | --- | --- | --- |
| `daisy_onekick` | 75784 B | 57.8 % | 13956 B | 2.7 % |
| the same firmware with bellows removed | 71712 B | 54.7 % | 13796 B | 2.6 % |

Subtracting the two, bellows is 3916 B of flash and 160 B of RAM on top of libDaisy, and 100 of
those 160 bytes are newlib's `impure_data`, pulled in the first time anything calls libm rather
than being bellows state. The prediction in the table above was that the ported engine set fits
in internal flash with room to spare; a one-voice program leaves 54 KB free with the entire HAL,
codec driver, SAI, DMA and USB stack already paid for, so the prediction holds and no bootloader
is needed.

Compiling the adapter against the real headers rather than off-target found no API drift. The
callback signature, the `AudioHandle::InputBuffer` and `OutputBuffer` types, the non-interleaved
`out[0]` and `out[1]` layout, the `size_t` block size and `DSY_SDRAM_BSS` were all as written.
Two things it did find. libDaisy's `core/Makefile` sets `CPP_STANDARD ?= -std=gnu++14`, and
bellows headers use inline constexpr variables, which GCC accepts under `gnu++14` only as a
warned extension, so a Daisy project has to assign `CPP_STANDARD` before including that Makefile.
This is the exact twin of the `build_unflags` finding on Teensy, which makes it a property of the
library rather than of either SDK. And libDaisy builds the non-interleaved output buffer as an
uninitialized stack array in `hid/audio.cpp`, so the adapter's habit of zeroing the block before
the render is load-bearing, not defensive: bellows voices add into the range, and without the
clear the codec would receive stack garbage.

WHAT HAS NOT BEEN DONE: none of this has been flashed to a board and listened to, on either
platform. Everything is compile-verified, link-verified and numerically verified against the
TypeScript, which is a strong position and is not the same as having heard it. On Daisy, only
`01_OneKick` has been linked to an image; the other four are compile-verified through the
adapter.

## Board tiers

**Tier 1, the full set with room to spare.** Daisy Seed3 or Seed2 DFM (480 MHz Cortex-M7, 64 MB
SDRAM), Teensy 4.1 with an audio shield. Daisy is the path of least resistance because libDaisy
hands you the codec, SDRAM and DMA, and 64 MB removes every memory question in this document.

**Tier 2, most of it with cuts.** ESP32-P4 (400 MHz dual RISC-V with FPU, no radio), ESP32-S3
with octal PSRAM (keeps Wi-Fi and BLE, which matters for streaming events from bellows.live),
RP2350 with PSRAM. Audit the double-precision usage before targeting any of these. Cap polyphony
around 4 to 8 and skip the spectral family.

**Tier 3, control only.** RP2040, ESP32 classic, SAMD51, nRF52840. A couple of voices at best.

**Not viable.** Uno, Nano, Uno R4. Worth saying plainly, because "Arduino" now spans AVR to
STM32H7 and the answer inverts across that range.

## What ports, and what does not

Free and near mechanical: every oscillator, filter, delay line, envelope, noise generator and
waveshaper; the drum voices, pluck, modal, va, fm, westcoast, formant and tube; delay, eq,
saturator, dynamics, mod effects and the plate; the voice pool; the PRNG, which is already pure
uint32 arithmetic and transcribes to bit-identical streams.

Easy and high value: the whole `theory` layer and most of `seq`. These are pure integer and small
float math over `const` tables totalling well under 4 KB, and they are the reason to choose this
library over DaisySP or Mozzi, neither of which knows what a dorian scale or a 31-EDO tuning is.
The one constraint is that the TypeScript versions allocate freely, so every one becomes a
fixed-capacity form with the capacity as a template parameter.

Medium: the waveguide string (24 body-mode biquads and two delay lines per voice), the wavetable
engine (320 KB of generated mipmap, which must move to flash via a build step), additive and
harmonic (double-precision phase accumulators).

Hard, and deliberately deferred: FFT, STFT, the spectral effects and the analysis suite. Swap
`RealFft` for CMSIS-DSP `arm_rfft_fast_f32` on Cortex-M, ESP-DSP on Xtensa. Each spectral effect
is 84 to 204 KB of state.

Host side, do not port: SF2 and SFZ parsing, MIDI file parsing, WebCodecs encoding. Parse on a
host and ship a flat binary bank to SD. Generator resolution on an MCU is wasted flash.

Does not port at all: `defEngine` and `defEffect`. Serializing a function through `toString()`
into a worklet has no embedded equivalent. On hardware this is compile-time registration, which
is what `bellows/bank.h` is.

## Does the port still sound like the source

`test/parity/parity.mjs` renders the same note from both implementations and diffs them. It runs
in CI. The gates sit at roughly ten times the drift actually measured, so they catch a regression
rather than rubber stamping anything that runs.

```
module        rel rms   max abs     gate  result
prng          0.00e+0   0.00e+0        0  pass  must be bit exact
kick          9.79e-5   7.90e-5    0.001  pass
hat           2.47e-4   2.32e-5    0.002  pass
va            2.19e-3   6.30e-3     0.01  pass  ladder is nonlinear
pluck         4.96e-6   1.94e-6  0.00005  pass
theory        9.42e-8   7.32e-4 0.000001  pass  12/19/24/31/53-EDO and 5-limit JI
snare         3.17e-5   1.32e-5   0.0003  pass
fm            5.25e-4   9.84e-4    0.005  pass
modal         1.23e-4   9.42e-5    0.001  pass
westcoast     2.77e-3   2.20e-3     0.02  pass  iterated wavefolder
formant       1.39e-5   1.37e-5  0.00015  pass
tube          1.70e-3   1.09e-2    0.005  pass  error rides the waveform edges
eq            2.93e-7   1.79e-7 0.000003  pass
delay         7.78e-8   2.98e-8 0.000001  pass
saturator     2.00e-7   1.49e-7 0.000002  pass
compressor    2.25e-6   1.16e-6  0.00002  pass
chorus_static 6.31e-6   1.26e-6   0.0001  pass  depth 0: the real DSP gate
chorus        2.02e-4   8.87e-5    0.002  pass  depth 0.5: sub-sample read position
plate         1.34e-5   1.00e-5  0.00015  pass
```

Gates are set from the measured value at roughly ten times, and that ratio is the point. An
earlier revision used round numbers that left `saturator` with 25000x headroom and `delay` with
12853x, and a deliberate 0.01 percent mutation of the `Svf` integrator passed every one of them.
Both this harness and the value harness below have since been mutation tested to prove they can
fail.

`npm run tables` covers what makes no sound, and compares EXACTLY rather than by tolerance,
because integers have no rounding excuse:

```
group         rows   bad  result        group         rows   bad  result
euclid         152     0  pass          ca              32     0  pass
euclidrot        7     0  pass          arp              5     0  pass
scale           34     0  pass          tempo           17     0  pass
chord           24     0  pass          tempoinv         9     0  pass
parsenote        8     0  pass          midi            10     0  pass
notename        19     0  pass
```

Two rows in the audio table carry most of the meaning.

The PRNG gate is exact and passes, which is what makes the split determinism promise real:
event-level reproducibility crosses the language boundary because both sides run the same xmur3
and mulberry32 over uint32 with the same float conversion. If that row ever fails, every row
below it is meaningless and the DSP is not the thing to look at.

The theory row is pitch, not audio. A wrong tuning table is silent: it produces confident,
plausible, wrong notes, and no test that listens to a buffer can hear it. Checking 12, 19, 24,
31 and 53-EDO plus 5-limit just intonation across the whole keyboard is the only way to know the
non-12 cases survived the port, and 12-EDO being a default and never an assumption is a house
rule this is enforcing.

The `va` row is among the largest drifts and it should be: a ladder filter is nonlinear and
recursive, so f32 rounding compounds through four saturating stages. 2e-3 relative is about
-54 dB.

Two rows are measured differently on purpose. The chorus is bit-identical with modulation off,
and the modulated row used to sit four orders of magnitude away from it, at 4e-2. Sample-wise RMS
is the wrong instrument for a time-modulating effect, so `chorus_static` is still the gate that
would actually catch a broken chorus. The tube's few exceeding samples sit on the waveform's
steep edges, spaced twice per period, where sub-sample timing reads as amplitude.

The chorus gap turned out to be worth chasing rather than explaining away, and it was not only
the chorus. Accumulating a cycle position in `float` loses part of every increment to rounding as
the accumulator approaches 1.0, and the loss is systematic rather than random, so it grows with
the length of the note instead of averaging out. The TypeScript accumulates in `double`, where
the same rounding is about 2^29 times smaller. Moving the C++ to a `uint32` counter over one
cycle (`PhaseIncrement` in `config.h`, used by `dsp/lfo.h` and the `SineCarrier` in `fx/modfx.h`)
moved three rows at once:

| row | before | after |
| --- | --- | --- |
| `chorus` | 3.97e-2 | 2.02e-4 |
| `plate` | 2.44e-3 | 1.34e-5 |
| `formant` | 7.85e-4 | 1.39e-5 |

The wrap is the natural unsigned overflow, so it costs neither a compare nor a branch, and the
whole change costs at most 64 bytes of flash on any sketch and no RAM anywhere: modfx 4936 to
5000, formant 28296 to 28328, plate 5712 to 5712, the poly synth example 30304 to 30360. An
earlier revision of it computed the increment in double, which cost 2560 bytes on Cortex-M4
against 208 on Cortex-M7, because a double on a single-precision part pulls in soft-float. It
bought nothing: single precision gives the same parity to every digit, since multiplying a float
by 2^32 only moves the exponent. Both targets now pay the same 64 bytes. All three gates were then reset from the new
measurements and watched failing, on a mutation that put the add back in `float` and reproduced
the old numbers to two significant figures. Leaving a gate at 0.06 while the thing it measures
sits at 2.0e-4 would have been finding 16 made again.

What remains in the modulated chorus row is the read position itself, still computed in float
here and in double there, which is the residual the fixed point phase cannot reach.

## The strategic fork

Three ways to have both a browser library and a hardware one.

**A. A C++ mirror with codegen for parity.** What this repository does. Fastest to a sounding
board, and it carries a permanent parity-drift tax that `tools/gen-tables.mjs` is meant to keep
visible.

**B. Invert: make C++ the source of truth and compile it to WASM for the browser.** Kills parity
drift permanently and gives one DSP codebase. Costs the tier 3 JavaScript story and a large part
of the current test suite's ergonomics. That is a rewrite, not a port.

**C. The hybrid, which is probably the good version.** Keep bellows.live as the composition brain
and put only the audio kernel on the board. `KernelEvent` is already flat and numeric, so it
packs into 16 bytes and streams over USB serial, BLE or Wi-Fi. `Transport.scheduleHorizon`
already produces exactly the lookahead buffer a device-side sample clock needs, and `Scheduler`
already survives late wakeups by stretching its horizon, which is the same defense a flaky link
needs. At sixteenths and 120 bpm that is eight events per second.

A and C are not exclusive. The library built here is what C runs on the device.

## Known risk: the pitch-dependent BLEP cost

Measured, mostly closed, and with the last piece deliberately left for the board. This section
has been wrong twice, so it is worth being precise about which numbers are durable.

The durable one is arithmetic, not timing. The residual sum walks the edges within the kernel
half width, and the average count of those per sample is exactly `2 * KERNEL_HALF * dt`: 0.32 at
A440, 5.1 at 7040 Hz, 15.7 at the `setFreq` clamp of 0.49, where one sample can span at most 16.
Wall-clock ns is not durable. The same shipping class measured through two benchmark harnesses on
the same machine gave 22.6 and 59.8 ns per sample at 7040 Hz, because how much of it inlines
depends on what else the caller made the JIT specialise. Quote ratios, measure both ends in one
process, and treat any absolute ns figure here as conditional on its harness.

Measured that way, saw: the default path peaks at 9.0x its A440 cost, at the top of the clamp.
That bound is what a fixed polyphony budget has to be sized to. Note how far the clamp is from
anything musical: 7040 Hz costs about 3.7x A440, and the top of a piano is 4186 Hz. The 14x
quoted in `docs/AUDIT.md` is 55 Hz against 7 kHz, and 55 Hz is an unusually cheap reference.

The obvious fix does not work. A frequency-dependent kernel cap gives up alias rejection exactly
where it starts to save anything, because truncating the residual at a nonzero value leaves a
step: at 7040 Hz a four-edge cap saves about a fifth of the cost and costs 39 dB, and tapering
the truncated kernel recovers only about 13 dB of that.

What works is the other option, a cheaper form above a threshold. Above `SWITCH_DT` a band
limited saw has one or two harmonics left under Nyquist, so summing them directly beats walking
sixteen edges and is exact where the residual sum is not:

| saw, 44100 Hz | residual ns | harmonic ns | residual dB | harmonic dB |
| --- | --- | --- | --- | --- |
| 11000 Hz | 30.5 | 25.0 | -89.8 | -97.0 |
| 13000 Hz | 38.7 | 24.5 | -77.0 | -98.1 |
| 17000 Hz | 45.6 | 24.5 | -81.0 | -101.1 |
| 21609 Hz | 56.4 | 24.9 | -21.7 | -101.6 |

That takes the peak from 9.0x A440 to 5.2x while improving the top of the range rather than
trading it away. It is opt in (`boundedHighFreq` in an engine's construction params), gated by
`test/dsp-osc/blep-frequency.test.ts`, and off by default, so rendered output and the golden
render are unchanged.

Two failure modes of the idea, both found by audit after the first version shipped, both worth
knowing before anyone attempts this again. Crossfading between the two paths across a transition
band means evaluating BOTH across that band: the first version cost about twice the default
between 6174 and 8820 Hz, exactly the range it was meant to be saving in, and left the peak
where it was. And cutting the harmonic series off at the kernel cutoff steps the output when a
harmonic crosses it, because the kernel is still passing half of a harmonic at its own cutoff,
which for the second harmonic of a saw is a jump of 0.16. The switch is therefore hard, and every
harmonic is scaled by the kernel's own response, so harmonics fade exactly as the residual path
fades them. Compared at the same dt the two paths now agree to a maximum sample difference of
0.0003 for saw and square and 0.014 for triangle.

**It is deliberately not ported to C++, and that is a bring-up measurement.** The whole cost
argument rests on a sine being cheap, which it is in a browser. On Cortex-M7 with newlib it is
not: `sinf` drags in `__kernel_rem_pio2f`, 1624 bytes of the VA sketch's flash on its own, and
costs far more than a table lookup and a lerp. So the crossover on the target is not the
crossover above, and at `BELLOWS_FAST_MATH=0` it may not exist at all. Measure `fm::Sin` against
the residual sum on real hardware, in both fast-math settings, before porting it. Until then the
C++ keeps the residual path at every pitch, which is also why parity is unaffected by any of this.
