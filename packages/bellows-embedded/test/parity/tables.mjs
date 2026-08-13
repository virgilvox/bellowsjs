/*
 * Value parity for the modules that make no sound.
 *
 * The audio harness in parity.mjs cannot see these. A wrong scale table, a
 * wrong chord stack, an off-by-one euclidean pattern or a mis-parsed MIDI
 * byte produces a note that is confident, plausible and wrong, and every
 * buffer-listening test passes anyway. So this compares values, and unlike
 * the audio gates it compares them EXACTLY: integers have no rounding
 * excuse. Only the tempo map is tolerance based, because it is the one
 * thing here that is real-valued.
 *
 *   node test/parity/tables.mjs            report
 *   node test/parity/tables.mjs --check    exit non-zero on any mismatch
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const SRC = join(PKG, '..', 'bellows', 'src');

/* Enum order in the C++ headers, which is what the dumper indexes by. */
const SCALE_NAMES = JSON.parse(execFileSync('node', ['-e', `
  const fs=require('fs');
  const s=fs.readFileSync(${JSON.stringify(join(PKG, 'src/bellows/theory/scales.h'))},'utf8');
  const b=s.match(/kScaleNames\\[kScaleCount\\] = \\{([\\s\\S]*?)\\};/)[1];
  process.stdout.write(JSON.stringify([...b.matchAll(/"([^"]*)"/g)].map(m=>m[1])));
`]).toString());

const CHORD_NAMES = JSON.parse(execFileSync('node', ['-e', `
  const fs=require('fs');
  const s=fs.readFileSync(${JSON.stringify(join(PKG, 'src/bellows/theory/chords.h'))},'utf8');
  const b=s.match(/kChordNames\\[kChordCount\\] = \\{([\\s\\S]*?)\\};/)[1];
  process.stdout.write(JSON.stringify([...b.matchAll(/"([^"]*)"/g)].map(m=>m[1])));
`]).toString());

const { euclid, rotate } = await import(join(SRC, 'seq/euclid.ts'));
const { SCALES } = await import(join(SRC, 'theory/scales.ts'));
const { CHORD_TYPES } = await import(join(SRC, 'theory/chords.ts'));
const { parseNote, noteName } = await import(join(SRC, 'theory/notes.ts'));
const { ElementaryCA } = await import(join(SRC, 'seq/automata.ts'));
const { lsystem, mapToDegrees } = await import(join(SRC, 'seq/lsystem.ts'));
const { Arpeggiator } = await import(join(SRC, 'seq/arp.ts'));
const { Markov } = await import(join(SRC, 'seq/markov.ts'));
const { TempoMap } = await import(join(SRC, 'seq/tempomap.ts'));
const { parseMidiMessage } = await import(join(SRC, 'io/webmidi.ts'));

const out = [];

/* Euclid. */
for (let steps = 1; steps <= 16; steps++) {
  for (let pulses = 0; pulses <= steps; pulses++) {
    out.push(`euclid ${pulses} ${steps} ${euclid(pulses, steps).join('')}`);
  }
}
for (let rot = -3; rot <= 3; rot++) {
  out.push(`euclidrot ${rot} ${euclid(3, 8, rot).join('')}`);
}

/* Scales, indexed in C++ enum order. */
SCALE_NAMES.forEach((name, i) => {
  const iv = SCALES[name];
  out.push(`scale ${i} ${name} ${iv ? iv.join(' ') + ' ' : 'MISSING'}`);
});

/* Chords, indexed in C++ enum order. */
CHORD_NAMES.forEach((name, i) => {
  const iv = CHORD_TYPES[name];
  out.push(`chord ${i} ${iv ? iv.join(' ') + ' ' : 'MISSING'}`);
});

/* Note parsing. The C++ returns a sentinel where the JS throws, since
 * there are no exceptions on an MCU, so a throw maps to that sentinel. */
const kNoteInvalid = -2147483648;
for (const n of ['C4', 'C#4', 'Db-1', 'g3', 'A0', 'B8', 'Fx', 'H4']) {
  let v;
  try {
    v = parseNote(n);
  } catch {
    v = kNoteInvalid;
  }
  out.push(`parsenote ${n} ${v}`);
}
for (let m = 0; m <= 127; m += 7) out.push(`notename ${m} ${noteName(m)}`);

/* Elementary CA. */
for (const rule of [30, 90, 110, 150]) {
  const ca = new ElementaryCA(rule, 32);
  for (let g = 0; g < 8; g++) {
    out.push(`ca ${rule} ${g} ${Array.from(ca.row).join('')}`);
    ca.step();
  }
}

