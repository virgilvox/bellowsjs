/*
 * Builds dist/ before any test worker starts, when it is missing or older
 * than src.
 *
 * test/integration/package.test.ts checks the published artefact, so it
 * needs one to exist, and on a clean checkout there is none: dist/ is
 * gitignored. Building it inside that file's beforeAll worked but ran while
 * other workers were running, and the contention pushed the velvet noise
 * test, which renders four seconds of audio, past its five second timeout.
 * A globalSetup runs once, alone, before any of them.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

export default function setup(): void {
  const bundle = join(PKG, 'dist', 'bellows.js');
  if (existsSync(bundle) && statSync(bundle).mtimeMs >= newestMtime(join(PKG, 'src'))) return;
  execSync('npm run build', { cwd: PKG, stdio: 'inherit' });
}
