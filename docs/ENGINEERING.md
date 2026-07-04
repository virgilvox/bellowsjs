# BELLOWS Engineering Brief

Synthesis of platform, DSP, API, and packaging research (2026-07). This document drives implementation of `bellowsjs`.

---

## 1. Platform facts and fallbacks

### AudioWorklet (core render path)
- Baseline: Chrome 66+, Firefox 76+, Safari 14.1+. Secure context required. Safe to require unconditionally.
- **Processor delivery:** ship the processor as a compiled, self-contained string constant; load via `URL.createObjectURL(new Blob([code], {type:'application/javascript'}))` → `audioWorklet.addModule(blobUrl)`. Works in Chrome/Firefox/Safari. Blob-URL modules cannot use relative `import`: the processor entry must be fully bundled at build time. Also export the raw processor file for CSP-strict consumers (strict `script-src` without `blob:` blocks the blob path); accept a user-supplied URL as an override.
- **`process()` discipline:** fixed 128-frame quanta; zero allocation (pre-allocate all Float32Arrays in constructor: GC is the #1 jitter source), no locks, no `await`, no `console.log` (broken in Safari's AudioWorkletGlobalScope, WebKit bug 220039: debug via postMessage).
- **Data transport tiers:**
  - Control-rate (params, note events, "times per second"): MessagePort/postMessage: fine.
  - One-shot bulk (sample buffers, compiled `WebAssembly.Module`: structured-cloneable): postMessage transfer.
  - Continuous streaming (worker→worklet audio): wait-free SPSC ring buffer over SharedArrayBuffer + Atomics (ringbuf.js pattern); keep ring ~half-full as jitter margin against ~50ms main-thread stalls.
- **SAB gate:** requires `crossOriginIsolated` (COOP `same-origin` + COEP `require-corp`). COEP `credentialless` is Chromium-only: **Safari has said it won't implement it**; so cross-browser SAB means `require-corp` and every cross-origin subresource needs CORP/CORS. **The engine must have a first-class postMessage fallback path when `crossOriginIsolated === false`**: SAB is an optimization, never a requirement. Document `coi-serviceworker` for static hosting.

### Safari/iOS quirks (must handle)
- iOS pins AudioContext near 44100 Hz; constructing with `{sampleRate: 48000}` can cause stutter/hidden-resampler gaps. Construct at the context's default rate and resample internally.
- User gesture required to start/resume; handle the `"interrupted"` state (calls, backgrounding). Sample rate can *change* after an interruption (e.g. Bluetooth HFP): listen for `statechange`, compare `context.sampleRate`, and rebuild the graph if it shifted.
- getUserMedia active → output forced to speaker; nothing we can do, document it.
- Use `standardized-audio-context` as the reference for remaining WebKit deviations (not necessarily as a dependency).

### Encode/export (feature-detected paths)
- WebCodecs `AudioEncoder`: Chrome 94+, Firefox 130+ desktop only (no Firefox Android), **Safari 26+ only** (16.4–18.7 had video-only WebCodecs).
- Encodable codecs: **Opus everywhere AudioEncoder exists**: the default export codec. AAC (`mp4a.40.2`): Chrome (not desktop Linux) + Safari 26+, **never Firefox**. FLAC/MP3/Vorbis: **decode-only everywhere**: ship optional WASM encoders (libflac/lame) for lossless/MP3 export.
- Always `await AudioEncoder.isConfigSupported(config)` per codec: not just class detection. Run encoding in a Dedicated Worker; use `encodeQueueSize`/`dequeue` for backpressure; keep `decoderConfig.description` from output metadata for muxing (Opus-in-WebM/MP4).
- Universal fallback: offline render → WAV writer (pure JS, always works).

### Output routing
- `AudioContext.setSinkId()`: **Chromium-only** (110+). Firefox through 155: only `HTMLMediaElement.setSinkId`: route via `MediaStreamAudioDestinationNode` → `<audio>` element. Safari: nothing. API design: `bellows.setOutputDevice(id)` feature-detects and degrades to the media-element bridge, else throws a typed `Unsupported` error. Chromium bonus: `setSinkId({type:'none'})` for silent rendering.

### Offline rendering
- One `OfflineAudioContext` per render (`startRendering` is one-shot). Whole output buffer allocated up front (~23 MB/min stereo 48k): chunk long exports or warn.
- Chunked/incremental rendering = `suspend(time)` (quantizes to 128-frame boundaries, must be scheduled **before** playback reaches that time; rejects with InvalidStateError otherwise) + resume. Ordering is racy across engines: wrap it in a tested helper, never expose raw.
- `audioWorklet.addModule` must complete before node construction. Worklet code must not assume wall-clock time (offline renders faster than realtime). On Safari, construct with explicit `{length, sampleRate}` matching target to avoid historical pitch/duration drift.

### WASM
- **simd128 (fixed 128-bit): universal (Chrome 91+/Firefox 89+/Safari 16.4+): require it as the baseline.**
- **Relaxed SIMD (FMA etc.): Chrome 114+, Firefox 146+, Safari NOT shipped (flag only).** Runtime-detect with `wasm-feature-detect`; ship two binaries (simd128 baseline + relaxed fast path). Never gate features on relaxed SIMD.
- **Language: Rust** (`no_std`, preallocated static buffers, `std::arch::wasm32` intrinsics + stable relaxed-SIMD intrinsics; wasm-bindgen/wasm-pack). AssemblyScript trails Rust in idiomatic performance and its GC runtime is a liability in the zero-alloc path. WasmGC is irrelevant to linear-memory DSP. Expected payoff ~10–15× over JS on SIMD-friendly kernels.
- Instantiate WASM inside the worklet by postMessaging the compiled `WebAssembly.Module` from the main thread.

### MIDI
- Web MIDI: Chromium + Firefox 108+; **Safari: zero support, no roadmap** (~78% global). Chrome ≥124 gates *all* `requestMIDIAccess()` behind a permission prompt: request from a user gesture, handle denial. Test hot-plug (`statechange`) explicitly on Firefox.
- MPE is plain MIDI 1.0 (per-note channels 2–16, per-channel bend/CC74/pressure): implement zone config (RPN 6) + per-note channel allocation in the engine; works wherever Web MIDI works, i.e. never on Safari/iOS. MIDI 2.0/UMP: not exposed anywhere; ignore.
- Ship MIDI as a separate entry point (`bellowsjs/midi`) marked Chromium/Firefox-only.

### Capability matrix summary
Chromium is the only full-stack engine (AAC encode, setSinkId, relaxed SIMD, Web MIDI, credentialless). The engine's non-negotiable fallback set: Opus-native + WASM encoders; postMessage when not crossOriginIsolated; media-element output routing; MIDI optional; iOS sample-rate/interruption resilience.

---

## 2. DSP algorithm choices (formulas and constants to implement)

### 2.1 Oscillators: polyBLEP/polyBLAMP
Default: **2-point polyBLEP** for saw/square (adequate to ~fs/8–fs/6 fundamentals); **4-point** (integrated cubic B-spline, Nam/Välimäki/Smith/Abel Table VII) as a quality tier for high fundamentals / no oversampling.

2-point residual (`dt = f0/fs`):
- after step, `t = phase/dt ∈ [0,1)`: `r = 2t − t² − 1`
- before step, `t = (phase−1)/dt ∈ (−1,0)`: `r = t² + 2t + 1`
- `saw = naive_saw − r`; square/pulse = two opposite-sign BLEPs.

4-point residual, applied to samples n−1…n+2, `t ∈ [0,1)`:
```
J0 = −t⁴/24 + t³/6 − t²/4 + t/6 − 1/24
J1 =  t⁴/8  − t³/3           + 2t/3 − 1/2
J2 = −t⁴/8  + t³/6 + t²/4 + t/6 + 1/24
J3 =  t⁴/24
```

Triangle/clipper corners: **2-point polyBLAMP** (`μ` = slope change in amp/sample; triangle: `μ = ±8·A·f0/fs`):
`y[n] += μ(1−d)³/6; y[n+1] += μd³/6`. 4-point quintic BLAMP (Esqueda/Välimäki/Bilbao Table 1) reserved for high-fundamental triangles and antialiased clippers:
```
y[n−1] += μ(−d⁵/120 + d⁴/24 − d³/12 + d²/12 − d/24 + 1/120)
y[n]   += μ( d⁵/40  − d⁴/12          + d²/3  − d/2  + 7/30)
y[n+1] += μ(−d⁵/40  + d⁴/24 + d³/12 + d²/12 + d/24 + 1/120)
y[n+2] += μ( d⁵/120)
```

### 2.2 Filter: Cytomic trapezoidal SVF (default multimode filter)
Stable under audio-rate modulation; recompute coefficients per-sample freely.
```
g = tan(π·fc/fs);  k = 1/Q
a1 = 1/(1 + g(g+k));  a2 = g·a1;  a3 = g·a2
// tick (states ic1eq, ic2eq = 0):
v3 = v0 − ic2eq
v1 = a1·ic1eq + a2·v3
v2 = ic2eq + a2·ic1eq + a3·v3
ic1eq = 2v1 − ic1eq;  ic2eq = 2v2 − ic2eq
// outputs:
low = v2; band = v1; high = v0 − k·v1 − v2
notch = v0 − k·v1; peak = 2v2 − v0 + k·v1; all = v0 − 2k·v1
```
EQ variants (A = 10^(dB/40)): bell `k = 1/(Q·A)`, out `v0 + k(A²−1)v1`; low-shelf `g = tan(πfc/fs)/√A`; high-shelf `g = tan(πfc/fs)·√A`.

### 2.3 Ladder filter: two tiers
**Character tier: Huovilainen** (2× oversampled, tanh per stage):
`y_k[n] = y_k[n−1] + 2·V_T·g·(tanh(x_k/(2V_T)) − tanh(y_k[n−1]/(2V_T)))`, V_T ≈ 25.85 mV; half-sample delay (avg of last two stage-4 outputs) in feedback. Tuning polys (fc = f0/fs):
```
fcr = 1.8730fc³ + 0.4955fc² − 0.6490fc + 0.9988
acr = −3.9364fc² + 1.8409fc + 0.9968
tune = (1 − exp(−2π·f·fcr))/thermal;  feedback = 4·res·acr
```
Cheap variant: single tanh in feedback path only.

**Efficient tier: Zavalishin ZDF ladder:** per stage `g = tan(πfc/fs)`, `G = g/(1+g)`, tick `v = (u−s)G; y = v+s; s = y+v`. Feedback solved algebraically:
```
S = (G³s1 + G²s2 + G·s3 + s4)/(1+g)
u = (x − k·S)/(1 + k·G⁴)      // k = 4·res; self-osc at k=4
```
Optional input gain `(1 + α·k)` for bass-loss compensation. Nonlinear: tanh on previous-sample states (cheap) or 1–2 Newton iterations.

### 2.4 Reverb: FDN (algorithmic) + Dattorro plate (preset character)
**FDN:** N = 8 default (N = 16 "lush" tier). Feedback matrix: **Householder** `out_i = in_i − (2/N)Σin_j` (O(N)) in the loop; **Hadamard** (fast Walsh–Hadamard butterfly) in 2–4 series input-diffuser stages (short delays + random polarity flips, Signalsmith style). Delay lengths mutually prime, exponentially spread over 30–100 ms (e.g. @48k: 1447, 1913, 2477, 3089, 3559, 4127, 4691, 5233). Decay: `g_i = 10^(−3·M_i/(fs·T60))`; frequency-dependent decay via one-pole LPF *inside* each feedback path (Jot): `g_i(1−a_i)/(1−a_i z⁻¹)`: DC gain sets low T60, pole sets HF T60. Tone EQ outside the loop.

**Dattorro plate** (all lengths × fs/29761): input LPF coeff 0.9995; input allpasses 142/107/379/277 @ 0.75/0.75/0.625/0.625. Tank: branch A = mod-AP 672 (dd1 = 0.70) → delay 4453 → damp LPF → ×decay → AP 1800 (dd2 = 0.50) → delay 3720 → ×decay → into B; branch B mirrors with 908/4217/2656/3163. dd2 = clamp(decay + 0.15, 0.25, 0.50); decay ≈ 0.5 typical. Modulate APs 672/908 with ~1 Hz LFO, excursion 8–16 samples. Output taps ×0.6 per Dattorro Table 2 (left: 4217[266], 4217[2974], −2656[1913], 3163[1996], −4453[1990], −1800[187], −3720[1066]; right mirrored: 353/3627/1228/2673/2111/335/121).

### 2.5 Analysis: pitch and onsets
**YIN:** CMNDF `d'(τ) = d(τ)·τ/Σ_{j≤τ}d(j)`, `d'(0)=1`; threshold **0.10–0.15**; first local minimum below threshold else global min; parabolic interpolation over (τ−1,τ,τ+1); unvoiced if dip > ~0.3–0.5. Window 1024–2048 @ 44.1k, hop W/2–W/4.
**MPM (default for monophonic realtime):** NSDF via FFT autocorrelation; key maxima between positive-going zero crossings; pick first key max ≥ **0.93**·n_max; clarity = peak value, voiced when > ~0.8–0.9. Window 2048, hop 256–1024.
**Onsets: spectral flux:** L1 half-wave-rectified magnitude difference with log compression `log(1+γ|X|)`, γ ≈ 1–20; 2048-sample Hann window @ 44.1k, **hop 441 (10 ms)**. Peak picking (Dixon): local max over ±3 frames AND ≥ mean(SF[n−9…n+3]) + δ AND ≥ 30–50 ms since last onset. Optional adaptive threshold `δ + median(SF[n−M…n+M])`, M ≈ 5–10; SuperFlux ±1–2-bin frequency max-filter for vibrato robustness.

### 2.6 Loudness: EBU R128 / BS.1770
K-weighting = 2 biquads **specified at 48 kHz**:
```
shelf: b=[1.53512485958697, −2.69169618940638, 1.19839281085285]
       a=[1, −1.69065929318241, 0.73248077421585]
hp:    b=[1, −2, 1]
       a=[1, −1.99004745483398, 0.99007225036621]
```
**Other rates: redesign from prototypes, never reuse**: shelf f0 = 1681.9744509555319 Hz, gain = +3.999843853973347 dB, Q = 0.7071752369554196; HP f0 = 38.13547087602444 Hz, Q = 0.5003270373238773 (bilinear/RBJ at target fs).
Block loudness `L = −0.691 + 10·log10(Σ G_i·z_i)`, G = 1.0 (L/R/C), 1.41 (Ls/Rs), LFE excluded. Integrated: 400 ms blocks, 75% overlap; absolute gate −70 LKFS; relative gate Γ − 10 LU. Momentary = 400 ms, short-term = 3 s; LRA = 95th − 10th percentile of short-term with −70 abs / −20 LU relative gates. True peak: ≥4× oversampling, target ≤ −1 dBTP; R128 program target −23 LUFS.

### 2.7 Time stretch: phase vocoder with identity phase locking
Hann STFT, N = 2048 (4096 for low-pitched/polyphonic), analysis hop Ha = N/4; synthesis hop Hs = α·Ha, keep Hs ≤ N/4 for Hann² COLA. Per-bin propagation: `Δ = princarg(φa(u,k) − φa(u−1,k) − Ωk·Ha)`; `ω̂ = Ωk + Δ/Ha`; `φs(u,k) = φs(u−1,k) + Hs·ω̂`. **Identity phase locking:** detect peaks (magnitude > 2 neighbors each side), regions bounded at midpoints; propagate phase only at peaks, lock regions via one complex multiply per bin by `e^{j(φs(kp) − φa(kp))}`. Reset φs := φa at detected transients (reuse the onset detector). Pitch shift = stretch + resample. Scaled locking (β ≈ α, peak tracking across frames) as an optional quality tier.

---

## 3. API design decisions

### Borrow
1. **Polymorphic musical time everywhere** (Tone): `"4n"`, `"8t"`, `"8n."`, `"2m"`, `"1:2:0"` bars:beats:sixteenths, `"192i"` ticks, `"5hz"`, plain numbers = seconds, `"+1m"` relative, `"@1m"` quantized. One parser, used by every scheduling/duration argument.
2. **Voice verb set** (Tone): `triggerAttack(note, time?, vel?)`, `triggerRelease(time?)`, `triggerAttackRelease(note, dur, time?, vel?)`; notes as Hz or `"D#2"`. Poly = wrapper over any mono voice with automatic allocation; release accepts note arrays.
3. **Same code online/offline** (Tone `Offline` + Elementary renderer split): `render(callback, duration, {channels, sampleRate}) => AudioBuffer` running an offline transport; architecturally, a **pure core package with swappable realtime/offline renderers** (Elementary core/renderer, SpessaSynth core/lib precedent).
4. **Patterns as pure functions of cycle time** (Strudel): mini-notation strings embedded in ordinary calls (`seq`, `cat`, `stack`, weights `@`, subdivision `[a b]`, alternation `<a b>`, `*`/`/`, rests `~`, euclid `bd(3,8,0)`, `?` drop, `|` choice); chainable combinators whose **arguments are themselves patterns** (`.ply("<1 2 3>")`); the probability ladder `sometimes/often/rarely/almostAlways/almostNever/degradeBy(p)`; `every/when/off/jux/iter/rev/euclid`.
5. **Theory: depend on tonal** (`@tonaljs/*`) rather than reinvent: stateless namespaced pure functions (`Scale.get`, `Note.transpose`). Match its string-in/object-out style in our own helpers.
6. If any graph diffing is offered (Elementary-style re-render), **make node identity automatic** (structural/positional keys generated by the library), never user-supplied string keys.
7. Docs playground: example registry + inline CodeMirror-editable source per doc page + single play/stop toggle + error console + small scope canvas (Flocking template, Strudel refinement).

### Avoid (design inversions)
- **No manual `.dispose()` and no per-note WebAudio-node allocation.** Voices live in a pre-allocated pool inside the worklet; the GC-free hot path is the core value proposition (Glicol's exact pitch against Tone).
- **Scheduler lives in the worklet/worker, not on a JS main-thread clock.** No user-visible `lookAhead`/`latencyHint` tuning, no `"+0.1"` fudge idiom. Events are timestamped and delivered to the audio thread ahead of time invisibly.
- **Kill the `time`-argument footgun:** scheduled callbacks should not require users to manually forward a `time` param into triggers; bind the scheduled time into the event context automatically, so forgetting cannot silently degrade timing.
- **First-class visual event bus** (rAF-synced tap of scheduled events with audio-time→performance-time mapping) instead of a bolt-on `Draw.schedule`.
- **No multi-megabyte monolith.** Subpath entry points, tree-shakeable named exports; heavy optional pieces (WASM encoders, MIDI, analysis) are separate entries.
- `context.resume()` tied to a documented one-call gesture helper (`Bellows.start()`), with iOS interruption/samplerate-change handling built in: users never hand-roll it.

---

## 4. Packaging plan

### Name verdict
- **`bellowsjs`: AVAILABLE on npm (registry 404 confirmed): publish under this name.**
- `bellows`: taken (abandoned 2017 jQuery accordion); don't count on a dispute.
- `@bellows/core`: package name free, but requires owning the `bellows` npm org: **claim the org immediately anyway** as a defensive move / future monorepo escape hatch, before announcing.

### package.json / build
```json
{
  "name": "bellowsjs",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "exports": {
    ".":        { "types": "./dist/index.d.ts",    "import": "./dist/index.js",    "default": "./dist/index.js" },
    "./midi":   { "types": "./dist/midi.d.ts",     "import": "./dist/midi.js" },
    "./analysis": { "types": "./dist/analysis.d.ts","import": "./dist/analysis.js" },
    "./encode": { "types": "./dist/encode.d.ts",   "import": "./dist/encode.js" },
    "./worklet.js": "./dist/worklet.js"
  },
  "unpkg": "./dist/bellows.min.js",
  "jsdelivr": "./dist/bellows.min.js"
}
```
- ESM-only primary (no CJS for a browser-first 2026 lib); minified **IIFE** (not UMD) global build for CDN via the `unpkg`/`jsdelivr` fields.
- Named exports only; `"types"` first in each condition block; validate with **publint + @arethetypeswrong/cli** in CI.
- Build with tsup or tsdown/rolldown: ESM entries + IIFE + the worklet processor as its own self-contained entry.
- `"sideEffects": false` only if truly true: no module-top-level registration; audit before setting.

### Worklet inlining
- Compile the processor as a **separate self-contained build entry**, embed the built text as a string constant in the main bundle (works in every consumer bundler, zero config), load via blob URL.
- Also publish the built processor at `bellowsjs/worklet.js` for CSP-strict environments; the addModule wrapper accepts an optional URL override.
- Never let bundler helpers/`import.meta` leak into the stringified processor (hence the separate build entry, not runtime `Function.toString`).
- Docs must cover Vite: `worker: { format: 'es' }`, and `?url`/`?raw` suffixes, since Vite's IIFE worker default breaks worklets. WASM destined for the worklet: send compiled `WebAssembly.Module` via postMessage rather than base64-inlining where possible.

### Testing
- Pure DSP kernels (Float32Array in/out): plain vitest, `environment: 'node'`, no mocks needed. This is the argument for keeping DSP context-free.
- Web Audio integration: `node-web-audio-api` (IRCAM v2, Rust-backed) with `new AudioContext({ sinkId: { type: 'none' } })` for headless CI; use `copyToChannel/copyFromChannel`, not `getChannelData`. **Verify its AudioWorkletNode support at current version before relying on it** (open risk below). `standardized-audio-context-mock` for unit-level graph wiring.
- **Golden-file regression** (Tone's `CompareToFile` pattern): deterministic offline renders → stored golden WAV/Float32 binaries → compare via spectral/RMS distance with tolerance (default ~0.001), never exact float equality (cross-platform FP drift); `forceRender` flag to regenerate. Snapshot summary stats (peak/RMS/zero-crossings) via a custom vitest serializer for cheap smoke tests.

### License
- **Apache-2.0.** Ecosystem norm is permissive (Tone/howler MIT); Apache adds an explicit patent grant + retaliation clause: directly relevant to a DSP-algorithm library: and avoids the enterprise-legal friction any copyleft (even MPL's file-level) triggers in dependency audits. MPL-2.0 only if forcing DSP improvements upstream outweighs adoption; it doesn't here. Verify SpessaSynth is Apache-2.0 at the exact version pinned if adopted for SoundFont playback.

---

## 5. Open risks

1. **SAB dual-path complexity.** Maintaining both SharedArrayBuffer and postMessage transports doubles the streaming-transport test matrix; the postMessage path has genuinely worse worst-case latency and must still be glitch-acceptable. Mitigate: design the ring-buffer abstraction so both transports sit behind one interface; CI-test both.
2. **`node-web-audio-api` worklet fidelity.** The whole CI strategy for worklet-hosted DSP leans on IRCAM's Node implementation supporting AudioWorkletNode faithfully; older versions didn't. Must be verified empirically at project start; fallback is browser-based CI (Playwright) for worklet tests, which is slower and flakier.
3. **iOS sample-rate instability.** Rebuilding the engine on `statechange` sample-rate shifts (Bluetooth HFP) means all internal state (delays, phase, tuning tables) must be re-derivable at a new fs on the fly: an architectural requirement, easy to violate accidentally with baked-in 48k constants (e.g. K-weighting tables, Dattorro lengths).
4. **Encoder matrix churn.** AAC on Chrome/Linux absent, Firefox never; Safari 26 adoption curve unknown; WASM FLAC/MP3 encoders add binary weight. Keep all encode behind `isConfigSupported`-style capability probes and a lazy-loaded subpath.
5. **Relaxed SIMD dual-binary maintenance** (Safari still hasn't shipped): two WASM artifacts per kernel set; risk of the fast path silently rotting if CI only runs baseline. Run golden-file tests against both binaries.
6. **Pattern-DSL scope creep.** Strudel's combinator surface is enormous; committing to mini-notation implies a parser, a pure-FRP pattern engine, and long-tail compatibility expectations. Ship a deliberately small v1 subset (seq/cat/stack, subdivision, alternation, euclid, rests, probability ladder, every/off/jux) and state non-goals.
7. **npm org squatting.** `@bellows` scope availability was not confirmable via registry API: if someone owns the org, scoped-package plans die; unscoped `bellowsjs` is safe regardless. Claim the org day one.
8. **Blob-URL CSP failures in the wild** (strict `script-src`) will be the top support issue for zero-config worklet loading; the URL-override escape hatch and a loud, specific error message are required at launch, not later.
9. **Dattorro/Huovilainen constants provenance.** Several constants (output-tap tables, tuning polynomials) are transcribed from papers/implementations; a transcription error is inaudible in unit tests but audible in product. Validate against reference implementations (ddiakopoulos/MoogLadders, Couka's Dattorro) with golden renders during bring-up.
