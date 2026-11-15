# The voice as its own library: proposal (2026-11-14)

The owner's ask: move the singing voice out of bellows into its own repository and package, with
bellows in its name but able to stand on its own, and have bellows use it rather than contain it.
This is a design, not yet built. Nothing here changes bellows until the owner picks a name and
says go.

## What the voice is today (MEASURED on 0.4.0)

- **Engine and DSP**, bundled alone with esbuild: 390 KB of source in, 65 KB gzipped out. The
  largest pieces: `dsp/junction-airway.ts` 77 KB, `engines/vocal-tables.gen.ts` 51 KB,
  `engines/vocal-geometry.ts` 44 KB, `engines/vocal-planner.ts` 34 KB, `engines/vocal.ts` 34 KB,
  `dsp/glottal.ts` 33 KB.
- **Text layer**: `src/lyrics/` (16 files) and `src/sing.ts`, 133 KB of source, pure TypeScript, no
  audio.
- **Build data and scripts**: `data/vocal/`, `scripts/gen-vocal-tract.mjs`,
  `scripts/gen-extra-vowels.mjs`, `src/engines/vowel-solver.ts`.
- **Docs**: `docs/VOICE.md`, `docs/VOICE-2.md`, `docs/ACCENTS.md`; the CHIMERA notice in
  `THIRD_PARTY_NOTICES.md`.

It separates cleanly. No module outside the voice imports `junction-airway`, `glottal`,
`fold-oscillator`, `geometric-glottis`, `airway-tube`, `pitch-servo`, `phonation-threshold`,
`area-rate`, `air`, `critdamp`, `cascade` or `pitchglide`; nothing outside `src/lyrics`,
`src/sing.ts` and the facade imports the vocal engine files. What it shares with the rest of
bellows is small and already public: `dsp/envelopes`, `types`, `core/prng`.

## Why split

- **A page that never sings stops paying for the voice.** The worklet carries every built-in engine
  as one string, so today every bellows page loads the voice's 65 KB gzipped whether or not it sings.
- **The voice has its own pace and audience.** Accents, speech, text-to-IPA and the solver are
  useful without a synthesizer (pronounce and toIPA need no audio at all), and they change far
  more often than the kernel.
- **License and credit stay legible.** The CHIMERA-derived code and its MIT notice travel in one
  package instead of being a section of a larger one.

## How it plugs in

The kernel can already take an engine it was not built with: `b.defEngine(def)` serializes a def
and the worklet evaluates it (`defOp` in `kernel/engine.ts`). The voice would ship its whole
engine prebuilt as one self-contained code string, the way bellows ships its worklet today
(`worklet-code.gen.ts`), so nothing has to be serializable by `toString()`.

Two changes to bellows make that a supported path instead of a trick:

1. **`b.use(plugin)`** (and `Bellows.boot({ plugins })`). A plugin is plain data:
   `{ id, engines: [{ info: EngineInfo, code: string, def?: EngineDef }] }`. bellows posts each
   engine's code into the worklet, records it in the setup log so `b.render()` replays it, adds its
   `info` to `listEngines()`, and registers `def` on the calling thread when one is given (Node and
   `renderOffline`). This is `defEngine` with a catalog entry and a prebuilt string.
2. **A way in without eval.** `defOp` uses `new Function`, which a strict Content Security Policy
   blocks. Better: the worklet scope exposes a registration hook, and a plugin's code is a module
   added with `audioWorklet.addModule()` before the kernel node is made, calling that hook. That is
   why plugins belong at boot, not later. The offline path loads the same module into its
   OfflineAudioContext, and outside a browser the plugin's `def` registers directly.

The singing API moves with the voice. `sing()` and `speak()` need only what bellows already makes
public: an instrument, timed `param()` calls for `phoneme`, `bend`, `nextPhoneme` and `nextIn`, a
note on and off at given times, the tempo map and the tuning. So the voice wraps an instrument
instead of patching `Instrument`:

```js
import { Bellows } from 'bellowsjs';
import { voice, singer } from 'bellows-cantor';

const b = await Bellows.boot({ plugins: [voice] });
const alto = singer(b, { body: 1, accent: 'southern-british' });
alto.sing('twinkle twinkle little star', melody, { at: b.now() + 0.5 });
alto.speak('Good morning.');
```

`singer(b, opts)` makes the instrument with `b.voice('vocal', ...)` and keeps the per-channel
state that `SingState` keeps in the facade today (busy windows, rest phoneme and bend). The text
layer is also exported on its own: `import { toIPA, pronounce, ACCENTS } from 'bellows-cantor/text'`
needs no bellows and no audio.

## Dependency direction

`bellows-cantor` depends on `bellowsjs` as a peer dependency (it uses the kernel contracts in
`types.ts`, `envelopes` and the PRNG, and bundles what it uses into its worklet string).
`bellowsjs` does not depend on the voice. That keeps the CLAUDE.md rule that dependencies run one
way, with the voice as one more consumer on top of the facade.

## What moves, what stays

| Moves to the voice repo | Stays in bellows |
|---|---|
| `engines/vocal*.ts`, `engines/vowel-solver.ts` | the kernel, registries, facade |
| the 13 voice-only DSP files above | `dsp/envelopes.ts`, `core/prng.ts`, `types.ts` |
| `src/lyrics/`, `src/sing.ts`, `Instrument.sing/speak` | `analysis/formants.ts` (general LPC; the voice uses it at build time) |
| `data/vocal/`, the two generator scripts | `dsp/resonator.ts` and the `formant` engine (they only cite the voice's tables in comments) |
| VOICE.md, VOICE-2.md, ACCENTS.md, the CHIMERA notice | everything else |
| the voice's tests, goldens and the singing docs page | the site, which installs the voice to show it |

## Migration

- **bellows 0.5.0** drops the built-in `vocal` engine, `sing()`, `speak()` and the lyric exports.
  `b.voice('vocal')` without the plugin throws, naming the package to install. The CHANGELOG and
  the site say so.
- **The voice 0.1.0** ships the same sound: its golden renders must match bellows 0.4.0's sample
  for sample before bellows drops anything.
- **The site** installs the voice, so its examples change one import and one boot option.
- **The embedded library** is unaffected: it has no voice yet. A future C++ voice (the Teensy
  airway in scratch) belongs in the voice repo too.

## Names (all free on npm on 2026-11-14)

- **`bellows-cantor`** (recommended): a cantor is the one who leads the singing. Short, reads as a
  name on its own ("Cantor"), and says what it does.
- `bellows-larynx`: the organ itself, plain and accurate, but a Rhasspy text-to-speech project was
  called Larynx, which invites confusion.
- `bellows-chorister`: a choir singer; longer.
- `bellows-voice`: easiest to find, but it does not stand on its own.

## Steps

1. Add `b.use()` / `boot({ plugins })` and the worklet registration hook to bellows, with the
   built-in voice registered through it, so the path is proven while the voice still lives here.
2. Create the repo, move the files with their history (`git filter-repo` on the paths above), set
   up its build to emit the engine module and code string, and its tests and goldens.
3. Gate: the voice package renders bellows 0.4.0's goldens exactly, in the browser through the
   worklet and in Node.
4. Release the voice 0.1.0, then bellows 0.5.0 without it, then deploy the site using it.
