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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** Layer index. Lower may not import higher. */
const LAYER: Record<string, number> = {
  types: 0,
  core: 1,
  dsp: 2,
  theory: 2,
  patterns: 2,
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
    const PURE = ['dsp', 'engines', 'fx', 'theory', 'seq', 'analysis', 'patterns', 'core', 'presets'];
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
     */
    const BROWSER =
      /\b(document|navigator|AudioContext|AudioWorkletNode|AudioBuffer|OfflineAudioContext|localStorage|sessionStorage|XMLHttpRequest|requestAnimationFrame|Blob|globalThis)\b/;
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
