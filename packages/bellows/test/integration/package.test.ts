/*
 * The published package, as an installer gets it.
 *
 * src/index.ts, the barrel every consumer imports, was reachable from no
 * test: not statically, not dynamically. So the export surface, the exports
 * map, the emitted types and the standalone build were all produced by CI
 * and then checked by nothing. The workbench does not cover them either,
 * because its vite config aliases `bellowsjs` to library source in both dev
 * and build, so bellows.live never loads dist/ at all.
 *
 * This loads the built bundle and drives it. It needs dist/, which
 * test/global-setup.ts builds once before any worker starts, so `npm test`
 * works on a clean checkout without anyone remembering an order.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(PKG, 'dist');
const BUNDLE = join(DIST, 'bellows.js');

let pkgExports: Record<string, unknown>;
let srcExports: Record<string, unknown>;

beforeAll(async () => {
  /* test/global-setup.ts has already built dist, once, before any worker. */
  expect(existsSync(BUNDLE), 'dist was not built by the global setup').toBe(true);
  pkgExports = (await import(pathToFileURL(BUNDLE).href)) as Record<string, unknown>;
  srcExports = (await import('../../src/index')) as Record<string, unknown>;
}, 180_000);

/*
 * Every runtime name the package exports, in sorted order.
 *
 * This list IS the public API. A name leaving it is a breaking change for
 * somebody, and the point of writing it down is that the change has to be
 * made on purpose here rather than noticed by a user on npm. Adding a name
 * is not breaking, so a failure that only reports extras is a reminder to
 * update the list, not a defect.
 *
 * Types are absent by construction: they are erased, and dist/index.d.ts is
 * checked separately below.
 */
