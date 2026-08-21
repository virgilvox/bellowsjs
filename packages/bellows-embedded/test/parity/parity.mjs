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
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
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
  // measured 3.63e-5 / 3.98e-5, and the gate is ten times each. Almost all
  // of that is pitch, not the bank: both sides carry f0 as log2 and take it
  // back with a power of two, and doing that round trip in float instead of
  // double detunes the C++ oscillator by about 0.0007 cents, which opens
  // into 2e-4 radians of phase at the fundamental over the render. The
  // uint32 phase counter is what keeps it there. With a float accumulator
  // instead, everything else equal, this row reads 6.42e-4 / 1.19e-3.
  //
  // What the gate catches, all at 0.1 percent: the brightness tilt exponent
  // 2.5 -> 2.5025 gives 1.06e-3 / 3.46e-4, and the even/odd gain 2.0 ->
  // 2.002 gives 4.18e-4 / 1.35e-4. Both trip it. Two constants it does not
  // catch, and the reason is the same for both: they act on a small part of
  // the output. The 3500 Hz rolloff corner -> 3503.5 gives 1.99e-4 / 8.86e-5
  // because 1/(1 + rel^4) is flat where most of the energy is, and the noise
  // bandpass Q 1.5 -> 1.5015 gives 4.76e-5 / 5.04e-5 because noise_mix
  // defaults to 0.1, so the whole noise path is a tenth of the signal.
  // Catching those two needs a second row on non-default params, the way the
  // delay row is set up, not a tighter gate on this one.
  harmonic: { rel: 3.6e-4, abs: 4e-4, note: '64 partial sine bank plus filtered noise' },
  // measured 1.3e-4 / 5.7e-5 over 32 partials, so the gates are ten times
  // each of those. What the row measures is a frequency offset, not a
  // rounding floor: cut the render to 4096 frames and it reads 3.5e-5, a
  // factor of 3.7 for a factor of 4 in length, so the error grows with the
  // note. Each partial's increment is hz / sr rounded once to float, about
  // 6e-8 relative, and at 16384 frames the 32nd partial has run 2614 cycles,
  // so 6e-8 of that is 1.6e-4 cycles of phase. Keeping the decay state in
  // double instead of float moved the row not at all (1.30e-4 either way),
  // which is how the repeated multiply was ruled out.
  additive: { rel: 1.3e-3, abs: 5.7e-4, note: '32 sine partials, per partial decay' },
  // The same engine on the params the empty record leaves at zero, so the
  // inharmonicity stretch, the cents conversion, the frame morph and the
  // Nyquist cut are measured rather than assumed. measured 1.1e-4 / 6.2e-5,
  // gates at ten times each. What it catches, measured: inharm 1/64 ->
  // 1.001/64 takes it to 1.4e-1, 1276 times the baseline, because the
  // stretch multiplies every partial's frequency and the phase error grows
  // through the note. What it does not catch is a 0.1 percent change of
  // morph itself, which reads 5.0e-4, 4.4 times the baseline and inside
  // this gate: a lerp weight moves the levels by its own 0.1 percent and
  // nothing amplifies it. A morph error large enough to be a transcription
  // fault rather than a rounding slip (1 percent) does trip it.
  additive_morph: { rel: 1.1e-3, abs: 6.2e-4, note: 'stretch, cents, morph, Nyquist cut' },
  // The same params again with morph off the halfway point, and it is here
  // because of what morph = 0.5 cannot see. The lerp is
  // lvl = a + (b - a) * morph, so at exactly 0.5 the weight is its own
  // reflection: a port that wrote 1 - morph, which is the likeliest way to
  // transcribe this line wrong, renders a note the row above cannot tell
  // from a correct one. Mutating additive.h:197 to (1.0f - morph) leaves
  // additive_morph at 1.12e-4, its usual figure, passing. This row goes to
  // 5.50e-1, about 5100 times its own baseline.
  //
  // The `additive` row does fail on that same mutation, and that is luck
  // rather than cover: its morph is the default 0, so inverting the weight
  // sends it to 1, the largest move available. It is the default-record row
  // and not a morph test, so anything that later gives that record a morph
  // value takes the coverage away with no warning. 13/16 is dyadic, so the
  // weight here is the same number in float and in double before the engine
  // touches it.
  //
  // measured 1.07e-4 / 6.52e-5, gates at ten times each. This does not close
  // the sensitivity note above, and nothing in the amplitude domain can: a
  // 0.1 percent error in a lerp weight moves the levels by 0.1 percent and
  // nothing amplifies it, so it will always sit near a 1e-4 baseline. What
  // these two rows together pin is the DIRECTION and the ENDPOINTS of the
  // morph, which is where a transcription fault actually lands.
  additive_morph_hi: { rel: 1.07e-3, abs: 6.5e-4, note: 'morph off the symmetric point, pins direction' },
  // Rel RMS is 1.7e-3. The abs gate is looser because the 0.4 percent of
  // samples that exceed it sit on the waveform's steep edges, spaced twice
  // per period at 220 Hz, where a sub-sample timing difference reads as a
  // large amplitude difference. Error grows 7e-5 -> 1.9e-3 across the note,
  // which is a recursive loop accumulating in f32, not a defect.
  tube: { rel: 5e-3, abs: 2e-2, note: 'recursive bore, error rides the edges' },
  // The string half of waveguide.ts, on the params in VOICE_PARAMS rather
  // than the defaults: on an empty record bow, body, vibDepth, dynamics and
  // polDetune are all zero or absent and the row would have compared a plain
  // plucked loop while calling the bowed engine ported.
  //
  // measured 1.98e-4 / 2.56e-4, so the gates are ten times each. What the
  // row measures is a recursive loop accumulating in f32, the same thing the
  // pluck and tube rows measure: cut the render and it reads 4.75e-5 at 2048
  // frames, 8.85e-5 at 4096, 1.21e-4 at 8192, so 8 times the note for 4.2
  // times the error. It accumulates sublinearly because the friction junction
  // servos the string back to the bow velocity every slip cycle, which is a
  // correction the free bore in the tube row has nothing equivalent to.
  //
  // It is NOT the body bank: rerun with body_z1_ and body_z2_ in double
  // instead of float and the row reads 1.98e-4 / 2.56e-4, unchanged to three
  // figures, which is how the 24 biquads were ruled out.
  //
  // What the row catches, measured, as the factor by which a 0.1 percent
  // mutation of one constant moves rel rms above the 1.98e-4 baseline:
  // dispersion coefficient 114x, bow junction gain 37x, comb depth 23x, bow
  // hair cutoff 15x, forest mode 0 frequency 14x, pitch settle tau 14x,
  // vibrato asymmetry 6x. The first five are the parts of this engine that
  // had no coverage of any kind before this row existed.
  //
  // What it does NOT catch, and this is the honest half: body dry bleed
  // 2.2x, junction noise force gain 2.0x, jitter amount 1.5x, the STK
  // friction offset 1.1x, polarization coupling 1.07x. All five are small
  // shares of a sum (the noise paths are a couple of percent of the bow
  // velocity, the second polarization is 6 dB down and only 0.12 of the
  // force couples into it), so 0.1 percent of them lands under this row's
  // own float noise and no choice of params fixes that. Catching them needs
  // a test that reads the injected force rather than the output.
  waveguide: { rel: 2e-3, abs: 2.6e-3, note: 'bowed string, friction loop plus 24 body modes' },
  // The wavetable, twice: the same voice and params at 220 Hz and at 55 Hz,
  // which is what picks the mip level. measured 2.6e-5 / 5.0e-5 and
  // 2.0e-5 / 4.8e-5, and each gate is ten times its own measurement.
  //
  // Both rows compare against a reference table built at the length the
  // port ships (see wavetableSet()), not at the TypeScript's 2048 points,
  // because 2048 points is 320 KB of flash. What they gate is the engine.
  //
  // What they measure is a frequency offset rather than a rounding floor,
  // and it is the residual the fixed point phase leaves: the increment is
  // rounded once to within half of 2^-32 of a cycle, which is a fixed
  // detune, so the phase error grows with the note. Cut the render to 1024
  // frames and the first row reads 1.1e-5, run it to 65536 and it reads
  // 1.5e-4, and the largest sample difference always lands in the last few
  // hundred samples. Snapping the JS increments onto the same 2^-32 grid
  // takes the 65536 frame case to 3.0e-6 and stops it growing with length,
  // which is what pins the diagnosis: everything else in the voice agrees
  // to about 3e-6.
  //
  // What the gates catch, all at 0.1 percent: the frame crossfade weight,
  // 1.33e-3 and 1.27e-3, fifty times each baseline; and the resonance to Q
  // map, 3.09e-4 and 2.36e-4, which is the least covered constant here at
  // twelve times. It is covered at all only because the filter is set where
  // it does some work: at the motion-pad preset's own 3800 Hz and
  // resonance 0.15 the same mutation read 1.58e-4 against a 3.15e-5
  // baseline, five times, and would have sailed through.
  //
  // What they do NOT catch is the interpolation fraction. 0.1 percent of it
  // is a read offset of 0.001 table samples, the same size as the increment
  // drift already in the row, and it reads 1.99e-5, under the baseline.
  // Five percent shows (9.18e-4 and 2.34e-3), and so would any wrong shift,
  // because those are not small numbers. A tighter gate cannot fix that
  // one: the row would have to be shorter than the drift it is measuring.
  wavetable: { rel: 2.6e-4, abs: 5e-4, note: 'mipmap read, frame morph, level 2' },
  wavetable_low: { rel: 2e-4, abs: 4.8e-4, note: 'level 0, worst interpolation' },

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
    harmonic: [join(src, 'engines/harmonic.ts'), 'harmonicEngine'],
    additive: [join(src, 'engines/additive.ts'), 'additiveEngine'],
    additive_morph: [join(src, 'engines/additive.ts'), 'additiveEngine'],
    additive_morph_hi: [join(src, 'engines/additive.ts'), 'additiveEngine'],
    tube: [join(src, 'engines/waveguide.ts'), 'tubeEngine'],
    waveguide: [join(src, 'engines/waveguide.ts'), 'stringEngine'],
    wavetable: [join(src, 'engines/wavetable.ts'), 'makeWavetableEngine'],
    wavetable_low: [join(src, 'engines/wavetable.ts'), 'makeWavetableEngine'],
  }[voice];
  if (!mod) throw new Error('unknown voice ' + voice);
  const [path, name] = mod;
  const ex = (await import(path))[name];
  /* Most rows name an EngineDef. The wavetable names a factory instead,
   * because its engine is a wrapper around a table that the port ships at a
   * different length: see wavetableSet(). */
  const def = typeof ex === 'function' ? ex(await wavetableSet()) : ex;

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
  const v = def.createVoice(SR, VOICE_PARAMS[voice] ?? {}, realRng('parity'));
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  v.noteOn(freq, vel);
  for (let i = 0; i < frames; i += 128) {
    v.process(l, r, i, Math.min(i + 128, frames));
  }
  return l;
}