/* Arp. Random is excluded on both sides: it draws from an rng. */
for (const mode of ['up', 'down', 'updown', 'downup', 'order']) {
  const a = new Arpeggiator({ mode, octaves: 2 });
  a.setNotes([60, 64, 67]);
  const seq = [];
  for (let i = 0; i < 12; i++) seq.push(a.next());
  out.push(`arp ${mode} ${seq.join(' ')} `);
}

/*
 * L-systems. Every other ported seq/ module was compared here from the
 * start and this one was not, so the rewrite was carried, built into
 * s9m_seq and quoted in the size tables without ever being diffed
 * against its source of truth. A rewrite that diverges plays a
 * confident, plausible, wrong sequence and no audio test can hear it.
 *
 * Only the deterministic form is compared, for the reason the arp rows
 * give above: the stochastic rule draws from an rng, and there the two
 * sides genuinely differ. Rng::Next() rounds the uint32 to float before
 * scaling and the JS keeps it in double, so a weighted draw that lands
 * near a boundary can pick different branches. That is the same rounding
 * the fxin rows in parity.mjs exist to pin, and it is a property of the
 * generator rather than of the L-system.
 *
 * kMaxLen on the C++ side is 512 so nothing here truncates. Truncation
 * is a C++-only behaviour with no JS counterpart, so it is not a parity
 * question and is not asked.
 */
const LSYS_CASES = [
  { name: 'algae', axiom: 'A', rules: { A: 'AB', B: 'A' }, gens: 8 },
  { name: 'cross', axiom: 'AB', rules: { A: 'BA', B: 'AAB' }, gens: 5 },
  { name: 'through', axiom: 'A[B]C+A', rules: { A: 'AB' }, gens: 4 },
  { name: 'erase', axiom: 'ABABA', rules: { A: 'AB', B: '' }, gens: 4 },
  { name: 'koch', axiom: 'F', rules: { F: 'F+F-F-F+F' }, gens: 3 },
];
for (const c of LSYS_CASES) {
  for (let g = 0; g <= c.gens; g++) {
    const r = lsystem(c.axiom, c.rules, g);
    out.push(`lsys ${c.name} ${g} 1 ${r.length} ${r}`);
  }
}
{
  const r = lsystem('A', { A: 'AB[C]', B: 'A-C' }, 4);
  /* -128 is kRestDegree in the C++, standing in for the JS null. */
  const degs = mapToDegrees(r, { A: 0, B: 2, C: null }).map((d) => (d === null ? -128 : d));
  out.push(`lsysdeg ${degs.length} ${degs.join(' ')} `);
}

