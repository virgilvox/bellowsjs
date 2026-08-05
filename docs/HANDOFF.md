# HANDOFF

State of the project as of 2026-08-04, after the audit pass and the embedded port. Read this first when picking the work back up. Companions: `docs/PRD.md` (what and why), `docs/ENGINEERING.md` (platform facts, DSP formulas, packaging research), `docs/AUDIT.md` (every finding with its evidence), `docs/HARDWARE.md` (the embedded port, with the flash and RAM measurements behind it), `CLAUDE.md` (house rules), `docs/KICKOFF.md` (a prompt for starting a fresh session on this), `docs/prototype-0.html` (the original design probe).

## Where things stand

- `bellowsjs@0.1.5` is published on npm. Tags pushed to github.com/virgilvox/bellowsjs, main is current. `packages/bellows-embedded` is at 0.1.0 and is not published anywhere yet.
- Library test suite: 81 files, 1173 tests, all passing in plain Node, including golden-render regression (`test/golden`, regenerate with `GOLDEN_UPDATE=1` only alongside an intentional DSP change).
- `tsc --noEmit` clean. Build: `npm run build -w packages/bellows` runs worklet generation, vite (ESM + standalone IIFE), declaration emit, and writes `dist/worklet.js`.
- The Vue workbench builds clean (`vite build`, `vue-tsc`) and was verified live in Chrome: bench plays and evolves seeded pieces, engine hot-swap works mid-phrase, 8-bar WAV export rendered in about 1.4 s while playing, code mode runs its examples.
- Embedded: 43 headers, every one compiling standalone and all of them together in one translation unit, for Cortex-M7 and Cortex-M4. The whole ported engine set is about 34 KB of flash. All five examples build and link as real Teensy 4.1 firmware against the actual Arduino core and Audio Library.
- Parity against the TypeScript passes on 19 audio modules with the PRNG bit exact, plus 317 exactly-compared value rows for the parts that make no sound.

**The one thing that has not happened: none of this has been flashed to a board and listened to.** Everything is compile-verified and numerically verified. That is a strong position and it is not the same as having heard it. Assume the first bring-up finds something.

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
| `npm run parity` | 19 C++ modules match the TypeScript numerically | the `eq.h` three-band-mislabelled-as-port, the `StereoDelay` clamp bug |
| `npm run tables` | euclid, scales, chords, notes, CA, arp, tempo map, MIDI compared EXACTLY | nothing yet, but it is the only thing that can see a wrong scale table |
| `npm run fastmath` | every polynomial in `core/fastmath.h` against libm | `fm::Log2` wrong by 213 cents, inherited by every `Pow` |
| `npm run size` | flash and RAM per sketch, `cortex-m7` or `cortex-m4` | the whole no-registry design argument |
| `./tools/check-header.sh <h>` | one header compiles standalone, `-Wall -Wextra` | header hygiene; note it instantiates nothing |
| `node tools/gen-tables.mjs --check` | generated headers match the TypeScript ParamSpecs | new `Eq6` class the moment it appeared |

Rules learned the hard way about these:

1. **Gates are set from measurement, at roughly ten times the observed drift.** An earlier revision used round numbers that left `saturator` with 25000x headroom, and a deliberate 0.01 percent mutation of the `Svf` integrator passed every gate. If you add a module, measure it first and set the gate from the measurement.
2. **Mutation test a gate before you trust it.** Both harnesses have been shown to fail on a deliberate break and pass on its revert. A gate nobody has watched fail is a gate nobody should trust.
3. **The PRNG row must be exactly zero.** If it is not, nothing below it means anything and the DSP is not the thing to look at.
4. **`check-header.sh` proves less than it looks.** It generates its own `main()` and instantiates nothing, so templates are dead-stripped. To exercise template bodies you need a translation unit that constructs and drives the classes; the size sketches in `test/sketches/` do that.
5. **Sample-wise RMS is the wrong instrument for a time-modulating effect.** The chorus is bit-identical with modulation off, and the modulated row used to drift in proportion to depth. That cause is now fixed (the fixed point phase in Milestone 2 took it from 4e-2 to 2.0e-4), but the principle stands and `chorus_static` is still the row that would actually catch a broken chorus. What remains in the modulated row is the read position, computed in float here and double there.
6. **A gate that only looks at one frequency is not a gate on an oscillator.** `test/dsp-osc/oscillators.test.ts` measured alias rejection at 2637 Hz only, so a kernel cap could cost 39 dB at 7040 Hz and 73 dB at 17 kHz with the whole repository still green. `test/dsp-osc/blep-frequency.test.ts` now sweeps 55 Hz to 19 kHz with per-frequency floors set from measurement.
7. **Alias floors do not gate the filter, only its failure.** They look at what is NOT a harmonic, so a wrong Fourier coefficient, a flipped BLAMP drift sign and any change to `CUTOFF` or `KAISER_BETA` all passed everything. The band-edge test in `blep-frequency.test.ts` measures a low note's harmonics against the ideal saw and pins the half-amplitude point at the cutoff, which catches `CUTOFF` moving by 1.2 percent. If you change the kernel, that is the test that should fail first.
8. **Do not quote wall-clock ns from a microbenchmark as a property of the code.** The same shipping oscillator through two harnesses on one machine gave 22.6 and 59.8 ns per sample at 7040 Hz. Quote the ratio, measure both ends in one process, and prefer a countable quantity: for the BLEP sum that is `2 * KERNEL_HALF * dt` edges, which is exact.

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
12. **The embedded library must never grow a global registry.** Playing one kick through a string-keyed registry of five engines costs 30296 bytes of flash and 30828 of RAM against 3760 and 1100 direct, because a registry names every engine so the linker must keep every engine. `bellows/bank.h` gives runtime index dispatch at byte-identical cost. This is the single load-bearing design rule of that package.
13. `BELLOWS_FAST_MATH=1` swaps libm for polynomials and takes the kick from 3760 to 1448 bytes. It is also the most dangerous flag in the tree, for the reason in the harness table. Run `npm run fastmath` after touching any approximation.
14. On the PlatformIO teensy platform, `board_build.usb_type` is silently ignored: use `-D USB_MIDI_SERIAL` in `build_flags`. The platform also still defaults to `gnu++14` on some releases, so `build_unflags` has to remove it. `examples/platformio.ini` carries both and is verified.

## Recent history worth knowing

- The 2026-08-04 audit is in `docs/AUDIT.md`, findings 1 through 20, each with its evidence. Read it before touching the facade, the fx capacity options, the kernel ramp table, or anything in the embedded port.
- An earlier 22-agent review confirmed and fixed 17 findings (commits `5baef09`, `74e4cbe`). Read those before touching kernel timing, the scheduler, dynamics, spectral, loudness, sf2, or midifile parsing.
- The oscillator antialiasing gate is enforced by spectrum-measuring tests in `test/dsp-osc`. The 4-point polyBLEP was tried and measured insufficient (about -37 dB); the shipping implementation is a tabulated Kaiser-sinc BLEP at about -90 dB. Do not "simplify" it back.
- Bowed string realism history is in `docs/BOWED-STRINGS.md` with measured evidence; the spectral gates in `test/engines-physical/waveguide.test.ts` are the contract. Do not loosen a gate to pass a change.

## The plan

"Completion" here means: the embedded library is published, running on real hardware, and bellows.live can drive a board over a wire. Six milestones, ordered so each one is useful even if the next never happens.

### Milestone 1: hear it

The unvalidated assumption. Everything else is built on the belief that this works.

