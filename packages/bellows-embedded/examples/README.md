# examples

Two sets of sketches in Arduino layout.

**06 is the rung below all of them**: one oscillator, then an envelope, then
a filter, then an LFO, four headers in one image, for the session where the
question is whether the board makes any sound at all.
**01 to 05 teach the library**, ordered so each one adds a single idea, and
**07 is what they add up to**: five engines, a sequencer, a send and one
seed, which is the example to read if you want to know what the library is
for rather than how one piece of it works.
**20 is the patch library**: eleven instruments over the ported engines, all
sharing one note source so that switching patch compares instruments rather
than the parts they happen to be playing.
**10 to 15 get sound out of the board**, one per output path: the audio
shield, an I2S amplifier or DAC breakout, the built-in DAC, a bare Teensy
with four passive parts, and a piezo disc. If you are trying to hear
something for the first time, start at `10_AudioShield` if you own the
shield and `11_I2SAmp` if you are buying something. `OUTPUTS.md` is the
guide to choosing, and has the piezo reasoning.

Every one is a real program: it compiles and links as firmware for the
boards in the matrix below, and its cost is measured rather than estimated.
One of them has now been flashed and heard: `07_Workstation` on a Teensy 4.0
through an I2S amplifier, at 47.2 percent peak CPU. Everything else here is
still compile-verified and link-verified only, which is what `00_BringUp` is
for.

Start with `00_BringUp`, which is not one of the five. It is the checklist
for the first session with a board in hand: it prints the real sample rate,
sustains an A440 you can check on a tuner, walks a fixed sequence of stages
with a stated pass condition each, and reports CPU load and a dropout
indicator per stage. Its last two stages measure the one thing no test in
this repository covers, the pitch dependence of the BLEP oscillator cost
against a fixed voice budget. See `00_BringUp/README.md`.

| example | adds | flash | RAM |
| --- | --- | --- | --- |
| 06_FirstSteps | an oscillator, an envelope, a ladder, two LFOs | 23632 B | 1508 B |
| 01_OneKick | one voice, one audio callback | 3776 B | 1100 B |
| 02_DrumMachine | a compile-time Bank, euclidean patterns | 30120 B | 1620 B |
| 03_PolySynth | VoicePool, a swept filter | 30280 B | 3876 B |
| 04_ScalesAndTuning | the theory layer, 12-EDO against 19-EDO | 8096 B | 30176 B |
| 05_MidiInstrument | MIDI byte parsing into a voice pool | 30616 B | 3888 B |
| 07_Workstation | five engines, a Markov melody, a send bus | 41992 B | 225508 B |
| 20_Instruments | eleven patches over eight engines, one note source | 47912 B | 49904 B |

The output examples share one patch, `10_AudioShield/audioshield.h`, so
that comparing them compares converters rather than programs. Its cost and
the piezo voicing's are in `OUTPUTS.md`.

| example | output path | boards |
| --- | --- | --- |
| 10_AudioShield | SGTL5000 over I2S | 3.2, 3.5, 3.6, 4.0, 4.1, MicroMod |
| 11_I2SAmp | I2S breakout, no codec to configure | 3.2, 3.5, 3.6, 4.0, 4.1, MicroMod |
| 12_DacOut | the built-in 12 bit DAC | 3.2, 3.5, 3.6 only, 4.x has no DAC |
| 13_BareOutput | MQS on 4.x, PWM on 3.x, into an RC filter | all but LC |
| 15_Piezo | a piezo disc driven differentially | all but LC |

Cortex-M7 at `-Os` with `--gc-sections`, library only: no Arduino core and
no audio library, so these are the bellows half of the binary and nothing
else. Reproduce them with `./tools/size-report.sh`, rows `p4_` through
`p8_` and `p11_` through `p13_`, and `node ../tools/check-docs.mjs --check`
reads these eight rows back and compares them, because four of the first five
had drifted before it did.

Three of these numbers are worth reading rather than skimming. 02, 03 and 05
all sit near 30 KB because each reaches `BlepOsc`, whose band-limited step
tables are about 16 KB and are paid once no matter how many voices use
them. 04 is 8096 B of flash because a plucked string needs no such table, and its
30176 B of RAM is the delay line that is the string. That spread is the whole
argument for one header per concept.

06 is 23632 B of flash for four primitives, which is almost all one number:
BlepOsc's band-limited step tables. A naive saw would be a couple of hundred
bytes and would alias audibly on every note above the middle of the keyboard.
It is paid once, which is why 20_Instruments reaches eight engines for
47912 B and not eight times this.

07 is the outlier in both columns and for two different reasons. Its 41992 B
of flash is what reaching almost everything costs: the drums, a VA, a
plucked string, a delay, an EQ, a limiter and the theory and sequencing
layers, in one program. Its 225508 B of RAM is one object, the 500 ms stereo
delay line, at 187 KB. Everything else in it, four strings, the chain, the
patterns and the send scratch, comes to under 40 KB together.

## Which boards, measured by building

Every cell is a firmware build with the Arduino core and the audio library
in it, produced by `./build-matrix.sh`, which is 98 builds and takes about
an hour. `ok NN%` is RAM used, which is the number that decides whether a
patch fits.

