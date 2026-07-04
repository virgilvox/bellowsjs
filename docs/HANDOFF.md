# HANDOFF

State of the project as of 2026-07-04, after the 0.1.1 release and the instrument update. Read this first when picking the work back up. Companions: `docs/PRD.md` (what and why), `docs/ENGINEERING.md` (platform facts, DSP formulas, packaging research), `CLAUDE.md` (house rules), `docs/prototype-0.html` (the original design probe).

## Where things stand

- `bellowsjs@0.1.0` is published on npm (0.0.1 was a name claim). Tag `v0.1.0` pushed to github.com/virgilvox/bellowsjs, main is current.
- Library test suite: 76 files, 1017 tests, all passing in plain Node, including golden-render regression (`test/golden`, regenerate with `GOLDEN_UPDATE=1` only alongside an intentional DSP change).
- `tsc --noEmit` clean. Build: `npm run build -w packages/bellows` runs worklet generation, vite (ESM + standalone IIFE), declaration emit, and writes `dist/worklet.js`.
- The Vue workbench builds clean (`vite build`, `vue-tsc`) and was verified live in Chrome: bench plays and evolves seeded pieces, engine hot-swap works mid-phrase, 8-bar WAV export rendered in about 1.4 s while playing, code mode runs its examples (hello-note, cellular automata drums, pitch tracker all exercised end to end).

## Layout

