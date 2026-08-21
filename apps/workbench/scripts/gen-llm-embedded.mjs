/*
 * Generates public/llm-embedded.txt, the LLM reference for the C++ port.
 *
 * The browser reference (gen-llm-ref.mjs) reads a BUILT library and asks it
 * what it contains, which is accuracy by construction. There is no built
 * artefact to interrogate here: the port is header only and its API is
 * whatever the headers declare. So this parses them.
 *
 * Parsing C++ with regular expressions is a bad idea in general and a
 * workable one here, because these headers are written to one narrow shape
 * on purpose: one class per concept, `struct Params` with defaulted fields,
 * `void Init(...)` overloads, PascalCase methods, trailing-underscore
 * members. Anything the patterns below cannot see is reported as a gap
 * rather than silently dropped, so a header that stops matching shows up in
 * the output instead of vanishing from it.
 *
 *   node scripts/gen-llm-embedded.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const pkg = join(app, '../../packages/bellows-embedded');
const src = join(pkg, 'src');
const root = join(src, 'bellows');

const props = readFileSync(join(pkg, 'library.properties'), 'utf8');
const version = /^version=(.*)$/m.exec(props)?.[1] ?? 'unknown';

/*
 * Board support, counted from the measured matrix in examples/README.md
 * rather than written out here.
 *
 * That table is the output of examples/build-matrix.sh, 119 real firmware
 * builds. Restating it in this file would make a fourth hand-maintained copy
 * of the same figures, after the repository README, the package README and
 * the npm one, and nothing checks any of them against each other. Parsing it
 * means this reference cannot disagree with what was actually built: if a
 * board stops fitting an example, this file says so on the next regenerate.
 */
function boardSupport() {
  const md = readFileSync(join(pkg, 'examples', 'README.md'), 'utf8').split('\n');
  const head = md.findIndex((l) => l.startsWith('| example | LC |'));
  if (head < 0) return null;
  const names = md[head].split('|').map((s) => s.trim()).filter(Boolean).slice(1);
  const rows = [];
  for (let i = head + 2; i < md.length && md[i].startsWith('|'); i++) {
    const cells = md[i].split('|').map((s) => s.trim()).filter(Boolean);
    rows.push({ example: cells[0], cells: cells.slice(1) });
  }
  if (!rows.length) return null;
  return {
    total: rows.length,
    boards: names.map((name, i) => ({
      name,
      builds: rows.filter((r) => r.cells[i] && r.cells[i] !== 'RAM' && r.cells[i] !== 'n/a').length,
      ram: rows.filter((r) => r.cells[i] === 'RAM').length,
      na: rows.filter((r) => r.cells[i] === 'n/a').length,
      refuses: rows.filter((r) => r.cells[i] === 'RAM').map((r) => r.example),
    })),
  };
}

const support = boardSupport();
if (!support) {
  console.error('could not parse the board matrix out of examples/README.md; refusing to');
  console.error('write a reference with no targets section rather than writing one silently.');
  process.exit(1);
}

/** Every header under src/bellows, in directory order. */
function headers(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...headers(full));
    else if (name.endsWith('.h')) out.push(full);
  }
  return out;
}

/** Strip comments so declarations inside prose cannot be mistaken for code. */
function decomment(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The one-sentence purpose: first line of the file's opening comment. */
function purpose(text) {
  const m = /^\/\*+\s*([\s\S]*?)\*\//.exec(text.trimStart());
  if (!m) return '';
  const first = m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)[0];
  return first ? first.replace(/\s+/g, ' ') : '';
}

/** `template <int kMaxSteps = 32, ...>` immediately before a class. */
function templateOf(body, index) {
  const before = body.slice(Math.max(0, index - 400), index);
  const m = /template\s*<([^>]*)>\s*$/.exec(before.trimEnd() + '');
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function classesIn(body) {
  const out = [];
  const re = /(?:^|\n)\s*(?:class|struct)\s+([A-Z]\w*)\s*(?::[^{]*)?\{/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({ name: m[1], at: m.index, tpl: templateOf(body, m.index) });
  }
  return out;
}

/** Body of a brace-balanced block starting at the `{` after `from`. */
function blockAt(body, from) {
  const open = body.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) return body.slice(open + 1, i);
    }
  }
  return '';
}

