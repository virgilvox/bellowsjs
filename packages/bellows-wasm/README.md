# bellows-wasm

Every bellowsjs engine and effect, and the kernel that plays them, compiled to WebAssembly from
the bellows-embedded C++ and loaded as a bellowsjs plugin. It runs two ways.

**The whole kernel.** The render (event queue, block splitting, voice pools, param ramps, channel
fx, sends, buses, the master chain and the meter) runs in the module, one call per block, and
every builtin plays from it under its own id. Nothing in a score changes.

```js
import { Bellows } from 'bellowsjs';
import { bellowsWasm } from 'bellows-wasm';

const b = await Bellows.boot({ plugins: [bellowsWasm({ kernel: true })] });
b.voice('va');          // the module's VA, in the module's kernel
```

A unit the module does not carry (the singing voice from bellows-voice, a tier 3 def, a plugin's
engine, or a builtin someone replaced with `registerEngine`) still plays: the kernel calls it in
JavaScript at the point the TypeScript kernel would, so it sounds as it does there. The kernel is
chosen when the worklet processor is built, so the plugin goes to `Bellows.boot`, not `b.use()`,
and `b.render()` uses the same kernel. Needs bellowsjs 0.5.1 or later.

**Units beside the TypeScript ones.** `bellowsWasm()` registers each unit as `'wasm-' + id`
('wasm-va', 'wasm-plate') next to the TypeScript one, in the TypeScript kernel, to hear the two
side by side. `bellowsWasm({ replace: true })` registers them under the TypeScript ids instead.

On the calling thread (Node, `renderOffline`), call `plugin.register()` first, as with any plugin,
and give a kernel plugin's name to the render:

```js
import { renderOffline } from 'bellowsjs';
import { KERNEL_NAME, bellowsWasm } from 'bellows-wasm';

bellowsWasm({ kernel: true }).register();
const out = renderOffline(score, { seconds: 4, kernelName: KERNEL_NAME });
```

```
npm install bellowsjs bellows-wasm
```

## What it carries

18 engines: va, fm, additive, wavetable, kick, snare, hat, clap, tom, noise, pluck, string, tube,
modal, westcoast, formant, granular, harmonic, and the sampler, which plays the banks a page
registers (`sampler:<id>`, and `granular:<id>` for grain banks). 24 effects: delay, tapeDelay,
multitap, fdn, plate, compressor, limiter, gate, transient, chorus, flanger, phaser, tremolo,
autopan, ringmod, freqshift, eq, saturator, pitchshift, freeze, blur, robot, whisper, denoise.
That is every unit bellowsjs registers. The singing voice lives in bellows-voice and plays in
JavaScript.

The module is 644 KB, a third of it the wavetable morph table at the 2048 points the TypeScript
plays (bellows-embedded ships 512 to fit a small part's flash). The plugin carries it as base64,
936 KB, because a plugin is one script that `addModule()` runs with no fetch. Its only imports are
the kernel's six callbacks into JavaScript; the C library it needs is `src/rt.c`, an allocator
with per-size free lists, and libm comes from compiler-builtins at link time.

## How it fits

```
src/kernel.cpp       the kernel: packages/bellows/src/kernel/engine.ts carried over line for line
src/kernel.js        its JavaScript half, a KernelLike: messages to calls, and the foreign units
src/unit.h           the Voice and Fx interfaces, the adapters over bellows-embedded classes, the
                     param value conversions and the bank interface
src/voices.cpp       NewVoice: one case per engine
src/effects.cpp      NewFx: one case per effect
src/banks.cpp        sampler and grain banks: zones copied into module memory
src/abi.cpp          C ABI for single units: create by unit number with every param in spec
                     order, note on and off, set param i, render into one shared buffer
src/units.gen.h      generated: TypeScript param index i to C++ Params field, per unit
src/manifest.gen.json generated: the ParamSpecs, in the same order, for the JS side
src/install.js       registers one def per unit through the kernel hook (the per-unit mode)
src/rt.c             malloc, free and the few symbols C++ code generation reaches for
```

The kernel follows the TypeScript's arithmetic as well as its logic: event times, frames, ramps,
gains and pans are doubles, as they are in JavaScript, and a value is rounded to float exactly
where the TypeScript stores into a Float32Array. Maps that keep insertion order in the TypeScript
(channels, buses, sends) keep it here, because the order things are mixed in is the order their
rounding lands in. A channel or effect is "native" when its def is the one `registerBuiltins()`
registered for an id the module carries, and "foreign" otherwise.

Templates sized by a sample rate are built at 192 kHz, so one module serves every rate a
browser runs at, and each unit takes its timing from the rate it is created with. A sample bank
is shared by every channel made on it, as the sampler's round-robin counter is shared in the
TypeScript; registering an id again makes a new bank and leaves the old one to the channels
already playing it. The string and the tube take `setParam('freq')`, the TypeScript's legato
retune, outside their specs; `tools/gen-units.mjs` maps such names to a call (`Glide`).

## Tests

```
npm test -w packages/bellows-wasm     build, then every unit and the kernel against the TypeScript
cd packages/bellows && npx vite-node ../bellows-wasm/test/<file>
  parity.mjs          every unit through the TypeScript kernel, 45 rows at 44.1, 48 and 96 kHz
  kernel-parity.mjs   the module's kernel against KernelEngine on whole scores
  banks.mjs           sampler and granular voices against the TypeScript, zone features included
  spectral-dsp.mjs    the FFT, windows and STFT against dsp/fft.ts and dsp/stft.ts
  bench.mjs           time per second of audio: TypeScript, per-unit plugin, module kernel
node tools/browser-test.mjs           headless Chrome, through the worklet, against Node
```

`test/parity.mjs` plays each engine as three overlapping notes with params off their defaults
and one param changed while they sound, and each effect on a VA chord with one param changed
mid-render. Gates are set at about two and a half times the worst measured figure, with the
reason beside any looser than 1e-3, and each row was checked to fail on a wrong param mapping or
a dropped live change.

`test/kernel-parity.mjs` has two kinds of row. The exact rows play only foreign units, so every
sample the units make is the TypeScript's own and everything the kernel does around them is
compared bit for bit: allocation and stealing, param ramps (retargets, sub-block, zero, infinite
and absurd durations, cancellation by a set), gains, pans and sends gliding, buses, chains,
channels replaced in place and removed, panic, a tier 3 def, and a queue long enough to compact.
All of them are identical, and each of seven deliberate kernel faults made a row differ or fail. The native rows play the module's units on whole scores (the golden piece, every
engine and effect at once, banks with a shared round robin and a re-registered bank, mixed native
and foreign), gated like the unit rows. The worklet script must give the calling thread's
samples bit for bit.

`tools/browser-test.mjs` renders through an OfflineAudioContext with the plugin added by
`addModule`, in both modes, and each render hashes the same as Node's.

Through the kernel on one Apple arm64 machine under Node 22, eight voices or one effect at
48 kHz, the module's kernel ran 1.4 to 2.8 times faster than the TypeScript on the engines and
2.4 to 6.7 times on the effects (the plate most), and a whole mix of 18 channels with an effect
each, two buses and a master chain 1.8 times faster. Run `test/bench.mjs` rather than quote these.

## Building

Needs the toolchain bellows-embedded's `tools/wasm` uses: Homebrew LLVM's clang, rust-lld and
Rust's `wasm32-unknown-unknown` target. `npm run gen -w packages/bellows-wasm` regenerates the
two tables after a ParamSpec change; `gen:check` fails when they are stale.