- `packages/bellows` is the library. Dependency direction, enforced by review not tooling: `types` and `core` at the bottom, then `dsp`, then `engines`/`fx`/`analysis`, then `kernel`/`io`/`render`, then the `bellows.ts` facade. `theory` and `seq` are audio-free.
- `apps/workbench` is the demo app. `src/lib/audio.ts` owns the single Bellows instance (one AudioContext kept for the page's life, reused across reboots). `src/lib/composer.ts` is the generative brain, `src/examples/` the code-mode registry (one file per category, `index.ts` aggregates).
- Everything the kernel can host is registered in `src/core/register.ts`. New engines and effects must be added there and the worklet regenerated, or they exist on the main thread only.

## Things that are not obvious from the code

1. The worklet ships as a checked-in generated string: `scripts/gen-worklet.mjs` (esbuild) writes `src/kernel/worklet-code.gen.ts`, `scripts/postbuild.mjs` extracts `dist/worklet.js` for CSP-strict hosts. After ANY change under `src/kernel`, `src/engines`, `src/fx`, `src/dsp`, or `src/core`, rerun `npm run gen:worklet -w packages/bellows` or realtime playback keeps executing the stale bundle while offline render uses the new code.
2. The kernel clock is locked to context time by `engine.setFrame(currentFrame)` at the top of every worklet `process()`. Events are stamped with `ctx.currentTime` on the main thread. Do not remove or reorder this; it was the critical finding of the review (silent output on reused contexts).
3. Offline render fidelity rests on three invariants: structural messages are recorded verbatim in `Bellows.setup`; transport history is recorded as ops (`bpm`, `ramp` with its anchor bpm, `swing`) and replayed onto a fresh Transport; untimed calls inside clock callbacks resolve to `renderCtx.now` during replay. If you add a facade method with side effects, decide explicitly how it records and replays.
4. Determinism contract: all randomness flows through `NamedRng` forks (`src/core/prng.ts`). `b.rng(label)` returns per-context streams; render() uses a fresh cache so a render equals a fresh page load of the same seed. Generators created outside callbacks and reused across live and render will diverge; the examples create theirs via `b.rng` for this reason.
5. The scheduler (`src/core/scheduler.ts`) stretches its lookahead to the observed timer cadence and reaches back up to the observed gap, which is what survives background-tab throttling. `Bellows.pause()/resume()` rely on `Scheduler.resyncTo`.
6. `defEngine`/`defEffect` serialize defs with `serializeDef` (functions via toString, rehydrated with `new Function` in the worklet). Defs must be self-contained: no imports, no captured closures. CSP that blocks eval breaks tier 3 in realtime; offline still works.
7. Voices ADD into `(outL, outR, from, to)`; effects process IN PLACE; nothing allocates on the audio path at steady state. The review's allocation audit and the oversampler view cache exist because of this rule.

## Recent history worth knowing

- A 22-agent review confirmed and fixed 17 findings (commits `5baef09`, `74e4cbe`). The fixes carry regression tests; read those two commits before touching kernel timing, the scheduler, dynamics, spectral, loudness, sf2, or midifile parsing.
- The oscillator antialiasing gate is enforced by spectrum-measuring tests in `test/dsp-osc`. The 4-point polyBLEP was tried and measured insufficient (about -37 dB); the shipping implementation is a tabulated Kaiser-sinc BLEP at about -90 dB. Do not "simplify" it back.

## Known gaps and next steps

Phase 2 targets from `docs/PRD.md` section 6, roughly in value order:

1. Claim the `@bellows` npm org (web UI only; still unclaimed as of the release).
2. Microphone/MediaStream input into the kernel (the worklet already receives an input bus; nothing consumes it).
3. SFZ opcode breadth (filters, lfos, crossfade curves) and an SF2 modulator (pmod/imod) pass; parsing exists, interpretation is generator-only.
4. MIDI clock and MTC sync; MIDI file playback helper wiring `toScore` into the transport.
5. Spatial pack: HRTF binaural, ambisonics, VBAP.
6. WAM 2.0 hosting and export wrappers; CLASP transport pack.
7. Rust WASM SIMD twins for the hot ops (research brief says simd128 baseline, relaxed SIMD dual-binary; TS implementations stay the oracle).
8. Neural pack over the harmonic engine (onnxruntime-web, frame-driven `setControlFrame` already exposed).
9. Docs site: the workbench code mode is the seed; a static docs-as-instruments site is the PRD's end state.
10. CI: golden renders and the suite run locally; there is no GitHub Actions workflow yet. Add node 22 matrix, `npm test`, `typecheck`, both app builds, publint.

## Deployment (bellows.live)

The site is a DigitalOcean App Platform static site, the cheapest App Platform footprint (no services or workers; $0 while a free static-site slot is open on the account, otherwise $3 per month).

- App id `88dc2901-3334-47d9-9cb5-8b2f1105294d`, name `bellows-live`, default ingress `bellows-live-ivsci.ondigitalocean.app`, custom domains `bellows.live` (primary) and `www.bellows.live` on the DO-managed zone.
- Spec lives at `.do/app.yaml`. It pulls the PUBLIC git repo directly (`git.repo_clone_url`), so there is no GitHub integration and no deploy-on-push: pushing to main does NOT redeploy. To ship site changes: push to main, then `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d`.
- Spec changes: edit `.do/app.yaml`, then `doctl apps update 88dc2901-3334-47d9-9cb5-8b2f1105294d --spec .do/app.yaml`.
- The build runs `npm install && npm run build -w apps/workbench` against the monorepo, so the site always ships the library source at that commit, which is also what `npm install bellowsjs` serves as long as releases stay in step.
- The app shell: light theme is default (`:root` tokens in `apps/workbench/src/styles/forge.css`), dark under `data-theme='dark'`, toggled via `src/lib/theme.ts` (localStorage `bellows-theme`). Canvas drawing and CodeMirror read theme through that module; never hardcode palette hex in components.

## The site, second wave

- Landing page (default route) is plain-language with a copy-paste HTML CDN example; the dense material lives in a collapsed details block. Light theme is default; night behind the header toggle.
- INSTRUMENT page (#play): piano keyboard (mouse, multi-touch, computer keys A..L with Z/X octave, C/V velocity, SPACE sustain), Web MIDI with cc64 sustain, every engine plus activated soundfont presets, auto-generated param editors from ParamSpec metadata, an fx rack, and the looper.
- The looper (src/lib/looper-store.ts) owns a PRIVATE Transport and Scheduler ticked by its own interval so the workbench transport is never touched. Loop-pedal flow: REC boots the whole instrument, arms, 4-beat count-in, records one loop, auto-plays as a layer. Count-in notes snap to the loop top; an empty pass keeps rolling with a status line instead of discarding. Layers list: mute lamps, step grids, delete; each take snapshots engine and params.
- Workbench SOUNDFONT + SAMPLES panel (04b): multiple .sf2 banks (parse is main-thread, about 10 ms for a 6 MB GM bank), preset activation as engines under a SAMPLES optgroup on every melodic strip, user sample kits with yin-detected root keys, polyphone.io link.
- LLM REF (#ref, footer link, raw at /llm.txt): generated by apps/workbench/scripts/gen-llm-ref.mjs from the BUILT library (engine and effect tables from the live registry, contracts embedded from dist .d.ts). Regenerate after any library change AND version bump, before deploying.
- SEO: full meta and OG set in index.html (og image public/og.png regenerated via headless Chrome from the scratch card if the branding changes), robots.txt, sitemap.xml, favicon.svg, JSON-LD, noscript block.

## Seam rules learned the hard way

- Anything stored in Vue reactive() state that crosses postMessage or owns internal slots must be markRaw: SoundFont instances (their DataViews die on proxy receivers) and every Float32Array destined for the kernel (proxied typed arrays fail structured clone). See src/lib/soundfonts.ts.
- AudioContext.resume() without user activation never settles; Bellows.boot races it with a 300 ms timeout (library fix in 0.1.1). Never await a bare resume.

## Release ritual

1. `npm test` and `npx tsc --noEmit` in `packages/bellows`.
2. `npm run gen:worklet -w packages/bellows` if anything kernel-reachable changed.
3. `npm run build -w packages/bellows`; check `dist/worklet.js` exists and the standalone size is sane (about 97 KB gzip at 0.1.0).
4. Bump version, `npm publish` from `packages/bellows`, tag `vX.Y.Z`, push with the tag.
5. Regenerate the LLM reference: `node apps/workbench/scripts/gen-llm-ref.mjs` (reads the fresh dist), commit `apps/workbench/public/llm.txt`.
6. Redeploy the site (pushes do not auto-deploy): `doctl apps create-deployment 88dc2901-3334-47d9-9cb5-8b2f1105294d`.
7. No Claude attribution in commits, no emojis, no em dashes, per `CLAUDE.md`.
