# VOICE

STATUS 2026-11-12: this is the plan for the first voice, a formant synthesizer, kept as the record of why it was built that way. It was replaced the same day by the articulatory voice of `docs/VOICE-2.md`, which is the plan of record now.

A singing voice for bellows, and what it takes from CHIMERA. Written 2026-11-11, before any
code. Read this before touching `engines/formant.ts` or adding anything that carries lyrics.

CHIMERA is Jameson Hodge's physical-model voice synthesizer,
https://github.com/jamesondh/chimera-vocal-synth, MIT. It simulates the airway itself: a
branched staggered-grid FDTD transmission line (lungs, trachea, glottis, pharynx, oral and nasal
tubes, a sinus cavity, the piriform fossae), a parametric glottis, flow-induced valves for trills,
a two-voice syrinx for birds, a 2D midsagittal anatomy, a gestural score, and an English and
Korean phonetics front end that sings lyrics on notes. It was written in TypeScript, ported to
Rust on 2026-11-05, and the TypeScript engine was deleted in commit `cd247a6`. The TypeScript
original is still readable at `cd247a6^:src/engine`.

Every fact below is labelled the way `docs/LANDSCAPE.md` labels them: MEASURED (a command was
run, on an Apple M1, Node 22.18), SOURCED (read in code, cited), INFERRED (reasoning). CHIMERA
was at `1d3ea49` when this was written.

## The decision

Build a bellows-native singing voice: a new `vocal` engine and a pure lyric layer. Port two
small pieces of CHIMERA under its MIT notice, credit CHIMERA by name for everything else learned
from it, and do not host the CHIMERA wasm now. Hosting it stays a named
option with written entry conditions (see the last section), because it is the only route to
a true articulatory voice: bursts, pressure behind closures, clicks, ejectives and creature sounds
come from the FDTD airway and nothing cheaper reproduces them.

## Why not use it as a library today

Cost, measured in one Node process so the ratio is trustworthy:

| | share of one M1 core |
|---|---|
| CHIMERA wasm, sustained male /a/, 48 kHz | 32.4% |
| CHIMERA wasm, male speech | 34.4% |
| CHIMERA wasm, eight instances | 262% |
| bellows formant, kernel with no voices | 0.12% |
| bellows formant, one voice | 0.78% (0.67% above the floor) |
| bellows formant, eight voices | 5.48% |

So one CHIMERA voice is about 48 times one bellows formant voice (MEASURED). Native Rust is
22.2% for the same male voice (MEASURED), and one internal FDTD step of network plus glottis is
about 1.8 microseconds against 20 ns for the glottis alone (MEASURED). Cost follows the device
rate: the internal rate is the output rate times `floor(60000 / fs) + 1`, which is 2x at 48 kHz
and 1x at 96 kHz (SOURCED, `voice/human_voice.rs:206-208`), and 192 kHz measured 114% of a core.

Size: the wasm is 1,069,776 bytes raw and 367,216 gzipped, against 109,432 gzipped for the whole
`bellows.standalone.js` (MEASURED). Linear memory is 10.2 MB for a male instance and 15.1 MB for
female or child (MEASURED, `memory.byteLength`). It has no imports (MEASURED).

Contract, which matters more than cost:

- It seeds its generators with constants, 777 and 4242 in the glottis and 12345 in the airway
  noise, and no export takes a seed (SOURCED, `sources/glottis.rs:118-119`,
  `airway/network.rs:415`). Two instances render identical samples (MEASURED, 0 of 48000
  differ). Bellows' named forkable streams cannot reach it, and pooled voices would breathe in
  unison.
- It is one mono voice per engine handle (SOURCED, `engine.rs`). Bellows pools voices.
- Commands apply at the next control tick, every 64 output samples (SOURCED,
  `voice/human_voice.rs:226`). Bellows splits blocks at events.
- A body change allocates and can grow memory, which detaches every typed-array view over it
  (SOURCED, `crates/chimera-wasm/src/lib.rs:6-8`). That is allocation on the audio thread.
- Nothing is tagged or published (MEASURED, zero tags; `publish = false`, `"private": true`).
  The exports changed signature on 2026-11-10 (`657af3d`, `engine_set_body(h, body)` became
  `engine_set_body(h, female, child)`). Its `LAYOUT_VERSION` versions the gesture record, not the
  functions, so a host has no signal for an export change. The repository is seven days old with
  200 commits.
- It has no TypeScript twin any more, and `docs/PRD.md:31` says the TS reference implementations
  are the contract and the test oracle. That line was written about bellows' own WASM twins, so
  applying it here is an extension, but the reason behind it applies: nothing in this repository
  could check the wasm's output.
