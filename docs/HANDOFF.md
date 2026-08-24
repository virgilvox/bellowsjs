# HANDOFF

State of the project as of 2026-08-23. Read this first when picking the work back up. Companions: `docs/PRD.md` (what and why), `docs/ENGINEERING.md` (platform facts, DSP formulas, packaging research), `docs/AUDIT.md` and `docs/AUDIT-2.md` and `docs/AUDIT-3.md` (findings with evidence), `docs/HARDWARE.md` (the embedded port, with the flash and RAM measurements behind it), `docs/LANDSCAPE.md` (what else exists and where this leads), `CLAUDE.md` (house rules), `docs/KICKOFF.md` (a prompt for starting a fresh session), `docs/prototype-0.html` (the original design probe).

## The 2026-08-13 session, which changed the shape of the project

Still accurate, and everything it says was re-verified on 2026-08-16 except
where the corrections below say otherwise. Read the four items, then read
"Still not done", which is the current work.

Four things happened that a reader of the older sections below needs to know
before trusting them, because each one falsifies something those sections say.

**1. It ran on hardware, and there is a CPU number.** A Teensy 4.0 at 600 MHz
played `17_WorkstationI2S`, which is `07_Workstation` summed to mono and the
heaviest program in the set, through a MAX98357A at 44.1 kHz: **33.8 to 46.5
percent CPU, 47.3 percent peak**, 2 of 24 audio blocks. That is Milestone 1's
acceptance criterion and it replaces an assumption the whole repository rested
on. It has now run **twice**, on two builds and two arrangements, and the second
run is what those figures are: see the table in `docs/HARDWARE.md`. It is still
ONE board and ONE program: no other board has run anything, and nothing has been
compared to the browser by ear. The CPU figures are hand recorded from a serial
console, so no harness checks them, and `AudioProcessorUsageMax` is a running
maximum since boot rather than a bound.

**2. The engine set is complete.** `additive`, `harmonic`, `waveguide` and
`wavetable` are ported, so every engine the browser ships now exists in C++. The
parity table is **41 rows, up from 34**, and all of them pass:

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
DOCS page has a BROWSER / EMBEDDED switch over the embedded tree, which was nine
pages then and is sixteen now, restructured on 2026-08-21 so the first four are
a tutorial with sound in them. There
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

### Harnesses added on 2026-08-13

| command | what it proves |
| --- | --- |
| `npm run presets:check` (embedded) | the 50 C++ presets equal the TypeScript, 1054 values, exactly |
| `npm run check:embedded` (workbench) | every C++ snippet on the site compiles against the real headers |
| `node scripts/gen-llm-embedded.mjs` | the embedded LLM reference, from the headers, gaps reported not dropped |

### Harnesses added on 2026-08-15

| command | what it proves |
| --- | --- |
| `npm run check:catalogue -w apps/workbench` | `FIRMWARES`, the `case` labels in `buildVoice`, `VOICE_CAVEATS` and `GROUP_ORDER` agree. Both ways of getting it wrong are silent: a bad `group` drops the entry from the picker with no error, a missing `case` throws only when a visitor presses RUN |
| `npm run check:presets -w apps/workbench` | all 50 instrument presets render offline: audible, finite, at the pitch asked for, naming only parameters the registry knows. That last clause is the point, since a wrong engine parameter name is silent at every layer and has shipped twice |

Both are in `ci.yml` and both were mutation tested before being trusted. The
preset one is worth knowing about in detail: the mutation that renames a preset
parameter leaves the preset perfectly audible at the right pitch, and nothing
else in the repository catches it.

### Harnesses added on 2026-08-16

| command | what it proves |
| --- | --- |
| `packages/bellows-embedded/tools/build-mirror.sh [dest]` | assembles the Arduino Library Manager mirror: what ships, what does not, and the cross-folder flatten. Fails loudly if a referenced header is missing or a `../` include survives |
| `arduino-lint --project-type library --library-manager submit --compliance strict <mirror>` | the same rules the registry bot runs. Not installed by default; the 1.3.0 release binary from `arduino/arduino-lint` is what was used |
| `arduino-cli compile --fqbn teensy:avr:teensy41 <example>` | the example compiles in the real Arduino toolchain, which is a different question from PlatformIO and was answered wrong for the whole life of the port |

The third one is the important one and it is not automated. Installing the
library into `~/Documents/Arduino/libraries` and compiling is the only thing
that catches an Arduino packaging fault; PlatformIO passes an include path that
hides all of them. `05_MidiInstrument` needs
`--fqbn teensy:avr:teensy41:usb=serialmidi`, which is Tools, USB Type, Serial +
MIDI in the IDE, and is not a defect.

### Harnesses added on 2026-08-20

| command | what it proves |
| --- | --- |
| `node tools/check-docs.mjs --check` (extended) | the board's CPU figures, the parity and value row counts and the board support summaries agree with the one place that owns each, across 12 documents including two TypeScript pages and both top-level READMEs. `docs/HARDWARE.md` owns the run table, `examples/README.md` owns the build matrix, and the summaries are counted from it rather than read |
| `npm run parity` row `additive_morph_hi` | the morph lerp runs in the right DIRECTION. The existing row renders at morph = 0.5, where `1 - morph` is indistinguishable from `morph` |
| `arduino-cli lib install Bellows@0.1.1` then compile | the artifact the Arduino registry SERVES, rather than the tree that was submitted. Not automated, and the only thing that catches a packaging fault in the published zip |

The first of those is the one to know about, and not for the figures it now
covers: building it turned up that `--allow-host-drift`, the flag CI runs with,
was granting a 25 percent relative allowance to every prose figure and plus or
minus 16 to every integer one. A CPU percentage read off a serial console and a
count of harness rows were both going through it. There is an `exact` flag now.

### Harnesses added on 2026-08-21

| command | what it proves |
| --- | --- |
| `npm run check:listen -w apps/workbench` | every `listen` fence in the docs names a firmware that exists and params that exist on it. Both fail silently otherwise: a wrong id renders a play button that throws when pressed, a wrong param never shows its slider |
| `npm run check:links -w apps/workbench` | every documentation link resolves, in-app hash links name a mode `App.vue` knows, and both prev/next chains are the same walk as their sidebar |
| `npm run check:signatures -w apps/workbench` | every `template <...> class X;` quoted in the embedded docs matches the declaration in the headers |

Each found real defects on its first run, which is the only reason to believe
any of them. `check:links` found three broken links, two of them shipped an
hour earlier, plus a reading chain that had come apart when the tutorial was
inserted at the top. `check:signatures` found two template signatures that
release 0.1.2 had made stale, in the two pages that teach them.

The gap they close is one `check-docs.mjs` cannot: it compares FIGURES against
harness output, and a link, a fence and a template signature are none of them a
figure.

### Still not done, in the order I would take it

Ordered by cost to fix against risk of being wrong later. Four items, and the
first two are the ones that matter. Everything the 2026-08-15, 16, 20 and 21
sessions closed is summarised at the end of this list rather than deleted,
because the interesting part of a bookkeeping item is usually what it was
hiding, and twice now an entry that read as bookkeeping was covering a gate that
did not work.

**1. Hardware breadth, which is the real gap.** One board and one program, now
run twice. Nothing on a 3.x, nothing on an LC, nothing on a Daisy, and the two
parts without a floating point unit (LC and 3.2) are the whole question, because
they emulate every float operation this library performs in software.
`00_BringUp` exists for exactly this and **has still never been run**, checked on
2026-08-20, 2026-08-21 and 2026-08-23 rather than assumed: a
`/dev/cu.usbmodem11301` node is present every time and cannot be opened,
`Errno 6 Device not configured`, so nothing is enumerated behind it. Three
readings of the same thing is not evidence that it will stay that way; run the
check rather than quoting this sentence. It compiles: it passed the Teensy 4.1 sweep
over the published 0.1.2 package. Compiling is not running, which is
the single highest-value thing left on this list: it is a checklist sketch with a
written pass condition per stage, and its last two stages measure the pitch
dependence of the BLEP oscillator cost, which no test in this repository covers
and no amount of building will tell you. The other half is that nothing has been compared to the browser
BY EAR: 41 parity rows and 1054 preset values are a strong position and they are
not the same as having listened to both.

**2. The audit backlog. 33 open, down from 51.** `docs/AUDIT-2.md` has 25 open
and 8 partial, against 57 closed, 5 refuted and 1 not a defect. Five were closed
on 2026-08-23 and one new one was opened by auditing those closures, which is
the honest arithmetic and the reason the total moved by four and not five. Each carries its
status and evidence under its own heading, so that file is the register and this
one is not. The figure this entry gave three revisions ago, roughly 73, was wrong
by 22 and could not be reproduced from any document.

Nineteen of the 33 would change rendered output and are tagged
`[changes audio]` in the file: two were closed during the day and one was found. The `[under ten minutes]` tag is now empty: the
last three were taken on 2026-08-23. A finding with no tag has been judged
neither, rather than left unassessed: all 33 carry an explicit verdict on both.
This makes item 2 the whole of what is left, and every remaining finding is
either expensive or needs a decision.

The 20 tagged `[changes audio]` are now the bulk of what is left, and they are
the expensive kind: the string waveguide's bass pitch, the `rng` capture
lifetime, the engine parameters that are silent when misspelled. None of them is
a ten-minute job and several need a decision rather than a fix.

The largest single one is unchanged and is still the string waveguide being up
to 23 cents flat below 165 Hz, which matters more than it did: the engine is
ported, five presets use it, and the C++ reproduces the defect faithfully
because parity demanded it. Read the measurement below before picking it up. The
obvious fix was measured and trades 23 cents flat at 41 Hz for 16 cents sharp at
440, which is worse at the pitch people actually play.

One habit worth keeping: when the skeptics attacked the 51 claimed closures, 13
fell over, and the pattern in almost all of them was a fix applied to the
symptom a finding opened with rather than to the cause it named further down.
Read a finding to its end before calling it closed.