const PUBLIC_API: string[] = [
  'Adsr', 'Arpeggiator', 'Bellows', 'BlepOscillator', 'BusHandle', 'CHORD_TYPES',
  'ChordWalker', 'ChromaAnalyzer', 'DEFAULT_METER', 'DcBlocker', 'DelayLine', 'ElementaryCA',
  'EnvelopeFollower', 'EventKind', 'FLAT_NAMES', 'FUNCTIONAL_WEIGHTS', 'Fft',
  'INSTRUMENT_PRESETS', 'INTERVAL_NAMES', 'Instrument', 'Istft', 'KERNEL_PROCESSOR_NAME',
  'KernelEngine', 'LadderFilter', 'Lfo', 'LoudnessMeter', 'MAJOR_PROFILE', 'MINOR_PROFILE',
  'Markov', 'MidiInput', 'MidiOutput', 'MpeZone', 'NoiseGen', 'OnePole', 'OnsetDetector',
  'Oversampler', 'RealFft', 'SAMPLER_PARAMS', 'SCALES', 'SHARP_NAMES', 'SamplerBank',
  'Scale', 'Scheduler', 'SetupLog', 'SineOscillator', 'Smoother', 'SoundFont', 'Stft',
  'StftProcessor', 'Svf', 'TableShaper', 'TempoMap', 'Transport', 'Tuning', 'VoicePool',
  'WavetableOscillator', 'WavetableSet', 'YinDetector', 'additiveEngine', 'autopanDef',
  'bankEngineResolver', 'beatsPerBar', 'blackmanHarris', 'blepOptionsFromParams', 'blurDef',
  'buildOggPage', 'buildProgression', 'buildStepwiseMatrix', 'caRhythm', 'canEncode',
  'chebyshevTable', 'chord', 'chordName', 'chordToRoman', 'chorusDef', 'chromaFromSpectrum',
  'clamp', 'clapEngine', 'classicWavetables', 'colaNorm', 'compressorDef',
  'createKernelNode', 'dbToGain', 'decodeVlq', 'decodeWav', 'degreeFreq', 'delayDef',
  'denoiseDef', 'detectChord', 'detectOnsets', 'diatonicSevenths', 'diatonicTriads',
  'encodeAudio', 'encodeVlq', 'encodeWav', 'eqDef', 'estimateTempo', 'euclid', 'every',
  'fast', 'fdnDef', 'flangerDef', 'fmEngine', 'foldback', 'formantEngine', 'freezeDef',
  'freqshiftDef', 'fromArray', 'ftom', 'gainToDb', 'gateDef', 'gates', 'getEffect',
  'getEngine', 'getPreset', 'granularEngine', 'hamming', 'hann', 'hardClip',
  'harmonicEngine', 'hatEngine', 'instrument', 'internParam', 'intervalName', 'invert',
  'kWeightingCoeffs', 'keyEstimate', 'kickEngine', 'limiterDef', 'listEffects',
  'listEngines', 'lsystem', 'makeGranularEngine', 'makeSamplerEngine', 'makeWavetableEngine',
  'mapToDegrees', 'mfcc', 'mfccFromSpectrum', 'mod12', 'modalEngine', 'mpm', 'mtof',
  'mulberry32', 'multitapDef', 'negativeHarmony', 'noiseEngine', 'noteName', 'octaveOf',
  'oggCrc', 'oggOpusMux', 'opusHead', 'opusPacketSamples', 'opusTags', 'parseChord',
  'parseKbm', 'parseMidi', 'parseMidiMessage', 'parseNote', 'parsePitchClass', 'parseScl',
  'parseSfz', 'parseTime', 'phaserDef', 'pitchClass', 'pitchClassName', 'pitchShiftOffline',
  'pitchshiftDef', 'plateDef', 'play', 'pluckEngine', 'presetsByFamily', 'quickBellows',
  'registerBuiltins', 'registerEffect', 'registerEngine', 'renderOffline', 'rev',
  'ringmodDef', 'rms', 'rng', 'robotDef', 'romanToChord', 'rotate', 'rotatePattern', 'samplerBankFromSf2',
  'samplerBankFromSfz', 'saturatorDef', 'seq', 'sfzNoteValue', 'slow', 'snareEngine',
  'softClip', 'sometimes', 'spectralCentroid', 'spectralEffects', 'spectralFlatness',
  'spectralRolloff', 'spectralSpread', 'stack', 'stringEngine', 'tanhShape', 'tapeDelayDef',
  'timeStretch', 'toScore', 'tomEngine', 'transientDef', 'tremoloDef', 'tubeEngine',
  'tuningFromScala', 'vaEngine', 'voiceLead', 'wavetableEngine', 'weightedWalk',
  'westcoastEngine', 'whisperDef', 'writeMidi', 'xmur3', 'yin', 'zcr',
];

