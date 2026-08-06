/*
 * Checks the measured figures in the project's documents against what the
 * harnesses print right now: the size report, the symbol table of the
 * sketches it links, the parity harness, the value-table harness and the
 * fastmath harness.
 *
 *   node tools/check-docs.mjs            report every row
 *   node tools/check-docs.mjs --check    exit non-zero on any mismatch
 *
 * This exists because the alternative did not work. Four separate times in
 * one working session a change moved a sketch and the tables that quote it
 * were left behind: the registry comparison rule 2 rests on, the Pluck
 * memory figures, four of the five whole-firmware rows, and the fast-math
 * kick. Each was found by hand, afterwards, by someone who happened to
 * look. `docs/AUDIT.md` finding 11 already made the general point about a
 * different generated file: a warning in a document is not a control. The
 * same is true of a number in one.
 *
 * The README was added after it went stale in 9 of its 15 rows, one of them
 * by 26 KB of flash and 152 KB of RAM, while its registry table quoted
 * numbers that contradicted HARDWARE.md's. It is the front page of the
 * package and the first thing a prospective user reads, and covering it was
 * always cheaper than correcting it a second time.
 *
 * The second widening (docs/AUDIT-2.md, the sixteen document findings) added
 * the four sources beyond the size report, plus `examples/README.md`,
 * `docs/KICKOFF.md` and the prose figures in all of them. The rule that
 * decided what to add: if a command prints it, this file checks it, and
 * anything corrected by hand gets corrected again in a month.
 *
 * The third pass added the things the second one could not see rather than
 * new documents: prose is now matched over the reflowed paragraph instead
 * of the line, because a rewrap had silently killed five claims; a table
 * row has to carry a figure, because a header line was swallowing a row
 * marker; the toolchain is pinned to the version the document names,
 * because the two installed here disagree on 36 of 37 rows; and the test
 * suite is counted with `vitest list`, because two documents stated its
 * shape and nothing checked it.
 *
 * WHAT THIS DOES NOT COVER, so nobody mistakes it for total coverage:
 * the whole-firmware Teensy table and the Daisy table (PlatformIO, the
 * Arduino core and libDaisy), the double-precision recursion table and the
 * oscillator ns table (both separate benchmarks with no source in the tree),
 * the StereoDelay memory table (arithmetic, with the overflow row verified
 * by compiling), the board capacity table (data sheets), the newlib versus
 * fastmath byte comparison in "Where the flash actually goes" (five symbols
 * summed by hand across two builds), and the standalone bundle size in the
 * HANDOFF release ritual (it needs a built `dist`, and a check that skips
 * itself when `dist` is absent is the silent-pass this file exists to
 * prevent). Those still rot by hand, and docs/HARDWARE.md says so at the
 * point where it promises reproduction.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Byte figures are reproducible on the host that measured them, and only
 * approximately anywhere else. The documents were measured on macOS with
 * PlatformIO's toolchain-gccarmnoneeabi-teensy 1.110301.0; CI installs the
 * SAME package version on Linux and four sketches come back exactly 8 bytes
 * heavier (s6_registry, s2_kit, p1_drums, p3_workstation, p6_e3_polysynth),
 * while every RAM figure and every other sketch matches. Same compiler
 * version, different host build of it.
 *
 * So --allow-host-drift relaxes the flash comparison by this many bytes and
 * prints every non-zero delta it allowed. It exists for CI and nothing else.
 * A local run stays byte exact, which is where the documents are edited and
 * where a drift would be introduced. The bound is deliberately far below what
 * the gate is for: the four rot events that motivated this file moved
 * sketches by 26 KB, 152 KB, hundreds of bytes and 2.7x, not by eight.
 */
const HOST_DRIFT_BYTES = 16;
/*
 * Relative allowance for a measured figure, see agrees(). A quarter, which is
 * wide, and the reason is in the shape of the numbers rather than in
 * convenience: a "max abs" column is the single worst sample of a difference
 * signal, so one bit of libm disagreement at that one sample moves it far
 * more than it moves an rms taken over 16384. Measured across the first CI
 * runs: saturator max abs 1.49e-7 against 1.19e-7 is 20 percent, while the
 * rms figures moved 1.0 and 5.8 percent.
 *
 * This bounds a number pasted into a document, never a gate. parity.mjs sets
 * its gates at roughly ten times their measurement, so the check that decides
 * whether the port still matches the TypeScript is forty times tighter than
 * this, and it passed on both hosts in every run.
 */
const HOST_DRIFT_RELATIVE = 0.25;
const ALLOW_HOST_DRIFT = process.argv.includes('--allow-host-drift');
let driftAllowed = 0;

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const REPO = join(PKG, '..', '..');

/* ------------------------------------------------------------------ *
 * Sources. Each returns numbers a command printed, never a constant.
 * ------------------------------------------------------------------ */

/* Every `arm-none-eabi-g++` this machine can offer: the PATH copy first,
 * then everything under the PlatformIO packages, which is the order
 * size-report.sh's own find_tool considers them in.
 *
 * The compiler is NOT interchangeable and this file used to assume it was.
 * Running the whole report under both toolchains installed here, 9.2.1 and
 * 11.3.1, moves 36 of the 37 rows: `s1_kick` 3752 against 3760, `s4_va`
 * 29560 against 28576, `s9c_fm` 5800 against 5384. So which one ran is not
 * provenance trivia, it decides the figures, and a run that picked the
 * other one would rewrite every table in HARDWARE.md by tens to hundreds
 * of bytes and call it a regression. */
function toolchains() {
  const found = [];
  try {
    found.push(execFileSync('/bin/bash', ['-c', 'command -v arm-none-eabi-g++'], { encoding: 'utf8' }).trim());
  } catch {
    /* not on PATH, which is the usual case when this runs from npm */
  }
  try {
    found.push(
      ...execFileSync('find', [join(homedir(), '.platformio', 'packages'), '-name', 'arm-none-eabi-g++', '-type', 'f'], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean),
    );
  } catch {
    /* no PlatformIO packages directory */
  }
  const seen = new Set();
  const out = [];
  for (const cxx of found) {
    if (!cxx || seen.has(cxx)) continue;
    seen.add(cxx);
    let version;
    try {
      version = execFileSync(cxx, ['-dumpversion'], { encoding: 'utf8' }).trim();
    } catch {
      continue;
    }
    out.push({ cxx, dir: dirname(cxx), version });
  }
  return out;
}

/* The document names the compiler, and this pins the run to it rather than
 * to whatever PATH happens to hold, so the same command gives the same
 * bytes on a machine with two toolchains installed. If the named one is
 * not here, that is a failure and not a silent substitution. */
const HARDWARE_PATH = join(REPO, 'docs', 'HARDWARE.md');
const TOOLCHAIN_RE = /compiled with `arm-none-eabi-g\+\+` ([\d.]+) at `-Os`/;

