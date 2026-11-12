/*
 * The dependency rule, enforced instead of described.
 *
 * CLAUDE.md: "Dependency direction is one way: `types` and `core` at the
 * bottom, then `dsp`, then `engines`/`fx`/`analysis`, then `kernel`/`io`,
 * then the facade. Never import upward."
 *
 * It was described only. src/core/register.ts had 22 runtime imports from
 * engines/ and fx/, every one of them upward, and had had them for as long
 * as the file existed. Nothing noticed, because nothing looked. The file is
 * a manifest of the layers above it and now sits above them, at
 * src/register.ts, and this is what stops the next one.
 *
 * Type-only imports are allowed and counted separately: they are erased at
 * compile time, so they create no runtime cycle and no bundling
 * consequence. They are still worth seeing, so the count is asserted rather
 * than ignored, and a new one has to be added here deliberately.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { workletCode } from '../../src/kernel/worklet-code.gen';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** Layer index. Lower may not import higher. */
const LAYER: Record<string, number> = {
  types: 0,
  core: 1,
  dsp: 2,
  theory: 2,
  patterns: 2,
  /* text and notes to timed phonemes; knows no audio, like theory beside it */
  lyrics: 2,
  engines: 3,
  fx: 3,
  analysis: 3,
  seq: 3,
  presets: 4,
  render: 5,
  kernel: 5,
  io: 5,
};

function allSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allSources(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

interface Edge {
  from: string;
  to: string;
  spec: string;
  typeOnly: boolean;
}

function edges(): Edge[] {
  const out: Edge[] = [];
  for (const abs of allSources(SRC)) {
    const rel = relative(SRC, abs);
    const parts = rel.split(sep);
    /* Files directly under src/ are the facade and its entry points: they
     * sit above everything and are allowed to reach anywhere. */
    if (parts.length === 1) continue;
    const from = parts[0];
    const text = readFileSync(abs, 'utf8');
    for (const m of text.matchAll(/^import\s+(type\s+)?([^;]*?)from '([^']+)';/gms)) {
      const spec = m[3];
      if (!spec.startsWith('.')) continue;
      const target = normalize(join(dirname(rel), spec)).split(sep);
      const to = target.length > 1 ? target[0] : 'types';
      /* `import { type A, type B }` is also fully erased. */
      const clause = m[2];
      const braced = clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'));
      const allTyped =
        clause.includes('{') &&
        braced.split(',').every((s) => s.trim() === '' || s.trim().startsWith('type '));
      out.push({ from, to, spec: `${rel} -> ${spec}`, typeOnly: Boolean(m[1]) || allTyped });
    }
  }
  return out;
}

