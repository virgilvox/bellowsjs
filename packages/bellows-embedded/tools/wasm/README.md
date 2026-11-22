# tools/wasm

The embedded library compiled to WebAssembly, and run against the TypeScript with the same
parity gates the native build answers to.

```
npm run parity:wasm     audio parity, every row, gated
npm run tables:wasm     theory, sequencing and MIDI tables, exact
npm run presets:wasm    the 50 instrument presets, every value
npm run bench:wasm      time per second of audio, WebAssembly against the TypeScript
npm run bench           the same against the native build
```

Each is the native suite with `--wasm` (or `--bench`) added: the harness sources in
`test/parity` (`render.cpp`, `tables.cpp`, `presets.cpp`) are compiled unchanged, run in
process by `host.mjs`, and compared by the same code against the same gates. Nothing about the
comparison is new except where the C++ runs.

## Toolchain

No system libc and nothing to download beyond what a Rust and LLVM install already carries:

- clang with the wasm32 target. Homebrew's `llvm` has it; Apple's clang does not.
- `rust-lld`, from any rustup toolchain, as the linker.
- musl's libm, out of Rust's `wasm32-unknown-unknown` compiler-builtins
  (`rustup target add wasm32-unknown-unknown`), which exports sin, tanhf, powf and the rest as
  plain C symbols.

`host.mjs` finds all three; `BELLOWS_WASM_CLANG`, `BELLOWS_WASM_LLD` and
`BELLOWS_WASM_BUILTINS` override them.

The library itself needs only `math.h`, `stdint.h` and `stddef.h`. `include/` replaces the
hosted headers with declarations, and `libc.c` is the rest of what the harnesses call: a bump
allocator, integer and string printf, the string functions, an entry point. It imports four
things from the host: write, getenv, a clock for the bench, and formatting or parsing a double,
because JavaScript's `toPrecision`, `toFixed` and `Number()` are already correctly rounded and a
second implementation of `%.9g` would be one more thing to be wrong. A test program printing
every format the harnesses use came out byte for byte the same as the native build.

## What it covers

Every header except `platform/`, which is board support (Teensy Audio, ESP32 I2S, Daisy) and
has nothing to run on here. `Bellows.h` and each header compile to wasm32 with
`BELLOWS_FAST_MATH` at 0 and at 1, `Bank` instantiated, and `test/parity/fastmath_test.cpp`
prints the same accuracy table under WebAssembly as natively.

Against the TypeScript, as of this writing:

| suite | rows | result |
| --- | --- | --- |
| audio parity | 42: the PRNG, tuning, 17 engine rows, 4 effect-input rows, 18 effect rows, the kernel | all pass |
| tables | 428: euclid, scales, chords, notes, arp, automata, L-system, Markov, tempo map, MIDI | 0 mismatched |
| presets | 50 presets, 1054 values | 0 failures |

The PRNG and the four effect-input rows are exact under WebAssembly as they are natively. Most
other rows read the same as the native build to three figures. Nine differ in the third
figure, some up and some down and all inside their gates, which is what the native Apple
build fusing multiply-adds (the default `-ffp-contract=on` on arm64) and WebAssembly not having
a fused multiply-add predicts.

The kernel row was added with this work and gates the native build too. It schedules eleven
events at frames that are not block aligned through `Kernel<Kick, 4>` and the TypeScript
`KernelEngine`, so block splitting, the steal order and all-notes-off are compared. See its
comment in `parity.mjs` for what it was shown to catch.

Not compared to anything: `Bank`, which is compile-time dispatch with no TypeScript
counterpart, and `test/safety/memsafety.cpp`, which needs threads.

## Speed

`npm run bench:wasm` times only the render loop on each side, five seconds of audio a row, best
of three after a warm-up. On one Apple arm64 machine under Node 22 the WebAssembly build was
faster than the TypeScript on every row, from 1.1 times (the VA engine, the additive bank off
its default morph) to 8.5 times (the snare), with most rows between 1.5 and 3 times. The native
build was faster again on the heavy engines (the VA by about 3.6 times, the additive bank by
about 2), while on the effects the two were level, with the WebAssembly ahead on several. These are one machine's figures; run the
bench rather than quote them.

## The browser build

`packages/bellows-wasm` is the loadable module: a C ABI over every engine and effect this
library ports, registered into the kernel worklet as a bellowsjs plugin, and tested against the
TypeScript through the kernel in Node and in headless Chrome. `buildWasm` takes a `runtime`
option for it, a C file of its own in place of `libc.c`, because a library wants an allocator
and nothing else.
