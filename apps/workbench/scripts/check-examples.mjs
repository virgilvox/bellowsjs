/*
 * Every runnable example on the site, checked against the library it
 * demonstrates.
 *
 * The examples are the most-read code the project ships: a visitor's first
 * contact with the API is one of these in the code-mode editor, and a
 * broken one fails in front of them with no warning anywhere upstream. They
 * are strings, so nothing type-checks them, and the app has no test suite.
 *
 * What this proves, per example: it parses the way the runner compiles it,
 * every `lib.x` it names is exported, every `b.x()` it calls is a method on
 * Bellows, and every engine, effect and preset id it passes as a literal is
 * registered. Ids an example registers itself, in the extend pages, are
 * collected first and allowed.
 *
 *   node scripts/check-examples.mjs
 *
 * Reads the built library, so run `npm run build -w packages/bellows` first.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, '..', 'src', 'examples');
const BUNDLE = join(HERE, '..', '..', '..', 'packages', 'bellows', 'dist', 'bellows.js');

if (!existsSync(BUNDLE)) {
  console.error('bellowsjs is not built. Run `npm run build -w packages/bellows` first.');
  process.exit(2);
}

const lib = await import(BUNDLE);
lib.registerBuiltins();

const libNames = new Set(Object.keys(lib));
const engineIds = new Set(lib.listEngines().map((e) => e.id));
const effectIds = new Set(lib.listEffects().map((e) => e.id));
const presetIds = new Set(lib.INSTRUMENT_PRESETS.map((p) => p.id));
const bellowsMethods = new Set(Object.getOwnPropertyNames(lib.Bellows.prototype));

const files = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'index.ts')
  .sort();

const problems = [];
let count = 0;

for (const file of files) {
  const src = readFileSync(join(EXAMPLES, file), 'utf8');
  for (const m of src.matchAll(/\bid:\s*'([^']+)',[\s\S]*?\bcode:\s*`([\s\S]*?)`,?\n\s*\}/g)) {
    const [, id, code] = m;
    count++;
    const where = `${file} [${id}]`;

    /* An example may define its own engine or effect before using it. */
    const ownIds = new Set();
    for (const d of code.matchAll(/\bb\.def(?:Engine|Effect)\(\s*\{\s*id:\s*'([^']+)'/g)) ownIds.add(d[1]);

    try {
      // eslint-disable-next-line no-new-func
      new Function('b', 'lib', 'log', 'onCleanup', `"use strict"; return (async () => {${code}})`);
    } catch (e) {
      problems.push(`${where} does not parse: ${e.message}`);
      continue;
    }

    for (const r of code.matchAll(/\blib\.([A-Za-z_$][\w$]*)/g)) {
      if (!libNames.has(r[1])) problems.push(`${where} lib.${r[1]} is not exported`);
    }
    for (const r of code.matchAll(/\bb\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!bellowsMethods.has(r[1])) problems.push(`${where} b.${r[1]}() is not a Bellows method`);
    }
    for (const r of code.matchAll(/\bb\.voice\(\s*'([^']+)'/g)) {
      if (!engineIds.has(r[1]) && !ownIds.has(r[1])) problems.push(`${where} engine '${r[1]}' is not registered`);
    }
    for (const r of code.matchAll(/\bb\.instrument\(\s*'([^']+)'/g)) {
      if (!presetIds.has(r[1])) problems.push(`${where} preset '${r[1]}' does not exist`);
    }
    for (const r of code.matchAll(/(?:\bb\.bus|\.fx)\(\s*\[([^\]]*)\]/g)) {
      for (const e of r[1].matchAll(/'([^']+)'/g)) {
        if (!effectIds.has(e[1]) && !ownIds.has(e[1])) problems.push(`${where} effect '${e[1]}' is not registered`);
      }
    }
  }
}

if (count < 40) {
  console.error(`only found ${count} examples across ${files.length} files, which is fewer than there are.`);
  console.error('the extractor is probably no longer matching the example format.');
  process.exit(2);
}

for (const p of problems) console.error('  ' + p);
console.log(
  `${problems.length === 0 ? 'ok' : 'FAIL'}       ${count} examples across ${files.length} files, ` +
    `${problems.length} problems`,
);
process.exit(problems.length === 0 ? 0 : 1);
