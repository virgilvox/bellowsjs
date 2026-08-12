# AUDIT 3

Whole-repository audit, 2026-08-11, at commit 59a5093. Companion to `docs/AUDIT.md` and
`docs/AUDIT-2.md`.

Unlike audit 2, this pass was run by one reader with instruments rather than by a fleet of
agents, and it leans on measurement wherever measurement was available: a heap probe for the
allocation rule, an FFT sweep for the alias claim, forty mutations run against the whole
suite, and a render-and-diff for every mutant that survived. Where a finding rests on reading
rather than on a number, it says so.

Round one found mostly missing gates around code that was right, plus one wrong number on the
front page of the npm listing. Round two instrumented what round one had only read, and that
turned up the one thing here that was actually broken in the shipped product: `b.rotate` was
the array function in the published package and the pattern combinator on bellows.live,
because two modules exported the name and the two builds resolved it differently.

Three of round two's findings came from catching this audit's own instruments lying. A worklet
harness froze the context clock and two of its tests passed anyway; a module-cache hit reported
0 of 96 signals differing when the real answer was 22; and a botched edit deleted a regex
declaration, so a "killed" verdict was really a ReferenceError. Each is recorded where it
happened, because the same failure in a gate is what this document is about.

## Status

Two rounds. The first raised 13 findings and fixed 5. The second went back over
everything the first pass had not instrumented, and found that two of the remaining
findings were hiding a shipped divergence: `b.rotate` was a different function in the
published package than on bellows.live. Everything is fixed now.

| # | What | State |
| --- | --- | --- |
| 1 | README alias claim | fixed in 4 places, measured |
| 2 | Event placement not gated | 2 tests, kills round to floor and to ceil |
| 3 | BS.1770 gate thresholds not gated | 2 tests, kills all four one-step moves |
| 4 | Sampler interpolator not gated | 2 tests, kills all three tap misalignments |
| 5 | `lsystem.h` not compared | 30 parity rows, kills 2 rewrite mutations |
| 6 | Site and package are different artefacts | artefact gated by test instead, measured why |
| 7 | `vue-tsc` installed and never run | in the build script, in CI, and its own script |
| 8 | `src/index.ts` imported by no test | `package.test.ts`, 14 tests |
| 9 | `core/register.ts` imports upward | moved to `src/register.ts`, `layering.test.ts` gates it |
| 10 | Input ceilings on SFZ only | MIDI and WAV capped from measurement, SF2 measured |
| 11 | MIDI denominator can be negative | fixed, 4 tests |
| 12 | Eight dev-tooling advisories | vitest 4, zero advisories, build byte-identical |
| 13 | `splice` on the audio thread | `copyWithin` and a length assignment |
| 14 | `rotate` is two different functions | **found in round two**, fixed, gated both ways |
| 15 | Realtime never compared to offline | **found in round two**, now bit-exact, 9 tests |
| 16 | Shelf corner frequency not gated | **found in round two**, 2 tests, an octave of error |
| 17 | Six analysis constants not gated | **found in round two**, 6 tests, both sides each |
| 18 | `yin(buf, sr, NaN)` goes deaf silently | **found in round two**, fixed |

The suite went from 1273 tests in 85 files to 1330 in 88, and the value-parity harness
from 318 rows to 348. `npm audit` went from 8 advisories to none.

## What was measured, and what came back clean

These are stated because a "no finding" that nobody measured is worth nothing.

