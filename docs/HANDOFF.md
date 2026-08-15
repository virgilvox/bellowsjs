# HANDOFF

State of the project as of 2026-08-13. Read this first when picking the work back up. Companions: `docs/PRD.md` (what and why), `docs/ENGINEERING.md` (platform facts, DSP formulas, packaging research), `docs/AUDIT.md` and `docs/AUDIT-2.md` and `docs/AUDIT-3.md` (findings with evidence), `docs/HARDWARE.md` (the embedded port, with the flash and RAM measurements behind it), `docs/LANDSCAPE.md` (what else exists and where this leads), `CLAUDE.md` (house rules), `docs/KICKOFF.md` (a prompt for starting a fresh session), `docs/prototype-0.html` (the original design probe).

## The 2026-08-13 session, which changed the shape of the project

Four things happened that a reader of the older sections below needs to know
before trusting them, because each one falsifies something those sections say.

**1. It ran on hardware, and there is a CPU number.** A Teensy 4.0 at 600 MHz
played `07_Workstation`, the heaviest program in the set, through a MAX98357A at
44.1 kHz: **34 to 43 percent CPU, 47.2 percent peak**, 2 of 24 audio blocks. That
is Milestone 1's acceptance criterion and it replaces an assumption the whole
repository rested on. It is ONE board and ONE program: no other board has run
anything, and nothing has been compared to the browser by ear. Those CPU figures
are hand recorded from a serial console, so no harness checks them.

**2. The engine set is complete.** `additive`, `harmonic`, `waveguide` and
`wavetable` are ported, so every engine the browser ships now exists in C++. The
parity table is **40 rows, not 34**, and all of them pass:

    harmonic         3.63e-5    additive        1.30e-4
    additive_morph   1.12e-4    waveguide       1.98e-4
    wavetable        2.63e-5    wavetable_low   1.97e-5

Each new port replaced the JS double phase accumulator with the uint32 fixed
point counter in `config.h`, for the reason the LFO change already established:
fixed point is closer to double than float32 is. The additive agent traced its
own residual to a cause rather than accepting it, and recorded in the GATES
comment that a 0.1 percent `morph` error moves the row only 4.4x against a 10x
gate, which is a weakness in that row stated rather than hidden.

**3. All 50 instrument presets exist on the board**, in
`bellows/presets/instruments.h`: a tagged index plus one param table per engine,
so `--gc-sections` still drops engines a sketch never names. There is no
registry. A new harness, `npm run presets:check`, dumps the compiled C++ table
and diffs it against `src/presets/instruments.ts`, mapping names through the
generated `params.gen.h` rather than restating them: **50 presets, 1054 values,
0 failures**, and it was mutation tested. `examples/21_Presets` plays all 50.

**4. The site now documents and demonstrates the port.** The SIMULATOR is the
EMBEDDED PLAYGROUND. The CODE page has a JAVASCRIPT / EMBEDDED switch with 36
embedded examples, every one of them real C++ compiled on every build by
`npm run check:embedded`, shown beside a browser equivalent you can hear. The
DOCS page has a BROWSER / EMBEDDED switch over a nine page embedded tree. There
is an embedded LLM reference at `/llm-embedded.txt`, generated from all 50
headers by `gen-llm-embedded.mjs` with zero unreadable.

### What the audit of that work found, because it is the useful part

Two audit passes over the session's own output found **twelve defects**, all
fixed. They are worth reading as a class: every one typechecked, every one
looked right, and none would have been caught by any existing test.

The four in C++:

- **Every sketch could render before it was initialised.** `AudioMemory()` is
  what opens the audio interrupt (`BellowsAudioStream::update()` returns early
  only while `allocate()` is null), and every sketch called it BEFORE
  initialising its patch. ASan confirms a SEGV in `DelayLineExt::ReadCubic`
  through a null buffer; on an IMXRT1062 the companion write lands at address 0,
  which is ITCM, which is executable. All 16 sketches now init first, and the
  reason is at the call site.
- `Piece::Init` did not clear `delay_ready_`, so a second Init at a different
  rate left the echo 8.8 percent late (0.5102 s against 0.4688).
- `SetTempo(0)` cast an infinity to int in four places. Clamped before the
  arithmetic now.
- `Markov<1, ...>` aliased every context of every order onto one entry, which
  contradicted the header's own stated invariant. The bound is `kAlphabet >= 2`.

The eight in the site, all of them dead or wrong controls that no type checker
can see, because `param(name: string, value: number)` accepts anything:

- **The FM electric piano had no tine.** `modDecay`/`modSustain` do not exist
  (`mDecay`/`mSustain`), so `mSustain` sat at its 0.5 default and the modulator
  never died away. It also never set `ratio2: 14`, so the modulator ran at the
  carrier frequency. It was a bright FM tone, not an electric piano.
- **The acid bass had no sweep.** `filterSustain` does not exist (`fSustain`),
  default 0.5, so the filter parked half open. The patch whose whole description
  is "the filter is the instrument" was not doing it.
- `step-motion`'s vibrato produced no vibrato: VA `detune` is a symmetric
  spread, so modulating it moves the oscillators apart and leaves the pitch
  centre still. That is beating. It uses a one oscillator `defEngine` now.
- Exporting `20_Instruments` produced a different instrument: the rewrite regex
  matched `decay` on all three drums, turning the hat's 0.055 s into 1.1 s. A
  param can name its owning object now.
- All three PIEZO sliders were dead in the browser and wrote nothing on export.
  They drive the output stage they name now.
- The POLY SYNTH cutoff slider was overwritten by its own LFO within 50 ms. It
  sets the base the sweep runs from now.

**The lesson to carry forward**: a wrong engine parameter name is silent at
every layer. `fillDefaults` copies only spec names out of the caller's object,
and `setParam` returns early on an unknown name. Neither warns. If you add a
control, verify the name against the engine's ParamSpec list and then LISTEN to
it move, because that is the only thing that catches this.

### New harnesses from this session

| command | what it proves |
| --- | --- |
| `npm run presets:check` (embedded) | the 50 C++ presets equal the TypeScript, 1054 values, exactly |
| `npm run check:embedded` (workbench) | every C++ snippet on the site compiles against the real headers |
| `node scripts/gen-llm-embedded.mjs` | the embedded LLM reference, from the headers, gaps reported not dropped |

### Still not done, in the order I would take it

Ordered by cost to fix against risk of being wrong later. The first four are
bookkeeping the session created and did not close; they are cheap and they are
the kind of gap that rots.

**1. Three examples exist with nothing checking them. DONE.**
`16_WorkstationPiezo`, `17_WorkstationI2S` and `21_Presets` are committed and
build, and they had no size sketch under `test/sketches`, no row in either
table in `examples/README.md`, and no entry in the `ALL` list in
`examples/build-matrix.sh`, which named 14 of the 17 folders. So `check-docs`
could not see their flash and RAM, and `./build-matrix.sh` with no argument
did not sweep them.

Closed: `p14_e16_workstationpiezo`, `p15_e17_workstationi2s` and
`p16_e21_presets` exist, `EXAMPLES_ROWS` went from 8 rows to 11, `ALL` names
all 17 folders and the full sweep is 119 builds rather than 98, and the `SELF`
count went 382 to 388. The three new rows were mutated one at a time and
watched to fail before being reverted, because a row nobody has seen fire is
the same as no row.

Two things this turned up that are worth carrying forward. 16 and 17 have no
logic header at all, only an `.ino`, so `p14_` and `p15_` reconstruct the
composition rather than including the source the example compiles, which is
the one place in the size table where the number and the code are not the same
text. Both sketches say so at the top. And 17 costs 448 B of flash more than
07 for the same patch, because it calls `Piece::Compose()` and 07 does not, so
`--gc-sections` keeps the mode picker, the progression, the five euclidean
rhythms and the motif generator that 07 drops.

Measured while adding the rows: 21_Presets is the only example in the set that
a Teensy 3.6 refuses. Eleven voice pools and a plate tank is 251 KB against
the 256 KB the part has.

**2. The firmware manifest points at the wrong commit.** The 60 binaries in
`apps/workbench/public/firmware` were built before the commit that contains
them, so `manifest.json` records `2873f24-dirty` rather than `11356c4`. The
manifest is doing its job (it says the tree was dirty rather than pretending),
but the provenance is a commit behind. Rerun
`node apps/workbench/scripts/gen-firmware-binaries.mjs` from a clean tree. It is
about 40 minutes of building and needs `pio` and the teensy platform.

**3. The development board is running stale firmware.** The Teensy 4.0 has
`17_WorkstationI2S` from before the AudioMemory ordering fix, which is the null
render window described above. Rebuild and reflash:
`cd packages/bellows-embedded/examples && PLATFORMIO_SRC_DIR=17_WorkstationI2S pio run -e probe_teensy40`
then `teensy_loader_cli --mcu=TEENSY40 -w -s -v .pio/build/probe_teensy40/firmware.hex`.
Use the CLI loader and watch for `Found HalfKay Bootloader` then `Programming`:
PlatformIO's default `teensy-gui` protocol reports success for having opened an
application, which is not the same as having programmed anything.

**4. The playground catalogue does not offer the new work.** It has 22 entries
and none of them is `21_Presets`, `16_WorkstationPiezo` or `17_WorkstationI2S`.
Adding one means two entries in `FILES` in `gen-firmware-sources.mjs`, an entry
in `FIRMWARES`, a `case` in `buildVoice`, and usually a `VOICE_CAVEATS` line.
The presets one is the interesting entry, because it could offer all 50 as a
picker rather than as a firmware.

**5. Hardware breadth, which is the real gap.** One board, one program, one
session. Nothing on a 3.x, nothing on a Daisy, and the two boards without a
floating point unit (LC and 3.2) are the whole question, because they emulate
every float operation in software. `00_BringUp` exists for exactly this and has
never been run. The other half is that nothing has been compared to the browser
BY EAR: 40 parity rows and 1054 preset values are a strong position and they are
not the same as having listened to both.

**6. Milestone 6, publishing the embedded library.** Still `private: true` and
in neither the Arduino Library Manager nor the PlatformIO registry. The decision
is recorded under "Decisions, made": a mirror repository holding only
`packages/bellows-embedded`, pushed by CI on tag. PlatformIO can consume the
subdirectory today. Note `library.properties` still says `dot_a_linkage=true`,
which is questionable for a header-only library with no `.cpp`, and the Arduino
IDE path is untested: examples 11, 12, 13, 16 and 17 include across folders
(`../10_AudioShield/audioshield.h`), which PlatformIO resolves and the Arduino
IDE may not, because it preprocesses the `.ino` into a build directory.

**7. The audit backlog.** `docs/AUDIT-2.md` still has roughly 73 genuinely open
findings, triaged in "The work queue" below. The largest single one is the
string waveguide being up to 23 cents flat below 165 Hz, which now matters more
than it did: the engine is ported, five presets use it, and the C++ reproduces
the defect faithfully because parity demanded it.

**8. One parity row is weaker than it looks.** `additive_morph` moves only 4.4x
against a 10x gate for a 0.1 percent `morph` error. It is recorded in the GATES
comment. A second row driving morph across its range would close it.

