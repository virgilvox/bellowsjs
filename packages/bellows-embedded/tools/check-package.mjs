/*
 * What the two published artifacts must contain, and must not.
 *
 * This library ships through two channels with different shapes, and both were
 * got wrong by hand before anything checked them:
 *
 *   - the package had no LICENSE at all, while every manifest said Apache-2.0
 *   - a PlatformIO pack carried examples/daisy_onekick/build, a megabyte of
 *     .elf, .map and object files, because export.exclude named only test and
 *     tools
 *   - the Arduino mirror carried MIRROR.md and .gitignore that the build script
 *     did not generate, so the next tag would have force-pushed them away
 *   - and every example failed to compile once installed, for a whole release
 *     cycle, because nothing had ever installed one
 *
 * Four faults, all in packaging, all found by looking rather than by a gate.
 * This is the gate.
 *
 *   node tools/check-package.mjs
 *
 * The mirror half always runs. The PlatformIO half needs `pio` on PATH and
 * says so when it is absent rather than passing quietly, because a check that
 * silently covers half of what it claims is worse than one that covers none.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const notes = [];

/** Every file under dir, as paths relative to it. */
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full));
  }
  return out;
}

/*
 * Build output, by the shapes it actually took here rather than by a guess.
 * `.pio` is PlatformIO's, `build/` is the Daisy Makefile's, and the object and
 * image extensions are what those two leave behind.
 */
const BUILD_OUTPUT = /(^|\/)(\.pio|build)\/|\.(o|d|lst|elf|map|hex|bin|a)$/;
const DEV_ONLY = /^(test|tools)\/|^(package\.json|compile_flags\.txt)$/;

function checkCommon(where, root, files) {
  if (!existsSync(join(root, 'LICENSE'))) {
    fail(where, 'no LICENSE. Every manifest here says Apache-2.0 and a distributed artifact must carry the text');
  } else if (readFileSync(join(root, 'LICENSE'), 'utf8').length < 1000) {
    fail(where, 'LICENSE is suspiciously short');
  }

  for (const f of files) {
    if (BUILD_OUTPUT.test(f)) fail(where, `ships build output: ${f}`);
    if (DEV_ONLY.test(f)) fail(where, `ships development infrastructure: ${f}`);
    if (f.endsWith('.DS_Store')) fail(where, `ships ${f}`);
  }

  const headers = files.filter((f) => f.startsWith('src/') && f.endsWith('.h'));
  if (headers.length < 40) fail(where, `only ${headers.length} headers under src/, expected at least 40`);

  const props = join(root, 'library.properties');
  if (!existsSync(props)) {
    fail(where, 'no library.properties at the root');
    return { headers: headers.length };
  }
  const text = readFileSync(props, 'utf8');
  for (const field of ['name', 'version', 'author', 'maintainer', 'sentence', 'paragraph', 'category', 'url']) {
    if (!new RegExp(`^${field}=.+$`, 'm').test(text)) fail(where, `library.properties has no ${field}`);
  }
  const propsVersion = /^version=(.*)$/m.exec(text)?.[1];
  const jsonPath = join(root, 'library.json');
  if (existsSync(jsonPath)) {
    const jsonVersion = JSON.parse(readFileSync(jsonPath, 'utf8')).version;
    if (propsVersion !== jsonVersion) {
      fail(where, `library.properties says ${propsVersion} and library.json says ${jsonVersion}`);
    }
  }
  return { headers: headers.length, version: propsVersion };
}

/* ------------------------------------------------------------------ *
 * The Arduino Library Manager mirror.
 * ------------------------------------------------------------------ */
const mirror = mkdtempSync(join(tmpdir(), 'bellows-mirror-'));
try {
  execFileSync(join(PKG, 'tools', 'build-mirror.sh'), [mirror], { stdio: 'pipe' });
} catch (e) {
  fail('mirror', `build-mirror.sh failed: ${e.message}`);
}
const mirrorFiles = existsSync(mirror) ? walk(mirror) : [];
const mirrorInfo = checkCommon('mirror', mirror, mirrorFiles);

/*
 * The Arduino IDE preprocesses a sketch into a build directory, so a relative
 * include out of the sketch folder does not survive. Measured: before the
 * mirror flattened them, every affected example failed to compile once
 * installed.
 */
