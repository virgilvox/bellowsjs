# Getting sound out of a Teensy

Which example to start from, what it costs, and what you have to buy.

`bellows` renders float audio into a block. Everything on this page is about
what happens after that, which is the Teensy Audio Library's problem rather
than this library's, and is also the part that stops people. The library
half is one line in every one of these sketches:

```cpp
bellows::BellowsAudioStream<MyPatch> node(patch);
```

Everything else below is the converter.

## Pick one

| you have | example | parts | quality |
| --- | --- | --- | --- |
| the Teensy Audio Shield | `10_AudioShield` | the shield | 16 bit stereo, headphone amp and line out |
| three dollars and a speaker | `11_I2SAmp` | MAX98357A breakout | 16 bit, amplifier included, mono |
| three dollars and a stereo | `11_I2SAmp` | PCM5102A or UDA1334A | 16 bit stereo line out |
| a Teensy 3.x and nothing else | `12_DacOut` | one capacitor | 12 bit, the built-in DAC |
| a Teensy 4.x and nothing else | `13_BareOutput` | 2 resistors, 2 caps per channel | MQS, better than it sounds |
| any Teensy and nothing else | `13_BareOutput` | 2 resistors, 2 caps per channel | PWM on 3.x, noisier |
| a piezo disc | `15_Piezo` | the disc, no other parts | loud, thin, no bass at all |

`11_I2SAmp` is the one to reach for if you are buying something. An I2S
breakout removes every analog question at once and the amplifier versions
drive a speaker with no further parts.

## The one that is not obvious: piezo

A piezo disc is not a small speaker. It is a capacitor, 10 to 20 nF for a
27 mm brass disc, bonded to a metal plate with a sharp mechanical resonance
somewhere between 2 and 6 kHz, and it moves almost no air anywhere else.
Feed it what you would feed a cone and nearly all of the available voltage
swing is spent on frequencies it cannot reproduce.

Four things help, in order of how much:

1. **Drive it differentially.** Wire the disc between two pins rather than
   from one pin to ground, and render the signal on one and its inverse on
   the other. A logic pin swings 3.3 V; two in antiphase swing 6.6 V. That
   is 6 dB and it is more than everything else here put together.
2. **Remove the bass, do not attenuate it.** The disc's impedance is
   1/(2*pi*f*C), about a megaohm at 100 Hz, so nothing flows down there
   whatever you do. The reason to filter is that the limiter cannot tell
   the difference, so bass the disc will never reproduce still steals
   headroom from the band it can.
3. **Boost the resonance.** It is much louder there than anywhere else.
   `15_Piezo` has a sweep mode that steps a tone across the band so you can
   hear which frequency is loudest, because mounting moves it: a disc glued
   to a tin lid is lower, and much louder, than one lying on the bench.
4. **Limit hard.** There is no headroom to protect; the swing is fixed by
   the supply and anything above it clips at the pin regardless. So push
   the average up until it sits just under the ceiling.

`15_Piezo/piezo.h` is that chain, and it wraps any bellows render, so it
composes with the other examples rather than replacing them.

What none of it fixes: a piezo has no bass and no processing invents any. A
bassline through one is heard through its harmonics, so write piezo patches
an octave or two above where they would sit on a speaker.

**This advice is engineering reasoning about a capacitive transducer, not a
measurement.** Nobody has held a meter to a disc driven by this code. See
"What builds means" below, which is the same caveat for everything here.

## The RAM lesson, which is the whole embedded story

A Karplus-Strong string IS its delay line, and the line is sized for the
lowest note it will ever play. At 48 kHz a 20 Hz floor is 2404 samples,
9.6 KB of float per voice. Four voices is 38 KB, and a Teensy 3.2 has 64 KB
with the audio library already in it. Measured, before the shared patch
knew what board it was on:

```
.bss will not fit in region RAM; region RAM overflowed by 61540 bytes
```

Raising the floor from 20 Hz to 100 Hz costs five times less RAM per voice
and costs nothing else, as long as no note goes below it. That is why
`audioshield.h` picks its floor and its voice count from board macros, and
why every buffer-owning class in this library takes its size as a template
parameter: the sketch decides, and the library never allocates.

## Two costs, measured

Cortex-M7 at `-Os` with `--gc-sections`, library only, four voices with a
20 Hz floor. Reproduce with `./tools/size-report.sh`:

| sketch | flash | RAM |
| --- | --- | --- |
| `p9_e10_chord` the shared patch | 6816 B | 116860 B |
| `p10_e15_piezo` plus the piezo voicing | 13960 B | 122152 B |

So the piezo chain (two cascaded highpasses, a bell and a true-peak
limiter) costs 7144 B of flash and 5292 B of RAM on top of the patch it
voices. Almost all of that RAM is the limiter's lookahead.

## What builds means

Every board and example combination in the matrix in `README.md` was
compiled and linked as real firmware for that board. That is a stronger
claim than it usually is, because it includes the Arduino core and the
audio library rather than the DSP alone.

It is not the claim you want. **Nothing in this directory has been flashed
to a board and listened to.** A build proves the code is valid for the part
and fits in its memory. It does not prove the part is fast enough to render
the patch in real time, and this library's compute cost has never been
measured on hardware at all: see `docs/HANDOFF.md`, which has said so since
the port started.

The boards where that gap is widest are the ones without a floating point
unit. Teensy LC and Teensy 3.2 emulate every float operation in software,
and this is a float DSP library. They build. Whether they keep up is
unknown, and for the LC the answer is probably no.

`00_BringUp` exists for exactly this. Run it first on any board you have:
it prints the real sample rate, sustains an A440 you can check against a
tuner, and reports CPU load and dropouts per stage.
