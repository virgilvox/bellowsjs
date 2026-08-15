#!/usr/bin/env node
/*
 * Codegen that keeps the TypeScript library the single source of truth for
 * anything the C++ port has to copy by hand.
 *
 * Three outputs:
 *
 *   src/bellows/dsp/blep_tables.h   the Kaiser windowed sinc step and blamp
 *                                   residual tables, run through the exact
 *                                   algorithm in packages/bellows/src/dsp/
 *                                   oscillators.ts so the C++ oscillator
 *                                   aliases the same way the JS one does.
 *
 *   src/bellows/dsp/wavetable_tables.h  the band limited mipmap of the four
 *                                   frame morph table (sine, triangle, saw,
 *                                   square) that engines/wavetable.ts builds
 *                                   at runtime. Built by calling the
 *                                   library's own WavetableSet.fromFrames,
 *                                   so the FFT truncation is not copied.
 *                                   Its length is a build-time choice and
 *                                   the file is large: see the section below
 *                                   for the byte cost of each.
 *
 *   src/bellows/params.gen.h        one comment block per ported engine and
 *                                   effect listing every ParamSpec with its
 *                                   min, max and default, plus a constexpr
 *                                   array of the defaults.
 *
 * Usage, from packages/bellows-embedded:
 *
 *   node tools/gen-tables.mjs             regenerate all three outputs
 *   node tools/gen-tables.mjs --check     regenerate into memory, exit 1 if
 *                                         the committed output differs
 *   node tools/gen-tables.mjs --only=blep|wavetable|params
 *   node tools/gen-tables.mjs --wt-length=2048   emit the full mipmap
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

/*
 * WARNING, and it has already cost something.
 *
 * This is a hand copy of buildTables() in
 * packages/bellows/src/dsp/oscillators.ts, not a call into it, because the
 * library does not export its residual tables. So the emitted header's own
 * claim, "Generated from src/dsp/oscillators.ts", is not literally true, and
 * `--check` compares this copy against the header it wrote from the same
 * copy. It cannot see the library at all.
 *
 * Measured consequence: the BLAMP construction was corrected in the
 * TypeScript and `node tools/gen-tables.mjs --check` still reported
 * `ok src/bellows/dsp/blep_tables.h`, because this copy still had the old
 * one. The C++ triangle would have kept a defect the TypeScript had just
 * shed, and the drift check would have said everything was fine.
 *
 * If you change either copy, change both, and prefer making the library
 * export the tables so this one can go away.
 */
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
  /*
   * blamp residual: the integral of (step - unit step), with the unit step
   * integrated ANALYTICALLY per cell. Must stay identical to buildTables()
   * in packages/bellows/src/dsp/oscillators.ts, and see the warning above
   * this function about why that is a hazard rather than a convenience.
   */
  const ramp = new Float64Array(n);
  const cell = 1 / TABLE_RES;
  let acc2 = 0;
  for (let i = 1; i < n; i++) {
    const d0 = (i - 1) / TABLE_RES - KERNEL_HALF;
    const d1 = i / TABLE_RES - KERNEL_HALF;
    const sInt = ((step[i - 1] + step[i]) / 2) * cell;
    const uInt = d1 <= 0 ? 0 : d0 >= 0 ? cell : d1;
    acc2 += sInt - uInt;
    ramp[i] = acc2;
  }
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
/* (b) Wavetable morph mipmap                                          */
/* ------------------------------------------------------------------ */

