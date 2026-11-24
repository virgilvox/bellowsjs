# Changelog

## 0.6.0 (unreleased)

Bellows can share its sound with the rest of a Web Audio graph, both ways, and gains a filter
effect. Nothing changes for a page that asks for neither: a boot without `outputs` or `inputs`
builds the same node and renders the same samples as 0.5.1.

### Added

- **Direct outputs.** `Bellows.boot({ outputs: n })` (0 to 16) gives the kernel node n stereo
  outputs beside the master. `inst.route(k)` sends a channel, after its inserts, gain and pan, to
  direct output k instead of the master mix, and `b.outputNode(k)` is that output as an AudioNode
  to connect onward; `route(0)` brings it back. Sends from a routed channel still reach their
  buses, whose returns stay in the master. `b.outputs` says how many there are (0 while a plugin's
  kernel renders, since only KernelEngine routes).
- **Direct inputs.** `Bellows.boot({ inputs: n })` gives the node n inputs. `b.inputNode(k)` is
  input k as an AudioNode to connect a source into, and `b.inputChannel(k)` makes a channel whose
  sound is that input instead of an engine, so a microphone or any Web Audio source can go through
  bellows inserts, sends and routing. Notes and engine params do nothing on it.
- **`filter` effect.** The Svf modes (lowpass, highpass, bandpass, notch, peak, allpass, bell, low
  and high shelf) at 12 or 24 dB per octave, and the four stage ladder lowpass with its drive, as
  an insert. The cutoff glides in the log domain so a swept control does not zipper, and the
  bandpass peaks at 0 dB whatever its resonance. Registered after the 0.5 effects, so every
  existing effect keeps its position in `listEffects()`.
- `KernelEngine.process(outL, outR, io?)` takes the direct buffers as `KernelIO`, laid out as an
  AudioWorkletProcessor receives them; `KernelLike` declares the optional argument, and a kernel
  that ignores it keeps every channel in the master.

### Notes

- An offline render has no direct inputs or outputs: routed channels render in the master and
  input channels are silent.
- New kernel messages `channelOutput` and `createInputChannel`. A plugin kernel that does not
  know them ignores them (bellows-wasm 0.2 does), which leaves routing off.

## 0.5.1

A plugin can bring its own kernel. bellows-wasm 0.2 uses this to run the whole render in
WebAssembly: the event queue, voice pools, ramps, chains, buses and the master, with every unit it
does not carry still played in JavaScript at the point KernelEngine would play it. Nothing changes
for a page that loads no such plugin: KernelEngine renders exactly as in 0.5.0.

### Added

- **Kernels by name.** `registerKernel(name, factory)` makes a kernel available on the calling
  thread, and the worklet hook's version 2 adds `registerKernel` there. A `BellowsPlugin` that
  declares `kernel: name` and is passed to `Bellows.boot({ plugins })` has the processor build that
  kernel instead of KernelEngine, live and in `b.render()`; `renderOffline(setup, { kernelName })`
  does the same on the calling thread. A name that is not registered throws in `renderOffline`; in
  the worklet the processor falls back to KernelEngine and posts an error saying so.
- **`KernelEnv`** (`kernelEnv`): what a kernel needs from the realm to play units it does not carry
  as KernelEngine plays them, namely the registry, `builtinEngine(id)` and `builtinEffect(id)` (the
  defs `registerBuiltins()` registered, to tell a builtin from a replacement under the same id),
  `rng`, `VoicePool` and the interned param names. Types `KernelLike`, `KernelEnv` and
  `KernelFactory`, and `hasKernel(name)`.

### Changed

- `renderOffline`'s `onBlock` receives a `KernelLike`, the surface KernelEngine and any other kernel
  share. It is declared as a method, so a callback typed against `KernelEngine` still fits.
- An error reply carries `kernelFallback: true` when the processor could not build the kernel it
  was asked for and runs KernelEngine; the facade then renders with KernelEngine too.
- `b.use(plugin)` throws for a plugin that brings a kernel, since the kernel is chosen when the
  processor is built: pass it to `Bellows.boot({ plugins })`.

## 0.5.0

