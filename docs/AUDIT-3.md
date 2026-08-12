# AUDIT 3

Whole-repository audit, 2026-08-11, at commit 59a5093. Companion to `docs/AUDIT.md` and
`docs/AUDIT-2.md`.

Unlike audit 2, this pass was run by one reader with instruments rather than by a fleet of
agents, and it leans on measurement wherever measurement was available: a heap probe for the
allocation rule, an FFT sweep for the alias claim, a mutation harness for the gates, and a
render-and-diff for every mutant that survived. Where a finding rests on reading rather than
on a number, it says so.

Nothing here blocks. The shipped library is correct as far as this pass could push it: the
suite passes, the embedded harnesses pass, `bellowsjs@0.1.6` resolves and every one of its 218
exports is defined. What the pass found is mostly missing gates around code that is currently
right, plus one number on the front page of the npm listing that is wrong.

## Status

Findings 1 to 5 are **fixed**, in the same session, and each fix was verified by re-running
the mutation that motivated it. No library source changed: the alias number was wrong in the
documents and not in the DSP, and the other four were missing tests.

| # | What | State |
| --- | --- | --- |
| 1 | README alias claim | fixed in 4 places, measured |
| 2 | Event placement not gated | 2 tests added, kills round to floor and round to ceil |
| 3 | BS.1770 gate thresholds not gated | 2 tests added, kills all four one-step moves |
| 4 | Sampler interpolator not gated | 2 tests added, kills all three tap misalignments |
| 5 | `lsystem.h` not compared | 30 parity rows added, kills in-place rewrite and short copy |
| 6 | Workbench builds against source, not `dist` | open |
| 7 | `vue-tsc` installed and never run | open |
| 8 | `src/index.ts` imported by no test | open |
| 9 | `core/register.ts` imports upward | open |
| 10 | Input ceilings on SFZ only | open |
| 11 | MIDI time-signature denominator can be negative | open |
| 12 | Eight dev-tooling advisories | open |
| 13 | `splice` on the audio thread | noted, rule holds as written |

The suite went from 1273 to 1279 tests, and the value-parity harness from 318 rows to 348.
Findings 6 through 13 are left as recorded rather than fixed: 6, 7 and 9 change build or
module layout and belong with the 0.2.0 architecture work, and 10 through 13 want a decision
about policy rather than a patch.

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
