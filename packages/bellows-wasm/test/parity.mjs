/*
 * The plugin against the TypeScript: every unit the module carries, played through the real
 * kernel both ways and compared.
 *
 *   npm test -w packages/bellows-wasm        build, then compare, gated
 *   ... parity.mjs --report                  print the figures without gating
 *   ... --only=va,plate --no-change --defaults --single   take a row apart
 *
 * Each engine row is one channel playing three overlapping notes with params off their defaults,
 * one param changed while all three sound, and the notes released, rendered once with the
 * TypeScript engine ('va') and once with the module's ('wasm-va'), with the same seed. Each effect
 * row runs the same TypeScript VA chord into the TypeScript effect and into the module's, params
 * off their defaults and one changed mid-render. A row therefore sees creation params, a live
 * setParam, polyphony and the per-voice streams, where bellows-embedded's parity rows play one
 * note on creation params. Each row runs at 44.1, 48 and 96 kHz, because the module serves every
 * rate from one build.
 *
 * The figure is the RMS of the difference over the RMS of the TypeScript render, both channels,
 * and the gate is on the worst of the three rates. Gates are set from measurement at about two
 * and a half times the worst figure. Most rows sit where float against double puts them; the loose
 * ones are loose for a reason given beside them, and each was checked to fail on a wrong param
 * mapping, which lands between 1e-1 and 1.
 *
 * Then the paths: the plugin's worklet script is run in a worklet scope on this thread
 * (renderWorkletInProcess, what a page without an OfflineAudioContext gets) and its output must be
 * bit for bit what register() and renderOffline gave for the same score, so the script a page
 * loads is the code this file measured.
 */

import { renderOffline } from 'bellowsjs';
import { renderWorkletInProcess } from '../../bellows/src/kernel/offline-context.ts';
import { readFileSync } from 'node:fs';
import { bellowsWasm, engineIds, effectIds } from '../dist/index.js';

const REPORT = process.argv.includes('--report');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const NO_CHANGE = process.argv.includes('--no-change');
const DEFAULTS = process.argv.includes('--defaults');
const SINGLE = process.argv.includes('--single');
const DIAG = ONLY.length > 0 || NO_CHANGE || DEFAULTS || SINGLE;

const SECONDS = 0.8;
const NOTES = [
  { t: 0.0, hz: 220, vel: 0.9, off: 0.4 },
  { t: 0.05, hz: 277.18, vel: 0.6, off: 0.45 },
  { t: 0.11, hz: 329.63, vel: 0.75, off: 0.5 },
];
const CHANGE_AT = 0.2;
const RATES = [44100, 48000, 96000];

/* Per engine: creation params off their defaults, one live change, and the gate. */
const ENGINES = {
  va: { params: { shape: 1, cutoff: 2400, resonance: 0.5, envAmount: 2, detune: 12, sub: 0.3 }, change: ['cutoff', 800], gate: 6e-3 },
  fm: { params: { algorithm: 3, feedback: 0.3, ratio2: 2, level2: 0.8, brightness: 0.8 }, change: ['level2', 0.4], gate: 4e-3 },
  additive: { params: { morph: 0.3, inharm: 0.004, detune2: 5, rolloff: 0.7 }, change: ['morph', 0.7], gate: 1.5e-3 },
  wavetable: { params: { position: 0.25, scanDepth: 0.5, scanRate: 3, filter: 1, cutoff: 1500, resonance: 0.5 }, change: ['position', 0.6], gate: 3e-4 },
  kick: { params: { decay: 0.6, drive: 4 }, change: ['decay', 0.2], gate: 1.2e-3 },
  snare: { params: { tone: 0.7, snap: 0.3 }, change: ['decay', 0.4], gate: 2e-4 },
  hat: { params: { decay: 0.2, tone: 1.5 }, change: ['tone', 0.8], gate: 8e-3, why: 'six square oscillators at inharmonic ratios, quiet (rms 6e-3)' },
  pluck: { params: { damp: 0.5, pickPos: 0.4, decay: 3 }, change: ['damp', 0.2], gate: 4e-5 },
  string: {
    params: { bow: 0.8, bowPressure: 0.6, body: 0.5, vibDepth: 10, polDetune: 2 },
    change: ['bowPressure', 0.8],
    gate: 2.5e-2,
    why: 'bow friction is a nonlinear feedback loop: 1e-3 before the pressure change, rounding grows after it',
  },
  'string/plucked': { engine: 'string', params: { damp: 0.5, dispersion: 0.2 }, change: ['damp', 0.3], gate: 4e-4 },
  tube: { params: { breath: 0.7, noise: 0.2 }, change: ['breath', 0.9], gate: 1e-3 },
  modal: {
    params: { material: 2, brightness: 0.7 },
    change: ['decay', 1],
    gate: 4e-2,
    why: 'float two-pole resonators against double: a long ring drifts in phase, more at higher rates where r is nearer 1',
  },
  westcoast: { params: { foldAmount: 0.6, foldStages: 3 }, change: ['foldAmount', 0.2], gate: 3e-2, why: 'three iterated folds amplify rounding, as the embedded row says' },
  formant: { params: { vowel: 2, breath: 0.2 }, change: ['vowel', 3.5], gate: 1.2e-4 },
  harmonic: { params: { brightness: 0.7, evenOdd: 0.3, noiseMix: 0.2 }, change: ['brightness', 0.3], gate: 5e-4 },
  granular: { params: { grainSize: 60, density: 23, spray: 0.2, pitchJitter: 2, spread: 0.8, reverse: 0.25 }, change: ['position', 0.6], gate: 7e-5 },
};

