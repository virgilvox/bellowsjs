# AUDIT

Full-repository audit of `bellowsjs` at 0.1.5, with the evidence for each finding and what was
done about it. Companion to `docs/HARDWARE.md`, which covers the embedded port and shares
several of these findings.

Method: read every file under `packages/bellows/src`, run the suite and the typechecker,
regenerate the worklet bundle and diff it against the committed one, then measure per-engine
and per-effect cost and resident memory in Node against the real classes. Findings are ordered
by what they cost a user, not by how interesting they are.

## Baseline at the time of the audit

| Check | Result |
| --- | --- |
| `npm test` | 77 files, 1104 tests, all passing, 8.7 s |
| `npx tsc --noEmit` | clean |
| `Math.random` in library code | none |
| Browser globals in `dsp`, `engines`, `fx`, `theory`, `seq`, `analysis`, `core` | none |
| Allocation inside `process()` bodies | none found |
| `src/kernel/worklet-code.gen.ts` versus a fresh `gen-worklet` run | byte identical |
| Runtime dependencies | none |

The architectural claims in the README hold up. Sample rate really is constructor-injected
everywhere, the `(l, r, from, to)` contract is honored without exception, the seeded PRNG
discipline is real, and offline rendering really is the same `KernelEngine` class driven by the
same message stream. The DSP itself is careful work: the tabulated Kaiser-sinc BLEP, the exact
per-position COLA normalization in `Istft`, the closed-form tempo integral in `TempoMap`, the
loop phase-delay compensation in `pluck` and `waveguide`, and the BS.1770 coefficients derived
from the analog prototype rather than copied from the 48 kHz table.

So the findings below are about lifecycle and resource management at the facade, not about
signal correctness.

## Measured cost table

Node on x86, one voice or one stereo effect instance, 44100 Hz, 128 frame blocks. The ns/sample
column is a relative ranking between modules in the same runtime, not a cycle count for any
particular CPU. Resident bytes are the sum of every distinct `ArrayBuffer` reachable from the
instance, which is the figure that decides whether a module fits on a microcontroller.

```
ENGINES        ns/samp   voice KB      EFFECTS       ns/samp  resident KB
additive         501.3        1.3      saturator       493.0        19.3
va               356.0        0.0      blur            415.1       176.1
harmonic         305.8        0.5      whisper         402.6        84.0
formant          136.4        0.0      pitchshift      359.3       204.1
fm               109.5        0.0      fdn             348.4       278.2
granular          95.6      176.3*     freeze          296.4       204.1
westcoast         58.8        0.0      denoise         283.1       184.1
hat               44.6        0.0      plate           280.3       248.0
kick              39.5        0.0      robot           231.2        84.0
snare             38.0        0.0      chorus          181.9        16.0
tom               31.6        0.0      phaser          164.6         0.5
tube              24.0        8.0      tapeDelay       144.1      1024.0
wavetable         23.0      320.0*     multitap        104.1      1027.6
noise             23.0        0.0      freqshift        74.3         0.5
string            22.4       33.8      compressor       60.1         4.0
clap              21.9        0.0      flanger          61.1         4.0
modal             16.0        1.5      transient        61.9         0.0
pluck              9.7       33.3      tremolo          52.0         0.0
                                       autopan          50.7         0.0
                                       limiter          37.2        17.2
                                       ringmod          30.8         0.0
                                       eq               19.9         0.0
                                       gate             42.1         0.0
```

Starred entries are shared per sample rate across all voices, not per voice.

One measurement that is not in that table and matters more than any single row: oscillator cost
is pitch dependent by more than an order of magnitude, because `BlepOscillator.sumBlep` loops
over every edge within `KERNEL_HALF * dt` of the current phase and that window grows linearly
with frequency.

```
BlepOscillator ns/sample at 44100 Hz
     hz      saw   square     sine
     55      5.1      6.5     15.6
    440     10.8     11.1     16.2
   1760     25.3     18.3     16.0
   7040     71.1     42.9     16.0
```

