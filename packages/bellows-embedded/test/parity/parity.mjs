/*
 * Parity harness: does the C++ port still sound like the TypeScript?
 *
 * Renders the same note from both implementations and reports the
 * difference. This is deliberately tolerance based rather than exact.
 * The JavaScript computes in double because that is what a JS number is;
 * the C++ computes in float because that is what an MCU wants. Bit
 * equality is therefore impossible and is the wrong thing to test for.
 *
 * Two things ARE exact, and are asserted exactly. The PRNG: both sides run
 * the same xmur3 and mulberry32 over uint32, so if the noise streams diverge
 * the problem is the generator, not the DSP, and every downstream comparison
 * is meaningless until that is fixed. The harness checks it first for that
 * reason. And the effect input, the fxin rows: the effect rows all assume
 * the two implementations start from identical bits, and that assumption was
 * written into three comments and true in none of them until the JS was
 * taught to round where Rng::Bipolar() rounds.
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

/* Rows that are not 16384 audio frames. theory emits 6 * 88 pitch values and
 * no audio at all. gate_sweep and the fxin row that shares its envelope need
 * a long render because the ramp has to cross the gate's threshold slowly
 * enough for the threshold's exact value to be observable, and slow enough
 * to see it takes 65536 frames to finish: see DriveSample() in render.cpp
 * for the arithmetic that fixes the number. */
