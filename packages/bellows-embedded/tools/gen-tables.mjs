#!/usr/bin/env node
/*
 * Codegen that keeps the TypeScript library the single source of truth for
 * anything the C++ port has to copy by hand.
 *
 * Two outputs:
 *
 *   src/bellows/dsp/blep_tables.h   the Kaiser windowed sinc step and blamp
 *                                   residual tables, run through the exact
 *                                   algorithm in packages/bellows/src/dsp/
 *                                   oscillators.ts so the C++ oscillator
 *                                   aliases the same way the JS one does.
 *
 *   src/bellows/params.gen.h        one comment block per ported engine and
 *                                   effect listing every ParamSpec with its
 *                                   min, max and default, plus a constexpr
 *                                   array of the defaults.
 *
 * Usage, from packages/bellows-embedded:
 *
 *   node tools/gen-tables.mjs             regenerate both outputs
 *   node tools/gen-tables.mjs --check     regenerate into memory, exit 1 if
 *                                         the committed output differs
 *   node tools/gen-tables.mjs --only=blep|params
 *
 * The param specs are read out of packages/bellows/dist/bellows.js rather
 * than parsed from the .ts sources. Two engines build their ParamSpec arrays
 * programmatically (fm expands ratio/level/fixed per operator, eq expands
 * four fields per band in buildParams()), so a source parser would have to
 * execute the module anyway. registerBuiltins() is the same call the worklet
 * and the offline renderer make, so what this reads is exactly what ships.
 */

import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = dirname(HERE);
const REPO = dirname(dirname(PKG));
const TS_PKG = join(REPO, 'packages', 'bellows');
const TS_DIST = join(TS_PKG, 'dist', 'bellows.js');

/* ------------------------------------------------------------------ */
/* Number formatting                                                   */
/* ------------------------------------------------------------------ */

/*
 * Table entries print at nine significant digits. A float carries about
 * seven, so nine is past the point where the literal changes the stored
 * value, and the fixed width keeps the generated rows scannable and the
 * diffs small. Trailing zeros stay: toPrecision pads them, and stripping
 * them would make the columns ragged for no gain.
 */
function tableFloat(x) {
  return `${x.toPrecision(9)}f`;
}

/*
 * Defaults print at the shortest round-trip form instead, because they are
 * authored values a human wrote in the TypeScript (0.005, 9000, 0.707) and
 * should read back as the same number in the C++ Params struct.
 */
function paramFloat(x) {
  if (!Number.isFinite(x)) throw new Error(`non-finite default: ${x}`);
  let s = String(x === 0 ? 0 : x);
  if (!/[.eE]/.test(s)) s += '.0';
  return `${s}f`;
}

/*
 * Eight per row, two space indent, no trailing comma on the last row.
 * Array.from first: the tables are Float64Arrays, and a typed array's map
 * coerces whatever the callback returns back into the element type, which
 * silently turns every formatted literal into NaN.
 */
