# KICKOFF

A prompt for starting a fresh session on this repository with no prior context. Copy the block
below, replace the OBJECTIVE line, and paste it as the first message.

It is deliberately front-loaded: the point is that the session does not spend its first twenty
tool calls rediscovering what `docs/HANDOFF.md` already says.

Keep this file current. The fastest way to make a kickoff useless is to let it describe a
repository that no longer exists.

---

```
You are picking up bellowsjs: a browser-native audio engine in TypeScript published to npm as
bellowsjs, a header-only C++17 port for microcontrollers, and a Vue demo app. Repo:
/Users/obsidian/Projects/ossuary-projects/bellowsjs

OBJECTIVE: <replace me. docs/HANDOFF.md has "The work queue, in the order I would take it",
split into work that needs no judgement call and work that needs mine. Start at the top of the
first list unless I say otherwise.>

READ FIRST, in this order, before touching anything:
  1. CLAUDE.md          house rules. Strict, and not suggestions.
  2. docs/HANDOFF.md    state, the plan, the harnesses, the traps. The two sections that save
                        the most time are "The verification harnesses" and "Things that are not
                        obvious from the code".
  3. docs/AUDIT-2.md    the current audit. 95 findings from a whole-repo pass, with the five
                        that were refuted listed at the end so you do not re-raise them.
  4. docs/AUDIT.md      the earlier audit, findings 1 to 20. Findings 10 and 11 carry a
                        correction: they say CI enforces things, and CI has never run.
  5. docs/HARDWARE.md   the embedded port, every flash and RAM number, and "Making it smaller",
                        which records what was measured and deliberately NOT taken.
  6. docs/LANDSCAPE.md  what else exists on the web and in hardware, where this library actually
                        leads and where it does not, where the instrument algorithms come from,
                        and what the research implies as work. Every claim in it is labelled
                        MEASURED, SOURCED or SECONDHAND; respect that distinction when you cite
                        it, because an earlier untraceable claim had to be withdrawn.

WHERE THINGS STAND
- packages/bellows is the library and the source of truth for all DSP. tsc clean, golden render
  green, and the whole suite passing. The file and test counts live in docs/HANDOFF.md and
  nowhere else, because nothing checks them and two copies of a count are two chances to be
  wrong: this prompt used to carry a third and a fourth, and all four disagreed.
- packages/bellows-embedded is the C++ port. 43 headers, compiling standalone and combined for
  Cortex-M7 and M4. All five examples plus a bring-up rig build as real Teensy 4.1 firmware, and
  examples/daisy_onekick links against real libDaisy.
- Parity passes on 34 rows with the PRNG bit exact, plus 348 exactly-compared value
  rows for the parts that make no sound.
- TWO THINGS HAVE NOT HAPPENED, and both matter more than they look:
    NOTHING HAS BEEN FLASHED TO A BOARD AND LISTENED TO. Everything is compile-verified and
    numerically verified. Do not confuse that with working.
    CI HAS NEVER RUN. .github/workflows/ci.yml is not on the default branch, so GitHub has never
    scheduled it. Every claim that CI enforces something describes a file, not a control.

HARD RULES (from CLAUDE.md, non-negotiable)
- No emojis anywhere. No em dashes: use commas, periods, colons, parentheses.
- No AI attribution in commits. No Co-Authored-By, no "Generated with". Plain imperative commit
  messages. The whole history is clean of this; keep it that way.
- Avoid stock AI phrasing: delve, dive into, seamless, robust, leverage, utilize, comprehensive,
  cutting-edge, elevate, empower, unleash, supercharge, "It's important to note", "In
  conclusion", "Additionally," as a sentence opener.
- Comments explain WHY, naming the algorithm and its source where there is one.
- Test driven. Nothing allocates on the audio path at steady state. 12-EDO is a default, never
  an assumption. Dependency direction is one way and never imports upward.

VERIFY EVERYTHING WITH THESE. Run them before you claim anything works.
  packages/bellows:            npm test                     all green, no count quoted here
                               npx tsc --noEmit
                               npm run gen:worklet          then confirm no git diff
  packages/bellows-embedded:   npm run parity               34 rows against the TypeScript
                               npm run tables               348 value rows, compared exactly
                               npm run fastmath             polynomial accuracy against libm
                               npm run memsafety            ASan and UBSan, 0.5x to 4x rate
                               npm run memsafety:fastmath   the same under BELLOWS_FAST_MATH
                               ./tools/size-report.sh       flash and RAM per sketch
                               EXTRA_CXXFLAGS=-DBELLOWS_FAST_MATH=1 ./tools/size-report.sh
                               node tools/gen-tables.mjs --check
                               node tools/check-docs.mjs --check

TRAPS THAT WILL BITE YOU, in the order they are likely to
1. The AudioWorklet ships as a CHECKED-IN GENERATED STRING. Change anything under src/kernel,
   src/engines, src/fx, src/dsp or src/core and you must rerun
   npm run gen:worklet -w packages/bellows. The whole suite stays green if you forget, because
   tests use renderOffline which imports source directly, and realtime silently runs the old
   DSP. This has already happened once. CI would catch it if CI ran.
2. Every documented number rots. A change moves a sketch and the tables quoting it are left
   behind; that happened four times in one session, and a second audit then found sixteen more.
   node tools/check-docs.mjs --check is the control, and it now covers 371 figures across
   docs/HARDWARE.md, the embedded README, examples/README.md, docs/HANDOFF.md, docs/ENGINEERING.md
   and this file, against the size report, the sketch symbol tables, parity, tables, fastmath and
   vitest list.
   It does NOT cover the whole-firmware Teensy table, the Daisy table, the ns tables, the board
   capacity table, the newlib-against-fastmath byte comparison or the bundle size in the release
   ritual. If you write a figure a command can print, add it to check-docs.mjs in the same
   commit. Note that it pins the ARM toolchain to the version docs/HARDWARE.md names: the two
   installed on this machine disagree on 36 of the 37 size rows, so a report run under the other
   one looks like a repository-wide regression and is not one.
3. Never add a global registry to the C++ port. One kick through a string-keyed registry of five
   engines costs 30488 bytes of flash and 30872 of RAM against 3760 and 1100 direct.
   bellows/bank.h gives runtime dispatch at byte-identical cost.
4. Golden renders: test/golden/piece-a.f32 must never change unless you intend a DSP change.
   Never set GOLDEN_UPDATE to make a test pass.
5. Gates are set from measurement at roughly ten times the observed value. Do not widen one to
   make it pass; find out which side moved. And a gate nobody has watched fail is a gate nobody
   should trust, so mutation test anything you add.
6. Check a new test for VACUITY, and mutation testing is how you check. Two parity rows added
   for effects that had none passed immediately and measured nothing: the shared driver feeds
   noise at 0.25, which never reaches a limiter's -0.3 dB ceiling or falls under a gate's
   -40 dB threshold. When a mutation does not fire, suspect the mutation first: the first
   limiter mutation moved a variable used only as the threshold test, not the one the gain
   reduction is computed from. A gate that passes on silence, or on a fixture whose
   constructor signature is wrong, passes for the wrong reason. That has already happened here.
7. Do not attribute firmware bytes to this library by symbol name. It is header-only templates,
   so its code inlines into the sketch's functions under the sketch's names, while sketch code
   that merely mentions a bellows type takes a bellows-looking one. Build twice and subtract.
8. Do not quote wall-clock ns from a microbenchmark as a property of the code. The same
   oscillator through two harnesses on one machine gave 22.6 and 59.8 ns per sample. Quote the
   ratio, measure both ends in one process, and prefer a countable quantity.
9. On PlatformIO's teensy platform, board_build.usb_type is silently ignored (use
   -D USB_MIDI_SERIAL) and it still defaults to gnu++14 (use build_unflags).

HOW TO WORK
- Read the relevant TypeScript before porting or changing anything. It is the source of truth.
- Make the change, then prove it with the harness that covers it. If no harness covers it, that
  is the first thing to build, and say so.
- Measure rather than estimate, and say which you did. Several figures in this repository were
  estimated by subtraction and presented as measured, and every one of them was wrong.
- Commit in logical chunks with plain imperative messages. Do not commit until the relevant
  gates pass.
- If you find something I got wrong, say so plainly rather than working around it. Two separate
  audits found real bugs in code that had already been reviewed and shipped.
```