/* Per effect, the same, on a VA chord from the TypeScript. */
const EFFECTS = {
  delay: {
    params: { timeL: 0.12, timeR: 0.19, feedback: 0.5, crossFeedback: 0.2, mix: 0.5 },
    change: ['timeL', 0.08],
    gate: 3e-3,
    why: 'the time glides through thousands of samples in float against double: 2.6e-8 without the change',
  },
  plate: { params: { decay: 0.7, predelay: 0.02, mix: 0.5 }, change: ['damping', 0.6], gate: 5e-5 },
  compressor: { params: { threshold: -30, ratio: 6, attack: 0.005, release: 0.1, makeup: 3, lookahead: 0.005 }, change: ['threshold', -20], gate: 6e-5 },
  limiter: { params: { ceiling: -6, release: 0.1 }, change: ['truePeak', 1], gate: 1e-4 },
  gate: { params: { threshold: -30 }, change: ['hold', 0.1], gate: 1e-5 },
  chorus: { params: { rate: 1.2, depth: 0.7, mix: 0.5, feedback: 0.2 }, change: ['rate', 0.4], gate: 6e-5 },
  flanger: { params: { rate: 0.5, feedback: 0.6, invert: 1 }, change: ['manual', 0.5], gate: 4e-4 },
  tremolo: { params: { rate: 6, depth: 0.9, shape: 1 }, change: ['shape', 3], gate: 8e-6 },
  autopan: { params: { rate: 2, shape: 2 }, change: ['depth', 0.5], gate: 2e-3, why: 'a sawtooth LFO wraps a sample apart at 44.1 kHz: 2e-6 on the sine' },
  ringmod: { params: { freq: 300, mix: 0.7 }, change: ['freq', 600], gate: 8e-5 },
  eq: { params: { b1gain: 6, b3gain: -5, b4q: 2 }, change: ['b2gain', 4], gate: 1.5e-5 },
  saturator: { params: { drive: 5, curve: 1, tone: 0.3, output: -3 }, change: ['curve', 2], gate: 1e-6 },
};

function notes() {
  const ev = [];
  (SINGLE ? NOTES.slice(0, 1) : NOTES).forEach((n, i) => {
    ev.push({ time: n.t, kind: 0, target: 1, a: i + 1, b: n.hz, c: n.vel });
    ev.push({ time: n.off, kind: 1, target: 1, a: i + 1, b: 0, c: 0 });
  });
  return { type: 'events', events: ev.sort((x, y) => x.time - y.time) };
}

function engineScore(engineId, params) {
  return [
    { type: 'masterGain', gain: 1 },
    { type: 'createChannel', id: 1, engineId, params, seed: 'wasm-parity' },
    { type: 'channelGain', id: 1, gain: 1 },
    notes(),
  ];
}

function fxScore(effectId, params) {
  return [
    { type: 'masterGain', gain: 1 },
    { type: 'createChannel', id: 1, engineId: 'va', params: { shape: 1, cutoff: 3000 }, seed: 'wasm-parity' },
    { type: 'channelGain', id: 1, gain: 1 },
    { type: 'channelFx', id: 1, chain: [{ effectId, params }] },
    notes(),
  ];
}

/* A message applied at the first block at or after `seconds`. */
function at(seconds, msg) {
  if (NO_CHANGE) return undefined;
  let done = false;
  return (engine, t) => {
    if (!done && t + 1e-9 >= seconds) {
      engine.apply(msg);
      done = true;
    }
  };
}

function render(score, sampleRate, onBlock) {
  return renderOffline(score, { seconds: SECONDS, sampleRate, onBlock });
}

