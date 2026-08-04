# examples

Five sketches in Arduino layout, ordered so each one adds a single idea.
Every one is a real program: it compiles, it makes sound, and its cost is
measured rather than estimated.

| example | adds | flash | RAM |
| --- | --- | --- | --- |
| 01_OneKick | one voice, one audio callback | 3776 B | 1100 B |
| 02_DrumMachine | a compile-time Bank, euclidean patterns | 29696 B | 1588 B |
| 03_PolySynth | VoicePool, a swept filter | 30304 B | 3776 B |
| 04_ScalesAndTuning | the theory layer, 12-EDO against 19-EDO | 8080 B | 36928 B |
| 05_MidiInstrument | MIDI byte parsing into a voice pool | 30296 B | 3792 B |

Cortex-M7 at `-Os` with `--gc-sections`, library only: no Arduino core and
no audio library, so these are the bellows half of the binary and nothing
else. Reproduce them with `./tools/size-report.sh`, rows `p4_` through
`p8_`.

Two of these numbers are worth reading rather than skimming. 02, 03 and 05
all sit near 30 KB because each reaches `BlepOsc`, whose band-limited step
tables are about 16 KB and are paid once no matter how many voices use
them. 04 is 8 KB because a plucked string needs no such table, and its 36 KB
of RAM is the delay line that is the string. That spread is the whole
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

## Targets

The `.ino` files target a Teensy 4.x with the Rev D audio shield, because
that is the most common board with a working codec on it. Porting to a
Daisy Seed is the two lines noted at the top of each sketch: swap
`bellows/platform/teensy.h` for `bellows/platform/daisy.h` and start the
audio through `DaisyAudio<Render>` instead of an `AudioStream` node. The
logic headers contain no board code and do not change.

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