---

## Variants

Replace the OBJECTIVE line with one of these.

```
OBJECTIVE: The unambiguous list in docs/HANDOFF.md, "The work queue", is finished. Take what
it turned up instead: the six buffer-owning C++ classes that size storage from a template int
and compute indices from the rate given to Init(). Pluck was the one that corrupted memory and
is fixed; the rest clamp, so they detune or stop sweeping silently, and npm run memsafety
proves only that they are memory safe. Decide the policy with me first (clamp quietly, report,
or size at Init), because it changes seven public classes. Then make config.h honest:
BELLOWS_SAMPLE_RATE claims to size delay lines and pluck loops and those two hardcode 48000.
```

```
OBJECTIVE: Push .github/workflows/ci.yml to the default branch and make it green. It has never
run once. Expect the first run to fail: the parity job needed a build step that was only added
by inspection, and nothing else in it has ever been exercised. Then correct every sentence in
docs/AUDIT.md and docs/HANDOFF.md that says CI enforces something, so they describe what the
run actually printed.
```

```
OBJECTIVE: Flash and validate on real hardware. I have a Teensy 4.1 and a Rev D audio shield.
Start with examples/00_BringUp, a checklist sketch with a written procedure in its README. The
measurement that matters most is the BLEP pitch-cost comparison it prints: the same eight
voices low and six octaves up. Confirm or refute the reciprocal-hoist cycle win in
dsp/oscillators.h while you are there, which is documented as unmeasured on purpose.
```