**3. Three quick findings nobody had looked at. Done on 2026-08-23**, and
written up under "Closed on 2026-08-23" below. Two closed, one is PARTIAL
because the measurement turned up something a test cannot fix: `voiceLead`'s
`crossPenalty` is unreachable by construction, so a published option changes no
output at any setting, and whether to delete it is a decision waiting on the
owner. Nothing else in this list depended on these three.

**4. The documentation restructure has a tail, and none of it blocks anything.**
`docs/DOCS-PLAN.md` steps 1 to 4 and part of 6 are done. What is left, in the
order the plan puts it:

- The remaining how-to guides: choosing a board, playing notes from MIDI, making
  a patch louder without clipping, fitting a patch on a board that is too small,
  hearing a generated piece again.
- Moving the explanatory passages out of the reference pages, so reference is
  lookup. Smaller than it sounds and worth doing when one of those pages is next
  touched rather than as a sweep.
- Adafruit's rule about commenting the variables a reader may want to change:
  every parameter `FIRMWARES` exposes as a slider should carry a range worth
  trying at its declaration in the example header. That is gateable.
- Two or three examples that are pieces of music rather than demonstrations of
  a subsystem. **This one is a day, not an afternoon**, and the plan says why: a
  new example folder needs a size sketch, a row in `examples/README.md` and in
  `check-docs`, an entry in `build-matrix.sh`, a `FIRMWARES` entry, a
  `buildVoice` case, `sources.gen.ts` regenerated, and a release to reach
  anybody.

Two of the sixteen closed that day came back when the day's own work was
audited: the `Adsr` one had fixed the sentence a finding opens with and left the
cause it names at the end, and the `defOp` one gates two links of a three-link
chain. Both are PARTIAL in the register with the reason. Fourteen of sixteen
survived, which is a better rate than the 38 of 51 on 2026-08-15 and is still
not a rate to assume.

Worth knowing before starting: the skeptic overturned a byte measurement in the
first finding it looked at, because the investigator had measured with the 9.2.1
toolchain rather than the 11.3.1 the documents pin. That is the toolchain finding
biting inside the session that was auditing it, and it is fixed now, in
`tools/size-report.sh`.

### Closed on 2026-08-23, and what each one turned up

The last three `[under ten minutes]` findings, taken in the shape that worked
sixteen times on 2026-08-20: read the finding to its END, separate the headline
symptom from the cause it argues for, propose an exact patch, attack the
proposal before applying it. That last step earned its keep twice.

- **The modal mode tables now say where they came from, all five of them.**
  The headline was that glass and wood carry no citation. The cause the finding
  names at its end is wider: a reader cannot tell which of the five tables are
  real and which are invented. So all five are annotated, and in BOTH trees,
  because `packages/bellows-embedded/src/bellows/engines/modal.h` carried the
  same five comments word for word. The two physical claims were re-derived
  rather than repeated: the roots of cos(x)cosh(x) = 1 squared and normalised
  give 1, 2.757, 5.404, 8.933, 13.344, 18.638 against the table's 2.756 and
  13.345, and the first eight Bessel zeros by magnitude give 1, 1.593, 2.136,
  2.295, 2.653, 2.917, 3.155, 3.500 against the table's 1.594 and 3.501. Both
  match to rounding. The bell row turned out to be the one described loosely:
  halved it reads 0.5, 1.0, 1.2, 1.5, 2.25, 2.665, so the first four ARE the
  hum, prime, tierce and quint of a tuned bell and the upper two are NOT the
  nominal. Glass and wood are recorded as voiced by ear, which is the cheap fix
  the finding sanctions. No gate, and the entry says so: this is provenance
  prose and `check-docs.mjs` compares figures, not comments.
- **`voiceLead`'s crossing penalty is dead code, not untested code.** This is
  the one that did not close. The finding reads as a coverage hole, and half of
  it is: the unequal-size branch is entered only when the previous voicing has
  FEWER voices than the chord has pitch classes, and no test had ever done that.
  Three tests now do. But the crossing penalty inside that branch cannot be
  covered by any test, because `prev` is sorted and `notes` is ascending, and
  nearest-neighbour assignment between two ascending sequences is monotone, so
  the inversion it looks for never exists. 1670526 exhaustive cases over eight
  voice-count shapes: zero crossings. 576 sweeps of the real exported function
  with `crossPenalty` at 0 and at 1000: zero differences. The same 576 under a
  `>` to `>=` mutant: 90 differences, which is how the zero is known to be a
  measurement rather than a broken probe. `crossPenalty` is exported, documented,
  defaults to 2, has no caller anywhere in the repository, and does nothing.
  **Decided on 2026-08-23: kept inert and pinned**, rather than deleted. Removing
  it would be a public type-surface change to `VoiceLeadOptions` for an option
  nothing sets, and the test that fails the moment it becomes live is cheaper
  than the break. Making it live was never on the table: a many-to-one nearest
  match has no crossings to penalise, so the concept is vacuous here rather than
  accidentally dead. The finding stays PARTIAL to keep the fact visible.
- **The facade's transport surface has tests now, which is what the
  `Scheduler.rewind` finding was actually about.** Its headline is that `rewind`
  has no test; its last sentence says `b.start`, `b.stop`, `b.pause`,
  `b.resume`, `b.panic`, `b.bpm`, `b.rampBpm` and `b.swing` are all uncalled
  too, and that is why `rewind` had none. `scheduler.test.ts` goes 7 tests to
  11 and a new `test/integration/transport-surface.test.ts` carries 8. The
  facade was testable the whole time: `fake-context.ts` already existed,
  `b.transport` is public, and Bellows drives its scheduler from a 25 ms
  `setInterval` reading `ctx.currentTime`, so a test that owns vitest's fake
  timers and `FakeAudioContext.currentTime` together drives the real path.
  No source file changed. The code was right, only unwitnessed.

Then the first of item 2's `[changes audio]` findings, which was the one the
docs had the largest stake in:

- **`b.render()` is reproducible now for the form every doc page teaches.**
  `b.rng(label)` returned the STREAM, so capturing it once outside the tick
  callback (`const melody = b.rng('melody')`, which is what README.md:68, both
  package READMEs, `generative-music.ts` and every workbench example do) bound
  the callback to the LIVE stream. A render installs a fresh `rngCache` that a
  captured stream never consults, so the render consumed and advanced live
  state: two renders of one seed produced different music, and an export
  mid-session differed from a reload. Reproduced before touching anything, with
  a test that renders twice at one seed and got [255, 168, 484, 395, ...] then
  [492, 319, 387, 640, ...]. `b.rng` now returns one stable HANDLE per label
  whose every draw resolves the current stream at the moment it is drawn.
  `fork` is delegated rather than re-implemented, because a fork depends only
  on its parent's label and never on its position, so the concatenation rule
  the C++ port relies on is untouched. Six tests, mutation tested per method:
  binding `int`, `pick`, `gauss` or `shuffle` to the capture-time stream each
  fails, and binding `fork` survives as a true equivalent mutant, which the
  register says rather than leaving as an apparent hole. The two doc claims the
  finding calls out turned out to need no correction: both were describing the
  behaviour this fix delivers, so they became true rather than being rewritten.

And one gate that was missing, found by running the CI-versus-block check this
file recommends rather than by trusting it:

- **`gen:llm-embedded` was in the verification block and not in CI.** Its three
  siblings all were: `gen:worklet`, `gen:sim` and `gen:llm` each regenerate and
  then `git diff --exit-code` inside the workflow. The embedded LLM reference
  had only the local run, and a local run is exactly the thing that gets
  skipped, which is how a stale generated file reached a published release
  commit once already. It is in `.github/workflows/ci.yml` now, next to the
  `gen:llm` step, and the gate was watched to fail: mutating the summary line of
  `engines/modal.h` and regenerating makes the diff non-empty, and reverting
  makes it clean again.

  Worth repeating for whoever runs that check next, because it nearly produced a
  false report here. `grep -E "run: npm run |run: node tools" ci.yml` is an
  INCOMPLETE probe: most of the workflow's interesting steps are multi-line
  `run: |` blocks, and all four regenerate-and-diff gates live inside one, so the
  single-line grep makes CI look far emptier than it is. Read the blocks before
  concluding a gate is missing. The one real gap survived that reading.
  `grep -cE "run: \|$" .github/workflows/ci.yml` counts the blocks rather than
  quoting a number here, because the first draft of this sentence quoted one and
  the same commit that wrote it added a block and made it wrong.

- **A non-finite audio SAMPLE no longer latches a recursive unit, in five of
  them.** The parameter half of this finding was fixed on an earlier pass; the
  input half was missed in a way worth recognising, because the guard went on
  `EnvelopeFollower`'s CONSTRUCTOR, which the finding never mentioned, while the
  finding's own list named its INPUT. `next()` holds the last good envelope now.
  Then the cause turned out wider than the unit named: `Svf`, `LadderFilter`,
  `OnePole` and `DcBlocker` latch identically on a bad sample, measured by
  feeding each good audio, one NaN, then 4000 more good samples. All four are
  guarded, treating a bad sample as silence so the recursion keeps evolving,
  which is right for a filter where holding is right for an envelope. Fixing
  only the unit the finding named would have been the third repetition of the
  symptom-versus-cause pattern in one session. 32 tests to 48, watched to fail
  per unit. No correct audio moved, and that evidence is per unit rather than
  one blanket claim: a first draft rested it all on the golden renders, and the
  goldens reach three of the five. `va` holds a `LadderFilter` and an `Svf` and
  the `saturator` holds two `OnePole`s, so those three are covered and the
  renders are byte-identical. `EnvelopeFollower` is not in the golden piece at
  all, because the piece's `compressor` keeps its own `env` field rather than
  using the class; it is covered by the parity harness instead, whose `gate` and
  `gate_sweep` rows drive `Gate` and still read 1.25e-6 and 1.70e-6 against an
  untouched C++ side. `DcBlocker` has no caller in `src`, so nothing of its
  behaviour can move.

  The cost claim had to be measured because the test file's own header said this
  policy costs "nothing per sample" and these guards do not. `Svf.next` over
  2.9M samples, alternating on a quiet machine: 22.9 and 23.0 ms unguarded
  against 22.7 and 22.8 ms guarded. Free at the resolution available. An earlier
  run of the same measurement, taken while background jobs were loading the
  machine, reported a 75 percent penalty and then a 2.4x speedup from the same
  one-line change, which is why it was taken again rather than reported. A
  microbenchmark on a busy machine is not a measurement.