| Property | Instrument | Result |
| --- | --- | --- |
| No allocation on the audio path at steady state | `--expose-gc` heap delta over 20000 blocks, 18 engines, 22 voices, all 24 effects on master | -0.065 bytes per block |
| Worklet generated string matches source | `npm run gen:worklet` then `git diff` | no diff |
| No em dashes, no emoji, no `Math.random` in library code | tracked-file scan | clean |
| Public entry point resolves and is whole | import the built bundle by package name | 218 exports, none undefined |
| `sideEffects: false` is honest | top-level statement scan of `src` | only `worklet-entry.ts`, which is not in the package graph |
| Every preset resolves | all 50 checked against the live registry | 0 unknown engines, 0 unknown params, 0 out of range |
| Workbench respects the library boundary | import scan of `apps/workbench/src` | 44 imports, all from the package root, none into internals |
| Embedded value parity | `npm run tables:check` | 318 rows, 0 mismatched (348 after finding 5) |
| Embedded fast-math accuracy | `npm run fastmath` | all gates pass |
| Embedded memory safety | `npm run memsafety` (ASan and UBSan) | no report across 8 rates |
| Every ported C++ engine and effect has a parity row | header list against `GATES` | complete; Phaser and Transient are absent from the port, so their absence from parity is not a gap |
| Suite strength | 25 hand-written mutations, whole suite per mutant | 17 killed, 3 proved equivalent by render-and-diff, 4 real gaps, 1 harness artefact |

The mutation score is good. Twenty of twenty-four meaningful mutants died, including every
one aimed at the PRNG, the tuning tables, the WAV bit-depth conversions, the MIDI tempo and
time-signature decode, the sampler loop wrap, the sample-rate conversion, and the BLAMP
trapezoid whose absence was the subject of an earlier fix. The four that lived are below.

## Findings

### 1. The README overstates the oscillator's alias rejection by 16 dB

`README.md:118`

The line reads "tabulated-BLEP oscillators measuring around -90 dB worst alias". Measured
here across the band at 44100 Hz, 16384 samples, worst single alias component relative to
the fundamental:

```
     hz       saw    square  triangle
    110    -103.2    -103.2    -103.5
    440     -94.0     -94.0     -94.2
   3520     -85.5     -85.5     -98.0
   9000     -81.0     -81.0     -90.5
  13000     -77.0     -90.7     -93.3
  19000     -73.5     -83.7     -77.3
```

Worst across the band: **-73.5 dB**, saw at 19 kHz. Worst at or below the top of a piano
(4186 Hz): -85.5 dB. Around -90 dB is a fair description of the typical figure and of the
musical range; it is not the worst, and "worst" is the word the sentence uses. The repository's
own gate table in `test/dsp-osc/blep-frequency.test.ts` already carries the shape of this: it
gates the 19 kHz saw at -63 dB, 27 dB below what the README promises.

This is the front page of the npm listing, and it is the one claim in this audit that is
straightforwardly wrong rather than merely ungated.

**Fixed.** The sentence now reads "worst alias measured at -85 dB through the musical range
and -73 dB at the top of the band" in `README.md`, in `packages/bellows/README.md` (the one
npm actually ships), and, in its own wording, on the landing page of the workbench.
`docs/HANDOFF.md` carried the same "-90 dB" and now carries the measurement plus a pointer to
the file that gates it.

### 2. Sample-accurate event placement is gated by nothing

`packages/bellows/src/kernel/engine.ts:556`

`let f = Math.round(e.time * this.sampleRate) - blockStart;` changed to `Math.floor` passes
all 1273 tests. Confirmed to be a real behaviour change, not an equivalent mutant, by
rendering 60 blocks with 41 events at fractional sample positions through both variants and
diffing the float32 output: they differ.

The behaviour today is correct and observable in three lines. A note-on placed at sample
10.2 first sounds at sample 10; at 10.5 it first sounds at 11:

```
event at sample 10.2 -> first non-zero output sample 10
event at sample 10.5 -> first non-zero output sample 11
event at sample 10.8 -> first non-zero output sample 11
```

CLAUDE.md names this property as the reason voices take `(l, r, from, to)` ranges at all:
"so the kernel can split blocks at event boundaries for sample accuracy". The golden render
cannot see it, because its events sit on exact sample boundaries where round and floor agree.

Three other mutants in the same loop survived and are **not** findings. Each was checked the
same way and produced bit-identical output:

- `if (f < from) f = from;` to `f = 0`. `f` is only read by `if (f > from)`, and both values
  fail that test whenever the guard fires.
- `e.time >= blockEndTime` to `>`. An event pulled one block early is applied at
  `blockStart + N`, which is the same frame the next block would have applied it at, after
  the same audio has been rendered.
- `this.eventHead > 256` to `> 2`. Compaction cadence, no effect on output.

