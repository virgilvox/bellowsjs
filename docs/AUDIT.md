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
  code execution in the worklet realm. Worth an explicit line in the tier 3 documentation.
- `engines/soundfont.ts` imports types from `io/sf2` and `io/sfz`, which runs against the stated
  dependency direction. It is type-only, so it costs nothing at runtime, but it is the one place
  the layering rule is bent.

### 10. No CI

Golden-render regression was the strongest correctness guarantee in the repository and it did
not run on push.

Fixed: `.github/workflows/ci.yml` runs typecheck, the suite and the build on node 20 and 22,
plus both app builds and the embedded size report on two ARM targets.

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
warning in a document is not a control. The CI job now regenerates the bundle and fails on a
diff.

### 12. The one upward import in the lower half of the tree

The first draft of `SetupLog` landed in `src/core/` while importing `KernelMessage` from
`src/kernel/messages`. `CLAUDE.md` forbids upward imports outright, and a grep confirmed it was
the only one anywhere in `core`, `dsp`, `engines`, `fx`, `theory`, `seq` or `analysis`. The module
is defined entirely in terms of `KernelMessage`, so the fix was to move it up rather than to
invert the dependency: it now lives at `src/kernel/setuplog.ts`.

The layering rule is enforced by review rather than tooling, and review caught this one. A lint
rule would be cheaper than the next reviewer being tired.

## Still open after this pass

- `SamplerBank.zonesFor` allocates at note-on rate on the audio thread (finding 7).
- Kernel event insertion is O(n) per event (finding 8).
- `channelFx` and `masterFx` collapse by identity, so the sequence replace-chain, set-param,
  replace-chain now applies the param to the second chain where an append-only log discarded it.
  No code in this repository does that, and the golden render does not go through the facade, so
  nothing observable changed. It is the more useful semantic and it is a real difference.
- `createBus`, `registerBank`, `registerGrain` and `defOp` are not collapsed, which is correct for
  one-shot loads but still grows for an app that creates a bus per reforge.
- Param ramps advance at block granularity, so one shorter than a block lands on its destination
  immediately, and a ramp on a parameter the pool has never held a value for applies at once
  because there is no starting point to glide from.
- `SetupLog` is exported from the public index. It is an implementation detail of the facade;
  `VoicePool` set the precedent, but trimming both would keep the public surface honest.
- The small items in finding 9.