The singing voice leaves bellowsjs for its own package, [bellows-voice](https://github.com/virgilvox/bellows-voice),
with its history, and bellowsjs gains the plugin path it loads through. The voice sounds exactly as
it did: renders across bodies, glottis models, accents and speech match 0.4.0 sample for sample,
through `renderOffline` and through the worklet. A page that does not sing no longer carries the
voice: the standalone bundle goes from 211957 to 116924 gzipped bytes, the worklet from 251 to 128 KB.

### Added

- **Plugins.** `Bellows.boot({ plugins })` and `await b.use(plugin)` load engines and effects that
  ship in their own package into the worklet beside the kernel, in live playback and in
  `b.render()` (an OfflineAudioContext, or the worklet string on the calling thread). A
  `BellowsPlugin` is plain data: a self-contained script that registers its definitions through the
  hook the kernel leaves on the worklet's global scope (`globalThis.bellowsKernel`, `KERNEL_HOOK`),
  the engines and effects it registers for `listEngines()` and `listEffects()`, and an optional
  `workletUrl` for hosts whose CSP blocks blob URLs. Loading uses `addModule`, never eval.
- **A host API for plugins** that drive channels the way the facade does: `b.paramIndex(name)`,
  `b.postKernelEvents(events)`, `b.reserveNoteIds(n)`, `b.layNotes(notes, at, scale)` (notes end to
  end through the tempo map and tuning), `b.contextState(key, init)` (state that a render forks from
  the live one and never writes back), `b.onUntimedParam(channel, cb)` and `b.rendering`.

### Removed (moved to bellows-voice)

- The `vocal` engine and `Instrument.sing()`, `Instrument.speak()`, `b.dictionary`, `b.accent`:
  `singer(b, params)` from bellows-voice replaces `b.voice('vocal', params)`, with `dictionary` and
  `accent` on the singer.
- The lyric layer and its exports (`lyricsToSyllables`, `readLyrics`, `englishFrontEnd`,
  `ipaFrontEnd`, `tokenizeIpa`, `arpabetToSegments`, `parseCmudict`, `planSung`, `sungEvents`,
  accents, `pronounce`, `toIPA`, `speechPlan` and their types), `VOCAL_PHONEMES`,
  `vocalPhonemeIndex`, `vocalEngine`, `GlottalSource` and the `CritDamp` units.
- CHIMERA's code and notice: bellowsjs no longer contains any, and its banners say so.

## 0.4.0

Accents. Every voice used to speak one accent, General American, and listeners heard it as an old
Irish man; a voice can now be given any accent, as data. See docs/ACCENTS.md.

### Added

- **Accents.** `b.accent`, `sing(..., { accent })` and `lyricsToSyllables(text, { accent })` take an
  id ('general-american', the default, 'southern-british', 'london', 'australian', 'new-zealand',
  'irish', 'scottish', 'southern-us') or an `Accent` object. The English reader tags each vowel with
  its Wells lexical set (`LexicalSet`, `tagLexicalSets`); an accent maps the sets to vowels and
  diphthongs, sets the diphthongs' glide timing, says or drops r after a vowel (linking it before a
  vowel), and picks its t, l, th, r and h rules. General American output is unchanged.
- **`speak(text, opts)`** on a vocal instrument: clauses spoken with stress-timed rhythm, final
  lengthening, declination, pitch accents and a final fall or rise from the accent's `prosody`; a
  clause ending in "?" rises. `speechPlan()` is the same without the facade.
- `lyricsToSyllables(text, { reduce: true })` gives function words their weak forms, as speech
  does; `speak()` uses it.
- **`pronounce(text, opts)` and `toIPA(text, opts)`**: what will be said, word by word, with stress
  marks, syllables and lexical sets.
- **Twelve vowels**: ɒ ɐ ɜ ʉ ɨ ɘ ɵ y ø œ ɯ ɤ, solved from formant targets into articulator targets
  for each body (`scripts/gen-extra-vowels.mjs`, `src/engines/vowel-solver.ts`) and checked through
  the engine (F1 and F2 within 3 percent for the male body, except the child body's y, about 12
  percent high in F1). They are appended to `VOCAL_PHONEMES` at indices 42 to 53, so saved indices
  keep their sounds.
- **`estimateFormants(x, sampleRate, center)`**: LPC formant estimates around a sample index.

### Changed

- ɜ ɒ ɐ ɨ ʉ and y written in IPA used to be read as General American's nearest vowel (ɝ ɑ ʌ ɪ u
  i); they are now their own sounds.
- `applyAllophones()` takes the accent's t and l rules as a third argument; left out, the rules are
  General American's as before.
- A nucleus of any two vowels is sung as a diphthong, gliding at its segment's `hold` (an accent
  sets it) or General American's 0.8.

## 0.3.0

