import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'on-hardware',
  title: 'On hardware',
  blurb: 'Install the C++ port, wire an output, flash a board, and hear it.',
  prev: 'custom-dsp',
  next: null,
  body: `
The same DSP that runs in this browser also runs on a microcontroller. \`bellows-embedded\` is the C++17 port: header only, no allocation, no global registry, and numerically compared against the TypeScript on every commit.

This page is the whole path from nothing to a board making a sound.

## What it is, and what it costs

Include one header and you link one engine. There is no registry mapping names to constructors, which is the single load-bearing design rule of the package: a string-keyed registry of five engines costs 30488 bytes of flash because naming every engine forces the linker to keep every engine, against 3760 for the one you actually use.

Nothing allocates. Every buffer is sized from a template parameter, voices add into \`(l, r, from, to)\` ranges, and the audio path has no \`new\` at steady state.

Rough costs, measured with \`tools/size-report.sh\` for Cortex-M7 at \`-Os\`:

| what | flash | RAM |
| --- | --- | --- |
| one kick drum | 3776 B | 1100 B |
| a drum machine with euclidean patterns | 30120 B | 1620 B |
| eight virtual-analog voices with a swept filter | 30280 B | 3876 B |
| eleven instruments over eight engines | 47912 B | 49904 B |
| five engines, a sequencer, a delay send | 41992 B | 225508 B |

Those five are copied by hand from that script's output. \`check-docs\` verifies every figure in the repository's own documents against the harnesses that print them, but it does not reach this page, so treat these as indicative and rerun the script if you are deciding something on them.

The pattern worth reading is that 02, 03 and 05 all sit near 30 KB because each reaches the band-limited oscillator, whose step tables are about 16 KB and are paid once no matter how many voices read them. And that the workstation's 225 KB of RAM is one object: a 500 ms stereo delay line at 187 KB. The delay line is almost always the RAM.

## Install it

**PlatformIO**, which is the verified path. Point at the subdirectory:

\`\`\`ini
[env:teensy41]
platform = teensy
board = teensy41
framework = arduino
lib_deps = https://github.com/virgilvox/bellowsjs.git
build_flags = -std=gnu++17
build_unflags = -std=gnu++14 -std=gnu++11
\`\`\`

The \`build_unflags\` line is not optional. The PlatformIO Teensy platform still defaults to \`gnu++14\` on some releases, and this library needs C++17 for inline \`constexpr\` variables. Two other traps on that platform: \`board_build.usb_type\` is silently ignored, so use \`-D USB_MIDI_SERIAL\` in \`build_flags\` if you want MIDI; and if you are building for a Daisy Seed, libDaisy pins \`CPP_STANDARD ?= -std=gnu++14\` for the same reason.

**Arduino IDE.** Clone the repository and copy \`packages/bellows-embedded\` into your \`libraries\` folder as \`Bellows\`. Then set the language standard to C++17, which the IDE does not expose in its UI: add a \`platform.local.txt\` beside your platform's \`platform.txt\` with \`compiler.cpp.extra_flags=-std=gnu++17\`.

**One header** is all the code needs:

\`\`\`cpp
#include "Bellows.h"
\`\`\`

or include only what you use, which is what the examples do and what keeps the link small:

\`\`\`cpp
#include "bellows/engines/drums.h"
#include "bellows/seq/euclid.h"
\`\`\`

## The shape of a program

Every example splits into two files, and the split is not decoration. The \`.h\` holds the program, with no board in it. The \`.ino\` holds the wiring: pins, codec, the audio callback. The size-report sketches include the same \`.h\`, so the numbers above come from the code you are reading rather than from a copy of it that can drift.

A render is anything with this signature:

\`\`\`cpp
void operator()(float* l, float* r, int from, int to);
\`\`\`

Voices ADD into that range and effects process it in place, which is the same contract as the browser library. The caller clears the block. On Teensy, \`BellowsAudioStream<Render>\` adapts it to the Audio Library:

\`\`\`cpp
#include <Audio.h>
#include "bellows/platform/teensy.h"
#include "onekick.h"

static onekick::Patch patch;
static bellows::BellowsAudioStream<onekick::Patch> node(patch);
static AudioOutputI2S out;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  AudioMemory(12);
  patch.Init(bellows::TeensySampleRate());
}
\`\`\`

Take the sample rate from the SDK rather than writing 44100 or 48000 by hand. Every envelope coefficient, filter cutoff and delay length is derived from the number passed to \`Init\`.

## Getting sound out

Six ways, cheapest last. The SIMULATOR page lets you hear each one before you buy anything.

| you have | example | parts | what you get |
| --- | --- | --- | --- |
| the Teensy Audio Shield | \`10_AudioShield\` | the shield | 16 bit stereo, headphone amp and line out |
| three dollars and a speaker | \`11_I2SAmp\` | MAX98357A breakout | 16 bit, amplifier included, mono |
| three dollars and a stereo | \`11_I2SAmp\` | PCM5102A or UDA1334A | 16 bit stereo line out |
| a Teensy 3.x and nothing else | \`12_DacOut\` | one capacitor | 12 bit, the built-in DAC |
| a Teensy 4.x and nothing else | \`13_BareOutput\` | 2 resistors, 2 caps per channel | MQS, better than it sounds |
| a piezo disc | \`15_Piezo\` | the disc, no other parts | loud, thin, no bass at all |

**I2S on a Teensy 4.x** is three wires and no configuration, because these breakouts have no control interface:

\`\`\`
Teensy 7  (OUT1A / TX)  ->  DIN / SD / DATA
Teensy 21 (BCLK)        ->  BCLK / SCK / BCK
Teensy 20 (LRCLK)       ->  LRC / WS / LCK
Teensy 5V               ->  VIN
Teensy GND              ->  GND
speaker across + and -  (MAX98357A only)
\`\`\`

Power a MAX98357A from 5V and not from the Teensy's 3.3V regulator. It is a 3W amplifier, and a brownout does not look like a power problem: it looks like the audio glitching on loud notes.

Those pin numbers belong to the Teensy Audio Library, not to you. On Teensy 3.x the same three are 22, 9 and 23.

**A piezo disc** is the odd one, and worth understanding because the naive wiring wastes most of what you have. A disc is a capacitor with a sharp mechanical resonance and no bass at all, so:

- Drive it **across two pins**, not from one pin to ground. The voicing renders the signal on one channel and its inverse on the other, so the disc sees 6.6 V peak to peak instead of 3.3. That is 6 dB and it costs nothing.
- Remove everything below about 1.2 kHz. Not attenuate, remove: at 100 Hz a 15 nF disc is about a megaohm and essentially nothing flows, and every volt spent down there is a volt unavailable where the disc can actually radiate.
- Then **make up the gain**, because the filtering above throws away most of a full-range patch. Measured on the workstation patch, the chain took it from -19.5 dBFS to -32.9 and the limiter never engaged once. \`Voicing::drive\` is the control for that, and it was worth 12 dB.
- Glue the disc to something. A disc lying loose moves almost nothing; on a tin lid or a stretched membrane it is dramatically louder, and its resonance drops, which you then want to re-measure.

## The examples

Every folder is a real program that compiles and links as firmware. They are in the library, so the Arduino IDE lists them under File, Examples, Bellows.

**Start below the beginning.** \`06_FirstSteps\` is four rungs in one image: one oscillator, then an envelope, then a resonant ladder with an envelope of its own, then two LFOs. If a board makes no sound, this tells you which of the four is the first to fail. It is the cheapest example here and the only one with no delay line in it.

**Then one idea at a time.**

| example | adds |
| --- | --- |
| \`00_BringUp\` | the checklist for a board you have never run: real sample rate, an A440 to check on a tuner, CPU load per stage |
| \`01_OneKick\` | one voice, one audio callback |
| \`02_DrumMachine\` | a compile-time bank, euclidean patterns |
| \`03_PolySynth\` | a voice pool, a swept filter |
| \`04_ScalesAndTuning\` | the theory layer, one phrase in 12-EDO and then 19-EDO |
| \`05_MidiInstrument\` | MIDI byte parsing into a voice pool |

**Then everything at once.** \`07_Workstation\` is five engines playing together: euclidean rhythms on a kit, a bass line, a melody drawn from a Markov chain rather than stored, a tempo-synced delay on a send, an EQ and a limiter. One seed decides the whole piece, so two boards flashed with it play the same four bars.

\`20_Instruments\` is a patch library: eleven instruments over eight engines, sharing one note source so that switching patch compares instruments rather than the parts they happen to be playing. FM electric piano, acid bass, chorused pad, west coast wavefolder, plucked string, three modal materials, a waveguide clarinet, a formant choir and a long-decay kit.

**And the output examples**, \`10\` through \`17\`, one per way of getting sound out. They share one patch so that comparing them compares converters rather than programs.

## Which boards

Every cell below is a firmware build with the Arduino core and the audio library in it, produced by \`examples/build-matrix.sh\`. It is a build log, not a reading of data sheets. A percentage is RAM used, which is the number that decides whether a patch fits.

| example | LC | 3.2 | 3.5 | 3.6 | 4.0 | 4.1 | MicroMod |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 06_FirstSteps | 87.0% | 18.8% | 4.7% | 4.9% | ok | ok | ok |
| 01_OneKick | 81.6% | 18.1% | 4.6% | 4.7% | ok | ok | ok |
| 02_DrumMachine | 88.1% | 19.0% | 4.8% | 4.9% | ok | ok | ok |
| 03_PolySynth | RAM | 24.0% | 6.0% | 6.2% | ok | ok | ok |
| 04_ScalesAndTuning | RAM | 62.5% | 15.7% | 15.8% | ok | ok | ok |
| 07_Workstation | RAM | RAM | 91.4% | 91.5% | ok | ok | ok |
| 20_Instruments | RAM | RAM | 26.3% | 26.4% | ok | ok | ok |

\`RAM\` is the linker refusing. The workstation needs a 3.5 or better because its delay line alone is 187 KB, which is more than a Teensy 3.2 has in total.

A Daisy Seed is the other supported target: swap \`bellows/platform/teensy.h\` for \`bellows/platform/daisy.h\` and start the audio through \`DaisyAudio<Render>\` instead of an \`AudioStream\` node. The program header does not change.

## Flash it

With PlatformIO, from \`packages/bellows-embedded/examples\`:

\`\`\`
PLATFORMIO_SRC_DIR=07_Workstation pio run -e teensy41 -t upload
\`\`\`

Or with PJRC's command line loader, which tells you what it actually did:

\`\`\`
teensy_loader_cli --mcu=TEENSY40 -w -v firmware.hex
\`\`\`

\`-w\` waits for the board, so press the program button and it fires. Watch for \`Found HalfKay Bootloader\` followed by \`Programming\` and \`Booting\`: a loader that only says it opened is not a loader that programmed anything.

If the board goes quiet, check whether it is sitting in the bootloader rather than running. In that state it enumerates with product id \`0x0478\`; running firmware enumerates as a Teensy device with a serial port.

## What has actually run, and what has not

This section used to say that nothing had ever been flashed. That is no longer true, and here is exactly what changed.

**Measured, on a Teensy 4.0 at 600 MHz, running \`07_Workstation\` at 44.1 kHz through an I2S amplifier:**

| | |
| --- | --- |
| CPU, typical | 34 to 43 % |
| CPU, peak | 47.2 % |
| audio memory used | 2 blocks of 24 |

That is the heaviest program in the set: five engines, a Markov melody, a delay send, an EQ and a limiter, all at once. It runs with about half the processor left over.

**Still not measured**, and worth saying plainly rather than letting one board stand for all of them:

- Every other board. A Teensy 3.2 and an LC have no floating point unit and emulate every operation in software; whether they keep up has never been tested. A Daisy Seed has been linked to a complete firmware image but never run.
- Every other program. One patch on one board is one data point.
- Audio quality against the browser by ear. The two implementations are compared numerically on 34 engine and effect rows plus 428 exactly-compared value rows, which is a strong position and is not the same as having listened to both.

The parity figure the SIMULATOR page prints beside each firmware is that numerical comparison, so you can see how far what you are hearing in a browser is from what the board would produce.
`,
};

export default page;