```
OBJECTIVE: The three DSP findings that change rendered output, from docs/AUDIT-2.md. The west
coast fold chain runs at 1x with no antialiasing; the BLAMP table's drift-removal step is the
wrong correction and costs the triangle 20 to 45 dB; the string waveguide plays audibly flat
below about 165 Hz. Each one moves the golden render, so measure first, show me the before and
after spectra, and regenerate the fixture only alongside the change that explains it.
```

```
OBJECTIVE: Milestone 3 in docs/HANDOFF.md. Port the theory and seq layers that are still
TypeScript only: markov (needs a fixed-capacity rewrite, the JS keys contexts by
JSON.stringify), pattern, transport, time, progressions, voicelead, scala. Each one gets a row
in tables.mjs with an exact comparison. Note that parallel agents cannot edit tables.mjs and
tables.cpp concurrently; either serialise that or split the harness per module first.
```

```
OBJECTIVE: The strategic list in docs/HANDOFF.md, "The work queue", which comes out of the
landscape research in docs/LANDSCAPE.md. Start with int16 delay storage behind a template
parameter, float staying the default: delay buffers are 86 percent of RAM in s5_all even after
exact sizing, and this is the Teensy Audio Library's own central decision. Measure the
quantisation cost before shipping it, do not assume it. Then make the scale layer tuning-aware,
which is both a correctness fix and the thing that makes the microtonality claim true.
```

```
OBJECTIVE: Milestone 5, the wire. Keep bellows.live as the composition brain and put only the
audio kernel on the board. KernelEvent is already flat and numeric on both sides with matching
enum values. Build the host side (serialise from Transport.scheduleHorizon over USB serial,
eight events per second at sixteenths and 120 bpm) and the device side (a lock-free
single-producer ring feeding the kernel, plus a sample clock the host lookahead targets).
```