/*
 * The default 'wavetable' engine builds a four frame morph table at every
 * sample rate it sees and caches it. On an MCU there is no FFT at boot and
 * no heap to cache into, so the mipmap goes in flash, and its size is the
 * whole question.
 *
 * levels * frames * length * 4 bytes, with levels fixed by the length
 * (log2(length) - 1: the top level keeps length/2 - 1 harmonics and each
 * level below halves that, down to 1):
 *
 *   length  levels     bytes   worst alias floor over the register
 *     2048      10   327680   -73 dB   (what the TypeScript uses)
 *     1024       9   147456   -58 dB
 *      512       8    65536   -52 dB   (the default here)
 *      256       7    28672   -46 dB
 *
 * The alias floor is measured, not estimated: render the saw frame at a
 * bin-aligned fundamental, FFT 32768 samples, take the loudest bin that is
 * not a harmonic the chosen mip level kept, relative to the fundamental.
 * The number quoted is the worst case over 30 Hz to 4 kHz. It is set by
 * linear interpolation between table points, not by the band limiting, and
 * it improves by about 12 dB per doubling of the length.
 *
 * The worst case always lands in the bass, and shortening the table is what
 * puts it there. The oscillator picks the mip level whose top harmonic
 * clears the output Nyquist, so the lowest notes get the level that keeps
 * the most harmonics, which is the one stored at only two points per period
 * of its top harmonic. At 2048 that critically sampled level is only
 * selected below 21.5 Hz, under the audio band; at 512 it is selected below
 * 86 Hz, so the bottom two octaves of the keyboard carry a -52 dB floor
 * against -62 dB and better above them. Measured at 44100 Hz.
 *
 * 512 is the default because 320 KB does not fit a part with 256 KB of
 * flash at all, and 64 KB is a quarter of it. Anyone with the flash should
 * regenerate at 2048 and get exactly what the browser plays:
 *
 *   node tools/gen-tables.mjs --only=wavetable --wt-length=2048
 *
 * The committed header records the length it was generated at, and a run
 * with no --wt-length regenerates at THAT length rather than at the default,
 * so --check compares the data and not the choice.
 */
const WT_DEFAULT_LENGTH = 512;
const WT_SAMPLE_RATE = 44100;

/*
 * WARNING, the same one that sits over buildTables above.
 *
 * This is a hand copy of buildMorphFrames() in
 * packages/bellows/src/engines/wavetable.ts, because the library does not
 * export it: it is private to the module that builds the default set. The
 * band limiting is NOT copied (WavetableSet.fromFrames does that, and it is
 * exported), so what can drift here is only these four closed forms.
 *
 * checkMorphFramesAgainstLibrary() below closes that gap rather than leaving
 * it to a comment: it builds a set from this copy at the library's own
 * length and compares every sample of every level against the set the
 * shipped engine actually uses. Generation fails if they differ.
 */
function buildMorphFrames(n) {
  const sine = new Float32Array(n);
  const tri = new Float32Array(n);
  const saw = new Float32Array(n);
  const square = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    sine[i] = Math.sin(2 * Math.PI * t);
    tri[i] = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
    saw[i] = 2 * t - 1;
    square[i] = t < 0.5 ? 1 : -1;
  }
  return [sine, tri, saw, square];
}

/*
 * The set the shipped engine is playing, read off a voice.
 *
 * `osc` and `set` are private to the TypeScript and ordinary properties at
 * runtime, which is the only way to see the default set at all: the module
 * caches it and exports neither it nor the function that builds it. Reading
 * them is deliberate, and tables.mjs reads the Markov tables the same way
 * for the same reason. If the shape here ever changes this throws rather
 * than silently skipping the comparison.
 */
function libraryDefaultSet(lib, sampleRate) {
  const voice = lib.wavetableEngine.createVoice(sampleRate, {}, lib.rng('gen-tables'));
  const set = voice && voice.osc && voice.osc.set;
  if (!set || !Array.isArray(set.levels) || !Array.isArray(set.maxHarm)) {
    throw new Error(
      'cannot read the default WavetableSet off a voice (voice.osc.set). ' +
        'The engine internals moved; fix libraryDefaultSet() rather than skipping the check.',
    );
  }
  return set;
}

/*
 * Fail if the copied frames no longer produce the library's own mipmap.
 *
 * Compared at the library's length and bit for bit: both sides run the same
 * WavetableSet.fromFrames over Float32Array input, so anything other than
 * exact equality means the waveform formulas have parted company.
 */
function checkMorphFramesAgainstLibrary(lib) {
  const ref = libraryDefaultSet(lib, WT_SAMPLE_RATE);
  const mine = lib.WavetableSet.fromFrames(buildMorphFrames(ref.tableLength), WT_SAMPLE_RATE);
  if (mine.levels.length !== ref.levels.length || mine.frameCount !== ref.frameCount) {
    throw new Error('morph table shape differs from the library default set');
  }
  for (let l = 0; l < ref.levels.length; l++) {
    if (mine.maxHarm[l] !== ref.maxHarm[l]) throw new Error(`maxHarm[${l}] differs`);
    for (let f = 0; f < ref.frameCount; f++) {
      const a = mine.levels[l][f];
      const b = ref.levels[l][f];
      for (let i = 0; i < b.length; i++) {
        if (a[i] !== b[i]) {
          throw new Error(
            `buildMorphFrames() in tools/gen-tables.mjs no longer matches the one in ` +
              `packages/bellows/src/engines/wavetable.ts: level ${l} frame ${f} sample ${i}, ` +
              `${a[i]} against ${b[i]}`,
          );
        }
      }
    }
  }
  return ref;
}