**Fixed.** Two tests in `test/kernel/engine.test.ts`: one asserts the sample a note first
sounds on for six offsets across a sample boundary, the other places five events at five
fractional positions inside one block and asserts every edge. Verified: round to floor now
fails 2 tests, round to ceil fails 3.

The exact half-way case is deliberately not asserted. Events carry seconds, so reaching it
needs `frames / sr * sr` to land back on .5, and at 48000 it does not: 200.5 round trips to
200.49999999999997. Gating that would gate the round trip's luck at one sample rate.

### 3. The two BS.1770 gating thresholds are gated by nothing

`packages/bellows/src/analysis/loudness.ts:128-129`

`ABS_GATE = -70` changed to `-60`, and `REL_GATE = -10` changed to `-8`, both pass the whole
suite. These are the two constants that define gated integrated loudness in the standard; the
README sells the meter as measured "against the BS.1770 reference points".

The test that names the constant cannot see it move:

```ts
it('absolute gate drops signals below -70 LUFS', () => {
  const buf = sine(997, SR, 2 * SR, 0.00001);
  expect(meterFor(buf).integrated()).toBe(-Infinity);
});
```

Amplitude 1e-5 is about -100 LUFS, so any threshold anywhere in a 100 dB window passes this.
The neighbouring test, "gating ignores long silent gaps", uses digital silence, which is
-Infinity and is dropped by every threshold.

This is the same vacuity pattern the parity harness already documented for itself and fixed:
"At the steady 0.25 input the row read 5.5e-8 and a 0.1 percent ceiling change did not move
it at all, because the limiter never engaged." The port learned it; the library has the same
shape of hole in the module whose correctness is defined entirely by two numbers.

**Fixed.** Two tests in `test/analysis/loudness.test.ts`, both set from measurement. The
absolute gate is pinned by a program at -68 LUFS that must read back its own level and one at
-71 that must read -Infinity. The relative gate is pinned by a two-level program whose quiet
part sits at -32 (inside the threshold, integrated -22.74) and at -33 (outside it, integrated
-20.16), 2.5 dB apart. Verified: -70 to -60, -70 to -80, -10 to -8 and -10 to -12 all fail
now, so both constants are gated from either side.

### 4. The sampler's interpolator tap alignment is gated by nothing

`packages/bellows/src/engines/sampler.ts:160`

In `readCubic`, `const y0 = data[i - 1 < 0 ? 0 : i - 1];` changed to read `data[i]` instead
of `data[i - 1]` passes the whole suite. That collapses `y0` onto `y1` and makes the
Catmull-Rom a different curve between every pair of samples.

The existing sampler tests cover loop wrap, loop crossfade, rate conversion, velocity layers
and round robins, all of which were killed by their own mutations. What none of them measures
is interpolation accuracy, and every pitched SF2, SFZ and WAV note in the library reads
through this function. The failure mode is added distortion on everything, not a broken
feature, which is exactly the kind that survives a feature-shaped test suite.

**Fixed.** Two black-box tests in `test/sampler/sampler.test.ts`, so they cover the rate
arithmetic and the read position as well as the four taps.

The first uses the fact that a Catmull-Rom with centred tangents reproduces a straight line
exactly: a ramp resampled at an irrational rate has to come back a ramp, measured as second
difference relative to step. Measured 7.5e-4 to 1.6e-3 (Float32 sample data, and the output
gain still smoothing at note start); either misalignment gives 2.7e-2 to 1.2e-1.

The second is the tighter one. The zone holds a pure sine, so the correct output at read
position p is exactly `sin(w * p)` and the sampler advances p by the rate every sample, which
makes the difference the interpolation error and nothing else. Measured 3.95e-6 relative;
either misalignment gives 4.64e-3, **1175 times** the measurement, so the gate at ten times
the measurement leaves the failures two orders of magnitude clear of it.

Verified: the y0, y2 and y3 tap mutations each fail 2 tests now.

### 5. `seq/lsystem.h` is ported and compared against nothing

`packages/bellows-embedded/src/bellows/seq/lsystem.h`