/*
 * Markov chains.
 *
 * This is the one module here that is a REWRITE and not a transcription:
 * the JS keys a context by JSON.stringify into a Map per order and grows
 * for as long as you train, and the C++ packs the context into a uint32
 * and holds a fixed number of them. So there is more to get wrong here
 * than anywhere else in this file, and the sentence at the top applies
 * hardest: a wrong transition table plays a confident, plausible, wrong
 * melody and no audio test can hear it.
 *
 * Three things are compared, not one.
 *
 * The whole TABLE, per order, in the order contexts were first recorded,
 * which is the order both a JS Map and the C++ array iterate. Reading the
 * private `tables` field is deliberate: the table is what has to be right,
 * and the notes coming out of the chain only sample it.
 *
 * The ORDERING INSIDE each distribution, which the row carries because
 * symbols print in first-seen order. rng.weighted subtracts along the
 * array, so the same weights in a different order pick a different symbol
 * from the same draw, and nothing else would notice.
 *
 * And the WALK, step by step, so the backoff from order k down to 0 is
 * compared rather than assumed.
 *
 * The draw is compared here, where the arp's random mode above and the
 * L-system's stochastic rules are excluded because they draw from an rng.
 * What makes it possible is that Markov::NextWith on the C++ side takes
 * the uniform instead of drawing it, so both sides walk the same r. Every
 * r is a multiple of 1/16 and every weight is a small integer, so r *
 * total and the subtraction chain are exact in float and in double alike:
 * that is what keeps the generator's float rounding, which the fxin rows
 * in parity.mjs exist to pin, out of a comparison that is not about it.
 *
 * The six line weighted walk below is written out rather than taken from
 * rng.weighted, because a fixed r cannot be pushed into a NamedRng
 * closure. It is the reference, so what it gates is the C++ walk against
 * the JS one; prng.ts's own copy is not under test here and never was.
 *
 * Truncation is C++ only, like the L-system's, so it is not asked.
 */
{
  /* (2i + 1) / 16, matching the kDraws array in tables.cpp. No odd
   * numerator can land on a cumulative boundary of the cases below, whose
   * totals are 2, 3, 4, 5 and 10. */
  const DRAWS = [0.0625, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375];
  /* Draws that land EXACTLY on a boundary of the `edge` chain, whose every
   * distribution sums to 16. Without them nothing here can tell `r <= 0`
   * from `r < 0`, and the two sides have to agree on the tie. */
  const EDGE_DRAWS = [0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 0.875, 0.5];
  const fixed = (r) => ({
    weighted(weights) {
      let total = 0;
      for (let i = 0; i < weights.length; i++) total += weights[i];
      let x = r * total;
      for (let i = 0; i < weights.length; i++) {
        x -= weights[i];
        if (x <= 0) return i;
      }
      return weights.length - 1;
    },
  });

  const dump = (name, m) => {
    /* `tables` is private to TypeScript and an ordinary property at
     * runtime, which is the only way to see the table at all. */
    const tables = m.tables;
    let contexts = 0;
    for (let k = 0; k <= m.order; k++) contexts += tables[k].size;
    out.push(`mkvinfo ${name} ${m.order} ${contexts}`);
    for (let k = 0; k <= m.order; k++) {
      for (const [ck, bucket] of tables[k]) {
        const ctx = k === 0 ? '-' : JSON.parse(ck).join('');
        let line = `mkvtab ${name} ${k} ${ctx} ${bucket.values.length}`;
        for (let j = 0; j < bucket.values.length; j++) {
          line += ` ${bucket.values[j]} ${bucket.weights[j].toFixed(6)}`;
        }
        out.push(line);
      }
    }
  };

  const walk = (name, m, seed, draws = DRAWS) => {
    m.seed(seed);
    for (let i = 0; i < draws.length; i++) {
      let ok = 1;
      let v = -1;
      try {
        v = m.next(fixed(draws[i]));
      } catch {
        /* The C++ returns false where this throws, since an MCU has no
         * exceptions to throw. */
        ok = 0;
      }
      out.push(`mkvwalk ${name} ${i} ${draws[i].toFixed(4)} ${ok} ${v}`);
    }
  };

  const TUNE = [0, 1, 0, 2, 1, 0, 1, 2, 2, 0];
  for (const order of [1, 2]) {
    const m = new Markov(order);
    m.train(TUNE);
    dump(`o${order}`, m);
    walk(`o${order}`, m, [0, 1]);
  }
  {
    const m = new Markov(2);
    m.addTransition([0], 1, 1);
    m.addTransition([0], 1, 1);
    m.addTransition([0], 2, 3);
    m.addTransition([0, 1], 2, 1);
    m.addTransition([0, 1], 3, 2);
    m.addTransition([], 0, 1);
    m.addTransition([], 3, 4);
    dump('add', m);
    walk('add', m, [0, 1]);
  }
  {
    const m = new Markov(2);
    m.train([3, 0, 1]);
    dump('bko', m);
    walk('bko', m, [2, 0]);
  }
  {
    dump('empty', new Markov(2));
    walk('empty', new Markov(2), [0, 1]);
  }
  {
    /* Every distribution sums to 16, so a draw that is a multiple of 1/16
     * can leave the running total at exactly zero. Walked from the empty
     * context, the first three draws each land on a boundary. */
    const m = new Markov(1);
    m.addTransition([], 0, 4);
    m.addTransition([], 1, 12);
    m.addTransition([0], 1, 8);
    m.addTransition([0], 2, 8);
    m.addTransition([1], 0, 12);
    m.addTransition([1], 3, 4);
    m.addTransition([2], 2, 16);
    m.addTransition([3], 3, 16);
    dump('edge', m);
    walk('edge', m, [], EDGE_DRAWS);
  }
}

/* Tempo map, the closed form integral. */
{
  const tm = new TempoMap(120);
  tm.rampTo(8, 180);
  for (let b = 0; b <= 16; b++) {
    out.push(`tempo ${b} ${tm.beatToSeconds(b).toFixed(9)} ${tm.bpmAt(b).toFixed(9)}`);
  }
  for (let i = 0; i <= 8; i++) {
    const t = i * 0.75;
    out.push(`tempoinv ${t.toFixed(3)} ${tm.secondsToBeat(t).toFixed(9)}`);
  }
}