/** kWtMorphLength out of the committed header, or null if there is none. */
async function committedWtLength() {
  const path = join(PKG, 'src/bellows/dsp/wavetable_tables.h');
  if (!existsSync(path)) return null;
  const m = /kWtMorphLength\s*=\s*(\d+)/.exec(await readFile(path, 'utf8'));
  return m ? Number(m[1]) : null;
}

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

async function generateWavetableHeader(check, length) {
  const lib = await loadLib(check);
  if (!isPowerOfTwo(length) || length < 16 || length > 2048) {
    throw new Error(`--wt-length=${length}: want a power of two from 16 to 2048`);
  }
  const ref = checkMorphFramesAgainstLibrary(lib);
  /*
   * Shorter tables are the same waveforms sampled less often, and exactly
   * so: buildMorphFrames evaluates at t = i / n, and 2048 / length is an
   * integer, so every sample of the short frame is a sample of the long one
   * at the same t. The band limiting is then rebuilt at the new length by
   * the library's own FFT truncation rather than decimated.
   */
  const set = lib.WavetableSet.fromFrames(buildMorphFrames(length), WT_SAMPLE_RATE);
  const levels = set.levels.length;
  const bytes = levels * set.frameCount * length * 4;

  const out = [
    '/* Generated from src/dsp/wavetable.ts and src/engines/wavetable.ts. Do not edit.',
    ' *',
    ` * The four frame morph table (sine, triangle, saw, square) at ${length} points,`,
    ` * band limited into ${levels} mip levels by WavetableSet.fromFrames.`,
    ' *',
    ` * ${bytes} bytes of .rodata: ${levels} levels * ${set.frameCount} frames * ${length} samples * 4.`,
    ` * The TypeScript builds this table at ${ref.tableLength} points, which would be`,
    ` * ${ref.levels.length * ref.frameCount * ref.tableLength * 4} bytes. tools/gen-tables.mjs carries the measured alias floor`,
    ' * of each length and why this one is the default. Change it with',
    ' * --wt-length, which also changes the level count. */',
    '#pragma once',
    '',
    'namespace bellows {',
    `inline constexpr int kWtMorphFrames = ${set.frameCount};`,
    `inline constexpr int kWtMorphLength = ${length};`,
    `inline constexpr int kWtMorphLevels = ${levels};`,
    '/* Highest harmonic kept at each level, strictly decreasing down to 1. */',
    `inline constexpr int kWtMorphMaxHarm[kWtMorphLevels] = {${set.maxHarm.join(', ')}};`,
    '',
    '/* One contiguous blob, [level][frame][sample], so it needs no pointers',
    ' * and therefore no relocations. */',
    'inline constexpr float kWtMorphData[kWtMorphLevels][kWtMorphFrames][kWtMorphLength] = {',
  ];
  const FRAME_NAMES = ['sine', 'triangle', 'saw', 'square'];
  for (let l = 0; l < levels; l++) {
    out.push(`  /* level ${l}, harmonics 1..${set.maxHarm[l]} */`);
    out.push('  {');
    for (let f = 0; f < set.frameCount; f++) {
      out.push(`  /* ${FRAME_NAMES[f] ?? `frame ${f}`} */`);
      out.push('  {');
      out.push(formatRows(set.levels[l][f]));
      out.push(f === set.frameCount - 1 ? '  }' : '  },');
    }
    out.push(l === levels - 1 ? '  }' : '  },');
  }
  out.push('};');
  out.push('');
  out.push('}  // namespace bellows');
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* (c) Param parity table                                              */
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
/*
 * C++ class name to TypeScript id, where they differ.
 *
 * Eq6 is the faithful port of eqDef, which is six bands. Eq3 is a
 * deliberate three band reduction with different default frequencies and
 * no TypeScript counterpart, so it maps to nothing on purpose: listing it
 * here would assert a parity it does not claim. Anything unmapped is
 * reported as an orphan in the generated header, which is how this file
 * noticed Eq6 the moment it appeared.
 *
 * Waveguide is the port of the StringVoice half of engines/waveguide.ts,
 * whose registered id is 'string'. The class is not called String because
 * that name is taken on an Arduino target, so the alias is the only place
 * the two names meet.
 */
const CLASS_ALIASES = {
  StereoDelayExt: 'delay',
  Eq6: 'eq',
  Waveguide: 'string',
};

/* Classes that intentionally have no TypeScript counterpart, so the
 * orphan report stays a signal rather than a standing complaint. */
const UNPORTED_BY_DESIGN = new Set(['Eq3']);

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
        if (UNPORTED_BY_DESIGN.has(hit.cls)) continue;
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

/*
 * The built bundle, imported once however many outputs want it.
 *
 * registerBuiltins() is the call the worklet and the offline renderer make,
 * so what this reads is exactly what ships. It runs once because a second
 * call would re-register every id.
 */
let libPromise = null;
function loadLib(check) {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    if (!existsSync(TS_DIST)) {
      throw new Error(
        `${relative(REPO, TS_DIST)} not found. Run: npm run build -w packages/bellows`,
      );
    }
    await warnIfDistStale(check);
    const lib = await import(pathToFileURL(TS_DIST).href);
    lib.registerBuiltins();
    return lib;
  })();
  return libPromise;
}

