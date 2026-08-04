/*
 * Parity harness: does the C++ port still sound like the TypeScript?
 *
 * Renders the same note from both implementations and reports the
 * difference. This is deliberately tolerance based rather than exact.
 * The JavaScript computes in double because that is what a JS number is;
 * the C++ computes in float because that is what an MCU wants. Bit
 * equality is therefore impossible and is the wrong thing to test for.
 *
 * What IS exact, and is asserted exactly: the PRNG. Both sides run the
 * same xmur3 and mulberry32 over uint32, so if the noise streams diverge
 * the problem is the generator, not the DSP, and every downstream
 * comparison is meaningless until that is fixed. The harness checks it
 * first for that reason.
 *
 *   node test/parity/parity.mjs            report only
 *   node test/parity/parity.mjs --check    exit non-zero if a gate fails
 *
 * Gates are per voice because the acceptable drift is not uniform: a
 * recursive loop like the pluck accumulates float error over its whole
 * decay, while a kick is a few hundred samples of a decaying sine.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const LIB = join(PKG, '..', 'bellows');
const BUILD = join(HERE, 'build');

const SR = 44100;
const FRAMES = 16384;
const SEED = 1;

/* Per voice: max allowed RMS of the difference relative to the RMS of the
 * reference, and max allowed absolute sample difference.
 *
 * These are set to roughly ten times the drift actually measured, so they
 * catch a real regression rather than rubber stamping anything that runs.
 * The measured values at the time of writing are in the comments. If you
 * change the DSP on either side and a gate trips, the question to ask is
 * which implementation moved, not whether to widen the gate. */
const GATES = {
  prng: { rel: 0, abs: 0, note: 'must be bit exact' },
  // measured 9.8e-5 / 7.9e-5
  kick: { rel: 1e-3, abs: 1e-3, note: 'decaying sine through tanh, short' },
  // measured 2.5e-4 / 2.3e-5
  hat: { rel: 2e-3, abs: 2e-3, note: 'six BLEP squares, table lookup in f32' },
  // measured 2.1e-3 / 4.9e-3, the largest drift: a ladder is nonlinear and
  // recursive, so f32 rounding compounds through four saturating stages
  va: { rel: 1e-2, abs: 2e-2, note: 'two BLEP oscillators into a ladder, nonlinear' },
  // measured 5.3e-6 / 1.9e-6
  pluck: { rel: 1e-4, abs: 1e-4, note: 'recursive loop over its whole decay' },
  // Pitch, not audio. A wrong tuning table is silent and no buffer test can
  // hear it. Tight on purpose: this is one Exp2 either side, so anything
  // beyond float epsilon means a table is actually wrong.
  theory: { rel: 1e-6, abs: 2e-2, note: '12/19/24/31/53-EDO and 5-limit JI, note 21..108' },
};

