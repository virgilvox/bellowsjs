/*
 * Checks every flash and RAM figure in docs/HARDWARE.md that a sketch
 * produces, against what the size report prints right now.
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
const DOC = join(PKG, '..', '..', 'docs', 'HARDWARE.md');

/* Which sketch backs which row. The marker is enough of the line to find
 * it uniquely; the columns say what the numbers in that line mean, in the
 * order they appear. `flash` and `ram` are the default build, the `Fm`
 * suffix is the same sketch with BELLOWS_FAST_MATH=1. */
const ROWS = [
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

const needFm = ROWS.some((r) => r.cols.some((c) => c.endsWith('Fm')));
const base = sizes(null);
const fm = needFm ? sizes('-DBELLOWS_FAST_MATH=1') : {};
const doc = readFileSync(DOC, 'utf8').split('\n');

const value = (sketch, col) => {
  const src = col.endsWith('Fm') ? fm : base;
  const key = col.startsWith('flash') ? 'flash' : 'ram';
  const row = src[sketch];
  return row === undefined ? undefined : row[key];
};

let bad = 0;
let checked = 0;
const missing = [];
for (const row of ROWS) {
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
    console.log(`  ?? ${row.sketch}: not in the size report`);
    bad++;
    continue;
  }
  checked += want.length;
  const ok = want.length === found.length && want.every((v, i) => v === found[i]);
  if (!ok) {
    console.log(`  MISMATCH line ${idx + 1} (${row.sketch})`);
    console.log(`    doc says   ${found.join(' / ')}`);
    console.log(`    report says ${want.join(' / ')}`);
    bad++;
  } else if (row.pct) {
    /* The saved column is derived, so it can be wrong on its own. */
    const pctFound = Number((line.match(/\|\s*(\d+)\s*%/) || [])[1]);
    const pctWant = Math.floor(((found[0] - found[1]) * 100) / found[0]);
    if (pctFound !== pctWant) {
      console.log(`  MISMATCH line ${idx + 1} (${row.sketch}): saved says ${pctFound} %, arithmetic gives ${pctWant} %`);
      bad++;
    }
  }
}

for (const m of missing) {
  console.log(`  ROW NOT FOUND: ${m}`);
  bad++;
}

console.log(
  bad === 0
    ? `ok       ${checked} figures across ${ROWS.length} rows match the size report`
    : `${bad} row(s) do not match the size report`,
);
if (process.argv.includes('--check') && bad > 0) process.exit(1);