async function generateParamsHeader(check = false) {
  const lib = await loadLib(check);
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
/*
 * Refuse to report on a stale bundle under --check.
 *
 * This used to print a warning and then read the stale dist anyway, which
 * makes the check worse than absent: it answers a question it did not ask.
 * Measured on 2026-08-06, correcting the BLAMP construction in
 * src/dsp/oscillators.ts and then running `node tools/gen-tables.mjs --check`
 * still printed `ok src/bellows/dsp/blep_tables.h`, because the bundle it
 * compared against predated the fix. A gate that says ok while looking at
 * last week's input is the thing docs/AUDIT.md finding 11 is about.
 *
 * A plain run still only warns, because regenerating against a stale bundle
 * is a normal thing to do mid-edit and the writer sees the diff. It is
 * --check, the mode CI and a reviewer trust, that has to be fatal.
 */
async function distIsStale() {
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
    return newest > built;
  } catch {
    /* No dist at all, or an unreadable tree: the import below reports it. */
    return false;
  }
}

async function warnIfDistStale(check) {
  if (!(await distIsStale())) return;
  const msg =
    'packages/bellows/src is newer than dist/bellows.js. ' +
    'Run: npm run build -w packages/bellows';
  if (check) {
    process.stderr.write(
      `error: ${msg}\n` +
        '       --check refuses to compare against a stale bundle: it would ' +
        'report on the\n       previous build and call it ok.\n',
    );
    process.exit(2);
  }
  process.stderr.write(`warning: ${msg}\n`);
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
  if (!['all', 'blep', 'wavetable', 'params'].includes(only)) {
    process.stderr.write(`unknown --only=${only}, expected blep, wavetable or params\n`);
    process.exit(2);
  }
  /* No --wt-length means keep the length the committed header was generated
   * at, so a plain run is idempotent and --check compares the data rather
   * than second-guessing a deliberate choice. */
  const wtArg = args.find((a) => a.startsWith('--wt-length='));
  const wtLength = wtArg
    ? Number(wtArg.slice('--wt-length='.length))
    : ((await committedWtLength()) ?? WT_DEFAULT_LENGTH);

  let ok = true;
  if (only === 'all' || only === 'blep') {
    ok = (await emit('src/bellows/dsp/blep_tables.h', generateBlepHeader(), check)) && ok;
  }
  if (only === 'all' || only === 'wavetable') {
    ok =
      (await emit(
        'src/bellows/dsp/wavetable_tables.h',
        await generateWavetableHeader(check, wtLength),
        check,
      )) && ok;
  }
  if (only === 'all' || only === 'params') {
    ok = (await emit('src/bellows/params.gen.h', await generateParamsHeader(check), check)) && ok;
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

export {
  buildTables,
  buildMorphFrames,
  generateBlepHeader,
  generateWavetableHeader,
  generateParamsHeader,
};