`test/parity/tables.cpp` includes euclid, arp, automata, tempomap, scales, chords, notes and
midi_parse, and diffs 318 rows of them against the TypeScript exactly. It does not include
lsystem. The header is real, is built by the `s9m_seq` size sketch, and is quoted in the size
tables, so it is carried and shipped without ever being compared to its source of truth.

The file's own header says why that matters: "A wrong euclidean pattern, scale table or chord
interval is silent in the sense that no audio test can hear it: the note that plays is
confident, plausible and wrong." An L-system rewrite that diverges is exactly that.

**Fixed.** 30 rows added to `test/parity/tables.cpp` and `tables.mjs`, taking the harness from
318 to 348, all matching on the first run. Five systems: algae (whose Fibonacci lengths only
appear if the rewrite is parallel), two rules that feed each other, symbols with no rule
passing through, an empty replacement erasing its symbol, and a Koch turtle string. Plus one
`MapToDegrees` row covering the rest sentinel and skipped structure.

Only the deterministic form is compared, following the convention the arp rows already set
("Random is excluded on both sides: it draws from an rng"). `Rng::Next()` rounds the uint32 to
float before scaling and the JS keeps it in double, so a weighted draw landing near a boundary
can pick different branches. That is the rounding the `fxin` rows in `parity.mjs` exist to
pin, and it belongs to the generator rather than to the L-system. Truncation is likewise not
asked: it is a C++-only behaviour with no JS counterpart, and `kMaxLen` is 512 here so nothing
reaches it.

Verified: rewriting in place instead of into the other buffer, and dropping the last character
of every replacement, each mismatch 25 of the 30 rows.

### 6. The workbench never builds against the package it demonstrates

`apps/workbench/vite.config.ts:8-11`

```ts
alias: {
  // dev runs against library source for instant feedback
  bellowsjs: fileURLToPath(new URL('../../packages/bellows/src/index.ts', import.meta.url)),
},
```

The comment says "dev". The alias is not scoped to a mode, so `vite build` uses it too. That
has three consequences:

- bellows.live serves a bundle built from `src`, not from `dist`. The deployed site and the
  npm package are different artefacts, and only npm consumers would find out if `dist` broke.
- The `exports` map, `scripts/postbuild.mjs`, the standalone IIFE and the emitted `.d.ts` are
  exercised by no automated consumer anywhere in the repository.
- The CI `workbench` job runs `npm run build -w packages/bellows` immediately before
  `npm run build -w apps/workbench`, and the second step discards the first step's output.

The library build is checked (the `library` job builds it), so this is not a live break. It is
a gap between what is deployed and what is published.

### 7. `vue-tsc` is installed and never run

`apps/workbench/package.json`

`vue-tsc` is a devDependency. There is no `typecheck` script, `build` is bare `vite build`,
which strips types through esbuild without checking them, and CI runs only that build. Run by
hand during this audit, `npx vue-tsc --noEmit` exits 0 with no output, so the app is type-clean
today. The gate is missing, not failing.

### 8. `src/index.ts` is imported by no test

No test file imports the public barrel, statically or dynamically. Checked directly instead:
the built bundle resolves by package name and all 218 exports are defined, so nothing is
broken now. But a symbol dropped from the barrel, or shadowed by one of the fifteen
`export *` lines, would be caught by the type checker only if some other file happened to
reference it. The library gates the worklet string, the golden renders, the generated headers
and the documented figures. It does not gate its own export surface.

### 9. `core/register.ts` imports upward through the whole layer stack

`packages/bellows/src/core/register.ts:10-32`

CLAUDE.md: "Dependency direction is one way: `types` and `core` at the bottom, then `dsp`,
then `engines`/`fx`/`analysis`, then `kernel`/`io`, then the facade. Never import upward."
`core/register.ts` has 22 runtime imports from `engines/` and `fx/`.