## Where things stand

- **Two commits are unpushed**: the simulator page and its fix pass. `origin/main` is at
  6a81cc1, so bellows.live has no SIMULATOR button and anyone reporting the nav as broken is
  looking at a site that never received it. Push, then run
  `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d`, because the site does not
  deploy on push.
- `bellowsjs@0.1.7` is published on npm and tagged `v0.1.7`, and `main` is current with it. It is
  the audit-3 release: almost all gates rather than behaviour, and `CHANGELOG.md` lists the four
  things a user would notice (a new `rotatePattern` export, input ceilings on the WAV and MIDI
  parsers, and three fixes). 0.1.6 before it was a safety release: the SFZ hardening in it fixes
  a real denial of service on untrusted input in a browser.
- **bellows.live is behind `main` too, and does not catch up on its own.** The app pulls the
  public repo with a plain `git.repo_clone_url`, so there is no deploy-on-push: verified, the
  active deployment is from 2026-08-06 with cause `manual`. Shipping site changes takes
  `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d` after the push. See
  "Deployment (bellows.live)" below, which has said this all along; an earlier draft of this
  line said the opposite and was wrong.
- **`packages/bellows-embedded` is published nowhere.** It is `private: true`, so it is not on npm
  and is not meant to be, and it is in neither the Arduino Library Manager nor the PlatformIO
  registry. Today the only way to consume it is to point PlatformIO at the subdirectory by hand.
  That is Milestone 6 and it has not started.
