# AUDIT 2

Whole-repository audit, 2026-08-05. Forty agents across eight slices, each finding then
attacked by a skeptic whose default was to refute it. Companion to `docs/AUDIT.md`, which
covers the earlier pass.

95 findings raised. 32 were escalated to a skeptic; 27 survived and 5 were refuted.
Refuted findings are listed at the end so nobody re-raises them.

Verdict per slice:

| Slice | Verdict | Findings |
| --- | --- | --- |
| Music theory | needs-work | 8 |
| Instrument algorithms | needs-work | 9 |
| Docs and claims | needs-work | 21 |
| Coverage and gates | needs-work | 11 |
| Embedded package | needs-work | 12 |
| Facade, kernel, IO | needs-work | 13 |
| Architecture | sound | 11 |
| DSP core | sound | 10 |

## Blocking (11)

**Architecture: CI has never run: .github/workflows/ci.yml is not on origin/main and GitHub reports zero workflow runs**

`.github/workflows/ci.yml` Confirmed by review at major.

docs/AUDIT.md finding 10 says "Fixed: `.github/workflows/ci.yml` runs typecheck, the suite and the build on node 20 and 22, plus both app builds and the embedded size report on two ARM targets." Finding 11 says "The CI job now regenerates the bundle and fails on a diff." docs/HANDOFF.md says "CI now enforces it" and "tools/check-docs.mjs is the control, and CI runs it." The workflow file exists in the working tree, was added in commit 26c0b2f, and has never been pushed. Every mechanical guarantee the docs attribute to CI (worklet freshness, golden renders not regenerated, generated headers in sync, documented figures matching the size report, parity gates) is currently enforced by nothing but a human remembering to run it locally. This is the project's own standard applied to itself: a gate nobody has watched fail is a gate nobody should trust, and this one has never been watched at all.

**Architecture: The "generated headers are in sync with the TypeScript" CI step cannot pass on a clean checkout, and passes on a stale one**

`packages/bellows-embedded/tools/gen-tables.mjs`

generateParamsHeader() at line 407 reads TS_DIST = packages/bellows/dist/bellows.js, the built bundle. dist/ is in .gitignore and not committed, and there is no prepare or postinstall script in either package.json. The CI 'parity' job (ci.yml lines 89-127) runs npm ci, fastmath, tables, then `node tools/gen-tables.mjs --check` with no build step anywhere before it, so on a clean runner the step exits 2 rather than checking anything. In the working repo, where dist exists but is older than src, warnIfDistStale() prints a warning and the check then reports ok and exits 0. So the gate that docs/HANDOFF.md credits with catching "the new Eq6 class the moment it appeared" either errors out or compares the C++ against a stale build artifact instead of against the TypeScript source it names.

**Instrument algorithms: String waveguide is up to 23 cents flat above the fundamental: the dc blocker's phase lead is compensated only at f0**

`packages/bellows/src/engines/waveguide.ts:541-552`

updateLoop computes pd = onePolePhaseDelay + dcBlockerPhaseDelay + dispersion at the fundamental only, and sets readDelay = n - 1 - pd. The dc blocker (dcR = 0.9995) contributes about -14 samples of phase LEAD at 41 Hz but only about -7 at 82 Hz, so once the loop is compensated at f0 every partial above f0 sees a loop that is too long. The fundamental partial lands correctly; harmonics 2 and up are flat by a fixed cents offset, and the ear follows the series, so the note reads flat. This is inharmonicity of the wrong sign as well as the wrong size: real strings stretch sharp. The pluck engine, which has no dc blocker, is clean at the same pitches, so this is specific to waveguide.ts. The only pitch gates in test/engines-physical/waveguide.test.ts are at 440 Hz (error -1.3c) and 220 Hz, i.e. exactly where the error is small; nothing tests the bass, and the cello preset (octave -1) and dou

**Docs and claims: packages/bellows-embedded/README.md size table: 9 of 15 rows are stale, one by 26 KB of flash and 152 KB of RAM**

`packages/bellows-embedded/README.md` Confirmed by review at minor.

The headline "You pay only for what you include" table has not been regenerated since the exact-delay-sizing change and several others. check-docs.mjs only reads docs/HARDWARE.md, so nothing guards this file. Row by row against ./tools/size-report.sh right now: Kick+Snare+Hat RAM 1500 (actual 1532); Pluck<80> 6536/10052 (actual 6616/8388); Pluck<20> 6664/36740 (actual 6552/29988); Va 28528/1364 (actual 28576/1376); Eq3 6808/1344 (actual 6984/1392); StereoDelay<100> 1744/66688 (actual 1768/39584); StereoDelay<500> 1744/263296 (actual 1760/193184); Plate 5712/222684 (actual 5664/156728); "everything, constructed and driven" 61328/375340 (actual 35104/223324). The StereoDelay and Plate RAM figures are the pre-exact-sizing numbers that docs/HARDWARE.md line 280 says were replaced. This is the front page of the embedded package and the first thing a prospective user reads.

**Docs and claims: packages/bellows-embedded/README.md registry table is stale and its stated conclusion ("thirty-four times the RAM") is wrong and contradicts HARDWARE.md**

`packages/bellows-embedded/README.md` Confirmed by review at minor.

Line 72 gives the string-keyed registry as 30264 B flash / 37580 B RAM. The real s6_registry is 30488 / 30872. Line 74 then concludes "Eight times the flash and thirty-four times the RAM" (37580/1100 = 34.2, consistent with its own stale number). The true ratio is 30872/1100 = 28.1x, and docs/HARDWARE.md line 56 states "twenty-eight times the RAM" for the same measurement. Two documents state the same fact differently, and the README's version is the wrong one. This is the single load-bearing design rule of the package, so the number carrying it should be the one a command printed.

**Coverage and gates: b.render() is not reproducible for the rng pattern the README and every doc page teach**

`packages/bellows/src/bellows.ts`

Bellows.rng(label) (src/bellows.ts:242) reads from this.renderCtx.rngCache during a render and from this.liveRng otherwise. That only works if b.rng(label) is CALLED INSIDE the clock callback. If the caller captures the stream once, outside the callback (const melody = b.rng('melody')), the callback closes over the LIVE stream object, so a render consumes and advances live state instead of a fresh cache. Two renders of the same seed then produce different music, and a render after live playback differs from a fresh page load. This is exactly what README.md:68, packages/bellows/README.md:68, apps/workbench/src/docs/pages/generative-music.ts:17,18,152 and every file in apps/workbench/src/examples/ teach (basics.ts:221, sequencing.ts:20,58,151, firstsounds.ts:64, engines.ts:221). generative-music.ts states the opposite outright: 'await b.render({ bars: 8 }) produces exactly what a fresh loa

**Embedded package: Pluck::NoteOn writes past excite_[] when the runtime sample rate exceeds twice the template rate (ASan-confirmed)**

`packages/bellows-embedded/src/bellows/engines/pluck.h` Confirmed by review at major.

kExciteLen is 2 * kMaxPeriod, derived from the TEMPLATE parameter kSampleRate. len is derived from the RUNTIME sr_ passed to Init(): len = round(sr_ / freq_) with freq_ clamped only at kMinFreqHz below. The comb-tail path is clamped (`if (total > kExciteLen) total = kExciteLen`) but the first fill loop at line 56, `for (int i = 0; i < len; ++i) excite_[i] = ...`, is not. Pluck<20,48000> gives kExciteLen 4808; Init(192000) plus NoteOn(20) makes len 9600. Note this is the same latent flaw that at 96 kHz merely detunes (see the next finding) and at 192 kHz corrupts memory. excite_ is also the only array in the class with no initialiser, so before the first NoteOn it holds whatever was in .bss.

**Embedded package: Six buffer-owning classes silently disagree when the template sample rate and the Init() sample rate differ**

`packages/bellows-embedded/src/bellows/engines/pluck.h`

Pluck, Tube, StereoDelay, Chorus, Flanger, Compressor and Limiter all size storage from a template int and then compute coefficients from the float handed to Init(). Nothing checks that the two agree, and every read clamps rather than reporting, so the failure is inaudible-as-a-fault and audible-as-wrong-music. Concretely: Chorus<44100> has kLineSamples = (31*44100+999)/1000 = 1367, but at Init(48000) the longest tap is (25 ms centre + 5 ms sweep) * 48000 = 1440 samples, so ReadCubic clamps and the deepest chorus voice stops sweeping. Pluck<20,48000> at Init(96000) needs a 4800-sample loop and gets max_ = 2404, so the lowest notes sound roughly an octave sharp. docs/HARDWARE.md and src/bellows/platform/README.md both document 96 kHz as a supported Daisy rate, and both tell the user to read the rate back from the SDK rather than assume it, which is precisely the path that produces the mis

**Facade, kernel, IO: render() posts structural messages straight at the LIVE kernel, so exporting while playing rewrites the live mix**

`packages/bellows/src/bellows.ts`

This is the highest-risk defect in the slice. postEvents() (bellows.ts:224-230) correctly quarantines events into renderCtx.events during a render. post() (bellows.ts:182-186) does not: it records into this.setup and then calls this.kernel.post(msg) unconditionally, with no renderCtx branch. Every structural call reachable from Instrument goes through Bellows.structural() -> post(): fx(), fxParam(), send(), gain(), pan(), plus masterFx/masterGain/bus on the facade. render() re-runs every registered clock callback for the whole horizon in a tight synchronous loop (bellows.ts:589-592), so each of those calls fires at the live worklet immediately and out of time, and the live mix ends the render pinned to whatever value the callback computed for the LAST tick of the horizon. This is not hypothetical. apps/workbench/src/examples/effects.ts:59-63 (the shipped TAPE DELAY CHARACTER example) cal

**Facade, kernel, IO: A 622-byte SFZ file allocates 352 MB; 644 bytes throws RangeError. #define expands eagerly and doubles per line**

`packages/bellows/src/io/sfz.ts`

sfz.ts:338 stores each #define already substituted: this.defines.set(def[1], this.substitute(def[2])). Because substitution happens at definition time, a chain where each define references the previous one twice doubles the stored string on every line. N lines produce 2^N characters. maxIncludeDepth (default 16, sfz.ts:319/324) bounds #include recursion, so the recursion hazard was considered, but nothing bounds macro expansion: not the number of defines, not the length of a stored value, not the total expanded size. This is the only part of the library that parses hostile data and it runs in a browser, where the SFZ path is a user-chosen file or a fetched URL. Past V8's max string length the failure is a RangeError('Invalid string length'), which is not one of the parser's own 'sfz: ' errors, so a caller catching the documented error shape does not catch this. Below that threshold it is

**Facade, kernel, IO: One NaN permanently kills the audio graph: Ramp latches NaN and no later value, panic included, recovers it**

`packages/bellows/src/kernel/engine.ts`