It is a deliberate manifest, and its own comment explains the design ("Explicit rather than
side-effectful imports, which keeps `sideEffects: false` honest"), which this audit confirmed
is true. The problem is placement, not structure: the module belongs above the layers it
names, not underneath them. Moving it to `src/register.ts` beside the facade would satisfy the
rule with no change to what it does.

Two other upward edges exist and are type-only, so they are erased at compile time and create
no runtime coupling: `core/scheduler.ts` to `seq/transport`, and `engines/soundfont.ts` to
`io/sf2` and `io/sfz`. Noted, not raised.

### 10. Untrusted-input ceilings were added to SFZ only

`packages/bellows/src/io/sf2.ts`, `midifile.ts`, `wav.ts`

0.1.6 gave the SFZ parser six caps after it was shown to hang a tab. Its three siblings read
untrusted input in a browser too, and have none.

Every index derivation in all three was checked by hand this pass and all of them are
in bounds. `readChunks` cannot loop forever (the cursor advances by at least 8 each pass);
`buildZones` is guarded at both ends before it reads `bags[z + 1]`; `sampleData` rejects
`h.end * 2 > smpl.size` before allocating; `readCubic` in the sampler clamps all four taps,
so an out-of-range zone offset from a hostile SF2 cannot inject NaN; `decodeWav`'s sample loop
can only reach `dataOff + dataLen`, which cannot exceed the buffer.

What is absent is a ceiling on amplification, which is what the SFZ work was actually about:

- `pbag` and `pgen` become one object per four bytes, roughly 15x the chunk size in retained
  heap.
- A MIDI track becomes one event object per two bytes at minimum, roughly 75x, which is larger
  than the 1750x-once-fixed SFZ case in ratio terms only because SFZ was worse.
- `numChannels` in a WAV `fmt ` chunk is an unbounded uint16, so a tiny file can ask for 65535
  separate `Float32Array` objects. The total sample memory stays bounded by the data chunk; the
  per-object overhead does not.

None of this is a crash and none of it is reachable without the user opening a file. It is
raised because the project drew a line at SFZ and the same line has not been drawn beside it.

### 11. A MIDI time-signature denominator can come back negative

`packages/bellows/src/io/midifile.ts:175`

`denominator: 1 << body[1]`, where `body[1]` is an unvalidated byte. JavaScript masks a shift
count to five bits, so:

```
shift byte   2 -> denominator 4
shift byte   3 -> denominator 8
shift byte  31 -> denominator -2147483648
shift byte  32 -> denominator 1
shift byte 255 -> denominator -2147483648
```

The valid range in the spec is 0 to about 7. Bytes above that silently produce a wrapped or
negative denominator rather than an error, and the parser rejects malformed input everywhere
else. Correct decoding of valid bytes is tested, and that test kills its mutation.

### 12. Eight npm advisories, none of them reachable by a consumer

`npm audit` reports 3 moderate, 4 high, 1 critical: vitest, vite, postcss, nanoid,
brace-expansion. All of them are build and test tooling. `packages/bellows/package.json`
declares no `dependencies` and no `peerDependencies`, so nobody installing `bellowsjs` pulls
any of them. The exposure is to this repository's own build and to CI, which runs `npm ci`
and `npm test` on `pull_request`. Worth clearing on the non-breaking ones; not a product
issue.

### 13. The one allocation the audio path can still make

`packages/bellows/src/kernel/engine.ts:573`

`this.events.splice(0, this.eventHead)` runs on the audio thread once per 256 drained events
and allocates the array of removed elements. The hard rule is written "at steady state", and
steady state has no events to drain, which is what the heap probe measured: -0.065 bytes per
block over 20000 blocks with 22 voices and 24 effects running. So the rule holds as written.
This is noted so that the exception is on the record rather than rediscovered.

## Not findings

Raised during the pass and then withdrawn, so nobody re-raises them:

- **Phaser and Transient have no embedded parity row.** They have no embedded implementation
  either. `fx/modfx.h` and `fx/dynamics.h` contain Chorus, Flanger, Tremolo, AutoPan, RingMod,
  Compressor, Limiter and Gate, and every one of those has a row.
- **Three surviving kernel mutants.** Proved equivalent by rendering and diffing, see finding 2.
- **A surviving SFZ mutant.** An artefact of renaming one occurrence of an option name in a
  harness that does not type-check; it made the option fall back to its default, which is not
  a statement about coverage.
- **`App.vue` adds two window listeners and removes neither.** They are on the app root, which
  never unmounts.
- **Banned phrasing in `docs/BOWED-STRINGS.md` and `docs/ENGINEERING.md`.** Both are research
  briefs written before the style rule applied to them, and both predate the code they describe.

## Round two

Round one instrumented the gates and read the rest. Round two instrumented the rest.

### 14. `rotate` was a different function in the package than on the site

`packages/bellows/src/index.ts`

`seq/euclid` exports `rotate(arr, n)` and `seq/pattern` exports `rotate(p, n)`. The barrel
took the first by name and the second through `export * from './seq/pattern'`. Measured:

```
source barrel  rotate -> the PATTERN combinator   (=== pattern.rotate)
dist ESM       rotate -> the ARRAY function       (=== euclid.rotate)
```

The workbench aliases `bellowsjs` to library source, so **bellows.live and npm shipped
different functions under the same name**, with incompatible arguments: the array one on a
`StepPattern` throws, because `StepPattern` is `{ at, length }` and has no `slice`. The spec
says the explicit export wins, so `dist` was right and the source resolution was wrong, but a
barrel whose meaning depends on the bundler is the defect, not whichever side lost.

A docs page already carried a footnote saying the package's `rotate` was the array one and
"not the pattern combinator", which was true of npm and false of the site the footnote was
served from. The pattern combinator was, on npm, reachable from nothing.

**Fixed.** `seq/pattern` is listed explicitly rather than starred, and its rotation is
exported as `rotatePattern`. `rotate` keeps meaning the array one, which is what npm has
always shipped, so nothing that worked changes. The docs footnote now describes both.

Two gates, in `test/integration/package.test.ts`. One asserts that every value a starred
module declares is reachable from the barrel under some name, by identity, so an alias
satisfies it and a lookalike stub does not. The other pins what the two colliding names mean,
in both artefacts, by calling them. Verified: re-starring `seq/pattern` fails 2 tests,
dropping the alias fails 2, dropping any other pattern export fails 1.

### 15. Nothing had ever compared realtime against offline

`packages/bellows/src/kernel/worklet-entry.ts`

The README, the PRD and the offline renderer's own header all say they render identically.
`worklet-entry.ts` was imported by no test, and CI only proved that regenerating
`worklet-code.gen.ts` produced no diff, which pins the string to its source and says nothing
about whether the two wirings agree. They differ in three places: the worklet supplies
`resolveBankEngine` and the offline renderer takes it from the caller, the worklet calls
`setFrame` with the context clock every block and the offline renderer never does, and the
worklet posts a meter.

`test/kernel/worklet-parity.test.ts` evaluates the shipped IIFE against a real global scope
and drives it block by block. Over 96 blocks with two engines, a channel effect, a bus send,
a master limiter and five events at fractional sample positions, the two are **bit
identical**. Also gated: the processor name matches `KERNEL_PROCESSOR_NAME`, an event lands
on the same sample whether the node was made at frame 0 or a minute in, a bad message comes
back over the port instead of throwing, a mono output does not crash the node, and an empty
output does not either. Verified: removing `setFrame`, renaming the processor, changing the
meter cadence, changing the block size, aliasing the right channel to the left, and making
`apply` throw each fail it.

**The first version of this harness passed the globals in as function parameters.** That
froze `currentFrame` at load, so the kernel re-rendered block zero forever, and two of the
tests passed anyway. A harness that degrades that quietly is worse than none, and the file
says so at the top.

### 16. The shelf filters' corner frequency was unconstrained

`packages/bellows/src/dsp/filters.ts:124`

`g = Math.tan(w) / Math.sqrt(A)` changed to `* Math.sqrt(A)` passed the whole suite. That
moves the corner by `A`, an octave at 12 dB, and leaves the asymptotes alone, which is
exactly what the two existing tests measure: they read 40 Hz and 4000 Hz for a 200 Hz corner.

What pins it is that this design passes exactly half its dB gain at the corner. Measured
5.994 and 6.000 dB of 12 for the low and high shelf, against 11.09 for the mutation.

### 17. Six analysis constants were reachable by no test

`pitch.ts` DEFAULT_THRESHOLD, MPM_K and MPM_MIN_CLARITY; `chroma.ts` MIN_HZ and MAX_HZ;
`onset.ts` TEMPO_LO and TEMPO_HI. Every one survived a one-step mutation, for the same reason
each time: the tests used signals nowhere near the threshold. Clean sawtooth and digital
silence for the pitch detectors, 40 Hz against a 60 Hz cut for chroma, 120 bpm in the middle
of a range that folds at 75 and 150.

Each is now bracketed from both sides on measured signals: noise 0.2 accepted and 0.3
rejected for YIN, a fundamental at a tenth its octave's amplitude for MPM_K (0.93 gives
110 Hz at clarity 1.0, 0.75 gives 219.9 at 0.78), clarity 0.376 at noise 1.0 and under 0.3 at
1.3, C2 counted and G sharp 1 dropped, D8 counted and E8 dropped, 70 doubling to 140 and 180
halving to 90. Verified: fifteen mutations, all dead.