for (const f of mirrorFiles.filter((f) => f.endsWith('.ino') || f.endsWith('.h'))) {
  if (!f.startsWith('examples/')) continue;
  if (/#include\s+"\.\.\//.test(readFileSync(join(mirror, f), 'utf8'))) {
    fail('mirror', `${f} still includes across folders, which the Arduino IDE cannot resolve`);
  }
}

/* Arduino requires examples/<Name>/<Name>.ino, and lists anything else as a
 * folder it cannot open. */
const mirrorExamples = existsSync(join(mirror, 'examples'))
  ? readdirSync(join(mirror, 'examples')).filter((n) => statSync(join(mirror, 'examples', n)).isDirectory())
  : [];
for (const name of mirrorExamples) {
  if (!existsSync(join(mirror, 'examples', name, `${name}.ino`))) {
    fail('mirror', `examples/${name} has no ${name}.ino, so the IDE cannot open it`);
  }
}
if (!existsSync(join(mirror, 'MIRROR.md'))) {
  fail('mirror', 'no MIRROR.md. It must be generated, not hand written, or the next tag force-pushes it away');
}
notes.push(`mirror: ${mirrorInfo.headers} headers, ${mirrorExamples.length} examples, version ${mirrorInfo.version}`);
rmSync(mirror, { recursive: true, force: true });

/* ------------------------------------------------------------------ *
 * The PlatformIO package, which is a different artifact on purpose.
 *
 * It comes from this directory rather than from the mirror: PlatformIO
 * resolves the cross-folder includes that the Arduino IDE cannot, so the
 * examples keep sharing one patch, and it keeps daisy_onekick, which the
 * mirror drops because it is a Makefile rather than a sketch. MIRROR.md is a
 * document about a GitHub repository and has no business inside a package.
 * ------------------------------------------------------------------ */
let havePio = true;
try {
  execFileSync('pio', ['--version'], { stdio: 'pipe' });
} catch {
  havePio = false;
}

if (!havePio) {
  notes.push('platformio: SKIPPED, `pio` is not on PATH. This half is unchecked.');
} else {
  const out = mkdtempSync(join(tmpdir(), 'bellows-pio-'));
  let tarball;
  try {
    execFileSync('pio', ['pkg', 'pack', '-o', out], { cwd: PKG, stdio: 'pipe' });
    tarball = readdirSync(out).find((f) => f.endsWith('.tar.gz'));
  } catch (e) {
    fail('platformio', `pio pkg pack failed: ${e.message}`);
  }
  if (tarball) {
    const listed = execFileSync('tar', ['tzf', join(out, tarball)], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((f) => f.replace(/\/$/, ''));

    for (const f of listed) {
      if (BUILD_OUTPUT.test(f)) fail('platformio', `ships build output: ${f}`);
      /* package.json is force-included by PlatformIO as a manifest candidate
       * and library.json wins, so it is noise rather than a fault. */
      if (/^(test|tools)\//.test(f)) fail('platformio', `ships development infrastructure: ${f}`);
      if (f.endsWith('.DS_Store')) fail('platformio', `ships ${f}`);
    }
    if (!listed.includes('LICENSE')) fail('platformio', 'no LICENSE in the tarball');
    if (listed.some((f) => f === 'MIRROR.md')) {
      fail('platformio', 'ships MIRROR.md, so this was packed from the mirror rather than from the package directory');
    }
    if (!listed.some((f) => f.startsWith('examples/daisy_onekick/'))) {
      fail('platformio', 'no examples/daisy_onekick. library.json claims ststm32, so the Daisy example belongs here');
    }
    const headers = listed.filter((f) => f.startsWith('src/') && f.endsWith('.h')).length;
    if (headers < 40) fail('platformio', `only ${headers} headers under src/`);
    const kb = statSync(join(out, tarball)).size / 1024;
    if (kb > 800) fail('platformio', `tarball is ${kb.toFixed(0)} KB, which is large enough to suspect build output`);
    notes.push(`platformio: ${headers} headers, ${kb.toFixed(0)} KB packed`);
  }
  rmSync(out, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
for (const n of notes) console.log(`  ${n}`);
if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ${p}`);
  console.log(`\n${problems.length} problem(s) in what would be published`);
  process.exit(1);
}
console.log('\nok       both published artifacts carry what they should and nothing they should not');
