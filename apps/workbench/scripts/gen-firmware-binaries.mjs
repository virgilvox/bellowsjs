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
 * sensible cost (a firmware link is about 45 seconds and there are twelve).
 *
 * So instead of pretending, each entry records the commit it was built
 * from and when, and the panel prints that next to the download. A stale
 * binary is then visible rather than silent, which is the same standard
 * applied everywhere else here, reached by a cheaper route.
 *
 * Needs PlatformIO and the teensy platform. Not part of any build:
 *
 *   node scripts/gen-firmware-binaries.mjs
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const examples = join(app, '../../packages/bellows-embedded/examples');
const outDir = join(app, 'public/firmware');

/* Kept deliberately short. Every extra pair is another 100 KB in git that
 * goes stale on the next DSP change, and every board here can build from
 * source with the command the panel prints. These two are the boards most
 * people have. */
const EXAMPLES = [
  '01_OneKick',
  '02_DrumMachine',
  '03_PolySynth',
  '04_ScalesAndTuning',
  '10_AudioShield',
  '15_Piezo',
];
const BOARDS = ['teensy41', 'teensy40'];

mkdirSync(outDir, { recursive: true });

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: app })
  .toString()
  .trim();
const builtAt = new Date().toISOString().slice(0, 10);

const entries = [];
for (const example of EXAMPLES) {
  for (const board of BOARDS) {
    process.stdout.write(`${example} ${board} ... `);
    try {
      execFileSync('pio', ['run', '-e', `probe_${board}`], {
        cwd: examples,
        env: { ...process.env, PLATFORMIO_SRC_DIR: example },
        stdio: 'pipe',
      });
    } catch {
      console.log('BUILD FAILED');
      continue;
    }
    const src = join(examples, '.pio', 'build', `probe_${board}`, 'firmware.hex');
    const name = `${example}_${board}.hex`;
    copyFileSync(src, join(outDir, name));
    const bytes = statSync(join(outDir, name)).size;
    const sha = createHash('sha256').update(readFileSync(join(outDir, name))).digest('hex');
    entries.push({ example, board, file: name, bytes, sha256: sha.slice(0, 16) });
    console.log(`${(bytes / 1024).toFixed(0)} KB`);
  }
}

const manifest = { commit, builtAt, entries };
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nmanifest.json: ${entries.length} binaries from ${commit} on ${builtAt}`);
