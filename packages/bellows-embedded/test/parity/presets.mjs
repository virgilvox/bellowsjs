/*
 * Value parity for bellows/presets/instruments.h.
 *
 * The preset table is 50 rows of floats transcribed by hand out of
 * packages/bellows/src/presets/instruments.ts. Nothing about a wrong one
 * is audible as wrong: the instrument plays, and it plays in a voice
 * nobody chose. tables.mjs makes that argument for scales and chords; this
 * is the same argument for presets, and it needs a second thing that file
 * does not, because a preset is a JS param NAME landing in a C++ FIELD and
 * the two are spelled differently.
 *
 * So the mapping is not written here. It is parsed out of
 * src/bellows/params.gen.h, which tools/gen-tables.mjs generates from the
 * TypeScript ParamSpec arrays: the `c++ field` column of every param of
 * every engine. A wrong mapping in instruments.h therefore cannot be
 * matched by the same wrong mapping in this file, which is the whole point
 * of not writing it twice.
 *
 * Three properties are checked, per preset:
 *
 *   Every ParamSpec param whose C++ field the preset struct carries has
 *   the value the TypeScript gives it, or, where the TypeScript is silent,
 *   the ParamSpec default. That second half is what pins the columns a
 *   preset does not name (harmonic's formant_shift, va's six on sub-bass)
 *   to something other than whatever was typed.
 *
 *   Every field the C++ writes is reached by some ParamSpec row, so a
 *   column that exists in the header and in no engine is a failure rather
 *   than a curiosity.
 *
 *   And the row itself: id, label, family, engine id, channel gain and
 *   octave, plus the insert effect and its params.
 *
 *   node test/parity/presets.mjs            report
 *   node test/parity/presets.mjs --check    exit non-zero on any mismatch
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const SRC = join(PKG, '..', 'bellows', 'src');

const { INSTRUMENT_PRESETS } = await import(join(SRC, 'presets/instruments.ts'));

/*
 * engine or effect id -> [{ js, cpp, dflt }], from the generated comments.
 * A param the port has no field for carries '-' in that column and simply
 * never matches anything below.
 */