| example | LC | 3.2 | 3.5 | 3.6 | 4.0 | 4.1 | MicroMod |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 00_BringUp | RAM | 28.2% | 7.1% | 7.3% | ok | ok | ok |
| 01_OneKick | 81.6% | 18.1% | 4.6% | 4.7% | ok | ok | ok |
| 02_DrumMachine | 88.1% | 19.0% | 4.8% | 4.9% | ok | ok | ok |
| 03_PolySynth | RAM | 24.0% | 6.0% | 6.2% | ok | ok | ok |
| 04_ScalesAndTuning | RAM | 62.5% | 15.7% | 15.8% | ok | ok | ok |
| 05_MidiInstrument | RAM | 24.6% | 6.2% | 6.3% | ok | ok | ok |
| 06_FirstSteps | 87.0% | 18.8% | 4.7% | 4.9% | ok | ok | ok |
| 07_Workstation | RAM | RAM | 91.4% | 91.5% | ok | ok | ok |
| 20_Instruments | RAM | RAM | 26.3% | 26.4% | ok | ok | ok |
| 10_AudioShield | RAM | 36.1% | 48.7% | 48.9% | ok | ok | ok |
| 11_I2SAmp | RAM | 34.8% | 48.4% | 48.4% | ok | ok | ok |
| 12_DacOut | RAM | 34.7% | 48.7% | 48.7% | n/a | n/a | n/a |
| 13_BareOutput | RAM | 35.5% | 48.6% | 48.6% | ok | ok | ok |
| 15_Piezo | RAM | 43.7% | 50.6% | 50.6% | ok | ok | ok |

`RAM` is the linker refusing: `region RAM overflowed`. `n/a` is the sketch
declining on purpose, with an `#error` that says why: Teensy 4.x has no DAC
at all, so `12_DacOut` cannot exist there and says so rather than failing
somewhere deep in a header.

07_Workstation shows `RAM` rather than `n/a` on the two it does not fit, and
that is the distinction those two symbols carry. A Teensy 4.x has no DAC and
never will, which is categorical and worth an `#error`. Not enough memory is
a quantity, and `region RAM overflowed by N bytes` tells you how much you
would have to give up to change the answer.

Reading it:

- **Teensy 4.0, 4.1, MicroMod** run everything with room to spare.
- **Teensy 3.5 and 3.6** run everything, and 07_Workstation at 91.4 and 91.5
  percent is the tightest fit in the table. It fits and it leaves nothing;
  it was written expecting to need a 4.x and the build said otherwise. The
  output examples sit near 49 percent because they carry four strings tuned
  down to 20 Hz; that is a choice in `audioshield.h`, not a floor.
- **Teensy 3.2** runs everything except 07_Workstation, whose delay line
  alone is 187 KB against the 64 KB the whole part has. Of the rest,
  04_ScalesAndTuning at 62.5 percent is the tightest fit.
- **Teensy LC** runs three of the fourteen, at 81.6, 87.0 and 88.1 percent of
  its 8 KB. It is not a board to plan a synth around, and 06_FirstSteps only
  fits because it holds no delay line at all.

The 3.5 and 3.6 columns being *higher* than the 3.2 column on rows 10
through 15 is not an error. `audioshield.h` picks a 20 Hz floor and four
voices where there is room and a 100 Hz floor and two voices where there is
not, so those rows are not the same patch. `OUTPUTS.md` explains why that
one number dominates embedded RAM.

**None of this says any board is fast enough.** A build proves the code is
valid for the part and fits in its memory. Teensy LC and Teensy 3.2 have no
floating point unit and this is a float DSP library, so they emulate every
operation in software. Whether they keep up has never been measured on
hardware, and neither has anything else here: see "What builds means" in
`OUTPUTS.md`.

## Layout

Each folder holds the `.ino` and a header with the actual logic:

```
examples/01_OneKick/01_OneKick.ino     board glue: pins, codec, callback
examples/01_OneKick/onekick.h          the program
```

The split is not decoration. `test/sketches/p4_e1_onekick.cpp` includes
that same header and is what the size report compiles, so the numbers above
come from the code you are reading rather than from a copy of it that can
drift. Anything a sketch does that is not board-specific belongs in the
header.

That mechanism worked and the table still went stale, in four of its five
rows, because nothing re-read this file. Sharing a source with the size
report keeps a number honest about WHAT it measures; only a checker keeps it
honest about WHEN. `tools/check-docs.mjs` is that checker.

## Targets

The `.ino` files target a Teensy 4.x with the Rev D audio shield, because
that is the most common board with a working codec on it. Porting to a
Daisy Seed is the two lines noted at the top of each sketch: swap
`bellows/platform/teensy.h` for `bellows/platform/daisy.h` and start the
audio through `DaisyAudio<Render>` instead of an `AudioStream` node. The
logic headers contain no board code and do not change.

`daisy_onekick/` is that port done for real, against libDaisy 8.1.0, linked
as a Daisy Seed firmware image. It is worth reading next to `01_OneKick`
because of what it does not contain: it includes `01_OneKick/onekick.h`
directly rather than copying it, and that header needed no change, no
`#ifdef` and no Daisy define to build for a different SDK, a different codec
and a different sample rate. All five logic headers compile against the
Daisy adapter for the STM32H750; only `01_OneKick` has been linked all the
way to an image.

Set the sample rate from the SDK (`bellows::TeensySampleRate()`,
`hw.AudioSampleRate()`) rather than writing 44100 or 48000 by hand. Every
envelope coefficient, filter cutoff and delay length is derived from the
number passed to `Init`.

## Reading order

01 and 02 are the architecture: concrete types, no registry, dispatch by
compile-time bank. 03 and 05 are the ordinary work of an instrument, voice
allocation and MIDI. 04 is the one to read if you only read one, because
it is the part of this library that is not available elsewhere, and its
header comment explains the mistake that subject reliably produces.
