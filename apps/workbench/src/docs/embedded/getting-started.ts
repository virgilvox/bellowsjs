import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-getting-started',
  title: 'What the port is, and what it costs',
  blurb: 'The rules the package is built on, the flash and RAM per program, and how it is checked against the browser.',
  prev: 'emb-put-it-on-a-board',
  next: 'emb-program-shape',
  body: `
The same DSP that runs in this browser also runs on a microcontroller. \`bellows-embedded\` is the C++17 port: header only, nothing allocates, nothing self-registers, and every engine is compared numerically against the TypeScript on every commit (41 engine and effect rows with the PRNG bit exact, plus 428 exactly-compared value rows).

By the end of this page you will have the library installed, one sketch built, and one kick drum playing out of a board.

## What the port is

Six rules shape the whole package, and they are the reason it fits on a part with 64 KB of RAM.

- One header per concept. There is no registry mapping names to constructors, so the linker keeps exactly the engines you name.
- \`Init(sample_rate, ...)\` rather than constructors. Every class is default constructible and does its real setup when you ask it to.
- Voices ADD into an \`(l, r, from, to)\` range. Effects process that range in place. The caller clears the block.
- Nothing allocates. Every buffer is sized by a template parameter, so the sketch decides and the library never calls \`new\`.
- Sample rates come from the SDK, never from a literal.
- Randomness flows through \`Rng\`, seeded by a label, so a seeded piece reproduces across the browser and the board.

[Program shape](/docs/emb-program-shape) is those rules as code. The generated reference at [/llm-embedded.txt](/llm-embedded.txt) lists every class, template parameter and \`Params\` field with its default.

The supported targets are Teensy 3.2, 3.5, 3.6, 4.0, 4.1 and MicroMod through the Teensy Audio Library, and the Daisy Seed through libDaisy.

**One program has been flashed and heard**, twice: \`17_WorkstationI2S\`, which is \`07_Workstation\` summed to mono, on a Teensy 4.0 at 600 MHz, 44.1 kHz, through an I2S amplifier. The second run measured 33.8 to 46.5 percent CPU with a running maximum of 47.3 percent, using 2 audio blocks of the 24 it asked for. Everything else in the package is compile-verified and link-verified as real firmware, which is not the same claim.

## What it costs

Cortex-M7 at \`-Os\` with \`--gc-sections\`, library only: no Arduino core and no audio library, so these are the bellows half of the binary and nothing else. Reproduce them with \`./tools/size-report.sh\`, and \`node tools/check-docs.mjs --check\` reads these rows back and compares them.

| example | what is in it | flash | RAM |
| --- | --- | --- | --- |
| \`06_FirstSteps\` | an oscillator, an envelope, a ladder, two LFOs | 23632 B | 1508 B |
| \`01_OneKick\` | one voice, one audio callback | 3776 B | 1100 B |
| \`02_DrumMachine\` | a compile-time bank, euclidean patterns | 30120 B | 1620 B |
| \`03_PolySynth\` | a voice pool, a swept filter | 30280 B | 3876 B |
| \`04_ScalesAndTuning\` | the theory layer, 12-EDO against 19-EDO | 8096 B | 30176 B |
| \`05_MidiInstrument\` | MIDI byte parsing into a voice pool | 30728 B | 3888 B |
| \`07_Workstation\` | five engines, a Markov melody, a send bus | 42040 B | 225508 B |
| \`20_Instruments\` | eleven patches over eight engines | 47912 B | 49904 B |

A bare \`Kick\` with stock parameters is the floor of that table at 3760 B of flash and 1100 B of RAM. \`01_OneKick\` is 16 bytes over it, which is its wrapper class and two changed parameters.

Three rows are worth reading rather than skimming.

06, 02, 03 and 05 all sit above 23 KB because each one reaches \`BlepOsc\`, whose band-limited step tables are about 16 KB. That is paid once no matter how many voices read them, which is why \`20_Instruments\` reaches eight engines for 47912 B rather than eight times a single engine.

04 is only 8096 B of flash because a plucked string needs no such table, and its 30176 B of RAM is the delay line that IS the string.

07 is 225508 B of RAM, and 187 KB of that is one object: a 500 ms stereo delay line. Everything else in it, four strings, the chain, the patterns and the send scratch, comes to under 40 KB together. On this part the delay line is almost always the RAM.

## Install under PlatformIO

It is in the registry:

\`\`\`ini
[env:teensy41]
platform = teensy
board = teensy41
framework = arduino
lib_deps = virgilvox/Bellows
build_flags = -std=gnu++17
build_unflags = -std=gnu++14 -std=gnu++11
\`\`\`

Pin a version with \`virgilvox/Bellows@0.1.1\` if you want one, or point at the repository with \`lib_deps = https://github.com/virgilvox/bellowsjs.git\` to take \`main\`.

The \`build_unflags\` line is not optional. The PlatformIO Teensy platform still defaults to \`gnu++14\` on some releases, and this library needs C++17 for inline \`constexpr\` variables. Setting \`build_flags\` alone leaves both standards on the command line and the last one wins.

Two more traps on that platform. \`board_build.usb_type\` is silently ignored, so put \`-D USB_MIDI_SERIAL\` in \`build_flags\` if you want MIDI. And if you are building for a Daisy Seed, libDaisy pins \`CPP_STANDARD ?= -std=gnu++14\` in its own makefile, which you have to override for the same reason.

## Install under the Arduino IDE

It is in the Library Manager. Sketch, Include Library, Manage Libraries, search for \`Bellows\`, install. On the command line that is \`arduino-cli lib install Bellows\`. The examples then appear under File, Examples, Bellows.

**Include \`<Bellows.h>\` first**, before any \`<bellows/...>\` header. The Arduino builder works out which libraries a sketch needs by matching include names, and a nested path on its own does not name this library, so the include path never gets set and the build fails on the first header. Every example here got that wrong until 2026-08-16 and none of them compiled once installed; PlatformIO passes an include path that hides it.

The IDE does not expose the language standard anywhere in its interface, so set it in a file: put a \`platform.local.txt\` beside your platform's \`platform.txt\` containing

\`\`\`
compiler.cpp.extra_flags=-std=gnu++17
\`\`\`

Without it the build fails inside a header on an inline \`constexpr\`, which reads like a library bug and is not one.

## Which header to include

\`Bellows.h\` pulls in every module and costs nothing in flash. Measured on Cortex-M7 at \`-Os\`, one kick voice and nothing else:

| include | flash | RAM |
| --- | --- | --- |
| \`bellows/engines/drums.h\` | 3760 B | 1100 B |
| \`Bellows.h\` | 3760 B | 1100 B |

Byte for byte identical, because every class is a template or an inline function in a header and the linker drops what the program never names.

What the umbrella costs is compile time, on every build, forever. A euclidean pattern needs 366 preprocessed lines from \`bellows/seq/euclid.h\` and 23167 from \`Bellows.h\`, which measured 0.07 s against 0.21 s for one translation unit. Include what you use.

## The smallest sketch that makes a sound

A Teensy 4.x with an audio shield stacked on it, or with an I2S breakout wired as [Output and wiring](/docs/emb-output) describes. One kick drum, twice a second.

\`\`\`cpp
#include <Audio.h>

#include "bellows/platform/teensy.h"
#include "bellows/engines/drums.h"

static bellows::Kick kick;

/* A render is any callable with the library's block signature. */
struct Patch {
  void operator()(float* l, float* r, int from, int to) {
    kick.Process(l, r, from, to);
  }
};

static Patch patch;
static bellows::BellowsAudioStream<Patch> node(patch);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  codec.enable();
  codec.volume(0.5f);

  /* Take the rate from the audio library, not from a literal. */
  kick.Init(bellows::TeensySampleRate());

  /* AudioMemory LAST. This ordering is load bearing. */
  AudioMemory(12);
}

void loop() {
  kick.NoteOn(50.0f, 0.9f);
  delay(500);
}
\`\`\`

Four things in there are the whole contract, and [Program shape](/docs/emb-program-shape) is the page that explains each: the render signature, taking the rate from the SDK, \`Init\` rather than a constructor, and calling \`AudioMemory\` after everything else in \`setup()\`.

Drop the \`AudioControlSGTL5000\` lines if you are using an I2S breakout instead of the shield. Those parts have no control interface, so there is nothing to enable and no volume to set.

## Build it and flash it

With PlatformIO, from \`packages/bellows-embedded/examples\`:

\`\`\`
PLATFORMIO_SRC_DIR=01_OneKick pio run -e teensy41 -t upload
\`\`\`

Or with PJRC's command line loader, which tells you what it actually did:

\`\`\`
teensy_loader_cli --mcu=TEENSY40 -w -v firmware.hex
\`\`\`

\`-w\` waits for the board, so press the program button and it fires. Watch for \`Found HalfKay Bootloader\` followed by \`Programming\` and \`Booting\`. A loader that only says it opened the device is not a loader that programmed anything, and a board sitting in the bootloader enumerates with product id \`0x0478\` rather than as a serial port.

If a board makes no sound at all, run \`00_BringUp\` before suspecting a patch. It prints the real sample rate, sustains an A440 you can check against a tuner, and reports CPU load and dropouts per stage.

## Where to go next

[Program shape](/docs/emb-program-shape) is the shape of every sketch here and the ordering rule that costs an evening if you get it wrong. [Output and wiring](/docs/emb-output) has the exact pins for each way of getting sound out. The [EMBEDDED PLAYGROUND](/#sim) runs these examples in the browser, so you can hear an output path before you buy the parts for it.
`,
};

export default page;
