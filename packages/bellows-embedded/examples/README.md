# examples

Five sketches in Arduino layout, ordered so each one adds a single idea.
Every one is a real program: it compiles, it links as Teensy 4.1 firmware,
and its cost is measured rather than estimated. None of them has been
flashed to a board and listened to, which is what `00_BringUp` is for.

Start with `00_BringUp`, which is not one of the five. It is the checklist
for the first session with a board in hand: it prints the real sample rate,
sustains an A440 you can check on a tuner, walks a fixed sequence of stages
with a stated pass condition each, and reports CPU load and a dropout
indicator per stage. Its last two stages measure the one thing no test in
this repository covers, the pitch dependence of the BLEP oscillator cost
against a fixed voice budget. See `00_BringUp/README.md`.

| example | adds | flash | RAM |
| --- | --- | --- | --- |
| 01_OneKick | one voice, one audio callback | 3776 B | 1100 B |
| 02_DrumMachine | a compile-time Bank, euclidean patterns | 29688 B | 1620 B |
| 03_PolySynth | VoicePool, a swept filter | 30408 B | 3876 B |
| 04_ScalesAndTuning | the theory layer, 12-EDO against 19-EDO | 8096 B | 30176 B |
| 05_MidiInstrument | MIDI byte parsing into a voice pool | 30336 B | 3888 B |

Cortex-M7 at `-Os` with `--gc-sections`, library only: no Arduino core and
no audio library, so these are the bellows half of the binary and nothing
else. Reproduce them with `./tools/size-report.sh`, rows `p4_` through
`p8_`, and `node ../tools/check-docs.mjs --check` reads these five rows
back and compares them, because four of the five had drifted before it did.

Two of these numbers are worth reading rather than skimming. 02, 03 and 05
all sit near 30 KB because each reaches `BlepOsc`, whose band-limited step
tables are about 16 KB and are paid once no matter how many voices use
them. 04 is 8096 B of flash because a plucked string needs no such table, and its
30176 B of RAM is the delay line that is the string. That spread is the whole
argument for one header per concept.

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