Saw at the top of the keyboard costs 14 times what it costs in the bass. Any polyphony budget
sized at A440 will drop out on a high lead. This is not a defect (the tabulated BLEP is what
buys the alias rejection the spectrum tests demand) but it is a planning fact that has to be
written down, and it argues for a frequency-dependent kernel width before the DSP is committed
to hardware.

## Findings

### 1. `removeChannel` was unreachable, so channels were permanent

`src/kernel/messages.ts` defined it and `KernelEngine` handled it, but nothing in `bellows.ts`,
`index.ts` or the workbench ever posted it, and `Instrument` had no disposal method. Every
channel ever created kept its whole preallocated `VoicePool` alive for the life of the
`Bellows` instance.

Not theoretical: engine hot swap is a headline feature, and `apps/workbench/src/lib/composer.ts`
`swapEngine` builds a fresh channel and only calls `old.gain(0)`. At the measured per-voice
resident sizes that is 406 KB leaked per swap for a `string` channel (33.8 KB times polyphony
12) and 533 KB for `pluck`. Twenty swaps is 8 MB of dead voice pools inside the worklet. The
dead channels also still cost two `fill(0)` calls per block each, because `KernelEngine.process`
clears every channel's scratch buffers before rendering.

Fixed: `Instrument.dispose()` posts `removeChannel`, prunes the channel's messages from the
recorded setup, and leaves the handle inert.

### 2. `Bellows.setup` grew without bound

`post()` unconditionally did `this.setup.push(msg)`, so every `channelParam`, `fxParam`,
`channelGain`, `channelPan` and `send` accumulated forever, and `render()` replayed all of them
at setup time.

Demonstrated by shipped code, not by a hypothetical: `apps/workbench/src/examples/extend.ts`
calls `fxParam` four times per bar inside a `clock.at('16n')` callback, and
`apps/workbench/src/lib/instrument-store.ts` calls `param('freq', ...)` on every legato note
from the on-screen keyboard.

Fixed: idempotent state-setter messages now collapse last-write-wins, keyed by identity and
updated in place at their first position. In-place update is safe because every setup message is
applied before the first rendered block and these messages are idempotent setters. Structural
messages that are not idempotent (`createChannel`, `createBus`, `registerBank`, `registerGrain`,
`defOp`, `internParam`, `events`, `panic`, `removeChannel`) still always append.

### 3. `EventKind.ParamRamp` was advertised but did nothing

`src/types.ts` declared it, `KernelEvent.c` documented itself as "ParamRamp: ramp seconds",
`EventKind` is exported from the public index, and `KernelEngine.applyEvent` fell through to
`default: break`. Nothing emitted it and no test covered it.

Fixed: implemented in the kernel over a preallocated fixed-size ramp table, advanced once per
block, with `Instrument.rampParam()` on the facade. Block granularity is deliberate: `setParam`
on most engines recomputes filter coefficients, so a per-sample ramp would mean a coefficient
recompute per sample per ramp.

### 4. `dispose()` never closed the AudioContext it created

`Bellows.boot()` calls `new AudioContext(...)` when the caller passes none, and `dispose()` tore
down the timer, scheduler, kernel node and analyser but not the context. Browsers cap contexts
per page at around six. `apps/workbench/src/lib/audio.ts` carried a hand-written workaround with
a comment explaining exactly this problem. When a consumer has to work around the library in a
comment, the fix belongs in the library.

Fixed: boot records whether it owns the context, and `dispose()` stops the transport and closes
an owned context.

### 5. Delay memory was about 50 percent larger than it needed to be, and unconfigurable

`DelayLine` rounds capacity up to a power of two. The stereo `delay` effect hardcoded a 4 second
maximum, so it allocated 2048 KB per instance regardless of the time actually set: 176408
samples needed per line, 262144 allocated, 49 percent waste, two lines. `tapeDelay` and
`multitap` were 1024 KB each. The FDN sized all eight lines for `SIZE_MAX = 3` even at size 1,
costing 278 KB where about 95 KB would do. A patch with a delay on eight channel inserts is
16 MB of worklet-resident buffer for delay times the user may have set to 100 ms.

