#!/usr/bin/env node
/*
 * Build the plugin.
 *
 *   build/bellows.wasm  src/abi.cpp, voices.cpp and effects.cpp and the bellows-embedded headers, compiled by
 *                       bellows-embedded/tools/wasm/host.mjs (clang, rust-lld, musl libm)
 *   build/include/      the wavetable morph table at 2048 points, the length the TypeScript
 *                       engine builds. The embedded header ships 512 to fit a small part's
 *                       flash; generated here, ahead of it on the include path, the module
 *                       plays the TypeScript's table and not a shorter one. 256 KB more.
 *   dist/index.js       the plugin: the module as base64, the manifest, src/install.js once as
 *                       code for the calling thread and once as the text of the worklet script
 *   dist/index.d.ts     its types
 *   dist/bellows.wasm   the module on its own, for a host that wants to serve or inspect it
 *
 * The worklet script carries the module inline because a plugin is one script that addModule()
 * runs with nothing else to hand: a worklet scope has no fetch, and the plugin contract has no
 * message to pass a compiled module through. Base64 costs a third more bytes than the module.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWasm } from '../../bellows-embedded/tools/wasm/host.mjs';
import { generateWavetableHeader } from '../../bellows-embedded/tools/gen-tables.mjs';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const EMB = join(PKG, '..', 'bellows-embedded');
const wasm = join(PKG, 'build', 'bellows.wasm');
mkdirSync(dirname(wasm), { recursive: true });
mkdirSync(join(PKG, 'dist'), { recursive: true });

const tables = join(PKG, 'build', 'include', 'bellows', 'dsp', 'wavetable_tables.h');
mkdirSync(dirname(tables), { recursive: true });
writeFileSync(tables, await generateWavetableHeader(false, 2048));

buildWasm(['abi.cpp', 'voices.cpp', 'effects.cpp', 'kernel.cpp'].map((f) => join(PKG, 'src', f)), wasm, {
  include: [join(PKG, 'build', 'include'), join(EMB, 'src'), join(PKG, 'src')],
  runtime: join(PKG, 'src', 'rt.c'),
});

const bytes = readFileSync(wasm);
const manifest = JSON.parse(readFileSync(join(PKG, 'src', 'manifest.gen.json'), 'utf8'));
const stripExports = (src) => src.replace(/^export \{[^}]*\};?\s*$/m, '');
const installSrc = stripExports(readFileSync(join(PKG, 'src', 'install.js'), 'utf8'));
const kernelSrc = stripExports(readFileSync(join(PKG, 'src', 'kernel.js'), 'utf8'));
const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;

const js = `/*! bellows-wasm ${version} | MIT | the bellows-embedded C++ engines and effects as WebAssembly */
import * as bellows from 'bellowsjs';

const WASM = ${JSON.stringify(bytes.toString('base64'))};
const MANIFEST = ${JSON.stringify(manifest)};
const INSTALL = ${JSON.stringify(installSrc)};
const KERNEL = ${JSON.stringify(kernelSrc)};
${installSrc}
${kernelSrc}
/** The name the module's kernel registers under (BellowsPlugin.kernel). */
export const KERNEL_NAME = 'bellows-wasm';
let compiled = null;
const compile = () => compiled ?? (compiled = new WebAssembly.Module(decodeBase64(WASM)));

/** The units the module carries, as the TypeScript ids. */
export const engineIds = MANIFEST.filter((u) => u.kind === 'engine').map((u) => u.id);
export const effectIds = MANIFEST.filter((u) => u.kind === 'effect').map((u) => u.id);

/** The module's bytes. */
export function wasmBytes() {
  return decodeBase64(WASM);
}

const registered = new Set();

/**
 * The plugin. By default each unit registers as 'wasm-' + its TypeScript id ('wasm-va',
 * 'wasm-plate'), beside the TypeScript one. { replace: true } registers under the TypeScript ids
 * instead, so every channel and fx chain that names 'va' or 'plate' runs the WebAssembly.
 */