- It has no path to the embedded port.

A separate CHIMERA `AudioWorkletNode` beside the bellows kernel is worse still: the kernel
ignores worklet inputs (SOURCED, `kernel/worklet-entry.ts:43`) and `Bellows.render()` replays only
the kernel, so the voice would bypass channel effects, sends, meters and offline export.

Porting the whole TypeScript engine from `cd247a6^` (about 8,900 lines) is ruled out too: it
measured 58 to 62% of an M1 core per voice, slower than the wasm, and it is frozen at a revision
upstream no longer maintains (MEASURED, Bun, so JavaScriptCore, not V8).

## What bellows takes from CHIMERA

**Ported, with the MIT notice:**

- The glottal pulse: the phase-accumulator area pulse (`sources/glottis.rs:230-246`), the
  per-cycle jitter, shimmer, diplophonia, logistic chaos and fry double pulse
  (`glottis.rs:153-213`), the three-band 1/f drift (`math.rs:236-258`), and the voice mapping
  constants, open quotient `0.78 - 0.36 * tension`, jitter `0.0021 + 0.0245 * roughness`,
  shimmer `0.02 + 0.22 * roughness` (`voice/human_voice.rs:317-350`). TypeScript original at
  `cd247a6^:src/engine/sources/glottis.ts`, 207 lines.
- The lyric front end: the Syllable and Segment model (`phonetics/mod.rs:20-118`), the script
  router (`syllables.rs:143-266`), the onset cluster list and maximal-onset syllabifier
  (`syllables.rs:20-60`), the IPA tokenizer (`ipa.rs`), ARPAbet to IPA and the letter-to-sound
  fallback (`english.rs`), and the consonant durations of the inventory (`inventory.rs`).
  TypeScript originals at `cd247a6^:src/engine/phonetics/`.

**Learned and reimplemented in bellows' idiom, credited by name:**

- Sung timing: the vowel lands on the beat, onset consonants borrow time from the previous note,
  codas finish before the next onset, and a fast passage squeezes consonants proportionally to a
  12 ms floor so a vowel keeps 50 ms (`phonetics/sing.rs:50-192`). Per-sound lead-in
  (`control/beat_player.rs:193-218`).
- Critically damped second-order tracking of articulation targets at 6 to 13 Hz
  (`control/articulators.rs:24-147`).
- Aspiration gated by glottal flow, and noise placed by constriction class
  (`airway/network.rs:1097-1131`, `voice/human_airway.rs:282-341`).
- VOT as an explicit per-segment value (`phonetics/planner.rs:345-349`), and the fixed-capacity,
  in-place plan store for shipping a plan to the audio thread (`control/score.rs:271-436`).

**Used once, offline, as a tool:** CHIMERA's frequency-domain airway solver
(`airway/frequency.rs`), which is exact tree elimination of complex admittances, about 1 microsecond
per frequency (MEASURED), run on its calibrated vowel postures to derive F4 and F5 for IPA vowels
per body. Its closed-glottis bandwidths come out at 11 to 138 Hz (MEASURED), too narrow for a
formant bank, so bandwidths come from Klatt (1980) Tables I and II instead, scaled at constant Q
per body.

**Skipped:** the FDTD network as a pooled engine, the Kaiser decimator (`dsp/oversample.ts`
covers it), `BeatPlayer` (`seq/transport.ts` and `core/scheduler.ts` cover it), the articulatory
planner and gestural score (tied to the 17-key tract), the per-voice limiter, and the Korean
front end until a native speaker has reviewed it upstream.

## Where bellows' machinery replaces CHIMERA's

- Fixed seeds become `rng.fork` labels. Both projects use mulberry32 (SOURCED, CHIMERA
  `math.rs:188-197`, bellows `core/prng.ts`), so a ported unit keeps its noise character and only
  changes where its seed comes from.
- `midi_to_hz` becomes the tuning layer. A sung note arrives in Hz, so it is not 12-EDO by
  assumption.
- CHIMERA's fixed `60 / bpm` grid becomes `TempoMap` seconds.
- The single engine handle becomes a `VoicePool`.
- The pressure-threshold voicing gate becomes the bellows envelope and gate.

## Traps found while planning

