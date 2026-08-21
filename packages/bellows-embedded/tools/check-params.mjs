/*
 * Machine check that each C++ struct Params default equals the TypeScript
 * ParamSpec default it was hand-copied from.
 *
 * src/bellows/params.gen.h carries the TypeScript numbers and, per param,
 * the C++ field name the generator matched them to. Until this tool existed
 * nothing read either column: the generated constants were compiled by the
 * standalone-header check and used by no code, so a re-defaulted param in
 * TypeScript was caught only by a human reading the regenerated diff.
 *
 * The mapping is read out of params.gen.h rather than written here, for the
 * same reason test/parity/presets.mjs reads it: a second hand-written copy
 * of the JS-name to C++-field mapping is one more thing to drift.
 *
 * Every run prints what it did and did not compare, and two of the counts
 * are checked rather than reported, because a checker that quietly reads
 * nothing is the failure this repository keeps finding.
 *
 * Exit 0 when every mapped field matches, 1 on any mismatch, missing field
 * or unexplained non-numeric default. Run: npm run params:check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function braceBody(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open + 1, j);
  }
  return null;
}

function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth++;
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/* Every `enum class X { ... }` in the tree, as X::k -> integer value. */
function collectEnums() {
  const table = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.h')) {
        const src = stripComments(fs.readFileSync(p, 'utf8'));
        const re = /\benum\s+class\s+(\w+)[^{;]*\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(src)) !== null) {
          let next = 0;
          for (const raw of m[2].split(',')) {
            const t = raw.trim();
            if (!t) continue;
            const em = /^(\w+)\s*(?:=\s*(-?\d+))?$/.exec(t);
            if (!em) continue;
            const v = em[2] === undefined ? next : Number(em[2]);
            table.set(`${m[1]}::${em[1]}`, v);
            next = v + 1;
          }
        }
      }
    }
  };
  walk(SRC);
  return table;
}

/* field name -> the initializer text, for a class's nested struct Params. */
function paramsOf(headerRel, cls) {
  const src = stripComments(fs.readFileSync(path.join(SRC, headerRel), 'utf8'));
  const start = new RegExp(`\\bclass\\s+${cls}\\b`).exec(src);
  if (!start) return null;
  const after = /\bclass\s+[A-Za-z_]\w*/g;
  after.lastIndex = start.index + start[0].length;
  const nm = after.exec(src);
  const region = src.slice(start.index, nm ? nm.index : src.length);
  const at = region.indexOf('struct Params');
  if (at < 0) return null;
  const body = braceBody(region, at);
  if (body === null) return null;
  const out = new Map();
  for (const stmt of body.split(';')) {
    const t = stmt.trim();
    if (!t) continue;
    const m = /^[A-Za-z_][\w:<>]*\s+([\s\S]+)$/.exec(t);
    if (!m) continue;
    for (const decl of splitTopLevel(m[1])) {
      const d = /^\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:=\s*([\s\S]+))?$/.exec(decl);
      if (!d) continue;
      out.set(d[1], d[3] === undefined ? null : d[3].trim());
    }
  }
  return out;
}

function numberOf(init, enums) {
  if (init === null) return null;
  if (init === 'true') return 1;
  if (init === 'false') return 0;
  if (enums.has(init)) return enums.get(init);
  const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)f?$/.exec(init);
  return m ? Number(m[1]) : null;
}

const enums = collectEnums();
const gen = fs.readFileSync(path.join(SRC, 'bellows/params.gen.h'), 'utf8').split('\n');
const problems = [];
/* Every block's second line, counted before any parsing, so a change to the
 * first line's shape shows up as blocks present and not parsed rather than as
 * a quiet drop in coverage. */
const blocksPresent = gen.filter((l) => /^ \* \S+\.h class \w+, \d+ params\.$/.test(l)).length;
let units = 0;
let compared = 0;
let folded = 0;
let unmapped = 0;

for (let i = 0; i < gen.length; i++) {
  const head = /^\/\* ([a-z]\w*): (.+)$/.exec(gen[i]);
  if (!head) continue;
  const where = /^ \* (\S+\.h) class (\w+), (\d+) params\.$/.exec(gen[i + 1]);
  if (!where) {
    problems.push(`${head[1]}: block header line is not "<header> class <Class>, N params."`);
    continue;
  }
  const cols = gen[i + 2];
  const cName = cols.indexOf('name');
  const cMin = cols.indexOf('min', cName);
  const cDef = cols.indexOf('default', cols.indexOf('max', cMin));
  const cCpp = cols.indexOf('c++ field', cDef);
  const cUnit = cols.indexOf('unit', cCpp);
  if (cName < 0 || cCpp < 0 || cUnit < 0) {
    problems.push(`${head[1]}: cannot read the column header`);
    continue;
  }
  const fields = paramsOf(where[1], where[2]);
  if (!fields) {
    problems.push(`${head[1]}: no struct Params found in ${where[1]} class ${where[2]}`);
    continue;
  }
  units++;
  let rows = 0;
  for (let j = i + 3; j < gen.length; j++) {
    if (!gen[j].startsWith(' *   ')) break;
    rows++;
    const name = gen[j].slice(cName, cMin).trim();
    const want = Number(gen[j].slice(cDef, cCpp).trim());
    const cpp = gen[j].slice(cCpp, cUnit).trim();
    if (cpp === '-' || cpp === '') {
      unmapped++;
      continue;
    }
    if (cpp.endsWith('[]')) {
      folded++;
      continue;
    }
    if (!fields.has(cpp)) {
      problems.push(`${head[1]}.${name}: params.gen.h maps it to ${where[2]}::${cpp}, which does not exist`);
      continue;
    }
    const init = fields.get(cpp);
    const got = numberOf(init, enums);
    if (got === null) {
      problems.push(
        `${head[1]}.${name}: ${where[2]}::${cpp} default ${init ?? '(none)'} is not a number ` +
          'this tool can read, so it is unchecked. Teach numberOf() the form, or rename the field ' +
          'so the generator stops mapping the param to it.',
      );
      continue;
    }
    compared++;
    if (Math.abs(want - got) > 1e-6 * Math.max(1, Math.abs(want))) {
      problems.push(`${head[1]}.${name}: TypeScript default ${want}, ${where[2]}::${cpp} = ${got}`);
    }
  }
  /* The block header states its own row count. Comparing against it is what
   * stops this tool passing while reading nothing: a change to the emitted
   * layout would otherwise leave every loop below matching zero lines and
   * still exit 0. */
  if (rows !== Number(where[3])) {
    problems.push(`${head[1]}: block says ${where[3]} params, this tool read ${rows} rows`);
  }
}

if (units !== blocksPresent) {
  problems.push(
    `params.gen.h has ${blocksPresent} unit blocks and this tool parsed ${units}. ` +
      'The rest were read by nothing, which is the one failure a checker cannot report ' +
      'on its own, so it is reported here.',
  );
}

for (const p of problems) console.error(p);
console.log(
  `params: ${compared} defaults compared across ${units} units, ${folded} folded into an array field, ` +
    `${unmapped} with no C++ field, ${problems.length} problems`,
);
process.exit(problems.length ? 1 : 0);
