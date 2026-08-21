/*
 * Every C++ template signature quoted in the embedded documentation is a
 * signature that exists in the headers.
 *
 *   npx vite-node scripts/check-signatures.mjs
 *
 * WHY, AND IT IS A REAL FAILURE RATHER THAN A HYPOTHETICAL ONE
 *
 * Release 0.1.2 changed Pluck<> and StereoDelay<> to take their template
 * sample rate from BELLOWS_SAMPLE_RATE instead of a hardcoded 48000. Two
 * reference pages went on quoting the old signature:
 *
 *   template <int kMinFreqHz = 20, int kSampleRate = 48000> class Pluck;
 *   template <uint32_t kMaxMs = 500, uint32_t kSampleRate = 48000> class StereoDelay;
 *
 * Nothing caught it. check-docs.mjs compares FIGURES against harness output
 * and a template signature is not a figure; the type checker never reads
 * prose; the build does not either. A reader copying either line gets code
 * that compiles and silently sizes its buffers for the wrong rate, which is
 * the exact defect the 0.1.2 change existed to fix.
 *
 * HOW IT MATCHES
 *
 * Whitespace is normalised and the trailing `;` and `class Name` are
 * dropped, so the docs may write the declaration in whatever shape reads
 * best as long as the parameter list is the real one. The comparison is
 * against the template line that precedes the matching class or struct in
 * the headers, which is where the defaults actually live.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../../packages/bellows-embedded/src/bellows/', import.meta.url).pathname;
const DOCS = new URL('../src/docs/embedded/', import.meta.url).pathname;

/** Every `template <...>` line in the headers, with the type it declares. */
function headerSignatures(dir) {
  const found = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of headerSignatures(path)) found.set(k, v);
      continue;
    }
    if (!entry.name.endsWith('.h')) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const t = /^template <(.+)>\s*$/.exec(lines[i].trim());
      if (!t) continue;
      /* The declaration is on the next non-blank, non-comment line. */
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || lines[j].trim().startsWith('/*') || lines[j].trim().startsWith('*'))) j++;
      const decl = /^(?:class|struct)\s+([A-Za-z_]\w*)/.exec(lines[j]?.trim() ?? '');
      if (decl) found.set(decl[1], norm(t[1]));
    }
  }
  return found;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

const headers = headerSignatures(SRC);
const problems = [];
let checked = 0;

for (const file of readdirSync(DOCS).filter((f) => f.endsWith('.ts') && f !== 'index.ts')) {
  const src = readFileSync(join(DOCS, file), 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, n) => {
    const m = /^template <(.+)>\s*(?:class|struct)\s+([A-Za-z_]\w*)\s*;/.exec(line.trim());
    if (!m) return;
    checked++;
    const [, params, name] = m;
    const real = headers.get(name);
    if (real === undefined) {
      problems.push(`${file}:${n + 1}: the headers declare no template called ${name}`);
      return;
    }
    if (norm(params) !== real) {
      problems.push(
        `${file}:${n + 1}: ${name} is documented as\n` +
          `        template <${norm(params)}>\n` +
          `      and declared as\n` +
          `        template <${real}>`,
      );
    }
  });
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  ${p}`);
  console.log(`${problems.length} documented signature(s) do not match the headers`);
  process.exit(1);
}

console.log(`ok       ${checked} documented C++ signature(s) match the headers they name`);