function pinToolchain() {
  const said = readFileSync(HARDWARE_PATH, 'utf8').match(TOOLCHAIN_RE);
  if (!said) throw new Error(`docs/HARDWARE.md no longer names a compiler: ${TOOLCHAIN_RE}`);
  const have = toolchains();
  if (have.length === 0) throw new Error('no arm-none-eabi-g++ found on PATH or under ~/.platformio/packages');
  const hit = have.find((t) => t.version === said[1]);
  if (!hit) {
    throw new Error(
      `docs/HARDWARE.md says arm-none-eabi-g++ ${said[1]}; this machine has ` +
        have.map((t) => `${t.version} (${t.cxx})`).join(', '),
    );
  }
  return hit;
}

const TOOLCHAIN = pinToolchain();

function sizes(extra) {
  const env = { ...process.env, PATH: `${TOOLCHAIN.dir}:${process.env.PATH ?? ''}` };
  if (extra) env.EXTRA_CXXFLAGS = extra;
  else delete env.EXTRA_CXXFLAGS;
  const out = execFileSync(join(HERE, 'size-report.sh'), [], { env, encoding: 'utf8' });
  const map = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([sp]\d\S*)\s+(\d+)\s+(\d+)\s*$/);
    if (m) map[m[1]] = { flash: Number(m[2]), ram: Number(m[3]) };
  }
  if (Object.keys(map).length === 0) throw new Error('size-report.sh produced no rows');
  return map;
}

function toolchainVersion() {
  return TOOLCHAIN.version;
}

/* Symbols of a linked sketch, from the elf the size report just wrote.
 *
 * Deduped by address because newlib aliases several helpers (`__adddf3`
 * and `__aeabi_dadd` are one symbol under two names), and restricted to
 * code and rodata because the delay buffer would otherwise drown
 * everything. The four-way split is mechanical on purpose: the residual
 * tables by name, everything else demangling to `bellows::`, the sketch's
 * own `main`, and whatever is left, which is newlib. The previous split
 * was by hand and estimated the DSP row by subtraction, which folded the
 * harness into it and was wrong by 2.7x in one table and 24 bytes in the
 * other. A rule a script applies cannot do that. */
function symbols(sketch) {
  /* nm from the same toolchain that linked the elf, for the reason in
   * toolchains(): mixing them reads one compiler's output with another's
   * tools. */
  const nm = join(TOOLCHAIN.dir, 'arm-none-eabi-nm');
  if (!existsSync(nm)) throw new Error(`no arm-none-eabi-nm beside ${TOOLCHAIN.cxx}`);
  const elf = join(PKG, 'test', 'build', `${sketch}.elf`);
  if (!existsSync(elf)) throw new Error(`no elf for ${sketch}; the size report should have built it`);
  const out = execFileSync(nm, ['-S', '-C', elf], { encoding: 'utf8' });
  const IN_FLASH = new Set(['T', 't', 'W', 'w', 'R', 'r', 'V', 'v']);
  const TABLES = new Set(['bellows::kBlepStep', 'bellows::kBlepRamp']);
  const byName = new Map();
  const byAddr = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(/^([0-9a-f]+)\s+([0-9a-f]+)\s+(\S)\s+(.+)$/);
    if (!m) continue;
    const [, addr, hex, type, name] = m;
    const size = parseInt(hex, 16);
    if (!byName.has(name)) byName.set(name, size);
    if (IN_FLASH.has(type) && !byAddr.has(addr)) byAddr.set(addr, { size, name });
  }
  if (byAddr.size === 0) throw new Error(`nm found no sized symbols in ${sketch}.elf`);
  let tables = 0;
  let bellows = 0;
  let mainFn = 0;
  let newlib = 0;
  for (const { size, name } of byAddr.values()) {
    if (TABLES.has(name)) tables += size;
    else if (name.startsWith('bellows::')) bellows += size;
    else if (name === 'main') mainFn += size;
    else newlib += size;
  }
  return { sym: (n) => byName.get(n), tables, bellows, main: mainFn, newlib, sum: tables + bellows + mainFn + newlib };
}

/* The three harnesses that print measured numbers rather than sizes. Each
 * runs the same command the documents tell a reader to run. */