/** `float decay = 0.4f;` inside a Params struct. */
function paramsOf(classBody) {
  const at = classBody.search(/struct\s+Params\s*\{/);
  if (at < 0) return null;
  const inner = blockAt(classBody, at);
  const out = [];
  const re = /(?:^|\n)\s*([A-Za-z_][\w:<>]*)\s+(\w+)(\[[^\]]*\])?\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    out.push({ type: m[1], name: m[2] + (m[3] ?? ''), def: m[4].trim().replace(/\s+/g, ' ') });
  }
  return out;
}

/** Public method signatures, in declaration order. */
function methodsOf(classBody) {
  /* Everything before the first `private:` is the public surface: these
   * classes declare public first and never go back. */
  const cut = classBody.search(/(?:^|\n)\s*private:/);
  const pub = cut < 0 ? classBody : classBody.slice(0, cut);
  const out = [];
  const re = /(?:^|\n)\s{2}(?:static\s+|inline\s+|constexpr\s+)*([A-Za-z_][\w:<>&*\s]*?)\s+(\w+)\s*\(([^)]*)\)\s*(const)?\s*[{;]/g;
  let m;
  while ((m = re.exec(pub)) !== null) {
    const ret = m[1].replace(/\s+/g, ' ').trim();
    if (ret === 'struct' || ret === 'enum' || ret === 'return') continue;
    const args = m[3].replace(/\s+/g, ' ').trim();
    out.push(`${ret} ${m[2]}(${args})${m[4] ? ' const' : ''}`);
  }
  return out;
}

/**
 * Namespace-scope free functions and constants.
 *
 * Four headers are almost entirely these: config.h (Clamp, SafeRate, the
 * phase helpers), core/fastmath.h (the whole fm:: namespace), theory/
 * notes.h (note parsing and naming) and parts of theory/tuning.h. Leaving
 * them out made the reference look like the library had no free functions,
 * which is the kind of gap that teaches an LLM something false.
 */
function freeOf(body) {
  const fns = [];
  const consts = [];
  const fnRe = /(?:^|\n)(?:inline|static)\s+(?:constexpr\s+)?([A-Za-z_][\w:<>&*\s]*?)\s+(\w+)\s*\(([^)]*)\)\s*(?:const)?\s*[{;]/g;
  let m;
  while ((m = fnRe.exec(body)) !== null) {
    const ret = m[1].replace(/\s+/g, ' ').trim();
    if (!ret || ret === 'return') continue;
    fns.push(`${ret} ${m[2]}(${m[3].replace(/\s+/g, ' ').trim()})`);
  }
  const cRe = /(?:^|\n)inline\s+constexpr\s+([A-Za-z_][\w:<>]*)\s+(\w+)(\[[^\]]*\])?\s*=\s*([^;]+);/g;
  while ((m = cRe.exec(body)) !== null) {
    consts.push(`${m[1]} ${m[2]}${m[3] ?? ''} = ${m[4].trim().replace(/\s+/g, ' ').slice(0, 60)}`);
  }
  return { fns, consts };
}

