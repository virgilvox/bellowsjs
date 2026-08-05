# KICKOFF

A prompt for starting a fresh session on this repository with no prior context. Copy the block
below, replace the OBJECTIVE line, and paste it as the first message.

It is deliberately front-loaded: the point is that the session does not spend its first twenty
tool calls rediscovering what `docs/HANDOFF.md` already says.

---

```
You are picking up bellowsjs, a browser-native audio engine (TypeScript, published to npm)
that now also has a header-only C++17 port for microcontrollers. Repo:
/Users/obsidian/Projects/ossuary-projects/bellowsjs

OBJECTIVE: <replace me. See "The plan" in docs/HANDOFF.md for the six milestones.
Milestone 1 is board bring-up, and it is the one thing nobody has done.>

READ FIRST, in this order, before touching anything:
  1. CLAUDE.md            house rules. They are strict and they are not suggestions.
  2. docs/HANDOFF.md      state, the plan, the verification harnesses, the open decisions.
                          Section "The verification harnesses" and section "Things that are
                          not obvious from the code" are the two that save the most time.
  3. docs/AUDIT.md        20 findings with their evidence. Read before changing the facade,
                          the fx capacity options, the kernel ramp table, or the C++ port.
  4. docs/HARDWARE.md     the embedded port: seven design rules, every flash and RAM number,
                          why there is no registry, and the double-precision cost table.

WHERE THINGS STAND
- packages/bellows is the TypeScript library and the source of truth for all DSP.
  80 test files, 1146 tests, tsc clean, golden render green.
- packages/bellows-embedded is the C++ port. 43 headers, compiles standalone and combined for
  Cortex-M7 and M4. All five examples build and link as real Teensy 4.1 firmware.
- Parity passes on 19 audio modules with the PRNG bit exact, plus 317 exactly-compared value
  rows for the parts that make no sound (scales, chords, euclid, arp, CA, tempo map, MIDI).
- NOTHING HAS BEEN FLASHED TO A BOARD AND LISTENED TO. Everything is compile-verified and
  numerically verified. Do not confuse that with working.

HARD RULES (from CLAUDE.md, non-negotiable)
- No emojis anywhere. No em dashes: use commas, periods, colons, parentheses.
- No AI attribution in commits. No Co-Authored-By, no "Generated with". Plain imperative
  commit messages. The whole history is clean of this; keep it that way.
- Avoid stock AI phrasing: delve, dive into, seamless, robust, leverage, utilize,
  comprehensive, cutting-edge, elevate, empower, unleash, supercharge, "It's important to
  note", "In conclusion", "Additionally," as a sentence opener.
- Comments explain WHY. Match the existing voice: a paragraph naming the algorithm, its
  source where there is one, and the non-obvious decisions.
- Test driven. Nothing allocates on the audio path at steady state. 12-EDO is a default,
  never an assumption. Dependency direction is one way and never imports upward.

VERIFY EVERYTHING WITH THESE. Run them before you claim anything works.
  packages/bellows:            npm test          80 files, 1146 tests
                               npx tsc --noEmit
                               node scripts/gen-worklet.mjs   then confirm no git diff
  packages/bellows-embedded:   npm run parity    19 modules against the TypeScript
                               npm run tables    317 value rows, compared exactly
                               npm run fastmath  polynomial accuracy against libm
                               npm run size      flash and RAM per sketch
                               node tools/gen-tables.mjs --check

TRAPS THAT WILL BITE YOU, in the order they are likely to
1. The AudioWorklet ships as a CHECKED-IN GENERATED STRING. Change anything under
   src/kernel, src/engines, src/fx, src/dsp or src/core and you must rerun
   npm run gen:worklet -w packages/bellows. The whole test suite stays green if you forget,
   because tests use renderOffline which imports source directly, and realtime silently runs
   the old DSP. This has already happened once.
2. Never add a global registry to the C++ port. One kick through a string-keyed registry of
   five engines costs 30264 bytes of flash and 37580 of RAM against 3760 and 1100 direct.
   bellows/bank.h gives runtime dispatch at byte-identical cost.
3. Golden renders: test/golden/piece-a.f32 must never change unless you intend a DSP change.
   Never set GOLDEN_UPDATE to make a test pass.
4. Parity gates are set from measurement at roughly ten times observed drift. If you add a
   module, measure it first. Do not widen a gate to make it pass; find out which side moved.
5. The PRNG parity row must be exactly zero. If it is not, nothing below it means anything.
6. A slow test run is usually machine contention, not a regression. Compare user time against
   real time before hunting it.
7. On PlatformIO's teensy platform, board_build.usb_type is silently ignored (use
   -D USB_MIDI_SERIAL) and it still defaults to gnu++14 (use build_unflags).

HOW TO WORK
- Read the relevant TypeScript before porting or changing anything. It is the source of truth.
- Make the change, then prove it with the harness that covers it. If no harness covers it,
  that is the first thing to build, and say so.
- Commit in logical chunks with plain imperative messages. Do not commit until the relevant
  gates pass.
- If you find something I got wrong, say so plainly rather than working around it. The audit
  found two real bugs in code that had already been reviewed and shipped.
```

