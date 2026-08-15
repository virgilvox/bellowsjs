/*
 * The simulator catalogue, checked against the three lists it has to agree
 * with by hand.
 *
 * FIRMWARES in src/lib/sim/firmware.ts, the `case` labels in
 * src/lib/sim/voices.ts, VOICE_CAVEATS in the same file, and GROUP_ORDER
 * are four separate lists tied together by two plain strings, `voice` and
 * `group`. Nothing enforced that before this file: the type checker sees
 * `voice: string` and is satisfied, and both ways of getting it wrong are
 * silent in a way that reads as a working page.
 *
 *   a `group` that is not in GROUP_ORDER drops the entry from the picker
 *   with no error, no warning and no console message, because
 *   FIRMWARE_GROUPS maps over GROUP_ORDER and discards the leftovers.
 *
 *   a `voice` with no `case` in buildVoice throws from the switch default,
 *   but only when a visitor presses RUN. It builds, it type-checks, it
 *   deploys, and it fails in front of them.
 *
 * That is the shape of gap this repository keeps finding, so it gets a
 * gate rather than a note. Written the day three entries were added,
 * rather than at the next audit, which is the rule the embedded
 * check-docs.mjs learned the hard way.
 *
 *   node scripts/check-catalogue.mjs
 *
 * Reads firmware.ts through vite-node so the real array is checked rather
 * than a regex over it; the `case` labels are read as text, because they
 * are labels in a switch and there is no other way to see them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIRMWARES, GROUP_ORDER } from '../src/lib/sim/firmware.ts';
import { VOICE_CAVEATS } from '../src/lib/sim/voices.ts';
import { OUTPUTS } from '../src/lib/sim/output-stage.ts';
import { BOARDS } from '../src/lib/sim/board.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const VOICES_SRC = readFileSync(join(HERE, '..', 'src', 'lib', 'sim', 'voices.ts'), 'utf8');

/* Every `case 'x':` label in the file. buildVoice is the only switch on a
 * string literal in it, and if that stops being true this over-collects,
 * which fails safe: an extra name here can only make a real case look
 * present, and the VOICE_CAVEATS check below would still catch it. */
const CASES = new Set([...VOICES_SRC.matchAll(/case '([^']+)':/g)].map((m) => m[1]));

const OUTPUT_IDS = new Set(OUTPUTS.map((o) => o.id));
const BOARD_IDS = new Set(BOARDS.map((b) => b.id));

const problems = [];
const fail = (id, msg) => problems.push(`${id}: ${msg}`);

const seenIds = new Set();
for (const fw of FIRMWARES) {
  if (seenIds.has(fw.id)) fail(fw.id, 'duplicate id, so FIRMWARE_BY_ID silently keeps one of them');
  seenIds.add(fw.id);

  if (!GROUP_ORDER.includes(fw.group)) {
    fail(fw.id, `group "${fw.group}" is not in GROUP_ORDER, so this entry is dropped from the picker`);
  }
  if (!CASES.has(fw.voice)) {
    fail(fw.id, `voice "${fw.voice}" has no case in buildVoice, so RUN throws`);
  }
  if (!(fw.voice in VOICE_CAVEATS)) {
    fail(fw.id, `voice "${fw.voice}" has no VOICE_CAVEATS entry. Use [] to say there are none`);
  }

  if (fw.outputs.length === 0) fail(fw.id, 'no outputs, so the OUTPUT row is empty');
  for (const o of fw.outputs) {
    if (!OUTPUT_IDS.has(o)) fail(fw.id, `unknown output "${o}"`);
  }
  if (fw.boards.length === 0) fail(fw.id, 'no boards');
  for (const bd of fw.boards) {
    if (!BOARD_IDS.has(bd)) fail(fw.id, `unknown board "${bd}"`);
  }

  /* An entry has to be reachable on at least one board it claims, or the
   * output row falls back to a converter the example was not written for. */
  const reachable = fw.boards.some((bd) => {
    const board = BOARDS.find((x) => x.id === bd);
    return fw.outputs.some((o) => OUTPUTS.find((x) => x.id === o)?.boards.includes(board.id));
  });
  if (!reachable) fail(fw.id, 'no board in its list has any of its outputs');

  const params = fw.params ?? [];
  const keys = new Set();
  for (const p of params) {
    if (keys.has(p.key)) fail(fw.id, `duplicate param key "${p.key}", so paramMap keeps one value`);
    keys.add(p.key);
    if (p.value < p.min || p.value > p.max) {
      fail(fw.id, `param "${p.key}" default ${p.value} is outside ${p.min}..${p.max}`);
    }
  }

  if (fw.choices) {
    if (fw.choices.length === 0) fail(fw.id, 'choices is present and empty');
    fw.choices.forEach((c, i) => {
      if (c.value !== i) fail(fw.id, `choice ${i} has value ${c.value}; the index is what select() receives`);
      if (!c.label) fail(fw.id, `choice ${i} has no label`);
    });
  }
}

/* The other direction: a caveat list for a voice nothing uses is a note
 * about a program that is no longer in the catalogue. */
const usedVoices = new Set(FIRMWARES.map((f) => f.voice));
for (const v of Object.keys(VOICE_CAVEATS)) {
  if (!usedVoices.has(v)) problems.push(`VOICE_CAVEATS has "${v}", which no firmware uses`);
}
for (const g of GROUP_ORDER) {
  if (!FIRMWARES.some((f) => f.group === g)) {
    problems.push(`GROUP_ORDER has "${g}", which no firmware is in`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  ${p}`);
  console.log(`${problems.length} problem(s) in the simulator catalogue`);
  process.exit(1);
}

console.log(
  `ok       ${FIRMWARES.length} firmware entries across ${GROUP_ORDER.length} groups, ` +
    `${usedVoices.size} voice builders, all reachable`,
);