function formatRows(values, perRow = 8) {
  const all = Array.from(values, tableFloat);
  const lines = [];
  for (let i = 0; i < all.length; i += perRow) {
    const row = all.slice(i, i + perRow);
    const last = i + perRow >= all.length;
    lines.push(`  ${row.join(', ')}${last ? '' : ','}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* (a) BLEP and BLAMP residual tables                                  */
/* ------------------------------------------------------------------ */

/*
 * Transcribed line for line from buildTables() in src/dsp/oscillators.ts,
 * including the order the arithmetic happens in. Changing the association
 * here would move the last digits, so leave it alone: this function exists
 * to be boring.
 */
const KERNEL_HALF = 16;
const TABLE_RES = 64;
const CUTOFF = 0.42;
const KAISER_BETA = 6;
const TABLE_LEN = 2 * KERNEL_HALF * TABLE_RES + 1;

function besselI0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    const t = x / (2 * k);
    term *= t * t;
    sum += term;
    if (term < 1e-14 * sum) break;
  }
  return sum;
}

function buildTables() {
  const n = TABLE_LEN;
  const h = new Float64Array(n);
  const norm = besselI0(KAISER_BETA);
  for (let i = 0; i < n; i++) {
    const d = i / TABLE_RES - KERNEL_HALF;
    const x = 2 * CUTOFF * d;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = d / KERNEL_HALF;
    const w = besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - r * r))) / norm;
    h[i] = 2 * CUTOFF * sinc * w;
  }
  // step response: trapezoidal integral of the kernel, normalized to 1
  const step = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += (h[i - 1] + h[i]) / (2 * TABLE_RES);
    step[i] = acc;
  }
  for (let i = 0; i < n; i++) step[i] /= acc;
  // blamp residual: integral of (step - unit step), drift removed
  const ramp = new Float64Array(n);
  let acc2 = 0;
  for (let i = 1; i < n; i++) {
    const d0 = (i - 1) / TABLE_RES - KERNEL_HALF;
    const d1 = i / TABLE_RES - KERNEL_HALF;
    const r0 = step[i - 1] - (d0 >= 0 ? 1 : 0);
    const r1 = step[i] - (d1 >= 0 ? 1 : 0);
    acc2 += (r0 + r1) / (2 * TABLE_RES);
    ramp[i] = acc2;
  }
  const drift = ramp[n - 1];
  for (let i = 0; i < n; i++) ramp[i] -= (drift * i) / (n - 1);
  return { step, ramp };
}

function generateBlepHeader() {
  const { step, ramp } = buildTables();
  return [
    '/* Generated from src/dsp/oscillators.ts. Do not edit. */',
    '#pragma once',
    'namespace bellows {',
    `inline constexpr int kBlepKernelHalf = ${KERNEL_HALF};`,
    `inline constexpr int kBlepTableRes = ${TABLE_RES};`,
    `inline constexpr int kBlepTableLen = ${TABLE_LEN};`,
    'inline constexpr float kBlepStep[kBlepTableLen] = {',
    formatRows(step),
    '};',
    '',
    'inline constexpr float kBlepRamp[kBlepTableLen] = {',
    formatRows(ramp),
    '};',
    '',
    '}  // namespace bellows',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* (b) Param parity table                                              */
/* ------------------------------------------------------------------ */

/*
 * The port is discovered, not listed. Every class under bellows/engines and
 * bellows/fx that has a nested struct Params is a ported unit, and its class
 * name lowercased is its TypeScript id (Va -> va, WestCoast -> westcoast,
 * AutoPan -> autopan). A trailing Ext is dropped first, because the caller
 * owns memory pattern puts Params on the Ext base and the owning template
 * only adds storage (PlateExt -> plate).
 *
 * Discovery rather than a table because headers land continuously and a
 * hand-kept list goes stale silently, which is the exact failure this file
 * is supposed to catch. The only hand-maintained entries are class names
 * that deliberately do not match their id.
 */
const CLASS_ALIASES = {
  StereoDelayExt: 'delay',
  Eq3: 'eq',
};

const PORT_DIRS = [
  ['engines', 'bellows/engines'],
  ['effects', 'bellows/fx'],
];

/** camelCase to the trailing_underscore-free snake_case the port uses. */
function toSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Split on commas that are not inside braces or parens. */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Text of a balanced brace block starting at the first `{` after `at`. */
function braceBody(src, at) {
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open + 1, j);
  }
  return null;
}

/**
 * Field names declared in a `struct Params { ... }` body. Deliberately
 * small: it only has to understand the declaration forms the port actually
 * uses (scalars, comma lists, enum-typed fields, and fixed arrays with a
 * brace initializer), and it reports nothing rather than guessing.
 */
function parseParamsBody(body) {
  const fields = [];
  for (const stmt of body.split(';')) {
    const t = stmt.trim();
    if (!t) continue;
    const m = /^[A-Za-z_][\w:<>]*\s+([\s\S]+)$/.exec(t);
    if (!m) continue;
    for (const decl of splitTopLevel(m[1])) {
      const d = /^\s*([A-Za-z_]\w*)\s*(\[)?/.exec(decl);
      if (d) fields.push({ name: d[1], array: d[2] === '[' });
    }
  }
  return fields;
}

/**
 * Every `class X` in a header that owns a nested struct Params. The struct
 * must be found before the next `class` keyword, otherwise a class that has
 * no params of its own (Plate, which only adds storage to PlateExt) would
 * adopt the following class's struct.
 */
function findPortedClasses(src) {
  const clean = stripComments(src);
  const re = /\bclass\s+([A-Za-z_]\w*)/g;
  const starts = [];
  let m;
  while ((m = re.exec(clean)) !== null) starts.push({ cls: m[1], at: m.index });
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : clean.length;
    const region = clean.slice(starts[i].at, end);
    const sAt = region.indexOf('struct Params');
    if (sAt < 0) continue;
    const body = braceBody(region, sAt);
    if (body === null) continue;
    out.push({ cls: starts[i].cls, fields: parseParamsBody(body) });
  }
  return out;
}

/** Class name to TypeScript id: alias, else drop a trailing Ext, lowercase. */
function classToId(cls) {
  return CLASS_ALIASES[cls] ?? cls.replace(/Ext$/, '').toLowerCase();
}

/** Ported units keyed by TypeScript id, discovered from the header tree. */
async function discoverPorts() {
  const found = { engines: new Map(), effects: new Map() };
  const orphans = [];
  for (const [kind, rel] of PORT_DIRS) {
    const dir = join(PKG, 'src', rel);
    if (!existsSync(dir)) continue;
    const names = (await readdir(dir)).filter((n) => n.endsWith('.h')).sort();
    for (const name of names) {
      const header = `${rel}/${name}`;
      const src = await readFile(join(dir, name), 'utf8');
      for (const hit of findPortedClasses(src)) {
        const id = classToId(hit.cls);
        found[kind].set(id, { ...hit, header, id });
        orphans.push({ kind, id, cls: hit.cls, header });
      }
    }
  }
  return { found, orphans };
}

/**
 * A TypeScript param matches a C++ field when the snake_case name is there,
 * or when an indexed param (ratio1..ratio6) folds into an array field of
 * the same base name. Anything else is reported unmatched: that is either a
 * deliberate rename, a param the port left out, or one somebody forgot.
 * The generator does not judge which, it just makes it visible.
 */
function matchField(paramName, fields) {
  const snake = toSnake(paramName);
  const direct = fields.find((f) => f.name === snake);
  if (direct) return direct.name;
  const base = snake.replace(/\d+$/, '');
  if (base !== snake) {
    const arr = fields.find((f) => f.name === base && f.array);
    if (arr) return `${arr.name}[]`;
  }
  return null;
}

function pascal(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function pad(s, n) {
  return String(s).padEnd(n);
}

function unitBlock(kind, def, port) {
  const { header, cls, fields } = port;
  const prefix = kind === 'engines' ? 'kEngine' : 'kEffect';
  const sym = prefix + pascal(def.id);
  const rows = def.params.map((p) => ({
    name: p.name,
    min: String(p.min),
    max: String(p.max),
    def: String(p.default),
    unit: p.unit ?? '',
    cpp: matchField(p.name, fields) ?? '',
  }));
  const w = (k, min) => Math.max(min, ...rows.map((r) => r[k].length));
  const wName = w('name', 4);
  const wMin = w('min', 3);
  const wMax = w('max', 3);
  const wDef = w('def', 7);
  const wCpp = w('cpp', 9);

  const out = [];
  out.push(`/* ${def.id}: ${def.label}`);
  out.push(` * ${header} class ${cls}, ${def.params.length} params.`);
  out.push(
    ` *   ${pad('name', wName)}  ${pad('min', wMin)}  ${pad('max', wMax)}  ` +
      `${pad('default', wDef)}  ${pad('c++ field', wCpp)}  unit`,
  );
  for (const r of rows) {
    out.push(
      ` *   ${pad(r.name, wName)}  ${pad(r.min, wMin)}  ${pad(r.max, wMax)}  ` +
        `${pad(r.def, wDef)}  ${pad(r.cpp || '-', wCpp)}  ${r.unit}`.trimEnd(),
    );
  }
  const unmatched = rows.filter((r) => !r.cpp).map((r) => r.name);
  const extra = fields
    .filter((f) => !def.params.some((p) => matchField(p.name, [f])))
    .map((f) => f.name);
  if (unmatched.length || extra.length) out.push(' *');
  if (unmatched.length) out.push(' * No C++ field of that name: ' + unmatched.join(', '));
  if (extra.length) out.push(' * C++ fields with no ParamSpec: ' + extra.join(', '));
  out.push(' */');
  out.push(`inline constexpr int ${sym}ParamCount = ${def.params.length};`);
  out.push(`inline constexpr float ${sym}Defaults[${sym}ParamCount] = {`);
  const defs = def.params.map((p) => paramFloat(p.default));
  for (let i = 0; i < defs.length; i += 8) {
    const row = defs.slice(i, i + 8);
    out.push(`  ${row.join(', ')}${i + 8 >= defs.length ? '' : ','}`);
  }
  out.push('};');
  return out.join('\n');
}

async function generateParamsHeader() {
  if (!existsSync(TS_DIST)) {
    throw new Error(
      `${relative(REPO, TS_DIST)} not found. Run: npm run build -w packages/bellows`,
    );
  }
  await warnIfDistStale();
  const lib = await import(pathToFileURL(TS_DIST).href);
  lib.registerBuiltins();
  const defs = {
    engines: new Map(lib.listEngines().map((d) => [d.id, d])),
    effects: new Map(lib.listEffects().map((d) => [d.id, d])),
  };

  const head = [
    '/* Generated from the ParamSpec arrays in packages/bellows. Do not edit.',
    ' *',
    ' * This file exists for parity, not for the audio path. The TypeScript',
    ' * library is the single source of truth for every param name, range and',
    ' * default; the C++ port copies them by hand into each class\'s nested',
    ' * struct Params. Nothing here is meant to be included by an engine.',
    ' * Regenerate after any ParamSpec change (node tools/gen-tables.mjs): if a',
    ' * param was added, renamed or re-defaulted in TypeScript and the C++ side',
    ' * was not updated, it shows up in this diff. tools/gen-tables.mjs --check',
    ' * fails when the committed copy is stale, so CI catches the omission.',
    ' *',
    ' * Param names are comments, never data. A string table of param names',
    ' * would put every name of every unit in flash and invite a string keyed',
    ' * lookup, which is exactly what the port exists to avoid. Only the',
    ' * defaults are emitted as constants, so a caller can seed a Params',
    ' * struct or a preset from the same numbers the JS uses. */',
    '#pragma once',
    '',
    'namespace bellows {',
    'namespace params {',
    '',
  ].join('\n');

  /*
   * Emitted in registry order, not in header order, so the file stays
   * stable when a header is renamed or a class moves between headers.
   */
  const { found, orphans } = await discoverPorts();
  const blocks = [];
  const unported = { engines: [], effects: [] };
  const matched = new Set();

  for (const kind of ['engines', 'effects']) {
    for (const [id, def] of defs[kind]) {
      const port = found[kind].get(id);
      if (!port) {
        unported[kind].push(id);
        continue;
      }
      blocks.push(unitBlock(kind, def, port));
      matched.add(`${kind}/${id}`);
    }
  }
  const unknown = orphans
    .filter((o) => !matched.has(`${o.kind}/${o.id}`))
    .map((o) => `${o.cls} (${o.header})`);

  const tail = [
    '/* Not ported to C++ yet, listed so the gap stays visible:',
    ` *   engines: ${unported.engines.join(', ') || 'none'}`,
    ` *   effects: ${unported.effects.join(', ') || 'none'}`,
    ...(unknown.length
      ? [
          ' *',
          ' * C++ classes with a struct Params and no ParamSpec of that id.',
          ' * Either the id differs and needs a CLASS_ALIASES entry in',
          ' * tools/gen-tables.mjs, or the unit has no TypeScript counterpart:',
          ...unknown.map((u) => ` *   ${u}`),
        ]
      : []),
    ' */',
    '',
    '}  // namespace params',
    '}  // namespace bellows',
    '',
  ].join('\n');

  return `${head}${blocks.join('\n\n')}\n\n${tail}`;
}

/*
 * The dist build is what gets read, so a stale one silently generates last
 * week's params. mtimes are not reliable in a fresh CI checkout, so this
 * warns and keeps going rather than failing.
 */
async function warnIfDistStale() {
  let newest = 0;
  const walk = async (dir) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.name.endsWith('.ts')) newest = Math.max(newest, (await stat(p)).mtimeMs);
    }
  };
  try {
    await walk(join(TS_PKG, 'src'));
    const built = (await stat(TS_DIST)).mtimeMs;
    if (newest > built) {
      process.stderr.write(
        'warning: packages/bellows/src is newer than dist/bellows.js. ' +
          'Run: npm run build -w packages/bellows\n',
      );
    }
  } catch {
    /* mtimes are advisory, never fatal */
  }
}

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