The same numbers make these effects impossible to port. Compiled for Cortex-M7 against a 1 MB
RAM region, a 4 second stereo delay overflows by exactly 1,049,728 bytes, which independently
confirms the 2048 KB measured in Node.

Fixed: construction-time capacity options (`maxSeconds` on the three delays, `maxSize` on the
FDN) with defaults exactly equal to the previous hardcoded maxima, so golden renders are
unchanged. They are deliberately not `ParamSpec` entries, because a `ParamSpec` implies a
runtime-settable control and these cannot change after construction.

### 6. `render()` correctness rests on an undocumented no-await invariant

`bellows.ts` sets `this.renderCtx`, re-runs the clock callbacks, and clears it in a `finally`.
Because the method is `async` but has no `await` inside that span, the 25 ms scheduler interval
cannot interleave and misroute live events into `renderCtx.events`. That is correct today and it
is load bearing. Any future `await` inside the try block, for instance to yield for progress
reporting on a long render, silently breaks live playback during export.

Status: documented in place. Not otherwise changed.

### 7. The sampler allocates at note-on rate on the audio thread

`SamplerBank.zonesFor` allocates an output array, a `Map`, and per-group arrays, and calls
`members.sort()`, on every note-on inside the worklet. It is documented in the source. Note-rate
garbage in a worklet is survivable in a browser and is not survivable on a microcontroller.

Status: open. Acceptable in the browser, blocking for the sampler's eventual port.

### 8. Kernel event insertion is O(n) per event

`pushEvent` binary searches then `arr.splice(lo, 0, e)`. `renderOffline` receives a whole piece
as one `events` message, so a dense score is O(n squared) on the memmove. At 2400 events, which
is five minutes of sixteenths, that is fine. A MIDI file import with 50000 events would stall.

Status: open, bounded, worth fixing when MIDI file playback lands.

### 9. Smaller items

- `waveguide.ts` allocates the second polarization delay line only when the key `polDetune` is
  present in the construction params, so setting it later on a channel created without it
  silently does nothing. The five string presets all include it, so the shipped path is fine.
- There is no `removeBus` message at all.
- `quick.ts` never resets its shared boot promise, so a failed boot rejects every subsequent
  `play()` for the life of the page.
- `defOp` evaluates a string with `new Function`. That is documented for CSP reasons, and it is
  also an eval sink: an application that lets users author `defEngine` bodies has given them
  code execution. Not only in the worklet realm, which is what this finding first said and what
  the correction is: `render()` replays the setup log through `renderOffline` on the calling
  thread, so the same string is evaluated again on the main thread, next to DOM, fetch, cookies
  and localStorage. Worth an explicit line in the tier 3 documentation.
- `engines/soundfont.ts` imports types from `io/sf2` and `io/sfz`, which runs against the stated
  dependency direction. It is type-only, so it costs nothing at runtime. It was recorded here as
  the one place the layering rule is bent, and that was wrong twice over: `core/scheduler.ts`
  imports the `Transport` type from `seq/transport` in the same shape, and `core/register.ts` held
  22 runtime imports from `engines/` and `fx/` until it moved to `src/register.ts` beside the
  facade. What is left is three type-only upward imports across two files, all erased at compile
  time, and `packages/bellows/test/integration/layering.test.ts` now names those three, fails on a
  fourth, and fails on any upward import from a subdirectory of `src/` that survives to runtime.

### 10. No CI

Golden-render regression was the strongest correctness guarantee in the repository and it did
not run on push.

Fixed, with a caveat added later that undoes most of it:
`.github/workflows/ci.yml` was written and runs typecheck, the suite and the build on node 20 and
22, plus both app builds and the embedded size report on two ARM targets.

IT HAS NEVER RUN, as of 2026-08-04. **No longer true, and the rest of this finding now reads
correctly as written**: on 2026-08-15 `gh run list --workflow=ci.yml --limit 200` returns 26
runs, 19 green and 7 failures, 11 of them pushes to `main`. The file is on the default branch
and the gates below are enforced. The two consequences named in the next sentence were both
found by inspection and both have since been fixed. Everything from here to the end of this
finding is kept as the record of what was true when it was written.