---

## Variants

**For Milestone 1 (board bring-up), replace OBJECTIVE with:**

```
OBJECTIVE: Flash and validate on real hardware. I have a Teensy 4.1 and a Rev D audio shield.
Start with examples/01_OneKick using examples/platformio.ini, confirm it makes the right sound
with no clicks or dropouts, then work through 02 to 05. Measure real CPU load with
AudioProcessorUsageMax, and specifically measure polyphony at the TOP of the keyboard, not at
A440, because the BLEP oscillator costs 14 times more at 7 kHz than at 55 Hz. Report what
breaks. Then attempt the Daisy path, which has never been built against the real libDaisy.
```

**For Milestone 2 (the two known DSP risks):**

```
OBJECTIVE: Close the two DSP risks the audit identified and deliberately deferred.
(a) The BLEP oscillator's residual sum loops over every edge within the kernel half-width, so
cost grows with frequency: 14x from 55 Hz to 7 kHz. Design a frequency-dependent kernel cap or
a cheaper fallback above a threshold. Do it in the TypeScript first, measure against the
existing spectrum gates in test/dsp-osc, then let parity carry it to the C++.
(b) Accumulate LFO phase as a uint32 fixed-point counter instead of a float. It never drifts,
it is cheaper, and it should close most of the chorus parity gap (4e-2 now, 6.3e-6 with
modulation off). Touches bellows/fx/modfx.h and bellows/dsp/lfo.h.
```

**For Milestone 3 (finish theory and sequencing):**

```
OBJECTIVE: Finish the layers that are nearly free and are the reason to choose this over
DaisySP or Mozzi. Port to packages/bellows-embedded, fixed capacity, no allocation:
seq/markov (the JS keys contexts by JSON.stringify, so this needs a real rewrite),
seq/pattern, seq/transport, seq/time, theory/progressions, theory/voicelead, theory/scala.
Every one gets a row in test/parity/tables.mjs compared exactly. The whole theory layer is
currently 2616 bytes of flash, so keep an eye on the size report as you go.
```

**For Milestone 5 (the event wire):**

```
OBJECTIVE: Build the hybrid. Keep bellows.live as the composition brain and stream KernelEvent
to a board. The event struct is already flat, numeric, and enum-matched on both sides, and
bellows/kernel.h has the queue and the block-splitting render loop. Build the host side
(serialize from Transport.scheduleHorizon over USB serial) and the device side (lock-free
single-producer ring plus a sample clock the host lookahead targets). Acceptance: a pattern
authored in the browser plays on the board in time, and the same seed produces the same noise,
which the label rule documented in bellows/core/prng.h makes possible.
```
