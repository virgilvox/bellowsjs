import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-output',
  title: 'Output and wiring',
  blurb: 'Every way of getting sound out of a board, with the exact pins, the parts, and what each one costs in quality.',
  prev: 'emb-program-shape',
  next: 'emb-engines',
  body: `
\`bellows\` renders float audio into a block. Everything on this page is what happens after that, which is the Teensy Audio Library's problem rather than this library's, and is also the part that stops people. The library half is one line in every one of these sketches:

\`\`\`cpp
bellows::BellowsAudioStream<MyPatch> node(patch);
\`\`\`

Everything below is the converter. The examples \`10\` through \`15\` are one sketch per path, and they share one patch (\`10_AudioShield/audioshield.h\`) so that comparing them compares converters rather than programs.

## Pick one

| you have | example | parts | what you get |
| --- | --- | --- | --- |
| the Teensy Audio Shield | \`10_AudioShield\` | the shield | 16 bit stereo, headphone amp and line out |
| three dollars and a speaker | \`11_I2SAmp\` | MAX98357A breakout | 16 bit, amplifier included, mono |
| three dollars and a stereo | \`11_I2SAmp\` | PCM5102A or UDA1334A | 16 bit stereo line out |
| a Teensy 3.x and nothing else | \`12_DacOut\` | one capacitor | 12 bit, the built-in DAC |
| a Teensy 4.x and nothing else | \`13_BareOutput\` | 2 resistors, 2 caps per channel | MQS, better than it sounds |
| any Teensy and nothing else | \`13_BareOutput\` | 2 resistors, 2 caps per channel | PWM on 3.x, noisier |
| a piezo disc | \`15_Piezo\` | the disc, no other parts | loud, thin, no bass at all |

If you are buying something, buy the I2S breakout. It removes every analog question at once, and the amplifier versions drive a speaker with no further parts.

## The pins are not a choice

The audio library owns them, and they differ by generation. Do not pick your own.

| path | Teensy 4.0, 4.1, MicroMod | Teensy 3.2, 3.5, 3.6 |
| --- | --- | --- |
| I2S data (OUT1A / TX) | pin 7 | pin 22 |
| I2S bit clock (BCLK) | pin 21 | pin 9 |
| I2S word clock (LRCLK) | pin 20 | pin 23 |
| MQS | pins 10 and 12 | not available |
| PWM | not used for audio | pins 6 and 9 |
| built-in DAC | none, at all | A14 on 3.2, A21 and A22 on 3.5 and 3.6 |

Teensy 4.x has no digital to analogue converter: it was dropped when the part changed from Kinetis to i.MX RT, and there is no pin to move the wire to and no library setting that brings it back. \`12_DacOut\` says so with an \`#error\` rather than failing deep inside a header.

## The audio shield

The reference path. A real 16 bit stereo codec with a headphone amplifier and a line output, so what you hear is the library rather than the driver.

| from | to |
| --- | --- |
| stack the shield on the board | no loose wires at all |
| pins 7, 21, 20 (4.x) or 22, 9, 23 (3.x) | I2S to the SGTL5000, used by the shield |
| pins 18, 19 | I2C control, used by the shield |
| headphones | the shield jack |

Buy the revision sold for your board: Rev D is the 3.x shield, and the Teensy 4.x shield differs.

The shield also claims pins 6, 7, 9, 10, 11, 12, 13, 15, 18, 19, 20, 21, 22 and 23 for SD and memory. Check that list before you use one of them for a button.

\`codec.volume()\` drives the headphone amplifier, not the DAC. Leave it near 0.5 and change the level in the patch instead: turning the headphone amp up to compensate for a quiet render amplifies the codec's noise floor along with the music.

## An I2S DAC breakout, for line out

A PCM5102A or a UDA1334A. No control interface, so there is no codec object, no I2C, and nothing to enable: \`AudioOutputI2S\` clocks samples out and the breakout converts them. The level in the patch is the level you get.

| from | to |
| --- | --- |
| pin 7 (pin 22 on 3.x) | DIN / DATA |
| pin 21 (pin 9 on 3.x) | BCK / BCLK / SCK |
| pin 20 (pin 23 on 3.x) | LRCK / LRC / WS |
| 3.3V | VIN |
| GND | GND |
| line out on the breakout | amplifier or powered speakers |

A line-level DAC draws almost nothing, so 3.3V is fine here. An amplifier breakout is a different question.

## An I2S amplifier, MAX98357A

Same three wires, plus a speaker and one thing that bites.

| from | to |
| --- | --- |
| pin 7 (pin 22 on 3.x) | DIN |
| pin 21 (pin 9 on 3.x) | BCLK |
| pin 20 (pin 23 on 3.x) | LRC |
| 5V (the VIN pin) | VIN |
| GND | GND |
| nothing | SD and GAIN, both left floating |
| speaker, 4 or 8 ohm | across + and -, never one side to ground |

Power it from 5V, not from the Teensy's 3.3V regulator. It is a 3W amplifier, and browning that regulator out does not look like a power problem: it looks like the audio glitching on loud notes, and you will spend an hour blaming the DSP.

It is a mono amplifier. With SD_MODE left floating it averages left and right, which is usually what you want. If you tie SD_MODE for left-only, a patch that pans anywhere but centre sounds wrong for a reason that is not in your code.

## The built-in DAC, Teensy 3.x only

One wire and one capacitor.

| from | to |
| --- | --- |
| A14 (3.2, mono), or A21 and A22 (3.5, 3.6, stereo) | + side of a 10uF capacitor |
| - side of the capacitor | amplifier or powered speaker input |
| GND | amplifier ground |

The capacitor is not optional and its polarity matters. The DAC idles at half its reference rather than at zero, so a direct connection feeds about 1.6 V of DC into whatever you plugged in. Into a small speaker that is a constant current through the coil; into a line input it is merely wrong.

What you give up is 12 bits against 16 through a codec, which is a noise floor about 24 dB higher and audible as hiss in quiet passages. It is the right trade for a prototype or an alarm and the wrong one for a reverb tail.

## MQS or PWM, into an RC network

For a board with nothing on it. Teensy 4.x uses MQS on pins 10 and 12: a sigma-delta modulator in the flexIO hardware, with the audio at full rate and the quantisation noise pushed above the band, which is why a plain RC filter recovers it cleanly. Teensy 3.x uses PWM on pins 6 and 9, the same idea more crudely: the noise is not shaped, so the filter matters more and the result is noisier. If a 3.x board has a DAC pin free, use it instead.

Per channel:

\`\`\`
pin ---[ 470R ]---+---[ 470R ]---+--- output
                  |              |
               100nF          100nF
                  |              |
                 GND            GND
\`\`\`

Two RC sections, not one. A single 470R and 100nF corner sits at 3.4 kHz, inside the audio band and audibly dull, and one pole leaves a lot of carrier behind. Two gentler sections roll off faster above the band while staying flatter inside it. This is the network Paul Stoffregen documents for \`AudioOutputPWM\` and it is the one to copy.

Headphones straight on the output work and are not kind to the pin: 32 ohm headphones through 940 ohms of series resistance is a heavy divider. It is fine for checking that a patch makes the right noise. For listening, put an amplifier after the filter.

## A piezo disc

The cheapest way to make a board audible, and the one where the naive wiring wastes most of what you have.

| from | to |
| --- | --- |
| pin 10 (4.x), pin 6 (3.x) | one side of the disc |
| pin 12 (4.x), pin 9 (3.x) | the other side of the disc |
| no resistor, no capacitor | a piezo is already a capacitor |

Across the two pins, not from one pin to ground. The firmware renders the signal on one channel and its exact inverse on the other, so the disc sees both pins swinging in opposite directions: 6.6 V peak to peak instead of 3.3. That is 6 dB, it costs nothing, and it is more than everything else on this page put together. Wiring it to ground works and is 6 dB quieter.

A disc is not a small speaker. It is a capacitor, 10 to 20 nF for a 27 mm brass one, bonded to a metal plate with a sharp mechanical resonance somewhere between 2 and 6 kHz, and it moves almost no air anywhere else. \`15_Piezo/piezo.h\` is the chain that suits a render to that, and it wraps any bellows render rather than replacing it:

\`\`\`cpp
static Source source;                             /* any render */
static piezo::Voiced<Source> voiced(source);
static bellows::BellowsAudioStream<piezo::Voiced<Source>> node(voiced);

void setup() {
  const float sr = bellows::TeensySampleRate();
  source.Init(sr);

  piezo::Voicing v;
  v.resonance_hz = 4000.0f;   /* measure yours with the sketch's sweep mode */
  v.drive = 4.0f;             /* 12 dB. The default of 1.0 changes nothing: see below */
  voiced.Init(sr, v);

  AudioMemory(12);
}
\`\`\`

| field | default | what it does |
| --- | --- | --- |
| \`highpass_hz\` | 1200.0 | two cascaded highpasses, 24 dB per octave. Everything below this is thrown away |
| \`resonance_hz\` | 4000.0 | the disc's mechanical resonance |
| \`resonance_db\` | 8.0 | how hard to lean on it |
| \`resonance_q\` | 1.2 | how narrow that lean is |
| \`drive\` | 1.0 | gain after the filtering and before the limiter |
| \`ceiling_db\` | -0.5 | just under full scale, because the pin clips hard and squarely |
| \`release\` | 0.02 | limiter release, in seconds |

### Why the chain needs the drive control

The filtering is subtractive, and on a full-range patch it removes most of the energy. Measured on \`07_Workstation\`, whose kick sits at 50 Hz and whose bass runs 110 to 262 Hz: the chain took the render from -19.5 dBFS RMS to -32.9, and the peak reached 0.658 against a ceiling of 0.944, so the limiter never engaged once and the disc saw a third of the swing it could have had.

There is no headroom to protect on a piezo. The swing is fixed by the supply and anything above it clips at the pin regardless, so the useful move is to raise the average until it sits just under the ceiling all the time. \`drive\` is the control that does it, and it was worth 12 dB. For comparison, transposing the same piece up to get it into the disc's band, which sounds like the obvious fix, measured 1.1 dB quieter at one octave and 2.2 dB quieter at two, because a plucked string carries less energy and decays faster the higher it is pitched.

Two more things help. Glue the disc to something: one lying loose moves almost nothing, and the same disc on a tin lid or a stretched membrane is dramatically louder and drops its resonance, which you then want to re-measure (\`15_Piezo\` has a sweep mode that steps a tone from 800 Hz to 8 kHz for exactly that). And write piezo patches an octave or two above where they would sit on a speaker, because a piezo has no bass and no processing invents any: a bass line through one is heard through its harmonics.

### What the voicing costs

Cortex-M7 at \`-Os\` with \`--gc-sections\`, library only, four voices with a 20 Hz floor:

| sketch | flash | RAM |
| --- | --- | --- |
| the shared patch | 6816 B | 116860 B |
| plus the piezo voicing | 13976 B | 122156 B |

So two cascaded highpasses, a bell and a true-peak limiter cost 7144 B of flash and 5292 B of RAM on top of the patch they voice. Almost all of that RAM is the limiter's lookahead.

## What "it builds" means here

Every board and example combination was compiled and linked as real firmware, including the Arduino core and the audio library rather than the DSP alone. Only \`07_Workstation\` on a Teensy 4.0 through an I2S amplifier has been flashed and listened to. Nothing in the output examples has, and the piezo reasoning above is engineering about a capacitive transducer rather than a measurement: the dBFS figures were measured on the rendered signal, not on a disc, and nobody has held a meter to one driven by this code.

The [EMBEDDED PLAYGROUND](/#sim) will play each of these paths in the browser, so you can hear the difference between them before buying the parts. Run \`00_BringUp\` on any board you have in hand: it prints the real sample rate, sustains an A440 you can check against a tuner, and reports CPU load and dropouts per stage.

## Where to go next

[Engines](/docs/emb-engines) is what to put through the output you just wired.
`,
};

export default page;