The file is not on the default branch, so GitHub has never scheduled it, and
`gh run list` returns nothing. Everything below that says CI enforces something describes a file,
not a control. Two consequences found by inspection rather than by a red build: the parity job
called `gen-tables.mjs --check` without first building `packages/bellows/dist/bellows.js`, which
that script reads and which is gitignored, so the job would have exited 2 on its first run; and
the worklet-regeneration guard in finding 11 has never actually guarded anything. The missing
build step is fixed. The workflow still has to reach the default branch before any of this is
true.

## Two findings the fixes themselves produced

Worth recording separately, because both are the kind of thing that only appears when you change
the code rather than read it.

### 11. A green suite does not prove the worklet is current

None of the three fix passes regenerated `src/kernel/worklet-code.gen.ts`. That file is tracked,
generated, and bundles `kernel/engine.ts` for the `AudioWorkletProcessor`. The whole suite stayed
green because every test exercises `renderOffline`, which imports the source directly. Realtime
playback would have shipped without `ParamRamp` and without the fx capacity options, and nothing
would have caught it.

`docs/HANDOFF.md` has warned about exactly this since the first release, which is evidence that a
warning in a document is not a control. A CI job to regenerate the bundle and fail on a diff was
written, and it is not a control either until the workflow reaches the default branch: see the
note under finding 10. As of this writing nothing has ever enforced it automatically.

### 12. The one upward import in the lower half of the tree

The first draft of `SetupLog` landed in `src/core/` while importing `KernelMessage` from
`src/kernel/messages`. `CLAUDE.md` forbids upward imports outright, and a grep confirmed it was
the only one anywhere in `core`, `dsp`, `engines`, `fx`, `theory`, `seq` or `analysis`. The module
is defined entirely in terms of `KernelMessage`, so the fix was to move it up rather than to
invert the dependency: it now lives at `src/kernel/setuplog.ts`.

The layering rule is enforced by review rather than tooling, and review caught this one. A lint
rule would be cheaper than the next reviewer being tired.

## Second pass: auditing the port itself

The first pass audited the TypeScript. This one audited the C++ port and the harnesses that
were supposed to be checking it, on the principle that roughly thirty of those headers had only
ever been compiled, and compiling is not sounding right.

### 13. Coverage was the real hole

Audio parity covered four engines out of fourteen ported units. Everything else had passed a
compile check and nothing more. Extending it to all nineteen modules immediately found two real
bugs, which is the expected yield when you point a measurement at unmeasured code.

### 14. `fx/eq.h` was not a port

It carried the comment "from src/fx/eq.ts" and was a three band design. The TypeScript is six
bands: a low shelf, four bells, a high shelf, at different default frequencies. Nobody had
diffed them because no test compared them.

Fixed: `Eq6` is the faithful port, verified at 2.9e-7. `Eq3` survives as a deliberate reduction
with a comment that says so plainly, and `tools/gen-tables.mjs` now records it as unported by
design so the orphan report stays a signal.

### 15. `StereoDelay<kMaxMs>` gave more delay than it was asked for

`DelayLine` rounds capacity up to a power of two, and the effect clamped at the resulting ring
rather than at the requested maximum. `StereoDelay<250>` at 44100 silently allowed 371 ms, while
the TypeScript clamps at exactly its `maxSeconds`. Relative error against the JS was 0.317.

Fixed: it clamps at the requested maximum. Error is now 7.8e-8.

### 16. Gates with 25000x headroom are not tests

A deliberate 0.01 percent mutation of the `Svf` integrator passed every gate. Measuring the
headroom explained why: `saturator` sat at 25000x its measured drift, `delay` at 12853x, `eq` at
3413x, `compressor` at 2222x, `snare` at 158x. They were round numbers, not measurements.

Fixed: every gate is now set from its measured value at roughly ten times. The same mutation is
now caught by two of them. Both the value gate and the audio gate were then mutation tested to
prove they can fail, because a gate nobody has seen fail is a gate nobody should trust.

### 17. The harness itself had a bug that produced three wrong verdicts