Ramp.set (engine.ts:35-38) computes step = (target - v) * rate. With a NaN target, step is NaN. Ramp.next (engine.ts:46-57) tests `if (this.step !== 0)`, which is TRUE for NaN, then both landing comparisons (nv >= target, nv <= target) are false, so it takes the else branch and assigns this.v = NaN. From then on v is NaN forever, and every subsequent set() recomputes step = (good - NaN) * rate = NaN, so the ramp can never be rescued. Ramp backs channel gain, channel pan, per-bus send levels, bus return level and master gain, so masterGain(NaN) silences the entire output permanently with no error, no kernel 'error' reply, and no console message. Reachability is through unvalidated public methods. b.masterGain(v), inst.gain(v), inst.send(bus, level) and b.bus(fx, {level}) do no Number.isFinite check anywhere between the facade and the Ramp; BootOptions.masterGain is posted unchecked at bel

## Major (34)

**Music theory: Non-12-EDO is real only at the Tuning object; the scale layer above it still assumes 12 semitones per octave, and the documented degree workflow produces a non-octave octave**

`packages/bellows/src/theory/scales.ts`

Tuning itself is correct (EDO, JI, cents, Scala all verified below). But Scale.degreeToMidi (scales.ts:100) returns `(octave + 1) * 12 + rootPc + intervals[idx] + wrap * 12`: the octave stride is hardcoded to 12 and `intervals` are 12-EDO semitones. Bellows.freqOf (bellows.ts:443) then does `this.tuning.freqOf(sc.degreeToMidi(...))`, feeding a 12-EDO note number into an arbitrary tuning. Under Tuning.edo(19) a C major scale's seven degrees land at 0, 126.3, 252.6, 315.8, 442.1, 568.4, 694.7 cents and its "octave" (degree 7) at 757.9 cents, a frequency ratio of 1.54926 instead of 2. degreeFreq() in tuning.ts:158 is the one function that does this correctly (it wraps by tuning.size and treats intervals as tuning steps), and it is exported from index.ts:47 but called from nowhere in packages/bellows/src or apps/workbench/src. There is also no non-12 scale or chord vocabulary shipped: SCALES

**Music theory: romanToChord reads 'b' and '#' relative to the current scale, so bVII / bVI / bIII in a minor key give the wrong chords**

`packages/bellows/src/theory/chords.ts` REFUTED.

chords.ts:296-297 computes `root = mod12(scale.degreeToMidi(degree) + offset)` where offset is -1 for 'b'. In standard roman numeral analysis the accidental is relative to the major-scale (parallel major) reference degree, not to whatever the current mode already has. In A natural minor, degree 6 is already G, so 'bVII' lowers it again to F#. The single most common minor-key progression there is, i - bVI - bVII - i, resolves to Am - E - F# - Am instead of Am - F - G - Am. Same for 'bIII' (gives B instead of C) and 'bVI' (gives E instead of F). chordToRoman is unaffected because it finds an exact diatonic degree first, so the round trip looks clean in tests and only user-typed numerals break.

**Music theory: fast() reports a cycle length that is wrong when n does not divide the pattern length, breaking the module's stated wrap invariant and corrupting stack()'s LCM**

`packages/bellows/src/seq/pattern.ts`

pattern.ts:128-134 sets `at: step => p.at(step * n)` with `length: ceil(p.length / n)`. The true period of step -> p.at(step * n) is p.length / gcd(n, p.length), not ceil(p.length / n). The module header at pattern.ts:16 states as an invariant that "All constructors produce patterns that wrap: at(i) === at(i mod length)". For fast(3, len 4) the declared length is 2 but the sequence only repeats after 4 steps. Anything that drives a sequencer off `.length` (bar length, loop points) desyncs, and stack() at pattern.ts:70-79 folds the wrong length into its LCM, so a stacked pattern's declared cycle no longer repeats either.

**Architecture: core/register.ts places the composition root in the bottom layer, producing 22 of the repository's 26 upward imports**

`packages/bellows/src/core/register.ts`

CLAUDE.md: "Dependency direction is one way: types and core at the bottom, then dsp, then engines/fx/analysis, then kernel/io, then the facade. Never import upward." core/register.ts lines 10 through 32 import 13 engines and 9 effect modules, so the file the rule places at the bottom depends on the whole of layer 3. docs/AUDIT.md finding 12 states "a grep confirmed it was the only one anywhere in `core`, `dsp`, `engines`, `fx`, `theory`, `seq` or `analysis`" -- that claim is false as written; register.ts sits in core/ and imports upward 22 times, and core/scheduler.ts imports a type from seq/. The underlying problem is not the file, it is that the repository has three composition roots (core/register.ts, render/banks.ts, kernel/worklet-entry.ts) and no composition layer to put them in, so each was filed under whichever domain seemed closest. render/banks.ts even documents the intent -- "

**Architecture: Six embedded units' hand-copied Params defaults are gated by nothing, and params.gen.h has no compile-time consumer**

`packages/bellows-embedded/src/bellows/params.gen.h`

params.gen.h emits 22 kDefaults arrays as `inline constexpr float`. Its own header says "the C++ port copies them by hand into each class's nested struct Params" and "if a param was added, renamed or re-defaulted in TypeScript and the C++ side was not updated, it shows up in this diff" -- that is a human reading a diff, which docs/AUDIT.md finding 11 already established is not a control. Nothing in src/, test/ or tools/ references the `bellows::params::` namespace, so the generated constants are compiled by the standalone-header check and read by no code. I verified the parity harness does cover the units it renders: mutating Pluck::Params::damp from 0.35f to 0.44f moved the pluck row from 4.96e-6 to 2.97e-1 against a 5e-5 gate. But comparing the 22 units in params.gen.h against the 19 parity rows, six units are rendered by no parity case at all: limiter, gate, flanger, tremolo, autopan,

**Instrument algorithms: Bow position comb delay is twice the physical value: the bow sits at 2 x bowPos of the string length**

`packages/bellows/src/engines/waveguide.ts:604` Confirmed by review at minor.

`const combDelay = 2 * clamp(this.bowPos, 0.02, 0.45) * this.periodN` where periodN = sr/freq is the full round trip 2L/c. A bow at fraction b from the bridge has its injected wave return inverted after a round trip to the near bridge, 2*(bL)/c = b*periodN samples, not 2*b*periodN. The doubled delay gives |1 - g e^{-j4 pi n b}|, an envelope of sin(2 pi n b), while the file comment on line 24 claims it matches 'the sin(pi n bowPos) coupling envelope of a bow at bowPos of the string length'. The two clauses in that comment cannot both be true. Consequence: with the default bowPos 0.11 the engine has the notch pattern of a bow at 0.22 of the string length, and the ParamSpec range 0.06-0.2 physically spans 0.12-0.4, well past any real bowing position (roughly 1/12 to 1/6). The sibling pluck engine uses the correct convention, `combD = round(pickPos * n)`, and I verified it by measurement. Th

**Instrument algorithms: West coast wavefolder has no antialiasing: at the default fold amount, alias energy exceeds harmonic energy above about 800 Hz**

`packages/bellows/src/engines/westcoast.ts:137-139`

The core oscillator is a band-limited BLEP triangle, but it is then pushed through `foldback(x, gain)` (dsp/waveshaper.ts:35, a periodic triangle wrap with infinite-slope corners) up to six times in series at the base sample rate. There is no oversampling and no polyBLAMP, even though docs/ENGINEERING.md section 2.1 specifies 2-point polyBLAMP for antialiased clippers and the package already ships src/dsp/oversample.ts. The LPG masks part of it at the shipped defaults but not at the top of the range. Separately, foldback is an idealized periodic wrap, not a model of a Buchla 259/258 fold chain (which has a bounded number of soft-cornered folds and saturates); the file comment says the notes 'open up and relax like a Buchla timbre sweep', which is a simile rather than a claim, so I am reporting the aliasing rather than the folder's identity.

**Instrument algorithms: Ladder filter cutoff is uncalibrated: the -3 dB corner lands at 0.435 x the requested Hz across the whole range**

`packages/bellows/src/dsp/filters.ts:169-175`

`set()` puts each of the four one-pole stages at the requested cutoff (g = 1 - exp(-2 pi fc / (2 fs))). Four cascaded identical one-poles have their composite -3 dB point at fc * sqrt(2^(1/4) - 1) = 0.4350 * fc, so the va engine's `cutoff` parameter, labelled in Hz, is off by a factor of 2.3 (more than an octave). The file comment calls this 'a Huovilainen style four stage transistor ladder', and docs/ENGINEERING.md section 2.3 spells out the Huovilainen tuning polynomials (fcr = 1.8730 fc^3 + 0.4955 fc^2 - 0.6490 fc + 0.9988, acr = -3.9364 fc^2 + 1.8409 fc + 0.9968) and the half-sample feedback delay precisely because they are what make the composite corner track fc. Neither is implemented. The 2x internal rate is also a zero-order hold of the input with the second sub-sample taken as output, with no interpolation or decimation filter, so it buys integration stability rather than alias 

**Instrument algorithms: Bowed source spectrum falls at 13 to 15 dB per octave, not the documented 6 to 9, and the gate that is supposed to check this is one-sided with 26 dB of headroom**

`packages/bellows/src/engines/waveguide.ts:175`

docs/BOWED-STRINGS.md round two, item 1 sets the target: 'the sustained bowed spectrum, body off, must tilt roughly minus 6 to 9 dB per octave', a Helmholtz sawtooth being -6. The shipping combination of BOW_LOOP_FC_CAP = 4200 Hz on the loop, BOW_HAIR_FC = 3500 Hz on the injected force, the doubled-length comb and the tanh on the injection overshoots that target by more than a factor of two, so the bowed string is duller than a Helmholtz source rather than close to one. The gates written for it (h8 at or below -12 dB, h12 at or below -16 dB relative to h1) have no lower bound, so an arbitrarily over-damped source passes: the measured h8 is 26 dB below the gate. This is exactly the failure mode docs/AUDIT.md finding 16 describes.

**Docs and claims: packages/bellows-embedded/README.md parity table quotes the pre-Milestone-2 formant and plate rows, at gates that no longer exist**

`packages/bellows-embedded/README.md` Confirmed by review at minor.

Lines 174 and 177 print formant 7.85e-4 max abs 3.74e-4 gate 0.005, and plate 2.44e-3 max abs 1.91e-3 gate 0.005. Those are the numbers from before the uint32 LFO phase change. docs/HARDWARE.md's own "before / after" table at line 690 lists exactly 7.85e-4 and 2.44e-3 as the BEFORE column. The README is therefore advertising the drift the project fixed, and quoting gates (0.005) that were tightened to 0.00015. A reader comparing the README against a real `npm run parity` run sees different numbers for rows the README says prove the port honest.

**Docs and claims: BELLOWS_FAST_MATH kick figure of 1448 bytes appears in two documents and is wrong in both; the real figure is 924**

`packages/bellows-embedded/README.md` Confirmed by review at major.