function readSpecs() {
  const gen = readFileSync(join(PKG, 'src/bellows/params.gen.h'), 'utf8');
  const specs = {};
  let current = null;
  for (const line of gen.split('\n')) {
    const head = line.match(/^\/\* ([a-zA-Z0-9]+): /);
    if (head) {
      current = head[1];
      specs[current] = [];
      continue;
    }
    if (!current) continue;
    if (line.startsWith(' */')) {
      current = null;
      continue;
    }
    const row = line.match(/^ \*   (\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (row && row[1] !== 'name') {
      specs[current].push({ js: row[1], cpp: row[5], dflt: Number(row[4]) });
    }
  }
  return specs;
}

/*
 * The C++ field a ParamSpec param lands in. An indexed param folds into an
 * array field, which gen-tables.mjs writes as `ratio[]`: ratio2 is
 * ratio[1], partial13 is partial[12]. That rule is the generator's, in
 * matchField(), and this is the only place it has to be repeated.
 */
function fieldOf(spec) {
  if (!spec.cpp.endsWith('[]')) return spec.cpp;
  const n = spec.js.match(/(\d+)$/);
  return n ? `${spec.cpp.slice(0, -2)}[${Number(n[1]) - 1}]` : spec.cpp;
}

/*
 * Build the dumper here rather than expecting it to exist, the way
 * tables.mjs and parity.mjs do: test/parity/build is gitignored, so a
 * fresh clone has nothing in it.
 */
function buildDumper() {
  const bin = join(HERE, 'build', 'presets');
  mkdirSync(join(HERE, 'build'), { recursive: true });
  execFileSync(
    'c++',
    ['-std=c++17', '-O2', '-Wall', '-Wextra', '-I', join(PKG, 'src'), join(HERE, 'presets.cpp'),
     '-o', bin],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return bin;
}

const specs = readSpecs();
const cpp = JSON.parse(execFileSync(buildDumper()).toString());
const byId = new Map(cpp.map((p) => [p.id, p]));

/* Relative, because cutoff is 3800 and level is 0.15 and a fixed epsilon
 * cannot serve both. Everything here is a float printed to nine
 * significant digits, so this only absorbs the double-to-float step. */
const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6);

let checked = 0;
const failures = [];
const fail = (msg) => failures.push(msg);
const counts = {};
const bump = (k) => (counts[k] = (counts[k] || 0) + 1);

for (const js of INSTRUMENT_PRESETS) {
  const c = byId.get(js.id);
  if (!c) {
    fail(`${js.id}: missing from the C++ table`);
    continue;
  }
  bump(js.engineId);

  if (c.engine !== js.engineId) fail(`${js.id}: engine ${c.engine} != ${js.engineId}`);
  if (c.family !== js.family) fail(`${js.id}: family ${c.family} != ${js.family}`);
  if (c.label !== js.label) fail(`${js.id}: label ${c.label} != ${js.label}`);
  if (!near(c.gain, js.gain ?? 0.8)) fail(`${js.id}: gain ${c.gain} != ${js.gain ?? 0.8}`);
  if (c.octave !== (js.octave ?? 0)) fail(`${js.id}: octave ${c.octave} != ${js.octave ?? 0}`);
  checked += 5;

  const spec = specs[js.engineId];
  if (!spec) {
    fail(`${js.id}: no ParamSpec block for ${js.engineId} in params.gen.h`);
    continue;
  }
  for (const s of spec) {
    const field = fieldOf(s);
    if (!(field in c.params)) continue; /* a field the preset struct does not carry */
    const want = js.params[s.js] !== undefined ? js.params[s.js] : s.dflt;
    checked++;
    if (!near(c.params[field], want)) {
      fail(`${js.id}: ${s.js} -> ${field} is ${c.params[field]}, TypeScript says ${want}`);
    }
  }
  /* Every field the C++ writes has to have been reached by some spec row,
   * or the header has a column the TypeScript does not name. */
  for (const field of Object.keys(c.params)) {
    if (!spec.some((s) => fieldOf(s) === field)) {
      fail(`${js.id}: C++ field ${field} matches no ParamSpec`);
    }
  }

  /* Insert fx. The C++ row carries one insert, since no preset has two. */
  const jsFx = js.fx && js.fx.length ? js.fx[0] : null;
  if (js.fx && js.fx.length > 1) fail(`${js.id}: TypeScript has ${js.fx.length} inserts`);
  if (!jsFx) {
    if (c.fx) fail(`${js.id}: C++ has a ${c.fx.effectId} insert and TypeScript does not`);
  } else if (!c.fx) {
    fail(`${js.id}: missing the ${jsFx.effectId} insert`);
  } else if (c.fx.effectId !== jsFx.effectId) {
    fail(`${js.id}: insert ${c.fx.effectId} != ${jsFx.effectId}`);
  } else {
    const fxSpec = specs[jsFx.effectId];
    for (const [field, v] of Object.entries(c.fx.params)) {
      /* tapeDelay has no port and so no ParamSpec block here; its three
       * surviving params are compared by name against the TypeScript. */
      const s = fxSpec ? fxSpec.find((row) => fieldOf(row) === field) : null;
      const jsName = s ? s.js : field;
      if (fxSpec && !s) {
        fail(`${js.id}: ${jsFx.effectId} field ${field} matches no ParamSpec`);
        continue;
      }
      const want = jsFx.params[jsName];
      if (want === undefined) {
        fail(`${js.id}: ${jsFx.effectId}.${jsName} is set in C++ and not in TypeScript`);
        continue;
      }
      checked++;
      if (!near(v, want)) {
        fail(`${js.id}: ${jsFx.effectId}.${jsName} is ${v}, TypeScript says ${want}`);
      }
    }
  }
}

for (const c of cpp) {
  if (!INSTRUMENT_PRESETS.some((p) => p.id === c.id)) {
    fail(`${c.id}: in the C++ table and not in the TypeScript`);
  }
}
if (cpp.length !== INSTRUMENT_PRESETS.length) {
  fail(`table has ${cpp.length} rows, TypeScript has ${INSTRUMENT_PRESETS.length} presets`);
}

console.log('preset parity: bellows/presets/instruments.h against src/presets/instruments.ts');
console.log('param names mapped through src/bellows/params.gen.h, not by hand');
console.log(`\n${'engine'.padEnd(12)}${'presets'.padStart(8)}`);
for (const id of Object.keys(counts).sort()) {
  console.log(`${id.padEnd(12)}${String(counts[id]).padStart(8)}`);
}
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  ${f}`);
}
console.log(
  `\n${failures.length === 0 ? 'PASS' : 'FAIL'}: ${cpp.length} presets, ` +
    `${checked} values compared, ${failures.length} failures`,
);
if (process.argv.includes('--check') && failures.length) process.exit(1);
