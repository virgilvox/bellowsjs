# Changelog

## 0.1.9

Two lines of behaviour, both of them a silent failure becoming a loud one, plus the gates and
the documents behind them. `git diff v0.1.8..v0.1.9 -- packages/bellows/src` is about 200 lines
and all but three of them are comments, a removed type declaration and two casts.

### Fixed

- **`Istft` and `StftProcessor` no longer accept a window and hop that cannot reconstruct.** The
  overlap-add normaliser divides by the per-position sum of `analysisWindow * synthesisWindow`,
  and where that sum was at or below 1e-6 it used a reciprocal of zero, which drops those output
  positions to silence with no error and no warning. `hop = fftSize` with the default Hann window
  is exactly that case, because a Hann window is zero at both ends. Both constructors now throw,
  naming the offset and the sum. A hop that reconstructed before reconstructs identically: the
  normaliser is unchanged for every position above the guard, and every caller inside this
  library uses `fftSize / 4`.
- **`timeStretch` had the same hole and now has the same guard.** It is a third overlap-add
  synthesis path and its documented range accepted `hop = fftSize`, where the result is a comb:
  measured, stretching one second of a 220 Hz sine at `fftSize` 1024 and `hop` 1024 returned
  10121 exact zeros in 88200 samples, 11.5 percent of the output.
- **A parameter ramp with a duration large enough to overflow the frame arithmetic no longer
  wedges a ramp slot.** `endFrame = frame + round(seconds * sampleRate)` is `Infinity` for
  `seconds = 1e308` at any real rate, so the slot's end never arrives, the interpolation factor
  is always zero and the parameter never moves, and the slot is never freed. Thirty-two of those
  exhaust the table and every later ramp on that kernel silently becomes a jump. `startRamp`
  refuses a non safe-integer end frame and the caller takes the same immediate-apply path a full
  table takes. A finite-duration test does not close this: whether a finite duration survives
  depends on the sample rate, and only that one line holds both terms.

### Changed

- **`TempoPoint` is gone from `src/types.ts`.** It was declared in the contracts file and used by
  nothing, in a file where a declaration reads as a contract somebody is honouring. It was never
  re-exported from the package barrel, and the `exports` map admits only `.` and `./worklet.js`,
  so no supported import path could reach it. It was visible in the shipped `dist/types.d.ts`,
  and therefore in `llm.txt`, which is why this is a note rather than nothing.
- **`SamplerZoneData` is no longer bridged to `SampleZone` by an unchecked cast.** The two are
  field-for-field twins, and the cast is what let them stay twins without anything noticing if
  one moved. A compile-time assertion now fails the build if their shapes diverge, and the two
  casts it replaces are gone. No runtime behaviour changes.
- Several docstrings now say what the code does rather than what it was meant to do. The
  `LadderFilter` comment claimed self-oscillation near resonance 1; the loop stays under unity at
  every setting and the comment now gives the measured peak heights instead. `Adsr.set` was
  documented as safe to call while running, which holds for the three times and not for the
  sustain level.

## 0.1.8

A documentation release, and the code is byte-identical to 0.1.7. `git diff v0.1.7..v0.1.8 --
packages/bellows/src` is empty, the test suite is the same 1348, and no behaviour changes. It
exists because the README is one of the three things this package ships, alongside `dist` and
`LICENSE`, and it was missing something a reader would want.

### Added

- The README now documents the microcontroller port. The same DSP core is a header-only C++17
  library for 32-bit parts, it lives in the same repository, and the npm page said nothing
  about it at all. It now links there and carries the board support table, measured by
  building all 17 examples for each part rather than read off a data sheet: 16 of 17 on Teensy
  4.1, 4.0 and MicroMod, 16 of 17 on 3.6 and 3.5, 12 of 17 on 3.2, 3 of 17 on LC, plus a Daisy
  Seed image.
- The parity evidence is stated where a reader can see it: the C++ is diffed against this
  package on every commit, 40 engine and effect rows compared sample by sample, 428
  exactly-compared value rows, and all 50 instrument presets compared value by value, 1054 of
  them, with the PRNG bit exact.
- What that does not claim, in the same paragraph rather than a footnote: one board has been
  run, a Teensy 4.0 at 33.8 to 46.5 percent CPU with a 47.3 percent running maximum, and a
  build proves a part can hold the code rather than keep up with it.

## 0.1.7

Three audit rounds, written up in `docs/AUDIT-3.md`. Almost all of it is gates rather than
behaviour: 1273 tests in 85 files became 1348 in 90, and 68 hand-written mutations were run
against the whole suite to find out which ones did nothing. What did change for a user:

### Added