function relErr(a, b) {
  let d = 0;
  let s = 0;
  for (const ch of ['left', 'right']) {
    const x = a[ch];
    const y = b[ch];
    for (let i = 0; i < x.length; i++) {
      d += (x[i] - y[i]) ** 2;
      s += x[i] ** 2;
    }
  }
  return { rel: Math.sqrt(d / Math.max(s, 1e-30)), rms: Math.sqrt(s / (2 * a.left.length)) };
}

function identical(a, b) {
  for (const ch of ['left', 'right']) {
    if (a[ch].length !== b[ch].length) return false;
    for (let i = 0; i < a[ch].length; i++) if (!Object.is(a[ch][i], b[ch][i])) return false;
  }
  return true;
}

const plugin = bellowsWasm();
plugin.register();
const pick = (name) => !ONLY.length || ONLY.includes(name);
const P = (row) => (DEFAULTS ? {} : row.params);

const rows = [];
function measure(kind, name, row, score, change) {
  const figs = RATES.map((sr) => {
    const ts = render(score(false), sr, change());
    const wa = render(score(true), sr, change());
    return relErr(ts, wa).rel;
  });
  rows.push({ kind, name, figs, worst: Math.max(...figs), gate: row.gate, why: row.why });
}
for (const [name, row] of Object.entries(ENGINES)) {
  if (!pick(name)) continue;
  const id = row.engine ?? name;
  measure('engine', name, row, (w) => engineScore((w ? 'wasm-' : '') + id, P(row)), () =>
    at(CHANGE_AT, { type: 'channelParam', id: 1, name: row.change[0], value: row.change[1] }),
  );
}
for (const [name, row] of Object.entries(EFFECTS)) {
  if (!pick(name)) continue;
  measure('effect', name, row, (w) => fxScore((w ? 'wasm-' : '') + name, P(row)), () =>
    at(CHANGE_AT, { type: 'fxParam', channelId: 1, fxIndex: 0, name: row.change[0], value: row.change[1] }),
  );
}

/* A unit that only plays a registered bank (the sampler) has no plugin def to render here;
 * test/banks.mjs covers it, and the bank-backed granular, through the bank exports. */
const bankOnly = new Set(
  JSON.parse(readFileSync(new URL('../src/manifest.gen.json', import.meta.url), 'utf8'))
    .filter((u) => u.bankOnly)
    .map((u) => u.id),
);
const covered = new Set(rows.map((r) => r.name.split('/')[0]));
const missing = DIAG ? [] : [...engineIds, ...effectIds].filter((u) => !covered.has(u) && !bankOnly.has(u));

const e2 = (x) => x.toExponential(1);
process.stdout.write(`bellows-wasm against the TypeScript: rel RMS of the difference, ${SECONDS} s a row\n\n`);
process.stdout.write(`  ${'unit'.padEnd(16)} ${RATES.map((r) => String(r).padStart(8)).join('')}      gate\n`);
let failed = 0;
for (const r of rows) {
  const bad = r.worst > r.gate;
  if (bad) failed++;
  process.stdout.write(
    `  ${r.name.padEnd(16)} ${r.figs.map((f) => e2(f).padStart(8)).join('')}  ${e2(r.gate).padStart(8)}${bad ? '  FAIL' : ''}${r.why ? '   ' + r.why : ''}\n`,
  );
}
if (missing.length) process.stdout.write(`\nnot covered: ${missing.join(', ')}\n`);

/* The worklet script, run in a worklet scope, against register() + renderOffline. */
const pathChecks = DIAG
  ? []
  : [
      ['va', engineScore('wasm-va', ENGINES.va.params)],
      ['string', engineScore('wasm-string', ENGINES.string.params)],
      ['plate', fxScore('wasm-plate', EFFECTS.plate.params)],
      ['limiter', fxScore('wasm-limiter', { ...EFFECTS.limiter.params, truePeak: 1 })],
    ];
let paths = 0;
if (pathChecks.length) process.stdout.write('\nthe worklet script against the calling thread, bit for bit\n\n');
for (const [name, score] of pathChecks) {
  const sr = 48000;
  const a = render(score, sr);
  const b = renderWorkletInProcess(score, { frames: Math.ceil(SECONDS * sr), sampleRate: sr, plugins: [plugin] });
  const same = identical(a, b);
  if (!same) paths++;
  process.stdout.write(`  ${name.padEnd(16)} ${same ? 'identical' : 'DIFFERENT ' + e2(relErr(a, b).rel)}\n`);
}

const ok = !failed && !paths && !missing.length;
process.stdout.write(`\n${ok ? 'ok' : 'FAILED'}: ${rows.length - failed} of ${rows.length} rows inside their gates${pathChecks.length ? `, ${pathChecks.length - paths} of ${pathChecks.length} paths identical` : ''}\n`);
if (!REPORT && !ok) process.exit(1);
