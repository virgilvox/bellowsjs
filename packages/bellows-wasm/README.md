# bellows-wasm

The bellows-embedded C++ engines and effects compiled to WebAssembly, as a bellowsjs plugin. A
channel or an fx chain takes them exactly as it takes the TypeScript ones: same ids with a
prefix, same params, same seeds.

```js
import { Bellows } from 'bellowsjs';
import { bellowsWasm } from 'bellows-wasm';

const b = await Bellows.boot({ plugins: [bellowsWasm()] });
// 'wasm-va', 'wasm-plate' and the rest sit beside 'va' and 'plate'
```

`bellowsWasm({ replace: true })` registers under the TypeScript ids instead, so every score that
names `va` or `plate` runs the module without being edited. On the calling thread (Node,
`renderOffline`) call `plugin.register()` first, as with any plugin.

```
npm install bellowsjs bellows-wasm
```

## What it carries

14 engines: va, fm, additive, wavetable, kick, snare, hat, pluck, string, tube, modal, westcoast,
formant, harmonic. 12 effects: delay, plate, compressor, limiter, gate, chorus, flanger,
tremolo, autopan, ringmod, eq, saturator. That is every unit bellows-embedded ports. The
TypeScript units it does not port (clap, tom, noise, granular, sampler, the spectral effects and
the rest) stay TypeScript only.

The module is 510 KB, half of it the wavetable morph table at the 2048 points the TypeScript
plays (bellows-embedded ships 512 to fit a small part's flash). The plugin carries it as base64,
713 KB, because a plugin is one script that `addModule()` runs with no fetch and no message to
pass a compiled module through. It has no imports: the C library it needs is `src/rt.c`, an
allocator with per-size free lists, and libm comes from compiler-builtins at link time.

## How it fits

```
src/abi.cpp          C ABI: create a voice or effect by unit number with every param in spec
                     order, note on and off, set param i, render into one shared buffer
src/units.gen.h      generated: TypeScript param index i to C++ Params field, per unit
src/manifest.gen.json generated: the ParamSpecs, in the same order, for the JS side
src/install.js       registers one def per unit through the kernel hook; runs in the worklet
                     and on the calling thread, so it uses nothing a worklet scope lacks
src/rt.c             malloc, free and the few symbols C++ code generation reaches for
```

Templates sized by a sample rate are built at 192 kHz, so one module serves every rate a
browser runs at, and each unit takes its timing from the rate it is created with. Two units
needed a change in bellows-embedded to make that true and to match the TypeScript's live
`setParam`: the limiter now takes its lookahead from the running rate and switches its
true-peak detector at run time, and Snare, Hat and Pluck gained the `SetParams` every other
voice had.

The string's second polarization exists when the params record names `polDetune`, as in the
TypeScript, and the delay's ring is sized from its `maxSeconds` option (4 s by default).

## Tests

```
npm test -w packages/bellows-wasm          build, then every unit against the TypeScript
node tools/browser-test.mjs                the same in headless Chrome, through the worklet
node test/bench.mjs                        time per second of audio, both ways
node test/voice-diag.mjs wavetable 48000 scanDepth=0.5   one voice, one set of params
```

`test/parity.mjs` plays each engine as three overlapping notes with params off their defaults
and one param changed while they sound, and each effect on a VA chord with one param changed
mid-render, through the real kernel, at 44.1, 48 and 96 kHz. All 27 rows pass their gates, and
the gates were checked: a wrong param mapping in any row reads 1.4e-1 or more, and dropping the
live `setParam` fails every row. The worklet script run in a worklet scope must give the same
samples bit for bit as `register()` and `renderOffline`.

`tools/browser-test.mjs` bundles a page, loads it in headless Chrome and renders eight rows
through an OfflineAudioContext with the plugin added by `addModule`, the path a page takes. The
module's renders hash the same as Node's.

Through the kernel, eight voices or one effect, on one Apple arm64 machine under Node 22, the
module ran 1.2 to 2.5 times faster than the TypeScript on the engines and 1.2 to 5 times on
the effects (the plate most). Run `test/bench.mjs` rather than quote these.

## Building

Needs the toolchain bellows-embedded's `tools/wasm` uses: Homebrew LLVM's clang, rust-lld and
Rust's `wasm32-unknown-unknown` target. `npm run gen -w packages/bellows-wasm` regenerates the
two tables after a ParamSpec change; `gen:check` fails when they are stale.