const FRAMES_BY_VOICE = {
  theory: 6 * 88,
  gate_sweep: 65536,
  fxin_sweep: 65536,
};

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
  // Was 7.9e-4 while the vibrato Lfo accumulated phase in float. Moving that
  // accumulator to a uint32 counter took it to 1.4e-5, so this gate is set
  // from the new measurement rather than the old one.
  formant: { rel: 1.5e-4, abs: 1.5e-4, note: 'five bandpasses in parallel' },
  // Rel RMS is 1.7e-3. The abs gate is looser because the 0.4 percent of
  // samples that exceed it sit on the waveform's steep edges, spaced twice
  // per period at 220 Hz, where a sub-sample timing difference reads as a
  // large amplitude difference. Error grows 7e-5 -> 1.9e-3 across the note,
  // which is a recursive loop accumulating in f32, not a defect.
  tube: { rel: 5e-3, abs: 2e-2, note: 'recursive bore, error rides the edges' },

  // Effects, driven by bit-exact white noise so the only difference the
  // diff can see is the effect's own arithmetic. These four rows are what
  // makes that sentence true rather than merely written down: they run the
  // effect input through no effect at all, one row per drive shape, and
  // demand it come back identical. It was not, until the JS was taught to
  // round where Rng::Bipolar() rounds. The old harness left 17580 of 32768
  // samples differing at 5.5e-8 rel rms, and the delay row was reading
  // 7.8e-8, so most of that row was this.
  //
  // Reverting that rounding fails the first three rows and not the fourth,
  // because the sweep uses only the sign of the draw and a sign survives any
  // rounding. What fxin_sweep does gate is the envelope: 6554 -> 6555 in one
  // language and not the other takes it to 5.6e-5 / 6.0e-7.
  fxin: { rel: 0, abs: 0, note: 'effect input, steady 0.25: must be bit exact' },
  fxin_hot: { rel: 0, abs: 0, note: 'effect input, hot 1.5: must be bit exact' },
  fxin_bursts: { rel: 0, abs: 0, note: 'effect input, 1 and 1/512: must be bit exact' },
  fxin_sweep: { rel: 0, abs: 0, note: 'effect input, gate ramp: must be bit exact' },
  eq: { rel: 3e-6, abs: 3e-6, note: 'six Svf bands in series' },
  // measured 9.5e-8 / 4.7e-8, on params chosen so the row measures the
  // effect rather than a memcpy: see FX below and the note in render.cpp.
  // On the defaults it read 5.7e-8 / 3.0e-8 and 0.1 percent mutations of
  // feedback, damping and the smoothing time all left it untouched to three
  // figures, because none of the three reached the output. Before the input
  // noise was fixed the same defaults read 7.8e-8, so seventy percent of
  // what the row did report was the harness's own rounding.
  delay: { rel: 1e-6, abs: 5e-7, note: 'cubic reads, feedback, damping, cross' },
  saturator: { rel: 2e-6, abs: 2e-6, note: 'oversampled nonlinearity, curve 0 tanh' },
  // The saturator's other three curves. Only curve 0 was ever rendered here,
  // and the golden render uses curve 0 too, so softClip, Foldback and the
  // Chebyshev evaluation were constrained by nothing in either language.
  // measured 1.4e-7 / 1.2e-7
  saturator_soft: { rel: 1.5e-6, abs: 1.2e-6, note: 'curve 1 cubic soft clip' },
  // measured 1.3e-7 / 8.9e-8
  saturator_fold: { rel: 1.3e-6, abs: 9e-7, note: 'curve 2 triangle wavefolder' },
  // measured 9.6e-7 / 3.9e-7, five to seven times the other curves because
  // the two sides run different algorithms on purpose: the JS interpolates a
  // 2048-point table, the C++ evaluates the Chebyshev recurrence directly
  // rather than spend 8 KB of flash. This row is therefore bounded by the
  // table's interpolation error, not by float rounding.
  saturator_cheby: { rel: 1e-5, abs: 4e-6, note: 'curve 3 Chebyshev, table against recurrence' },
  compressor: { rel: 2e-5, abs: 2e-5, note: 'dB domain detection, crest tracking' },
  // The chorus is measured twice on purpose. With modulation off the whole
  // signal path agrees to 6.3e-6, which is what proves the DSP. The
  // modulated row used to sit at 4e-2 and scale exactly with depth, because
  // the LFO phase accumulated in float here and in double there, and a
  // fractional-sample shift of a white noise read is a large sample
  // difference for an identical sound. Moving the accumulator to a uint32
  // counter (config.h, PhaseIncrement) took the modulated row to 2.0e-4 and
  // confirmed that diagnosis: the two rows now differ by a factor of 32
  // rather than four orders of magnitude. What is left is the read position
  // itself, which is still computed in float here and double there.
  // The static row remains the one that would catch a broken chorus.
  chorus_static: { rel: 1e-4, abs: 1e-4, note: 'depth 0: the real DSP gate' },
  chorus: { rel: 2e-3, abs: 1e-3, note: 'depth 0.5: sub-sample read position' },
  // Also carried by the fixed point phase: the tank modulation Lfo took this
  // row from 2.4e-3 to 1.3e-5.
  plate: { rel: 1.5e-4, abs: 1.5e-4, note: 'Dattorro tank, recirculating' },
  // Six effects that were ported and then compared to nothing. They are
  // built by the size sketches, but those assert nothing about output, so a
  // wrong coefficient in any of them was invisible in both languages at
  // once. All run on default params, which the two sides declare separately
  // and by hand, so the rows also prove the defaults still agree.
  // measured 1.1e-6 / 3.1e-6, driven hot so the ceiling is actually reached.
  // At the steady 0.25 input the row read 5.5e-8 and a 0.1 percent ceiling
  // change did not move it at all, because the limiter never engaged.
  limiter: { rel: 1.2e-5, abs: 3e-5, note: 'lookahead brickwall, sliding max' },
  // The gate is measured twice, on two envelopes, because each one is blind
  // to what the other sees.
  //
  // 'bursts' steps between 1 and 1/512 and measures timing. 0.1 percent
  // changes to the gate's attack, hold and release trip it, and so does the
  // same change to the detector's own release: after a step the detector is
  // in free decay and the sample at which it passes the threshold is set by
  // its time constant. measured 1.3e-6 / 4.8e-6.
  gate: { rel: 1.3e-5, abs: 5e-5, note: 'timing: attack, hold, release' },
  // 'sweep' ramps slowly through both thresholds instead of stepping past
  // them, and measures the thresholds. On the step envelope
  // kGateHysteresisDb 3.0 -> 3.003 left the row at 1.25e-6 / 4.77e-6,
  // unchanged to three figures, because a step crosses any threshold at the
  // same sample. On the ramp the same mutation gives 7.87e-5 / 5.16e-6, 46
  // and 168 times the baseline. The trade runs the other way too: the
  // detector's release moves this row not at all, which is why 'bursts'
  // stays. measured 1.7e-6 / 3.1e-8, and the abs gate is what catches the
  // threshold mutations. rel is left at the value the burst row uses, 7.6
  // times the measurement rather than 10, because widening a gate to match a
  // quieter reference signal is how gates rot.
  //
  // One constant is still not covered by either row: range_db, the closed
  // floor. -60 -> -60.06 moves this row to 3.18e-6 / 6.89e-8, only twice the
  // baseline, and no envelope fixes that. The floor multiplies the signal
  // only while the gate is shut, which caps that signal at the close
  // threshold, so the visible term is -60 dB under -43 dB and 0.1 percent of
  // it lands at -168 dB, below the float noise of everything else in the
  // row. Catching it needs a test that reads the gain, not the output.
  gate_sweep: { rel: 1.3e-5, abs: 3e-7, note: 'thresholds: open, close, hysteresis' },
  // The flanger is measured twice for the reason the chorus is, and the
  // numbers say the same thing: 7.9e-6 with modulation off against 2.9e-4
  // with it on, a factor of 37, which is the sub-sample read position and
  // not the DSP. The static row is the one that would catch a broken
  // flanger. measured 7.9e-6 / 2.8e-6 and 2.9e-4 / 1.5e-4.
  flanger_static: { rel: 8e-5, abs: 3e-5, note: 'depth 0: the real DSP gate' },
  flanger: { rel: 3e-3, abs: 1.5e-3, note: 'depth 0.7: sub-sample read position' },
  // measured 1.0e-6 / 4.6e-7. An LFO on a gain, so there is no read
  // position to disagree about and the fixed point phase carries it.
  tremolo: { rel: 1e-5, abs: 5e-6, note: 'LFO on gain, no delay line' },
  // measured 7.4e-6 / 1.4e-6. Larger than tremolo because the equal-power
  // pan law puts a sqrt either side of the LFO.
  autopan: { rel: 7.5e-5, abs: 1.5e-5, note: 'LFO through the equal-power pan law' },
  // measured 1.9e-5 / 8.0e-6. The carrier is a sine evaluated per sample,
  // so this row is mostly fm::Sin against Math.sin.
  ringmod: { rel: 2e-4, abs: 8e-5, note: 'sine carrier multiplied in' },
};