function buildRenderer() {
  mkdirSync(BUILD, { recursive: true });
  const out = join(BUILD, 'render');
  execFileSync(
    'c++',
    [
      '-std=c++17', '-O2', '-I', join(PKG, 'src'),
      join(HERE, 'render.cpp'), '-o', out,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return out;
}

function renderCpp(bin, voice, frames, freq, vel) {
  const buf = execFileSync(bin, [voice, String(frames), String(freq), String(vel), String(SR)], {
    env: { ...process.env, BELLOWS_SEED: String(SEED) },
    maxBuffer: 1 << 28,
  });
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const l = new Float32Array(frames);
  for (let i = 0; i < frames; i++) l[i] = f[2 * i];
  return l;
}

async function renderTs(voice, frames, freq, vel) {
  const src = join(LIB, 'src');
  const { mulberry32 } = await import(join(src, 'core/prng.ts'));
  if (voice === 'prng') {
    const next = mulberry32(SEED);
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = next();
    return out;
  }
  if (voice === 'theory') {
    const { Tuning } = await import(join(src, 'theory/tuning.ts'));
    const out = [];
    for (const n of [12, 19, 24, 31, 53]) {
      const t = Tuning.edo(n);
      for (let m = 21; m <= 108; m++) out.push(t.freqOf(m));
    }
    const ji = Tuning.ji([1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8]);
    for (let m = 21; m <= 108; m++) out.push(ji.freqOf(m));
    return Float32Array.from(out);
  }
  const mod = {
    kick: [join(src, 'engines/drums.ts'), 'kickEngine'],
    hat: [join(src, 'engines/drums.ts'), 'hatEngine'],
    snare: [join(src, 'engines/drums.ts'), 'snareEngine'],
    pluck: [join(src, 'engines/pluck.ts'), 'pluckEngine'],
    va: [join(src, 'engines/va.ts'), 'vaEngine'],
  }[voice];
  if (!mod) throw new Error('unknown voice ' + voice);
  const [path, name] = mod;
  const def = (await import(path))[name];

  /* Match the C++ side: one raw mulberry32 stream from the same seed,
   * wrapped in the NamedRng shape the engines expect. */
  const next = mulberry32(SEED);
  const makeRng = (label) => {
    const fn = () => next();
    fn.label = label;
    fn.fork = () => makeRng(label);
    fn.int = (n) => (next() * n) | 0;
    fn.pick = (a) => a[(next() * a.length) | 0];
    fn.range = (lo, hi) => lo + next() * (hi - lo);
    fn.chance = (p) => next() < p;
    fn.shuffle = (a) => a.slice();
    fn.gauss = () => (next() + next() + next() + next() - 2) * Math.SQRT2 * 0.875;
    fn.weighted = () => 0;
    return fn;
  };

  const v = def.createVoice(SR, {}, makeRng('parity'));
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  v.noteOn(freq, vel);
  for (let i = 0; i < frames; i += 128) {
    v.process(l, r, i, Math.min(i + 128, frames));
  }
  return l;
}

function compare(a, b) {
  const n = Math.min(a.length, b.length);
  let se = 0;
  let refSe = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    se += d * d;
    refSe += b[i] * b[i];
    const ad = Math.abs(d);
    if (ad > maxAbs) maxAbs = ad;
  }
  const rms = Math.sqrt(se / n);
  const refRms = Math.sqrt(refSe / n);
  return { rms, refRms, rel: refRms > 0 ? rms / refRms : rms, maxAbs, n };
}

const check = process.argv.includes('--check');
const bin = buildRenderer();

console.log(`parity: C++ (float) versus TypeScript (double), ${SR} Hz, ${FRAMES} frames, seed ${SEED}`);
console.log(`${'voice'.padEnd(8)}${'rel rms'.padStart(10)}${'max abs'.padStart(10)}${'gate'.padStart(9)}  result`);

let failed = 0;
for (const [voice, gate] of Object.entries(GATES)) {
  let row;
  try {
    const frames = voice === 'theory' ? 6 * 88 : FRAMES;
    const cpp = renderCpp(bin, voice, frames, 220, 0.9);
    const ts = await renderTs(voice, frames, 220, 0.9);
    const c = compare(cpp, ts);
    const pass = c.rel <= gate.rel + 1e-12 && c.maxAbs <= gate.abs + 1e-12;
    if (!pass) failed++;
    row = `${voice.padEnd(8)}${c.rel.toExponential(2).padStart(10)}${c.maxAbs.toExponential(2).padStart(10)}${String(gate.rel).padStart(9)}  ${pass ? 'pass' : 'FAIL'}  ${gate.note}`;
  } catch (err) {
    failed++;
    row = `${voice.padEnd(8)}${'ERROR'.padStart(29)}  ${String(err).split('\n')[0]}`;
  }
  console.log(row);
}

console.log('');
console.log('The PRNG gate is exact on purpose: if the generators diverge, every');
console.log('other row is meaningless. Everything else is tolerance based, because');
console.log('the JS computes in double and the C++ computes in float.');

if (check && failed > 0) {
  console.error(`\n${failed} parity gate(s) failed`);
  process.exit(1);
}
