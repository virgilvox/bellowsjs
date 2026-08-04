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
const { Arpeggiator } = await import(join(SRC, 'seq/arp.ts'));
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

/* Compare. */
const cpp = execFileSync(join(HERE, 'build', 'tables')).toString().trimEnd().split('\n');
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
