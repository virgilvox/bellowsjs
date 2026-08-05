/*
 * Checks every flash and RAM figure in docs/HARDWARE.md and in the embedded
 * package README that a sketch produces, against what the size report
 * prints right now.
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
 * WHAT THIS DOES NOT COVER, so nobody mistakes it for total coverage:
 * the whole-firmware Teensy table (needs PlatformIO and the Arduino core),
 * the Daisy table (needs libDaisy), the double-precision recursion table
 * and the oscillator ns table (both separate benchmarks), the StereoDelay
 * memory table (arithmetic, with the overflow row verified by compiling),
 * and the board capacity table (data sheets). Those still rot by hand.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

/* Which sketch backs which row. The marker is enough of the line to find
 * it uniquely; the columns say what the numbers in that line mean, in the
 * order they appear. `flash` and `ram` are the default build, the `Fm`
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

const DOCS = [
  { path: join(PKG, '..', '..', 'docs', 'HARDWARE.md'), label: 'docs/HARDWARE.md', rows: HARDWARE_ROWS },
  { path: join(PKG, 'README.md'), label: 'README.md', rows: README_ROWS },
  /* No tables, but it states the two figures the no-registry rule rests on,
   * and it is the document a new session reads first. Both were stale. */
  { path: join(PKG, '..', '..', 'docs', 'HANDOFF.md'), label: 'docs/HANDOFF.md', rows: [] },
];

/*
 * Figures written as prose rather than as a table row, so the "N B" column
 * scan cannot see them. Each is a sketch value the text asserts outright.
 */
const PROSE = [
  {
    doc: 'README.md',
    marker: '| `BELLOWS_FAST_MATH` |',
    claims: [
      { re: /the kick sketch is (\d+) bytes at the default/, sketch: 's1_kick', col: 'flash' },
      { re: /and (\d+) with the flag/, sketch: 's1_kick', col: 'flashFm' },
    ],
  },
  {
    doc: 'docs/HANDOFF.md',
    marker: '12. **The embedded library must never grow a global registry.**',
    claims: [
      { re: /registry of five engines costs (\d+) bytes of flash/, sketch: 's6_registry', col: 'flash' },
      { re: /bytes of flash and (\d+) of RAM/, sketch: 's6_registry', col: 'ram' },
      { re: /against (\d+) and \d+ direct/, sketch: 's1_kick', col: 'flash' },
      { re: /against \d+ and (\d+) direct/, sketch: 's1_kick', col: 'ram' },
    ],
  },
  {
    doc: 'docs/HANDOFF.md',
    marker: '13. `BELLOWS_FAST_MATH=1` swaps libm',
    claims: [
      { re: /takes the kick from (\d+) to \d+ bytes/, sketch: 's1_kick', col: 'flash' },
      { re: /takes the kick from \d+ to (\d+) bytes/, sketch: 's1_kick', col: 'flashFm' },
    ],
  },
];

function sizes(extra) {
  const env = { ...process.env };
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

const allRows = DOCS.flatMap((d) => d.rows);
const needFm =
  allRows.some((r) => r.cols.some((c) => c.endsWith('Fm'))) ||
  PROSE.some((p) => p.claims.some((c) => c.col.endsWith('Fm')));
const base = sizes(null);
const fm = needFm ? sizes('-DBELLOWS_FAST_MATH=1') : {};

const value = (sketch, col) => {
  const src = col.endsWith('Fm') ? fm : base;
  const key = col.startsWith('flash') ? 'flash' : 'ram';
  const row = src[sketch];
  return row === undefined ? undefined : row[key];
};

let bad = 0;
let checked = 0;
let rowCount = 0;

for (const { path, label, rows } of DOCS) {
  const doc = readFileSync(path, 'utf8').split('\n');
  const missing = [];
  for (const row of rows) {
    rowCount++;
    /* Trimmed: rule 2's table is indented inside a numbered list item. */
    const idx = doc.findIndex((l) => l.trimStart().startsWith(row.marker));
    if (idx < 0) {
      missing.push(row.marker);
      continue;
    }
    const line = doc[idx];
    const found = [...line.matchAll(/(\d+) B\b/g)].map((m) => Number(m[1]));
    const want = row.cols.map((c) => value(row.sketch, c));
    if (want.some((v) => v === undefined)) {
      console.log(`  ?? ${label} ${row.sketch}: not in the size report`);
      bad++;
      continue;
    }
    checked += want.length;
    const ok = want.length === found.length && want.every((v, i) => v === found[i]);
    if (!ok) {
      console.log(`  MISMATCH ${label} line ${idx + 1} (${row.sketch})`);
      console.log(`    doc says   ${found.join(' / ')}`);
      console.log(`    report says ${want.join(' / ')}`);
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

  for (const p of PROSE.filter((x) => x.doc === label)) {
    const idx = doc.findIndex((l) => l.trimStart().startsWith(p.marker));
    if (idx < 0) {
      missing.push(p.marker);
      continue;
    }
    for (const claim of p.claims) {
      const m = doc[idx].match(claim.re);
      const want = value(claim.sketch, claim.col);
      if (!m || want === undefined) {
        console.log(`  ?? ${label} line ${idx + 1}: prose claim ${claim.re} did not read`);
        bad++;
        continue;
      }
      checked++;
      if (Number(m[1]) !== want) {
        console.log(`  MISMATCH ${label} line ${idx + 1} (${claim.sketch} ${claim.col}, prose)`);
        console.log(`    doc says   ${m[1]}`);
        console.log(`    report says ${want}`);
        bad++;
      }
    }
  }

  for (const m of missing) {
    console.log(`  ROW NOT FOUND in ${label}: ${m}`);
    bad++;
  }
}

console.log(
  bad === 0
    ? `ok       ${checked} figures across ${rowCount} rows in ${DOCS.length} documents match the size report`
    : `${bad} row(s) do not match the size report`,
);
if (process.argv.includes('--check') && bad > 0) process.exit(1);