function runInLibrary(script) {
  return execFileSync('npx', ['vite-node', join(PKG, 'test', 'parity', script)], {
    cwd: join(REPO, 'packages', 'bellows'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

/* Columns collide in the harness output when a module name is long
 * (`saturator_soft   1.43e-7   1.19e-70.0000015`), so the mantissas are
 * matched shape-first rather than by splitting on whitespace. Both
 * mantissa columns are three significant figures with a one-digit
 * exponent; the gate column never carries an exponent. */
const PARITY_ROW = /^(\S+)\s+(\d\.\d\de[+-]\d)\s*(\d\.\d\de[+-]\d)\s*([\d.]+)\s+(pass|fail)\b/;

function parity() {
  const out = runInLibrary('parity.mjs');
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(PARITY_ROW);
    if (m) map.set(m[1], { rel: Number(m[2]), abs: Number(m[3]), gate: Number(m[4]), result: m[5] });
  }
  if (map.size === 0) throw new Error('parity.mjs produced no rows');
  return { row: (n) => map.get(n), rows: map.size };
}

function tables() {
  const out = runInLibrary('tables.mjs');
  const map = new Map();
  let total = 0;
  let bad = 0;
  for (const line of out.split('\n')) {
    if (/^group\s+rows/.test(line)) continue;
    /* HARDWARE.md prints this table two groups to a line. */
    for (const m of line.matchAll(/([a-z]+)\s+(\d+)\s+(\d+)\s+(pass|fail)\b/g)) {
      map.set(m[1], { rows: Number(m[2]), bad: Number(m[3]) });
      total += Number(m[2]);
      bad += Number(m[3]);
    }
  }
  if (map.size === 0) throw new Error('tables.mjs produced no groups');
  return { group: (n) => map.get(n), rows: total, bad };
}

function fastmath() {
  const out = execFileSync('npm', ['run', '--silent', 'fastmath'], {
    cwd: PKG,
    encoding: 'utf8',
  });
  const map = new Map();
  for (const line of out.split('\n')) {
    /* `Pow (rel)` and `Exp2 wide` carry a second word that is part of the
     * label rather than of the measurement. The row was silently invisible
     * for a while because the pattern stopped at the first token. */
    const m = line.match(/^(\S+(?: wide)?)(?: \((?:rel|abs)\))?\s+max (?:abs|rel)\s+([\d.e+-]+)\s+\(bound\s+([\d.e+-]+)\)/);
    if (m) map.set(m[1], { measured: Number(m[2]), bound: Number(m[3]) });
  }
  if (map.size === 0) throw new Error('the fastmath harness produced no rows');
  return { fn: (n) => map.get(n) };
}

/* The library's test-suite shape, which two documents quote and neither
 * could check: `npx vitest list` collects every file and case without
 * running any of them, in about 4 seconds. Counting them is a command, so
 * this counts them. */
function suite() {
  const out = execFileSync('npx', ['vitest', 'list'], {
    cwd: join(REPO, 'packages', 'bellows'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const files = new Set();
  let cases = 0;
  for (const line of out.split('\n')) {
    const m = line.match(/^(\S+\.test\.ts) > /);
    if (!m) continue;
    files.add(m[1]);
    cases++;
  }
  if (cases === 0) throw new Error('vitest list produced no cases');
  return { files: files.size, cases };
}

/* Memoised so a document that quotes nothing from a harness never pays for
 * it, and so a harness that IS quoted runs exactly once. */
const once = (f) => {
  let v;
  let done = false;
  return () => {
    if (!done) {
      v = f();
      done = true;
    }
    return v;
  };
};

/* The size report is eager and runs first, because `symbols()` reads the
 * elf files it leaves behind and the fast-math pass overwrites them. */
const base = sizes(null);
const SYMBOL_SKETCHES = ['s4_va', 's5_all'];
const syms = {};
for (const s of SYMBOL_SKETCHES) syms[s] = symbols(s);
const fm = sizes('-DBELLOWS_FAST_MATH=1');

const getParity = once(parity);
const getTables = once(tables);
const getFastmath = once(fastmath);
const getToolchain = once(toolchainVersion);
const getSuite = once(suite);

const value = (sketch, col) => {
  const src = col.endsWith('Fm') ? fm : base;
  const key = col.startsWith('flash') ? 'flash' : 'ram';
  const row = src[sketch];
  return row === undefined ? undefined : row[key];
};
const kb = (bytes) => bytes / 1024;
const pct = (part, whole) => (part * 100) / whole;

/* ------------------------------------------------------------------ *
 * What each document claims.
 * ------------------------------------------------------------------ */

/* Which sketch backs which table row. The marker is enough of the line to
 * find it uniquely; the columns say what the numbers in that line mean, in
 * the order they appear. `flash` and `ram` are the default build, the `Fm`
 * suffix is the same sketch with BELLOWS_FAST_MATH=1. */
const HARDWARE_ROWS = [
  // rule 2, the no-registry argument
  { marker: '| `Kick` used directly |', sketch: 's1_kick', cols: ['flash', 'ram'] },
  { marker: '| through `Bank<Kick>` with a runtime index |', sketch: 's9b_bank1', cols: ['flash', 'ram'] },
  { marker: '| through a string-keyed registry of five engines |', sketch: 's6_registry', cols: ['flash', 'ram'] },

  // the fast-math table
  ...['s1_kick', 's3_pluck', 's9g_tube', 'p1_drums', 's9e_westcoast', 's4_va', 'p2_poly8', 's9f_formant', 's5_all', 's9m_seq'].map(
    (s) => ({ marker: `| \`${s}\` | `, sketch: s, cols: ['flash', 'flashFm'], pct: true }),
  ),

  // per module
  { marker: '| `theory/` (scales, chords, tuning, notes) |', sketch: 's9l_theory', cols: ['flash', 'ram'] },
  { marker: '| `fx/dynamics` |', sketch: 's9i_dynamics', cols: ['flash', 'ram'] },
  { marker: '| `fx/modfx` |', sketch: 's9j_modfx', cols: ['flash', 'ram'] },
  { marker: '| `engines/tube` |', sketch: 's9g_tube', cols: ['flash', 'ram'] },
  { marker: '| `seq/` (euclid, arp, CA, lsystem, tempomap) |', sketch: 's9m_seq', cols: ['flash', 'ram'] },
  { marker: '| `engines/fm` |', sketch: 's9c_fm', cols: ['flash', 'ram'] },
  { marker: '| `fx/saturator` |', sketch: 's9h_saturator', cols: ['flash', 'ram'] },
  { marker: '| `fx/plate` |', sketch: 's9k_plate', cols: ['flash', 'ram'] },
  { marker: '| `engines/modal` |', sketch: 's9d_modal', cols: ['flash', 'ram'] },
  { marker: '| `kernel` |', sketch: 's9n_kernel', cols: ['flash', 'ram'] },
  { marker: '| `engines/westcoast` |', sketch: 's9e_westcoast', cols: ['flash', 'ram'] },
  { marker: '| `engines/formant` |', sketch: 's9f_formant', cols: ['flash', 'ram'] },

  // per-shape oscillator dispatch, flash only
  { marker: '| `Process()` | `s10a_osc_runtime` |', sketch: 's10a_osc_runtime', cols: ['flash'] },
  { marker: '| `ProcessSaw()` | `s10b_osc_saw` |', sketch: 's10b_osc_saw', cols: ['flash'] },
  { marker: '| `ProcessTriangle()` | `s10c_osc_tri` |', sketch: 's10c_osc_tri', cols: ['flash'] },
  { marker: '| `ProcessSine()` | `s10d_osc_sine` |', sketch: 's10d_osc_sine', cols: ['flash'] },

  // realistic firmware profiles
  { marker: '| kick only | `s1_kick` |', sketch: 's1_kick', cols: ['flash', 'ram'] },
  { marker: '| kick only, `BELLOWS_FAST_MATH=1` |', sketch: 's1_kick', cols: ['flashFm', 'ramFm'] },
  { marker: '| three piece kit | `s2_kit` |', sketch: 's2_kit', cols: ['flash', 'ram'] },
  { marker: '| kit plus EQ and a 250 ms delay | `p1_drums` |', sketch: 'p1_drums', cols: ['flash', 'ram'] },
  { marker: '| 8 voice VA poly, EQ, 250 ms delay | `p2_poly8` |', sketch: 'p2_poly8', cols: ['flash', 'ram'] },
  { marker: '| 8 VA plus 8 `Pluck<80>` plus kit, EQ, delay | `p3_workstation` |', sketch: 'p3_workstation', cols: ['flash', 'ram'] },
  { marker: '| everything constructed and driven at once | `s5_all` |', sketch: 's5_all', cols: ['flash', 'ram'] },

  // the shipped examples, freestanding
  { marker: '| `01_OneKick` | 3', sketch: 'p4_e1_onekick', cols: ['flash', 'ram'] },
  { marker: '| `02_DrumMachine` (bank plus euclid) |', sketch: 'p5_e2_drummachine', cols: ['flash', 'ram'] },
  { marker: '| `03_PolySynth` (`VoicePool<Va, 8>`) |', sketch: 'p6_e3_polysynth', cols: ['flash', 'ram'] },
  { marker: '| `04_ScalesAndTuning` |', sketch: 'p7_e4_scalestuning', cols: ['flash', 'ram'] },
  { marker: '| `05_MidiInstrument` |', sketch: 'p8_e5_midiinstrument', cols: ['flash', 'ram'] },
];

/* README.md. Markers are exact line prefixes, so `| \`Kick\` |` does not
 * also match `| \`Kick\` + \`Snare\` + \`Hat\` |` or `| \`Kick\` used
 * directly |`. */
const README_ROWS = [
  // "You pay only for what you include"
  { marker: '| baseline harness |', sketch: 's0_baseline', cols: ['flash', 'ram'] },
  { marker: '| `Kick` |', sketch: 's1_kick', cols: ['flash', 'ram'] },
  { marker: '| `Kick` + `Snare` + `Hat` |', sketch: 's2_kit', cols: ['flash', 'ram'] },
  { marker: '| `Pluck<80>` (80 Hz lowest note) |', sketch: 's3b_pluck_small', cols: ['flash', 'ram'] },
  { marker: '| `Pluck<20>` (20 Hz lowest note) |', sketch: 's3_pluck', cols: ['flash', 'ram'] },
  { marker: '| `Va` |', sketch: 's4_va', cols: ['flash', 'ram'] },
  { marker: '| `Eq3` |', sketch: 's7_eq', cols: ['flash', 'ram'] },
  { marker: '| `StereoDelay<100>` |', sketch: 's8b_delay100', cols: ['flash', 'ram'] },
  { marker: '| `StereoDelay<500>` |', sketch: 's8_delay500', cols: ['flash', 'ram'] },
  { marker: '| `theory/` (scales, chords, tunings, notes) |', sketch: 's9l_theory', cols: ['flash', 'ram'] },
  { marker: '| `seq/` (euclid, arp, CA, lsystem, tempomap) |', sketch: 's9m_seq', cols: ['flash', 'ram'] },
  { marker: '| `Fm` |', sketch: 's9c_fm', cols: ['flash', 'ram'] },
  { marker: '| `Plate` |', sketch: 's9k_plate', cols: ['flash', 'ram'] },
  { marker: '| `kernel` |', sketch: 's9n_kernel', cols: ['flash', 'ram'] },
  { marker: '| everything, constructed and driven |', sketch: 's5_all', cols: ['flash', 'ram'] },

  // the no-registry argument, which HARDWARE.md states separately: both
  // tables quote the same three sketches, so they can now only be wrong
  // together
  { marker: '| `Kick` used directly |', sketch: 's1_kick', cols: ['flash', 'ram'] },
  { marker: '| through `Bank<Kick>`, dispatched by runtime index |', sketch: 's9b_bank1', cols: ['flash', 'ram'] },
  { marker: '| through a string-keyed registry of five engines |', sketch: 's6_registry', cols: ['flash', 'ram'] },
];

/* examples/README.md. Same five logic headers the p4 to p8 sketches
 * compile, and the file says so in a paragraph that was true while four of
 * its five rows had drifted anyway. */
const EXAMPLES_ROWS = [
  { marker: '| 01_OneKick |', sketch: 'p4_e1_onekick', cols: ['flash', 'ram'] },
  { marker: '| 02_DrumMachine |', sketch: 'p5_e2_drummachine', cols: ['flash', 'ram'] },
  { marker: '| 03_PolySynth |', sketch: 'p6_e3_polysynth', cols: ['flash', 'ram'] },
  { marker: '| 04_ScalesAndTuning |', sketch: 'p7_e4_scalestuning', cols: ['flash', 'ram'] },
  { marker: '| 05_MidiInstrument |', sketch: 'p8_e5_midiinstrument', cols: ['flash', 'ram'] },
];

const DOCS = [
  { path: join(REPO, 'docs', 'HARDWARE.md'), label: 'docs/HARDWARE.md', rows: HARDWARE_ROWS, parity: true, tables: true },
  { path: join(PKG, 'README.md'), label: 'README.md', rows: README_ROWS, parity: true },
  { path: join(PKG, 'examples', 'README.md'), label: 'examples/README.md', rows: EXAMPLES_ROWS },
  /* No tables, but it states the figures the no-registry rule rests on,
   * and it is the document a new session reads first. Both were stale. */
  { path: join(REPO, 'docs', 'HANDOFF.md'), label: 'docs/HANDOFF.md', rows: [] },
  /* A prompt a fresh session is told to paste as its first message, under
   * a heading that says "run them before you claim anything works", so a
   * wrong figure here is wrong on someone's first tool call. */
  { path: join(REPO, 'docs', 'KICKOFF.md'), label: 'docs/KICKOFF.md', rows: [] },
  /* One figure, in the AS BUILT note that records why the oscillator is
   * not what section 2.1 specifies. It is here because that note is the
   * argument against reintroducing polyBLEP and the flash cost is half of
   * it, and because a document that states a measured number should be in
   * this list on the day it states it rather than at the next audit. */
  { path: join(REPO, 'docs', 'ENGINEERING.md'), label: 'docs/ENGINEERING.md', rows: [] },
];

/*
 * Figures written as prose rather than as a table row, so the "N B" column
 * scan cannot see them.
 *
 * Each claim is a regex with one capture group per figure, searched over
 * the whole document (or over the section named by `after`, when the same
 * sentence shape appears in two places). EVERY match is checked, and a
 * claim that matches nothing is reported rather than passing silently,
 * which is the failure mode that makes a checker worse than no checker.
 */
const PROSE = [
  // ---- docs/HARDWARE.md ----
  {
    doc: 'docs/HARDWARE.md',
    re: /whole ported engine set is about (\d+) KB of flash/,
    gets: [() => kb(value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /The whole ported engine set is (\d+) KB/,
    gets: [() => kb(value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /compiled with `arm-none-eabi-g\+\+` ([\d.]+) at `-Os`/,
    gets: [() => getToolchain()],
    text: true,
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /Symbol breakdown of the VA voice sketch, (\d+) bytes of flash/,
    gets: [() => value('s4_va', 'flash')],
  },
  /* The conclusion rule 2 rests on is a ratio, and a ratio rots on its own
   * even when both figures above it are right: the README carried "thirty
   * four times the RAM" against a table that had already moved to 28. */
  {
    doc: 'docs/HARDWARE.md',
    re: /([\d.]+) times the flash and ([\d.]+) times the RAM for the same sound/,
    gets: [
      () => value('s6_registry', 'flash') / value('s1_kick', 'flash'),
      () => value('s6_registry', 'ram') / value('s1_kick', 'ram'),
    ],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`engines\/pluck\.h` costs (\d+) B and `engines\/va\.h` costs (\d+) B/,
    gets: [() => value('s3_pluck', 'flash'), () => value('s4_va', 'flash')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /The BLEP tables are (\d+) KB and shared/,
    gets: [() => kb(syms.s4_va.tables)],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`fm` costs (\d+) B and `pluck` (\d+) B where a formant voice alone costs (\d+) B/,
    gets: [() => value('s9c_fm', 'flash'), () => value('s3_pluck', 'flash'), () => value('s9f_formant', 'flash')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /together are ([\d.]+) KB of flash and (\d+) bytes of RAM/,
    gets: [() => kb(value('s9l_theory', 'flash')), () => value('s9l_theory', 'ram')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`Pluck<20>` reserves for a 20 Hz fundamental and costs (\d+) B of RAM; `Pluck<80>` costs (\d+) B/,
    gets: [() => value('s3_pluck', 'ram'), () => value('s3b_pluck_small', 'ram')],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: 'Symbol breakdown of the VA voice sketch',
    re: /\| residual tables, `kBlepStep` plus `kBlepRamp` \| (\d+) \| (\d+) %/,
    gets: [() => syms.s4_va.tables, () => pct(syms.s4_va.tables, value('s4_va', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: 'Symbol breakdown of the VA voice sketch',
    re: /\| newlib, libm and libc together \| (\d+) \| (\d+) %/,
    gets: [() => syms.s4_va.newlib, () => pct(syms.s4_va.newlib, value('s4_va', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: 'Symbol breakdown of the VA voice sketch',
    re: /\| every other `bellows::` symbol \| (\d+) \| (\d+) %/,
    gets: [() => syms.s4_va.bellows, () => pct(syms.s4_va.bellows, value('s4_va', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: 'Symbol breakdown of the VA voice sketch',
    re: /\| the sketch's own `main` \| (\d+) \| (\d+) %/,
    gets: [() => syms.s4_va.main, () => pct(syms.s4_va.main, value('s4_va', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: 'Symbol breakdown of the VA voice sketch',
    re: /Those four sum to (\d+) of the (\d+) the size report prints/,
    gets: [() => syms.s4_va.sum, () => value('s4_va', 'flash')],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: 'Symbol breakdown of the VA voice sketch',
    re: /The (\d+) byte remainder/,
    gets: [() => value('s4_va', 'flash') - syms.s4_va.sum],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`__kernel_rem_pio2f` is (\d+) bytes and `powf` (\d+)/,
    gets: [() => syms.s4_va.sym('__kernel_rem_pio2f'), () => syms.s4_va.sym('powf')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`s3_pluck` is now (\d+) bytes at the default and (\d+) with the flag/,
    gets: [() => value('s3_pluck', 'flash'), () => value('s3_pluck', 'flashFm')],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: '| `s5_all` | bytes | share of flash |',
    re: /\| `kBlepStep` and `kBlepRamp` residual tables \| (\d+) \| (\d+) %/,
    gets: [() => syms.s5_all.tables, () => pct(syms.s5_all.tables, value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: '| `s5_all` | bytes | share of flash |',
    re: /\| newlib, libm and libc together \| (\d+) \| (\d+) %/,
    gets: [() => syms.s5_all.newlib, () => pct(syms.s5_all.newlib, value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: '| `s5_all` | bytes | share of flash |',
    re: /\| every line of bellows DSP \| (\d+) \| (\d+) %/,
    gets: [() => syms.s5_all.bellows, () => pct(syms.s5_all.bellows, value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    after: '| `s5_all` | bytes | share of flash |',
    re: /\| the sketch's own `main` \| (\d+) \| (\d+) %/,
    gets: [() => syms.s5_all.main, () => pct(syms.s5_all.main, value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /Those four sum to (\d+) of the (\d+) bytes the size report prints/,
    gets: [() => syms.s5_all.sum, () => value('s5_all', 'flash')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /The (\d+) byte gap is unsized symbols/,
    gets: [() => value('s5_all', 'flash') - syms.s5_all.sum],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`Svf::Update` is (\d+), `NoiseGen::Process` is (\d+)/,
    gets: [() => syms.s5_all.sym('bellows::Svf::Update()'), () => syms.s5_all.sym('bellows::NoiseGen::Process()')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`s5_all` 300144 to (\d+) bytes/,
    gets: [() => value('s5_all', 'ram')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /the plate tank 222684 to (\d+)/,
    gets: [() => value('s9k_plate', 'ram')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /a 100 ms stereo delay 66688 to (\d+)/,
    gets: [() => value('s8b_delay100', 'ram')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`s9e_westcoast` went 27064 to (\d+) bytes/,
    gets: [() => value('s9e_westcoast', 'flash')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`p1_drums` 29448 to (\d+)/,
    gets: [() => value('p1_drums', 'flash')],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /`StereoDelay` buffer is 192152 of (\d+) bytes, (\d+) percent/,
    gets: [() => value('s5_all', 'ram'), () => pct(192152, value('s5_all', 'ram'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /measures ([\d.e-]+) radians, which is 0\.003 cents/,
    gets: [() => getFastmath().fn('Atan2').measured],
  },
  /* The board table's Daisy cell and the paragraph restating it. This is
   * the one board where the flash figure decides something, so both the
   * share and the headroom are checked against the same 128 KB. */
  {
    doc: 'docs/HARDWARE.md',
    re: /(\d+) % of internal flash, ([\d.]+) KB spare/,
    gets: [() => pct(value('s5_all', 'flash'), 131072), () => kb(131072 - value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /(\d+) percent of the STM32H750's internal 128 KB and still leaves ([\d.]+) KB free/,
    gets: [() => pct(value('s5_all', 'flash'), 131072), () => kb(131072 - value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /The harness prints (\d+) rows in all/,
    gets: [() => getParity().rows],
  },
  /* The "after" column of the uint32 phase table is the current parity
   * measurement, so it is the same figure as the block above and can only
   * be wrong together with it now. The "before" column is history. */
  {
    doc: 'docs/HARDWARE.md',
    re: /\| `chorus` \| 3\.97e-2 \| ([\d.e-]+) \|/,
    gets: [() => getParity().row('chorus').rel],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /\| `plate` \| 2\.44e-3 \| ([\d.e-]+) \|/,
    gets: [() => getParity().row('plate').rel],
  },
  {
    doc: 'docs/HARDWARE.md',
    re: /\| `formant` \| 7\.85e-4 \| ([\d.e-]+) \|/,
    gets: [() => getParity().row('formant').rel],
  },

  // ---- README.md, the embedded package front page ----
  {
    doc: 'README.md',
    re: /That sketch costs \*\*(\d+) bytes of flash and (\d+) bytes of RAM/,
    gets: [() => value('s1_kick', 'flash'), () => value('s1_kick', 'ram')],
  },
  {
    doc: 'README.md',
    re: /in a render class with non-default parameters, costs (\d+) bytes more/,
    gets: [() => value('p4_e1_onekick', 'flash') - value('s1_kick', 'flash')],
  },
  {
    doc: 'README.md',
    re: /([\d.]+) times the flash and ([\d.]+) times the RAM for the same sound/,
    gets: [
      () => value('s6_registry', 'flash') / value('s1_kick', 'flash'),
      () => value('s6_registry', 'ram') / value('s1_kick', 'ram'),
    ],
  },
  {
    doc: 'README.md',
    re: /Measured with `arm-none-eabi-g\+\+` ([\d.]+) at `-Os`/,
    gets: [() => getToolchain()],
    text: true,
  },
  {
    doc: 'README.md',
    re: /the kick sketch is (\d+) bytes at the default and (\d+) with the flag/,
    gets: [() => value('s1_kick', 'flash'), () => value('s1_kick', 'flashFm')],
  },
  {
    doc: 'README.md',
    re: /\(Sin ([\d.e-]+), Log2 ([\d.e-]+), pitch within ([\d.]+) cents\)/,
    gets: [
      () => getFastmath().fn('Sin').measured,
      () => getFastmath().fn('Log2').measured,
      () => getFastmath().fn('CentsRatio').measured,
    ],
  },
  {
    doc: 'README.md',
    re: /the whole ported engine set is about (\d+) KB/,
    gets: [() => kb(value('s5_all', 'flash'))],
  },
  {
    doc: 'README.md',
    re: /(\d+) rows in all, plus `npm run tables`/,
    gets: [() => getParity().rows],
  },
  {
    doc: 'README.md',
    re: /than by tolerance: (\d+) rows, (\d+) mismatched/,
    gets: [() => getTables().rows, () => getTables().bad],
  },

  // ---- examples/README.md ----
  {
    doc: 'examples/README.md',
    re: /04 is (\d+) B of flash because a plucked string needs no such table, and its (\d+) B of RAM/,
    gets: [() => value('p7_e4_scalestuning', 'flash'), () => value('p7_e4_scalestuning', 'ram')],
  },

  // ---- docs/HANDOFF.md ----
  {
    doc: 'docs/HANDOFF.md',
    re: /registry of five engines costs (\d+) bytes of flash and (\d+) of RAM against (\d+) and (\d+) direct/,
    gets: [
      () => value('s6_registry', 'flash'),
      () => value('s6_registry', 'ram'),
      () => value('s1_kick', 'flash'),
      () => value('s1_kick', 'ram'),
    ],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /takes the kick from (\d+) to (\d+) bytes/,
    gets: [() => value('s1_kick', 'flash'), () => value('s1_kick', 'flashFm')],
  },
  /* The cost of the 2026-08-05 correctness work. The "before" column is
   * history and cannot be checked; the "now" column is what rots, so it is
   * the only capture group in each. */
  {
    doc: 'docs/HANDOFF.md',
    re: /\| `s5_all` \| 35104 \| (\d+) \|/,
    gets: [() => value('s5_all', 'flash')],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /\| `s3_pluck` \| 6552 \| (\d+) \|/,
    gets: [() => value('s3_pluck', 'flash')],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /\| `s9e_westcoast` \| 16784 \| (\d+) \|/,
    gets: [() => value('s9e_westcoast', 'flash')],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /went 1204 to (\d+) bytes of RAM/,
    gets: [() => value('s9e_westcoast', 'ram')],
  },
  /* The internal-against-external placement table. Restating s5_all here was
   * a deliberate exception to "reference, do not duplicate", because the
   * whole point is the contrast between the two rows, so it is checked. */
  {
    doc: 'docs/HANDOFF.md',
    re: /`s5_all`, buffers in internal SRAM \| (\d+) B \| (\d+) B/,
    gets: [() => value('s5_all', 'flash'), () => value('s5_all', 'ram')],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /`s5_all`, buffers placed externally \| (\d+) B/,
    gets: [() => value('s5_all', 'flash')],
  },
  /* The suite shape. Two documents used to state it and neither could
   * check it; the second audit found KICKOFF quoting 80 files and 1146
   * tests against HANDOFF's 81 and 1173, and both were behind the tree. */
  {
    doc: 'docs/HANDOFF.md',
    re: /Library test suite: (\d+) files, (\d+) tests/,
    gets: [() => getSuite().files, () => getSuite().cases],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /whole ported engine set is about (\d+) KB of flash/,
    gets: [() => kb(value('s5_all', 'flash'))],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /whole theory layer is (\d+) bytes of flash and (\d+) of RAM/,
    gets: [() => value('s9l_theory', 'flash'), () => value('s9l_theory', 'ram')],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /passes on (\d+) rows with the PRNG bit exact/,
    gets: [() => getParity().rows],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /(\d+) rows match the TypeScript numerically/,
    gets: [() => getParity().rows],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /plus (\d+) exactly-compared value rows/,
    gets: [() => getTables().rows],
  },
  {
    doc: 'docs/HANDOFF.md',
    re: /took it from 4e-2 to ([\d.e-]+)\)/,
    gets: [() => getParity().row('chorus').rel],
  },
  /* Anchored on a digit at both ends: `([\d.e-]+)` at the end of a sentence
   * eats the full stop, and `Number('1.39e-5.')` is NaN, which reads as a
   * mismatch against a figure that was right. */
  {
    doc: 'docs/HANDOFF.md',
    re: /chorus 3\.97e-2 to (\d[\d.e-]*\d), plate 2\.44e-3 to (\d[\d.e-]*\d), formant 7\.85e-4 to (\d[\d.e-]*\d)/,
    gets: [
      () => getParity().row('chorus').rel,
      () => getParity().row('plate').rel,
      () => getParity().row('formant').rel,
    ],
  },

  // ---- docs/ENGINEERING.md ----
  {
    doc: 'docs/ENGINEERING.md',
    re: /the two tables are (\d+) KB of flash/,
    gets: [() => kb(syms.s4_va.tables)],
  },

  // ---- docs/KICKOFF.md ----
  {
    doc: 'docs/KICKOFF.md',
    re: /engines costs (\d+) bytes of flash and (\d+) of RAM against (\d+) and (\d+) direct/,
    gets: [
      () => value('s6_registry', 'flash'),
      () => value('s6_registry', 'ram'),
      () => value('s1_kick', 'flash'),
      () => value('s1_kick', 'ram'),
    ],
  },
  {
    doc: 'docs/KICKOFF.md',
    re: /Parity passes on (\d+) rows/,
    gets: [() => getParity().rows],
  },
  {
    doc: 'docs/KICKOFF.md',
    re: /plus (\d+) exactly-compared value rows/,
    gets: [() => getTables().rows],
  },
  {
    doc: 'docs/KICKOFF.md',
    re: /npm run parity\s+(\d+) rows against the TypeScript/,
    gets: [() => getParity().rows],
  },
  {
    doc: 'docs/KICKOFF.md',
    re: /npm run tables\s+(\d+) value rows, compared exactly/,
    gets: [() => getTables().rows],
  },
];

/* The fastmath table in HARDWARE.md. One row covers `Sin` and `Cos`, whose
 * measured errors agree to the two significant figures the row prints, so
 * the row is checked against both. */
const FASTMATH_ROWS = [
  { doc: 'docs/HARDWARE.md', re: /\| `Sin`, `Cos` \| ([\d.e-]+) abs \| ([\d.e-]+) \|/, fns: ['Sin', 'Cos'] },
  { doc: 'docs/HARDWARE.md', re: /\| `Tanh` \| ([\d.e-]+) abs \| ([\d.e-]+) \|/, fns: ['Tanh'] },
  { doc: 'docs/HARDWARE.md', re: /\| `Exp2` \| ([\d.e-]+) abs \| ([\d.e-]+) \|/, fns: ['Exp2'] },
  { doc: 'docs/HARDWARE.md', re: /\| `Log2` \| ([\d.e-]+) abs \| ([\d.e-]+) \|/, fns: ['Log2'] },
  { doc: 'docs/HARDWARE.md', re: /\| `Pow` \| ([\d.e-]+) rel \| ([\d.e-]+) \|/, fns: ['Pow'] },
  { doc: 'docs/HARDWARE.md', re: /\| `Log` \| ([\d.e-]+) abs \| ([\d.e-]+) \|/, fns: ['Log'] },
  { doc: 'docs/HARDWARE.md', re: /\| `Tan` \| ([\d.e-]+) abs \| ([\d.e-]+) \|/, fns: ['Tan'] },
  { doc: 'docs/HARDWARE.md', re: /\| `Atan2` \| ([\d.e-]+) abs \| ([\d.e-]+) \|/, fns: ['Atan2'] },
  { doc: 'docs/HARDWARE.md', re: /\| `CentsRatio` \| ([\d.]+) cents \| ([\d.]+) cents \|/, fns: ['CentsRatio'] },
];

/* This file's own figure count, quoted in two documents that tell a reader
 * what it covers. Checked last and deliberately not counted in the total,
 * so the number cannot chase itself. */
const SELF = [
  { doc: 'docs/HANDOFF.md', re: /check-docs\.mjs --check` \| every figure the harnesses print[^|]*: (\d+) of them/ },
  { doc: 'docs/KICKOFF.md', re: /is the control, and it now covers (\d+) figures/ },
];

/* ------------------------------------------------------------------ *
 * Comparison. A document rounds; the harness does not.
 * ------------------------------------------------------------------ */

/* Significant digits the document chose to write, so "34 KB" is checked at
 * two digits and "30488 bytes" at five. Trailing zeros in an integer count,
 * which is what makes 20832 fail against 20856. */
function sigDigits(text) {
  const mantissa = text.replace(/[+-]/g, '').split(/e/i)[0];
  const digits = mantissa.replace('.', '').replace(/^0+/, '');
  return digits.length;
}

function agrees(text, actual) {
  if (typeof actual === 'string') return text === actual;
  if (actual === undefined || Number.isNaN(actual)) return false;
  const sig = sigDigits(text);
  if (sig === 0) return Number(text) === 0 && actual === 0;
  if (Number(text) === Number(actual.toPrecision(sig))) return true;
  /* Same host-build allowance the table rows get, for a byte figure written
   * into a sentence. Whole numbers only: a tolerance on a ratio, a percentage
   * or an error bound would be meaningless, and those are the other things
   * prose carries. */
  if (ALLOW_HOST_DRIFT && Number.isInteger(actual) && Number.isInteger(Number(text))) {
    const delta = actual - Number(text);
    if (delta !== 0 && Math.abs(delta) <= HOST_DRIFT_BYTES) {
      driftAllowed++;
      console.log(`  host drift allowed in prose: doc ${text} against ${actual}, delta ${delta}`);
      return true;
    }
  }
  /*
   * Measured parity figures move between hosts too, for the same reason the
   * byte figures do: the C++ side calls libm, and glibc and macOS disagree in
   * the last few bits of sin, exp and their neighbours, which reaches the
   * third significant figure of a difference this small. Measured on the first
   * runs: formant 1.39e-5 against 1.47e-5, 5.8 percent, and saturator 1.92e-7
   * against 1.94e-7, 1.0 percent.
   *
   * HOST_DRIFT_RELATIVE is the allowance for a documented measurement, not for
   * the gate. The gates in parity.mjs sit at roughly ten times their
   * measurement and are unaffected by this: they passed on both hosts
   * throughout. So this is about a hundred times tighter than the thing that
   * actually decides whether the port still matches.
   */
  if (ALLOW_HOST_DRIFT && Number.isFinite(actual) && Number.isFinite(Number(text))) {
    const want = Number(text);
    if (want !== 0) {
      const rel = Math.abs(actual - want) / Math.abs(want);
      if (rel <= HOST_DRIFT_RELATIVE) {
        driftAllowed++;
        console.log(
          `  host drift allowed, measured: doc ${text} against ${actual}, ` +
            `${(rel * 100).toFixed(1)} percent`,
        );
        return true;
      }
    }
  }
  return false;
}

function show(actual) {
  return typeof actual === 'string' ? actual : String(actual);
}

/* Prose is matched over the paragraph, not the line.
 *
 * These documents are hard wrapped at about 98 columns, so editing a
 * sentence rewraps it and a claim written as one sentence stops matching
 * the moment a wrap lands inside it. Five claims had gone quiet that way,
 * including both symbol-breakdown remainders, and a claim that matches
 * nothing is the failure mode this file exists to prevent.
 *
 * Whitespace runs collapse to one space so a regex can be written the way
 * the sentence reads, and the map carries every output character's source
 * offset so a hit still reports the line it is on. */
function flatten(lines) {
  const text = lines.join('\n');
  let flat = '';
  const at = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (flat.length > 0 && flat[flat.length - 1] !== ' ') {
        flat += ' ';
        at.push(i);
      }
      continue;
    }
    flat += text[i];
    at.push(i);
  }
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (flatIndex) => {
    const src = at[Math.min(flatIndex, at.length - 1)] ?? 0;
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= src) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  return { flat, lineOf };
}

/* ------------------------------------------------------------------ *
 * The check.
 * ------------------------------------------------------------------ */

let bad = 0;
let checked = 0;
let rowCount = 0;

function report(label, where, docText, actual) {
  console.log(`  MISMATCH ${label} ${where}`);
  console.log(`    doc says    ${docText}`);
  console.log(`    harness says ${show(actual)}`);
  bad++;
}

for (const doc of DOCS) {
  const { path, label, rows } = doc;
  const lines = readFileSync(path, 'utf8').split('\n');
  const missing = [];

  for (const row of rows) {
    rowCount++;
    /* Trimmed: rule 2's table is indented inside a numbered list item.
     * The line has to carry a figure as well as the marker, because a
     * table's HEADER can share a prefix with a data row elsewhere in the
     * same section: `| \`s4_va\` | bytes | share of flash |` swallowed the
     * marker for the fast-math row `| \`s4_va\` | 28576 B | ...` and the
     * comparison then ran against an empty list. */
    const idx = lines.findIndex((l) => l.trimStart().startsWith(row.marker) && /\d+ B\b/.test(l));
    if (idx < 0) {
      missing.push(row.marker);
      continue;
    }
    const line = lines[idx];
    const found = [...line.matchAll(/(\d+) B\b/g)].map((m) => Number(m[1]));
    const want = row.cols.map((c) => value(row.sketch, c));
    if (want.some((v) => v === undefined)) {
      console.log(`  ?? ${label} ${row.sketch}: not in the size report`);
      bad++;
      continue;
    }
    checked += want.length;
    let ok = want.length === found.length && want.every((v, i) => v === found[i]);
    if (!ok && ALLOW_HOST_DRIFT && want.length === found.length) {
      const deltas = want.map((v, i) => v - found[i]);
      if (deltas.every((d) => Math.abs(d) <= HOST_DRIFT_BYTES)) {
        ok = true;
        driftAllowed++;
        console.log(
          `  host drift allowed ${label} line ${idx + 1} (${row.sketch}): ` +
            `doc ${found.join('/')} against ${want.join('/')}, delta ${deltas.join('/')}`,
        );
      }
    }
    if (!ok) {
      console.log(`  MISMATCH ${label} line ${idx + 1} (${row.sketch})`);
      console.log(`    doc says    ${found.join(' / ')}`);
      console.log(`    harness says ${want.join(' / ')}`);
      bad++;
    } else if (row.pct) {
      /* The saved column is derived, so it can be wrong on its own. */
      const pctFound = Number((line.match(/\|\s*(\d+)\s*%/) || [])[1]);
      const pctWant = Math.floor(((found[0] - found[1]) * 100) / found[0]);
      if (pctFound !== pctWant) {
        console.log(`  MISMATCH ${label} line ${idx + 1} (${row.sketch}): saved says ${pctFound} %, arithmetic gives ${pctWant} %`);
        bad++;
      }
    }
  }

  /* Prose and table cells found by their own wording rather than by a line
   * marker, so a reflowed paragraph does not silently stop being checked. */
  for (const claim of PROSE.filter((c) => c.doc === label)) {
    let scope = lines;
    let offset = 0;
    if (claim.after) {
      const start = lines.findIndex((l) => l.trimStart().startsWith(claim.after));
      if (start < 0) {
        missing.push(claim.after);
        continue;
      }
      let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
      if (end < 0) end = lines.length;
      scope = lines.slice(start, end);
      offset = start;
    }
    const { flat, lineOf } = flatten(scope);
    const hits = [];
    const all = new RegExp(claim.re.source, `${claim.re.flags.replace('g', '')}g`);
    for (const m of flat.matchAll(all)) hits.push({ line: offset + lineOf(m.index), m });
    if (hits.length === 0) {
      missing.push(String(claim.re));
      continue;
    }
    for (const hit of hits) {
      rowCount++;
      for (let g = 0; g < claim.gets.length; g++) {
        checked++;
        const docText = hit.m[g + 1];
        const actual = claim.gets[g]();
        if (!agrees(docText, actual)) report(label, `line ${hit.line}`, docText, actual);
      }
    }
  }

  for (const row of FASTMATH_ROWS.filter((r) => r.doc === label)) {
    const idx = lines.findIndex((l) => row.re.test(l));
    if (idx < 0) {
      missing.push(String(row.re));
      continue;
    }
    const m = lines[idx].match(row.re);
    for (const fn of row.fns) {
      rowCount++;
      const entry = getFastmath().fn(fn);
      if (!entry) {
        console.log(`  ?? ${label} line ${idx + 1}: ${fn} is not in the fastmath harness output`);
        bad++;
        continue;
      }
      checked += 2;
      if (!agrees(m[1], entry.measured)) report(label, `line ${idx + 1} (${fn} measured)`, m[1], entry.measured);
      if (!agrees(m[2], entry.bound)) report(label, `line ${idx + 1} (${fn} gate)`, m[2], entry.bound);
    }
  }

  /* The parity block, pasted from `npm run parity`. Every row the document
   * quotes is compared, which needs no per-row configuration: the block is
   * found by its header and read to the first line that is not a row. */
  if (doc.parity) {
    const head = lines.findIndex((l) => /^module\s+rel rms\s+max abs\s+gate\s+result/.test(l));
    if (head < 0) {
      missing.push('the parity block header');
    } else {
      let seen = 0;
      for (let i = head + 1; i < lines.length; i++) {
        const m = lines[i].match(PARITY_ROW);
        if (!m) break;
        seen++;
        rowCount++;
        const row = getParity().row(m[1]);
        if (!row) {
          console.log(`  ?? ${label} line ${i + 1}: parity prints no row named ${m[1]}`);
          bad++;
          continue;
        }
        checked += 3;
        if (!agrees(m[2], row.rel)) report(label, `line ${i + 1} (${m[1]} rel rms)`, m[2], row.rel);
        if (!agrees(m[3], row.abs)) report(label, `line ${i + 1} (${m[1]} max abs)`, m[3], row.abs);
        if (!agrees(m[4], row.gate)) report(label, `line ${i + 1} (${m[1]} gate)`, m[4], row.gate);
        if (m[5] !== row.result) report(label, `line ${i + 1} (${m[1]} result)`, m[5], row.result);
      }
      if (seen === 0) {
        console.log(`  ?? ${label}: the parity block header has no rows under it`);
        bad++;
      }
    }
  }

  /* The value-table block, printed two groups to a line in HARDWARE.md. */
  if (doc.tables) {
    const head = lines.findIndex((l) => /^group\s+rows\s+bad\s+result/.test(l));
    if (head < 0) {
      missing.push('the value-table block header');
    } else {
      let seen = 0;
      for (let i = head + 1; i < lines.length; i++) {
        const found = [...lines[i].matchAll(/([a-z]+)\s+(\d+)\s+(\d+)\s+(pass|fail)\b/g)];
        if (found.length === 0) break;
        for (const m of found) {
          seen++;
          rowCount++;
          const group = getTables().group(m[1]);
          if (!group) {
            console.log(`  ?? ${label} line ${i + 1}: tables prints no group named ${m[1]}`);
            bad++;
            continue;
          }
          checked += 2;
          if (!agrees(m[2], group.rows)) report(label, `line ${i + 1} (${m[1]} rows)`, m[2], group.rows);
          if (!agrees(m[3], group.bad)) report(label, `line ${i + 1} (${m[1]} bad)`, m[3], group.bad);
        }
      }
      if (seen === 0) {
        console.log(`  ?? ${label}: the value-table block header has no rows under it`);
        bad++;
      }
    }
  }

  for (const m of missing) {
    console.log(`  ROW NOT FOUND in ${label}: ${m}`);
    bad++;
  }
}

/* A checker that covers nothing is the worst outcome available here, so it
 * says so rather than printing a green line. */
if (checked === 0) {
  console.log('  NOTHING CHECKED: every marker in this file failed to match');
  bad++;
}

for (const self of SELF) {
  const doc = DOCS.find((d) => d.label === self.doc);
  const lines = readFileSync(doc.path, 'utf8').split('\n');
  const idx = lines.findIndex((l) => self.re.test(l));
  if (idx < 0) {
    console.log(`  ROW NOT FOUND in ${self.doc}: ${self.re}`);
    bad++;
    continue;
  }
  const said = Number(lines[idx].match(self.re)[1]);
  if (said !== checked) {
    console.log(`  MISMATCH ${self.doc} line ${idx + 1}: says this file checks ${said} figures, it checks ${checked}`);
    bad++;
  }
}

console.log(
  bad === 0
    ? `ok       ${checked} figures across ${rowCount} rows in ${DOCS.length} documents match what the harnesses print`
    : `${bad} row(s) do not match what the harnesses print`,
);
if (driftAllowed > 0) {
  console.log(
    `note     ${driftAllowed} row(s) passed only under --allow-host-drift, within ` +
      `${HOST_DRIFT_BYTES} bytes. Byte-exact figures need the host that measured them.`,
  );
}
if (process.argv.includes('--check') && bad > 0) process.exit(1);
