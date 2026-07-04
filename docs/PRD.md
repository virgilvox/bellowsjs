# BELLOWS

A browser-native audio engine for synthesis, samples, sequencing, analysis, and I/O.

| | |
|---|---|
| Status | v0.2, refined after platform and DSP research |
| Author | Moheeb Zara (virgilvox) |
| Date | 2026-07-03 |
| Package | `bellowsjs` (confirmed available on npm) |
| License | Apache-2.0 |
| Stewardship | OSSuary Foundation (planned) |
| Companion | `docs/ENGINEERING.md` (research brief with formulas and platform facts) |

## 1. Summary

BELLOWS treats the browser as a serious instrument. One clock, one DSP kernel, and a layered API that goes from `play('pluck', 'C4')` up through a full workbench API down to raw sample-loop DSP ops. It ships synthesis engines across the whole field (virtual analog, FM, additive, wavetable, granular, physical modeling, west coast, formant, drum synthesis, harmonic-plus-noise), a soundfont core (SF2, SFZ), a music layer with real theory and arbitrary tuning, generative sequencing primitives (Euclidean, Markov, L-systems, cellular automata), time-domain and spectral effects, analysis (pitch, onset, chroma, key, loudness to EBU R128), and I/O covering MIDI, MPE, offline render, and encoded export. Every random decision is seedable and reproducible.

The name: a bellows is the air mover of the forge. Every forge needs one.

## 2. Architecture decisions (resolved)

The original draft left several questions open. Research resolved them:

1. Pure TypeScript DSP core, context-free. Every oscillator, filter, engine, and effect is a plain class taking sampleRate at construction and processing Float32Array index ranges. This single decision buys three things: the whole DSP layer tests in Node under vitest with no mocks, offline rendering is a plain loop that produces output deterministically on any platform, and the realtime path is just the same classes hosted inside one AudioWorkletProcessor.
2. Worklet delivery: the kernel is compiled as a separate self-contained build entry, embedded in the main bundle as a string constant, and loaded through a blob URL. No second-file deployment problem. A URL override exists for CSP-strict hosts, and the built worklet also ships as its own file in the package.
3. Scheduling: musical logic (transport, tempo map, generators) runs on the main thread and compiles to timestamped events; the kernel places them sample-accurately by splitting its 128-frame blocks at event boundaries. postMessage is the baseline transport; SharedArrayBuffer is an optimization behind the same interface when the host is cross-origin isolated, never a requirement.
4. Tempo curves integrate exactly. Beat-to-seconds over a linear bpm ramp is a closed form (logarithmic integral), not an approximation, so automation never drifts and offline equals realtime.
5. Voices are pooled and reused inside the kernel. Zero allocation per block at steady state. No per-note node graphs, no dispose() surface.
6. Seeding: xmur3 hash into mulberry32 streams, forkable by label so the stream tree is stable regardless of consumption order. Nothing in the library calls Math.random.
7. WASM SIMD acceleration is deferred to a later phase and will be Rust if built; the TS reference implementations are the contract and the test oracle.
8. License Apache-2.0 (patent grant matters for a DSP library; copyleft friction does not pay for itself here). Package name `bellowsjs`, unscoped, verified free.

## 3. Feature domains (as built in v0.1)

### Synthesis engines
Virtual analog (polyBLEP saw/square/PWM, polyBLAMP triangle, ladder and SVF filters, per-voice drift), FM (2/4/6 operators, DX-style algorithm routing tables, feedback operator), additive (32 partials, inharmonicity, morph), wavetable (mipmapped sets, position scan), granular (64-grain clouds, seeded jitter), extended Karplus-Strong pluck, waveguide string and tube, modal bank (bar, membrane, bell, glass, wood), west coast (wavefolder into vactrol low-pass gate), formant vocal synth (vowel morphing), drum engines (kick, snare, hat, clap, tom), noise synth, and a DDSP-style harmonic-plus-noise engine with a frame-driven control input reserved for a future neural pack.

### Samples and soundfonts
Sampler engine with velocity layers, round robins, loop crossfades. SF2 parser implementing the generator resolution model of the spec (preset zones adding onto instrument zones, timecents envelopes, loop modes, stereo links, 24-bit). SFZ parser covering the opcode subset that plays the popular free libraries, with include and define support.