/* MIDI parsing. */
{
  const msgs = [
    [0x90, 60, 100], [0x90, 60, 0], [0x80, 60, 64], [0xb0, 7, 100],
    [0xc0, 5, 0], [0xd0, 90, 0], [0xe0, 0, 64], [0xe0, 127, 127],
    [0xa0, 60, 50], [0xf8, 0, 0],
  ];
  /* Kind ordering as declared in io/midi_parse.h, where 0 is kNone so an
   * unparsed message is falsy. The JS has no such member because it
   * returns null instead, which is the same idea in a language with
   * nullable returns. */
  const KIND = { noteOn: 1, noteOff: 2, keyPressure: 3, controlChange: 4,
                 programChange: 5, channelPressure: 6, pitchBend: 7 };
  for (const m of msgs) {
    const r = parseMidiMessage(m);
    if (!r) {
      out.push(`midi ${m[0].toString(16).padStart(2, '0')} ${m[1]} ${m[2]} -> 0 kind=-1 ch=-1 d1=-1 d2=-1`);
      continue;
    }
    const kind = KIND[r.type];
    const isBend = r.type === 'pitchBend';
    const d1 = isBend ? (m[1] & 0x7f) : (r.note ?? r.controller ?? r.program ?? r.value ?? 0);
    /* Pitch bend compares the assembled 14 bit word, which is what the
     * value actually means, rather than the raw second byte. */
    const d2 = isBend ? r.value : (r.velocity ?? r.value ?? 0);
    out.push(`midi ${m[0].toString(16).padStart(2, '0')} ${m[1]} ${m[2]} -> 1 kind=${kind} ch=${r.channel} d1=${d1} d2=${d2}`);
  }
}

/* Build the dumper here rather than expecting it to exist. test/parity/build
 * is gitignored, so a fresh clone has nothing in it, and this script used to
 * die with ENOENT on the very command HANDOFF.md documents as a harness.
 * parity.mjs already compiles its own probe this way. */
function buildDumper() {
  const bin = join(HERE, 'build', 'tables');
  mkdirSync(join(HERE, 'build'), { recursive: true });
  execFileSync(
    'c++',
    ['-std=c++17', '-O2', '-I', join(PKG, 'src'), join(HERE, 'tables.cpp'), '-o', bin],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return bin;
}

/* Compare. */
const cpp = execFileSync(buildDumper()).toString().trimEnd().split('\n');
const js = out;

let mismatches = 0;
const groups = {};
const n = Math.max(cpp.length, js.length);
for (let i = 0; i < n; i++) {
  const a = cpp[i] ?? '<missing in C++>';
  const b = js[i] ?? '<missing in JS>';
  if (a === b) continue;
  /* Tempo rows are real valued: compare numerically with a tolerance. */
  const ta = a.split(' ');
  const tb = b.split(' ');
  if (ta[0] === tb[0] && (ta[0] === 'tempo' || ta[0] === 'tempoinv') && ta.length === tb.length) {
    let ok = true;
    for (let k = 1; k < ta.length; k++) {
      const x = parseFloat(ta[k]);
      const y = parseFloat(tb[k]);
      const tol = Math.max(1e-5, Math.abs(y) * 1e-5);
      if (!(Math.abs(x - y) <= tol)) ok = false;
    }
    if (ok) continue;
  }
  mismatches++;
  const key = (ta[0] || 'other');
  (groups[key] ||= []).push({ i, cpp: a, js: b });
}

const total = {};
for (const line of cpp) total[line.split(' ')[0]] = (total[line.split(' ')[0]] || 0) + 1;

console.log('value parity: C++ against TypeScript, exact except the tempo map');
console.log(`${'group'.padEnd(12)}${'rows'.padStart(6)}${'bad'.padStart(6)}  result`);
for (const g of Object.keys(total)) {
  const bad = (groups[g] || []).length;
  console.log(`${g.padEnd(12)}${String(total[g]).padStart(6)}${String(bad).padStart(6)}  ${bad ? 'FAIL' : 'pass'}`);
}
if (mismatches) {
  console.log('\nfirst mismatches:');
  for (const g of Object.keys(groups)) {
    for (const m of groups[g].slice(0, 4)) {
      console.log(`  line ${m.i}\n    C++: ${m.cpp}\n    JS : ${m.js}`);
    }
  }
}
console.log(`\n${cpp.length} rows compared, ${mismatches} mismatched`);
if (process.argv.includes('--check') && mismatches) process.exit(1);