### One item 2 finding investigated rather than fixed, because the obvious fix is wrong

**The sustain 0 voice-lifetime finding.** Both halves re-measured and both stand:
a sustain-0 voice is still `active` after 10 s with `level` exactly 0, and the
release tail is `log100(level / IDLE_FLOOR)`, which is 2.000x from full level,
1.850x from sustain 0.5 and 1.699x from sustain 0.25. The finding's heading
quotes the sustain-0.5 number and its body quotes the full-level one; both are
right for their level and neither is a general figure.

The fix part 1 invites is to test `IDLE_FLOOR` in the `Stage.Sustain` branch the
way `Stage.Release` already does. It was tried and it breaks a documented
statement of fact: `Adsr.set` says "the Sustain branch below assigns it every
sample, so a voice that is already sustaining steps to the new value on the very
next sample", and under the candidate a voice sustaining at zero does not,
because it has left that branch. Measured: raising sustain from 0 to 0.5
mid-note gives 0.5 and active today, and 0 and inactive under the candidate.

State that at its real strength, because the first write-up of this overstated
it by paraphrase. The same docstring opens with "Safe to call while running
covers the three times and not the fourth argument", so sustain is explicitly
outside the safe-while-running guarantee, and it closes by steering a
player-moved control through `Smoother` or a note boundary rather than through
sustain directly. The candidate breaks something the file states, not something
the file recommends relying on. Somebody could reasonably decide a voice
sustaining at exactly zero is allowed to become unreachable.

**All 1401 tests passed with that regression applied.** The existing
sustain-change test moves between 0.8 and 0.2 and never reaches zero, so it saw
nothing. There is a test for the zero case now, watched to fail against the
candidate, so whoever picks this up gets told rather than discovering it later.

That relocates the work: slot pressure is `VoicePool`'s problem, not `Adsr`'s.
`voicepool.ts:43` picks a free voice with `if (!s.voice.active)` and never looks
at `s.held`, so "a silent voice is stealable before an audible one" belongs
there, where it costs `active` none of its meaning. Stealing a held-but-silent
slot is already safe for note tracking: `noteOn` overwrites `pick.noteId` and
`noteOff` matches on `s.held && s.noteId`, so a stale note-off finds nothing.

It stays OPEN because both halves want a decision and they are not the same
size. Part 1 at the pool changes stealing only when polyphony is exhausted, and
in the direction of not cutting off an audible decaying note. Part 2 shortens
every release tail in the library by up to 2x, audible on every patch, against
the alternative of leaving it and stating the lifetime consequence next to
`IDLE_FLOOR`.

### What auditing the fix found, which is a new defect next to the old one

**A backgrounded tab plays different music from the same seed.** This was filed
once on 2026-08-23 as "a render can differ from live", and a second audit the
same day found that diagnosis pointing the wrong way. The replay is fine. LIVE
playback is the non-deterministic one, and it disagrees with itself.

`Scheduler.tick` walks `for (const s of this.subs)` and delivers every tick in
the wake's window for one subscription before starting the next, so callback
order inside a wake is grouped by subscription rather than sorted by time. How
many ticks a wake covers depends on wall-clock timing, not on the piece, so the
draw order from any stream two subscriptions share depends on how the timer
happened to fire. Measured with `'4n'` and `'4t'` sharing one `b.rng('shared')`:

    smooth, 25 ms wakes      A78, B69, B85, A83, B21, A29, B58
    one wake absorbing 1 s   A78, B69, A85, A83, A21, A29, B58, B85, B45, B42
    the offline render       A78, B69, B85, A83, B21, A29, B58, B85

The render is identical to smooth playback over every event compared. It is the
throttled run that is the odd one out, and a backgrounded tab is a normal
browser condition, not an exotic one.

The mechanism is the anti-throttling defence turning on itself. `scheduler.ts`
promises that "the lookahead stretches to cover the observed wakeup gap, so
under background-tab throttling the schedule keeps running ahead of the clamp
and nothing is missed". That stretch is what makes a wake wide enough to hold
several ticks of one subscription, which is precisely when grouping by
subscription stops matching time order. Nothing is missed, exactly as promised.
The order is what moves. The first wake of every piece gets a milder version for
free, because `scheduledTo` starts at `-Infinity` so the opening window is the
whole horizon.

Scope it honestly, and this part was measured too: nothing this repository ships
hits it. Of the 60 `clock.at` subscriptions across the examples and doc pages,
exactly two files open two at once, and neither draws anything random. The
composer behind bellows.live uses one subscription. So it is a real defect a
user can reach by writing ordinary code, and not an active problem in the
product. Event placement is never wrong either way, because events carry
explicit times; what moves is which callback draws which number.

The second audit also narrowed the fix. The first filing offered three options
and treated live and replay as equally plausible sources of truth; they are not.
The replay's order is correct, smooth playback already agrees with it, and the
live grouping is an artifact of iterating a Set inside a loop. So there is one
option: make `Scheduler.tick` emit a wake's ticks in time order across
subscriptions, with a preallocated scratch array because it runs every 25 ms on
the main thread. It is still an audio change and still wants a decision, but it
is one option rather than three. And documenting it is NOT sufficient, which
corrects the first filing: no wording on a docs page makes live playback
reproducible against itself.

### What auditing this session's own work found

### What auditing this session's own work found

Eight defects, in the session's own output, all written the same day. The fifth
was found in the sentence that recorded the first, the sixth by auditing a
second time after the first audit declared itself done, the seventh by auditing
the commit that fixed the sixth, and the eighth by auditing the commit that
recorded the seventh. No pass has yet come back empty. This is
the fifth session running to find that its work does not survive its own audit,
the rate is not improving, and the second pass was as productive as the first,
so budget for both.

1. **The `voiceLead` fix corrected one of four false claims, and it was the
   least visible one.** The code does not penalise crossings. Four pieces of
   prose said it does: `motionCost`'s private docstring, the exported
   `voiceLead` docstring, the `crossPenalty` option's own doc comment (which is
   what a user reads in an editor and what flows into the generated `llm.txt`),
   and the site's Theory page, which told visitors that `voiceLead` returns a
   voicing "penalizing crossings and doublings". The first pass fixed the
   private one. This is the register's own recurring pattern reproducing inside
   a fix for a finding about that pattern, which is now twice in one session:
   the first version of that finding's tests also passed against a mutant. All
   four are corrected.
2. **A sentence about a count was made wrong by the commit that wrote it.** The
   note warning that grepping CI for single-line `run:` steps is an incomplete
   probe said there were eight multi-line blocks. Adding the
   `gen:llm-embedded` gate in the same commit made it nine. It now gives the
   command that counts them instead of a number, and says why.
3. **Live figures were quoted where the file's own rule is to paraphrase.** The
   note about the `check-docs` race quoted the `s9h_saturator` flash and RAM
   values straight out of `docs/HARDWARE.md`. Those are gated figures with a
   source of truth, and this file already learned at the `--allow-host-drift`
   entry that a copy of a number rots and that a gate cannot tell a quotation
   from a claim. They are described rather than quoted now.
4. **A vacuous assertion shipped in a new test.**
   `expect(steps).not.toContain(0 - 1)` in `transport-surface.test.ts` can never
   fail: a step index is never -1. It was noise sitting next to the assertion
   that does the work, and it is gone. Removing it does not weaken the test,
   which still dies under both the `rewind` and `resyncTo` mutations.

5. **An unverified claim inside the entry recording defect 1.** Writing up the
   `crossPenalty` miss, this session asserted that the option's doc comment
   "flows into the generated `llm.txt`". It does not. The comment ships in
   `packages/bellows/dist/theory/voicelead.d.ts`, which is an editor tooltip and
   part of the npm package, but `llm.txt` carries only a one-line summary of
   `voiceLead` that never made the crossing claim at all. Checked after the
   fact, which is the wrong order. The register says so where it happened.

6. **The new finding was filed with its diagnosis pointing the wrong way.** The
   first audit found the draw-order defect and wrote it up as "a render can
   differ from live", offering three fixes and treating the live path and the
   replay as equally plausible sources of truth. A second audit measured what
   the first had only reasoned about, and the replay turned out to be correct:
   it matches smooth live playback event for event, and it is THROTTLED live
   playback that disagrees with both. The defect is that a backgrounded tab
   plays different music from the same seed, which is worse than what was
   filed and has one fix rather than three. The lesson is narrow and repeats
   the one above: the first filing reasoned from reading two code paths, and
   the correction came from running them.

7. **A blanket evidence claim that covered three of five cases.** The NaN
   commit said "the golden renders are unchanged, which is the proof that no
   correct audio moved" for five guarded units. The golden piece reaches three
   of them. `EnvelopeFollower` is not in it, because the piece's `compressor`
   keeps its own `env` field rather than using the class, and `DcBlocker` has no
   caller anywhere. The claim was true where it applied and vacuous where it did
   not, which is the worst kind: it reads as complete. The evidence is now per
   unit, and the two the goldens miss are covered by the parity harness and by
   having no callers respectively.

8. **A docstring paraphrased into meaning close to its opposite.** Writing up
   the sustain investigation, this session said `Adsr`'s docstring "calls
   sustain a control a player can move during a held note". It says the
   reverse: such a control should go through `Smoother` or land at a note
   boundary, and sustain is named as the one argument NOT covered by "safe to
   call while running". The measured result was unaffected and the case against
   the candidate survives, but weaker than it was made to sound, which changes
   the decision being handed over. Quote a docstring or do not lean on it.

