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
 * These are set to roughly TEN TIMES the drift actually measured, and that
 * ratio is the whole point. An earlier revision left the effect gates at
 * round numbers with 150x to 25000x headroom, and a deliberate 0.01 percent
 * mutation of the Svf integrator sailed straight through every one of them.
 * A gate with that much slack is not a test, it is a formality. If you add
 * a module here, measure it first and set the gate from the measurement.
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
  pluck: { rel: 5e-5, abs: 5e-5, note: 'recursive loop over its whole decay' },
  // Pitch, not audio. A wrong tuning table is silent and no buffer test can
  // hear it. Tight on purpose: this is one Exp2 either side, so anything
  // beyond float epsilon means a table is actually wrong.
  theory: { rel: 1e-6, abs: 2e-2, note: '12/19/24/31/53-EDO and 5-limit JI, note 21..108' },

  // The rest of the ported engines. These were written against the
  // TypeScript but never numerically checked until this harness covered
  // them, which is the whole reason the harness exists.
  snare: { rel: 3e-4, abs: 3e-4, note: 'two BLEP triangles plus filtered noise' },
  fm: { rel: 5e-3, abs: 5e-3, note: 'six operators, phase modulation compounds' },
  modal: { rel: 1e-3, abs: 1e-3, note: '24 two-pole resonators, long ring' },
  westcoast: { rel: 2e-2, abs: 2e-2, note: 'iterated wavefolder, very sensitive to rounding' },
  formant: { rel: 5e-3, abs: 5e-3, note: 'five bandpasses in parallel' },
  // Rel RMS is 1.7e-3. The abs gate is looser because the 0.4 percent of
  // samples that exceed it sit on the waveform's steep edges, spaced twice
  // per period at 220 Hz, where a sub-sample timing difference reads as a
  // large amplitude difference. Error grows 7e-5 -> 1.9e-3 across the note,
  // which is a recursive loop accumulating in f32, not a defect.
  tube: { rel: 5e-3, abs: 2e-2, note: 'recursive bore, error rides the edges' },

  // Effects, driven by bit-exact white noise so the only difference the
  // diff can see is the effect's own arithmetic.
  eq: { rel: 3e-6, abs: 3e-6, note: 'six Svf bands in series' },
  delay: { rel: 1e-6, abs: 1e-6, note: 'cubic reads, smoothed time' },
  saturator: { rel: 2e-6, abs: 2e-6, note: 'oversampled nonlinearity' },
  compressor: { rel: 2e-5, abs: 2e-5, note: 'dB domain detection, crest tracking' },
  // The chorus is measured twice on purpose. With modulation off the whole
  // signal path agrees to 6.3e-6, which is what proves the DSP. With it on
  // the error scales exactly with depth (0.1 -> 8e-3, 0.5 -> 4e-2) because
  // the LFO phase accumulates in float here and in double there, and a
  // fractional-sample shift of a white noise read is a large sample
  // difference for an identical sound. Sample-wise RMS is the wrong
  // instrument for a time-modulating effect; the static row is the gate
  // that would actually catch a broken chorus.
  chorus_static: { rel: 1e-4, abs: 1e-4, note: 'depth 0: the real DSP gate' },
  chorus: { rel: 6e-2, abs: 4e-2, note: 'depth 0.5: dominated by sub-sample LFO timing' },
  plate: { rel: 5e-3, abs: 5e-3, note: 'Dattorro tank, recirculating' },
};

/* Effects that take an EffectDef rather than an EngineDef, with the params
 * matching what render.cpp sets on the C++ side. */