README.md line 129 and docs/HANDOFF.md line 75 both say the flag "takes the kick from 3760 to 1448 bytes". docs/HARDWARE.md line 116 says 3760 to 924 B, a 75 percent saving, and check-docs.mjs verifies that row against the size report every run. So the verified copy of the number is 924 and the two unverified copies are 1448. The derived claim differs too: 1448 would be a 61 percent saving, and the README of the flag would understate it.

**Docs and claims: docs/HANDOFF.md still says the Daisy path has never been built and daisy.h has never seen the real SDK; HARDWARE.md and examples/README.md say it has**

`docs/HANDOFF.md`

HANDOFF.md line 96, inside Milestone 1, reads: "Then the Daisy path, which has never been built end to end because libDaisy is not an Arduino framework. `bellows/platform/daisy.h` is written and compiles as a no-op off-target; it has never seen the real SDK." docs/HARDWARE.md line 529 says the opposite: "The Daisy path has now been built end to end against the real SDK: libDaisy 8.1.0 (commit c02245d)", with a linked firmware image and a two-row FLASH/SRAM table. examples/README.md repeats the newer version ("daisy_onekick/ is that port done for real, against libDaisy 8.1.0, linked as a Daisy Seed firmware image"). HANDOFF is the document the KICKOFF prompt tells a fresh session to read second, so this is the copy most likely to be believed, and it is the stale one. Note also that I could not independently reproduce the Daisy table: libDaisy is not present on this machine (the Makefile's

**Docs and claims: docs/HANDOFF.md rule 12 quotes registry costs of 30296/30828; the size report says 30488/30872**

`docs/HANDOFF.md`

HANDOFF.md line 74 states the registry comparison as "30296 bytes of flash and 30828 of RAM against 3760 and 1100 direct". docs/KICKOFF.md line 68 repeats the same two wrong numbers. The verified copy in docs/HARDWARE.md (which check-docs.mjs re-measures every run) is 30488 / 30872. This is described in the same sentence as "the single load-bearing design rule of that package", so it is the one number in HANDOFF that most deserves to be a measured one.

**Docs and claims: docs/KICKOFF.md states the test suite as 80 files / 1146 tests in two places; it is 81 / 1173**

`docs/KICKOFF.md`

KICKOFF.md line 31 ("80 test files, 1146 tests") and line 52 ("npm test 80 files, 1146 tests") are both stale. docs/HANDOFF.md line 8 has the correct 81 files / 1173 tests. KICKOFF is a prompt template that a fresh session is told to paste as its first message, and line 52 sits under "VERIFY EVERYTHING WITH THESE. Run them before you claim anything works", so a session that runs npm test and gets a different count than the prompt promised has been handed a false baseline on its first tool call. Separately, the KICKOFF "Milestone 2" variant (lines 105 to 116) still frames both the BLEP cost work and the uint32 LFO phase as objectives to be designed, and quotes the chorus gap as "4e-2 now"; HANDOFF records both as DONE and parity now reports chorus at 2.02e-4.

**Docs and claims: packages/bellows-embedded/examples/README.md: four of the five example rows are stale, in a table whose own caption says it cannot drift**

`packages/bellows-embedded/examples/README.md`

Only 01_OneKick (3776/1100) still matches. 02_DrumMachine reads 29696/1588 against 29688/1620; 03_PolySynth 30304/3776 against 30408/3872; 04_ScalesAndTuning 8080/36928 against 7936/30176; 05_MidiInstrument 30296/3792 against 30344/3888. The file then says of the split between .ino and logic header: "test/sketches/p4_e1_onekick.cpp includes that same header and is what the size report compiles, so the numbers above come from the code you are reading rather than from a copy of it that can drift." The mechanism works; the numbers still drifted, because nothing re-reads this file. The prose is wrong too: "04 is 8 KB... and its 36 KB of RAM is the delay line that is the string" should be 7.9 KB and 30 KB, the 36 KB being another pre-exact-sizing figure.

**Docs and claims: docs/HARDWARE.md's VA symbol breakdown repeats the estimate-by-subtraction error the same document says it corrected: the DSP row is 2.7x too large**

`docs/HARDWARE.md`

Lines 82 to 93 give "Symbol breakdown of the VA voice sketch, 28552 bytes total", then "tables plus libm ~21.5 KB" and "Va, Ladder, Adsr, Svf code ~7 KB". Three problems. (a) The sketch is 28576 bytes, not 28552. (b) The five itemised symbols above the rule sum to 20086 B (19.6 KiB), and a real count of every table plus every libm symbol is 24660 B (24.1 KiB); ~21.5 KB is neither. (c) Every bellows:: code symbol in that image sums to 2632 B, i.e. 2.6 KB, not ~7 KB. The two summary rows were evidently chosen to add up to the sketch total, which folds the harness and the uncounted libm into the DSP row. That is precisely the flaw the document itself records at lines 268 to 272 for the s5_all table ("Those were estimated by subtraction from the twenty largest symbols rather than counted, and the subtraction quietly folded the harness into the DSP row"). The s5_all table was fixed; this one 

**Docs and claims: docs/ENGINEERING.md section 2.1 specifies polyBLEP as the default oscillator; the shipping code is a tabulated Kaiser-sinc BLEP, and PRD section 3 repeats the wrong description**

`docs/ENGINEERING.md`

ENGINEERING.md line 58 states "Default: **2-point polyBLEP** for saw/square... **4-point**... as a quality tier", followed by the two residual polynomial sets. Nothing in src/dsp/oscillators.ts uses either. The class comment there says the polynomial residuals were measured insufficient and "the residual here is tabulated from the integral of a Kaiser windowed sinc spanning 32 samples", and docs/HANDOFF.md line 74 records the same decision with the measurement (-37 dB for 4-point polyBLEP against about -90 dB tabulated) and adds "Do not 'simplify' it back". docs/PRD.md line 37, describing what is built "as built in v0.1", also says "polyBLEP saw/square/PWM, polyBLAMP triangle". So the two documents a new contributor reads for the DSP design both describe an algorithm the project deliberately rejected, and one of them tells them not to reintroduce it only in a third file.

**Docs and claims: docs/ENGINEERING.md section 2.3's ladder filter formulas are not what LadderFilter implements: no tuning polynomials, no V_T, no ZDF feedback solve**

`docs/ENGINEERING.md`

Section 2.3 specifies two tiers with concrete constants: a Huovilainen tier with V_T = 25.85 mV, the tuning polynomials fcr = 1.8730fc^3 + 0.4955fc^2 - 0.6490fc + 0.9988 and acr = -3.9364fc^2 + 1.8409fc + 0.9968, and a half-sample delay in the feedback path; and a Zavalishin ZDF tier with the algebraic feedback solve S = (G^3 s1 + G^2 s2 + G s3 + s4)/(1+g), u = (x - kS)/(1 + kG^4). src/dsp/filters.ts implements neither. It is a 2x-oversampled four-stage tanh ladder with g = 1 - exp(-2 pi fc / (2 fs)), k = 4 * resonance clamped at 1.05, a half-input compensation term, and no tuning correction at all. None of the six constants in section 2.3 appears anywhere in the source. docs/PRD.md line 100 compounds this by listing "constant-transcription errors in Dattorro and ladder tuning tables" as a live risk mitigated by golden renders; there are no ladder tuning tables to mis-transcribe.

**Docs and claims: apps/workbench/public/llm.txt claims to be exact for 0.1.5 but predates the audit fixes: no rampParam, no fx capacity options**

`apps/workbench/public/llm.txt`

Line 11 of the generated reference says "Everything in it is exact for version 0.1.5." It is not. Instrument.rampParam, added by AUDIT finding 3 and present in both src/bellows.ts and dist/bellows.d.ts, does not appear anywhere in the file. Neither do the maxSeconds / maxSize construction-time capacity options from AUDIT finding 5. The file is dated 2026-07-04 while dist was built 2026-08-04, so it is stale even against dist. This matters because five of the fourteen workbench documentation pages send readers to /llm.txt as the authoritative parameter reference: the Engines page says "Every engine's exact parameter list, with ranges, defaults, and curve hints, is in the generated reference at /llm.txt", and the Effects and Presets pages say "listed exactly" and "listed exactly in /llm.txt". docs/HANDOFF.md release ritual step 5 requires regenerating it; that step was skipped for the audi

**Coverage and gates: The plate reverb has no gate that any wrong constant can trip**

`packages/bellows/src/fx/plate.ts`

test/fx-time/plate.test.ts asserts only qualitative properties: tail still audible at 1 s, density above 0.5, |correlation| < 0.9, decay monotonic, predelay silent, bit-exact at mix 0, bounded at max decay. None of these constrain the Dattorro topology. Six independent mutations of the paper's own numbers all passed the entire 1173-test suite. The plate is also absent from test/golden, so nothing else sees it. The C++ port has a plate parity row (1.34e-5), but parity only proves the two implementations agree, not that either matches Dattorro: a wrong constant ported faithfully passes parity too.

**Coverage and gates: Three of the saturator's four curves can be replaced by a linear gain with the suite green**

`packages/bellows/src/fx/saturator.ts`

shapeOne (src/fx/saturator.ts:111) dispatches on curveIdx: 0 tanh, 1 softClip, 2 foldback, 3 the Chebyshev TableShaper. test/fx-dyn/saturator.test.ts measures only curve 0 (lines 61, 75, 97, 108, 158). Curves 1 and 2 appear once each in 'every curve stays finite and bounded at high drive' and curve 3 once in 'is deterministic', neither of which measures what the curve does. Because updateComp() renormalises RMS after any shaper change, replacing a curve with x*drive stays finite, stays audible, and stays deterministic, so both of those assertions still hold. The golden render uses the saturator at its default curve 0, so it does not see the other three either.

**Coverage and gates: Svf cutoff frequency can be off by nearly 10 percent before any test notices**

`packages/bellows/src/dsp/filters.ts`

The Svf is the shared filter behind eq (six bands), va's svf mode, formant, and several engines. Its cutoff gate is 'is about -3 dB at cutoff with Butterworth q', asserted as -4 < dB < -2 (test/dsp-filt/filters.test.ts:36-40, and the same shape for hp at :54). For a 2nd-order Butterworth that band admits roughly an 11 to 14 percent cutoff error. Multiplying the trapezoidal integrator constant g = tan(pi*fc/fs) by 1.01 changes nothing anywhere in the suite; the first failure appears at +10 percent, and then only through the notch test and the formant engine, not through the lowpass or highpass gates that are nominally the cutoff gates. The golden render drives va with cutoff 900, and even +30 percent does not move it, because va's default filterType is the ladder, not the Svf.

**Coverage and gates: rng.shuffle and rng.gauss are never called by any test, and rng.int's top value is never asserted**

`packages/bellows/src/core/prng.ts`

prng.ts is the determinism substrate for the whole library, yet coverage reports fn.shuffle (line 42) and fn.gauss (line 52) as never executed, and grep finds no call site anywhere in packages/bellows/src or packages/bellows/test. Their only appearance in the repo is apps/workbench/src/docs/pages/generative-music.ts:25-26, where they are taught as public API. test/prng.test.ts:38-42 checks only that r.int(7) lands in [0,7), so an int() that can never return n-1 (a classic Fisher-Yates-adjacent off-by-one) passes. rng.weighted, by contrast, is well gated: breaking it fails 10 tests across four files.

**Coverage and gates: The C++ parity harness never numerically compares eleven ported classes**

`packages/bellows-embedded/test/parity/render.cpp`

npm run parity passes 19 rows, but render.cpp constructs only Rng, Kick, Hat, Snare, Pluck, Va, Fm, Modal, WestCoast, Formant, Tube, Eq, StereoDelay, Saturator, Compressor, Chorus, Plate and Tuning. Ported classes that exist in src/bellows and are never driven against the TypeScript: Flanger, Tremolo, AutoPan, RingMod (fx/modfx.h), Limiter, Gate, EnvFollow (fx/dynamics.h), VoicePool (voicepool.h), Kernel and EventRing (kernel.h), Bank (bank.h), LSystem (seq/lsystem.h), plus NoiseGen's pink/brown/velvet/crackle colours and SineOsc, which are only reached incidentally. They appear in test/sketches/ (s9i_dynamics, s9j_modfx, s9n_kernel, p1_drums, p2_poly8, p3_workstation), but those sketches exist for size measurement and assert nothing about output. LSystem also has no row in npm run tables, whose 317 rows cover euclid, euclidrot, scale, chord, parsenote, notename, ca, arp, tempo, tempoinv

**DSP core: BLAMP table's "drift removed" step is the wrong correction, and costs the triangle 36 to 48 dB**

`packages/bellows/src/dsp/oscillators.ts` Confirmed by review at major.

buildTables() integrates step[i] - (d >= 0 ? 1 : 0) with the trapezoid rule (lines 216-223) across a grid that straddles the unit step's discontinuity at d = 0. The trapezoid over-counts the unit step by exactly half a grid cell, 1/(2*TABLE_RES) = 7.8125e-3, so ramp[n-1] comes out at -7.812e-3 instead of 0. Line 225 then removes that as a LINEAR ramp across the whole table. The artifact is not linear: it is a localised step at d = 0. The subtraction therefore leaves a 3.906e-3 discontinuity at the centre of the BLAMP kernel, 3.2% of the table's peak value 0.12206. The correct construction needs no drift term at all. Integrating the unit step analytically over each cell (uInt = d1 <= 0 ? 0 : d0 >= 0 ? dd : d1) gives a total of 2.97e-14, i.e. the residual is odd about d = 0 and its integral is zero by symmetry, exactly as the step table's own odd symmetry (2.89e-15) implies. This is also w

**DSP core: WavetableOscillator.setPosition(NaN) makes next() throw a TypeError on the audio thread**

`packages/bellows/src/dsp/wavetable.ts`

setPosition (line 244) guards with clamp(pos, 0, 1), but clamp in src/types.ts line 177 is `v < lo ? lo : v > hi ? hi : v`, and both comparisons are false for NaN, so NaN passes straight through. In next(), fpos = NaN (line 264), f0 = Math.floor(NaN) = NaN (line 265), frames[NaN] is undefined (line 267), and line 268 dereferences it. This is not a NaN sample, it is a thrown TypeError inside process(). In an AudioWorklet that kills the processor node for the rest of the session. It is reachable through the ordinary public parameter API: engines/wavetable.ts line 111 computes setPosition(base + depth * lfo + envAmt * e) from the position, scanDepth and envToPosition params, so a NaN on any of them lands here. Every dsp module is re-exported from src/index.ts (lines 62-72), so a library user calling setPosition directly hits it too.

**DSP core: LadderFilter's cutoff is 2.3x flat against the SVF, and the two share one param declared in Hz**

`packages/bellows/src/dsp/filters.ts` REFUTED.

LadderFilter.set (line 172) computes g = 1 - exp(-2*pi*fc/fs2) and gives that pole frequency to each of the four one-pole stages, with no composite tuning correction. Four identical one-poles put the composite -3 dB corner at sqrt(2^(1/4) - 1) = 0.435 of the stage pole frequency, so asking for 1000 Hz gets a knee at 434 Hz. Huovilainen's model, which line 10 names, carries a tuning polynomial for exactly this reason. In isolation this is arguably the Moog pole-frequency convention: the resonant peak does land at 0.98 to 1.05 of the requested value. The defect is that engines/va.ts feeds one `cutoff` param, declared `{ name: 'cutoff', min: 20, max: 20000, default: 9000, curve: 'exp', unit: 'Hz' }`, to either filter depending on filterType (line 161). At the default cutoff of 9000 the ladder's knee is at 3906 Hz and the SVF's is at 9000 Hz, so flipping filterType moves the perceived bright

**DSP core: NaN on any user-settable parameter permanently poisons every recursive unit; clamp() does not stop it**

`packages/bellows/src/dsp/filters.ts`

clamp in src/types.ts line 177 passes NaN through, and the hand-written guards do the same thing: Svf.update line 65-66 uses Math.min(Math.max(cutoffHz, 1e-3), fs*0.49) and Math.max(q, 1e-3), both of which return NaN for a NaN input. Once a NaN reaches a recursive state variable there is no path back, because none of these units has a reset-on-non-finite and reset() is not called on a parameter change. Confirmed non-finite-forever after a single bad set(): Svf (NaN cutoff, NaN q, NaN gainDb in bell mode), LadderFilter (NaN cutoff, resonance or drive), OnePole (setLowpass(NaN)), Adsr (NaN attack or NaN sustain), Smoother (a NaN target sticks after the target is set back to a good value), EnvelopeFollower (one NaN input sticks forever, because `v > this.y` is false for NaN so it takes the release branch). Everything else hostile I threw at these units is handled correctly: q = 0, negative 

**Embedded package: config.h documents BELLOWS_SAMPLE_RATE as sizing "delay lines, pluck loops" and those are exactly the two that ignore it**

`packages/bellows-embedded/src/bellows/config.h`

config.h says of BELLOWS_SAMPLE_RATE: "Default rate used by the template defaults that need to size buffers at compile time (delay lines, pluck loops)." tube.h, modfx.h (Chorus, Flanger), dynamics.h (Compressor, Limiter) and plate.h all default their kSampleRate template parameter to BELLOWS_SAMPLE_RATE. pluck.h and delay.h hardcode the literal 48000. So `-D BELLOWS_SAMPLE_RATE=96000` correctly resizes the bore, the chorus line, the flanger line, the compressor lookahead, the limiter window and the plate tank, and leaves Pluck<> and StereoDelay<> sized for 48 kHz, which is the direction that breaks (see the previous two findings). The flag is the one knob a user reaching for a non-default rate will pull first, and it half-works.

**Embedded package: 05_MidiInstrument: pitch bend never reaches a sounding note, contradicting its own header comment**

`packages/bellows-embedded/examples/05_MidiInstrument/midiinstrument.h`

The header comment states: "Bend is applied by retuning every sounding voice once per block, which is the same rate a param ramp steps at in the TypeScript kernel and far finer than a pitch wheel is played." No such retune exists. bend_ratio_ is written by the kPitchBend case and read only by HzOf(), which is called only from the kNoteOn case. operator() handles the dirty_ flag for cutoff and nothing else. Moving the wheel while a chord is held does nothing at all; the bend only takes effect on the next note-on. bellows::Va has no API to change a sounding voice's pitch anyway (freq_ is written only in NoteOn), so the claimed behaviour is not merely unimplemented, it is not currently implementable against that engine. This is the flagship MIDI example and the pitch wheel is the second thing anyone tries.

**Embedded package: The only call site of the kernel in the tree passes its arguments in the wrong order**

`packages/bellows-embedded/test/sketches/s9n_kernel.cpp`

The signature is PushNoteOn(uint32_t frame, uint16_t note_id, float hz, float vel, uint8_t target = 0) and PushNoteOff(uint32_t frame, uint16_t note_id, uint8_t target = 0). The sketch calls them as if the order were (note_id, hz, vel, frame). So it schedules note 50 at 0.9 Hz with velocity 0 at frame 0, note 60 at 0.7 Hz with velocity 64 at frame 1, and a note-off at frame 0 for note id 96 which was never on. It compiles because float-to-uint16_t is a legal implicit conversion in a function call. Its comment claims "Two notes inside one block, so the splitter actually splits" but the two events land at frames 0 and 1, and the render comes out at 5.4x full scale. Since grep finds no other Push* call anywhere in examples/, test/ or docs/, nothing in this repository exercises the kernel correctly. The flash/RAM row the sketch produces is probably still valid (it does instantiate and reach 

**Facade, kernel, IO: A clock callback that creates a channel or bus permanently duplicates it in the setup log and the live kernel on every render**

`packages/bellows/src/bellows.ts` Confirmed by review at minor.

Same root cause as the structural leak above, but the damage is cumulative rather than transient. voice(), bus(), samplerInstrument(), granular(), defEngine() and defEffect() all call post(), and createChannel / createBus / registerBank / registerGrain / defOp are the messages SetupLog.collapseKey (setuplog.ts:27-52) deliberately never collapses. So each render permanently appends a fresh copy to this.setup AND creates a real channel in the live worklet that nothing will ever dispose. Renders are cumulative with each other: N renders leave N duplicate sets. HANDOFF item 3 says 'If you add a facade method with side effects, decide explicitly how it records and replays'; the decision for the constructors was never made, and there is nothing in the code or the docs that tells a user a clock callback must not create anything.

**Facade, kernel, IO: defOp is evaluated on the MAIN thread by render(), not only in the worklet realm the docs name**

`packages/bellows/src/kernel/engine.ts`

There is exactly one eval sink in src (grep for `new Function` and `eval(` excluding the generated bundle returns only kernel/engine.ts:320 and a comment in core/serialize.ts:5), which is good. The problem is that the security note attached to it names the wrong realm, in all three places it appears: AUDIT finding 9 ('code execution in the worklet realm'), HANDOFF item 8 (same words), and the comment at engine.ts:316-319 ('Tier 3: user DSP ... Blocked by CSP in some hosts'). renderOffline (render/offline.ts:27) applies the same message stream through the same KernelEngine.apply on whatever thread called it, and Bellows.render() replays the recorded setup log, which filters only 'events' (bellows.ts:595) and therefore still carries every defOp. The worklet realm has no DOM, no fetch, no cookies and no localStorage. The main thread has all of them. An app that lets users author defs and th

**Facade, kernel, IO: Multi-track MIDI event insertion is quadratic on the audio thread: 1302 ms for 100000 events**

`packages/bellows/src/kernel/engine.ts`

Confirms AUDIT finding 8 and sharpens it. pushEvent (engine.ts:364-375) binary searches then arr.splice(lo, 0, e), which is O(n) memmove per insert. Two things the finding does not say. First, the ordering matters enormously and the finding's threshold is wrong for the common case: a single ascending score, and the note-on/note-off pair stream the facade actually emits, both stay near-linear because inserts land at or near the tail. Second, the realistic MIDI-import shape is the bad one. A format-1 file has one MTrk per instrument, all spanning the same time range, so posting track 2 inserts 12500 events into the middle of an existing queue of 12500. That is where it goes quadratic. The severity is higher than a main-thread stall would be, because KernelEngine.apply runs inside this.port.onmessage in the AudioWorkletProcessor (kernel/worklet-entry.ts:33-40), which is the audio rendering 

## Minor (50)

**Music theory: chordToRoman throws for any scale degree past the seventh, so five of the thirty-two shipped scales cannot be analysed, with a misleading message**

`packages/bellows/src/theory/chords.ts`

ROMANS has seven entries (chords.ts:185) and chords.ts:245 throws 'chord root does not map to a scale degree' when `degree >= ROMANS.length`. The root does map; only the numeral table is short. This makes diatonicTriads(s).map(c => chordToRoman(c, s)) throw for every scale with more than seven degrees: 'bebop dominant', 'bebop major', 'octatonic half-whole', 'octatonic whole-half' (8 each) and 'chromatic' (12). Roman analysis of an octatonic collection is not standard practice, but throwing from a shipped public API on a shipped scale name is not the right failure, and the message points at the wrong cause.

**Music theory: voiceLead minimises motion only; it produces textbook parallel fifths on IV to V and implements none of the classical part-writing prohibitions**

`packages/bellows/src/theory/voicelead.ts`

What voiceLead (voicelead.ts:129-163) actually implements: minimal total absolute voice motion (with sorted-to-sorted matching, which is genuinely the optimal assignment as the comment at voicelead.ts:85-91 claims), a hard range limit [low, high], a per-doubled-note penalty, a crossing penalty that only applies when voice counts differ, and closed spacing by construction (closedVoicings at voicelead.ts:60-83 keeps adjacent voices within an octave). What it ignores: parallel fifths, parallel octaves, direct/hidden fifths and octaves, leading-tone resolution, seventh resolution, per-voice SATB ranges, and open voicings entirely. Neither the source nor the README claims those rules, so this is a scope statement rather than a defect, but README.md:120 ("nearest-motion voice leading") next to PRD.md:43 ("real theory") invites the assumption that it writes acceptable four-part harmony. It does

**Music theory: chordToRoman can never emit a sharp accidental for a seven-note scale, so raised degrees are always spelled flat**

`packages/bellows/src/theory/chords.ts`

chords.ts:227-244 tries the 'b' interpretation before the '#' one. In any scale with no gap larger than two semitones (every diatonic mode, harmonic and melodic minor, both Neapolitans, and so on), every chromatic pitch class is a semitone below some scale degree, so the 'b' branch always succeeds and the '#' branch at chords.ts:236-244 is unreachable. F# in C major comes back as bV; standard analysis writes #iv (the #ivo7 of a secondary-dominant or augmented-sixth context) far more often than bV.

**Music theory: CHORD_TYPES has no augmented-major-seventh, so the diatonic III7 of harmonic minor is unnamed**

`packages/bellows/src/theory/chords.ts`

CHORD_TYPES (chords.ts:13-38) covers 24 stacks, all of which are correct, but omits [0,4,8,11] (augmented major seventh, C+M7 / Cmaj7#5). That chord is the diatonic seventh on the third degree of harmonic minor, so stackType at chords.ts:143-157 falls through to '?' for a chord that is fully diatonic in a shipped scale.

**Music theory: buildProgression with bars = 2 emits no cadence chord because the two cadence branches collide**

`packages/bellows/src/theory/progressions.ts`

progressions.ts:76-86: for bars = 2 the only generated index i = 1 satisfies both `i === bars - 1` and `i === bars - 2`, and the `bars - 1` branch wins, so the result is [0, 0], tonic to tonic, with the documented "dominant-function penultimate, tonic last" silently skipped. Separately, FUNCTIONAL_WEIGHTS is a major-mode function table (its own comment at progressions.ts:16 says so) and buildProgression has no mode parameter, so applied to a minor scale, degree 4 is a minor triad and degree 6 is a subtonic rather than a leading-tone chord, and the weights (V->I at 5, viio->I at 4) no longer describe the harmony they are named for.

**Architecture: Schroeder Allpass is a dsp primitive implemented twice, verbatim, inside the fx layer**

`packages/bellows/src/fx/reverb.ts`

fx/delay.ts:69 and fx/reverb.ts:93 both declare `class Allpass` with an identical constructor and an identical next(). The only difference is that delay.ts leaves `g` mutable and reverb.ts marks it readonly. Neither is exported. CLAUDE.md says "engines and fx consume dsp", and a Schroeder allpass on a DelayLine is exactly a dsp unit: it takes its length in samples, processes one sample at a time, and both copies already import DelayLine from ../dsp/delayline. Two copies means a fix to one silently does not reach the other, and the golden render only covers whichever paths the fixture exercises.

**Architecture: ChromaAnalyzer and OnsetDetector each hand-roll the STFT framer that dsp/stft.ts already provides**

`packages/bellows/src/analysis/chroma.ts`

dsp/stft.ts exports class Stft with exactly the interface these two need: a power-of-two size check, hann window, ring buffer, hop counter, RealFft, and push(samples, from, to) with an onFrame callback. analysis/chroma.ts:110-120 and analysis/onset.ts:96-106 each rebuild that framer from RealFft and hann directly, with byte-identical constructor blocks and near-identical push loops, and neither imports dsp/stft. Only fx/spectral.ts uses StftProcessor. The layering rule is not broken here (analysis -> dsp is downward) but the reuse the layering exists to enable is not happening, and there are now three hop/window/overlap implementations to keep consistent.

**Architecture: SampleZone and SamplerZoneData are field-for-field twins bridged by an unchecked cast**

`packages/bellows/src/render/banks.ts`

kernel/messages.ts:14 declares SamplerZoneData and engines/sampler.ts:43 declares SampleZone with the same 17 fields in the same order. The single bridge is render/banks.ts:19, `bank.addZone(zone as SampleZone)`. The duplication has a real reason (the kernel bundle must not pull in engines/), but the `as` cast is the wrong join: I added a required field to SampleZone in a worktree and tsc reported it at engines/soundfont.ts:74, engines/soundfont.ts:249 and test/sampler/helpers.ts:23 -- and not at banks.ts:19. The bridge point itself is blind, and drift is only caught incidentally by whatever else happens to construct a zone literal. An optional field added on the message side produced no error at all.

**Architecture: The public surface is 293 symbols from one flat barrel, half of it uncurated, with implementation details out and signature types missing**

`packages/bellows/src/index.ts`

index.ts uses 43 curated named-export lines and 33 `export *` lines. The curated half is coherent; the star half is where the leaks are. Emitting declarations and resolving the barrel gives 293 exported symbols. Leaked internals include the Ogg container plumbing (oggCrc, buildOggPage, opusHead, opusTags, opusPacketSamples, oggOpusMux), MIDI varint codecs (encodeVlq, decodeVlq), loudness internals (kWeightingCoeffs, BiquadCoeffs) and sfz internals (sfzNoteValue, IncludeResolver) -- none of which any doc page or the README mentions. Deliberately exported implementation details beyond the SetupLog and VoicePool that docs/HANDOFF.md already flags: KernelEngine, internParam, createKernelNode, KERNEL_PROCESSOR_NAME, bankEngineResolver. internParam mutates a module-global param index table shared with the worklet realm, so exporting it lets a user desynchronise the two sides. Going the other w

**Architecture: TempoPoint is declared in the contracts file and used nowhere**

`packages/bellows/src/types.ts`

types.ts:118 exports `interface TempoPoint`. It is referenced by no other file in src, no test, no app, and it is not re-exported by index.ts. types.ts is the one file CLAUDE.md names as the contract every domain touches, so a dead declaration there is worse than a dead declaration anywhere else: it looks like a contract somebody is honouring. seq/tempomap.ts presumably outgrew it.

**Architecture: Bellows.render() carries the offline replay algorithm inside the facade**

`packages/bellows/src/bellows.ts`

bellows.ts is 758 lines holding three classes. Bellows itself has 26 instance fields and roughly 40 public methods, and it is genuinely a facade for most of them -- one-line delegations to the transport, the registry, the kernel and the theory layer. The exception is render() at lines 552 to 610, which is not delegation: it rebuilds a Transport from this.transportOps, replays bpm, ramp-with-anchor and swing ops onto it, expands every subscription over scheduleHorizon, sorts the resulting ticks, drives the callbacks against a renderCtx, filters the setup log and only then calls renderOffline. That is the offline-fidelity contract docs/HANDOFF.md item 3 describes, living in the class whose job is supposed to be routing calls elsewhere. It is also the method HANDOFF item 4 says must never grow an await, an invariant that would be easier to hold and to test in a module with a narrow signatur

**Architecture: engines/soundfont.ts still imports types from io/, three months after the audit recorded it**

`packages/bellows/src/engines/soundfont.ts`

docs/AUDIT.md finding 9 records this and docs/AUDIT.md "Still open after this pass" carries it forward. It is unchanged: lines 20 and 21 import ResolvedZone and SoundFont from io/sf2 and SfzEnvelope and SfzRegion from io/sfz, both upward from layer 3 to layer 4. core/scheduler.ts:18 has the same shape, importing type Transport from seq/transport, and the audit does not mention that one at all. Both are type-only so both cost nothing at runtime, and both are the kind of edge a dependency-cruiser rule would hold at zero ongoing effort. Recording them as "the one place the layering rule is bent" while there are two, plus 22 more in core/register.ts, is the part worth fixing in the document.

**Instrument algorithms: The body resonator bank raises its strongest mode by only 1.3 dB over dry, and its largest single feature is an undocumented forest mode**

`packages/bellows/src/engines/waveguide.ts:158-161`

The structure is faithful to docs/BOWED-STRINGS.md section 1 (RBJ constant-peak bandpasses, dryGain 0.35, makeup 0.8) and the anchor frequencies are genuine published violin signature-mode values (A0 275, CBR 405, B1- 465, B1+ 550, bridge hill 2300). But the arithmetic of the specified topology caps the effect: a unity-peak bandpass with table gain 1.0 summed against a 0.35 dry bleed gives at most 20*log10(0.35 + 0.8) = +1.2 dB at a mode centre, so the bank behaves as a broadband 3 to 7 dB loss with narrow small bumps rather than as a resonating body (a real violin shows 15 to 25 dB between the signature modes and the inter-mode valleys). The repo's own gate asserts only g550 > 1.25 * g825, i.e. 1.9 dB of contrast, which codifies the weak effect rather than testing the intent stated in BOWED-STRINGS section 7 item 1 ('at least +6 dB over the inter-mode floor').

**Instrument algorithms: The bowed string is a single loop with a feedforward comb, not a bidirectional waveguide with the bow at a scattering junction**

`packages/bellows/src/engines/waveguide.ts:700-738`

STK's Bowed (which the file cites for the friction table, and which it matches exactly) runs two delay lines, neckDelay and bridgeDelay, and computes the differential velocity at the bow junction as bridgeReflection + nutReflection, so the bow position and the string velocity the bow actually servos against fall out of the geometry. Here there is one loop, and `const dv = bowVelInst - y` uses y, the loop read at the output/bridge tap, as the string velocity at the bow. The bow position enters only as a feedforward comb on the injected force. The header is honest that this is a 'single loop equivalent of a bidirectional waveguide', and for the injected-force path a comb is the correct reduction, but the feedback side of the nonlinearity is not: the friction sees the wrong point on the string, so the pressure and position dependence of the slip is driven by a signal that does not have the 

**Instrument algorithms: Modal glass and wood mode tables have no physical source, unlike the bar and membrane tables**

`packages/bellows/src/engines/modal.ts:58-71`

Materials 0 and 1 are genuine: the free-free bar ratios 1, 2.756, 5.404, 8.933, 13.345, 18.638 are the textbook transverse values, and the membrane ratios 1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501 are the Bessel zero ratios. Material 2 is a recognisable bell set (the tierce at 2.4 is a minor third above the octave partial). Materials 3 (glass, 1, 2.32, 4.25, 6.63, 9.38) and 4 (wood, 1, 2.572, 4.644, 6.984, 9.723) correspond to no plate, bar or shell family I can identify, and the comments do not cite one. The engine header says 'the material param picks a preset mode table', so nothing is overclaimed, but two of the five tables are invented while the first two are real, and a reader cannot tell which is which from the file.

**Instrument algorithms: Formant engine carries only the bass voice, so every register sings with a bass tract**

`packages/bellows/src/engines/formant.ts:36-43`

The five vowel rows are exactly the bass rows of the Csound manual's 'Formant Values' appendix, frequency, dB and bandwidth columns all matching, and the filter implementation reproduces them faithfully. The appendix also carries tenor, countertenor, alto and soprano rows, and the differences are large (soprano /a/ has F1 at 800 Hz against the bass 600, and F1 rises above 1 kHz for high sung notes). With one table the engine sings a top-of-staff note through a bass tract. The file comment does say 'of a bass voice', so this is a scope note rather than a wrong claim.

**Docs and claims: docs/HARDWARE.md gives s5_all's post-exact-sizing RAM as 223280 in one place and 223324 in another; 223324 is correct**

`docs/HARDWARE.md`

Line 282 reads "Measured: `s5_all` 300144 to 223280 bytes (25 percent)". Line 412, three paragraphs later, reads "In `s5_all` after exact sizing, the single `StereoDelay` buffer is 192152 of 223324 bytes, 86 percent". The size report says 223324, and check-docs.mjs verifies the 223324 in the profiles table at line 434. So 223280 is the odd one out. The 25 percent conclusion is unaffected (300144 to 223324 is still 25.6 percent), which is why nothing caught it.

**Docs and claims: docs/HARDWARE.md per-shape oscillator paragraph quotes s9e_westcoast at 16768 and p1_drums at 20832; both are 16 to 24 bytes low**

`docs/HARDWARE.md`

Lines 308 and 309 say "`s9e_westcoast` went 27064 to 16768 bytes and `p1_drums` 29448 to 20832". The current after-figures are 16784 and 20856. The same two sketches appear in the per-module table and the profiles table further down, where check-docs.mjs verifies them at 16784 and 20856, so the document disagrees with itself by 16 and 24 bytes. Almost certainly the LFO fixed-point change (which HARDWARE.md line 696 records as costing "at most 64 bytes of flash on any sketch") landed after this paragraph was written.

**Docs and claims: docs/HARDWARE.md's closing summary says bellows uses "well under one percent of flash" on every viable board, contradicting its own Daisy row**

`docs/HARDWARE.md`

Line 460 reads: "Restated plainly: on every viable board, bellows uses well under one percent of flash and under half the RAM, and delay buffers are the only thing that moves the needle." The board table five lines above does not say that for Daisy: its Daisy row reads "fits in internal flash, 94 KB spare", because the STM32H750 has 128 KB of internal flash and the ported set is 34 KB, which is 27 percent, not under one percent. The whole point of the paragraph directly below the table ("The Daisy row is the striking one... it fits in internal flash and needs no bootloader at all") is that Daisy is the tight case, so the summary sentence undoes it. The RAM half of the sentence does hold (223324 of 524288 is 42.6 percent), though the table renders that as "40 %" for three boards where 42 to 43 percent is the arithmetic, and Teensy's "20 %" where 223324/1048576 is 21.3 percent.

**Docs and claims: docs/ENGINEERING.md section 2.5's onset detector spec does not match src/analysis/onset.ts: wrong window, wrong hop, no log compression, different peak picking**

`docs/ENGINEERING.md`

Section 2.5 specifies spectral flux as "L1 half-wave-rectified magnitude difference with log compression log(1+g|X|), g ~ 1-20; 2048-sample Hann window @ 44.1k, hop 441 (10 ms). Peak picking (Dixon): local max over +/-3 frames AND >= mean(SF[n-9...n+3]) + d AND >= 30-50 ms since last onset. Optional adaptive threshold d + median(...)". The implementation uses a 1024-sample frame with a hop of 256, computes flux as a plain half-wave-rectified magnitude difference with no log compression at all, and does peak picking as a three-frame local max against a trailing median of 21 frames times 1.5 plus 0.01 (the "optional" branch, not the specified Dixon one). The YIN threshold (0.1), the MPM key-maximum ratio (0.93), the BS.1770 K-weighting prototypes, the Cytomic SVF tick, the Dattorro lengths and diffuser gains, and the phase-vocoder N=2048 / Ha=N/4 / identity-locking spec all do match, which

**Docs and claims: docs/HARDWARE.md opens with "Reproduce any of it with" and three commands, but four of its tables cannot be reproduced by any of them**

`docs/HARDWARE.md`

Lines 4 to 16 say "Every number here is measured, not estimated" and then "Reproduce any of it with:" followed by size-report.sh, size-report.sh cortex-m4, and check-header.sh. The double-precision recursion table (lines 186 to 190), the oscillator residual-versus-harmonic ns table (lines 756 to 761), the whole-firmware Teensy table and the Daisy table are none of them producible by those commands. tools/check-docs.mjs's own header comment names exactly this set as uncovered, so the gap is known there but is not stated in the document making the promise. The double-precision benchmark in particular has no source in the tree at all: I wrote an equivalent 64-tap recursion and got M7 128 vs 144 B, M4 128 vs 1808 B, M0+ 1656 vs 4536 B, which supports the qualitative conclusion strongly but reproduces none of the three published penalties, and there is no way to tell whether that is my benchm

**Docs and claims: docs/HARDWARE.md's toolchain attribution says GCC 11.3, but size-report.sh picks 9.2.1 first on this machine**

`docs/HARDWARE.md`

Line 5 attributes every freestanding figure to arm-none-eabi-g++ 11.3. size-report.sh's find_tool falls back to `find ~/.platformio/packages -name arm-none-eabi-g++ | head -1`, which on this machine returns toolchain-gccarmnoneeabi (9.2.1) before toolchain-gccarmnoneeabi-teensy (11.3.1). packages/bellows-embedded/README.md line 34 repeats the 11.3 claim. I checked whether it matters and it does not: I re-ran the whole report with 11.3 forced onto PATH and every one of the 38 rows was byte-identical, so the figures are correct under both. But the stated provenance is not the provenance a fresh run gets, and "which compiler produced this" is exactly the kind of thing this project has decided to pin (the Teensy section already pins platform, framework and toolchain versions for the same reason).

**Docs and claims: Theory doc page comments romanToChord('bVII', cmaj) as "borrowed Bb"; chordName renders it A#**

`apps/workbench/src/docs/pages/theory.ts`

Line 70 reads `romanToChord('bVII', cmaj); // borrowed Bb`. The chord is correct (root pitch class 10), but the library's own chordName spells it A#, so a reader following the surrounding examples (which all show chordName output) and printing this one gets 'A#'. Every other value assertion on this page and on tuning, generative-music, presets, analysis and custom-dsp verified exactly, so this is the single miss in 48 checked claims and it is a spelling convention rather than a wrong result.

**Docs and claims: docs/HANDOFF.md release ritual quotes the standalone bundle at about 97 KB gzip; it is 104 KB**

`docs/HANDOFF.md`

Step 3 of the release ritual says "check dist/worklet.js exists and the standalone size is sane (about 97 KB gzip at 0.1.0)". The current dist/bellows.standalone.js gzips to 106617 bytes, 104 KB. The figure is honestly labelled "at 0.1.0" so it is not strictly false, but it is being used as a sanity threshold for a release at 0.1.5, and 104 against a remembered 97 is exactly the kind of 7 percent drift a sanity check is supposed to either accept or flag. Also worth noting for the same step: dist is currently stale against src (gen-tables.mjs warns about it), so anyone following the HANDOFF contract to "run pure-library snippets in Node against dist before editing claims" is testing against a build that is missing recent source changes.

**Docs and claims: docs/HARDWARE.md says individual functions are 400 to 500 bytes and then cites one at 528**

`docs/HARDWARE.md`

Line 274 reads "Individual functions are 400 to 500 bytes: `Svf::Update` is 444, `NoiseGen::Process` is 528." Both cited sizes are correct against s5_all, but 528 is outside the range the same sentence states. Trivial, and I mention it only because this document's standard is that a stated number be one a command printed, and the range here is the one part that was not.

**Coverage and gates: The golden render covers 4 of 18 engines and 3 of 18-plus effects, and is the only whole-piece guard**

`packages/bellows/test/golden/golden.test.ts`

pieceSetup() uses engines va, fm, kick and pluck, and effects saturator (channel, default curve), fdn (bus) and compressor (master). Absent: additive, wavetable, snare, hat, clap, tom, noise, string, tube, modal, westcoast, formant, granular, harmonic, and the sampler and soundfont paths; and effects delay, tapeDelay, multitap, plate, limiter, gate, transient, chorus, flanger, phaser, tremolo, autopan, ringmod, freqshift, eq, plus every spectral effect. The golden is doing genuine work where it reaches: of 17 mutations the suite caught, it was the sole detector for 5 of them (envelope attack rate, compressor crest time constant, fdn diffuser gain, fdn modulation depth, the equal-power pan law). That is the point: the parts of the signal path it does not touch have no equivalent, and the per-effect tests are qualitative enough that several of them do not fill the gap.

**Coverage and gates: The all-effects integration gate only rules out NaN, silence and blow-up**

`packages/bellows/test/integration/offline.test.ts`

'runs each effect on a va note without NaN or silence collapse' (offline.test.ts:70-95) asserts nan === false, peak > 1e-4 and peak < 8 for every registered effect. Any effect that degrades into a dry passthrough, or into a plain gain, satisfies all three. That is what let C1, C2, C3 (three saturator curves flattened to a linear gain) and the five plate mutations through. This is a reasonable smoke test and should stay, but it is currently the ONLY thing several effects have beyond their own qualitative unit file, so it is worth not mistaking it for coverage.

**Coverage and gates: voiceLead's unequal-size branch, including the crossing penalty, is never executed**

`packages/bellows/src/theory/voicelead.ts`

motionCost (src/theory/voicelead.ts:92) has two branches. The equal-sizes branch is covered. The unequal-sizes branch (lines 98-119), which does nearest-note assignment and adds crossPenalty for each inversion in that assignment, is never reached by any test: coverage reports src/theory/voicelead.ts at 79.43 percent with lines 98-119 uncovered. That branch is exactly the doubling case the docstring calls out ('needed when the previous voicing has more voices than the chord has pitch classes'), and it is the case a real four-part progression hits.

**Coverage and gates: Scheduler.rewind() has no test, and it is on the b.start() path**

`packages/bellows/src/core/scheduler.ts`

Bellows.start() (src/bellows.ts:373) calls this.scheduler.rewind() before starting the transport. Coverage reports Scheduler.rewind (scheduler.ts:62) and get size (:57) as never executed; src/core/scheduler.ts sits at 83.92 percent with lines 58-59 and 63-69 uncovered. Making rewind a no-op fails nothing. Since rewind is what resets step counters so a restarted transport replays the piece from step 0, a regression there means the second b.start() of a session plays from the wrong step, and the suite would stay green. b.start, b.stop, b.pause, b.resume, b.panic, b.bpm, b.rampBpm and b.swing are all in the never-called list from coverage too, so this is one instance of a broader hole: the transport control surface of the facade has no test.

**Coverage and gates: The Web MIDI runtime path is uncovered: only parsing is tested**

`packages/bellows/src/io/webmidi.ts`

src/io/webmidi.ts is at 68.24 percent statements and 58.06 percent functions. Uncovered: findPort@268, onNote@338, onControl@342, onPitchBend@346, mpeZone@351, dispatch@358, close@383, and the whole output side send@417, noteOn@427, noteOff@432, cc@437, pitchBend@443, close@448. What is tested is message decoding; what is not tested is port selection, the dispatch fan-out, MPE zone handling and every outbound message. This is the path a user's MIDI keyboard and any hardware sync takes, and it is also the path Milestone 5 (the wire) will build on. It needs a fake MIDIAccess the way lifecycle.test.ts has a fake AudioContext.

**DSP core: LadderFilter never self-oscillates, but its doc comment says it does**

`packages/bellows/src/dsp/filters.ts`

Line 168 reads "resonance 0..1 (self-oscillation near 1)". Measured, the impulse tail is dead at every setting the clamp allows. k tops out at 4 * 1.05 = 4.2, but the loop also carries a one-sample delay at the internal 2x rate (s4 is read at line 179 before being written at line 183) and the half-input compensation term, and the combination keeps the loop gain below unity everywhere. The peak resonance the filter can reach is +23.3 dB at fc = 250 Hz, falling to +10.7 dB at fc = 4000 Hz - a resonant filter, not a self-oscillating one, and the peak height is strongly frequency dependent.

**DSP core: DelayLine hangs forever in its constructor for maxSamples at or above 2^30**

`packages/bellows/src/dsp/delayline.ts`

Line 23 is `while (n < maxSamples + 4) n <<= 1;`. JavaScript's << is a 32-bit operation, so once n reaches 2^30 the next shift produces -2147483648, which is still less than maxSamples + 4, and the shift after that produces 0, which is also less. The loop never terminates and never allocates, so it is an unkillable spin, not an out-of-memory throw. The Number.isFinite guard on line 17 does not catch it. Not reachable through the shipping fx: fx/delay.ts capSeconds clamps maxSeconds to CAP_SEC_MIN..CAP_SEC_MAX before multiplying by the sample rate. But DelayLine is public API (src/index.ts line 69), so a library user sizing a line from a bad computation gets a frozen tab rather than an exception.

**DSP core: Adsr.set is documented "Safe to call while running" but stepping sustain mid-note jumps the level instantly**

`packages/bellows/src/dsp/envelopes.ts`

The Sustain branch (line 83-85) assigns this.lvl = this.sus unconditionally each sample, so a new sustain value takes effect in one sample with no smoothing. The comment on line 48 says "Times in seconds, sustain 0..1. Safe to call while running." The times genuinely are safe to change while running; sustain is not. engines/va.ts routes every setParam through apply(), which calls ampEnv.set(...), so moving the sustain slider while a note is held produces a step in the amplitude envelope, and a step in an amplitude envelope is a click.

**DSP core: A voice with sustain 0 never goes idle, and the release tail runs 1.85x the configured release**

`packages/bellows/src/dsp/envelopes.ts`

Two separate lifetime surprises in the same class. First, IDLE_FLOOR is only tested in the Release branch (line 88). When sustain is 0 the decay ends at exactly 0, the stage becomes Sustain, and `active` (line 97) stays true forever. A percussive patch therefore holds its voice slot from noteOn until noteOff, however long that is, and engines/va.ts keeps calling process() on it (its own early-out on line 167 is the same `active` flag). With polyphony 8 that is real stealing pressure for a patch that is silent. Second, the release is specified as ln 100, i.e. 99 percent of the span in the set time, but the envelope only frees at IDLE_FLOOR = 1e-4 absolute. From full level that takes ln(1e4)/ln(100) = 2 release times, so a 0.3 s release holds the voice for 0.556 s. The comment on line 8-9 is technically accurate about the 99 percent, but the voice-lifetime consequence is not stated anywher

**DSP core: StftProcessor and Istft accept hop = fftSize and then silently drop samples**

`packages/bellows/src/dsp/stft.ts`

checkArgs (line 30) allows hop up to and including fftSize. With the default hann window on both sides, the per-position COLA sum falls to zero near the frame edges, the 1e-6 guard on line 184/252 turns those positions into a hard zero, and the output develops periodic dropouts. Nothing throws and nothing warns; the caller gets audio that is quietly 5 percent wrong in RMS. To be clear about what is NOT wrong: there is no gain blowup. The guard does its job, and the header's claim that the exact per-position normalisation reconstructs at unity gain "for any hop where that sum stays above zero" is verified true, including for hops that do not divide the window.

**DSP core: LadderFilter's 2x oversampling has no anti-imaging or anti-aliasing filter, which shows once drive is raised**

`packages/bellows/src/dsp/filters.ts`

next() (lines 187-192) upsamples by holding the input across both ticks and decimates by discarding the first tick's output. Both operations are naive: the zero-order hold puts images above the base Nyquist into the tanh stages, and dropping every other sample folds everything between fs/2 and fs straight back. The class comment (lines 11-12) says it is "run at 2x internally to tame the nonlinearity", which is true as far as it goes, but 2x with no filters buys much less than 2x with them. At the drive every shipping engine actually uses this does not matter: engines/va.ts line 161 calls set(cut, p.resonance) and never passes drive, so drive stays 1 and the filter is clean. The drive argument is public API, though, and it degrades quickly.

**Embedded package: Oversampler drops the maxBlock bound check the TypeScript throws on**

`packages/bellows-embedded/src/bellows/dsp/oversample.h`

src/dsp/oversample.ts throws 'Oversampler block exceeds maxBlock' at the top of both up() and down(). The C++ Up() and Down() have no equivalent: Up(input, from, to) writes (to - from) * kFactor floats into buf2_/buf4_, which are sized kMaxBlock * 2 and kMaxBlock * 4. Both in-tree users chunk correctly before calling (Saturator::Process and Limiter::Process both loop `for (int start = from; start < to; start += kMaxBlock)`), so this is latent rather than live, but bellows::Oversampler is a public class in a header-only library and the class it most resembles in the JS refuses the overrun loudly.

**Embedded package: Lfo sample-and-hold with a null Rng is a constant zero, so Tremolo and AutoPan silently stop modulating in that shape**

`packages/bellows-embedded/src/bellows/dsp/lfo.h`

The TypeScript Lfo constructor falls back to `makeRng('lfo/sh')` when no rng is passed, so sample-and-hold always works. The C++ Lfo takes `Rng* rng = nullptr`, initialises held_ to 0.0f when it is null, and guards the wrap draw with `if (phase_ < prev && rng_)`. With no Rng, held_ is 0 forever. Tremolo::Init and AutoPan::Init both default the Rng to nullptr, so `Tremolo t; t.Init(sr); t.SetParams({rate, depth, LfoShape::kSampleHold, phase});` produces a constant gain of 1 - depth/2 and no tremolo at all, and AutoPan produces a fixed centre pan. Both header comments say to pass an Rng "so the stream stays forkable" / "stays deterministic and forkable", which reads as an optimisation, not as a correctness requirement. Nothing in the parity harness covers the sample-and-hold shape.

**Embedded package: Modal's rng draws move from note-on to the audio path, so retriggering diverges from the JS stream**

`packages/bellows-embedded/src/bellows/engines/modal.h`

The header states: "the JS precomputes the strike pulse into a Float32Array at NoteOn ...; here the raised cosine is evaluated as it is consumed. The rng draw order inside a note is unchanged, so the excitation is identical". That holds for one note played to completion. It does not hold across a retrigger: the JS consumes all `len` draws at noteOn, while the C++ consumes one per rendered sample and a NoteOn during the strike abandons the remaining draws. The two streams then differ for the rest of the patch. It also breaks if one Rng is shared between voices, which the `Init(sr, rng)` pointer signature invites, because the JS forks per voice. The parity harness renders one note so it cannot see this.

**Embedded package: bringup.h Rig::SetStage races the audio interrupt and can wedge the stage machine**

`packages/bellows-embedded/examples/00_BringUp/bringup.h`

SetStage() is called from loop() and writes pending_, phase_ and target_. AdvancePhase() runs inside the Teensy audio software interrupt and also writes phase_ (kFadeOut -> kGap -> kRunning) and gap_left_. If the interrupt lands between loop()'s `pending_ = stage` and `phase_ = kFadeOut`, the ISR's own store of phase_ = kRunning can land last and the fade-out is lost. Because SetStage begins with `if (stage == pending_) return;`, the next call for the same stage is a no-op, so the rig stays on the old stage for the rest of the pass while the .ino keeps printing results attributed to the new one. The window is one block wide and this is a diagnostic sketch, but this sketch is specifically the one whose whole job is to produce trustworthy numbers, and its .ino already carefully calls out the frames_ read race while leaving this one unmentioned.

**Embedded package: Xmur3 hashes plain char, whose signedness differs between the host harness and ARM**

`packages/bellows-embedded/src/bellows/core/prng.h`

`h = (h ^ static_cast<uint32_t>(*p)) * 3432918353u;` with `*p` a plain char. Plain char is signed on x86-64 (where test/parity/render.cpp is compiled and where the prng parity row is proved bit-exact) and unsigned on ARM EABI. For any label byte >= 0x80 the two produce different seeds, so a stream that matches the browser in the parity harness would not match on the board. Every label in the tree is ASCII, so nothing is currently wrong; the parity harness cannot detect it because it only ever runs the host build. Worth noting given the stated endgame of streaming events from bellows.live into the same stream labels.

**Embedded package: midi::Parse writes into *out on paths where it returns false, contrary to its comment**

`packages/bellows-embedded/src/bellows/io/midi_parse.h`

The doc comment says Parse returns false "for system messages, running status (no status byte), and truncated input, leaving out untouched". It sets out->channel, out->data1, out->data2 and out->bend14 before the switch, so every `if (len < 3) return false;` truncation path leaves *out half-written with a stale or default kind field. A caller that reuses one MidiMessage across a byte stream and only checks the bool is fine, but one that inspects the struct after a false return sees plausible garbage. (The status-byte rejections above the assignments do leave it untouched, so the comment is right for exactly the cases nobody worries about.)

**Embedded package: Teensy ToInt16 converts NaN to int16_t, which is undefined behaviour**

`packages/bellows-embedded/src/bellows/platform/teensy.h`

bellows::Clamp is `v < lo ? lo : (v > hi ? hi : v)`, both comparisons false for NaN, so Clamp(NaN, -1, 1) returns NaN and `static_cast<int16_t>(NaN * 32767.0f)` is UB. On Cortex-M7 VCVT yields 0 so the practical result is a sample of silence, but the file's own comment argues carefully that wrapping an out-of-range sample is "the worst failure mode available on a speaker" and this is the one input where the clip does not clip. A self-oscillating LadderFilter or a divide in a feedback path is the realistic source. daisy.h has no conversion so it is unaffected, but it passes NaN straight to the codec.

**Facade, kernel, IO: A sub-block param ramp lands one block LATE, not immediately as documented**

`packages/bellows/src/kernel/engine.ts`

AUDIT.md's still-open list and HANDOFF line 180 both say 'a ramp shorter than a block lands on its destination immediately'. Measured, it does the opposite: the parameter holds its OLD value for the entire block in which the ramp starts, and reaches the destination only at the next block. The cause is ordering: advanceRamps(blockStart) runs at the top of process() (engine.ts:510), before the block's events are applied, and the ParamRamp event that claims the slot is applied later in the same block (engine.ts:530). So the first ramp pass that can see the slot is the next block's. The rest of the ramp behaviour is exactly as documented: a 20 ms ramp interpolates linearly and lands precisely on its destination. Small as it is, this is the class of thing this project's own standards call out, a figure in a doc that no command printed.

**Facade, kernel, IO: A non-finite ramp duration wedges one of the 32 ramp slots forever**

`packages/bellows/src/kernel/engine.ts`

applyEvent guards the ParamRamp duration with `if (e.c > 0 ...)` (engine.ts:398), which correctly rejects NaN (NaN > 0 is false) and falls through to the documented immediate-apply path. Infinity passes the guard. startRamp then computes endFrame = startFrame + Math.max(1, Math.round(Infinity * sampleRate)) = Infinity (engine.ts:423), so advanceRamps never satisfies `frame >= s.endFrame` and never frees the slot, and t = (frame - start) / Infinity is 0 so the parameter never moves either. Reachable as inst.rampParam(name, value, { seconds: Infinity }), or from any user arithmetic that divides by zero. 32 such calls exhaust RAMP_SLOTS and silently downgrade every future ramp on that kernel to an immediate jump (engine.ts:448 returns false, engine.ts:403-404 applies the destination at once).

**Facade, kernel, IO: b.now() is not render-aware, so a callback timing off it misroutes during replay**

`packages/bellows/src/bellows.ts`

Every other time-sensitive facade method branches on renderCtx: noteEvents (bellows.ts:465), noteOnEvent (477), noteOffEvent (486), paramEvent (509), rampParamEvent (526), postAllOff (538) and durationSeconds via activeTransport (232-234). now() (bellows.ts:237-239) returns this.ctx.currentTime with no branch. A clock callback written as inst.note(n, { at: b.now() + 0.1 }) therefore stamps live wall-clock times into renderCtx.events during a replay, so every note in the export lands at roughly the same instant. This is a fourth replay invariant that HANDOFF item 3 does not list.

**Facade, kernel, IO: quick.ts never resets the shared boot promise and never clears its instrument cache**

`packages/bellows/src/quick.ts`

Confirmed still true as AUDIT finding 9 records. quick.ts:13, `if (!shared) shared = Bellows.boot({ seed: 'quick' })`, stores the promise before it settles, so a rejection (the likely case in practice: boot() from outside a user gesture, or a CSP that blocks the blob worklet URL, which createKernelNode at kernel/node.ts:37-43 turns into a thrown Error) is cached permanently and every later play() rejects with it for the life of the page. A second, unrecorded half: the module-level `cache` (quick.ts:10) holds Instrument handles bound to that Bellows and is never cleared either, so even a working reset of `shared` would hand back instruments pointing at a disposed kernel.

**Facade, kernel, IO: createBus, registerBank, registerGrain and defOp still grow the setup log without bound, and there is no removeBus**

`packages/bellows/src/kernel/setuplog.ts`

Confirmed still true as AUDIT.md's still-open list records. collapseKey (setuplog.ts:27-52) returns null for all four, so record() appends every time (setuplog.ts:88-91). That is the right call for one-shot loads, but an app that creates a bus per reforge grows the log, the replayed setup and the live kernel's bus map monotonically. forgetChannel (setuplog.ts:105-116) exists as the escape hatch for channels; there is no equivalent for buses, and the KernelMessage union (kernel/messages.ts:34-53) has no removeBus member, so a bus can never be freed by any means short of disposing the whole Bellows.

**Facade, kernel, IO: Input validation on public methods is inconsistent: some throw, some clamp, most silently accept anything**

`packages/bellows/src/bellows.ts`

There is no stated policy and the behaviour splits three ways with no visible logic. Throws: b.bpm(0/-100/NaN), b.swing(5), a bad note name, an unparseable TimeValue. Clamps: vel (bellows.ts:467), pan (engine.ts:257). Silently accepts: gain, master gain, send level, polyphony (including 0, negative and 1e7), unknown param names, unknown effect ids, out-of-range fxIndex, negative durations, NaN notes. Two of those are worse than cosmetic: NaN gain is finding 3 above, and b.voice('typo') is accepted at the facade, degrades to a console.error in realtime via the worklet's catch (worklet-entry.ts:34-39), but THROWS out of render() because renderOffline calls engine.apply with no try/catch (render/offline.ts:27). Same call, opposite failure modes in the two paths the whole architecture is built on being identical.

**Facade, kernel, IO: The worklet processor returns true forever and dispose() has no way to stop it**

`packages/bellows/src/kernel/worklet-entry.ts`

BellowsKernelProcessor.process returns true unconditionally (worklet-entry.ts:63) and there is no 'shutdown' message in the KernelMessage union. KernelNode.dispose (kernel/node.ts:62-65) only nulls port.onmessage and disconnects the node. When boot owns the context, Bellows.dispose closes it (bellows.ts:624-631) and the point is moot. When it does not, the processor keeps its whole channel map, every VoicePool and every fx buffer resident, and keeps posting meter frames into a port nobody is listening to. That is exactly the workbench's configuration: HANDOFF line 210 records that apps/workbench/src/lib/audio.ts passes closeContextOnDispose: false deliberately so it can reuse one context across reboots, and each reboot builds a fresh kernel node.

## Refuted on review, do not re-raise

- romanToChord reads 'b' and '#' relative to the current scale, so bVII / bVI / bIII in a minor key give the wro
  - REPRODUCED, then refuted on substance. 1. The numbers are real. From the main repo (`npx vite-node` on a scratchpad script importing `src/theory/{scales,chords}`): A minor bVII -> F#, bVI -> E, bIII -> B, VII -> G, VI -> F, III -> C. Identical to the auditor's table. Their harness count is slightly off (`npx vitest run test/theory` printed "5 passed, 72 passed", not 20; 20 is chords.test.ts alone), but that is immate
- Refuted as a defect: fast()'s ceil(L/n) length is the documented and tested contract, and the suggested gcd fi
  - I reproduced the arithmetic and it is exactly as reported, but the conclusion drawn from it does not survive. WHAT I RAN. Worktree at HEAD (4e47b38), probe test through vitest, printing declared length, brute-forced true period, and the wrap check for every combinator: fast(3, len4) declared=2 truePeriod=4 wraps=false [1,4,3,2,1,4,3,2] fast(2, len3) declared=2 truePeriod=3 wraps=false [1,3,2,1,3,2,1,3] fast(2, len5) 
- Ladder cutoff is uncalibrated: -3 dB corner at 0.435x the requested Hz
  - The measurement reproduces; the diagnosis does not. I reproduced the sweep by importing the real class (node --experimental-strip-types against packages/bellows/src/dsp/filters.ts, sine bisection at 44100, amplitude 0.05, res 0): set 100 Hz dc -0.002 dB -3dB at 43.4 Hz ratio 0.4339 set 500 Hz dc -0.000 dB -3dB at 216.9 Hz ratio 0.4338 set 1000 Hz dc -0.000 dB -3dB at 433.8 Hz ratio 0.4338 set 2000 Hz dc -0.000 dB -3d
- Refuted: every listed plate mutation fails the CI parity gate, five of six at over 200x the gate
  - I reproduced the auditor's evidence exactly, then ran the one command they did not run, and it refutes the headline. REPRODUCED (worktree at HEAD 4e47b38, `npx vitest run` in packages/bellows, baseline 82 files / 1183 tests pass): A3 DECAY_DIFF_1 0.7 -> 0.5 1183 passed A4 TAPS_L[0] 266 -> 300 1183 passed A5 DIFF_G -> [0.6,0.6,0.5,0.5] 1183 passed B5 every TAPS_L entry +200 1183 passed C12 DECAY_DIFF_2 0.5 -> 0.1 1183
- LadderFilter's cutoff is 2.3x flat against the SVF, and the two share one param declared in Hz
  - MEASUREMENT REPRODUCED, CONCLUSION REFUTED. 1. The number is real. My own probe (esbuild-bundled src/dsp/filters.ts, integer-period DFT, 0.5 s settle, amplitude 1e-4, DC reference from a constant input) reproduces it: requested dcGain meas-3dB ratio linear-model ratio 100 1.0000 43.5 0.435 43.5 0.435 250 1.0000 108.7 0.435 108.7 0.435 1000 1.0000 435.0 0.435 435.1 0.435 4000 1.0000 1741.4 0.435 1745.8 0.436 8000 1.00

