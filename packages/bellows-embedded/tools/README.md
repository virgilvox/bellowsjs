# tools

Three scripts. Run all of them from `packages/bellows-embedded`.

## gen-tables.mjs

Codegen. The TypeScript library in `packages/bellows` is the single source of
truth for anything the C++ port copies, and this script is what copies it.

```
node tools/gen-tables.mjs            regenerate both outputs
node tools/gen-tables.mjs --check    exit 1 if the committed output is stale
node tools/gen-tables.mjs --only=blep
node tools/gen-tables.mjs --only=params
```

`npm run gen:tables` is the same as the first form.

It writes two files, and nothing else in `src/` is generated:

**`src/bellows/dsp/blep_tables.h`** holds the BLEP step and BLAMP residual
tables, run through the algorithm in `packages/bellows/src/dsp/oscillators.ts`
line for line: Kaiser windowed sinc, kernel half width 16, 64 points per
sample, cutoff 0.42 of the sample rate, beta 6, the trapezoidal integral for
the step and the drift corrected second integral for the blamp. 2049 entries
each, nine significant digits, `inline constexpr float` so they land in
`.rodata`. The arithmetic is transcribed rather than restructured because
reassociating it would move the last digits and change how the C++ oscillator
aliases relative to the JS one.

**`src/bellows/params.gen.h`** is a parity document, not something to include
from an engine. Per ported unit it emits a comment block listing every
ParamSpec name with its min, max, default and unit, alongside the C++ field
that matched, plus an `inline constexpr` array of the defaults. Param names
stay comments: a string table of names would put every name of every unit in
flash and invite the string keyed lookup the port exists to avoid.

The ParamSpec arrays are read from `packages/bellows/dist/bellows.js` after
calling `registerBuiltins()`, not parsed out of the `.ts` sources. Two units
build their specs programmatically (`fm` expands ratio, level and fixed per
operator; `eq` expands four fields per band inside `buildParams()`), so a
source parser would have to execute the module anyway, and `registerBuiltins`
is the same call the worklet and the offline renderer make, so what gets read
is exactly what ships. The cost is that `dist` has to be current: the script
warns on stderr when `packages/bellows/src` is newer, and the fix is
`npm run build -w packages/bellows` from the repo root.

Which C++ class belongs to which id is discovered, not listed. Every class
under `bellows/engines` and `bellows/fx` with a nested `struct Params` is a
ported unit, and its class name lowercased is its id (`Va` to `va`, `WestCoast`
to `westcoast`, `AutoPan` to `autopan`); a trailing `Ext` is dropped first,
since the caller owns memory pattern puts `Params` on the base and the owning
template only adds storage. Two class names differ from their id on purpose
and have entries in `CLASS_ALIASES` at the top of the script. A new engine
needs no change here as long as it follows those conventions.

### The parity contract

Regenerating has to be a no-op. If it is not, someone changed a param on one
side only.

- A param added, renamed, re-defaulted or re-ranged in TypeScript shows up as
  a diff in `params.gen.h`, and the block for that unit names the C++ field
  that no longer matches.
- Each block ends with the two directions of mismatch: TypeScript params with
  no C++ field of that name, and C++ fields with no ParamSpec. Some of those
  are deliberate (`Eq3` is a three band subset of the six band TypeScript EQ,
  `output` is spelled `output_db` in the port to name its unit), and they stay
  listed so the divergence is written down rather than remembered.
- The tail lists engines and effects with no C++ class yet, so the size of the
  remaining port is visible.
- Run `node tools/gen-tables.mjs --check` in CI. It regenerates in memory and
  exits 1 when the committed copy differs, which catches both a stale
  `blep_tables.h` and a forgotten param.

## check-header.sh

Compiles one or more headers in isolation for Cortex-M7 with `-Wall -Wextra`
and prints the flash and RAM they cost. Use it while writing a module: it
builds its own translation unit in a temp directory, so parallel work on other
headers cannot interfere, and its exit code is the compiler's, so it doubles
as a syntax check. A header is not done until this is clean.

```
./tools/check-header.sh bellows/engines/fm.h
./tools/check-header.sh bellows/fx/delay.h bellows/fx/saturator.h
```

## size-report.sh

Builds every sketch in `test/sketches` freestanding, with no Arduino core and
no BSP, and prints `.text` and `.data` plus `.bss` per sketch. These are the
numbers the library's size claims rest on. It takes an optional target
(`cortex-m7` by default, also `cortex-m4`, `cortex-m33`, `cortex-m0plus`).
Because it compiles the whole sketch directory into one shared build tree, do
not run it while someone else is adding sketches.