1. **`gauss()` is not unit variance.** `core/prng.ts:52` is the Irwin-Hall sum of four uniforms
   times `SQRT2 * 0.875`, so its standard deviation is 0.714 (MEASURED over 1e6 draws: 0.71494;
   analytically 0.71443). `types.ts:35` documents it as roughly unit variance. CHIMERA's
   `gauss` multiplies by 1.7320508 and is exactly unit (SOURCED, `math.rs:206-212`). Ported
   jitter, shimmer and drift would all land 29% shallow without a 1.40 rescale. The drift
   normalises on a unit-variance assumption, so it needs the rescale as much as the jitter does.
   The plan is a local unit-normal helper in the ported unit, plus a fix to the `types.ts`
   comment. Fixing `gauss()` itself would move every engine that draws from it.
2. **The glottis outputs area, not flow.** `glottis.rs:1-4` says so: flow, its skew and the F1
   ripple come from the airway. A source-filter bank needs a flow-derivative excitation, so the port
   adds an area-to-flow step and differentiation. That is new work, not a port, and it decides
   the timbre.
3. **Chaos cannot pass float parity.** The logistic map runs with r up to 4.0
   (`glottis.rs:186-194`). Float32 C++ and float64 TypeScript trajectories diverge
   exponentially, so the 1.5e-4 formant parity gate (`bellows-embedded/test/parity/parity.mjs:91`)
   cannot hold with chaos above roughly 0.62. This binds only when the glottal source is ported to
   C++: its parity rows must then run with chaos 0, and chaos gets a statistical test instead.
   Jittered phase wraps may also land on different samples between float and double; measure
   before assuming they do not.
4. **Pre-roll exceeds the scheduler horizon.** The scheduler looks ahead
   `max(0.12 s, 1.5 * gap)` (SOURCED, `core/scheduler.ts:40,91`). A sung "str" onset was
   estimated at 0.27 s before its beat while planning; as built, `string` measures a `leadIn` of
   0.208 s (MEASURED), still well past the horizon. Raising the global horizon costs
   every other subscriber responsiveness. What was built plans a phrase as a whole and reports its
   `leadIn`; see "Opening consonants and realtime" below.
5. **A new source directory is silently unchecked.** `test/integration/layering.test.ts` drops
   edges to directories missing from `LAYER` and skips directories missing from `PURE`. A new
   `src/lyrics` must be added to both in the same commit.
6. **Legal comments do not survive the build.** `scripts/gen-worklet.mjs:25` sets
   `legalComments: 'none'`, and the main bundle keeps only `/*!` or `@license` comments. The MIT
   text has to ship as a file named in `package.json` `files`, which today lists only `dist`,
   `README.md` and `LICENSE`. A future C++ transcription of the glottis in the embedded package
   carries the same obligation.
7. **The voice's cost is an estimate until the engine is measured.** The 0.78% above is today's
   BLEP-saw formant voice. The glottal pulse adds a `cos` per sample, two under fry, and the engine adds a
   smoother. Measure before using "about one percent a voice" as an argument.

## The design as built

The first plan had nine milestones and its riskiest step was a new kernel message carrying a
phoneme track. Reading the kernel removed that step. A Param event already carries a number to a
channel at a sample-accurate time, in realtime and offline alike, and the kernel keeps insertion
order for events at the same time (`kernel/engine.ts`, `pushEvent`). So a phoneme crosses as its
index in `VOCAL_PHONEMES` on an ordinary `phoneme` parameter, and nothing in `kernel/` changes.

The pieces, bottom up:

- `dsp/glottal.ts`: the CHIMERA glottal pulse, ported, with the area-to-flow step and the gauss
  rescale. Pitch arrives in Hz.
- `dsp/resonator.ts`: the Klatt (1980) two-pole resonator and antiresonator for a cascade formant
  synthesizer.
- `dsp/critdamp.ts`: critically damped second-order tracking, the articulator dynamics CHIMERA
  uses, reimplemented.
- `engines/vocal-phonemes.ts`: the phoneme list the engine answers to (append only, because the
  index is what a saved patch stores) and the acoustic targets per phoneme for male, female and
  child bodies.
- `engines/vocal.ts`: a new engine, `vocal`. A Klatt-style cascade/parallel formant synthesizer
  driven by phoneme targets: glottal source and flow-gated aspiration through a nasal pole and
  zero and a five-formant cascade, frication and stop bursts in parallel. Changing `phoneme` runs
  a small state machine (closure, burst, VOT, affricate frication, nasal murmur). `bend` carries
  pitch inside a phrase. Used like any engine, it sings a vowel.
- `lyrics/`: a new pure layer beside `theory`. Lyrics to syllables (English through an injected
  pronouncing dictionary or letter-to-sound rules, and IPA written between slashes), and
  `planSung`, which times phonemes against notes given in seconds and Hz. It never sees beats or
  MIDI numbers, so tempo maps and tunings apply before it.