**The first attempt to gate MPM_K reported that no value from 0.1 to 0.99 changed anything
across 96 signals.** That was a module-cache hit: the "mutant" run re-imported a cached copy
of the original. Re-run with a fresh process per value, 0.75 changes 22 of the 96.

### 18. A non-finite YIN threshold made the detector go deaf, silently

`packages/bellows/src/analysis/pitch.ts`

Every comparison against NaN is false, so `cmnd[tau] < threshold` never fired and `yin`
returned null for every input, forever, with nothing reported. A caller reaches that through
`Number(config.threshold)` on a field that is not there. This is the same hole 0.1.6 closed in
the SFZ parser's limits, in a different file, and it is closed the same way.

### The rest of round one

- **6.** Building the app against `dist` works, and was rejected: `dist/bellows.js` is one
  pre-bundled file, so Rollup can no longer split library internals across routes and the
  entry chunk goes from 123 KB gzipped to 145 KB. That is 22 KB on first paint to buy a check
  that belongs in a test, so the check is a test.
- **7.** `vue-tsc` runs in the build script, as its own npm script, and as its own CI step.
- **8.** `test/integration/package.test.ts`, 14 tests: the export list as a written-down
  public API, resolution by bare specifier in a plain Node subprocess, agreement between the
  source barrel and the built bundle by kind and arity, the standalone IIFE actually leaving
  a global behind, and every path `package.json` promises.
