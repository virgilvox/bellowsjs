/*
 * Builds the prebuilt .hex files the simulator's flash panel offers, and
 * writes a manifest recording exactly what each one was built from.
 *
 * WHY THERE IS A MANIFEST
 *
 * A committed binary goes stale silently. Someone changes a DSP header, the
 * page still shows the new source, and the .hex next to it is the old
 * program: the reader has no way to tell. This repository spends CI gates
 * on exactly that failure mode for the worklet string, the LLM reference
 * and the example sources, and a binary cannot be regenerated in CI at a
 * sensible cost: the sweep is every example on four boards, and every cell
 * is a full build of the Arduino core and the audio library.
 *
 * So instead of pretending, each entry records the commit it was built
 * from and when, and the panel prints that next to the download. A stale
 * binary is then visible rather than silent, which is the same standard
 * applied everywhere else here, reached by a cheaper route.
 *
 * WHAT IS IN THE MANIFEST THAT IS NOT A BINARY
 *
 * Every example is tried on every board, and a board that refuses is
 * recorded rather than dropped. There are three ways to not get a binary
 * and they mean different things:
 *
 *   does not fit   the linker refused with `region RAM overflowed`. A
 *                  quantity: the log says by how many bytes.
 *   n/a            the sketch declined this board on purpose with an
 *                  #error. Categorical: 12_DacOut on a Teensy 4.x, which
 *                  has no DAC.
 *   failed         anything else, and worth reading the log for.
 *
 * That is the same classification build-matrix.sh prints, so the manifest
 * and the board matrix in the examples README answer the same question the
 * same way.
 *
 * Needs PlatformIO and the teensy platform. Not part of any build:
 *
 *   node scripts/gen-firmware-binaries.mjs
 *   node scripts/gen-firmware-binaries.mjs --only 01_OneKick --boards teensy40
 *
 * Nothing is shared between cells: PlatformIO empties the build directory
 * every time src_dir changes, so each one compiles the core and the audio
 * library again. One measured here, 01_OneKick on a 3.2 from an empty
 * directory, took 62 seconds, and the larger examples take several minutes.
 * The full sweep is hours. That is what --only and --boards are for: they
 * rebuild one cell without touching the rest, and the run merges into the
 * manifest already on disk rather than replacing it. Entries it did not
 * rebuild keep their commit and their RAM figure, and have their size and
 * hash recomputed from the file actually sitting in public/firmware, so the
 * manifest never describes a binary that is not there.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const examplesDir = join(app, '../../packages/bellows-embedded/examples');
const outDir = join(app, 'public/firmware');
const manifestPath = join(outDir, 'manifest.json');

/*
 * This script builds into its own directory rather than the default
 * .pio/build, because PlatformIO keeps one project.checksum for a build
 * directory and wipes the whole thing when the checksum changes. src_dir is
 * in that checksum, so every example this script moves to deletes the tree,
 * and a `pio run` someone starts by hand in the same window has its object
 * files pulled out from under it. That failure prints "Fatal error: can't
 * create ...", which reads like a compile error and is not one. Separate
 * build directories mean neither run can do it to the other.
 */
const buildDir = join(examplesDir, '.pio', 'gen-firmware');

/*
 * The four boards worth carrying a binary for. The Audio Library supports
 * three more (LC, 3.5, MicroMod); they are left to build-from-source
 * because every extra pair is another 100 KB in git that goes stale on the
 * next DSP change.
 *
 * `id` is the simulator's board id, which is what the flash panel filters
 * on. `env` is the PlatformIO environment, and the two differ on one board:
 * PlatformIO calls the Teensy 3.2 `teensy31`, because the 3.1 and the 3.2
 * are the same part with a bigger regulator.
 */
const BOARDS = [
  { id: 'teensy41', env: 'probe_teensy41' },
  { id: 'teensy40', env: 'probe_teensy40' },
  { id: 'teensy36', env: 'probe_teensy36' },
  { id: 'teensy32', env: 'probe_teensy31' },
];

/* Not a PlatformIO project: it builds through libDaisy's own Makefile, and
 * it is an STM32 part, so no Teensy env applies to it. */
const SKIP = new Set(['daisy_onekick']);

/** Every directory holding <name>/<name>.ino, which is the Arduino layout. */
function discoverExamples() {
  return readdirSync(examplesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP.has(d.name))
    .map((d) => d.name)
    .filter((name) => existsSync(join(examplesDir, name, `${name}.ino`)))
    .sort();
}