Two of these eight (1 and 3) are the same failure at different scales: fixing
where the finger points instead of where the problem is. Numbers 5, 7 and 8 are
one failure too: asserting from a plausible reading of a file rather than
opening it. Number 5 is the
sharpest reminder available that this file's rule applies to the file itself:
the sentence was about being careful and was written carelessly. Number 2 is the one to
generalise from, because nothing catches it. `check-docs.mjs` gates figures with
a harness behind them; a count of something in a file this repository edits by
hand has no harness, so a sentence about the shape of `ci.yml` is only as true
as the last person to read it. Prefer the command over the number.

A second hazard, from the same family:

- **A rejected candidate can reach a generated file.** Trying the wrong fix for
  the sustain finding meant running `npm test`, whose pretest build regenerates
  `worklet-code.gen.ts` from whatever is in `src` at that moment. Restoring the
  source afterwards does not restore the generated file, so the working tree
  held a worklet built from a candidate that had just been rejected on purpose.
  Committing without looking would have shipped it. `npm run gen:worklet` then
  `git diff --exit-code` is the check, and it is already in the verification
  block; the point is to run it after experimenting, not only after editing.

One operational hazard, learned by tripping it:

- **Do not run anything that touches the embedded headers while
  `check-docs.mjs` is running.** It shells out to `size-report.sh`, which
  compiles sketches into a shared build directory, so a concurrent build
  corrupts the measurement it is comparing against. Mutation-testing the new
  `gen:llm-embedded` gate at the same time as a background `check-docs` made it
  report the `s9h_saturator` row with a flash figure about half the documented
  one and a RAM figure a dozen bytes under, which reads exactly like a real
  drift and is not one. Run alone immediately afterwards, with the tree in the
  same state, it returned ok on every figure. The two numbers are described
  rather than quoted on purpose: they are live figures in `docs/HARDWARE.md`,
  and this file already learned once that a gate cannot tell a quotation from a
  claim. Suspect the probe: the run was the thing that was broken.

Two things worth carrying, both from attacking a proposal rather than from
writing it:

1. **The first version of the `voiceLead` branch tests passed against a
   mutant.** They asserted length, pitch classes, ordering and range, and
   zeroing the branch's motion term (`c += bestD` to `c += 0`) left every
   candidate tied at cost 0 so the first one won, with the shape still legal.
   That is this repository's own symptom-versus-cause pattern reproducing
   itself INSIDE the fix for a finding about that pattern. The tests now assert
   the cost the branch computes and four separate mutations kill them.
2. **Three of `rewind`'s four effects were gated by the obvious tests and one
   was not.** Dropping `s.scheduledTo = -Infinity` failed nothing until a test
   was written for the case that needs it: a 5 second stall stretches the
   window out to about t = 12.5, and a restart behind that makes `to <= from`,
   so nothing is delivered at all. The same line inside `resyncTo` is still
   ungated and the register says so rather than implying full coverage.

### Closed on 2026-08-21, and what each one turned up

- **`bellowsjs@0.1.9` and `Bellows@0.1.2` are out.** Three behaviour fixes in
  the npm package, all of them a silent failure becoming a loud one, and the
  embedded library on both registries. Publishing needs a token that bypasses
  2FA or an `--otp`, which is now in the release ritual rather than in somebody's
  memory. bellows.live was six days behind when that was checked and is deployed.
- **The embedded documentation was restructured around what a musician needs
  first**, from nine pages to sixteen, planned in `docs/DOCS-PLAN.md` and
  evidenced in `docs/DOCS-RESEARCH.md`. Diataxis, PRIMM, semantic waves, the
  expertise reversal effect, Adafruit's guide standards and the field studies of
  how developers actually use documentation. The diagnosis was sharper than
  "too technical": there was not one tutorial and one half of a how-to, so two
  of the four documentation modes had simply never been written.
- **A docs page can make a sound now.** `ListenBlock.vue` plus a `listen` fence,
  splitting the body into parts because `v-html` cannot mount a component. The
  four tutorial pages open with a prediction, play a real firmware through the
  simulator's own `buildVoice`, show the C++ that did it, and end by naming what
  the reader just did. Measured in a browser rather than assumed: peak 0.45 on
  page one, and dragging decay from 0.55 to 2.0 moves the fraction of loud
  samples from 0.456 to 0.971.
- **The tutorial quotes no figures at all.** Nothing in those four pages for
  `check-docs` to gate and nothing that can go stale. That is the content rule
  paying for itself.
- **Two bugs found by looking rather than by building.** The player first
  rendered dark on a light page, because it used CSS variables that do not
  exist and every fallback fired. And segments keyed by index meant navigating
  between two pages that both hold a player patched the component in place
  instead of remounting it: the kick went on sounding under the next page at
  peak 0.47, with a stop button the reader had never started.
- **Read as four readers.** The musician found five slider hints written by an
  engineer, including a tempo hint about a potentiometer that is not on the
  page. The engineer evaluating the library found no signposted way out of the
  tutorial. The screen reader user found the slider's accessible name was
  `decay0.55sHow long the body rings.`, with a live value baked into a name, and
  a play button defaulting to `type=submit`. The phone reader is the one that
  went unverified: the window resize did not take, so only the worst case was
  measured, an article squeezed to 390px with the media query not fired.
- **Three overclaims of mine, caught by auditing my own pages.** "Every ported
  engine uses the same fixed-point phase accumulator" is false: the LFO and the
  four most recent ports do, the rest still accumulate in float. "Every example
  calls `AudioMemory()` last" is false: three do one harmless thing afterwards,
  and the true rule is that nothing bellows owns may come after it. And the plan
  itself claimed the reference never says what an engine is FOR, which it does.

### Closed on 2026-08-20, and what each one turned up

- **The parity row that could not see morph.** `additive_morph` renders at
  morph = 0.5, which is the FIXED POINT of the likeliest way to transcribe a
  lerp wrong: `a + (b - a) * (1 - morph)` at 0.5 is `a + (b - a) * 0.5`, the
  same note. Measured, by making that exact mutation in `additive.h:197`: the
  row reads 1.12e-4 and passes, unchanged. `additive_morph_hi` renders the same
  params at 13/16 and reads 5.50e-1, about 5100 times its own baseline. The
  `additive` row does fail on that mutation, and that is luck rather than cover:
  its morph is the default 0, so the inversion sends it to 1. Parity is 41 rows
  now. The old entry asked for a row that would catch a 0.1 percent `morph`
  error, and nothing in the amplitude domain can do that: a 0.1 percent error in
  a lerp weight moves the levels by 0.1 percent. Direction and endpoints are
  what a second row can pin, and now does.
- **The seed nobody could read.** `17_WorkstationI2S` waits up to two seconds
  for `Serial` before its banner, after `AudioMemory()` so the piece is already
  playing while it waits, and the seed now rides the two-second report as well,
  so a console attached in the middle of a piece still shows it. That second
  half is the part the old entry did not ask for and is what makes the feature
  actually usable, because the bounded wait only helps someone who was already
  attached at boot. 16 is unchanged: it draws no seed.
- **`vite-node` is declared.** One devDependency at the root, `^6.0.0`, and the
  lockfile pins 6.0.0 with its integrity hash. The five scripts still call it
  through `npx`, which prefers the local install and no longer reaches the
  registry.
- **The hardware CPU figure is gated, and so is a good deal more.** This was
  entry 7: "Nothing to do today beyond knowing it, and changing
  `docs/HARDWARE.md` first." The second half was right and the first was not.
  `docs/HARDWARE.md` owns the run table and `check-docs.mjs` now parses it and
  compares every other copy against it, which needed five documents added to the
  checker that had never been in it: both top-level `README.md` files and three
  of the site's TypeScript pages. The same pass gated the parity row count in nine
  more places and the board support summary in three, deriving the latter by
  counting the build matrix in `examples/README.md` rather than trusting the
  summaries. 388 figures across 7 documents became 542 across 13, after an audit of that work the next day widened it again.

  Two things fell out of building it, and both are worth more than the gate:

  1. **The first version of the gate was fake and looked green.** Mutating the
     source table from 47.3 to 47.9 changed nothing, because
     `--allow-host-drift`, which is what CI runs, grants a 25 percent RELATIVE
     allowance to every prose figure. It exists for numbers this machine
     measured and another machine would measure differently, a flash byte count
     or a parity residual. A number read off a serial console is not that.
     There is an `exact` flag now and every CPU claim carries it.
  2. **The integer allowance was swallowing counts.** It is plus or minus 16,
     for byte figures. Adding the 41st parity row left ten documents saying 40
     across seventeen lines, and six checked rows in four of those documents
     passed it, reported as a note rather than a mismatch. Every count claim is `exact` now, and the first run after that found
     this file's own WASM argument still quoting the parity and value row
     counts from two revisions back, in a sentence nothing had ever looked at.
     Both figures are corrected and both are gated. That sentence is
     paraphrased here rather than quoted, because the gate cannot tell a
     quotation from a claim and would read the old numbers as a live one.
- **Two READMEs, and what actually needed syncing.** Entry 5 asked for a checker
  that diffs the shared sections of the root `README.md` and
  `packages/bellows/README.md`. A textual differ is the wrong instrument: the
  npm copy deliberately uses absolute GitHub links, drops the repository layout
  and compresses several paragraphs, so it would report those forever. What can
  drift silently is the numbers, and every number they share is now checked
  against its source: the CPU figures, the parity and value row counts, and all
  seven board rows against the build matrix. Checked today, the two board tables
  agree cell for cell and differ only in bold markup and one word on the Daisy
  row. The remaining prose is still hand-maintained and still worth a glance
  when either is touched.