```
OBJECTIVE: Three pieces of work on the simulator page and the embedded port, in this order,
because the third depends on the first two.

1. PORT MARKOV TO THE EMBEDDED LIBRARY.
   packages/bellows/src/seq/markov.ts is 183 lines and is one of the last seq modules that is
   TypeScript only. It cannot be transcribed: it keys contexts with JSON.stringify into a Map
   and grows without bound, and this library allocates nothing and sizes every buffer from a
   template parameter. So it needs a fixed-capacity rewrite: a template on alphabet size and
   maximum contexts, a flat table indexed by a packed context rather than a string key, and the
   documented backoff from order k down to 0 preserved exactly. Read seq/lsystem.h first: it is
   the closest thing already ported, it solves the same "grow a sequence without a heap"
   problem, and its header explains the truncation contract it chose.
   Then give it a row in test/parity/tables.cpp and tables.mjs. Markov draws from an rng, and
   the arp rows already establish how that is handled: "Random is excluded on both sides: it
   draws from an rng." Do the same, or make the draw comparable and say how. A wrong transition
   table plays a confident, plausible, wrong melody and no audio test can hear it, which is the
   sentence at the top of that harness and the reason it exists.

2. A COMPOSER LEVEL EXAMPLE.
   Everything shipped so far is one idea per sketch. What is missing is the one that argues for
   the library: several engines at once, a sequencer driving them, effects on a bus, all seeded
   so two boards produce the same piece. test/sketches/p3_workstation.cpp is already that shape
   as a size profile (8 VA, 8 Pluck, a kit, a delay and an EQ) but it is not an example and it
   makes no music. Build the example version: euclidean rhythms on the kit, a markov melody
   from the port above, a bass line, a plate or delay send, and one PRNG root forked per part.
   It has to fit a Teensy 4.x and say plainly which boards it does not fit, measured with
   examples/build-matrix.sh rather than assumed. apps/workbench/src/lib/composer.ts is the
   browser equivalent and is worth reading for structure, not for porting.

3. THE SIMULATOR LAYOUT, WHICH IS STILL WRONG.
   apps/workbench/src/views/SimulatorView.vue is sixteen panels. It was a single column, then a
   two-up grid, and it is still a scroll. The shape it wants is a console: a strip that does not
   scroll away holding RUN, the output picker and the status, and one switchable area beneath it
   for BOARD, CODE, PARAMETERS, INPUTS and FLASH. That is the change that removes scrolling
   rather than rearranging it. The board diagram is also drawn as a tall thin SVG next to empty
   paper; a Teensy is a rectangle and the drawing should use the width it has.
   Match the app: tokens from styles/forge.css only, never a literal hex, panels as .panel plus
   .panel-title with the number in the <em>, plain <button> with .lit for the active one. The
   design notes are in docs/HANDOFF.md under the simulator section, and the four traps there are
   real and cost time: NoteValue treats a bare number as MIDI, a scripted click does not unlock
   an AudioContext, samples must be read off the firmware rather than written from memory, and
   KeepAlive means onDeactivated matters.

VERIFY, and none of these is optional:
  npm test -w packages/bellows                          1348 tests
  npm run typecheck -w apps/workbench                   vue-tsc
  npm run check:examples -w apps/workbench              the 49 site examples still resolve
  npm run gen:sim -w apps/workbench && git diff --exit-code -- apps/workbench/src/lib/sim/sources.gen.ts
  cd packages/bellows-embedded && npm run tables:check   the new markov rows
  cd packages/bellows-embedded && npm run parity:check   34 audio rows
  cd packages/bellows-embedded && node tools/check-docs.mjs --check
  cd packages/bellows-embedded/examples && ./build-matrix.sh 07_YourExample

And listen to it. The simulator's samples were wrong three times in ways that typechecked and
built, and the only thing that caught them was playing them and measuring the output.
```