describe('dependency direction', () => {
  const all = edges();

  it('is reading a source tree that still has layers in it', () => {
    /* If the tree is restructured, the assertions below could pass by
     * finding nothing to check. */
    expect(all.length).toBeGreaterThan(150);
    const seen = new Set(all.map((e) => e.from));
    for (const layer of ['dsp', 'engines', 'fx', 'kernel', 'io', 'core']) {
      expect(seen.has(layer), layer).toBe(true);
    }
  });

  it('has no module importing a layer above its own at runtime', () => {
    const upward = all
      .filter((e) => !e.typeOnly)
      .filter((e) => LAYER[e.from] !== undefined && LAYER[e.to] !== undefined)
      .filter((e) => LAYER[e.to] > LAYER[e.from])
      .map((e) => e.spec);
    expect(upward).toEqual([]);
  });

  it('has exactly the three type-only upward imports it is meant to have', () => {
    /*
     * core/scheduler needs Transport's shape and never constructs one;
     * engines/soundfont maps the parsers' record types onto SampleZone and
     * never calls a parser. Both are erased. Listed rather than counted so
     * a new one is a deliberate edit.
     */
    const upward = all
      .filter((e) => e.typeOnly)
      .filter((e) => LAYER[e.from] !== undefined && LAYER[e.to] !== undefined)
      .filter((e) => LAYER[e.to] > LAYER[e.from])
      .map((e) => e.spec)
      .sort();
    expect(upward).toEqual([
      'core/scheduler.ts -> ../seq/transport',
      'engines/soundfont.ts -> ../io/sf2',
      'engines/soundfont.ts -> ../io/sfz',
    ]);
  });

  it('keeps the DSP core free of browser globals so it runs in Node', () => {
    /*
     * CLAUDE.md: "The DSP core stays free of browser globals so it runs and
     * tests in Node." The suite proves it for whatever it happens to
     * import; this proves it for the whole of the pure layers.
     */
    const PURE = ['dsp', 'engines', 'fx', 'theory', 'seq', 'analysis', 'patterns', 'core', 'presets', 'lyrics'];
    /*
     * `window` is deliberately absent from this list. In this codebase it
     * is an FFT window: chroma, onset, stft and granular all take one as a
     * parameter, and `window.length` there is an array length. Telling that
     * apart from the browser global needs scope analysis, not a regex.
     *
     * It is covered anyway, and better, by test/kernel/worklet-parity.ts:
     * that loads the shipped bundle, which contains the whole DSP core,
     * into a scope holding four names and nothing else, and renders 96
     * blocks through it. AudioWorkletGlobalScope has no window, no document
     * and no fetch, so a DSP module reaching for one throws there.
     *
     * fetch and WebAssembly are listed for the lyric layer's sake: it takes
     * its pronouncing dictionary as an injected map and hosts no wasm
     * (docs/VOICE.md, decisions 1 and 4), so a pure module that fetches
     * data or instantiates a module has broken one of those decisions.
     */
    const BROWSER =
      /\b(document|navigator|AudioContext|AudioWorkletNode|AudioBuffer|OfflineAudioContext|localStorage|sessionStorage|XMLHttpRequest|requestAnimationFrame|Blob|globalThis|fetch|WebAssembly)\b/;
    const offenders: string[] = [];
    for (const abs of allSources(SRC)) {
      const rel = relative(SRC, abs);
      if (!PURE.includes(rel.split(sep)[0])) continue;
      const code = readFileSync(abs, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const m = BROWSER.exec(code);
      if (m) offenders.push(`${rel}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('the lyric layer', () => {
  it('imports nothing but the contracts and its own files', () => {
    /*
     * docs/VOICE.md puts lyrics beside theory: text and notes in, timed IPA
     * out, no audio, no engine, no clock. Its layer number alone would let
     * it import dsp, which sits at the same level, so the rule is stated
     * here as what it is.
     */
    const lyricEdges = edges().filter((e) => e.from === 'lyrics');
    expect(lyricEdges.length).toBeGreaterThan(10);
    const outside = lyricEdges.filter((e) => e.to !== 'lyrics' && e.to !== 'types').map((e) => e.spec);
    expect(outside).toEqual([]);
  });
});

describe('the audio thread', () => {
  /** Every source file the worklet entry reaches through runtime imports. */
  function reachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const abs = stack.pop()!;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const text = readFileSync(abs, 'utf8');
      for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?([^;]*?)from '([^']+)';/gms)) {
        if (m[1] || !m[3].startsWith('.')) continue;
        const clause = m[2];
        const braced = clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'));
        const allTyped =
          clause.includes('{') && braced.split(',').every((x) => x.trim() === '' || x.trim().startsWith('type '));
        if (allTyped) continue;
        const base = join(dirname(abs), m[3]);
        const file = [base + '.ts', join(base, 'index.ts')].find((p) => existsSync(p));
        if (file) stack.push(file);
      }
    }
    return new Set([...seen].map((p) => relative(SRC, p)));
  }

  /*
   * Strings that exist only in the lyric layer (no other file under src/
   * has them). A marker the source loses fails the first assertion below
   * rather than passing quietly.
   */
  const MARKERS: Array<[string, string]> = [
    ['english.ts', 'W IH1 N D'],
    ['english.ts', 'AW1 ER0'],
    ['ipa.ts', 'iyɨʉɯuɪʏʊeøɘɵɤoəɛœɜɞʌɔæɐaɶɑɒɝɚ'],
    ['letter-to-sound.ts', 'ʃ ə n'],
    ['cmudict.ts', ';;;'],
  ];
  /* esbuild writes non-ASCII as \xHH or \uHHHH escapes; undo them before searching. */
  const unescaped = (code: string) =>
    code.replace(/\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})/g, (_, x, u) => String.fromCharCode(parseInt(x ?? u, 16)));

  it('does not reach the lyric layer or the facade from the worklet entry', () => {
    /*
     * docs/VOICE.md decision 3: the lyric layer ships in the main entry and
     * stays out of the worklet bundle. The kernel needs the vocal engine
     * and its phoneme table, and nothing that reads text.
     */
    const files = reachable(join(SRC, 'kernel', 'worklet-entry.ts'));
    expect(files.has(join('engines', 'vocal.ts'))).toBe(true);
    expect(files.has(join('engines', 'vocal-phonemes.ts'))).toBe(true);
    const facade = ['bellows.ts', 'sing.ts', 'quick.ts', 'index.ts'];
    const leaks = [...files].filter((f) => f.startsWith('lyrics' + sep) || facade.includes(f)).sort();
    expect(leaks).toEqual([]);
  });

  it('ships a worklet bundle with none of the lyric layer in it', async () => {
    for (const [file, marker] of MARKERS) {
      expect(readFileSync(join(SRC, 'lyrics', file), 'utf8'), `${file} lost its marker`).toContain(marker);
    }
    /* Positive control: the markers survive the worklet's own minifier settings. */
    const control = await build({
      stdin: {
        contents: "export * from './lyrics/read'; export * from './lyrics/cmudict';",
        resolveDir: SRC,
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      target: 'es2022',
      minify: true,
      write: false,
      legalComments: 'none',
    });
    const lyricBundle = unescaped(control.outputFiles[0].text);
    const found = MARKERS.filter(([, m]) => !lyricBundle.includes(m)).map(([f]) => f);
    expect(found, 'markers the minifier does not keep').toEqual([]);
    /* And the bundle the kernel actually loads, as generated. */
    const worklet = unescaped(workletCode);
    expect(worklet.length).toBeGreaterThan(50_000);
    /* the engine's own IPA is in there, so the unescaping is doing its job */
    expect(worklet).toContain('tʃ');
    const inWorklet = MARKERS.filter(([, m]) => worklet.includes(m)).map(([f]) => f);
    expect(inWorklet).toEqual([]);
  });
});

describe('the contracts file', () => {
  it('has no export in it that nothing consumes', () => {
    /*
     * CLAUDE.md names src/types.ts as the contract every domain touches, so
     * a declaration sitting there unused does not read as dead code, it
     * reads as a contract somebody is honouring. TempoPoint was one:
     * declared, never imported, never re-exported, while seq/tempomap.ts
     * carried its own Point shape the whole time.
     *
     * A name counts as consumed when any other .ts file under src/ or test/
     * spells it out. That is crude in the safe direction: an importer has no
     * way to avoid naming it, so this cannot report a live export as dead.
     * This file is excluded from the search, or the comment above would
     * count as a consumer of the very name it is about.
     */
    const typesFile = join(SRC, 'types.ts');
    const selfFile = fileURLToPath(import.meta.url);
    const declared = [
      ...readFileSync(typesFile, 'utf8').matchAll(
        /^export (?:interface|type|const enum|function) ([A-Za-z0-9_]+)/gm,
      ),
    ].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(10);
    const others = [...allSources(SRC), ...allSources(join(SRC, '..', 'test'))].filter(
      (p) => p !== typesFile && p !== selfFile,
    );
    const bodies = others.map((p) => readFileSync(p, 'utf8'));
    const unused = declared.filter(
      (name) => !bodies.some((b) => new RegExp(`\\b${name}\\b`).test(b)),
    );
    expect(unused).toEqual([]);
  });
});