function parseArgs(argv) {
  const opts = { only: [], boards: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--only' || arg === '--boards') {
      const value = argv[++i];
      if (!value) fail(`${arg} needs a value`);
      const key = arg === '--only' ? 'only' : 'boards';
      opts[key].push(...value.split(',').map((s) => s.trim()).filter(Boolean));
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  console.error(`gen-firmware-binaries: ${message}`);
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(
    [
      'usage: node scripts/gen-firmware-binaries.mjs [--only <examples>] [--boards <boards>]',
      '',
      `  --only    comma separated example folders (default: all ${discoverExamples().length})`,
      `  --boards  comma separated board ids (default: ${BOARDS.map((b) => b.id).join(', ')})`,
      '',
      'A restricted run merges into public/firmware/manifest.json rather than',
      'replacing it, so rebuilding one cell leaves the others alone.',
    ].join('\n'),
  );
  process.exit(0);
}

const allExamples = discoverExamples();
if (allExamples.length === 0) fail(`no examples found under ${examplesDir}`);

for (const name of opts.only) {
  if (!allExamples.includes(name)) {
    fail(`no such example: ${name}\n  known: ${allExamples.join(', ')}`);
  }
}
for (const id of opts.boards) {
  if (!BOARDS.some((b) => b.id === id)) {
    fail(`no such board: ${id}\n  known: ${BOARDS.map((b) => b.id).join(', ')}`);
  }
}

const examples = opts.only.length ? opts.only : allExamples;
const boards = opts.boards.length ? BOARDS.filter((b) => opts.boards.includes(b.id)) : BOARDS;

mkdirSync(outDir, { recursive: true });

/*
 * The commit these binaries were built from, with `-dirty` on it if the
 * library or the examples had uncommitted edits when the build ran. Without
 * that suffix the stamp claims a program someone could check out and
 * rebuild, and a firmware built from a working tree is not that program.
 */
const embedded = join(app, '../../packages/bellows-embedded');
const commit = (() => {
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: app }).toString().trim();
  const changes = execFileSync('git', ['status', '--porcelain', '--', embedded], { cwd: app })
    .toString()
    .trim();
  return changes ? `${sha}-dirty` : sha;
})();
const builtAt = new Date().toISOString().slice(0, 10);

/**
 * How much RAM the program used, as a percentage, from whichever of the two
 * shapes the log has.
 *
 * On the 3.x boards PlatformIO prints its own bar:
 *   RAM:   [===       ] 34.7% (used 22752 bytes from 65536 bytes)
 *
 * On the 4.x boards it does not, and prints teensy_size instead, which
 * splits RAM into two banks:
 *   RAM1: variables:9088, code:17896, padding:14872  free for local variables:482432
 *   RAM2: variables:21216  free for malloc/new:503072
 *
 * The number taken there is RAM1, because RAM1 is the bank the linker
 * overflows and so the one that decides whether a patch fits. RAM2 is
 * DMAMEM and the heap, and a program can leave it entirely empty. So the
 * field means "RAM used" on a 3.x and "RAM1 used" on a 4.x, which is the
 * same question asked of parts that answer it differently.
 */
function scrapeRam(log) {
  const bar = /RAM: *\[[^\]]*\] *([0-9.]+)%/.exec(log);
  if (bar) return `${bar[1]}%`;
  const ram1 = /RAM1: *variables:(\d+), *code:(\d+), *padding:(\d+) +free for local variables:(\d+)/.exec(
    log,
  );
  if (!ram1) return null;
  const [variables, code, padding, free] = ram1.slice(1).map(Number);
  const used = variables + code + padding;
  return `${((used / (used + free)) * 100).toFixed(1)}%`;
}

/**
 * Runs one build and says what came of it, without throwing: a linker
 * refusal is an answer about the board, not an error in this script.
 *
 * @returns {{ status: string, ram: string|null, log: string }}
 */
