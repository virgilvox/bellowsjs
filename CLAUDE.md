# BELLOWS

A browser-native audio engine for synthesis, samples, sequencing, analysis, and I/O. Published to npm as `bellowsjs`.

## Repository layout

- `packages/bellows` is the library. Pure TypeScript DSP core with zero browser dependencies in `src/dsp`, `src/engines`, `src/fx`, `src/theory`, `src/seq`, `src/analysis`. Browser integration (AudioWorklet kernel, Web MIDI, WebCodecs) lives in `src/kernel` and `src/io`. The worklet is inlined as a blob URL at runtime, never a second file.
- `apps/workbench` is the Vue 3 demo app: a generative workbench plus a code mode with runnable, editable examples.
- `docs/` holds the PRD and design notes.

## Hard rules for writing

- Never use emojis anywhere: not in code, comments, docs, commit messages, or UI copy.
- Never use em dashes. Use commas, periods, colons, or parentheses instead.
- Avoid stock AI phrasing. Banned: "delve", "dive into", "seamless", "seamlessly", "robust", "leverage", "utilize", "comprehensive", "cutting-edge", "state-of-the-art", "elevate", "empower", "unleash", "supercharge", "It's important to note", "In conclusion", "Additionally," as a sentence opener, exclamation-heavy marketing tone, and bullet lists that restate the heading. Write plainly, like the existing PRD and code comments.
- Never add Claude attribution, Co-Authored-By trailers, or "Generated with" lines to git commits. Commit messages are plain imperative English describing the change.

## Engineering rules

- Strong separation of concerns. One concept per file, small focused modules, no god classes. Domains only touch each other through the contracts in `src/types.ts` and their public module exports: `dsp` knows nothing about music, `theory` and `seq` know nothing about audio buffers, `engines` and `fx` consume `dsp`, the kernel consumes registries, `io` consumes plain arrays. UI code never reaches into library internals.
- Dependency direction is one way: `types` and `core` at the bottom, then `dsp`, then `engines`/`fx`/`analysis`, then `kernel`/`io`, then the facade. Never import upward.

- The DSP core stays free of browser globals so it runs and tests in Node. Every DSP unit takes its sample rate at construction and processes Float32Array blocks.
- Test driven: every DSP unit, theory function, generator, and parser gets vitest coverage before or alongside implementation. Run `npm test` from the repo root, or `npx vitest run <path>` for one file.
- Voices add into output buffers; effects process in place. Both use `(l, r, from, to)` index ranges so the kernel can split blocks at event boundaries for sample accuracy.
- No allocation on the audio path at steady state. Preallocate in constructors, reuse scratch buffers, pool voices.
- Every stochastic decision draws from a named, forkable PRNG stream (`src/core/prng.ts`). Nothing calls Math.random in library code.
- Offline render and realtime share the same DSP classes. Golden-render regression tests live in `packages/bellows/test/golden`.
- 12-EDO is a default, never an assumption. Pitch flows through the tuning layer.

## Commands

- `npm test` runs the vitest suite for the library.
- `npm run build -w packages/bellows` builds the library (ESM plus standalone IIFE).
- `npm run dev -w apps/workbench` starts the demo app.