describe('the published package', () => {
  it('resolves by package name, in a plain Node process, through its exports map', () => {
    /*
     * What an installer gets: real Node ESM resolution of the bare
     * specifier, through the workspace link and the exports map, with no
     * bundler and no test runner in the way. Anything that works only
     * because vitest transformed it does not count here.
     *
     * A subprocess rather than a literal import, for two reasons. tsc runs
     * before anything is built, so a static `import('bellowsjs')` needs
     * dist/index.d.ts to exist to typecheck and fails TS2307 on a clean
     * checkout. And import.meta.resolve is not implemented by vitest's
     * module runner. Spawning node has neither problem and tests more.
     */
    const script = `
      import * as b from 'bellowsjs';
      /* Resolved, not imported. dist/worklet.js is AudioWorklet source: it
       * calls registerProcessor at load, which does not exist in Node, so
       * importing it would fail for a reason that says nothing about the
       * exports map. What the README promises is that the path is there. */
      const worklet = import.meta.resolve('bellowsjs/worklet.js');
      process.stdout.write(JSON.stringify({ names: Object.keys(b).sort(), play: typeof b.play, worklet }));
    `;
    /* execFileSync, not execSync: no shell, so the script's newlines reach
     * node as newlines instead of as the two characters a shell sees. */
    const out = execFileSync('node', ['--input-type=module', '-e', script], {
      cwd: PKG,
      encoding: 'utf8',
    });
    const got = JSON.parse(out) as { names: string[]; play: string; worklet: string };
    expect(got.play).toBe('function');
    /* The ./worklet.js subpath is the CSP fallback the README promises. */
    expect(got.worklet).toMatch(/dist\/worklet\.js$/);
    expect(got.names).toEqual(Object.keys(pkgExports).sort());
  });

  it('exports exactly the documented public API, and nothing is undefined', () => {
    const actual = Object.keys(pkgExports).sort();
    const missing = PUBLIC_API.filter((n) => !actual.includes(n));
    const extra = actual.filter((n) => !PUBLIC_API.includes(n));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    const undef = actual.filter((n) => pkgExports[n] === undefined);
    expect(undef).toEqual([]);
  });

  it('exports the same runtime names the source barrel does', () => {
    /* Catches the build dropping or renaming something the source has. A
     * name missing from BOTH is caught by the list above instead. */
    expect(Object.keys(pkgExports).sort()).toEqual(Object.keys(srcExports).sort());
  });

  it('keeps the shapes callers actually depend on', () => {
    const fn = (n: string) => expect(typeof pkgExports[n]).toBe('function');
    for (const n of ['play', 'instrument', 'quickBellows', 'Bellows', 'renderOffline', 'rng', 'mtof', 'euclid', 'registerBuiltins', 'createKernelNode', 'KernelEngine', 'decodeWav', 'encodeWav', 'parseMidi', 'SoundFont']) fn(n);
    expect(typeof pkgExports.KERNEL_PROCESSOR_NAME).toBe('string');
    expect(Array.isArray(pkgExports.INSTRUMENT_PRESETS)).toBe(true);
    expect(Array.isArray(pkgExports.SAMPLER_PARAMS)).toBe(true);
    expect(typeof pkgExports.SCALES).toBe('object');
  });

  it('registers no engines just by being imported, so sideEffects: false is honest', () => {
    /* package.json says sideEffects: false, which lets a bundler drop any
     * module nothing imports from. That is only safe because
     * registerBuiltins() is explicit rather than a side effect of import.
     * If a module ever registers at import time, this fails and the flag
     * has to go. */
    const list = pkgExports.listEngines as () => unknown[];
    const before = list().length;
    expect(before).toBe(0);
    (pkgExports.registerBuiltins as () => void)();
    expect(list().length).toBeGreaterThan(10);
  });

  it('renders audio through the built bundle, not just through src', () => {
    (pkgExports.registerBuiltins as () => void)();
    const renderOffline = pkgExports.renderOffline as (s: unknown[], o: unknown) => {
      left: Float32Array;
      right: Float32Array;
      sampleRate: number;
    };
    const bankEngineResolver = pkgExports.bankEngineResolver;
    const audio = renderOffline(
      [
        { type: 'createChannel', id: 0, engineId: 'pluck', params: {}, seed: 'pkg' },
        { type: 'channelGain', id: 0, gain: 0.9 },
        { type: 'masterGain', gain: 1 },
        {
          type: 'events',
          events: [{ time: 0.01, kind: 0, target: 0, a: 60, b: 261.63, c: 0.9 }],
        },
      ],
      { seconds: 0.5, sampleRate: 44100, kernel: { resolveBankEngine: bankEngineResolver } },
    );
    let peak = 0;
    for (let i = 0; i < audio.left.length; i++) {
      expect(Number.isFinite(audio.left[i])).toBe(true);
      peak = Math.max(peak, Math.abs(audio.left[i]));
    }
    expect(peak).toBeGreaterThan(0.02);
    expect(audio.sampleRate).toBe(44100);
  });

  it('ships every path package.json promises, and the worklet subpath resolves', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      files: string[];
      main: string;
      types: string;
      exports: Record<string, Record<string, string> | string>;
    };
    for (const f of pkg.files) expect(existsSync(join(PKG, f))).toBe(true);
    expect(existsSync(join(PKG, pkg.main))).toBe(true);
    expect(existsSync(join(PKG, pkg.types))).toBe(true);
    const walk = (v: unknown): void => {
      if (typeof v === 'string') expect(existsSync(join(PKG, v))).toBe(true);
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(pkg.exports);
  });

  it('emits a types entry declaring the same names it exports at runtime', () => {
    /* dist/index.d.ts is a barrel of re-exports, so the check is that every
     * runtime name is re-exported somewhere in the emitted tree rather than
     * that they all appear in one file. */
    const dts = readFileSync(join(DIST, 'index.d.ts'), 'utf8');
    const from = [...dts.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]);
    expect(from.length).toBeGreaterThan(10);
    let declared = '';
    for (const rel of from) {
      const p = join(DIST, rel + '.d.ts');
      if (existsSync(p)) declared += readFileSync(p, 'utf8');
    }
    const all = dts + declared;
    const missing = Object.keys(pkgExports).filter((n) => !new RegExp(`\\b${n}\\b`).test(all));
    expect(missing).toEqual([]);
  });

  it('agrees with the source barrel binding for binding, not just by name', () => {
    /*
     * Names matching is not enough: `rotate` matched by name in both and
     * was a different function in each. seq/euclid and seq/pattern both
     * exported it, the source barrel resolved the star and the rolled-up
     * bundle resolved the explicit line, so b.rotate on bellows.live took
     * an array and b.rotate from npm took a pattern. The spec says the
     * explicit export wins, so dist was right, but a barrel whose meaning
     * depends on the bundler is the defect.
     *
     * Compared by kind and arity. Function .name cannot be used: esbuild
     * mangles it, Bellows comes back as Ts.
     */
    const src = srcExports;
    const mismatched: string[] = [];
    for (const k of Object.keys(src)) {
      const a = src[k];
      const b = pkgExports[k];
      if (typeof a !== typeof b) {
        mismatched.push(`${k}: ${typeof a} in src, ${typeof b} in dist`);
        continue;
      }
      if (typeof a === 'function' && a.length !== (b as (...x: unknown[]) => unknown).length) {
        mismatched.push(`${k}: arity ${a.length} in src, ${(b as (...x: unknown[]) => unknown).length} in dist`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('agrees with the source barrel on what the colliding names mean', () => {
    /* The arity check above would not have caught the rotate divergence:
     * both take two arguments. So the two survivors of that collision are
     * pinned by behaviour, in both artefacts. */
    const check = (ns: Record<string, unknown>, where: string): void => {
      const rotate = ns.rotate as (a: readonly number[], n: number) => number[];
      expect(Array.isArray(rotate([1, 2, 3, 4], 1)), where).toBe(true);
      expect(rotate([1, 2, 3, 4], 1), where).toEqual([2, 3, 4, 1]);
      const fromArray = ns.fromArray as (v: readonly number[]) => { at(i: number): number };
      const rotatePattern = ns.rotatePattern as (
        p: { at(i: number): number },
        n: number,
      ) => { at(i: number): number };
      expect(rotatePattern(fromArray([1, 2, 3, 4]), 1).at(0), where).toBe(2);
    };
    check(srcExports, 'source barrel');
    check(pkgExports, 'built bundle');
  });

  it('builds a standalone bundle that needs no module loader', () => {
    /* The IIFE build is what a script tag gets. It is produced by the same
     * build and was checked by nothing. */
    const standalone = join(DIST, 'bellows.standalone.js');
    expect(existsSync(standalone)).toBe(true);
    const code = readFileSync(standalone, 'utf8');
    expect(code).not.toMatch(/\bimport\s*[{('"]/);
    expect(code).not.toMatch(/\bexport\s*[{*]/);
    /* Run it the way a script tag would, in a bare context, and check it
     * actually leaves the global vite.config names behind. A build that
     * returns its namespace and assigns it to nothing would pass every
     * textual check above and be useless in a browser. */
    const sandbox: Record<string, unknown> = {};
    runInContext(code, createContext(sandbox));
    expect(Object.keys(sandbox)).toEqual(['Bellows']);
    const B = sandbox.Bellows as Record<string, unknown>;
    expect(typeof B.play).toBe('function');
    expect(Object.keys(B).sort()).toEqual(Object.keys(pkgExports).sort());
  });

  it('inlines the worklet rather than shipping a loose file the host must serve', () => {
    /* The README promises "no second file to deploy", and also promises a
     * packaged bellowsjs/worklet.js for hosts whose CSP blocks blob:. Both
     * have to be true at once. */
    const code = readFileSync(BUNDLE, 'utf8');
    expect(code).toContain('bellows-kernel');
    expect(existsSync(join(DIST, 'worklet.js'))).toBe(true);
  });
});

/*
 * The barrel has 33 `export *` lines. Two of them exporting the same name
 * makes that name vanish from the package entirely under ES semantics, and
 * an explicit `export { x } from` silently wins over a star that also has
 * x. Both are quiet: the build succeeds, the type checker is happy, and the
 * symbol is simply not there.
 *
 * That already happened. seq/euclid and seq/pattern both export `rotate`;
 * the explicit line won, the pattern combinator became reachable from
 * nothing, and a docs page grew a footnote explaining that the combinator
 * its own paragraph describes is not available. It is exported as
 * rotatePattern now.
 *
 * The invariant is reachability, not the absence of shadowing: a name may
 * be shadowed as long as the thing it named is still exported under some
 * name. Checked by identity, so an alias satisfies it and a near-identical
 * reimplementation does not.
 */
describe('every starred module is fully reachable from the package', () => {
  const SRC = join(PKG, 'src');
  const index = readFileSync(join(SRC, 'index.ts'), 'utf8');
  const stars = [...index.matchAll(/^export \* from '\.\/([^']+)';/gm)].map((m) => m[1]);

  /** Runtime names a module declares, ignoring types. */
  function runtimeExportsOf(rel: string): string[] {
    const s = readFileSync(join(SRC, rel + '.ts'), 'utf8');
    const out = new Set<string>();
    for (const m of s.matchAll(
      /^export\s+(?:async\s+)?(?:function|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
      out.add(m[1]);
    }
    for (const m of s.matchAll(/^export\s+\{([^}]*)\}(?!\s*from)/gm)) {
      for (const raw of m[1].split(',')) {
        const t = raw.trim();
        if (t && !t.startsWith('type ')) out.add(t.split(/\s+as\s+/).pop()!.trim());
      }
    }
    return [...out];
  }

  it('is reading a barrel that still looks like a barrel', () => {
    /* If the shape of index.ts changes, the test below could pass by
     * finding nothing to check. */
    expect(stars.length).toBeGreaterThan(20);
    expect(stars.flatMap(runtimeExportsOf).length).toBeGreaterThan(100);
  });

  it('exports every value its starred modules declare, under some name', async () => {
    const src = (await import('../../src/index')) as Record<string, unknown>;
    const exported = new Set(Object.values(src));
    const unreachable: string[] = [];
    let checked = 0;
    for (const rel of stars) {
      const mod = (await import(/* @vite-ignore */ join(SRC, rel + '.ts'))) as Record<string, unknown>;
      for (const n of runtimeExportsOf(rel)) {
        const v = mod[n];
        if (v === undefined) continue;
        checked++;
        /* Identity, or the same name bound to the same thing. Primitives
         * can collide by value, which only ever makes this laxer. */
        if (!exported.has(v)) unreachable.push(`${rel}.${n}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(unreachable).toEqual([]);
  });
});