function build(example, board) {
  /* Both streams, and it matters which: the linker's complaint and
   * teensy_size's memory report both come out on stderr, so reading stdout
   * alone gets a build with no reason and no RAM figure. */
  const run = spawnSync('pio', ['run', '-e', board.env], {
    cwd: examplesDir,
    env: { ...process.env, PLATFORMIO_SRC_DIR: example, PLATFORMIO_BUILD_DIR: buildDir },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) {
    if (run.error.code === 'ENOENT') fail('pio not found. Install PlatformIO Core and try again.');
    fail(`could not run pio: ${run.error.message}`);
  }
  const log = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.status === 0) return { status: 'ok', ram: scrapeRam(log), log };
  if (/overflowed by|region RAM overflowed/.test(log)) return { status: 'does not fit', ram: null, log };
  if (/#error/.test(log)) return { status: 'n/a', ram: null, log };
  /* Two builds writing one build directory: the loser finds its object
   * files and its SCons database deleted mid-compile. The private buildDir
   * above rules out a collision with someone's hand-run `pio`, but not with
   * a second copy of this script. It reads exactly like a compile failure
   * and is not one, so it must never be written down as one: a false
   * "failed" in the manifest is worse than stopping. */
  if (/can't create .*\.pio|\.sconsign\d*\.tmp/.test(log)) return { status: 'collision', ram: null, log };
  return { status: 'failed', ram: null, log };
}

/** The last few lines that are not blank, which is where a compiler says why. */
function tail(log, lines = 4) {
  return log
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-lines)
    .map((l) => `    ${l}`)
    .join('\n');
}

/*
 * Start from the manifest already on disk so a restricted run keeps the
 * cells it did not touch. Entries for examples that no longer exist, and
 * entries whose .hex has been deleted, are dropped: the manifest is a
 * description of public/firmware, not a memory of it.
 */
let previous = { entries: [] };
if (existsSync(manifestPath)) {
  try {
    previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.log('manifest.json was unreadable, starting from nothing');
  }
}

const results = new Map();
const key = (example, board) => `${example} ${board}`;
for (const entry of previous.entries ?? []) {
  if (!allExamples.includes(entry.example)) continue;
  if (!BOARDS.some((b) => b.id === entry.board)) continue;
  /* Manifests written before this script recorded a status hold nothing but
   * successful builds, so a file is what makes one. The commit falls back to
   * the old manifest's top-level one, never to this run's: a binary nobody
   * rebuilt today was not built today, and saying it was is the exact lie
   * the manifest exists to prevent. */
  const status = entry.status ?? (entry.file ? 'ok' : 'failed');
  if (status === 'ok' && !existsSync(join(outDir, entry.file))) continue;
  results.set(key(entry.example, entry.board), {
    ...entry,
    status,
    commit: entry.commit ?? previous.commit,
    builtAt: entry.builtAt ?? previous.builtAt,
  });
}

const total = examples.length * boards.length;
let n = 0;
let collided = false;
outer: for (const example of examples) {
  for (const board of boards) {
    n++;
    process.stdout.write(`[${n}/${total}] ${example} ${board.id} ... `);
    const { status, ram, log } = build(example, board);

    if (status === 'collision') {
      console.log('ABORTED');
      console.log(
        `    Something else is building into ${buildDir}, and the loser of that\n` +
          '    race gets its object files deleted mid-compile. That is not a fact\n' +
          '    about this example, so nothing was recorded for this cell. Wait for\n' +
          '    the other run to finish and start again. Everything built before\n' +
          '    this cell was kept.',
      );
      collided = true;
      break outer;
    }

    if (status !== 'ok') {
      console.log(status.toUpperCase());
      if (status === 'failed') console.log(tail(log));
      results.set(key(example, board.id), { example, board: board.id, status, commit, builtAt });
      continue;
    }

    const file = `${example}_${board.id}.hex`;
    copyFileSync(join(buildDir, board.env, 'firmware.hex'), join(outDir, file));
    const bytes = statSync(join(outDir, file)).size;
    const sha256 = createHash('sha256').update(readFileSync(join(outDir, file))).digest('hex');
    results.set(key(example, board.id), {
      example,
      board: board.id,
      status,
      file,
      bytes,
      sha256,
      ram,
      commit,
      builtAt,
    });
    console.log(`${(bytes / 1024).toFixed(0)} KB, RAM ${ram ?? 'unknown'}`);
  }
}

/* Kept entries describe files that may have been rebuilt by hand since, so
 * take their size and hash from the file rather than from the old JSON. */
for (const entry of results.values()) {
  if (entry.status !== 'ok') continue;
  const path = join(outDir, entry.file);
  entry.bytes = statSync(path).size;
  entry.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
}

/* One field order for every entry, whether it was built now or carried
 * over, so a diff of this file shows what changed rather than where it
 * came from. Fields a non-ok entry has no answer for are left out. */
const canonical = (e) => {
  const out = { example: e.example, board: e.board, status: e.status };
  if (e.status === 'ok') {
    out.file = e.file;
    out.bytes = e.bytes;
    out.sha256 = e.sha256;
    out.ram = e.ram ?? null;
  }
  out.commit = e.commit ?? null;
  out.builtAt = e.builtAt ?? null;
  return out;
};

const order = new Map(BOARDS.map((b, i) => [b.id, i]));
const entries = [...results.values()]
  .sort((a, b) => a.example.localeCompare(b.example) || order.get(a.board) - order.get(b.board))
  .map(canonical);

/* The top level commit is the run that last wrote this file. Which commit a
 * given binary came from is on the entry, because a restricted run mixes
 * them and only the entry can answer for itself. */
writeFileSync(manifestPath, JSON.stringify({ commit, builtAt, entries }, null, 2) + '\n');

/* The summary is the whole manifest, not just this run, because that is
 * what the flash panel will serve. A dash is a cell nothing has tried. */
const cell = (entry) => {
  if (!entry) return '-';
  if (entry.status === 'ok') return `ok ${entry.ram ?? ''}`.trim();
  if (entry.status === 'does not fit') return 'no fit';
  return entry.status;
};

const width = Math.max(...allExamples.map((e) => e.length)) + 2;
console.log('');
process.stdout.write('example'.padEnd(width));
for (const board of BOARDS) process.stdout.write(board.id.padEnd(10));
console.log('');
for (const example of allExamples) {
  process.stdout.write(example.padEnd(width));
  for (const board of BOARDS) {
    process.stdout.write(cell(results.get(key(example, board.id))).padEnd(10));
  }
  console.log('');
}

const count = (status) => entries.filter((e) => e.status === status).length;
console.log('');
console.log(
  `manifest.json: ${count('ok')} binaries, ${count('does not fit')} do not fit, ` +
    `${count('n/a')} n/a, ${count('failed')} failed. This run: ${n - (collided ? 1 : 0)} of ` +
    `${total} cells attempted, out of ${allExamples.length * BOARDS.length} in the matrix, ` +
    `from ${commit} on ${builtAt}.`,
);
if (collided) process.exit(1);