- `sing.ts` and `Instrument.sing()`: the facade resolves note durations through the tempo map and
  pitches through the tuning, plans, and posts one NoteOn per phrase with `phoneme` and `bend`
  events inside it. A `sing()` made inside a transport callback replays in `b.render()` exactly as
  `note()` does.

`formant` and its C++ port are untouched. The open `docs/AUDIT-2.md:631` finding (formant carries
only the bass vowel rows) stays open: `vocal` covers male, female and child bodies, but formant is
a separate, ported, cheaper engine and its finding is its own work.

`vocal` is TypeScript only. It appears in `params.gen.h`'s not-ported list, as clap, tom, noise
and granular do, and so it carries no `INSTRUMENT_PRESETS` entry, because `presets:check` requires
a C++ row for every preset.

**Opening consonants and realtime.** `sing()` takes `at` as the time of the first note's beat, and
a phrase that opens on consonants starts before it. Offline, `b.render()` collects every event
before rendering, so they land exactly. Live, events whose time has already passed apply at the
next block, all at once, so an opening consonant whose time has passed is cut short or lost. The
`leadIn` that `sing()` returns says how far ahead to call. It can exceed the plan's own: after an
aspirated p, t or k the engine holds voicing off for the stop's VOT, so `src/sing.ts` sends the
release early by that VOT plus 10 ms and the vowel is voiced on its beat (MEASURED, 70 to 91 ms
late before, 2 to 5 ms after). A per-subscription scheduler lead, which would make this automatic
inside transport callbacks, is not built.

**One line at a time on an instrument.** `phoneme` and `bend` are channel parameters, so two
phrases that overlap on one channel reshape each other. The facade remembers, per vocal channel,
the phrases it has posted (live, and separately inside each `b.render()`), and a new line that
would start inside one starts where that one ends, losing the opening consonants that overlapped
it; `trimmed` in the result says how much went. The earlier line wins because its events are in
the kernel already. When a line ends, the channel gets back the phoneme and bend it was created
with, or last given by an untimed `param()`, not the engine's defaults.

## Credit

The singing voice in bellows owes a large debt to CHIMERA, Jameson Hodge's physical-model voice
synthesizer (MIT). The glottal source and the lyric front end are ported from it. The sung timing
rules, the critically damped articulation smoothing, the flow-gated breath and the upper formant
values for IPA vowels were learned from its code and its calibrated vocal tract. CHIMERA simulates
the airway itself, which is what makes bursts, closures and clicks; if you want an articulatory
voice, use CHIMERA.

That paragraph goes in both READMEs, in this file, and on the workbench Singing page (docs/singing). Ported files
carry a header naming the CHIMERA path and commit and what changed. Files that reimplement a
technique say "follows CHIMERA by Jameson Hodge (path). Reimplemented here." MIT does not require
that for ideas; it is given anyway. Credit for the literature stays with that literature, and
the files that use it cite it: Klatt (1980) for the cascade/parallel synthesizer, its
bandwidths and its consonant targets, and Gold and Rabiner (1968) behind the higher-pole
correction; Hillenbrand, Getty, Clark and Wheeler (1995) for vowel F1 to F3; Lisker and Abramson
(1964) for VOT; Stevens (1998) and Fletcher (1953) for the relative consonant levels. CHIMERA
times speech with Klatt (1979) and Allen, Hunnicutt and Klatt (1987), but the sung durations
here are CHIMERA's inventory values, not those rules (`src/lyrics/durations.ts` compares them).
No CHIMERA name or branding goes into engine ids, labels or presets.

## Decisions, made on 2026-11-11

The owner asked for the choices to be made. These are they, and the reason for each.

1. **No third-party wasm in the library.** The PRD's rule that TypeScript references are the
   contract and the oracle stands, and nothing here could check CHIMERA's output. The evaluation
   in the next section is the only route back to that question.
2. **Contacting Jameson Hodge** is the owner's to do, not this repository's. It is worth doing: a
   heads-up about the credit, and if the wasm question ever reopens, a seed parameter and a tagged
   release upstream are its entry conditions.
3. **The lyric layer ships in the main entry.** The package is `sideEffects: false` with named
   exports, so a bundler drops what a caller does not import, and a first subpath entry would be a
   new precedent for little gain. It is kept out of the worklet bundle, and a test asserts that.