The engines ship once. Every engine used to travel twice in a page: inside the AudioWorklet's
string, and again as main-thread code, because `Bellows.boot()` registered all of them so that
`b.render()` and `listEngines()` could work. A page that boots, sings and renders bundled
175,417 gzipped bytes; it now bundles 110,930, of which 76,985 are the worklet.

### Changed

- **`b.render()` renders through the kernel worklet.** In a browser it runs the worklet in an
  OfflineAudioContext, the Tone.Offline pattern, so a render runs off the main thread and the page
  stays responsive; the score goes to the processor's constructor (`processorOptions`) so it is in
  place before the first block. Outside a browser the same worklet string runs on the calling
  thread. Every path renders `renderOffline`'s samples exactly (tested, and checked in Chrome). In
  Chrome a render through the worklet takes about 25 percent longer than one on the main thread.
  `Bellows.boot({ workletUrl })` applies to renders too.
- **`Bellows.boot()` no longer registers the built-in engines on the main thread.** They play in
  the worklet, which registers its own. `getEngine(id)` on the main thread returns a definition
  only once it is registered there: call `registerBuiltins()` first, as Node code already does.
- **`listEngines()` and `listEffects()` describe every built-in without loading its DSP**, from a
  generated catalog (`EngineInfo` and `EffectInfo`: id, label, params, polyphony), plus anything
  registered on the thread; a registered definition stands in for its description. Their return
  types narrow from `EngineDef[]` and `EffectDef[]` accordingly.
- **`renderOffline()` registers the built-in engines itself.** Code that rendered in a browser
  after a boot, relying on the boot's registration, keeps working; `registerBuiltins()` first is
  harmless.

## 0.2.0

A singing voice, and a new license. `git diff --shortstat v0.1.9..v0.2.0 -- packages/bellows/src`
is 43 files and about 11,400 insertions, nearly all of it the voice and its lyric layer.

### Added

- **`vocal`, an articulatory singing voice.** A gesture planner drives the 17 articulators of
  CHIMERA (Jameson Hodge's physical-model voice synthesizer, MIT; see `THIRD_PARTY_NOTICES.md`)
  through a six-stage cascade, CHIMERA's mouth geometry gives the tract's shape, and a junction
  airway (a waveguide that carries the air itself, at the output rate) makes the sound: pressure
  behind closures, bursts, voice bars, turbulence from Stevens' law with Birkholz's placement, a
  yielding wall, nasals through a velum port. Male, female and child bodies; 41 phonemes; three
  vocal fold models on `glottis` (a drawn pulse, the default; geometric folds; self-oscillating
  two-mass folds under a pitch servo); `ring` and `tuning`. About a microsecond a sample at 48 kHz.
- **`Instrument.sing(lyrics, notes, opts?)`**, and the pure lyric layer under it:
  `lyricsToSyllables`, `planSung`, `sungEvents`, `parseCmudict`, `b.dictionary`, English
  letter-to-sound with built-in function words, irregular words and contractions, IPA between
  slashes, and American allophones (`allophones: false` for classical diction). Without a
  dictionary, 77 percent of 469 common lyric words read exactly as the CMU dictionary has them.
- `VOCAL_PHONEMES` and `vocalPhonemeIndex(ipa)` for holding one sound without a lyric.

### Changed

- **License: MIT** from this release, by the owner's choice, so attribution travels with every
  copy. Versions already published stay Apache-2.0. The parts ported from CHIMERA keep Jameson
  Hodge's MIT notice, and every bundle carries a one-line banner naming both.

### Fixed

- **`b.render()` is reproducible for the rng form the docs teach.** A stream captured once,
  `const melody = b.rng('melody')`, bound the callback to the live stream, so two renders of one
  seed produced different music. A render now replays it from the seed.
- **A non-finite audio sample no longer latches a recursive unit.** `EnvelopeFollower`, `Svf`,
  `LadderFilter`, `OnePole` and `DcBlocker` each held NaN forever after one bad input; each now
  holds its last good state.
- Smaller fixes from the audit register: the modal mode tables say which are measured, and the
  voice-leading docs no longer claim a crossing penalty the code does not apply.

## 0.1.9

Three silent failures become loud ones, plus the gates and the documents behind them.
`git diff v0.1.8..v0.1.9 -- packages/bellows/src` is 214 insertions across 11 files, of which
42 are code and the rest are comments; on the other side, 14 of the 30 deletions are code. Most
of the code is the two reconstruction guards and the helper they share.

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