async function emit(rel, content, check) {
  const path = join(PKG, rel);
  const old = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (old === content) {
    process.stdout.write(`ok       ${rel}\n`);
    return true;
  }
  if (check) {
    process.stdout.write(`STALE    ${rel}${old === null ? ' (missing)' : ''}\n`);
    return false;
  }
  await writeFile(path, content, 'utf8');
  process.stdout.write(`${pad(old === null ? 'created' : 'updated', 8)} ${rel}\n`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length) : 'all';
  if (!['all', 'blep', 'params'].includes(only)) {
    process.stderr.write(`unknown --only=${only}, expected blep or params\n`);
    process.exit(2);
  }

  let ok = true;
  if (only === 'all' || only === 'blep') {
    ok = (await emit('src/bellows/dsp/blep_tables.h', generateBlepHeader(), check)) && ok;
  }
  if (only === 'all' || only === 'params') {
    ok = (await emit('src/bellows/params.gen.h', await generateParamsHeader(), check)) && ok;
  }
  if (!ok) {
    process.stderr.write('\ngenerated output is out of date. Run: node tools/gen-tables.mjs\n');
    process.exit(1);
  }
}

/* Only run when invoked as a script. Importing this module (a test, or a
 * future tool reusing buildTables) must never rewrite the tree. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(2);
  });
}

export { buildTables, generateBlepHeader, generateParamsHeader };