- **9.** `core/register.ts` is `src/register.ts`, and `test/integration/layering.test.ts`
  gates the whole rule: no runtime upward imports at all, exactly three type-only ones listed
  by name, and no browser globals in the pure layers.
- **10.** Measured before capping: MIDI amplifies 26.6x (781 KiB of input retains 20.3 MB)
  and WAV 217x (64 KiB declaring 65535 channels retains 13.6 MB). Both capped, at a million
  events and 256 channels, both overridable, both validating a non-finite override. SF2's
  bags and generators are transient rather than retained, so its peak is bounded by its own
  chunk sizes; its `sampleCache` grows without eviction and is recorded rather than capped,
  because a ceiling there would reject legitimate banks.
- **11.** `1 << dd` is `Math.pow(2, dd)`, and a meter that cannot be interpreted comes back
  as raw meta rather than as an invented one.
- **12.** vitest 2 to 4 clears all eight advisories. 1330 tests pass and `dist/bellows.js` is
  byte-identical before and after, so the upgrade changed nothing the package ships.
- **13.** `copyWithin` and a length assignment instead of `splice`, which allocated the array
  of removed elements on the audio thread.

### Two hazards this round created and then closed

- **CI ordering.** `package.test.ts` builds `dist` when it is missing, and that build
  regenerates the worklet. With the worklet freshness check running after the tests, as it
  did, it would have compared the file against a copy the suite had just written. The check
  runs before the tests now.
- **Test contention.** Building inside a `beforeAll` ran while other workers ran, and the
  contention pushed the brown noise bound past its 5 second timeout. The build is a
  `globalSetup` now. Separately, that timeout was measured on vitest 2 and vitest 4 and is the
  same either way, so it is the default that is tight rather than the upgrade that is slow;
  `testTimeout` is 30 s and the assertions remain the gate.