- Library test suite: 90 files, 1348 tests, counted by `npx vitest list` and re-counted by `check-docs.mjs` so this line cannot drift the way it did twice, all passing in plain Node, including golden-render regression (`test/golden`, regenerate with `GOLDEN_UPDATE=1` only alongside an intentional DSP change).
- `tsc --noEmit` clean. Build: `npm run build -w packages/bellows` runs worklet generation, vite (ESM + standalone IIFE), declaration emit, and writes `dist/worklet.js`.
- The Vue workbench builds clean (`vite build`) and type-checks clean (`npm run typecheck -w apps/workbench`, which CI runs as its own step; deliberately not inside the build script, because `.do/app.yaml` deploys the site by running that script and the site's deploy should not hang on a type check). Verified live in Chrome: bench plays and evolves seeded pieces, engine hot-swap works mid-phrase, 8-bar WAV export rendered in about 1.4 s while playing, code mode runs its examples. Its 49 examples are checked against the built library by `npm run check:examples -w apps/workbench`, in CI.
- Embedded: 43 headers, every one compiling standalone and all of them together in one translation unit, for Cortex-M7 and Cortex-M4. The whole ported engine set is about 34 KB of flash. All five examples build and link as real Teensy 4.1 firmware against the actual Arduino core and Audio Library.
- Parity against the TypeScript passes on 40 rows with the PRNG bit exact and the effect input bit exact, plus 428 exactly-compared value rows for the parts that make no sound.
- The embedded package went through a size pass whose findings are in `docs/HARDWARE.md` under "Making it smaller". Delay buffers are sized exactly rather than rounded to a power of two, which took 25 percent off RAM library-wide with bit-identical output; the oscillator gained per-shape entry points so the linker can drop the residual table a program never reads; and every transcendental now routes through `fm::`, which is what the docs had claimed for months and was not true, so `BELLOWS_FAST_MATH` went from saving nothing on any sketch with an oscillator to saving 23 to 75 percent. Read that section before optimising anything: it also records what was measured and deliberately NOT taken, and why attributing firmware bytes to a header-only library by symbol name does not work.

**Two things that have not happened, and both are load bearing.**

1. **A board has now been flashed and heard, and this item used to say the opposite.**
   **A Teensy 4.0 has now run this, and the number is the one Milestone 1 existed to
   collect.** `07_Workstation`, the heaviest program in the set (five engines, a Markov
   melody, a tempo-synced delay send, an EQ and a limiter), at 44.1 kHz through a
   MAX98357A on I2S: **34 to 43 percent CPU typical, 47.2 percent peak**, with 2 of 24
   audio blocks used. It runs with about half the processor spare.
   
   What that does NOT settle, and the distinction matters because one board is one data
   point: no other board has run anything (a 3.2 and an LC have no FPU and emulate every
   float operation, and a Daisy Seed has been linked to an image but never run), no other
   program has been measured, and neither implementation has been compared to the other
   by ear. The numerical comparison, 40 engine and effect rows plus 428 exactly-compared
   value rows, is what stands in for that and is not the same thing.
   
   These CPU figures are hand-recorded from a serial console. No harness prints them, so
   `check-docs` cannot verify them the way it verifies the size tables.

   The first bring-up did find things, all of them in the tooling rather than the DSP: a
   `namespace tone` that cannot compile against the Arduino core because the core declares
   `void tone(uint8_t, uint16_t, uint32_t)`, a piezo chain whose highpass cost 13.4 dB with
   no gain stage to restore it, and a loader that reports success for having opened a GUI.

   As of the output-example set this is verified across seven boards rather than one: every
   example is built and linked as real firmware, with the Arduino core and the audio library
   in it, for Teensy LC, 3.2, 3.5, 3.6, 4.0, 4.1 and MicroMod. `examples/README.md` has the
   matrix and it is a build log, not a reading of data sheets. It still says nothing about
   whether any of those boards is fast enough, and for the two without a floating point unit
   (LC and 3.2) that gap is the whole question.
2. **CI runs now, and this item used to say it never had.** It was true when written and stayed
   in the document after it stopped being true. `gh run list` shows green runs on push to `main`
   and on `workflow_dispatch`, across six jobs. So the stale-worklet guard, the generated-header
   drift check, the golden-render guard and `check-docs` are controls rather than descriptions.
   What is still not automatic: nothing publishes to npm, and nothing flashes a board.

## What audit 3 established, and what it is safe to rely on

`docs/AUDIT-3.md` has the findings with their evidence. What matters for picking the work back
up is which properties are now held by a control rather than by hope. Each of these was
verified by re-running the mutation that motivated it, so they are gates rather than tests
that happen to pass:

- **The worklet renders the same audio as the offline renderer, bit for bit.** Three documents
  said so and nothing checked it. `test/kernel/worklet-parity.test.ts` evaluates the shipped
  IIFE against a real global scope and drives it for 96 blocks through two engines, a channel
  effect, a bus send and a master limiter. If you change `worklet-entry.ts` or the kernel's
  wiring, this is what tells you.
- **Block size does not change the audio.** Bit identical from 32 to 512, effects included.
  Nothing had ever varied it, and AudioWorklet's render quantum is not promised to stay 128.
- **The published artefact is checked.** `test/integration/package.test.ts` writes the public
  API down as a list, resolves the bare specifier in a plain Node subprocess, compares the
  source barrel against the built bundle by kind and arity, and runs the standalone IIFE. The
  API list is the specification: removing a name from it is a deliberate edit.
- **The dependency rule is enforced.** `test/integration/layering.test.ts` fails on any runtime
  import from a lower layer to a higher one, and lists the three type-only ones by name.
- **Sample-accurate event placement, the BS.1770 gating thresholds, the sampler's interpolator,
  the four Dattorro plate constants, the grain pool size, the shelf corner frequency, six
  analysis constants and the voice-stealing order** all now have gates. Every one of them
  survived a one-step mutation before this pass.
- **The site's 49 examples are checked against the library**, in CI, by
  `apps/workbench/scripts/check-examples.mjs`.

Two habits from this pass worth keeping, both learned by being burned:

1. **A gate you have not seen fail is not a gate.** Six times in three rounds an instrument in
   this audit produced a confident wrong answer: a harness that froze the context clock and
   still passed two tests, a module-cache hit that reported 0 of 96 signals differing when the
   answer was 22, a `cd` that failed so no mutation was ever applied and five rows came back
   "equivalent", a probe that passed milliseconds as seconds and never reached the code under
   test. Every new gate here was checked by breaking the thing it guards.
2. **Do not run a mutation sweep and a measurement against the same working tree at once.** One
   probe in round three ran while a sweep had `src/dsp/oversample.ts` modified. The result
   looked fine and meant nothing.

Known and deliberately not gated: `HANN_N`, the grain envelope's table resolution. It is
observable only on very short grains and the size of the effect moved with every other
parameter tried, so the note is better than a fragile gate.

## The output examples, and what a piezo needs

`examples/06_FirstSteps` is the rung below 01_OneKick, which was described as
the smallest useful program and is already an engine. Four headers in one
image: one oscillator, then an envelope, then a resonant ladder with an
envelope of its own, then two LFOs. It is the cheapest example here, the only
one with no delay line anywhere in it, and the only one besides 01 and 02 that
fits a Teensy LC (87.0 percent). It also found a real trap: `namespace tone`
does not compile against the Arduino core, which declares `void tone(uint8_t,
uint16_t, uint32_t)`, and no host probe can see that because a host probe
never includes Arduino.h. All four rungs share one `firststeps` namespace now,
which is what the other examples do anyway.

`examples/20_Instruments` is the patch library, eleven instruments over eight
engines in one image: FM electric piano, acid bass, chorused pad, west coast
wavefolder, plucked string, three modal materials (bell, wood, glass),
waveguide clarinet, formant choir and a long-decay kit. One header per patch,
all sharing `player.h` for the scale, tuning, progression and rhythms, so
switching patch compares instruments rather than the parts they happen to be
playing. 47912 B of flash and 49904 B of RAM for all eleven, and it fits a
Teensy 3.5 at 26.3 percent.

The thing worth knowing before editing a patch is the trim. The engines have
no common loudness reference, and measured on the parts they actually play
they spanned 30 dB: a struck wooden bar at 0.0046 RMS against a sustained reed
at 0.26. Each header carries a measured `kTrim` that the shell applies, and
nine of the eleven now land within one percent of each other. The two that do
not, the plucked string and the marimba, sit about 3 dB under because they are
transient-dominated and the master limiter is holding them, which is the
limiter doing its job rather than a miscalibration. Re-measure rather than
guess if you change a patch: RMS over the whole render is the wrong instrument
for a sparse percussive patch and reported marimba as needing 25x gain, which
was the patch being under-driven and not the trim being wrong.

`examples/07_Workstation` is the composer-level one, and it is the example to point
at when someone asks what the library is for. Five engines at once (Kick, Snare,
Hat, Va, a Pluck pool), euclidean rhythms on the kit, a bass line, a melody drawn
from the ported Markov chain rather than read from an array, a tempo-synced stereo
delay on a send, an EQ and a limiter on the master, all from one seed. Three things
in it are worth knowing. There is no mixer in this library on purpose, so
`RenderSpan` IS the mixer and it is fifteen lines; the rule that shapes it is that a
voice advances its envelope when it renders, so a part that goes two places is
rendered once into a scratch and added twice. Its determinism was measured rather
than asserted: two `Piece` objects with the same seed produce 0 differing samples
over 30 seconds. And the board answer was not the expected one: it was written
expecting a 4.x and `build-matrix.sh` says it also fits a 3.5 and a 3.6, at 91.4 and
91.5 percent, which is the tightest fit in that table. It costs 41840 B of flash and
225468 B of RAM, and 187 KB of that RAM is one object, the delay line.

`examples/10` through `examples/15` are one sketch per way of getting sound out of the board:
the audio shield, an I2S breakout (a MAX98357A drives a speaker directly, a PCM5102A gives
line out), the built-in DAC on the 3.x parts, a bare Teensy with two resistors and two caps,
and a piezo disc. They share one patch, `10_AudioShield/audioshield.h`, so comparing them
compares converters rather than programs. `examples/OUTPUTS.md` is the chooser.

Three things in there are worth knowing before touching that code.

**The platform header was Teensy 4.x only and did not need to be.** `platform/teensy.h` was
guarded `#if defined(__IMXRT1062__)`, which excluded Teensy 3.2, 3.5 and 3.6 from a header
that compiles for them unchanged: nothing in `BellowsAudioStream` is part specific. It is
guarded on `TEENSYDUINO` now, and PSRAM (`BELLOWS_BIG_BUFFER`) stays 4.x only, deliberately
with no fallback so that a 3.x sketch asking for a megabyte fails at the macro rather than at
the linker.

**`00_BringUp` did not build for the boards it exists to bring up.** One symbol,
`F_CPU_ACTUAL`, which is 4.x only. The program written to be run first on a new board was
unavailable on four of the seven boards the library builds for. It falls back to `F_CPU` now.

**The delay line is the RAM, and the floor is the delay line.** A Karplus-Strong string sized
for a 20 Hz floor is 9.6 KB of float per voice at 48 kHz; four voices is 38 KB, and a Teensy
3.2 has 64 KB with the audio library already in it. The shared patch overflowed by 61540 bytes
before it knew what board it was on. Raising the floor to 100 Hz costs five times less per
voice and costs nothing else as long as no note goes below it, which is why that header picks
its floor and voice count from board macros. Teensy LC does not fit even then, measured: over
by 10048 bytes.

The piezo work is the one part of this that is reasoning rather than measurement, and
`OUTPUTS.md` says so in those words. A disc is a capacitor with a sharp resonance and no bass,
so the chain is: drive it differentially across two pins for 6 dB that costs nothing, remove
everything below about 1.2 kHz because the limiter cannot tell that the disc will never
reproduce it, boost the resonance, and limit hard because there is no headroom to protect.
Nobody has held a meter to a disc driven by this code.

## The simulator page, and what it is honest about

`apps/workbench/src/views/SimulatorView.vue` plus `src/lib/sim/`. Pick an embedded example,
hear it, change its parameters, switch the way sound leaves the board, download valid firmware.

**It does not emulate a Cortex-M7, and that was researched rather than assumed.** Nothing
models the i.MX RT1062 in a browser-capable emulator: Wokwi's open cores are AVR and RP2040 and
its Teensy request is closed unimplemented, Renode has an RT1064 board but is a .NET
application with no wasm build and no audio path, and the fastest browser MCU emulators reach
about 10 M guest cycles per second against the 600 MHz that would be needed. Compiling the C++
to wasm was the other candidate and was rejected for a better reason than difficulty: it adds a
third set of numerics to a repository that spends a CI gate keeping two in agreement, and
nothing measured says the TypeScript is too slow.

So the page runs the TypeScript implementation and prints the parity figure for the engine you
are hearing, which is the one claim here that most projects cannot make. What it does not cover
is printed beside it: timing is not simulated and no board's ability to keep up has ever been
measured.

**It is laid out as a console now, which is the third shape it has had.** One
column, then a two-up grid, and both were a scroll: sixteen panels is sixteen
panels however they are arranged, and RUN, the output picker and the status went
off the top of the screen the moment you looked at anything else. So the panels
are collapsed rather than rearranged. A `position: sticky; top: 16px` strip holds
the transport, the firmware and board pickers, the output chips and a one line
version of the honesty claim, and BOARD, CODE, PARAMETERS, INPUTS and FLASH take
turns in a single area under it. A tab with nothing in it is disabled rather than
removed so the row does not reflow when you change firmware. The board is drawn
landscape now (404 by 116 units for a Teensy 4.1, against 168 by 412 before),
which is the same drawing rotated a quarter turn anticlockwise: pin 0 runs along
the bottom edge and the high numbers back along the top, with the USB at the
left.

Five things to know before touching it:

- **`NoteValue` treats a bare number as a MIDI note, not a frequency.** Passing Hz directly is
  what made every sample click at the wrong pitch: the hat asked for MIDI 330 and the chord's
  110 Hz became MIDI 110. Everything goes through `{ hz: n }` now. The C++ side takes Hz,
  because the drum engines tune from the noteOn frequency, so the two sides genuinely differ.
- **A programmatic click does not unlock an AudioContext.** Driving the page from the console
  measures silence and looks exactly like broken audio. One real click unlocks the shared
  context for the session, after which scripted auditions work.
- **The samples are checked against the firmware, not written from memory.** Three were wrong
  when checked: the snare pattern, the hat's rotation and the hat's pitch. If you add a sample,
  read the example's header for its patterns, pitches and velocities.
- **KeepAlive wraps the view**, so `onDeactivated` matters as much as `onBeforeUnmount`, and
  the output stage has to be unspliced from the analyser on both.
- **The catalogue is 22 entries in five groups now**, not six: four rungs from
  `06_FirstSteps`, the four original lessons, `07_Workstation`, eleven patches
  from `20_Instruments`, and the two output examples. Every one is still a real
  example that compiles to a board, which is the page's whole claim, so adding
  an entry means writing firmware and not just a browser patch. All 22 were
  driven in Chrome and measured: none silent, none non-finite, no console
  errors. Two defects fell out of that pass. The plucked string reached exactly
  1.0 because the browser side had no master limiter where the C++ shell has
  one, and POLY SYNTH reached 1.095 once its chord started lasting the full
  2.5 seconds, because nothing modelled the `codec.volume(0.6f)` every .ino
  sets.
- **When a sim entry measures silent, suspect the probe first.** A debug pass
  here set the firmware `<select>` to VOICE keys (`inst-808`) rather than
  firmware ids (`eightoheight`). The select silently takes `""`, the page keeps
  whatever was loaded, and the measurement is of nothing. It cost two rounds and
  produced a confident wrong diagnosis about `masterFx` ordering that had to be
  taken back out of a comment.
- **A control that reads a parameter out of `paramMap` is reading a snapshot.**
  `buildVoice` builds `p` once and the step closures keep it, so `p.tune` in the
  kick's step meant the TUNE slider moved its readout and nothing else. Found by
  measuring rather than by reading: the peak bin sat at 49.8 Hz with the slider at
  50 and at 100. It holds `tune` in a local the setter writes now, and the fix was
  confirmed the same way, 35.2 / 49.8 / 111.3 Hz for 35 / 50 / 110, each inside one
  2.93 Hz bin. `tune` is also the one parameter `applyParams` cannot write back into
  the header, because the pitch is a `Trigger(hz, vel)` argument rather than a
  `p.<field>` line, which is what the panel is reporting when it says 2 values
  written of 3. The poly voice's CUTOFF is a different case and not a bug: a 0.12 Hz
  LFO rewrites it every 50 ms, exactly as the firmware does per block, so the slider
  only sets where the sweep starts.

`public/firmware/` holds prebuilt binaries with a manifest recording the commit each was built
from, because no CI gate can rebuild a firmware link cheaply and a stale binary should be visible
rather than silent. Rebuild with `node apps/workbench/scripts/gen-firmware-binaries.mjs`, which
finds every example on disk (any folder holding `<name>/<name>.ino`) and tries it on the 4.1, the
4.0, the 3.6 and the 3.2. A board that refuses is recorded rather than dropped: `does not fit` is
the linker overflowing RAM, `n/a` is the sketch declining the part with an `#error`, and each ok
entry carries the RAM percentage the build reported. The sweep is hours, because PlatformIO
empties its build directory whenever `src_dir` changes and every cell recompiles the core and the
audio library, so `--only <example>` and `--boards <ids>` rebuild one cell and merge into the
manifest that is already there.

## Layout

- `packages/bellows` is the library and the source of truth for all DSP. Dependency direction, enforced by review not tooling: `types` and `core` at the bottom, then `dsp`, then `engines`/`fx`/`analysis`, then `kernel`/`io`/`render`, then the `bellows.ts` facade. `theory` and `seq` are audio-free.
- `packages/bellows-embedded` is the header-only C++17 port for microcontrollers. Not on npm; it is an Arduino library folder and a PlatformIO library at the same time. It is a transcription, and the harnesses below are what keep it honest.
- `apps/workbench` is the demo app. `src/lib/audio.ts` owns the single Bellows instance (one AudioContext kept for the page's life, reused across reboots). `src/lib/composer.ts` is the generative brain, `src/examples/` the code-mode registry.
- Everything the kernel can host is registered in `src/core/register.ts`. New engines and effects must be added there and the worklet regenerated, or they exist on the main thread only.

## The verification harnesses

This is the part a new session most needs to know, because these are what let you change DSP without fear, and because two of them were built specifically after they caught things nothing else would have.

Run all of them from `packages/bellows-embedded` unless noted.

| Command | What it proves | What it caught |
| --- | --- | --- |
| `npm test` (in `packages/bellows`) | the TypeScript, including the golden render and the oscillator band sweep | the regression fixture is the only whole-piece guard; `test/dsp-osc/blep-frequency.test.ts` is the only thing that can see alias rejection collapse above 2637 Hz |
| `npm run parity` | 40 rows match the TypeScript numerically, four of them exactly | the `eq.h` three-band-mislabelled-as-port, the `StereoDelay` clamp bug, and three rows of its own that measured nothing until their input was fixed |
| `npm run tables` | euclid, scales, chords, notes, CA, arp, tempo map, MIDI compared EXACTLY | nothing yet, but it is the only thing that can see a wrong scale table |
| `npm run fastmath` | every polynomial in `core/fastmath.h` against libm | `fm::Log2` wrong by 213 cents, inherited by every `Pow` |
| `npm run memsafety` (and `memsafety:fastmath`) | ASan and UBSan over the buffer-owning classes at 0.5x to 4x their template rate, and at NaN, zero and negative rates | the `Pluck::NoteOn` overflow, then four undefined float-to-int casts reached through a NaN. Nothing else could: parity compares numbers at one rate, and `check-header.sh` instantiates nothing. Build it for x86-64 as well as arm64: the NaN cast saturates harmlessly on arm64 and only faults on x86-64 |
| `npm run size` | flash and RAM per sketch, `cortex-m7` or `cortex-m4` | the whole no-registry design argument |
| `./tools/check-header.sh <h>` | one header compiles standalone, `-Wall -Wextra` | header hygiene; note it instantiates nothing |
| `node tools/gen-tables.mjs --check` | generated headers match the TypeScript ParamSpecs | new `Eq6` class the moment it appeared |
| `node tools/check-docs.mjs --check` | every figure the harnesses print, wherever a document quotes it: `docs/HARDWARE.md`, the embedded `README.md`, `examples/README.md`, this file, `docs/KICKOFF.md` and `docs/ENGINEERING.md`, against the size report, the sketch symbol tables, `parity`, `tables`, `fastmath` and `vitest list`: 388 of them | six stale rows in HARDWARE on its first run; then 10 stale README rows and 3 stale prose figures when it was widened; then, when it grew past the size report, 4 of 5 example rows, both symbol-breakdown tables, three parity rows and the toolchain version; then, when prose started matching the paragraph rather than the line, five claims that a rewrap had silently switched off, and the fact that the two ARM toolchains installed here disagree on 36 of 37 rows. Still does NOT cover the whole-firmware Teensy table, the Daisy table, the ns tables, the board capacity table, the newlib-against-fastmath byte comparison or the bundle size in the release ritual |
| `npx vitest run test/integration/engine-tuning.test.ts` | every pitched engine plays the note it was given, to 2 cents | proves the fractional-delay tuning is real: an integer-rounded loop is 28 cents flat at E7 |
| `npx vitest run test/integration/nan-safety.test.ts` | one NaN parameter cannot break the audio graph | 10 parameters threw inside `process()` and 191 poisoned the output before it existed |

Rules learned the hard way about these:

1. **Gates are set from measurement, at roughly ten times the observed drift.** An earlier revision used round numbers that left `saturator` with 25000x headroom, and a deliberate 0.01 percent mutation of the `Svf` integrator passed every gate. If you add a module, measure it first and set the gate from the measurement.
2. **Mutation test a gate before you trust it.** Both harnesses have been shown to fail on a deliberate break and pass on its revert. A gate nobody has watched fail is a gate nobody should trust.
2b. **Mutation testing is also the vacuity check, and it is the reason to do it first.** The limiter and gate parity rows were added, passed, and measured NOTHING: the shared effect driver feeds white noise at 0.25, a limiter with a -0.3 dB ceiling never engages on that and a gate with a -40 dB threshold never closes, so both rows sat at their float noise floor. A 0.1 percent ceiling change did not move the limiter row at all. They only became gates once the driver grew a per-effect envelope. Every constant in that envelope is exactly representable in binary floating point, because 0.25 * 1.6 is not exact in float and the difference would land in the comparison looking like the effect's own error. And when a mutation does not fire, check the mutation before the gate: the first limiter mutation moved `ceil_lin_`, which is only the threshold test, while the reduction is computed from `ceiling_db`. An envelope also only exposes what its shape can expose: a step crosses every threshold at the same sample, so the burst envelope that made the gate row see its attack, hold and release left it blind to its thresholds, and it took a second row on a slow ramp to cover them. The `fxin` rows exist for the claim underneath all of this, that the two sides start from identical bits, which was written down in three places and false in all three until the JS was taught to round where `Rng::Bipolar()` rounds.
3. **The PRNG row must be exactly zero.** If it is not, nothing below it means anything and the DSP is not the thing to look at.
4. **`check-header.sh` proves less than it looks.** It generates its own `main()` and instantiates nothing, so templates are dead-stripped. To exercise template bodies you need a translation unit that constructs and drives the classes; the size sketches in `test/sketches/` do that.
5. **Sample-wise RMS is the wrong instrument for a time-modulating effect.** The chorus is bit-identical with modulation off, and the modulated row used to drift in proportion to depth. That cause is now fixed (the fixed point phase in Milestone 2 took it from 4e-2 to 2.0e-4), but the principle stands and `chorus_static` is still the row that would actually catch a broken chorus. What remains in the modulated row is the read position, computed in float here and double there.
6. **A gate that only looks at one frequency is not a gate on an oscillator.** `test/dsp-osc/oscillators.test.ts` measured alias rejection at 2637 Hz only, so a kernel cap could cost 39 dB at 7040 Hz and 73 dB at 17 kHz with the whole repository still green. `test/dsp-osc/blep-frequency.test.ts` now sweeps 55 Hz to 19 kHz with per-frequency floors set from measurement.
7. **Alias floors do not gate the filter, only its failure.** They look at what is NOT a harmonic, so a wrong Fourier coefficient, a flipped BLAMP drift sign and any change to `CUTOFF` or `KAISER_BETA` all passed everything. The band-edge test in `blep-frequency.test.ts` measures a low note's harmonics against the ideal saw and pins the half-amplitude point at the cutoff, which catches `CUTOFF` moving by 1.2 percent. If you change the kernel, that is the test that should fail first.
8. **A number in a document rots exactly like a stale generated file.** Four times in one session a change moved a sketch and the tables quoting it were left behind, each caught by hand afterwards. Finding 11 in `docs/AUDIT.md` already said a warning in a document is not a control; the same is true of a figure in one. `tools/check-docs.mjs` is the control, and `ci.yml` runs it on the day CI first runs. It does NOT cover the whole-firmware Teensy table, the Daisy table, the ns tables, the board capacity table, the newlib-against-fastmath byte comparison or the standalone bundle size in the release ritual, and those still rot by hand. When you add a figure to a document, add it there first: the second audit found sixteen document findings and every one of them was a number a command could have printed. Two of that pass's lessons are about the checker rather than the documents. A claim it cannot find is worse than no claim, so it reports a marker that matches nothing instead of passing quietly: a hard rewrap had switched off five prose claims, and a table header whose first cell matched a row marker had switched off a sixth. And the provenance line is load bearing, not decoration: the two `arm-none-eabi-g++` installs on this machine disagree on 36 of the 37 size rows, so the checker now pins the report to the compiler `docs/HARDWARE.md` names rather than to whatever `PATH` offers.
9. **You cannot attribute firmware bytes to a header-only library by symbol name.** Three revisions of the same paragraph in `docs/HARDWARE.md` claimed bellows was 31, then 42, then 34.7 percent of a Teensy image, each fixing a different flaw in a method that does not work: bellows code inlines into the sketch's functions and takes the sketch's names, while sketch code that mentions a bellows type takes a bellows-looking one. The claim is withdrawn. If you want to know what a change costs a real image, build the image twice and subtract, which attributes nothing.
10. **Do not quote wall-clock ns from a microbenchmark as a property of the code.** The same shipping oscillator through two harnesses on one machine gave 22.6 and 59.8 ns per sample at 7040 Hz. Quote the ratio, measure both ends in one process, and prefer a countable quantity: for the BLEP sum that is `2 * KERNEL_HALF * dt` edges, which is exact.

## Things that are not obvious from the code

1. The worklet ships as a checked-in generated string: `scripts/gen-worklet.mjs` (esbuild) writes `src/kernel/worklet-code.gen.ts`, `scripts/postbuild.mjs` extracts `dist/worklet.js` for CSP-strict hosts. After ANY change under `src/kernel`, `src/engines`, `src/fx`, `src/dsp`, or `src/core`, rerun `npm run gen:worklet -w packages/bellows` or realtime playback keeps executing the stale bundle while offline render uses the new code. This exact thing happened during the audit: all three fix agents left it stale, the whole suite stayed green because tests exercise `renderOffline` which imports source directly, and realtime would have shipped without ParamRamp. CI now enforces it.
2. The kernel clock is locked to context time by `engine.setFrame(currentFrame)` at the top of every worklet `process()`. Events are stamped with `ctx.currentTime` on the main thread. Do not remove or reorder this; it was the critical finding of an earlier review (silent output on reused contexts).
3. Offline render fidelity rests on three invariants: structural messages are recorded in `Bellows.setup`; transport history is recorded as ops (`bpm`, `ramp` with its anchor bpm, `swing`) and replayed onto a fresh Transport; untimed calls inside clock callbacks resolve to `renderCtx.now` during replay. If you add a facade method with side effects, decide explicitly how it records and replays.
4. `render()` is `async` but has no `await` between setting `renderCtx` and clearing it in the `finally`. That is load bearing: the 25 ms scheduler interval cannot interleave and misroute live events. Adding any `await` inside that span silently breaks live playback during export.
5. Determinism contract: all randomness flows through `NamedRng` forks (`src/core/prng.ts`). `b.rng(label)` returns per-context streams; `render()` uses a fresh cache so a render equals a fresh page load of the same seed.
6. The fork rule is literal string concatenation: `rng(label).fork(child) === rng(label + '::' + child)`. This is why the C++ needs no `Fork()` method: write the full label path into `Rng::Init(const char*)` and you land on the same stream the browser is on. Documented in `bellows/core/prng.h`. A harness that faked fork as a shared stream produced three wrong verdicts in one run.
7. The scheduler (`src/core/scheduler.ts`) stretches its lookahead to the observed timer cadence and reaches back up to the observed gap, which is what survives background-tab throttling. `pause()/resume()` rely on `Scheduler.resyncTo`.
8. `defEngine`/`defEffect` serialize defs with `serializeDef` (functions via toString, rehydrated with `new Function` in the worklet). Defs must be self-contained. CSP that blocks eval breaks tier 3 in realtime; offline still works. It is also an eval sink: an app that lets users author defs has given them code execution in the worklet realm.
9. Voices ADD into `(outL, outR, from, to)`; effects process IN PLACE; nothing allocates on the audio path at steady state.
10. `Bellows.setup` is a `SetupLog` (`src/kernel/setuplog.ts`), not an array. Idempotent setters collapse last-write-wins by identity key, updated in place so non-idempotent ordering survives. Anything added to `KernelMessage` needs a decision in `collapseKey`: append or collapse. Getting it wrong silently changes what `render()` replays.
11. `Instrument.dispose()` is the only way `removeChannel` is ever posted, and it prunes the channel from the setup log. Without it every channel leaks its whole voice pool, which is what the workbench engine swap used to do at about 400 KB a time. `dispose({ releaseSeconds })` defers the removal so a ringing tail decays instead of being cut.
12. **The embedded library must never grow a global registry.** Playing one kick through a string-keyed registry of five engines costs 30488 bytes of flash and 30872 of RAM against 3760 and 1100 direct, because a registry names every engine so the linker must keep every engine. `bellows/bank.h` gives runtime index dispatch at byte-identical cost. This is the single load-bearing design rule of that package.
13. `BELLOWS_FAST_MATH=1` swaps libm for polynomials and takes the kick from 3760 to 936 bytes. It is also the most dangerous flag in the tree, for the reason in the harness table. Run `npm run fastmath` after touching any approximation.
14. On the PlatformIO teensy platform, `board_build.usb_type` is silently ignored: use `-D USB_MIDI_SERIAL` in `build_flags`. The platform also still defaults to `gnu++14` on some releases, so `build_unflags` has to remove it. `examples/platformio.ini` carries both and is verified.

## Recent history worth knowing

- **`docs/AUDIT-2.md` is the current one**: a whole-repository pass on 2026-08-05, forty agents across eight slices, 95 findings, each escalated finding then attacked by a skeptic whose default was to refute. Two slices came back sound (the architecture holds, the DSP core is correct); six came back needs-work. Five findings were refuted and are listed at the end so nobody rediscovers them: the ladder cutoff is deliberate, `romanToChord`'s accidentals are right, and `pattern.fast()`'s cycle length is the documented contract. Read the blocking and major sections before touching anything.
- The 2026-08-04 audit is in `docs/AUDIT.md`, findings 1 through 20, each with its evidence. Read it before touching the facade, the fx capacity options, the kernel ramp table, or anything in the embedded port. Findings 10 and 11 carry a correction: they claim CI enforces things, and CI has never run.
- An earlier 22-agent review confirmed and fixed 17 findings (commits `5baef09`, `74e4cbe`). Read those before touching kernel timing, the scheduler, dynamics, spectral, loudness, sf2, or midifile parsing.
- The oscillator antialiasing gate is enforced by spectrum-measuring tests in `test/dsp-osc`. The 4-point polyBLEP was tried and measured insufficient (about -37 dB); the shipping implementation is a tabulated Kaiser-sinc BLEP, measured at -85 dB or better through the musical range, -94 dB at A440, and -73 dB at its worst anywhere in the band (saw at 19 kHz). Do not "simplify" it back. The per-frequency floors are gated in test/dsp-osc/blep-frequency.test.ts; "about -90 dB" was the figure quoted here and in three other places until AUDIT-3 measured the whole band.
- Bowed string realism history is in `docs/BOWED-STRINGS.md` with measured evidence; the spectral gates in `test/engines-physical/waveguide.test.ts` are the contract. Do not loosen a gate to pass a change.

## The plan

"Completion" here means: the embedded library is published, running on real hardware, and bellows.live can drive a board over a wire. Six milestones, ordered so each one is useful even if the next never happens.

### Milestone 1: hear it

The unvalidated assumption. Everything else is built on the belief that this works.

- Get a Teensy 4.1 and a Rev D audio shield. `examples/platformio.ini` already builds all five examples; flash `01_OneKick` first.
- Confirm: sound, correct pitch, no clicks, no dropouts. Then `02_DrumMachine`, `03_PolySynth`, `04_ScalesAndTuning`, `05_MidiInstrument`.
- Measure real CPU load, which none of the current numbers cover. `AudioProcessorUsageMax()` on Teensy is the cheap way. The interesting number is polyphony at the top of the keyboard, not at A440, for the reason in Milestone 2.
- The Daisy path has since been built end to end against the real SDK, so this milestone is only the flashing: libDaisy 8.1.0 (commit `c02245d`), `examples/daisy_onekick` links as a complete Daisy Seed firmware image at 75784 B of FLASH and 13956 B of SRAM, and all five example render classes compile through `DaisyAudio` for the STM32H750. `docs/HARDWARE.md` has the two-row table and the two SDK traps it found (libDaisy's `CPP_STANDARD ?= -std=gnu++14`, and its uninitialised output buffer, which makes the adapter's clear load bearing). What has not happened is the same thing as on Teensy: nothing has been flashed or heard, and only `01_OneKick` has been linked to an image.
- Acceptance: a photo of a board making a sound, and a CPU number per example.

### Milestone 2: close the two known DSP risks

Both are now done in the TypeScript and the C++ respectively, with one part deliberately left for the board. What follows is what the measurements actually said, because in both cases they changed the answer.

- **BLEP pitch cost: DONE in the TypeScript, and it took two passes.** The durable number is
  arithmetic: the residual sum spans `2 * KERNEL_HALF * dt` edges on average, so 0.32 at A440,
  5.1 at 7040 Hz, 15.7 at the dt clamp where one sample can span at most 16. Wall-clock ns is
  NOT durable and should never be quoted alone: the same shipping class through two harnesses on
  one machine gave 22.6 and 59.8 ns at 7040 Hz. Measured as a ratio in one process, the default
  path peaks at 9.0x its A440 cost at the clamp, and a high lead is nowhere near that: 7040 Hz is
  about 3.7x, and the top of a piano is 4186 Hz. The 14x in `docs/AUDIT.md` is against 55 Hz,
  which is an unusually cheap reference.

  A kernel cap is the wrong instrument: rejection falls off a cliff exactly where the cap starts
  to bind, 39 dB for a fifth of the cost at 7040 Hz, and tapering recovers only 13 dB of that.
  What works is switching to a harmonic sum above `SWITCH_DT`, which takes the peak to 5.2x AND
  improves rejection (7 dB at 11 kHz, 21 dB at 13 kHz). Opt in via `boundedHighFreq`, default
  off, so the golden render is byte identical.

  The first version of this shipped broken and an audit caught it, which is worth reading before
  touching it again. It crossfaded between the two paths across a transition band, which means
  running BOTH across that band: it cost about twice the default over exactly the range it was
  meant to save in, and the peak did not move. And it cut the harmonic series at the kernel
  cutoff, where the kernel is still passing half of a harmonic, so a note sweeping through
  9261 Hz stepped by 0.16. The switch is now hard and every harmonic carries the kernel's own
  response, measured against what the residual path actually does to a harmonic to 6.5e-4.

  NOT ported to C++ on purpose, and this is a bring-up measurement. The cost argument rests on a
  sine being cheap, which it is in a browser and is not on Cortex-M7 with newlib, where `sinf`
  drags in `__kernel_rem_pio2f`. Measure `fm::Sin` against the residual sum on hardware, in both
  fast-math settings, before porting. Parity is unaffected because the C++ keeps the residual
  path at every pitch.

- **LFO phase in fixed point: DONE, and it was worth more than expected.** Phase now accumulates as a `uint32` counter in `bellows/config.h` (`PhaseIncrement`, `PhaseFromCycles`, `kPhaseToUnit`), used by `dsp/lfo.h` and by the `SineCarrier` in `fx/modfx.h`. The wrap is the natural unsigned overflow, so it costs neither a compare nor a branch. It moved three parity rows, not one: chorus 3.97e-2 to 2.02e-4, plate 2.44e-3 to 1.34e-5, formant 7.85e-4 to 1.39e-5. All three gates were retightened from the new measurements, and all three were watched failing on a mutation that put the add back in float, which reproduced the old numbers to two significant figures. Cost: at most 64 bytes of flash on any sketch, the same on Cortex-M7 and Cortex-M4, no RAM. An
  earlier revision computed the increment in double and cost 2560 bytes on M4 against 208 on M7,
  because a double on a single-precision part pulls in soft-float. It bought nothing: single
  precision gives identical parity, since multiplying a float by 2^32 only moves the exponent.

### Milestone 3: finish the layers that are nearly free

The theory and sequencing layers are the reason to choose this over DaisySP or Mozzi, and they cost almost nothing: the whole theory layer is 2624 bytes of flash and 116 of RAM. Finishing them is high value per byte.

Not yet ported:
- `seq`: `pattern`, `transport`, `time`. `markov` is DONE: `seq/markov.h`, a rewrite rather than a transcription, templated on alphabet size, context capacity and maximum order, with the context packed into a uint32 instead of stringified. The default `Markov<8, 32, 2>` is 1556 bytes and nothing allocates. It is compared in `tables.cpp` at 74 rows, and unlike the arp's random mode the DRAW is compared too: `NextWith(float r, ...)` takes the uniform instead of drawing it, so both sides walk the same exactly-representable r and the generator's float rounding stays out of a comparison that is not about it. Seven mutations were watched failing on it, including one that did not fire and was a bad mutation rather than a weak gate: `<=` against `<` in the weighted walk is unobservable unless a draw lands exactly on a cumulative boundary, so the `edge` case exists to put one there.
- `theory`: `progressions`, `voicelead`, `scala`

Each one gets a row in `tables.mjs` with an exact comparison. That harness is where they get proven.

### Milestone 4: the remaining engines and effects

In value order, with the reason each was deferred:

- `fx/reverb` (FDN): straightforward, and the size sketch will tell you whether eight lines fit where you want them.
- `fx/freqshift`: small, uses a Hilbert pair with `Float64Array` biquad state in the JS; audit that before porting to a single-precision target.
- `engines/noisesynth`, `engines/additive`, `engines/harmonic`: additive and harmonic use `Float64Array` phase accumulators, so read `docs/HARDWARE.md` on double precision first.
- `engines/wavetable`: needs its 320 KB mipmap generated into flash by a build step. `tools/gen-tables.mjs` is the place for that; it already emits the BLEP tables the same way.
- `engines/waveguide` (the string): about 650 lines, 24 body-mode biquads, an STK friction table, a bow position comb, a second polarization, and a 17-mode forest seeded at module load. The forest seeding needs a decision: bake the table into flash, or generate at `Init`.
- `engines/sampler`: needs host-prepared flat binary banks on SD. Do not port SF2 or SFZ parsing; parse on a host.
- `dsp/fft`, `dsp/stft`, `fx/spectral`, `analysis`: swap `RealFft` for CMSIS-DSP `arm_rfft_fast_f32` on Cortex-M, ESP-DSP on Xtensa. Each spectral effect is 84 to 204 KB of state, so these are the ones that decide whether a board has enough RAM.

### Milestone 5: the wire

The endgame from the research: keep bellows.live as the composition brain and put only the audio kernel on the board.

- `KernelEvent` is already flat and numeric on both sides with matching enum values. `bellows/kernel.h` has the queue and the block-splitting render loop.
- Build the host side: serialize `KernelEvent` from `Transport.scheduleHorizon` over USB serial. At sixteenths and 120 bpm that is eight events per second.
- Build the device side: a lock-free single-producer ring feeding the kernel, plus a sample clock the host lookahead targets.
- Acceptance: a pattern authored in the browser plays on the board, in time, with the same seed producing the same noise (which the label rule in `prng.h` makes possible).

### Milestone 6: publish

- The Arduino Library Manager route is DECIDED, see "Decisions, made" above: a mirror repository holding only `packages/bellows-embedded`, pushed by CI on tag, because the Manager indexes repositories and not subdirectories and a release-zip flow stays manual forever. PlatformIO can consume the subdirectory directly today and needs nothing.
- Tag, release, and add the library to both registries.
- Wire `publint` into CI, which is the one CI gap left.

## Decisions, made

These were open. They are decided now, on 2026-08-06. Each says what and why, so a later session
can disagree with the reasoning rather than reopen the question from nothing.

**Packaging and direction**

1. **Arduino Library Manager: a mirror repository, not release zips.** The Manager indexes
   repositories and not subdirectories, and a zip flow is manual forever, which is the same shape
   of problem as a number nobody checks. A mirror can be pushed by CI from
   `packages/bellows-embedded` on tag. PlatformIO consumes the subdirectory directly today and
   needs nothing.
2. **The TypeScript stays the source of truth.** Compiling the C++ to WASM would end parity drift
   permanently, and it costs the tier 3 JavaScript story, most of the suite's ergonomics, and it
   is a rewrite. The harnesses work: 34 parity rows, four of them exact, plus 318 value rows.
   Revisit only if parity maintenance starts costing more than the harnesses save, which it does
   not.
3. **`SetupLog` and `VoicePool` come out of the public index at 0.2.0, with the barrel.** Both are
   implementation details and removing them is breaking, so batch every breaking change into one
   release rather than dripping them.
4. **`Eq3` stays**, and `UNPORTED_BY_DESIGN` is the precedent: every deliberate non-port carries
   that marker or the orphan report becomes noise nobody reads.

**Behaviour, and these are the ones that change code**

5. **The six buffer-owning classes clamp and REPORT.** Not throw, because an MCU builds
   `-fno-exceptions` and has nothing to unwind to inside an audio callback, and not silently,
   because that is the current defect. Each grows the accessor `Pluck::MinFreq()` already
   demonstrates, so a caller who read its rate back from the SDK can ask what it actually got.
   `BELLOWS_SAMPLE_RATE` must also reach `Pluck<>` and `StereoDelay<>`, which hardcode 48000 while
   the flag's own documentation claims it sizes them.
6. **The scale layer becomes tuning aware.** This is a bug fix and not a feature: `Tuning` is
   correct, `degreeFreq` in tuning.ts already does the right thing, and it is called from
   nowhere while `Scale.degreeToMidi` hardcodes a 12 semitone octave above it. Under 19-EDO the
   documented degree workflow returns an octave of 1.549. Route `Bellows.freqOf` through
   `degreeFreq`. It also happens to be the competitive gap against Tune.js.
7. **Input validation policy, one rule everywhere:** reject non-finite at the setter and keep the
   last good value, clamp out-of-range, and never throw on the audio path. Throw only from a
   constructor, where there is a caller to catch it. This is already what the facade, the filters,
   the envelopes and `VoicePool.setParam` do, so the work is making the stragglers match rather
   than choosing a policy.
8. **`render()` must not post structural messages at the live kernel** and `b.now()` must be
   render aware. Exporting while playing currently rewrites the live mix, which is a defect and
   not a design choice.
9. **`b.rng(label)` returns a handle that resolves through the active context on every draw.**
   The README and every doc page teach capturing a stream outside the clock callback, and that
   pattern is not reproducible under `render()` today. The library's central promise is that a
   seed reproduces a render, so the documented pattern has to be the one that works.
10. **The setup log gets collapse keys for `createBus`, `registerBank`, `registerGrain` and
    `defOp`, and there is a `removeBus`.** Unbounded growth in a log that `render()` replays is
    the same leak `Instrument.dispose()` already fixed for channels.
11. **Modal moves its rng draws to note-on**, so a retrigger cannot diverge from the JS stream.
    Per-sample draws make the C++ and the TypeScript disagree by construction.
12. **The worklet processor stops on dispose.** Returning true forever leaks a processor per
    boot.

**Deferred deliberately, with the trigger written down**

13. **`core/register.ts` moving to a `composition/` layer waits for 0.2.0.** It is right, it is 22
    of the repository's 26 upward imports, and it is a structural change to a package that
    shipped 0.1.6 hours ago. Batch it with the barrel trim, which touches the same surface.

## The work queue, in the order I would take it

Every one of the 95 findings in `docs/AUDIT-2.md` was re-verified against the code on
2026-08-05, after the fixes below landed, by agents that had to produce a file and line or a
command output for each verdict. The tally: **8 fixed, 8 partial, 77 open, 2 not a defect.**
The lists here are that triage, grouped by whether they need a decision from you.

**Read this before trusting the count.** Four of the five findings the earlier pass refuted were
re-raised by the re-verification, because the refuted list lives at the end of a 90 KB document
and nobody reading a finding ever gets there. They are now annotated inline at their own
headings. Refuted, do not act on them: the ladder cutoff (twice, lines 135 and 249),
`romanToChord`'s accidentals, `pattern.fast()`'s cycle length, and the plate's gate coverage.
Subtract them and 73 findings are genuinely open.

### Done, with the commit

- NaN guards on the parameter path, `c57e15d`, completed in `e28db8d` once a re-verification
  showed the recursive units were never covered.
- SFZ macro expansion and include fan-out bounded, `3f6de1e`, then time and retained heap
  bounded in `5cc22ab` after a review found the first pass had bounded the wrong resources.
- `Pluck::NoteOn` overflow, `07a07f1`, plus `npm run memsafety`; then the delay line and three
  more call sites made NaN safe in `ac99eb1` after the same review found a live out-of-bounds
  read in the function that commit had hardened.
- Embedded README under `check-docs`, `92bc579`, widened to six documents and five measurement
  sources in `1c2a08d`.
- Coverage holes closed, `30dec12`, then the effect rows given the bit-exact input they had
  claimed for months, `939e8d5`.
- Seven embedded correctness findings, `b9782dc`. The label hash is the one that mattered:
  `Xmur3` read plain `char`, so any label byte at or above 0x80 hashed differently on the board
  than in the browser, and the host-only harness could not see it.
- Five TypeScript safety findings and four music theory findings, `e28db8d`.

### What the reviews taught, and it is the same lesson three times

Each of the three commits above was reviewed by an agent whose default was to refute it, and
each review found something real. Not one of the central claims fell over, and every one of the
supporting claims that overreached did. A gate that passes is not the same as a gate that
measures, a comment asserting a property is not the same as a gate on it, and a mutation that
does not fire is as likely to be a bad mutation as a weak gate.

- The SFZ caps bounded memory and resolver calls and left CPU time unbounded: 651 bytes cost
  43 seconds. Bounding an amplification means bounding every resource it amplifies.
- Three separate comments said the parity effect input was bit exact. It never had been, and for
  the delay row about seventy percent of the measured drift was that untruth. It is a gate now,
  not a comment.
- The delay parity row was vacuous on its own default params: both times clamped to the buffer
  maximum, so the echo landed past the end of the render and feedback, damping and cross-feed
  never reached the output.

### Open, no judgement call needed

Nineteen of these were closed on 2026-08-05 in `b9782dc`, `e28db8d` and `1c2a08d`. What is left,
with line numbers into `docs/AUDIT-2.md`. Note those line numbers shifted by five when the
refuted findings were annotated inline.

**Embedded.**

- `bellows::Clamp` in `config.h` passes NaN through, the same shape as the pluck defect. Harmless
  everywhere the harness currently reaches, because the delay line clamps now absorb a NaN read
  position and the four undefined casts are guarded, and the next engine that casts a clamped
  float to an index reintroduces the fault. Deliberately left: it is a library-wide behaviour
  change that needs its own parity argument.
- `fm::Log2(NaN)` under `BELLOWS_FAST_MATH` punts the NaN through a union type pun and returns
  finite garbage where libm returns NaN. Defined behaviour, so nothing gates it, but the two
  paths disagree. `Exp2` was the one that was actually undefined and is fixed.
- `params.gen.h` still has no compile-time consumer (117).

**TypeScript.**

- `Adsr` sustain changed mid-note steps the level in one sample (491); with sustain 0 a voice
  never goes idle and the release runs about twice its configured time (497).

**Architecture and duplication.** None of these were touched, and all five are refactors rather
than defects, so they are the natural next chunk.

- Schroeder allpass implemented twice, verbatim, inside the fx layer (334). Check byte-for-byte
  equivalence before merging them: the golden render runs through one of the two.
- `ChromaAnalyzer` and `OnsetDetector` each hand-roll the framer `dsp/stft.ts` already provides (340).
- `SampleZone` and `SamplerZoneData` are field-for-field twins bridged by an unchecked cast (346).
- `TempoPoint` is declared in the contracts file and used nowhere (358).
- `engines/soundfont.ts` and `core/scheduler.ts` both import upward (370). Type-only.

**Coverage.**

- The `Svf` cutoff gate is a -4 to -2 dB band that admits roughly 11 percent cutoff error (224).
- `voiceLead`'s unequal-size branch, including the crossing penalty, is never executed (466).
- `Scheduler.rewind()` has no test and it is on the `b.start()` path (472).
- The Web MIDI runtime path is uncovered; only parsing is tested (478).
- The gate's range floor and the delay's time smoother are both unreachable from the parity
  output. Recorded next to their rows with the arithmetic; both need an instrument the harness
  does not have, one reading gain directly and one changing a param mid-render.
- A 0.1 percent `Foldback` mutation moves `westcoast` to 1.04e-2 against a 2e-2 gate and fires
  nothing, and the same shape of `TanhShape` mutation moves `kick` to 3.47e-4 against 1e-3.
  Both rows are looser than they look. `saturator_fold` now covers Foldback itself.
- `gen-tables --check` warns about a stale `dist` and then reads it anyway, so it passes on a
  stale checkout (31). The clean-checkout half is fixed in `ci.yml`, which has never run.
- `chordToRoman` still throws for 6 of the 408 shipped scale and chromatic root pairs: four
  scales have four-semitone gaps, so a root in the middle is more than one accidental from any
  degree. A genuine limit of single-accidental spelling, and the message now says so.

**Documents.** `apps/workbench/public/llm.txt` still claims to be exact for 0.1.5 and predates
the audit fixes (206). It is generated from the BUILT library, so fixing it means building and
regenerating, which the release ritual now spells out. Everything else a command can print is
under `check-docs`, and what is not is listed in that file's header and at the point where
HARDWARE.md promises reproduction.

### Decided, not yet done

These were the owner-decision list. The calls are recorded above under "Decisions, made", so what
is left here is work rather than a question. Ordered by what I would take first.

- ~~The west coast fold chain runs at 1x with no antialiasing (129)~~ DONE, `95e1815`.
- ~~The BLAMP table's drift-removal step is the wrong correction (237)~~ DONE, `c731a90`.

**And a correction to how these three were filed.** All three were listed here as changing
rendered output and moving the golden render. Two of them do neither: the fixture piece drives
va, fm, kick and pluck, so west coast is not in it at all, and va's oscillators are not
triangles so nothing in the piece reads the BLAMP table. Both fixes landed with
`test/golden/piece-a.f32` untouched. Check what the fixture actually contains before assuming a
DSP change is gated behind it.
- **The string waveguide is up to 23 cents flat below about 165 Hz (37), and the obvious fix is
  the wrong one.** Measured: -23.14 cents at 41.2 Hz, -17.30 at 55, -11.36 at 82.4, -7.70 at 110,
  -4.34 at 165, -2.30 at 220, +0.76 at 440. Both pitch gates sit at 220 and 440, so they are
  blind to it by construction.

  The finding blames the dc blocker, whose phase lead is compensated only at f0, and it is right
  about the mechanism. It is wrong that weakening the blocker fixes it. Measured by sweeping the
  blocker coefficient, tuning error in cents at 41.2 / 110 / 440 Hz:

  | dc coefficient | 41.2 Hz | 110 Hz | 440 Hz |
  | --- | --- | --- | --- |
  | 0.0005, shipping | -23.14 | -7.70 | +0.76 |
  | 0.0001 | -4.65 | -1.59 | +8.84 |
  | 0.00002 | -0.87 | -0.03 | +15.72 |

  The bass comes good and the treble falls apart, because the blocker's phase lead was partly
  CANCELLING the error from the four dispersion allpasses and the damping pole, which are
  compensated at f0 only as well. Trading 23 cents flat at 41 Hz for 16 cents sharp at 440 is a
  worse instrument, and 440 is the pitch anyone actually plays.

  So this needs the third remedy the finding lists and not the first: a tuning allpass whose
  group delay is flat across the harmonic band, replacing the single-frequency `readDelay`
  compensation entirely. That is a redesign of the loop's tuning, not a coefficient change, and
  it should be done with the measurement above as its acceptance test. Attempted and deliberately
  not shipped on 2026-08-05, because a half fix here is worse than the defect.
- The bow position comb delay is twice the physical value (123).
- `b.render()` is not reproducible for the rng pattern the README and every doc page teach (55).
  A real fix changes what render emits for every piece written the documented way.
- The scale layer is hardcoded 12-EDO above a correct tuning layer (93). `degreeFreq` already
  does it right and is called from nowhere.
- Six buffer-owning C++ classes still disagree silently when the template rate and the `Init()`
  rate differ (67, and `config.h` half-wires `BELLOWS_SAMPLE_RATE` at 261). Only `Pluck`
  corrupted memory and only `Pluck` is fixed; the rest clamp, so they detune or stop sweeping.
  `memsafety` now proves they are memory safe and says nothing about whether they sound right.
- `core/register.ts` puts the composition root in the bottom layer, 22 upward imports (111).
- The public surface is 293 symbols from one flat barrel with 33 star exports (347).
- `createBus`, `registerBank`, `registerGrain` and `defOp` grow the setup log without bound, and
  there is no `removeBus` (581).
- Input validation on public methods is inconsistent: some throw, some clamp, most accept
  anything (587).
- Modal draws rng per rendered sample, so a retrigger diverges from the JS stream (527).
- `05_MidiInstrument` pitch bend never reaches a sounding note (267).

### Strategic, from the landscape research

Full reasoning and sources in `docs/LANDSCAPE.md`, which labels every claim MEASURED, SOURCED or
SECONDHAND. In priority order: `int16` delay storage (the delay buffers are still 86 percent of
RAM in `s5_all`); making the scale layer tuning-aware, which is finding 93 above and a
competitive gap against Tune.js at the same time; CMSIS-DSP for the spectral family, which also
decides whether a board has the RAM; and psychoacoustic analysis, which nothing surveyed
occupies.

**Deliberately not doing**, reasoning in `docs/LANDSCAPE.md`: fixed point below the Cortex-M4
line, multi-target codegen, and replacing the tabulated BLEP with polyBLEP, DPW or PTR.

### CI, which has now run

`.github/workflows/ci.yml` ran for the first time on 2026-08-05, on PR #1. It found four things
that no local command could, which is the whole argument for it:

1. **`npm ci` could not install this repository at all.** `bellows-embedded@0.1.0` was in
   `workspaces` and had never been recorded in `package-lock.json`. `npm install` reconciles that
   silently, so every documented command worked on a machine that had installed once, and a clean
   checkout failed four jobs on it.
2. **`npm run fastmath` could not run on a clean checkout.** Its build directory is gitignored and
   the script never created it. Every document listing it as a verification command was wrong for
   anyone who had not already built.
3. **The compiler decides the size tables.** The workflow installed GCC 12.3 while the documents
   record 11.3.1, and 36 of 37 sketches move between toolchains. CI installs PlatformIO's Teensy
   toolchain now, the one that builds the actual firmware.
4. **So does the host.** With the SAME toolchain package and version, Linux comes back exactly 8
   bytes heavier than macOS on five sketches, every RAM figure matching. Byte figures are
   reproducible on the host that measured them and approximately anywhere else. CI passes
   `--allow-host-drift`, bounded at 16 bytes, printing every allowance; a local run stays exact.

**Read this before trusting a green tick.** CI is a control on PULL REQUESTS and nothing else.
Pushing to `main` does not trigger it, established by measurement rather than by reading the
file: the merge of PR #1 produced no run, the push after it produced no run, and a deliberate
test push was watched for two minutes and produced no run. A `workflow_dispatch` on the same
commit ran all six jobs green immediately, so the workflow, the triggers as written
(`push: branches: [main]`), the default branch and the Actions permissions are all correct and
the push event simply does not arrive.

The mitigation is the workflow this project should want anyway: **every change to `main` goes
through a pull request**, where CI does run, and `workflow_dispatch` exists for demanding a run
on `main` directly. Do not read a quiet `main` as a passing `main`. If someone works out why the
push event is dropped, that is worth knowing, but the PR route makes it a curiosity rather than
a hole.

Keep it that way. The gates are only controls while this runs.

It went green on the sixth attempt, all six jobs. Two more things it found on the way, both
consequences of widening `check-docs` beyond the size report: the embedded job had no node and no
workspace installed, so the harnesses it now calls could not run there, and the host allowance
covered table rows but not figures written into sentences.

The allowances are worth understanding before trusting a green run. `--allow-host-drift` is CI
only and covers two things: 16 bytes on a flash figure, and 25 percent on a measured parity
figure. Both bound a number pasted into a document and neither bounds a gate. `parity.mjs` sets
its gates at roughly ten times their measurement and passed on both hosts in every run, so the
check that decides whether the C++ still matches the TypeScript is forty times tighter than the
loosest allowance. A local run is exact. Every allowance is printed and counted on a `note` line.

**Next action on this branch: merge PR #1.** The site builds from `main` (`.do/app.yaml`), so
bellows.live is still serving pre-audit code until that happens, and the deploy step of the
release ritual has deliberately not been run for that reason.

## What actually fits on hardware, and where the room came from

Two part answer, and the parts point in opposite directions.

**The room was made by the size pass, not by the correctness work.** Two changes account for
nearly all of it, both written up with their tables in `docs/HARDWARE.md` under "Making it
smaller", which `check-docs` verifies. Do not restate those figures here, read them there.

- **Exact delay sizing** took `s5_all` from 300144 to 223324 bytes of RAM: 76820 bytes, 25.6
  percent, off the constraint that actually binds. Bit identical output, so no parity row moved.
- **Routing every transcendental through `fm::`** made `BELLOWS_FAST_MATH=1` real. It had been
  documented for months as the flash-for-accuracy trade and saved essentially nothing on any
  sketch with an oscillator, because the oscillators still called libm. It now takes 26 to 75
  percent off, depending on the sketch.

**The correctness work since has cost space rather than saved it.** Small, but not zero, and not
recorded anywhere else, so here it is. Flash on Cortex-M7, measured against the start of the
2026-08-05 session:

| sketch | before | now | delta | why |
| --- | --- | --- | --- | --- |
| `s5_all` | 35104 | 35096 | +64 | NaN guards in the delay line, plate, dynamics and fastmath |
| `s3_pluck` | 6552 | 6728 | +176 | the `MinFreq` clamp and the excitation bound |
| `s9e_westcoast` | 16784 | 17656 | +872 | the 4x fold oversampler |

The west coast voice also went 1204 to 2564 bytes of RAM, and that one is worth watching: most of
the increase is the oversampler's scratch rather than its filter state, so it is per voice today
and could be shared across a pool. At eight voice polyphony that is roughly 10 KB that does not
have to be spent.

**Where that leaves the two boards** is the capacity table in `docs/HARDWARE.md`, also checked.
The short version: flash has never been the binding constraint on either target, `s5_all` uses
about a quarter of a Daisy Seed's internal flash and a fifth of that with fast math, and RAM is
what binds. The delay buffers are still 86 percent of what `s5_all` uses, which is why `int16`
delay storage is first on the strategic list: it is the largest lever left on the only number
that has ever been tight.

**RAM only binds if you keep the buffers in internal memory, and both target boards have somewhere
else to put them.** This is the most useful thing about the delay line and it was not written down
anywhere: `DelayLineExt` takes caller-provided storage precisely so the placement is the
application's choice, `DMAMEM` or `EXTMEM` on Teensy, `DSY_SDRAM_BSS` on Daisy. The arithmetic
that follows is worth having in front of you before optimising anything:

| | flash | SRAM |
| --- | --- | --- |
| `s5_all`, buffers in internal SRAM | 35096 B | 223324 B, 43 % of a Daisy Seed |
| `s5_all`, buffers placed externally | 35096 B | about 31 KB, 6 % of a Daisy Seed |

A Daisy Seed has 64 MB of SDRAM and a Teensy 4.1 takes soldered PSRAM to 16 MB, so on either
board the whole ported engine set costs about 31 KB of the scarce memory once the buffers move.
`int16` storage is still worth doing, because it halves the buffers wherever they live and not
every board has external memory, but the framing "RAM is 43 percent" describes one placement
choice rather than a property of the library.

**What none of this tells you is how many voices will actually run.** Every figure above is from
the linker. CPU has never been measured on hardware, so flash and RAM say what FITS and nothing
says what KEEPS UP. The one durable CPU fact is arithmetic rather than measurement: the BLEP
residual walks `2 * KERNEL_HALF * dt` edges per sample, 0.32 at A440 and 5.1 at 7040 Hz, so a
high lead costs several times a bass note and polyphony at the top of the keyboard is the number
to take on the board first.

`s5_all` is the worst case on purpose. It constructs and drives every ported engine and effect at
once, which no instrument does.

## Can a given board run this, and the ESP32 question specifically

Asked on 2026-08-06 and worth writing down, because the answer is three different questions that
keep getting collapsed into one.

**Will it fit?** Yes, and this part is measured. About 35 KB of flash and, once delay buffers are
placed externally, about 31 KB of RAM. No board anyone would consider is short of that.

**Will it keep up?** NOBODY KNOWS. Nothing has run on hardware. `docs/HARDWARE.md` used to open
with "Compute is not the constraint and never was" as though it were a finding; it is an
assumption resting on a host benchmark that is on that document's own not-reproducible list, and
the same oscillator measured 22.6 and 59.8 ns per sample through two harnesses on one machine. It
is now labelled there as an assumption. Treat it as plausible on a 600 MHz Cortex-M7 with a
double-precision FPU and thin on a 240 MHz single-precision part.

**Can you even target it?** For ESP32, no, not today, and this is the part the board table hides.
`src/bellows/platform/` contains `teensy.h` and `daisy.h` and nothing else. The tier table in the
embedded README lists ESP32-S3 and ESP32-P4 under "Most", but that table is read off data sheets
and no code supports those parts: targeting one means writing the platform layer first. The
README now says so.

### What actually decides it, per part

- **Double precision is the measured trap.** A `double` in an inner loop costs 1.07x on
  Cortex-M7, where doubles are hardware, and **6.08x on a single-precision FPU**, where every
  operation is a soft-float call. EVERY ESP32 is single precision. The tempo map and the theory
  math are deliberately `double` to keep event timing bit-identical to the browser, which is fine
  because they run at control rate; but `additive` and `harmonic` use double phase accumulators
  at audio rate and must not be ported to a single-precision part without rework. They are
  unported today, so this is a constraint on Milestone 4 rather than a present defect.
- **The external-memory escape hatch may not transfer.** Moving delay buffers off-chip is what
  takes RAM from 43 percent of a Daisy Seed to 6, but a delay line reads once PER SAMPLE. Daisy
  SDRAM sits behind an H7 cache; ESP32 PSRAM is off-chip and weaker. Do not assume the Daisy
  result carries to an ESP32 until someone measures it.
- **Pitch, not voice count, is what will bite.** The BLEP residual walks `2 * KERNEL_HALF * dt`
  edges per sample: 0.32 at A440, 5.1 at 7040 Hz. A high lead costs several times a bass note, so
  the interesting measurement is polyphony at the TOP of the keyboard, not at A440.

### My reading, and it is architecture and not measurement

Labelled the way `docs/LANDSCAPE.md` labels things, so nobody inherits it as a fact.

| part | read |
| --- | --- |
| Teensy 4.1, Daisy Seed (M7, 600 and 480 MHz, double-precision FPU, dual issue) | the designed targets, should be comfortable, UNPROVEN |
| ESP32-P4 (RISC-V, about 400 MHz, FPU) | the most promising ESP32, still needs a platform layer |
| ESP32-S3 (Xtensa LX7, 240 MHz, single precision) | plausible at modest polyphony. ESTIMATE, roughly a quarter to a fifth of a Teensy 4.1's throughput: 2.5x clock deficit plus a weaker FPU pipeline and no dual issue |
| ESP32 classic | the README's "a couple of voices at best" is probably right |
| ESP32-C3, C6 | no FPU. Do not. |

An hour on a real Teensy with `AudioProcessorUsageMax()` replaces this entire table with numbers.
That is Milestone 1, and it is blocked on nothing but a board existing.

## Verified end to end on 2026-08-05, after the fix pass

The suites and the harnesses are not the product. The library ships to a browser and drives
bellows.live, and this session changed shared DSP, the parameter path, the theory layer and the
SFZ parser, so the app was driven for real in Chrome against the dev server rather than assumed.
What was measured, not inferred:

- `npm run build -w packages/bellows` clean; `npm run build -w apps/workbench` clean;
  `npx vue-tsc --noEmit` clean.
- An analyser tapped onto whatever connects to `destination`, so the numbers come off the real
  worklet output and not off an offline render. Playing the default seeded piece: peak 0.640,
  RMS 0.103, and **zero non-finite samples in 81920 inspected**. That is the check that matters
  after a NaN pass, because the offline suite exercises `renderOffline` while realtime runs the
  generated worklet bundle, and those are different code paths.
- 8-bar export while playing: rendered in 1516 ms, which matches the roughly 1.4 s this document
  already claimed. The WAV is a valid 44100 Hz stereo 16-bit RIFF, 26.67 s, peak 0.663, 99.9
  percent non-silent, DC offset 0.00056. Live audio kept running through the render, peak 0.437,
  still no non-finite samples, which is the `render()` no-await invariant holding.
- Engine hot-swap mid-phrase, pluck to additive through the real `<select>`: audio continues at
  peak 0.431, RMS 0.117, no non-finite samples.
- Console clean throughout: no errors, no warnings.

The dev server was stopped and the tab closed afterwards. No file was downloaded: the export
presents a link rather than writing one, and the blob was read in memory.

## What changed for a user of the published library

Nothing here moves the golden render, and only one item changes seeded audio.

- **Non-finite parameters are ignored instead of latching.** `Svf`, `LadderFilter`, `OnePole`,
  `Smoother`, the envelopes and the kernel `Ramp` now keep their last good setting when handed
  NaN or Infinity, where before one NaN silenced that unit for the rest of the session with no
  error. Strictly a recovery: nothing that worked before behaves differently.
- **`chordToRoman` spells raised degrees with sharps.** F# in C major was `bV` and is `#IV`.
  Spelling now follows the line of fifths, which reproduces the textbook set. `romanToChord` is
  untouched and the two still round-trip, gated over 402 pairs.
- **`chordToRoman` no longer throws past the seventh degree**, so five of the thirty-two shipped
  scales can be analysed at all. Six of 408 scale and root pairs still throw, because four
  scales have four-semitone gaps and single-accidental spelling genuinely cannot name them.
- **`CHORD_TYPES` gained `maj7#5`**, 24 entries to 25, without which harmonic minor's III has no
  name. The C++ port has the matching entry, so the table harness compares it.
- **`buildProgression(bars = 2)` returns a half cadence** instead of `[0, 0]`. THIS IS THE ONE
  THAT MOVES SEEDED OUTPUT: it draws one rng value where it drew none, so a piece written
  against `bars = 2` sounds different. `bars >= 3` is byte-identical, and the workbench uses 8.
- **`parseSfz` enforces six limits** and throws its own `sfz:` errors past them. A legitimate
  file is unaffected: 2.1 MB and 20000 regions still parses, in 51 ms.
- **`DelayLine` throws for `maxSamples` at or above 2^30** instead of hanging the tab.
- **`quick.play()` recovers from a failed boot** instead of rejecting for the life of the page.

Standalone bundle: 108400 bytes gzipped, from 106147, a 2.1 percent rise for all of the above.

## Deployment (bellows.live)

The site is a DigitalOcean App Platform static site, the cheapest App Platform footprint (no services or workers; $0 while a free static-site slot is open on the account, otherwise $3 per month).

- App id `88dc2901-3334-47d9-9cb5-8b2f1105294d`, name `bellows-live`, default ingress `bellows-live-ivsci.ondigitalocean.app`, custom domains `bellows.live` (primary) and `www.bellows.live` on the DO-managed zone.
- Spec lives at `.do/app.yaml`. It pulls the PUBLIC git repo directly (`git.repo_clone_url`), so there is no GitHub integration and no deploy-on-push: pushing to main does NOT redeploy. To ship site changes: push to main, then `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d`.
- Spec changes: edit `.do/app.yaml`, then `doctl apps update 88dc2901-3334-47d9-9cb5-8b2f1105294d --spec .do/app.yaml`.
- The build runs `npm install && npm run build -w apps/workbench` against the monorepo, so the site always ships the library source at that commit.
- The app shell: light theme is default (`:root` tokens in `apps/workbench/src/styles/forge.css`), dark under `data-theme='dark'`, toggled via `src/lib/theme.ts` (localStorage `bellows-theme`). Canvas drawing and CodeMirror read theme through that module; never hardcode palette hex in components.

## The site, second wave

- Landing page (default route) is plain-language with a copy-paste HTML CDN example; the dense material lives in a collapsed details block.
- INSTRUMENT page (#play): piano keyboard (mouse, multi-touch, computer keys A..L with Z/X octave, C/V velocity, SPACE sustain), Web MIDI with cc64 sustain, every engine plus activated soundfont presets, auto-generated param editors from ParamSpec metadata, an fx rack, and the looper.
- The looper (`src/lib/looper-store.ts`) owns a PRIVATE Transport and Scheduler ticked by its own interval so the workbench transport is never touched. Loop-pedal flow: REC boots the whole instrument, arms, 4-beat count-in, records one loop, auto-plays as a layer.
- Workbench SOUNDFONT + SAMPLES panel: multiple .sf2 banks (parse is main-thread, about 10 ms for a 6 MB GM bank), preset activation as engines under a SAMPLES optgroup, user sample kits with yin-detected root keys.
- LLM REF (#ref, footer link, raw at /llm.txt): generated by `apps/workbench/scripts/gen-llm-ref.mjs` from the BUILT library. Regenerate after any library change AND version bump, before deploying.
- SEO: full meta and OG set in index.html, robots.txt, sitemap.xml, favicon.svg, JSON-LD, noscript block.
- DOCS section: fourteen tutorial pages under `apps/workbench/src/docs/pages/`, path-routed at `/docs/<slug>`. Content accuracy contract: run pure-library snippets in Node against dist before editing claims.
- Legato: string and tube voices accept `setParam('freq', hz)` glides on the sounding voice; the instrument store does mono legato routing when `instState.legato` is on. Loop playback of legato takes re-attacks (documented limitation).

## Seam rules learned the hard way

- Anything stored in Vue `reactive()` state that crosses postMessage or owns internal slots must be `markRaw`: SoundFont instances (their DataViews die on proxy receivers) and every Float32Array destined for the kernel (proxied typed arrays fail structured clone). See `src/lib/soundfonts.ts`.
- `AudioContext.resume()` without user activation never settles; `Bellows.boot` races it with a 300 ms timeout. Never await a bare resume.
- `apps/workbench/src/lib/audio.ts` passes `closeContextOnDispose: false` because it deliberately reuses one context across reboots. Removing that flag closes the context the reboot is about to use, and audio dies silently.
- A slow test run is usually the machine. During the audit the suite went from 7.4 s to 87 s with two tests at 67 and 71 seconds, and it was contention: `user` time was identical while wall time doubled. Check `user` against `real` before hunting a phantom.

## Release ritual

1. `npm test` and `npx tsc --noEmit` in `packages/bellows`.
2. `npm run gen:worklet -w packages/bellows` if anything kernel-reachable changed.
3. `npm run build -w packages/bellows`; check `dist/worklet.js` exists and the standalone size is sane. Measure it rather than remembering it: `gzip -9 -c dist/bellows.standalone.js | wc -c` prints 108400 bytes, 106 KB, after the 2026-08-05 fixes, against 106147 before them and about 97 KB at 0.1.0. Compare against the previous release and ask about a jump over roughly ten percent; a fixed threshold from an old version is what turned 97 into a number three releases stale. Nothing checks this one: `check-docs.mjs` cannot, because it needs a built `dist`. Note also that `dist` goes stale against `src` silently (`gen-tables.mjs` warns and reads it anyway), so build before you measure, and before running any pure-library snippet against it.
4. Bump version, `npm publish` from `packages/bellows`, tag `vX.Y.Z`, push with the tag.
5. Regenerate the LLM reference: `node apps/workbench/scripts/gen-llm-ref.mjs`, commit `apps/workbench/public/llm.txt`. THIS STEP WAS SKIPPED FOR 0.1.5 AND THE FILE IS STALE, which matters because five documentation pages send readers to `/llm.txt` as the authoritative parameter list. It is generated from the BUILT library, so it needs step 3 first and cannot be edited by hand: `grep -c rampParam apps/workbench/public/llm.txt` prints 0 against 3 in `src/bellows.ts` and 2 in `dist/bellows.d.ts`, and the `maxSeconds` and `maxSize` capacity options from `docs/AUDIT.md` finding 5 are missing the same way, while the file's own line 11 says "Everything in it is exact for version 0.1.5". Rebuild, regenerate, then check that grep is non-zero before believing the header.
6. Redeploy the site (pushes do not auto-deploy): `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d`.
7. No Claude attribution in commits, no emojis, no em dashes, per `CLAUDE.md`.

For a change that touches DSP shared with the embedded port, add before step 4, from `packages/bellows-embedded`:

- `npm run parity` and confirm every gate passes. The PRNG row must be exactly zero.
- `npm run tables` for anything touching theory or sequencing.
- `npm run fastmath` if you touched `core/fastmath.h`.
- `npm run size` and sanity check against `docs/HARDWARE.md`.
- `node tools/gen-tables.mjs` if any `ParamSpec` changed, which is how a param added in TypeScript and forgotten in C++ becomes visible.
