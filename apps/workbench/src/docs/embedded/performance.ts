import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-performance',
  title: 'Performance',
  blurb: 'Flash and RAM per program, the fast-math flag, why the delay line is the RAM, and the one CPU figure that was measured.',
  prev: 'emb-theory',
  next: null,
  body: `
Two of the three numbers you want are measured well. The third barely exists.

Flash and RAM come from the linker, per example, reproducibly. CPU has been measured exactly once, on one board, running one program. This page keeps those apart on purpose, because a size table that reads like a performance table is how "it fits" turns into "it runs" without anyone deciding that it does.

## Flash and RAM, per example

Cortex-M7 at \`-Os\` with \`--gc-sections\`, library only: no Arduino core and no audio library, so these are the bellows half of a binary and nothing else.

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

Reproduce them with \`./tools/size-report.sh\`, rows \`p4_\` through \`p8_\` and \`p11_\` through \`p13_\`. \`node tools/check-docs.mjs --check\` reads those eight rows back and compares them against the repository's own documents, because four of the first five had drifted before it existed.

Every number on this page was copied from a document that checker does reach. The checker does not reach this page, so if you are deciding something on one of these figures, rerun the script rather than trusting the copy.

Three of these are worth reading rather than skimming.

**02, 03 and 05 all sit near 30 KB** because each reaches \`BlepOsc\`, whose band-limited step tables are about 16 KB and are paid once no matter how many voices read them. That is also why \`20_Instruments\` reaches eight engines for 47912 B rather than eight times a single engine's cost.

**04 is 8096 B of flash** because a plucked string needs no such table, and its 30176 B of RAM is the delay line that IS the string.

**07 is the outlier in both columns, for two different reasons.** Its 41992 B of flash is what reaching almost everything costs: drums, a VA, a plucked string, a delay, an EQ, a limiter, plus the theory and sequencing layers, in one program. Its 225508 B of RAM is one object, a 500 ms stereo delay line at 187 KB. Everything else in it, four strings, the chain, the patterns and the send scratch, comes to under 40 KB together.

Per module, for sizing your own program:

| module | flash | RAM |
| --- | --- | --- |
| \`theory/\` (scales, chords, tuning, notes) | 2624 B | 116 B |
| \`fx/dynamics\` | 3928 B | 10016 B |
| \`engines/tube\` | 5096 B | 2460 B |
| \`seq/\` (euclid, arp, CA, lsystem, tempomap) | 5296 B | 900 B |
| \`engines/fm\` | 5384 B | 1536 B |
| \`fx/plate\` | 5824 B | 156736 B |
| \`engines/modal\` | 5944 B | 1584 B |
| \`kernel\` | 6208 B | 2492 B |
| \`engines/westcoast\` | 17656 B | 2564 B |
| \`engines/formant\` | 28368 B | 1504 B |

The theory row is the one to notice: scales, chords, tunings and note parsing together are 2.6 KB of flash and 116 bytes of RAM. The differentiator is nearly free.

## BELLOWS_FAST_MATH

\`\`\`
-D BELLOWS_FAST_MATH=1
\`\`\`

Off by default. On, it swaps newlib's transcendentals for polynomial approximations in \`core/fastmath.h\`. Everything in the library calls through \`bellows::fm::\`, so the flag switches all of it at once.

Measured, Cortex-M7:

| sketch | default | with the flag | saved |
| --- | --- | --- | --- |
| \`s1_kick\` | 3760 B | 936 B | 75 % |
| \`s3_pluck\` | 6728 B | 2468 B | 63 % |
| \`s9g_tube\` | 5096 B | 3124 B | 38 % |
| \`p1_drums\` | 20808 B | 12884 B | 38 % |
| \`s9e_westcoast\` | 17656 B | 12088 B | 31 % |
| \`s4_va\` | 28640 B | 20728 B | 27 % |
| \`p2_poly8\` | 31136 B | 22800 B | 26 % |
| \`s5_all\` | 35096 B | 26176 B | 25 % |
| \`s9m_seq\` | 5296 B | 5296 B | 0 % |

The last row is 0 percent and should be. Sequencing is integer and small-float work over \`const\` tables and calls no transcendental at all, so there is nothing for the flag to replace.

The arithmetic behind the rest: \`sinf + cosf + tanhf + powf + expf\` from newlib is 5056 B, and the polynomial equivalents are 196 B. Twenty-five times smaller, about 4.9 KB recovered, and considerably faster. Argument reduction is a large part of it: \`__kernel_rem_pio2f\` alone is 1624 bytes and \`powf\` 800, both removed outright.

### What it costs

Accuracy, and not bit-identity with the browser. That is why the default is off: exact libm keeps renders closer to the JS.

It is also the most dangerous flag in the tree, and the reason is worth stating plainly rather than as a caution. The first draft of \`core/fastmath.h\` shipped a minimax cubic for \`Log2\` that was wrong by 0.302 across the mantissa range. \`log2(1.5)\` returned 0.407 instead of 0.585, a 213 cent pitch error, and since \`Pow\` is \`Exp2(Log2(b) * e)\` every \`Pow\` in the library inherited it. It moved a formant frequency by 6.5 percent and a modal strike duration by 8 percent. Nothing caught it, because a wrong polynomial still compiles, still runs fast, and still makes sound.

So \`test/parity/fastmath_test.cpp\` exists and runs in CI. It measures every function against libm over the domain the DSP actually drives, and fails on regression:

| function | measured | gate |
| --- | --- | --- |
| \`Sin\`, \`Cos\` | 3.6e-6 abs | 2e-5 |
| \`Tanh\` | 9.6e-5 abs | 1e-4 |
| \`Exp2\` | 1.7e-5 abs | 1e-4 |
| \`Log2\` | 1.9e-6 abs | 1e-5 |
| \`Pow\` | 1.4e-5 rel | 5e-4 |
| \`Log\` | 1.9e-6 abs | 1e-5 |
| \`Tan\` | 3.1e-4 abs | 2e-3 |
| \`Atan2\` | 1.2e-5 abs | 1.2e-4 |
| \`CentsRatio\` | 0.015 cents | 0.15 cents |

The pitch helper is gated in cents on purpose, because that is the only unit in which "is this good enough" has an answer. Run \`npm run fastmath\` after touching any approximation.

One gate argued back and is worth knowing about if you write your own approximation. \`Atan2\` is called once per note in \`engines/pluck.h\`, to turn the loop filter's phase shift into a fractional delay length. The obvious cheap version, the Hastings cubic, measures 1.5e-3 radians and looks fine. Pluck then divides the result by \`w = 2 pi f / sr\`, so the angular error is amplified by \`1 / w\` and 1.5e-3 radians becomes 0.58 samples of loop length at a 20 Hz fundamental, an audible detune on the lowest notes. The seventh-order odd polynomial costs four more multiply-adds, measures 1.2e-5 radians, and lands at 0.003 cents of pitch at every fundamental.

## The delay line is the RAM

Flash has never been the binding constraint on either supported target. RAM has, and it is almost always one object.

Buffer bytes for the two lines of a stereo delay at 48 kHz. The middle column is what power-of-two rounding used to reserve, before buffers were sized exactly:

| configuration | was (rounded up) | now (exact) |
| --- | --- | --- |
| \`StereoDelay<100>\` | 65536 B | 38432 B |
| \`StereoDelay<250>\` | 131072 B | 96032 B |
| \`StereoDelay<500>\` | 262144 B | 192032 B |
| \`StereoDelay<4000>\`, the JS maximum | overflows 1 MB by 1049728 B | still overflows, by 488608 B |

Exact sizing took about 25 percent off RAM library-wide with bit-identical output. It did not change the shape of the problem: a 4 second stereo delay wants 2.0 MB and no microcontroller in the tier list has that internally.

The same knob exists on the physical models, where the loop length is the lowest note you can play. \`Pluck<20>\` reserves for a 20 Hz fundamental and costs 29988 B; \`Pluck<80>\` costs 8388 B. Eight-voice polyphony is the difference between about 240 KB and about 67 KB, so the floor is a real design decision and not a default to leave alone. \`07_Workstation\` uses \`Pluck<110>\`, two octaves below its lowest note.

### DelayLineExt, and where the buffer actually lives

\`\`\`cpp
// Teensy 4.1, external PSRAM
EXTMEM float delay_buf[kDelaySamples];

bellows::DelayLineExt line;
line.Init(delay_buf, kDelaySamples);
\`\`\`

\`DelayLineExt\` takes caller-provided storage, and it does so precisely so that placement is the application's choice rather than the library's: \`DMAMEM\` or \`EXTMEM\` on Teensy, \`DSY_SDRAM_BSS\` on Daisy. \`cap\` is exact and no longer has to be a power of two.

The arithmetic is worth having in front of you before optimising anything:

| | flash | SRAM |
| --- | --- | --- |
| \`s5_all\`, buffers in internal SRAM | 35096 B | 223324 B, 43 % of a Daisy Seed |
| \`s5_all\`, buffers placed externally | 35096 B | about 31 KB, 6 % of a Daisy Seed |

A Daisy Seed has 64 MB of SDRAM and a Teensy 4.1 takes soldered PSRAM to 16 MB, so on either board the whole ported engine set costs about 31 KB of the scarce memory once the buffers move. "RAM is 43 percent" describes one placement choice, not a property of the library.

Two cautions on that escape hatch. A delay line reads once PER SAMPLE, so external memory latency is not free: Daisy's SDRAM sits behind an H7 cache, and that result should not be assumed to carry to a part whose external memory is weaker. And not every board has external memory at all, which is why \`int16\` delay storage is still the largest lever left on the only number that has ever been tight.

## Double precision

The TypeScript uses \`Float64Array\` in more places than is obvious: FFT twiddles, the additive engine's phase and decay state, the harmonic engine, the waveguide body-mode coefficients, the frequency shifter's biquad state, the FDN and plate tables, and the BLEP tables themselves. On Cortex-M7 that is all free. Elsewhere it is not.

Same 64-tap recursion, \`float\` state against \`double\` state:

| target | float | double | penalty |
| --- | --- | --- | --- |
| Cortex-M7 fpv5-d16 (Teensy 4.1, Daisy) | 332 B | 356 B | 1.07x |
| Cortex-M4 fpv4-sp-d16 (single-precision FPU) | 332 B | 2020 B | 6.08x |
| Cortex-M0+ no FPU (RP2040) | 2080 B | 4772 B | 2.29x |

**6.08x on a single-precision FPU** is the number to carry around. On such a part every double operation becomes a soft-float call, and the code to make those calls is what the 2020 bytes are.

That splits the library's doubles into two categories. The tempo map and the theory math are \`double\` deliberately, to keep event timing bit-identical to the browser, and they run at control rate where six times almost nothing is still almost nothing. \`BELLOWS_TEMPO_SCALAR=float\` is there if you want it anyway. But \`additive\` and \`harmonic\` use double phase accumulators at audio rate and must not be ported to a single-precision part without rework. They are unported today, so this is a constraint on future work rather than a present defect.

Every ESP32 is single precision, and RP2350's M33 is the single-precision case too, so the M4 row is the right proxy for both.

## CPU: one board, one program, once

This is the whole of what has been measured on hardware.

**A Teensy 4.0 at 600 MHz, running \`07_Workstation\` at 44.1 kHz through a MAX98357A on I2S:**

| | |
| --- | --- |
| CPU, across 19 samples | 33.8 to 46.5 % |
| CPU, running maximum | 47.3 % |
| audio memory used | 2 blocks of 24 |

\`07_Workstation\` is the heaviest program in the set: five engines, a Markov melody, a tempo-synced delay send, an EQ and a limiter, all at once. It runs with about half the processor spare.

These figures were hand-recorded from a serial console. No harness prints them, so \`check-docs\` cannot verify them the way it verifies the size tables above.

It has been run twice, on two builds and two arrangements, and the numbers above are the second run. The first read 34 to 43 percent with a 47.2 percent maximum, so the earlier upper bound was low: typical and peak sit barely a point apart, and this program's cost is flatter than two numbers suggest. "Running maximum" is literal, \`AudioProcessorUsageMax\` never resets, so it is the highest value seen in about a minute rather than a bound.

**What that does not settle:**

- **No other board has run anything.** A Teensy 3.2 and an LC have no floating point unit and emulate every float operation in software; whether they keep up is unknown. A Daisy Seed has been linked to a complete firmware image and never run.
- **No other program has been measured.** One patch on one board is one data point. The output examples, the instrument set and the polysynth are all compile-verified and link-verified only.
- **Nothing has been compared by ear.** The numerical comparison against the TypeScript, 41 engine and effect rows plus 428 exactly-compared value rows, stands in for that and is not the same thing.

A build matrix proves that code is valid for a part and fits in its memory. It says nothing about keeping up. Every cell of the board table in [On hardware](/docs/on-hardware) is a link, not a run.

### What will decide it, when someone measures

One durable fact here is arithmetic rather than measurement, so it is worth stating and worth labelling as such. The BLEP residual walks \`2 * KERNEL_HALF * dt\` edges per sample: 0.32 at A440 and 5.1 at 7040 Hz. A high lead therefore costs several times a bass note.

So the interesting measurement is polyphony at the TOP of the keyboard, not at A440, and that is exactly what the last two stages of \`00_BringUp\` are for. It is the one thing no test in this repository covers.
`,
};

export default page;