- **The Arduino Library Manager listing, and the artifact it serves.** See the
  state section. Indexed on 2026-08-20; the published zip was downloaded,
  unpacked, diffed against the tree that was compiled by hand, installed from
  the registry into a throwaway sketchbook and compiled example by example.

### Closed on 2026-08-15 to 17, and what each one turned up

Kept short. The full record is in the commits.

- **The three unmeasured examples.** `16_WorkstationPiezo`, `17_WorkstationI2S`
  and `21_Presets` had no size sketch, no README rows and no entry in the `ALL`
  list. All three now have all of it and `check-docs` covered 388 figures at the
  time, 545 now. Two
  things fell out: 16 and 17 have no logic header at all, so `p14_` and `p15_`
  reconstruct the composition rather than sharing the example's source, the only
  rows in the size table where the number and the code are not the same text;
  and 17 costs 480 B of flash for `Piece::Compose()`, priced by building twice
  rather than by subtracting, with everything else about it coming to minus 32 B.
- **The firmware manifest.** Rebuilt from a clean tree, 68 of 68 cells. The
  Teensy 3.x images are not reproducible: each carries a compile-time `TIME_T`
  the core writes into `RTC_TSR`, so a 3.x `.hex` differs by exactly three bytes
  on every sweep and only a larger diff is news. Every 4.x image was byte
  identical.
- **The board.** Reflashed with the post-AudioMemory-fix build and measured
  twice. `AudioProcessorUsageMax` is a running maximum since boot that nothing
  resets, so a "peak" is the highest value seen so far and not a bound.
  `teensy_loader_cli -b -s` hangs with no timeout if something else holds the
  serial port. In bootloader mode the board is a HID device at `16c0:0478` and
  does not appear in `pio device list`, which is why an earlier check that day
  concluded "no board connected" and was wrong.
- **The playground.** 25 entries, with the 50 presets as a labelled picker.
  `npm run check:catalogue` and `npm run check:presets` are new and both are in
  CI; the second renders all 50 presets offline and gates them on being audible,
  finite, at the requested pitch and naming only parameters the registry knows.
  Browser testing found three defects that typechecking could not: `select()`
  did not reset the step counter, `availableOutputs` made "first is the default"
  false, and the output survived a firmware change.
- **The audit count.** 51 open, not 73, with a status and evidence under every
  finding. 13 of 51 claimed closures fell over to skeptics. Now 35, after the
  2026-08-20 pass over the `[under ten minutes]` tag.
- **Two claims that had outlived their truth.** CI has run, and a board has
  been flashed and heard. Both were stated as hard facts in `docs/KICKOFF.md`
  for weeks after they stopped being true. The correction then went stale in
  its turn: it said 26 runs with every main run green, and by 2026-08-20 it was
  more runs, and a failure on main, `863cd43`. A tally is a dated reading, which is why the
  copies of it now give the durable half, the failures, and not the total.
- **`bellowsjs@0.1.8`**, a documentation release, and the release ritual
  reordered so the version bump precedes the regenerate step rather than
  following it, which is what made 0.1.5 and 0.1.8 both go stale.
- **The verify block now names the regenerate-and-diff gates.** `gen:sim`,
  `gen:llm`, `gen:llm-embedded` and `gen:worklet` were in `ci.yml` and not in
  the block `docs/KICKOFF.md` hands a new session, so a full local pass could go
  green with a stale generated file, and on 2026-08-15 one did, on a commit that
  had already been published to npm. Both the block and the harness table below
  now list them.
- **Milestone 6, both registries, at 0.1.1, and both live.** PlatformIO as
  `virgilvox/Bellows`, Arduino Library Manager as `Bellows`, indexed on
  2026-08-20 with both tags. The state section has what was checked, including
  an install straight from Library Manager into a clean sketchbook and a
  compile sweep over the published examples.
  Publishing found the library was BROKEN when installed: every example failed
  to compile, for the port's whole life, because Arduino cannot attribute a
  nested include path to a library and no example used the `<Bellows.h>` that
  `includes=` names. The cross-folder includes that this file called something
  the IDE "may not" resolve turned out not to resolve, measured. Both fixed,
  and `npm run check:package` now gates what each channel ships, mutation
  tested against all four packaging faults this session found by hand.
- **The embedded LLM reference** gained Installing, Build flags and a Targets
  section derived from the board matrix, and the LLM REF page gained the
  BROWSER and EMBEDDED switch it was missing. Its Minimal program had been
  calling `AudioMemory()` before `Init()`, which is the ordering that produced a
  null render window on a board: the one document written to teach a machine to
  write this code was teaching the bug.

## Where things stand

**Re-checked on 2026-08-23 and nothing had moved**, which is worth recording in a
file with this one's history. `main` is `e780f39` with a clean tree, nothing
unpushed and nothing behind. npm serves 0.1.9, PlatformIO and the Arduino
Library Manager both serve 0.1.2, bellows.live serves LLM references
byte-identical to the tree, and CI is green on the last three pushes. Every one
of those is one command, and the commands are in the bullets below. Two days is
long enough for any of them to have changed; this time none had.

- **Nothing is unpushed.** `origin/main` is current as of 2026-08-15, and CI is green on it:
  all six jobs, run `31873741708`. This bullet used to name two unpushed commits and a
  missing SIMULATOR button; both are shipped. Check with `git rev-list --count origin/main..HEAD`
  rather than trusting this line, which is the sort that goes stale the moment someone
  commits.
- **`bellowsjs@0.1.9` is on npm and tagged `v0.1.9`**, published 2026-08-21 and checked rather
  than assumed: `npm view bellowsjs version` says 0.1.9, a fresh `npm install bellowsjs@latest`
  into an empty directory resolves 0.1.9, and importing the bare specifier from that install
  gives 219 exports with `TempoPoint` gone. All three fixes are in the shipped bundle. Note how
  to check that, because the obvious way is wrong: `grep isSafeInteger(endFrame)` finds nothing,
  since vite renames locals, and the guard is there as
  `if (!Number.isSafeInteger(o)) return !1;`. Grep the function name, not the argument name.
  The tag is on `a0543e5`, the commit the tarball was built from, rather than on the commit that
  records the publish.

  **Publishing needs a token that bypasses 2FA, and this is a standing property of the account
  rather than a one-off.** A plain `npm publish` passes the login check, packs the tarball, and
  only then returns `E403 ... Two-factor authentication or granular access token with bypass
  2fa enabled is required`, which reads like a permissions problem rather than a missing code.
  Either `npm publish --otp=<code>` typed by whoever holds the authenticator, or a granular
  token in `~/.npmrc`, which is what 0.1.9 went out with. Nothing in `.github/workflows`
  publishes to npm and this is one of the reasons.

  It carries three behaviour fixes, all of them a silent failure becoming a loud one: two window
  and hop pairs that could not reconstruct and were degrading instead of reporting, and a ramp
  duration that wedged a slot. `CHANGELOG.md` has the detail.
  0.1.8 before it was a documentation release whose code was byte-identical to 0.1.7: `git diff v0.1.7..v0.1.8 --
  packages/bellows/src` is empty. It exists because the README is one of the three things the
  tarball ships, alongside `dist` and `LICENSE`, and it did not mention the microcontroller port
  at all. That gap survived a session that had just been asked to fix exactly it, because there
  are TWO near-identical READMEs maintained by hand, the repository root and
  `packages/bellows/README.md`, nothing syncs them, and only the root one got the fix. Worth a
  gate the next time either is touched.
  0.1.7 before it was the audit-3 release: almost all gates rather than behaviour, and
  `CHANGELOG.md` lists the four things a user would notice (a new `rotatePattern` export, input
  ceilings on the WAV and MIDI parsers, and three fixes). 0.1.6 was a safety release: the SFZ
  hardening in it fixes a real denial of service on untrusted input in a browser.
- **bellows.live does not catch up on its own, and that has not changed.** The app pulls the
  public repo with a plain `git.repo_clone_url`, so there is no deploy-on-push. Shipping site
  changes takes `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d` after the
  push, every time. **Deployed on 2026-08-21 and current**, checked by fetching rather than by
  reading the deployment phase: `llm.txt` and `llm-embedded.txt` are byte-identical to the tree
  copies, and the simulator chunk carries the twelve `#include <Bellows.h>` lines and the
  seed-wait marker that a stale build does not have.

  It had been **six days and three commits behind** before that, and the way that was found is
  the useful part: `curl -s https://bellows.live/llm-embedded.txt | head -1` returned 0.1.0
  against a tree saying 0.1.1. It was last deployed on 2026-08-15 at `9a8e272` and stopped being
  current the next day at `4ecd02a`, which put `#include <Bellows.h>` into the simulator's source
  strings. Nobody noticed for six days, in a repository whose documents said the site was
  current. Run the curl. See
  "Deployment (bellows.live)" below, which has said this all along; an earlier draft of this
  line said the opposite and was wrong.
- **The browser library has drifted from the published `bellowsjs@0.1.9`, with one
  behaviour change in it.** `git diff v0.1.9..HEAD -- packages/bellows/src` is the check.
  `b.rng(label)` returns a stable handle instead of the raw stream, which makes
  `b.render()` reproducible for the capture-outside-the-callback form that the README and
  every doc page teach. That is a real fix and not a paragraph, so unlike the two embedded
  files below it is worth a release on its own when someone is next at a keyboard: until then
  npm and bellows.live both still ship the version where two renders of one seed can differ.
  The other two files that moved, `engines/modal.ts` and `theory/voicelead.ts`, are
  comment-only and change nothing a user hears. See "Closed on 2026-08-23" for the
  measurement.

  bellows.live was in sync with `HEAD` when this was written, checked rather than assumed,
  and this commit makes it stale: `apps/workbench/public/llm.txt` and the
  rendering-and-export doc page both moved. Note that the usual first-line check does NOT
  reveal it, because the version line still reads `# bellowsjs 0.1.9 LLM reference` on both
  sides. Use a content probe instead:
  `curl -s https://bellows.live/llm.txt | grep -c "stable HANDLE"` returns 0 until someone
  runs the deploy. That is the same lesson as everywhere else in this file: pick a probe that
  can see the change you actually made.
