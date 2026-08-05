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

WHERE THINGS STAND
- packages/bellows is the library and the source of truth for all DSP. 83 test files, 1204
  tests, tsc clean, golden render green.
- packages/bellows-embedded is the C++ port. 43 headers, compiling standalone and combined for
  Cortex-M7 and M4. All five examples plus a bring-up rig build as real Teensy 4.1 firmware, and
  examples/daisy_onekick links against real libDaisy.
- Parity passes on 19 audio modules with the PRNG bit exact, plus 317 exactly-compared value
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
  packages/bellows:            npm test                     83 files, 1204 tests
                               npx tsc --noEmit
                               npm run gen:worklet          then confirm no git diff
  packages/bellows-embedded:   npm run parity               19 modules against the TypeScript
                               npm run tables               317 value rows, compared exactly
                               npm run fastmath             polynomial accuracy against libm
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
   behind; that happened four times in one session. node tools/check-docs.mjs --check is the
   control for docs/HARDWARE.md. It does NOT cover the embedded README, the whole-firmware
   Teensy table, the Daisy table or the ns tables, and some of those are stale right now.
3. Never add a global registry to the C++ port. One kick through a string-keyed registry of five
   engines costs 30488 bytes of flash and 30872 of RAM against 3760 and 1100 direct.
   bellows/bank.h gives runtime dispatch at byte-identical cost.
4. Golden renders: test/golden/piece-a.f32 must never change unless you intend a DSP change.
   Never set GOLDEN_UPDATE to make a test pass.
5. Gates are set from measurement at roughly ten times the observed value. Do not widen one to
   make it pass; find out which side moved. And a gate nobody has watched fail is a gate nobody
   should trust, so mutation test anything you add.
6. Check a new test for VACUITY. A gate that passes on silence, or on a fixture whose
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
OBJECTIVE: Work the unambiguous list in docs/HANDOFF.md, "The work queue". In order: the SFZ
#define expansion blowup (a 622-byte file allocates 352 MB, and it is the only place this
library parses hostile input), the Pluck::NoteOn buffer overflow on the embedded side, the
stale embedded README (extend check-docs.mjs to cover it rather than fixing it by hand), and
the coverage holes with teeth. Do not touch anything on the second list without asking me.
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
OBJECTIVE: Milestone 5, the wire. Keep bellows.live as the composition brain and put only the
audio kernel on the board. KernelEvent is already flat and numeric on both sides with matching
enum values. Build the host side (serialise from Transport.scheduleHorizon over USB serial,
eight events per second at sixteenths and 120 bpm) and the device side (a lock-free
single-producer ring feeding the kernel, plus a sample clock the host lookahead targets).
```