/* Effects that take an EffectDef rather than an EngineDef, with the params
 * matching what render.cpp sets on the C++ side. */
const FX = {
  chorus_static: ['fx/modfx.ts', 'chorusDef', { depth: 0 }],
  eq: ['fx/eq.ts', 'eqDef', { b0gain: 6, b2gain: -4, b4gain: 3, b5gain: -2 }],
  // Short and fractional so the cubic read interpolates, recirculating so
  // the feedback gain and the damping filter reach the output, and crossed
  // so that path is live too. See the note in render.cpp: on the defaults
  // none of those three reached the output inside a 16384 frame render.
  delay: [
    'fx/delay.ts',
    'delayDef',
    {
      maxSeconds: 0.25,
      timeL: 0.0107421875, // 11/1024 s, 473.73046875 samples
      timeR: 0.0166015625, // 17/1024 s, 732.12890625 samples
      feedback: 0.375,
      crossFeedback: 0.25,
      mix: 0.5,
    },
  ],
  saturator: ['fx/saturator.ts', 'saturatorDef', {}],
  saturator_soft: ['fx/saturator.ts', 'saturatorDef', { curve: 1 }],
  saturator_fold: ['fx/saturator.ts', 'saturatorDef', { curve: 2 }],
  saturator_cheby: ['fx/saturator.ts', 'saturatorDef', { curve: 3 }],
  compressor: ['fx/dynamics.ts', 'compressorDef', {}],
  chorus: ['fx/modfx.ts', 'chorusDef', {}],
  plate: ['fx/plate.ts', 'plateDef', {}],
  limiter: ['fx/dynamics.ts', 'limiterDef', {}],
  gate: ['fx/dynamics.ts', 'gateDef', {}],
  gate_sweep: ['fx/dynamics.ts', 'gateDef', {}],
  flanger_static: ['fx/modfx.ts', 'flangerDef', { depth: 0 }],
  flanger: ['fx/modfx.ts', 'flangerDef', {}],
  tremolo: ['fx/modfx.ts', 'tremoloDef', {}],
  autopan: ['fx/modfx.ts', 'autopanDef', {}],
  ringmod: ['fx/modfx.ts', 'ringmodDef', {}],
};

/*
 * Input shape per effect row, mirroring DriveSample() in render.cpp. Absent
 * means 'steady', which is 0.25 and is what every row before these was
 * written against.
 *
 * The limiter and the gate need their own because at 0.25 neither of them
 * does anything: a -0.3 dB ceiling is never reached and a -40 dB threshold
 * is never crossed downward, so both rows sat at their float noise floor
 * and passed a deliberate mutation.
 *
 * The gate gets two rows because neither envelope tests it alone. 'bursts'
 * steps between 1 and 1/512, which measures the timing: attack, hold,
 * release and the detector's own release all trip that row at 0.1 percent.
 * It cannot see the thresholds, because a step crosses any threshold at the
 * same sample, and kGateHysteresisDb 3.0 -> 3.003 did not move it at all.
 * 'sweep' is the mirror image, a slow ramp through both thresholds, and the
 * two together cover the class. See DriveSample() in render.cpp for the
 * shape and the three separate reasons it looks the way it does.
 *
 * Every constant in every shape is exactly representable in binary floating
 * point, so both sides start from the same envelope, and fillFxInput()
 * generates the noise the way the C++ generates it. The fxin rows gate that.
 */