### Theory and tuning
Thirty plus scales, chord parsing and detection, roman numerals both directions, nearest-motion voice leading, negative harmony, seeded functional-harmony progression generation. Tuning as a first-class object: any EDO, just intonation ratio sets, cents tables, Scala .scl and .kbm import. 12-EDO is a default, never an assumption.

### Sequencing and generative
Transport with exact tempo integration, meters, swing per subdivision. Euclidean patterns (true Bjorklund), Markov chains of any order with fallback and chord-tone gravity, L-systems (deterministic and stochastic), elementary cellular automata, arpeggiators, probability masks, and a small step-indexed combinator layer (seq, stack, every, sometimes, fast, slow, rev). Deliberately not a pattern language; Strudel exists and is good.

### Effects
Delays (clean, tape with wow/flutter and saturation, multitap with diffusion), FDN-8 reverb (Householder feedback, mutually prime modulated lines, RT60-derived gains), Dattorro plate with the 1997 constants, compressor (soft knee, program-dependent release, lookahead), true-peak limiter, gate, transient shaper, 6-band parametric EQ, saturator with 4x oversampling, chorus, flanger, phaser, tremolo, autopan, ring mod, Hilbert-pair frequency shifter, and a spectral suite on the shared STFT framework: phase-vocoder pitch shift with identity phase locking, freeze, blur, robot, whisper, denoise, plus offline time stretch.

### Analysis
YIN and MPM pitch detection, spectral flux onset detection with adaptive median threshold, tempo estimation, chroma and Krumhansl-Schmuckler key estimation, spectral descriptors, MFCC, and an EBU R128 loudness meter (momentary, short-term, integrated with two-stage gating, LRA, 4x oversampled true peak) with K-weighting derived per sample rate rather than hardcoded at 48 kHz.

### I/O
WAV encode/decode (8/16/24/32 int and float32), standard MIDI file read/write, Web MIDI wrapper with MPE zone support (Chromium and Firefox; Safari has no Web MIDI), WebCodecs Opus export where available with WAV as the universal fallback, offline render through the same kernel.

## 4. API tiers

Tier 1, immediate:

```js
import { play, instrument } from 'bellowsjs';
play('pluck', 'C4');
```

Tier 2, the workbench:

```js
const b = await Bellows.boot({ seed: 'forge-01' });
const lead = b.voice('fm', { algorithm: 3, feedback: 0.4 });
lead.fx('tapeDelay', { time: 0.375, feedback: 0.35 });
const scale = b.scale('D dorian');
const rhythm = b.euclid(16, 7, 2);
b.clock.at('16n', (t, step) => {
  if (rhythm[step % 16]) lead.note(scale.degreeToMidi(step % 7, 4), { at: t, dur: '16n' });
});
b.transport.start();
```

Tier 3, the kernel: register a custom engine or effect implementing the Voice or Effect contract; it is then addressable by id like any built-in, in realtime and offline both.

Offline is the same graph:

```js
const wav = await b.render({ bars: 16, format: 'wav' });
```

## 5. Performance budgets

Steady state: zero allocations per block on the audio thread. Note event latency from post to sample-accurate placement: under one block plus transport lookahead. Boot to first sound under 150 ms excluding downloads. Golden-render regression suite: deterministic offline renders diffed against stored references with tolerance, never exact float equality.

## 6. Roadmap

Phase 1 (this repo, now): everything in section 3, kernel and facade, workbench app with code mode.
Phase 2: SFZ opcode breadth, WAM hosting, CLASP transport pack, ambisonics and HRTF spatial pack, MIDI clock sync.
Phase 3: Rust WASM SIMD twins for hot ops, neural pack over the harmonic engine, WebGPU offline acceleration.

## 7. Risks

Tracked in docs/ENGINEERING.md section 5. The live ones: Safari (no Web MIDI, late WebCodecs, sample-rate changes after interruptions), blob URL CSP failures (mitigated by URL override), constant-transcription errors in Dattorro and ladder tuning tables (mitigated by golden renders), and pattern-layer scope creep (mitigated by declared non-goals).
