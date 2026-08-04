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
| `StereoDelay<100>` | 65 KB |
| `StereoDelay<250>` | 128 KB |
| `StereoDelay<500>` | 257 KB |
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
| `fx/dynamics` | 4048 B | 10336 B | compressor, limiter lookahead line |
| `fx/modfx` | 4936 B | 26056 B | chorus, flanger, tremolo, autopan, ringmod |
| `engines/tube` | 5136 B | 3272 B | `Tube<80>` bore |
| `seq/` (euclid, arp, CA, lsystem, tempomap) | 5296 B | 900 B | fixed capacity, no allocation |
| `engines/fm` | 5384 B | 1536 B | SineOsc only, so no BLEP tables |
| `fx/saturator` | 5536 B | 10136 B | with the oversampler |
| `fx/plate` | 5712 B | 222684 B | Dattorro tank, the RAM is the tank |
| `engines/modal` | 5944 B | 1584 B | five material tables in flash |
| `kernel` | 6208 B | 2492 B | event queue plus block splitting |
| `engines/westcoast` | 27064 B | 1200 B | BLEP tables dominate |
| `engines/formant` | 28296 B | 1496 B | BLEP tables dominate |

The BLEP tables are 16 KB and shared, so the first module that needs them pays and every later
one is nearly free. `fm`, `modal`, `tube` and `pluck` do not need them at all, which is why an
FM plus pluck instrument is under 12 KB while a formant voice alone is 28 KB.

The theory row is the one to notice. Scales, chords, tunings and note parsing together are
2.6 KB of flash and 116 bytes of RAM.

## Realistic firmware profiles

| Profile | flash | RAM |
| --- | --- | --- |
| kick only | 3760 B | 1100 B |
| kick only, `BELLOWS_FAST_MATH=1` | 1448 B | 1100 B |
| three piece kit | 28248 B | 1500 B |
| 8 voice VA poly, EQ, 250 ms delay | 30688 B | 135176 B |
| 8 VA plus 8 `Pluck<80>` plus kit, EQ, 250 ms delay | 34240 B | 208520 B |
| everything constructed and driven at once | 61328 B | 375340 B |

And the shipped examples, whose numbers come from the same logic headers the sketches compile,
so they cannot drift from the code:

| Example | flash | RAM |
| --- | --- | --- |
| `01_OneKick` | 3776 B | 1100 B |
| `02_DrumMachine` (bank plus euclid) | 29696 B | 1588 B |
| `03_PolySynth` (`VoicePool<Va, 8>`) | 30304 B | 3776 B |
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
formant       7.85e-4   3.74e-4    0.005  pass
tube          1.70e-3   1.09e-2    0.005  pass  error rides the waveform edges
eq            2.93e-7   1.79e-7 0.000003  pass
delay         7.78e-8   2.98e-8 0.000001  pass
saturator     2.00e-7   1.49e-7 0.000002  pass
compressor    2.25e-6   1.16e-6  0.00002  pass
chorus_static 6.31e-6   1.26e-6   0.0001  pass  depth 0: the real DSP gate
chorus        3.97e-2   2.08e-2     0.06  pass  depth 0.5: sub-sample LFO timing
plate         2.44e-3   1.91e-3    0.005  pass
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

Two rows are measured differently on purpose. The chorus is bit-identical with modulation off
and its error scales exactly with depth, because the LFO phase accumulates in float here and in
double there, and a fractional-sample shift of a white noise read is a large sample difference
for an identical sound. Sample-wise RMS is the wrong instrument for a time-modulating effect, so
`chorus_static` is the gate that would actually catch a broken chorus. The tube's few exceeding
samples sit on the waveform's steep edges, spaced twice per period, where sub-sample timing
reads as amplitude.

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

## Known risk

The pitch-dependent BLEP cost documented in `docs/AUDIT.md` (14x from 55 Hz to 7 kHz on saw)
interacts badly with fixed polyphony on hardware. Sizing a voice budget at A440 and shipping it
will produce dropouts on high leads. The frequency-dependent kernel cap should be decided before
the first board bring-up, not after, and it has to be measured against the existing spectrum
gates in `test/dsp-osc` rather than by ear.