const DRIVE = {
  limiter: 'hot',
  gate: 'bursts',
  gate_sweep: 'sweep',
  fxin_hot: 'hot',
  fxin_bursts: 'bursts',
  fxin_sweep: 'sweep',
};

/* One input sample from one Bipolar() draw. Mirrors DriveSample() in
 * render.cpp, which carries the reasoning; the short version is that 'sweep'
 * emits plus or minus its envelope rather than noise scaled by it, so the
 * gate's detector sees a clean ramp and the sample at which it crosses the
 * close threshold depends on the threshold rather than on which noise peak
 * happened to land last. */
function driveSample(kind) {
  if (kind === 'hot') return (i, u) => Math.fround(u * 1.5);
  if (kind === 'bursts') {
    return (i, u) => Math.fround(u * (Math.floor(i / 4096) % 2 === 0 ? 1.0 : 0.001953125));
  }
  if (kind === 'sweep') {
    return (i, u) => {
      const p = i % 65536;
      const t = p < 24576 ? p : p < 49152 ? 49152 - p : 0;
      const a = (6554 + t) * 5.9604644775390625e-7; // 10 * 2^-24
      return u < 0 ? -a : a;
    };
  }
  return (i, u) => Math.fround(u * 0.25);
}

/* Mirror of Rng::Bipolar() in core/prng.h, rounding exactly where the C++
 * rounds. Next() casts the uint32 to float BEFORE scaling by 2^-32, which
 * throws away everything below the top 24 bits, and Bipolar() then does the
 * subtraction in float. mulberry32 hands back u/2^32 as a double, so
 * multiplying by 2^32 recovers the uint32 exactly and Math.fround puts the
 * two roundings back.
 *
 * Doing this in double instead (2 * u01 - 1, rounded once at the
 * Float32Array store) is what the harness used to do, and it left 17580 of
 * 32768 samples differing at 5.5e-8 rel rms. The delay row measured 7.8e-8,
 * so about seventy percent of it was the input rather than the delay. */
function bipolar(u01) {
  return Math.fround(2 * Math.fround(u01 * 4294967296) * 2.3283064365386963e-10 - 1);
}

/* Fills the effect input buffers. Must stay identical to RenderFx() and
 * DriveSample() in render.cpp; the fxin rows are what proves it still is. */
function fillFxInput(mulberry32, l, r, frames, kind) {
  const next = mulberry32(SEED);
  const shape = driveSample(kind);
  for (let i = 0; i < frames; i++) {
    l[i] = shape(i, bipolar(next()));
    r[i] = shape(i, bipolar(next()));
  }
}

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
  /* The three fxin rows are the same C++ path under three drive shapes. */
  const arg = voice.startsWith('fxin') ? 'fxin' : voice;
  const buf = execFileSync(bin, [arg, String(frames), String(freq), String(vel), String(SR)], {
    env: {
      ...process.env,
      BELLOWS_SEED: String(SEED),
      BELLOWS_RNG_LABEL: RNG_LABEL[voice] || '',
      BELLOWS_FX_DRIVE: DRIVE[voice] || '',
    },
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
  if (voice.startsWith('fxin')) {
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    fillFxInput(mulberry32, l, r, frames, DRIVE[voice]);
    return l;
  }
  if (FX[voice]) {
    const [path, name, params] = FX[voice];
    const def = (await import(join(src, path)))[name];
    const fx = def.create(SR, params);
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    fillFxInput(mulberry32, l, r, frames, DRIVE[voice]);
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

console.log(
  `parity: C++ (float) versus TypeScript (double), ${SR} Hz, ${FRAMES} frames` +
    ` (${Object.keys(FRAMES_BY_VOICE).join(', ')} differ), seed ${SEED}`,
);
console.log(`${'module'.padEnd(11)}${'rel rms'.padStart(10)}${'max abs'.padStart(10)}${'gate'.padStart(9)}  result`);

let failed = 0;
for (const [voice, gate] of Object.entries(GATES)) {
  let row;
  try {
    const frames = FRAMES_BY_VOICE[voice] ?? FRAMES;
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