4. **No CMU dictionary is distributed.** `parseCmudict(text)` reads one a caller loads, and
   `b.dictionary` or the `dictionary` option of `sing()` takes the resulting map. Without one,
   letter-to-sound rules run, with the 66 function words built in, and IPA between slashes sets
   the sounds directly; a symbol the voice has no sound for is listed in `unknown`.
5. **A new engine, `vocal`**, rather than more parameters on `formant`. Formant is ported to C++
   and parity-gated, so every change to it moves the embedded port. The singing voice can evolve
   in TypeScript first, and formant stays the cheap vowel pad.
6. **The embedded port gets nothing yet.** Consonants and phrase timing stay TypeScript only.
   A feasibility study on 2026-11-12 transcribed the engine to float C++ in a scratch prototype
   (not in the tree) and measured:
   - **What would go to a device:** the engine and its phoneme table only. The planner, the IPA
     reader, letter-to-sound and any dictionary stay on the host. They already output flat events,
     so a device would play a stored phoneme score: about 10 events a second, 880 B for a
     14-syllable line. Live phonemes fit a MIDI CC value, which the embedded parser already reads.
   - **Parity:** TS events replayed into the C++ voice match the TS render within 1.75e-3 to
     2.40e-3, and single scenarios within 2.0e-4 to 5.4e-4 (MEASURED, parity.mjs metric).
   - **Memory:** 9,184 B of flash for the table and 1,568 B of RAM a voice (MEASURED, M7 `-Os`).
   - **Cost:** 0.78 of a `formant` voice by soft-float operation count, so 8 to 13 voices on a
     Teensy 4.x and 6 to 9 on a Daisy (INFERRED from the one board run). The ESP32-C3 cannot run
     it (MEASURED: 214 percent of a 22.05 kHz frame held, 290 through a phrase).
   - **Before a port:** settle the cascade order in TS (running the correction and upper formants
     first tightens float parity tenfold, but TS has to make the same change, or the phrase
     rows read 4.8e-2), and give the C++ `Rng` a gauss.

   The estimate is about 900 lines of headers and 350 of generator and harness.
7. **Bundle budget: revised to 30,000 bytes of standalone gzip for the voice and its lyric
   layer, which measure 29,150.**
   The first budget, 10 percent of the standalone gzip (109,432 bytes before this work), was
   set before any code and is not met. With the engine registered, the lyric layer exported
   and `sing()` on the facade, the standalone bundle is 138,582 bytes gzipped (`gzip -9`),
   26.6 percent over 109,432, and `dist/bellows.js` went from 139,035 to 176,184 (MEASURED,
   2026-11-12). The review fixes added 2,280 bytes of that: the higher-pole correction, the shared
   release rules, the built-in function words, the overlap rule of `sing()` and the license
   banners. Built both ways with esbuild, the growth splits into three parts: the vocal DSP
   inside the inlined worklet string (about 9.9 KB), the same DSP again on the main thread for
   offline rendering and the registry (about 9.8 KB), and the lyric layer with the facade
   (about 6.3 KB). The cut that would bring it near 10 percent is shipping each DSP unit once
   rather than twice, a change to how every engine is bundled that would shrink all of them,
   so it is its own work and not this voice's. Packing the phoneme table into typed arrays
   (about 3.2 KB of each copy) would save part of that and cost the table its readability,
   which is not worth it while the larger cut is open. Growth of this voice past 30,000 bytes
   is a regression to question.
8. **No change to the golden piece.** The vocal engine is guarded by its own spectral tests.
9. **Korean is not ported.** Upstream says it awaits a native speaker's review.

## Later, and what would decide it

Render the same sung phrases with `vocal` and with CHIMERA built from a recorded commit, outside
this repository, and compare by ear and by consonant spectra. The spectral half was done on
2026-11-11, against CHIMERA at `1d3ea49` built with `cargo build --release -p chimera-cli`: it
found the muffled cascade, the devoiced glides after p, t and k, the released stop before a
stop, the late vowels after aspirated stops and the sibilant levels, all fixed since; the
listening half has not been done. Hosting CHIMERA's wasm is
reconsidered only if all of these hold: upstream has a tagged release, an export takes a seed,
output is bit-identical on aarch64 and x86-64, and the listening result shows the native voice
falls short. The middle road is a Kelly-Lochbaum tract driven by CHIMERA's calibrated area
functions, roughly 30 to 50 times cheaper than the FDTD (INFERRED), which keeps transitions and
loses DC aerodynamics, kinetic losses, real walls and moving-wall sources. A C++ port of `vocal`
for the embedded library is the other natural next step.