- **Two shipped files have drifted from the published 0.1.2, both deliberately, neither
  released.** `git diff c0a1280..HEAD -- packages/bellows-embedded` is the check.
  `README.md` had its install-test sentence rewritten so it survives a version bump instead of
  going stale the moment one ships, and `11_I2SAmp.ino`'s wiring list said 3.3V and then said
  not to use it, so it says 5V once. Both are improvements to text a user reads on the registry
  pages, both ride the next release, and neither is worth a version on its own. `tools/` is not
  shipped, so the third changed file does not count. Say no to a 0.1.3 for a paragraph, and
  remember these two exist when something real needs releasing.
- **`packages/bellows-embedded` is published, and the two channels are not live at the same
  moment.** It stays `private: true` and off npm, which is correct: the npm package is the
  browser library.
  - **PlatformIO: live at 0.1.2.** `virgilvox/Bellows`, and an UNPINNED
    `lib_deps = virgilvox/Bellows` resolves to `0.1.2`, checked on 2026-08-20 by installing it
    into a throwaway storage directory and reading the version back out of the unpacked
    `library.json`. `examples/daisy_onekick` is in it, which is the thing 0.1.0 got wrong by
    going out from the mirror. Publishing is not instant: `pio pkg publish` answers "the package
    has been accepted" and the registry served 0.1.1 as latest for a few minutes after that, so
    check rather than assume.
  - **Arduino Library Manager: live at 0.1.2.** All three tags are indexed:
    `library_index.json.gz` carries 0.1.0, 0.1.1 and 0.1.2, and `arduino-cli lib search Bellows`
    resolves against the real index and reports `Provides includes: Bellows.h`. The indexer log
    says `Release Bellows:0.1.2 already loaded, skipping`.

    **The lag is not predictable and this bullet has now been wrong about it in both
    directions.** It said "merged, NOT yet indexed" for three days after that stopped being
    true. Then, on 2026-08-20, it said 0.1.2 was tagged and not indexed and told the reader to
    expect days, reasoning from 0.1.0 and 0.1.1 having taken three; 0.1.2 was indexed overnight,
    inside a day. Two samples, three days and one day, and the bot says "within a day". Do not
    reason from either. Run the commands.

    Recheck rather than trusting this line:
    ```
    curl -s https://downloads.arduino.cc/libraries/library_index.json.gz | gunzip \
      | python3 -c "import json,sys;print(sorted(l['version'] for l in json.load(sys.stdin)['libraries'] if l['name']=='Bellows') or 'not indexed yet')"
    curl -sL http://downloads.arduino.cc/libraries/logs/github.com/virgilvox/bellows-embedded/
    ```
    If a future tag does not appear, read the log: that is where a rejected tag explains itself.

    **What the registry actually serves is checked rather than assumed**, and this is the
    end-user path no session had walked before 2026-08-20. Done twice now, once per release.
    `Bellows-0.1.2.zip` is 422537 B and unpacks to 51 headers and 17 example folders, with
    `Bellows.h` present, no surviving `../` include, no `test/` or `tools/`, and no
    `daisy_onekick`, which is exactly what `npm run check:package` asserts. It carries the
    0.1.2 content rather than a stale build: `pluck.h` defaults its template rate to
    `BELLOWS_SAMPLE_RATE`, `17_WorkstationI2S` has the bounded wait for a serial listener, and
    the README no longer says the library is unlisted. Then
    `arduino-cli lib install Bellows@0.1.2` into a throwaway sketchbook, and every example
    compiled for a Teensy 4.1 straight from that install: 16 of 17, with `12_DacOut` declining
    by `#error` because a 4.x has no DAC, which is the documented number. Pass and fail read
    off exit codes, not off stdout, because an earlier sweep grepped for `Used platform`, which
    `arduino-cli` prints on failure too, and called two broken examples fine. The 0.1.1 run on
    2026-08-20 also diffed the zip against the mirror clone that had been compiled by hand,
    `diff -rq` reporting only `.git` and `.gitignore`.