export function bellowsWasm(opts = {}) {
  if (opts.kernel) return kernelPlugin();
  const prefix = opts.replace ? '' : (opts.prefix ?? 'wasm-');
  const cfg = { prefix, label: opts.replace ? '' : ' (WebAssembly)' };
  const id = 'bellows-wasm:' + prefix;
  const worklet =
    '"use strict";(function(){' + INSTALL +
    '\\nvar hook=globalThis.bellowsKernel;if(!hook||!(hook.version>=1))throw new Error("bellows-wasm: load the bellows kernel before this plugin");' +
    'install(hook,new WebAssembly.Module(decodeBase64(' + JSON.stringify(WASM) + ')),' + JSON.stringify(MANIFEST) + ',' + JSON.stringify(cfg) + ');})();';
  const info = (kind) =>
    MANIFEST.filter((u) => u.kind === kind).map((u) => ({
      id: prefix + u.id,
      label: u.label + cfg.label,
      params: u.params,
      ...(u.polyphony ? { polyphony: u.polyphony } : {}),
    }));
  return {
    id,
    worklet,
    engines: info('engine'),
    effects: info('effect'),
    register() {
      if (registered.has(id)) return;
      registered.add(id);
      install({ registerEngine: bellows.registerEngine, registerEffect: bellows.registerEffect }, compile(), MANIFEST, cfg);
    },
  };
}

/*
 * The whole kernel in the module (src/kernel.cpp): channels, voice pools, ramps, fx chains, buses
 * and the master render in WebAssembly, one call per block, and the units the module carries play
 * under their TypeScript ids with no prefix. A unit it does not carry, or a builtin that was
 * replaced, plays in JavaScript at the same point in the render. Needs a bellowsjs whose kernel
 * hook is version 2, and goes to Bellows.boot({ plugins }), since the kernel is chosen when the
 * processor is built.
 */
function kernelPlugin() {
  const worklet =
    '"use strict";(function(){' + INSTALL + '\\n' + KERNEL +
    '\\nvar hook=globalThis.bellowsKernel;if(!hook||!(hook.version>=2)||!hook.registerKernel)throw new Error("bellows-wasm: the kernel needs a bellowsjs kernel hook of version 2 or later");' +
    'var mod=new WebAssembly.Module(decodeBase64(' + JSON.stringify(WASM) + '));var man=' + JSON.stringify(MANIFEST) + ';' +
    'hook.registerKernel(' + JSON.stringify(KERNEL_NAME) + ',function(sr,o,env){return createKernel(mod,man,sr,o,env);});})();';
  return {
    id: 'bellows-wasm:kernel',
    kernel: KERNEL_NAME,
    worklet,
    register() {
      if (registered.has('kernel')) return;
      if (typeof bellows.registerKernel !== 'function') throw new Error('bellows-wasm: the kernel needs bellowsjs with registerKernel (0.5.1 or later)');
      registered.add('kernel');
      bellows.registerKernel(KERNEL_NAME, (sr, o, env) => createKernel(compile(), MANIFEST, sr, o, env));
    },
  };
}
`;
writeFileSync(join(PKG, 'dist', 'index.js'), js);
writeFileSync(
  join(PKG, 'dist', 'index.d.ts'),
  `import type { BellowsPlugin } from 'bellowsjs';

export interface BellowsWasmOptions {
  /**
   * Run the whole kernel in the module: every builtin unit the module carries plays from it under
   * its own id, and the rest play in JavaScript inside the same render. Pass the plugin to
   * Bellows.boot({ plugins }); on the calling thread, register() it and give renderOffline
   * { kernelName: KERNEL_NAME }. Needs bellowsjs 0.5.1 or later.
   */
  kernel?: boolean;
  /** Register under the TypeScript ids ('va', 'plate'), replacing the TypeScript units. */
  replace?: boolean;
  /** The id prefix when not replacing. Default 'wasm-'. */
  prefix?: string;
}

/** The plugin: pass it to Bellows.boot({ plugins }) or bellows.use(). */
export function bellowsWasm(opts?: BellowsWasmOptions): BellowsPlugin;
/** The TypeScript ids of the engines the module carries. */
export const engineIds: readonly string[];
/** The TypeScript ids of the effects the module carries. */
export const effectIds: readonly string[];
/** The module's bytes. */
export function wasmBytes(): Uint8Array;
/** The name the module's kernel registers under. */
export const KERNEL_NAME: 'bellows-wasm';
`,
);
copyFileSync(wasm, join(PKG, 'dist', 'bellows.wasm'));
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
process.stdout.write(`bellows.wasm ${kb(bytes.length)}, dist/index.js ${kb(statSync(join(PKG, 'dist', 'index.js')).size)}\n`);
