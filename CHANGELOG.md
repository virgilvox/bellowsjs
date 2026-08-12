# Changelog

## Unreleased

On `main`, not on npm. `bellowsjs@0.1.6` is still what an installer gets.

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