/*
 * The morph table the wavetable rows compare against.
 *
 * The TypeScript's default 'wavetable' engine builds this table at 2048
 * points, which is 327680 bytes of mipmap. The port cannot put that in the
 * flash of a 256 KB part, so tools/gen-tables.mjs emits it at a length the
 * committed header records (512 by default), and the reference here is
 * built at the same length by reading that number back. What these rows
 * gate is therefore the ENGINE: the oscillator's phase, its interpolation,
 * its mip selection, the scan LFO, the envelope, the filter and the pan.
 *
 * The table DATA is not left ungated by that, it is gated somewhere better:
 * the generator builds it by calling this library's own
 * WavetableSet.fromFrames, and refuses to emit anything if its copy of the
 * four waveform formulas stops reproducing the set the shipped engine
 * plays. Comparing float literals here would only re-measure that.
 *
 * buildMorphFrames is imported from the generator rather than copied, so
 * there is one copy of those formulas in this repository and not two.
 */
async function wavetableSet() {
  const { WavetableSet } = await import(join(LIB, 'src', 'dsp/wavetable.ts'));
  const { buildMorphFrames } = await import(join(PKG, 'tools', 'gen-tables.mjs'));
  const header = readFileSync(join(PKG, 'src', 'bellows/dsp/wavetable_tables.h'), 'utf8');
  const m = /kWtMorphLength\s*=\s*(\d+)/.exec(header);
  if (!m) throw new Error('no kWtMorphLength in src/bellows/dsp/wavetable_tables.h');
  return WavetableSet.fromFrames(buildMorphFrames(Number(m[1])), SR);
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

/*
 * Construction params per voice, for the rows where the engine's defaults
 * would leave most of it unmeasured. Absent means an empty record, which is
 * what every row before this one used and what keeps them comparable to
 * their own history.
 *
 * The string is the case that forced this. Its bowed apparatus is the bulk
 * of the engine and every part of it defaults to neutral, so on an empty
 * record the row would have compared a plucked Karplus-Strong loop and
 * called the friction table, the bow position comb, the 24 body modes, the
 * attack jitter, the pitch settle and the second polarization ported. Each
 * value below turns on a branch, and two are chosen rather than merely
 * nonzero: bodySize 0.25 lands between the viola and cello anchors so the
 * morph actually interpolates instead of picking a stored row, and vibOnset
 * 0.0625 puts the end of the raised cosine ramp at 0.3625 s, inside the
 * 0.3714 s the render covers, so the ramp is measured and not just started.
 *
 * polDetune has to be PRESENT, not merely nonzero: the JS allocates the
 * second delay line only when the key is in the record at construction.
 *
 * These are mirrored by hand in render.cpp, so the row also proves the two
 * sides still agree about what each param means.
 */
const VOICE_PARAMS = {
  /*
   * The additive engine's second row, and the reason it exists is the same
   * one: on an empty record morph, inharm and every detune are 0, so the
   * plain 'additive' row compares an exactly harmonic sawtooth and would
   * have called the inharmonicity stretch, the cents conversion, the frame
   * morph and the Nyquist cut ported without measuring any of them.
   *
   * inharm 1/64 is chosen for where it puts the cut, not for the timbre.
   * Partial 26 lands at 19450 Hz and partial 27 at 20907, against a limit
   * of 0.45 * 44100 = 19845, so the scan stops at 26 and both sides agree
   * about it with 400 Hz of margin: a float-against-double difference in
   * that frequency is under 1e-3 Hz, so the count cannot flip and turn the
   * row into a comparison of two different spectra.
   *
   * Every value is dyadic except the three detunes, which are whole cents,
   * so nothing here is a different number in float and in double before
   * the DSP touches it. rolloff 0.875 keeps the top partial's time
   * constant at 0.1 s, long enough that partial 26 is still ringing at the
   * end of the render rather than having decayed out of the measurement.
   */
  /* Identical to additive_morph except for the weight. Kept as a separate
   * literal rather than spread from it, because the C++ side mirrors these
   * by hand and a reader comparing the two files should see both lists. */
  additive_morph_hi: {
    morph: 0.8125,
    inharm: 0.015625,
    decay: 3,
    rolloff: 0.875,
    attack: 0.00390625,
    release: 0.25,
    gain: 0.75,
    detune2: 7,
    detune3: -5,
    detune5: 12,
  },
  additive_morph: {
    morph: 0.5,
    inharm: 0.015625,
    decay: 3,
    rolloff: 0.875,
    attack: 0.00390625,
    release: 0.25,
    gain: 0.75,
    detune2: 7,
    detune3: -5,
    detune5: 12,
  },
  waveguide: {
    damp: 0.25,
    sustain: 0.75,
    dispersion: 0.125,
    bow: 0.875,
    bowPressure: 0.5,
    bowSpeed: 0.625,
    level: 0.75,
    body: 0.75,
    bodySize: 0.25,
    bowNoise: 0.375,
    attackBite: 0.5,
    vibRate: 6.0,
    vibDepth: 16,
    vibOnset: 0.0625,
    bowPos: 0.125,
    dynamics: 0.5,
    polDetune: 2.0,
  },
  /*
   * The wavetable, for the same reason again: on an empty record position,
   * scanDepth and envToPosition are all 0 and the filter is off, so the
   * voice would sit on frame 0 of the table and the row would compare a
   * sine through an envelope while calling the frame crossfade, the scan
   * LFO, the position clamp and the lowpass ported.
   *
   * position runs 0.25 + 0.5 * lfo + 0.25 * env, which spans -0.25 to 1.0:
   * it clamps at both ends and crosses all four frames, so both sides of
   * the `ff > 0` branch are taken. scanRate is 3 Hz, 1.11 cycles inside the
   * render, where the motion-pad preset's own 0.2 Hz would have covered 7
   * percent of one. pan is off centre because the harness compares the left
   * channel only, and a centred pan would have left the pan law reading
   * sqrt(1/2) on both sides whatever it computed. Every value is exactly
   * representable in binary floating point.
   *
   * The filter is set where it does some work, which is the difference
   * between measuring the resonance-to-Q map and not: a lowpass at 1024 Hz
   * with Q 7.625 shapes the note, where the preset's 3800 Hz and Q 1.925
   * barely touch it. Measured, a 0.1 percent mutation of that map moves
   * this row twelve times its baseline and moved the preset-shaped row
   * five, which is inside any gate set from a measurement. It also lowers
   * the baseline, because the drift this row does measure rides the steep
   * parts of the waveform and the lowpass takes those off.
   */
  wavetable: {
    position: 0.25,
    scanRate: 3,
    scanDepth: 0.5,
    envToPosition: 0.25,
    attack: 0.03125,
    decay: 0.125,
    sustain: 0.75,
    release: 0.25,
    filter: 1,
    cutoff: 1024,
    resonance: 0.75,
    pan: 0.375,
  },
};
/* The low row is the same engine and the same params at another pitch. */
VOICE_PARAMS.wavetable_low = VOICE_PARAMS.wavetable;

/*
 * Pitch per row, where 220 Hz would not reach the thing being measured.
 *
 * The wavetable oscillator picks its mip level from the note, so one pitch
 * measures one level. At 220 Hz it reads level 2 of 8 (63 harmonics kept);
 * at 55 Hz it reads level 0, which is the level held at two points per
 * period of its top harmonic and therefore where linear interpolation is
 * worst, and it is the part of the flash blob no other row touches.
 */
const FREQ_BY_VOICE = {
  wavetable_low: 55,
};

/* The label the C++ Rng must sit on to match each JS engine's stream.
 * Empty means the engine uses its parent stream directly. */
const RNG_LABEL = {
  snare: 'parity::snare/noise',
  va: 'parity::va',
  pluck: 'parity',
  modal: 'parity',
  formant: 'parity',
  harmonic: 'parity',
  tube: 'parity',
  /* The string draws from the voice stream and forks 'note' off it, so the
   * C++ side sits on 'parity' and seeds its second Rng with 'parity::note'.
   * See render.cpp. */
  waveguide: 'parity',
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
    const freq = FREQ_BY_VOICE[voice] ?? 220;
    const cpp = renderCpp(bin, voice, frames, freq, 0.9);
    const ts = await renderTs(voice, frames, freq, 0.9);
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