`parity.mjs` faked `NamedRng.fork()` as a wrapper over one shared generator. The real one
returns an independent stream. Because `Lfo` draws a value in its constructor to seed its
sample-and-hold, the fake fork let one component steal a draw from its sibling's noise stream.

That single mistake made `formant` look broken when it was not, and made `snare` and `va` look
correct when they were only accidentally aligned. Three verdicts, all wrong, from one line.

The fix also produced something useful: the JS derives child streams by literal string
concatenation, `rng(label).fork(child) === rng(label + '::' + child)`, so a C++ caller can land
on any browser stream by writing the full label path with no per-object storage. That is now
documented in `core/prng.h`, and it is what makes browser-identical noise achievable on device.

### 18. Two modules diverge for reasons that are not defects

`chorus` at 4e-2 and `tube` at a 1e-2 peak both looked like failures. Neither is.

The chorus is bit-identical with modulation off (6.3e-6) and its error scales exactly with
depth (0.1 gives 8e-3, 0.5 gives 4e-2). The cause is LFO phase accumulating in float here and
double there: a fractional-sample shift of a white noise read is a large sample difference for
an identical sound. Sample-wise RMS is simply the wrong instrument for a time-modulating effect,
so the harness now gates the unmodulated path tightly, which is what would actually catch a
broken chorus, and the modulated path loosely with the reason written down.

The tube's exceeding samples are 0.4 percent of the total, spaced twice per period at 220 Hz,
which places them on the waveform's steep edges where sub-sample timing reads as amplitude.

Worth doing later: accumulate LFO phase in a uint32 fixed-point counter. It never drifts, it is
cheaper than float, and it would close most of the chorus gap.

### 19. What was verified and found clean

- No heap, no exceptions, no STL containers, no static constructors, no uninitialised members
  anywhere in the library. The only `virtual` is the `AudioStream::update()` the Teensy Audio
  Library requires, and it is documented as such.
- All 43 headers compile standalone with `-Wall -Wextra`, and all of them together in one
  translation unit, on Cortex-M7 and Cortex-M4.
- Every symbol the example sketches reference resolves.
- 317 value rows across euclid, scales, chords, note parsing, cellular automata, arp, the tempo
  map and MIDI parsing match the TypeScript exactly.
- Commit history carries no AI attribution, no emoji and no em dashes, and neither do the files.

### 20. A slow test run that was not a regression

The suite took 87 seconds against 7.4 earlier, with two tests at 67 and 71 seconds. It was
machine contention: `user` time was identical at 7.66 against 7.84 seconds while wall time
doubled, and the box was at load average 7.5. Worth recording only because "the tests got slow"
is the kind of observation that sends someone hunting a phantom.

## Still open after this pass

- `SamplerBank.zonesFor` allocates at note-on rate on the audio thread (finding 7).
- Kernel event insertion is O(n) per event (finding 8).
- `channelFx` and `masterFx` collapse by identity, so the sequence replace-chain, set-param,
  replace-chain now applies the param to the second chain where an append-only log discarded it.
  No code in this repository does that, and the golden render does not go through the facade, so
  nothing observable changed. It is the more useful semantic and it is a real difference.
- `createBus`, `registerBank`, `registerGrain` and `defOp` are not collapsed, which is correct for
  one-shot loads but still grows for an app that creates a bus per reforge.
- Param ramps advance at block granularity, and the block a ramp starts in is not one of the
  blocks it moves in: `advanceRamps(blockStart)` runs at the top of `process()`, before that
  block's events are applied, so no slot exists yet when the pass goes by. The parameter holds
  its old value for the whole of the starting block and the destination arrives at the top of
  the next one. A ramp shorter than a block therefore lands one block late (2.7 ms at 48k with
  128 frames), not immediately, which is what this line used to claim. Measured and pinned by
  'lands a sub-block ramp one block late' in `packages/bellows/test/kernel/paramramp.test.ts`.
  A ramp on a parameter the pool has never held a value for does still apply at once, because
  there is no starting point to glide from.
- `SetupLog` is exported from the public index. It is an implementation detail of the facade;
  `VoicePool` set the precedent, but trimming both would keep the public surface honest.
- The small items in finding 9.