/** Template classes declared then specialised, like Bank. */
function specialisedClasses(body) {
  const out = [];
  const re = /(?:^|\n)\s*(?:class|struct)\s+([A-Z]\w*)\s*<[^>]*>\s*(?::[^{]*)?\{/g;
  let m;
  while ((m = re.exec(body)) !== null) out.push({ name: m[1], at: m.index, tpl: templateOf(body, m.index) });
  return out;
}

/** Namespace-scope enums, which is how modes are selected. */
function enumsOf(body) {
  const out = [];
  const re = /enum\s+class\s+(\w+)\s*:?[^{]*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const values = m[2]
      .split(',')
      .map((v) => v.split('=')[0].trim())
      .filter(Boolean);
    out.push({ name: m[1], values });
  }
  return out;
}

const files = headers(root);
const byDir = new Map();
const gaps = [];

for (const file of files) {
  const rel = relative(src, file);
  const raw = readFileSync(file, 'utf8');
  const body = decomment(raw);
  const dir = dirname(relative(root, file));
  const key = dir === '.' ? '(top level)' : dir;

  const entry = {
    rel,
    purpose: purpose(raw),
    classes: [],
    enums: enumsOf(body),
  };

  const free = freeOf(body);
  entry.fns = free.fns;
  entry.consts = free.consts;

  for (const c of [...classesIn(body), ...specialisedClasses(body)]) {
    if (c.name === 'Params') continue;
    const cb = blockAt(body, c.at);
    entry.classes.push({
      name: c.name,
      tpl: c.tpl,
      params: paramsOf(cb),
      methods: methodsOf(cb),
    });
  }

  if (
    entry.classes.length === 0 &&
    entry.enums.length === 0 &&
    entry.fns.length === 0 &&
    entry.consts.length === 0
  ) {
    gaps.push(`${rel}: no class or enum matched the patterns`);
  }

  if (!byDir.has(key)) byDir.set(key, []);
  byDir.get(key).push(entry);
}

const ORDER = ['(top level)', 'core', 'config', 'dsp', 'engines', 'fx', 'seq', 'theory', 'io', 'platform'];
const dirs = [...byDir.keys()].sort((a, b) => {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});

let out = `# bellows-embedded ${version}: LLM reference

The C++17 port of bellowsjs for 32-bit microcontrollers. Header only. Nothing
allocates and nothing self-registers.

GENERATED from the headers by apps/workbench/scripts/gen-llm-embedded.mjs. Do
not edit. Regenerate after changing any header.

## How to read this

Every entry is a real declaration parsed out of a real header. Template
parameters are shown with their defaults, so Pluck<110> means the 110 Hz
floor and the default sample rate. A Params struct lists every field with the
default the header sets, and those defaults are the browser library's
defaults, because the two are compared numerically on every commit.

## The rules that shape the API

1. One header per concept. Include only what you use: there is no registry,
   so the linker keeps exactly the engines you name.
2. Init() rather than constructors. Every class is default constructible and
   does its real setup in Init(sample_rate, ...).
3. Voices ADD into (l, r, from, to). Effects process that range in place.
   The caller clears the block.
4. No allocation. Every buffer is sized by a template parameter.
5. Rates come from the SDK, not from a literal. Everything derived from the
   rate is computed in Init.
6. Randomness flows through Rng, seeded by a label. Forking is literal string
   concatenation: rng('a').fork('b') in the browser is Rng::Init("a::b") here,
   which is what makes a seeded piece reproduce across the two.

## Installing

It is in both registries. PlatformIO:

    lib_deps = virgilvox/Bellows

Arduino, from the Library Manager, by name, or on the command line:

    arduino-cli lib install Bellows

Not on npm, and not meant to be: the npm package bellowsjs is the browser
library, a different artefact from this. To build against a working copy
instead, point lib_extra_dirs at packages/bellows-embedded in a clone of the
monorepo, or take main with
lib_deps = https://github.com/virgilvox/bellowsjs.git#main.

The layout is the Arduino 1.5 format, everything under src/, so
#include <bellows/engines/drums.h> resolves once installed. Include
<Bellows.h> FIRST, before any <bellows/...> header: the Arduino builder
attributes a sketch's includes to libraries by name, and a nested path alone
does not tell it which library to put on the include path. Getting that wrong
is not a warning, it is a sketch that does not compile, and it was true of
every example in this library until 2026-08-16. There are no .cpp files at
all, so nothing is archived and dot_a_linkage is deliberately not set.

The Arduino package and the PlatformIO package are not byte-identical, in one
respect. Six examples share a patch with a sibling folder, reaching it as
"../10_AudioShield/audioshield.h" and two of that shape, so that comparing two
output examples compares converters rather than programs. PlatformIO compiles
a folder in place and resolves that. The Arduino IDE preprocesses a sketch
into a build directory first and does not, measured rather than assumed, so
the Arduino package carries a copy of the header next to each sketch with the
include rewritten. Everything else is the same file.

## Build flags

    BELLOWS_FAST_MATH     default 0. 1 swaps libm for polynomial
                          approximations. Accuracy is gated against libm in
                          CI. Not bit-identical to the JavaScript.
    BELLOWS_SAMPLE_RATE   default 48000. Sizes compile-time buffers ONLY.
                          Init() still takes the real rate, and everything
                          derived from the rate is computed there.
    BELLOWS_BLOCK_SIZE    default 128. Matches the AudioWorklet quantum and
                          the Teensy Audio Library block.

In PlatformIO put them in build_flags. In the Arduino IDE edit
src/bellows/config.h, or define them before including any bellows header.

## Minimal program

    #include <Audio.h>
    #include "bellows/platform/teensy.h"
    #include "bellows/engines/drums.h"

    static bellows::Kick kick;

    struct Patch {
      void operator()(float* l, float* r, int from, int to) {
        kick.Process(l, r, from, to);
      }
    };

    static Patch patch;
    static bellows::BellowsAudioStream<Patch> node(patch);
    static AudioOutputI2S out;
    static AudioConnection c1(node, 0, out, 0);
    static AudioConnection c2(node, 1, out, 1);

    void setup() {
      kick.Init(bellows::TeensySampleRate());
      /* AudioMemory LAST. It is what opens the audio interrupt, so
       * anything initialised after it can be rendered before it is
       * ready, and a delay line without its buffer reads through a null
       * pointer, which on an IMXRT1062 is executable memory rather than
       * a trap page. Init everything first, then this. */
      AudioMemory(12);
    }

    void loop() {
      kick.NoteOn(50.0f, 0.9f);
      delay(500);
    }

Earlier revisions of this file had those two lines the other way round, which
is the ordering that produced a real null render window on a board. Every
example in the repository calls AudioMemory last.

## Targets, measured by building

Counted from the board matrix in examples/README.md, which is the output of
examples/build-matrix.sh: all ${support.total} examples compiled for each part with the
Arduino core and the Audio Library linked in.

${support.boards
  .map((b) => {
    const note = b.na
      ? `${b.na} declines on purpose (a 4.x has no DAC)`
      : b.ram
        ? `refuses ${b.refuses.length <= 2 ? b.refuses.join(', ') : `${b.ram} of them`}`
        : 'all of them';
    return `    ${(b.name + ' ').padEnd(10, '.')} ${String(b.builds).padStart(2)} of ${support.total} build, ${note}`;
  })
  .join('\n')}

Daisy Seed is not in that matrix because it is not a Teensy. examples/
daisy_onekick links 01_OneKick as a real Daisy image against libDaisy 8.1.0,
and the logic headers compile against the Daisy adapter for the STM32H750.

Only Teensy and Daisy have a platform layer: src/bellows/platform/ holds
teensy.h and daisy.h and nothing else. Targeting an ESP32 or an RP2350 means
writing that layer first.

WHAT A BUILD PROVES, and this matters when answering questions about fit. It
proves the code is valid for the part and fits in its memory. It does not
prove the part keeps up. Teensy LC and 3.2 have no floating point unit and
emulate every operation this library performs. ONE board has been run: a
Teensy 4.0 at 600 MHz playing the heaviest program in the set through an I2S
amplifier, at 33.8 to 46.5 percent CPU with a 47.3 percent running maximum and
2 of 24 audio blocks. Everything else here is compile-verified and
numerically verified, which is a different claim.

`;

for (const dir of dirs) {
  out += `\n## ${dir}\n`;
  for (const e of byDir.get(dir)) {
    out += `\n### ${e.rel}\n`;
    if (e.purpose) out += `${e.purpose}\n`;
    for (const en of e.enums) {
      out += `\nenum class ${en.name}: ${en.values.join(', ')}\n`;
    }
    if (e.consts && e.consts.length) {
      out += `\nconstants:\n`;
      for (const c of e.consts) out += `  ${c}\n`;
    }
    if (e.fns && e.fns.length) {
      out += `\nfunctions:\n`;
      for (const f of e.fns) out += `  ${f}\n`;
    }
    for (const c of e.classes) {
      out += `\n${c.tpl ? `template <${c.tpl}>\n` : ''}class ${c.name}\n`;
      if (c.params && c.params.length) {
        out += `  Params:\n`;
        for (const p of c.params) out += `    ${p.type} ${p.name} = ${p.def}\n`;
      } else if (c.params) {
        out += `  Params: (empty)\n`;
      }
      if (c.methods.length) {
        out += `  public:\n`;
        for (const m of c.methods) out += `    ${m}\n`;
      }
    }
  }
}

if (gaps.length) {
  out += `\n## Headers this generator could not read\n\n`;
  out += `Listed rather than dropped, because a header that stops matching the\n`;
  out += `patterns should be visible here instead of quietly missing.\n\n`;
  for (const g of gaps) out += `- ${g}\n`;
}

writeFileSync(join(app, 'public/llm-embedded.txt'), out);
console.log(
  `llm-embedded.txt written: ${files.length} headers, ${dirs.length} groups, ${gaps.length} unreadable, ${(out.length / 1024).toFixed(1)} KB`,
);
