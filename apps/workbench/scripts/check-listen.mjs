/*
 * Every `listen` fence in the documentation names a firmware that exists and
 * params that exist on it.
 *
 *   npx vite-node scripts/check-listen.mjs
 *
 * WHY THIS IS A GATE AND NOT A NOTE
 *
 * A listen fence is two plain strings, a firmware id and a list of param
 * keys, and both fail silently. `FIRMWARE_BY_ID.get('onekickk')` returns
 * undefined and the block renders a play button that throws when a reader
 * presses it. A param key that does not exist on the firmware is quieter
 * still: the slider simply never appears, the page looks finished, and the
 * step of the tutorial that asks the reader to drag it cannot be done.
 *
 * Neither is visible to the type checker, because both are strings, and
 * neither is visible in a build. This is the same shape as check-catalogue,
 * written for the same reason on the same day the feature landed rather than
 * at the next audit.
 *
 * It also checks the fence is closed, because an unterminated fence swallows
 * the rest of the page into a caption and the reader loses everything below
 * it with no error anywhere.
 */

import { DOC_PAGES, EMBEDDED_DOC_PAGES } from '../src/docs/index.ts';
import { FIRMWARE_BY_ID } from '../src/lib/sim/firmware.ts';

/* The same pattern DocsView splits on. Two copies of a regex is two chances
 * to disagree, and the alternative is exporting it from a .vue file, which
 * is worse; if this ever drifts, the symptom is a fence this gate cannot see
 * and the page renders as literal text, which is loud. */
const FENCE_OPEN = /^```listen[ \t]+(\S+)[ \t]*(.*)$/;

const problems = [];
let blocks = 0;
let sliders = 0;

for (const page of [...DOC_PAGES, ...EMBEDDED_DOC_PAGES]) {
  const lines = page.body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) continue;
    blocks++;
    const where = `${page.slug} line ${i + 1}`;

    /*
     * Scan to the terminator, and treat ANY later fence line as the end of
     * the search rather than only an exact ```. Found by mutation: deleting
     * this block's closing fence used to pass, because the page's next
     * ```cpp block was accepted as the close. A reader would have got the
     * rest of the page swallowed into a caption with nothing reported.
     */
    let closed = false;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trimEnd();
      if (line === '```') {
        closed = true;
        i = j;
        break;
      }
      if (line.startsWith('```')) {
        problems.push(
          `${where}: the listen fence is not closed before ${line} opens on line ${j + 1}`,
        );
        i = j - 1;
        break;
      }
    }
    if (!closed && i < lines.length && problems.at(-1)?.startsWith(where) !== true) {
      problems.push(`${where}: the listen fence is never closed`);
    }

    const id = open[1];
    const fw = FIRMWARE_BY_ID.get(id);
    if (!fw) {
      problems.push(`${where}: no firmware called ${id}`);
      continue;
    }

    for (const m of open[2].matchAll(/(\w+)=(\S+)/g)) {
      if (m[1] !== 'params') {
        problems.push(`${where}: unknown option ${m[1]}=`);
        continue;
      }
      for (const key of m[2].split(',').filter(Boolean)) {
        sliders++;
        if (!fw.params.some((p) => p.key === key)) {
          const known = fw.params.map((p) => p.key).join(', ') || 'none';
          problems.push(`${where}: ${id} has no param ${key}. It has: ${known}`);
        }
      }
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  ${p}`);
  console.log(`${problems.length} problem(s) in the listen blocks`);
  process.exit(1);
}

console.log(
  `ok       ${blocks} listen block(s) naming ${sliders} slider(s), every firmware and param real`,
);