- Library test suite: 93 files, 1402 tests, counted by `npx vitest list` and re-counted by `check-docs.mjs` so this line cannot drift the way it did twice, all passing in plain Node, including golden-render regression (`test/golden`, regenerate with `GOLDEN_UPDATE=1` only alongside an intentional DSP change).
- `tsc --noEmit` clean. Build: `npm run build -w packages/bellows` runs worklet generation, vite (ESM + standalone IIFE), declaration emit, and writes `dist/worklet.js`.
- The Vue workbench builds clean (`vite build`) and type-checks clean (`npm run typecheck -w apps/workbench`, which CI runs as its own step; deliberately not inside the build script, because `.do/app.yaml` deploys the site by running that script and the site's deploy should not hang on a type check). Verified live in Chrome: bench plays and evolves seeded pieces, engine hot-swap works mid-phrase, 8-bar WAV export rendered in about 1.4 s while playing, code mode runs its examples. Its 49 examples are checked against the built library by `npm run check:examples -w apps/workbench`, in CI.
- Embedded: 51 headers, every one compiling standalone and all of them together in one translation unit, for Cortex-M7 and Cortex-M4. The whole ported engine set is about 34 KB of flash. All seventeen examples build and link as real Teensy 4.1 firmware against the actual Arduino core and Audio Library, except `12_DacOut`, which declines with an `#error` because a 4.x has no DAC. This line said 43 and five until 2026-08-20, while the state section fourteen lines up said 51 and 17.
- Parity against the TypeScript passes on 41 rows with the PRNG bit exact and the effect input bit exact, plus 428 exactly-compared value rows for the parts that make no sound.
- The embedded package went through a size pass whose findings are in `docs/HARDWARE.md` under "Making it smaller". Delay buffers are sized exactly rather than rounded to a power of two, which took 25 percent off RAM library-wide with bit-identical output; the oscillator gained per-shape entry points so the linker can drop the residual table a program never reads; and every transcendental now routes through `fm::`, which is what the docs had claimed for months and was not true, so `BELLOWS_FAST_MATH` went from saving nothing on any sketch with an oscillator to saving 23 to 75 percent. Read that section before optimising anything: it also records what was measured and deliberately NOT taken, and why attributing firmware bytes to a header-only library by symbol name does not work.

**Two things that have not happened, and both are load bearing.**

1. **A board has now been flashed and heard, and this item used to say the opposite.**
   **A Teensy 4.0 has now run this, and the number is the one Milestone 1 existed to
   collect.** `07_Workstation`, the heaviest program in the set (five engines, a Markov
   melody, a tempo-synced delay send, an EQ and a limiter), at 44.1 kHz through a
   MAX98357A on I2S: **33.8 to 46.5 percent CPU, 47.3 percent peak**, with 2 of 24
   audio blocks used. It runs with about half the processor spare. Measured twice
   now, on two builds and two arrangements; `docs/HARDWARE.md` has both rows and
   the caveats.
   
   What that does NOT settle, and the distinction matters because one board is one data
   point: no other board has run anything (a 3.2 and an LC have no FPU and emulate every
   float operation, and a Daisy Seed has been linked to an image but never run), no other
   program has been measured, and neither implementation has been compared to the other
   by ear. The numerical comparison, 41 engine and effect rows plus 428 exactly-compared
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

The last four rows are regenerate-and-diff gates rather than tests, and they are
the ones a local run keeps missing, because they only fail if you regenerate and
then look. They are in `ci.yml` and, since 2026-08-15, in the verify block
`docs/KICKOFF.md` hands a new session as well.

**The same gap reopened and was closed again on 2026-08-21.** Six gates were in
`ci.yml` and not in that block: `params:check`, `ratecheck`, `fastmath`,
`memsafety`, `memsafety:fastmath` and the library's own `tsc --noEmit`, which is
the only thing that typechecks the TEST files, since the build's tsconfig
includes `src` alone. Three of those six were added by the sessions that also
wrote the block. The check is one command,
`grep -E "run: npm run |run: node tools" .github/workflows/ci.yml` against the
block, and it is worth running whenever either changes. Before that they were only in CI,
and that gap put a stale file on a published release commit. This paragraph
pointed at "item 4 of Still not done" until 2026-08-20, which was the wrong item
before the list was renumbered and a dangling one after.

| Command | What it proves | What it caught |
| --- | --- | --- |
| `npm test` (in `packages/bellows`) | the TypeScript, including the golden render and the oscillator band sweep | the regression fixture is the only whole-piece guard; `test/dsp-osc/blep-frequency.test.ts` is the only thing that can see alias rejection collapse above 2637 Hz |
| `npm run parity` | 41 rows match the TypeScript numerically, four of them exactly | the `eq.h` three-band-mislabelled-as-port, the `StereoDelay` clamp bug, and three rows of its own that measured nothing until their input was fixed |
| `npm run tables` | euclid, scales, chords, notes, CA, arp, tempo map, MIDI compared EXACTLY | nothing yet, but it is the only thing that can see a wrong scale table |
| `npm run fastmath` | every polynomial in `core/fastmath.h` against libm | `fm::Log2` wrong by 213 cents, inherited by every `Pow` |
| `npm run memsafety` (and `memsafety:fastmath`) | ASan and UBSan over the buffer-owning classes at 0.5x to 4x their template rate, and at NaN, zero and negative rates | the `Pluck::NoteOn` overflow, then four undefined float-to-int casts reached through a NaN. Nothing else could: parity compares numbers at one rate, and `check-header.sh` instantiates nothing. Build it for x86-64 as well as arm64: the NaN cast saturates harmlessly on arm64 and only faults on x86-64 |
| `npm run size` | flash and RAM per sketch, `cortex-m7` or `cortex-m4` | the whole no-registry design argument |
| `./tools/check-header.sh <h>` | one header compiles standalone, `-Wall -Wextra` | header hygiene; note it instantiates nothing |
| `node tools/gen-tables.mjs --check` | generated headers match the TypeScript ParamSpecs | new `Eq6` class the moment it appeared |
| `node tools/check-docs.mjs --check` | every figure the harnesses print, wherever a document quotes it: `docs/HARDWARE.md`, the embedded `README.md`, `examples/README.md`, this file, `docs/KICKOFF.md`, `docs/ENGINEERING.md`, `examples/OUTPUTS.md`, both near-identical top-level `README.md` files and four files under `apps/workbench`, against the size report, the sketch symbol tables, `parity`, `tables`, `fastmath`, `vitest list`, the board's CPU table and the board build matrix: 545 of them | six stale rows in HARDWARE on its first run; then 10 stale README rows and 3 stale prose figures when it was widened; then, when it grew past the size report, 4 of 5 example rows, both symbol-breakdown tables, three parity rows and the toolchain version; then, when prose started matching the paragraph rather than the line, five claims that a rewrap had silently switched off, and the fact that the two ARM toolchains installed here disagree on 45 of 46 rows. Still does NOT cover the whole-firmware Teensy table, the Daisy table, the ns tables, the board capacity table, the newlib-against-fastmath byte comparison or the bundle size in the release ritual |
| `npx vitest run test/integration/engine-tuning.test.ts` | every pitched engine plays the note it was given, to 2 cents | proves the fractional-delay tuning is real: an integer-rounded loop is 28 cents flat at E7 |
| `npm run check:catalogue` (workbench) | the four simulator lists agree: `FIRMWARES`, the `case` labels in `buildVoice`, `VOICE_CAVEATS`, `GROUP_ORDER` | nothing yet; built the day three entries were added, because both failures are silent |
| `npm run check:presets` (workbench) | all 50 presets render offline: audible, finite, at pitch, naming only registered parameters | nothing yet; the mutation that renames a preset parameter leaves it audible at the right pitch and nothing else catches it |
| `npm run gen:llm -w apps/workbench` then `git diff --exit-code -- apps/workbench/public/llm.txt` | the browser LLM reference matches the built library | a version bump that left it stale, on the 0.1.8 release commit, after the documented verify block had passed |
| `npm run gen:llm-embedded -w apps/workbench` then a diff | the embedded LLM reference matches the headers and the board matrix | refuses to write at all if it cannot parse the matrix out of `examples/README.md` |
| `npm run gen:sim -w apps/workbench` then a diff | the simulator shows the examples it claims to | |
| `npm run gen:worklet -w packages/bellows` then a diff | realtime runs the DSP the tests ran | the whole suite stays green when this is stale, because tests use `renderOffline` |
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
8. **A number in a document rots exactly like a stale generated file.** Four times in one session a change moved a sketch and the tables quoting it were left behind, each caught by hand afterwards. Finding 11 in `docs/AUDIT.md` already said a warning in a document is not a control; the same is true of a figure in one. `tools/check-docs.mjs` is the control, and `ci.yml` runs it on the day CI first runs. It does NOT cover the whole-firmware Teensy table, the Daisy table, the ns tables, the board capacity table, the newlib-against-fastmath byte comparison or the standalone bundle size in the release ritual, and those still rot by hand. When you add a figure to a document, add it there first: the second audit found sixteen document findings and every one of them was a number a command could have printed. Two of that pass's lessons are about the checker rather than the documents. A claim it cannot find is worse than no claim, so it reports a marker that matches nothing instead of passing quietly: a hard rewrap had switched off five prose claims, and a table header whose first cell matched a row marker had switched off a sixth. And the provenance line is load bearing, not decoration: the two `arm-none-eabi-g++` installs on this machine disagree on 45 of the 46 size rows, so the checker now pins the report to the compiler `docs/HARDWARE.md` names rather than to whatever `PATH` offers.
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
8. `defEngine`/`defEffect` serialize defs with `serializeDef` (functions via toString, rehydrated with `new Function` in the kernel). Defs must be self-contained. It is an eval sink, and not a worklet-sandboxed one: `render()` replays the setup log through `renderOffline` on the calling thread (`bellows.ts` filters `events` out of that log and nothing else), so an app that lets users author defs has given them code execution on the MAIN thread, next to DOM, fetch, cookies and localStorage, the first time that app exports audio. A host CSP that blocks eval therefore breaks tier 3 in both places, playback in the worklet and `render()`, and `render()` throws out of `KernelEngine.apply` rather than degrading. Rendering offline in Node has no CSP and is unaffected. `test/kernel/defop-realm.test.ts` pins which realm evaluates the string.
9. Voices ADD into `(outL, outR, from, to)`; effects process IN PLACE; nothing allocates on the audio path at steady state.
10. `Bellows.setup` is a `SetupLog` (`src/kernel/setuplog.ts`), not an array. Idempotent setters collapse last-write-wins by identity key, updated in place so non-idempotent ordering survives. Anything added to `KernelMessage` needs a decision in `collapseKey`: append or collapse. Getting it wrong silently changes what `render()` replays.
11. `Instrument.dispose()` is the only way `removeChannel` is ever posted, and it prunes the channel from the setup log. Without it every channel leaks its whole voice pool, which is what the workbench engine swap used to do at about 400 KB a time. `dispose({ releaseSeconds })` defers the removal so a ringing tail decays instead of being cut.
12. **The embedded library must never grow a global registry.** Playing one kick through a string-keyed registry of five engines costs 30488 bytes of flash and 30872 of RAM against 3760 and 1100 direct, because a registry names every engine so the linker must keep every engine. `bellows/bank.h` gives runtime index dispatch at byte-identical cost. This is the single load-bearing design rule of that package.
13. `BELLOWS_FAST_MATH=1` swaps libm for polynomials and takes the kick from 3760 to 936 bytes. It is also the most dangerous flag in the tree, for the reason in the harness table. Run `npm run fastmath` after touching any approximation.
14. On the PlatformIO teensy platform, `board_build.usb_type` is silently ignored: use `-D USB_MIDI_SERIAL` in `build_flags`. The platform also still defaults to `gnu++14` on some releases, so `build_unflags` has to remove it. `examples/platformio.ini` carries both and is verified.

## Recent history worth knowing

- **`docs/AUDIT-2.md` is the current one**: a whole-repository pass on 2026-08-05, forty agents across eight slices, 95 findings, each escalated finding then attacked by a skeptic whose default was to refute. Two slices came back sound (the architecture holds, the DSP core is correct); six came back needs-work. Five findings were refuted and are listed at the end so nobody rediscovers them: the ladder cutoff is deliberate, `romanToChord`'s accidentals are right, and `pattern.fast()`'s cycle length is the documented contract. Read the blocking and major sections before touching anything.
- The 2026-08-04 audit is in `docs/AUDIT.md`, findings 1 through 20, each with its evidence. Read it before touching the facade, the fx capacity options, the kernel ramp table, or anything in the embedded port. Findings 10 and 11 used to carry a correction saying CI had never run. **That correction is itself out of date and the claim in it is now false**: `gh run list --workflow=ci.yml --limit 200` on 2026-08-15 returns **26 runs, 19 success and 7 failure**, split 11 push, 11 pull_request and 4 workflow_dispatch. Every one of the 7 failures is a pull_request on the `milestone-2-and-bringup` branch; every run on `main` succeeded, most recently on `f48dbd3`. The failures are the interesting half, and a first pass at this correction lost them by reading a list truncated to its default limit and reporting "twelve runs, all green": **this gate has been watched to fail**, which by the repository's own rule is what makes it a control rather than a file. So findings 10 and 11 read correctly as written and the retraction attached to them should be read as history. The two AUDIT-2 findings about CI, at lines 25 and 31, are both closed: `ci.yml` is on the default branch, and the step that could not pass on a clean checkout gained the build it needed while `gen-tables.mjs --check` learned to refuse a stale `dist` rather than report ok against it.
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
   is a rewrite. The harnesses work: 41 parity rows, four of them exact, plus 428 value rows.
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

**The count lives in `docs/AUDIT-2.md` now, not here.** Every finding in it carries
a status blockquote under its own heading, so the question "is this still open"
is answered where the finding is rather than in a list somewhere else that has
to be kept in step. As of 2026-08-20: **30 open, 7 partial, 52 closed, 5
refuted, 1 not a defect.** Thirty-seven genuinely open, down from fifty-one.

That replaces the figure this section carried for ten days, which was 73, and
which nobody could reproduce. It came from a 2026-08-05 tally of 8 fixed, 8
partial, 77 open and 2 not a defect, minus the four refuted findings the
re-verification had wrongly re-raised. The 77 was never enumerated, the same
section then said nineteen of them were closed later that day without saying
which nineteen, `docs/AUDIT-3.md` closed several more without cross-referencing
them, and the enumerated lists below only ever named 27. Four documents, four
different answers, none checkable.

The new number was produced by re-reading all 95 against the tree at `6d23f58`,
with CLOSED requiring the fixed line quoted as it stands rather than a commit
named, and anything uncertain held OPEN. Then all 51 claimed closures were
handed to skeptics briefed to refute them and **13 did not survive**, a quarter
of them, almost all being a fix applied to the symptom a finding opened with
rather than to the cause it named further down. Without that second pass the
backlog would have lost thirteen real defects, which is the argument for doing
it that way rather than trusting the first read. The method's own weak points
are listed in `AUDIT-2.md`'s preamble rather than here, and one of them is that
`526516d` landed mid-run so `docs/HANDOFF.md` moved under the later readers.

Refuted, do not act on them, and they are annotated inline at their own
headings because the refuted list lives at the end of a 90 KB document and
nobody reading a finding ever gets there: the ladder cutoff (twice, lines 135
and 249), `romanToChord`'s accidentals, `pattern.fast()`'s cycle length, and
the plate's gate coverage.

The lists below are the older triage, grouped by whether they need a decision
from you. They are now a reading order rather than the register: several
entries in them were verified closed by the pass above and are marked where
that is known, but `AUDIT-2.md` is the file to trust.

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
- ~~`voiceLead`'s unequal-size branch, including the crossing penalty, is never executed (466).~~
  PARTIAL, 2026-08-23. The branch is covered by three tests. The crossing penalty is not, and cannot
  be: it is unreachable by construction, so `crossPenalty` is a published option that changes no
  output. Kept inert and pinned by a test.
- ~~`Scheduler.rewind()` has no test and it is on the `b.start()` path (472).~~ CLOSED, 2026-08-23,
  at the cause rather than the headline: the whole facade transport surface has tests now, 8 of them,
  and all eight methods die under mutation.
- The Web MIDI runtime path is uncovered; only parsing is tested (478).
- The gate's range floor and the delay's time smoother are both unreachable from the parity
  output. Recorded next to their rows with the arithmetic; both need an instrument the harness
  does not have, one reading gain directly and one changing a param mid-render.
- A 0.1 percent `Foldback` mutation moves `westcoast` to 1.04e-2 against a 2e-2 gate and fires
  nothing, and the same shape of `TanhShape` mutation moves `kick` to 3.47e-4 against 1e-3.
  Both rows are looser than they look. `saturator_fold` now covers Foldback itself.
- ~~`gen-tables --check` warns about a stale `dist` and then reads it anyway, so it passes on a
  stale checkout (31).~~ CLOSED. `--check` now exits 2 on a stale `dist` rather than comparing
  against the previous build and calling it ok, and `ci.yml` builds the bundle before running
  it. Both verified in the tree on 2026-08-15, and `ci.yml` has run many times since, which is
  what the sentence here used to deny. One push to `main` has failed, `863cd43`, on the gate
  this ritual was reordered to satisfy.
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
- ~~`b.render()` is not reproducible for the rng pattern the README and every doc page teach (55).~~
  CLOSED, 2026-08-23. `b.rng` returns a stable handle that resolves the current stream at draw time,
  so two renders of one seed now agree. It did change what render emits for pieces written the
  documented way, as this line predicted. Auditing it opened a NEW finding next door, still open: the
  live scheduler and the offline replay order callbacks differently, so a render can still differ
  from live when one stream is shared across two subscriptions.
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
   record 11.3.1, and 45 of 46 sketches move between toolchains. CI installs PlatformIO's Teensy
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
the linker, so flash and RAM say what FITS and mostly not what KEEPS UP. CPU has now been
measured on hardware exactly once, on one board and one program: a Teensy 4.0 at 600 MHz
running `17_WorkstationI2S` at 33.8 to 46.5 percent with a 47.3 percent running maximum. That
is one data point against seven parts and seventeen programs, and it says nothing about either
part without a floating point unit. The one durable CPU fact is arithmetic rather than measurement: the BLEP
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

**Bump the version before you regenerate, not after.** Two generated files carry
it, and one of them is gated in CI by regenerate-and-diff, so bumping last means
a red build on the commit you have already published to npm. That is not
hypothetical: it is what 0.1.8 did. The steps are in this order for that reason.

1. `npm test` and `npx tsc --noEmit` in `packages/bellows`.
2. **Bump the version now**, in `packages/bellows/package.json`.
3. Regenerate everything that carries a version or derives from what changed,
   and diff each one:
   - `npm run gen:llm -w apps/workbench`, which writes
     `apps/workbench/public/llm.txt` and stamps the package version into two
     lines of it. **CI gates this**, `gen:llm` then
     `git diff --exit-code -- apps/workbench/public/llm.txt`, and it is the step
     that went red on 0.1.8.
   - `npm run gen:llm-embedded -w apps/workbench`, which stamps the version from
     `packages/bellows-embedded/library.properties` instead, so it moves only
     when the embedded library moves. Regenerate it anyway after touching that
     file for any reason.
   - `npm run gen:worklet -w packages/bellows` if anything kernel-reachable
     changed.
   - `npm run gen:sim -w apps/workbench` if any embedded example changed.
4. `npm run build -w packages/bellows`; check `dist/worklet.js` exists and the standalone size is sane. Measure it rather than remembering it, and write the version beside the number, because this figure has twice been quoted from a release three behind: `gzip -9 -c dist/bellows.standalone.js | wc -c` prints **109260 bytes at 0.1.9**, against 108945 at 0.1.8, 108400 after the 2026-08-05 fixes, 106147 before them and about 97 KB at 0.1.0. The 0.1.8 rise was 0.50 percent for a release whose source is byte-identical to 0.1.7, so that one was toolchain drift rather than code, and 0.1.9 adds 0.29 percent for three lines of behaviour and a good deal of comment: worth knowing that this figure moves on its own, and worth not reading a sub-one-percent change as a regression. Compare against the previous release and ask about a jump over roughly ten percent; a fixed threshold from an old version is what turned 97 into a number three releases stale. Nothing checks this one: `check-docs.mjs` cannot, because it needs a built `dist`. Note also that `dist` goes stale against `src` silently (`gen-tables.mjs` warns and reads it anyway), so build before you measure, and before running any pure-library snippet against it.
5. Run the full verify block, including `npm run check:examples`, `check:embedded`,
   `check:catalogue` and `check:presets` in `apps/workbench`. `check:examples`
   reads the BUILT library, so it needs step 4 first.
6. `npm publish --otp=<code>` from `packages/bellows`, tag `vX.Y.Z`, push with the
   tag. The OTP is not optional: the account has 2FA on publishes and a plain
   `npm publish` returns `E403 ... Two-factor authentication or granular access
   token with bypass 2fa enabled is required`, having already passed the login
   check, so the error arrives after the tarball has been packed and looks like
   a permissions problem rather than a missing code.
7. Redeploy the site, because pushes do not auto-deploy:
   `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d`. Not
   optional on a release: `llm.txt` is served from there and five documentation
   pages send readers to it as the authoritative parameter list, so until you
   deploy, the site tells them a version npm no longer has.
8. No Claude attribution in commits, no emojis, no em dashes, per `CLAUDE.md`.

### Releasing the embedded library, which is a separate ritual

It versions independently of the npm package, in
`packages/bellows-embedded/library.properties`, and it goes to two registries
with two different artifacts. Run `npm run check:package -w packages/bellows-embedded`
first: it builds both and asserts what each must and must not contain.

1. Bump `version=` in `library.properties` AND `"version"` in `library.json`.
   The gate fails if they disagree, which is the only reason it has never
   happened.
2. `npm run check:package -w packages/bellows-embedded`. Needs `pio` on PATH
   for the second half, and says so rather than passing quietly if it is
   absent.
3. The mirror. `.github/workflows/mirror-embedded.yml` does this on a tag, but
   only if `MIRROR_TOKEN` is set, and **it is not set today**, so it is by hand:

   ```
   git clone https://github.com/virgilvox/bellows-embedded.git /tmp/mirror
   ./tools/build-mirror.sh /tmp/mirror-build
   cd /tmp/mirror && find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
   cp -R /tmp/mirror-build/. .
   git add -A && git commit -m "Bellows X.Y.Z" && git push
   git tag -a X.Y.Z -m "Bellows X.Y.Z" && git push origin X.Y.Z
   gh release create X.Y.Z --repo virgilvox/bellows-embedded ...
   ```

   Build to a temp directory and copy the contents in, keeping `.git`. Pointing
   `build-mirror.sh` at the clone deletes it, which is what happened the first
   time; the script now refuses rather than doing it again. Tag without a `v`,
   matching `0.1.0` and `0.1.1`, because the indexer matched that shape.
4. **Arduino Library Manager needs nothing further.** It watches the mirror for
   new tags and indexes them. 0.1.0 and 0.1.1 were submitted on 2026-08-17 and
   appeared on 2026-08-20, so "within a day", which is what the bot says, is
   the floor and not the ceiling. The indexer log is at
   `downloads.arduino.cc/libraries/logs/github.com/virgilvox/bellows-embedded/`,
   which is where to look when a version does not appear. It 404s until the
   indexer has processed the repository once.
5. PlatformIO: `pio account login` if needed, then `pio pkg publish` **from
   `packages/bellows-embedded`, not from the mirror**. That is a decision, not
   an accident: PlatformIO resolves the cross-folder includes the Arduino IDE
   cannot, so the examples keep sharing one patch rather than each carrying a
   copy, and the package keeps `examples/daisy_onekick`, which the mirror drops
   because it is a Makefile rather than a sketch. 0.1.0 went out from the mirror
   by mistake and is missing that example; `check:package` now fails if it
   happens again.

**Why the regenerate step moved to 3, and the history that says it had to.**
It used to be step 5, after publish and tag. The document knew that step got
skipped, and said so in capitals, having watched it happen at 0.1.5 and leave
`llm.txt` claiming to be exact for a version three releases old. What it did
not notice is that its own ordering was the cause: regenerating a
version-stamped file after you have tagged and pushed means the fix is always a
second commit, and CI gates `gen:llm` with regenerate-and-diff, so the release
commit itself goes red.

0.1.8 proved it by following the ritual literally: green CI on the two commits
before it, red on the release, on the one job that checks this. The library was
already on npm by then. Nothing was wrong with the published tarball, since
`llm.txt` lives in `apps/workbench/public` and is not in it, but for the length
of one commit the repository disagreed with the registry about what version
existed.

For a change that touches DSP shared with the embedded port, add before step 6, from `packages/bellows-embedded`:

- `npm run parity` and confirm every gate passes. The PRNG row must be exactly zero.
- `npm run tables` for anything touching theory or sequencing.
- `npm run fastmath` if you touched `core/fastmath.h`.
- `npm run size` and sanity check against `docs/HARDWARE.md`.
- `node tools/gen-tables.mjs` if any `ParamSpec` changed, which is how a param added in TypeScript and forgotten in C++ becomes visible.