const FX = {
  chorus_static: ['fx/modfx.ts', 'chorusDef', { depth: 0 }],
  eq: ['fx/eq.ts', 'eqDef', { b0gain: 6, b2gain: -4, b4gain: 3, b5gain: -2 }],
  delay: ['fx/delay.ts', 'delayDef', { maxSeconds: 0.25 }],
  saturator: ['fx/saturator.ts', 'saturatorDef', {}],
  compressor: ['fx/dynamics.ts', 'compressorDef', {}],
  chorus: ['fx/modfx.ts', 'chorusDef', {}],
  plate: ['fx/plate.ts', 'plateDef', {}],
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
    env: { ...process.env, BELLOWS_SEED: String(SEED), BELLOWS_RNG_LABEL: RNG_LABEL[voice] || '' },
    maxBuffer: 1 << 28,
  });
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const l = new Float32Array(frames);
  for (let i = 0; i < frames; i++) l[i] = f[2 * i];
  return l;
}

async function renderTs(voice, frames, freq, vel) {
  const src = join(LIB, 'src');
  const { mulberry32, rng: realRng } = await import(join(src, 'core/prng.ts'));
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
  if (FX[voice]) {
    const [path, name, params] = FX[voice];
    const def = (await import(join(src, path)))[name];
    const fx = def.create(SR, params);
    /* Same bit-exact noise the C++ side feeds itself. */
    const next = mulberry32(SEED);
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      l[i] = (2 * next() - 1) * 0.25;
      r[i] = (2 * next() - 1) * 0.25;
    }
    for (let i = 0; i < frames; i += 128) fx.process(l, r, i, Math.min(i + 128, frames));
    return l;
  }

  const mod = {
    kick: [join(src, 'engines/drums.ts'), 'kickEngine'],
    hat: [join(src, 'engines/drums.ts'), 'hatEngine'],
    snare: [join(src, 'engines/drums.ts'), 'snareEngine'],
    pluck: [join(src, 'engines/pluck.ts'), 'pluckEngine'],
    va: [join(src, 'engines/va.ts'), 'vaEngine'],
    fm: [join(src, 'engines/fm.ts'), 'fmEngine'],
    modal: [join(src, 'engines/modal.ts'), 'modalEngine'],
    westcoast: [join(src, 'engines/westcoast.ts'), 'westcoastEngine'],
    formant: [join(src, 'engines/formant.ts'), 'formantEngine'],
    tube: [join(src, 'engines/waveguide.ts'), 'tubeEngine'],
  }[voice];
  if (!mod) throw new Error('unknown voice ' + voice);
  const [path, name] = mod;
  const def = (await import(path))[name];

  /* Match the C++ side: one raw mulberry32 stream from the same seed,
   * wrapped in the NamedRng shape the engines expect. */
  /* Use the library's own labelled rng, so each engine forks exactly the
   * child streams it forks in the browser. The C++ side is told the
   * resulting label path (see RNG_LABEL below and the note in prng.h),
   * which is what makes the noise comparable at all.
   *
   * An earlier version of this harness faked fork() as a wrapper over one
   * shared generator. That made snare and va appear to pass while formant
   * appeared to fail, all three for the same reason: a component that
   * draws at construction stole a sample from its sibling's stream. Every
   * one of those verdicts was wrong. */
  const v = def.createVoice(SR, {}, realRng('parity'));
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

/* The label the C++ Rng must sit on to match each JS engine's stream.
 * Empty means the engine uses its parent stream directly. */
const RNG_LABEL = {
  snare: 'parity::snare/noise',
  va: 'parity::va',
  pluck: 'parity',
  modal: 'parity',
  formant: 'parity',
  tube: 'parity',
};

const check = process.argv.includes('--check');
const bin = buildRenderer();

console.log(`parity: C++ (float) versus TypeScript (double), ${SR} Hz, ${FRAMES} frames, seed ${SEED}`);
console.log(`${'module'.padEnd(11)}${'rel rms'.padStart(10)}${'max abs'.padStart(10)}${'gate'.padStart(9)}  result`);

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
    row = `${voice.padEnd(11)}${c.rel.toExponential(2).padStart(10)}${c.maxAbs.toExponential(2).padStart(10)}${String(gate.rel).padStart(9)}  ${pass ? 'pass' : 'FAIL'}  ${gate.note}`;
  } catch (err) {
    failed++;
    row = `${voice.padEnd(11)}${'ERROR'.padStart(29)}  ${String(err).split('\n')[0]}`;
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