- `rotatePattern`, the step-pattern rotation from `seq/pattern`. It existed and was reachable
  from nothing: `seq/euclid` also exports `rotate`, the explicit export won, and the two
  functions take incompatible arguments. `rotate` still means the array one, so nothing that
  worked changes. A docs page used to carry a footnote about this; it describes both now.
- `decodeWav(buf, { maxChannels })` and `parseMidi(buf, { maxEvents })`. Both untrusted input
  in a browser, both previously uncapped, and measured: a 64 KiB WAV declaring 65535 channels
  retained 13.6 MB, and 781 KiB of MIDI retained 20.3 MB. Defaults 256 and 1000000, which no
  real file approaches.

### Fixed

- **`rotate` meant different functions under different toolchains.** vite's transform resolved
  the collision above one way and Rollup the other, so the dev server and the test suite ran a
  different function from every build. The barrel no longer has the ambiguity.
- **A MIDI time signature could report a negative denominator.** The exponent byte is unvalidated
  input and `1 << dd` masks the shift to five bits, so bytes 31 and 255 both produced
  -2147483648 and byte 32 produced 1. Meters that cannot be interpreted now come back as raw
  meta events instead of invented ones.
- **A non-finite YIN threshold silently disabled pitch detection.** Every comparison against NaN
  is false, so `yin(buf, sr, Number(missingField))` returned null for every input forever with
  nothing reported. Same hole 0.1.6 closed in the SFZ limits, closed the same way.
- The kernel no longer allocates when it compacts its drained event queue, which it did on the
  audio thread once per 256 events.

### Changed

- `registerBuiltins` moved from `src/core/register.ts` to `src/register.ts`. It imported 22
  modules from the layers above it. The export is unchanged and the package has no deep import
  paths, so this is invisible from outside.

## 0.1.6

A safety release. One item changes seeded audio and it is named below; nothing
else moves rendered output, and the golden render fixture is unchanged.

### Fixed, and the reason to upgrade

**The SFZ parser could be made to hang or exhaust a tab.** It is the only part
of the library that reads untrusted input, and in a browser that input is a
user-chosen file or a fetched URL. On 0.1.5, measured:

- 651 bytes of crafted input cost 43 seconds of CPU. The line tokenizer used a
  greedy character run followed by a required literal, so it retried every
  length when the literal was absent: cost went up four times per doubling of
  the input. Replaced with a linear scanner, which takes the same 32000
  character run from 1686 ms to under 1 ms. The new scanner was compared token
  for token against the old expression over 200059 inputs with no differences.
- About 10 KB of input retained 19 MB, a flat amplification of roughly 1750x,
  because `#define` expansion landed in region fields that keep the expanded
  line alive. `maxTotalExpanded` now bounds the whole parse.
- Passing `NaN` for any limit silently disabled it, which a caller reaches
  through `Number(someConfigValue)` on a missing field. All limits validate now.

A legitimate file is unaffected: 2.1 MB across 20000 regions still parses, in
51 ms.

**A non-finite parameter no longer silences a unit for the rest of the
session.** `Svf`, `LadderFilter`, `OnePole`, `Smoother`, the envelopes and the
kernel ramp keep their last good setting when handed `NaN` or `Infinity`.
Previously one such value entered a recursive state variable and every later
sample was `NaN`, with no error and no way to recover. This is a recovery, not
a behaviour change: nothing that worked before behaves differently.

**`DelayLine` no longer hangs** for `maxSamples` at or above 2^30. It throws.

**`quick.play()` recovers from a failed boot.** The shared boot promise was
never reset, so one failure rejected every later call for the life of the page.

**`b.now()` is render-aware**, so a callback timing off it no longer misroutes
during offline replay.

### Changed

- **`chordToRoman` spells raised degrees with sharps.** F# in C major was
  `bV` and is now `#IV`. Spelling follows the line of fifths, which reproduces
  the conventional set. `romanToChord` is unchanged and the two still round
  trip.
- **`chordToRoman` no longer throws past the seventh degree.** Five of the
  thirty-two shipped scales could not be analysed at all. Six of 408 scale and
  root pairs still throw, because four scales have four-semitone gaps that
  single-accidental spelling genuinely cannot name, and the message says so.
- **`CHORD_TYPES` gained `maj7#5`**, 24 entries to 25, without which harmonic
  minor's III chord has no name.
- **`buildProgression(bars: 2)` returns a half cadence** instead of `[0, 0]`.
  THIS IS THE ONE THAT CHANGES SEEDED AUDIO: it draws one value from its
  generator where it drew none, so a piece written against two bars sounds
  different. Three bars and above are byte identical.

### Internal

Nothing here changes the published API, but it is why the release is trusted:
the C++ port's memory safety is now gated by AddressSanitizer and
UndefinedBehaviorSanitizer, parity against the TypeScript went from 19 modules
to 34 rows with the effect input now bit exact, and continuous integration ran
for the first time in the project's history.