- Get a Teensy 4.1 and a Rev D audio shield. `examples/platformio.ini` already builds all five examples; flash `01_OneKick` first.
- Confirm: sound, correct pitch, no clicks, no dropouts. Then `02_DrumMachine`, `03_PolySynth`, `04_ScalesAndTuning`, `05_MidiInstrument`.
- Measure real CPU load, which none of the current numbers cover. `AudioProcessorUsageMax()` on Teensy is the cheap way. The interesting number is polyphony at the top of the keyboard, not at A440, for the reason in Milestone 2.
- Then the Daisy path, which has never been built end to end because libDaisy is not an Arduino framework. `bellows/platform/daisy.h` is written and compiles as a no-op off-target; it has never seen the real SDK. Expect this to need work.
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

The theory and sequencing layers are the reason to choose this over DaisySP or Mozzi, and they cost almost nothing: the whole theory layer is 2616 bytes of flash and 116 of RAM. Finishing them is high value per byte.

Not yet ported:
- `seq`: `markov` (needs a fixed-capacity rewrite, the JS keys contexts by `JSON.stringify`), `pattern`, `transport`, `time`
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

- Decide the Arduino Library Manager route: a mirror repository containing only `packages/bellows-embedded`, or a release-zip submission. The Manager indexes repositories, not subdirectories. PlatformIO can consume the subdirectory directly today.
- Tag, release, and add the library to both registries.
- Wire `publint` into CI, which is the one CI gap left.

## Decisions that are open, and that a fresh session should not make alone

1. **Arduino Library Manager route.** Mirror repo versus release zip. Affects how releases work forever.
2. **Whether the C++ or the TypeScript becomes the source of truth long term.** Right now the TypeScript is, and the harnesses enforce it. The alternative (C++ core compiled to WASM for the browser) kills parity drift permanently but costs the tier 3 JavaScript story and a large part of the current test suite's ergonomics. That is a rewrite, not a port. `docs/HARDWARE.md` has the full comparison.
3. **`SetupLog` is exported from the public index** and is an implementation detail. Trimming it (and possibly `VoicePool`) would keep the public surface honest, but it is a breaking change once released.
4. **Whether `Eq3` stays.** It is a deliberate non-port that exists for size. It is currently marked `UNPORTED_BY_DESIGN` in the codegen so it does not pollute the orphan report. Fine, but it is a precedent: every non-port needs that treatment or the report becomes noise.

## Still open from the audit

Full detail in `docs/AUDIT.md`. The short list:

- `SamplerBank.zonesFor` allocates at note-on rate on the audio thread. Survivable in a browser, blocking for the sampler's port.
- Kernel event insertion is O(n) per event, so a 50000 event MIDI import would stall.
- `createBus`, `registerBank`, `registerGrain` and `defOp` are not collapsed in the setup log, so an app creating a bus per reforge still grows.
- Param ramps advance at block granularity; one shorter than a block lands immediately.
- `quick.ts` never resets its shared boot promise, so a failed boot rejects every subsequent `play()`.
- There is no `removeBus`.
- `engines/soundfont.ts` imports types from `io/`, the one place the layering rule is bent. Type-only, so it costs nothing at runtime.

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
3. `npm run build -w packages/bellows`; check `dist/worklet.js` exists and the standalone size is sane (about 97 KB gzip at 0.1.0).
4. Bump version, `npm publish` from `packages/bellows`, tag `vX.Y.Z`, push with the tag.
5. Regenerate the LLM reference: `node apps/workbench/scripts/gen-llm-ref.mjs`, commit `apps/workbench/public/llm.txt`.
6. Redeploy the site (pushes do not auto-deploy): `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d`.
7. No Claude attribution in commits, no emojis, no em dashes, per `CLAUDE.md`.

For a change that touches DSP shared with the embedded port, add before step 4, from `packages/bellows-embedded`:

- `npm run parity` and confirm every gate passes. The PRNG row must be exactly zero.
- `npm run tables` for anything touching theory or sequencing.
- `npm run fastmath` if you touched `core/fastmath.h`.
- `npm run size` and sanity check against `docs/HARDWARE.md`.
- `node tools/gen-tables.mjs` if any `ParamSpec` changed, which is how a param added in TypeScript and forgotten in C++ becomes visible.
