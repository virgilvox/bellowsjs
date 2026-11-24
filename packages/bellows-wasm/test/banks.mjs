/*
 * The two bank engines against the TypeScript: the sampler over the zones of a registerBank and
 * the granular over the buffer of a registerGrain, each played through the TypeScript kernel
 * twice, once with bankEngineResolver from the library source and once with a resolver that
 * builds the bank in the module through the bw_bank_* exports and makes its voices with
 * bw_voice_new_bank. The kernel, its voice pools (labels seed::v0, seed::v1 ...), its events and
 * its param changes are the same code both times; only the voices differ.
 *
 *   cd packages/bellows && npx vite-node ../bellows-wasm/test/banks.mjs            compare, gated
 *   ... banks.mjs --report                                                          print, no gate
 *
 * The sampler score covers what the zones of a SoundFont or SFZ carry: key ranges, a zone
 * recorded at a rate other than the output's and fine tuned, a sustain loop with its crossfade, a
 * loopRelease zone with its own AHDSR, a stereo zone, two velocity layers, two round robin groups
 * on keys another zone also covers (one with its members out of seqPosition order, one with
 * equal positions), and a whole-sample loop. Two channels play the bank, so the round robin
 * counter they share is in the comparison, and the first has fewer voices than notes, so voices
 * are stolen while sounding. The granular score is one channel on a synthetic buffer with every
 * stochastic param on. Both change params while notes sound.
 *
 * The figure is parity.mjs's: RMS of the difference over RMS of the TypeScript render, both
 * channels, worst of 44.1, 48 and 96 kHz, gated at about two and a half times the measurement.
 */

import { readFileSync } from 'node:fs';
import { renderOffline } from '../../bellows/src/render/offline.ts';
import { bankEngineResolver } from '../../bellows/src/render/banks.ts';

const REPORT = process.argv.includes('--report');
const RATES = [44100, 48000, 96000];

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.gen.json', import.meta.url), 'utf8'));
/* the module imports the kernel's callbacks into JavaScript (src/kernel.cpp); no kernel runs here */
const none = () => {
  throw new Error('kernel callback without a kernel');
};
const NO_KERNEL = { env: Object.fromEntries(['host_ch_on', 'host_ch_off', 'host_ch_alloff', 'host_ch_param', 'host_ch_process', 'host_fx_process'].map((n) => [n, none])) };
const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL('../dist/bellows.wasm', import.meta.url))), NO_KERNEL).exports;
ex.bw_init();

/* ---------------- the module side ---------------- */

const N = ex.bw_io_frames();
const ioPtr = ex.bw_io();
const FIELDS = ex.bw_bank_zone_fields();
const fieldsPtr = ex.bw_alloc(4 * FIELDS);
const valsPtr = ex.bw_alloc(4 * 64);
const LABEL_BYTES = 512;
const labelPtr = ex.bw_alloc(LABEL_BYTES);
const f32 = (ptr, n) => new Float32Array(ex.memory.buffer, ptr, n);

function copyIn(data, frames) {
  const p = ex.bw_alloc(4 * Math.max(1, frames));
  f32(p, frames).set(data.subarray(0, frames));
  return p;
}

function putLabel(s) {
  const b = new Uint8Array(ex.memory.buffer, labelPtr, LABEL_BYTES);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  b[s.length] = 0;
}

const LOOP_MODE = { none: 0, loop: 1, loopRelease: 2 };
const opt = (v) => (v === undefined ? NaN : v);

/* SetSamplerZone's field order (src/unit.h, ZoneField) */
function zoneFields(z) {
  return [
    z.sampleRate,
    z.rootKey,
    opt(z.fineTune),
    z.keyLo,
    z.keyHi,
    z.velLo,
    z.velHi,
    opt(z.loopStart),
    opt(z.loopEnd),
    LOOP_MODE[z.loopMode],
    opt(z.gainDb),
    opt(z.pan),
    opt(z.env?.attack),
    opt(z.env?.hold),
    opt(z.env?.decay),
    opt(z.env?.sustain),
    opt(z.env?.release),
    opt(z.roundRobinGroup),
    opt(z.seqPosition),
  ];
}

class WasmVoice {
  constructor(h, index) {
    this.h = h;
    this.index = index;
  }
  noteOn(freq, vel) {
    ex.bw_voice_on(this.h, freq, vel);
  }
  noteOff() {
    ex.bw_voice_off(this.h);
  }
  get active() {
    return ex.bw_voice_active(this.h) !== 0;
  }
  setParam(name, value) {
    const i = this.index.get(name);
    if (i !== undefined) ex.bw_voice_set(this.h, i, value);
  }
  process(outL, outR, from, to) {
    for (let f = from; f < to; f += N) {
      const n = to - f < N ? to - f : N;
      ex.bw_voice_run(this.h, n);
      const s = f32(ioPtr, 2 * N);
      for (let i = 0; i < n; i++) {
        outL[f + i] += s[i];
        outR[f + i] += s[N + i];
      }
    }
  }
}

const banks = [];
function wasmResolver(kind, bankId, data) {
  const id = kind === 'sampler' ? 'sampler' : 'granular';
  const unit = manifest.findIndex((u) => u.id === id && u.kind === 'engine');
  const u = manifest[unit];
  let bank;
  if (kind === 'sampler') {
    bank = ex.bw_bank_sampler_new(data.length);
    data.forEach((z, i) => {
      const frames = z.dataR ? Math.min(z.data.length, z.dataR.length) : z.data.length;
      f32(fieldsPtr, FIELDS).set(zoneFields(z));
      const l = copyIn(z.data, frames);
      const r = z.dataR ? copyIn(z.dataR, frames) : 0;
      if (!ex.bw_bank_sampler_zone(bank, i, fieldsPtr, FIELDS, l, r, frames)) throw new Error(`zone ${i} refused`);
    });
  } else {
    bank = ex.bw_bank_grain_new(copyIn(data.data, data.data.length), data.data.length, data.sampleRate);
  }
  banks.push(bank);
  const index = new Map(u.params.map((p, i) => [p.name, i]));
  return {
    id: id + ':' + bankId,
    label: u.label,
    params: u.params,
    polyphony: u.polyphony,
    createVoice(sampleRate, params, rng) {
      const v = f32(valsPtr, u.params.length);
      u.params.forEach((p, i) => (v[i] = typeof params?.[p.name] === 'number' ? params[p.name] : p.default));
      putLabel(rng.label);
      const h = ex.bw_voice_new_bank(unit, sampleRate, labelPtr, valsPtr, bank);
      if (!h) throw new Error(`no ${id} voice at ${sampleRate} Hz`);
      return new WasmVoice(h, index);
    },
  };
}

/* ---------------- test audio ---------------- */

const TWO_PI = 2 * Math.PI;
const mtof = (k) => 440 * Math.pow(2, (k - 69) / 12);

/* A decaying tone with a few partials; detail keeps the cubic read and the crossfade honest. */
function tone(sr, seconds, hz, { decay = 2, partials = [1, 0.5, 0.25, 0.12], am = 0, phase = 0 } = {}) {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    partials.forEach((a, k) => (s += a * Math.sin(TWO_PI * hz * (k + 1) * t + phase * (k + 1))));
    const env = Math.exp(-decay * t) * (1 + am * Math.sin(TWO_PI * 3.1 * t)) * Math.min(1, i / 32);
    out[i] = 0.5 * s * env;
  }
  return out;
}

/* A short noisy hit from a fixed LCG, so round robin members are told apart by their sound. */
function hit(sr, seconds, hz, seed) {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const t = i / sr;
    out[i] = (0.4 * (x / 4294967296 - 0.5) + 0.5 * Math.sin(TWO_PI * hz * t)) * Math.exp(-9 * t);
  }
  return out;
}

function samplerZones() {
  const base = { velLo: 0, velHi: 127, loopMode: 'none' };
  return [
    { ...base, data: tone(32000, 1.2, mtof(45), { decay: 1.5 }), sampleRate: 32000, rootKey: 45, fineTune: 12, keyLo: 0, keyHi: 47, gainDb: -2, pan: -0.3 },
    {
      ...base,
      data: tone(44100, 0.5, 220.5, { decay: 0.4, am: 0.3 }),
      sampleRate: 44100,
      rootKey: 53,
      keyLo: 48,
      keyHi: 59,
      loopStart: 4000,
      loopEnd: 20000,
      loopMode: 'loop',
    },
    {
      ...base,
      data: tone(48000, 0.625, mtof(64), { decay: 1, am: 0.2, partials: [1, 0.3, 0.4] }),
      sampleRate: 48000,
      rootKey: 64,
      fineTune: -7,
      keyLo: 60,
      keyHi: 71,
      loopStart: 3000,
      loopEnd: 15000,
      loopMode: 'loopRelease',
      env: { attack: 0.01, hold: 0.05, decay: 0.2, sustain: 0.6, release: 0.3 },
    },
    {
      ...base,
      data: tone(44100, 0.9, mtof(76), { decay: 2.5 }),
      dataR: tone(44100, 0.9, mtof(76) * 1.003, { decay: 2, phase: 0.7, partials: [1, 0.2, 0.5] }),
      sampleRate: 44100,
      rootKey: 76,
      keyLo: 72,
      keyHi: 83,
      gainDb: 1,
      pan: 0.4,
    },
    { ...base, data: tone(22050, 0.8, mtof(88), { partials: [1, 0.05] }), sampleRate: 22050, rootKey: 88, keyLo: 84, keyHi: 95, velLo: 0, velHi: 63 },
    { ...base, data: tone(22050, 0.8, mtof(88), { partials: [1, 0.6, 0.5, 0.4] }), sampleRate: 22050, rootKey: 88, keyLo: 84, keyHi: 95, velLo: 64, velHi: 127, gainDb: -1 },
    { ...base, data: hit(44100, 0.3, 300, 1), sampleRate: 44100, rootKey: 30, keyLo: 24, keyHi: 35, roundRobinGroup: 1, seqPosition: 3 },
    { ...base, data: hit(44100, 0.3, 450, 2), sampleRate: 44100, rootKey: 30, keyLo: 24, keyHi: 35, roundRobinGroup: 1, seqPosition: 1 },
    { ...base, data: hit(44100, 0.3, 600, 3), sampleRate: 44100, rootKey: 30, keyLo: 24, keyHi: 35, roundRobinGroup: 1, seqPosition: 2 },
    { ...base, data: hit(32000, 0.25, 900, 4), sampleRate: 32000, rootKey: 30, keyLo: 24, keyHi: 35, roundRobinGroup: 7, pan: 0.5 },
    { ...base, data: hit(32000, 0.25, 1300, 5), sampleRate: 32000, rootKey: 30, keyLo: 24, keyHi: 35, roundRobinGroup: 7, pan: -0.5 },
    { ...base, data: tone(44100, 0.3, 441, { decay: 0, partials: [1, 0.3] }), sampleRate: 44100, rootKey: 100, keyLo: 96, keyHi: 107, loopMode: 'loop' },
  ];
}

function grainSource() {
  const sr = 32000;
  const n = Math.round(1.5 * sr);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TWO_PI * (180 + 400 * t)) / sr;
    out[i] = 0.6 * Math.sin(ph) + 0.25 * Math.sin(2.01 * ph) + 0.15 * Math.sin(TWO_PI * 1250 * t) * (1 + Math.sin(TWO_PI * 2 * t));
  }
  return { data: out, sampleRate: sr };
}

/* ---------------- scores ---------------- */

function events(notes) {
  const ev = [];
  notes.forEach(([ch, key, t, off, vel], i) => {
    ev.push({ time: t, kind: 0, target: ch, a: i + 1, b: mtof(key), c: vel });
    ev.push({ time: off, kind: 1, target: ch, a: i + 1, b: 0, c: 0 });
  });
  return { type: 'events', events: ev.sort((x, y) => x.time - y.time) };
}

const SAMPLER = {
  name: 'sampler',
  seconds: 1.6,
  setup: () => [
    { type: 'masterGain', gain: 1 },
    { type: 'registerBank', bankId: 'kit', zones: samplerZones() },
    {
      type: 'createChannel',
      id: 1,
      engineId: 'sampler:kit',
      params: { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.2, loopXfade: 12, veltrack: 60, gain: -3, pan: 0.1 },
      seed: 'wasm-banks',
      polyphony: 6,
    },
    { type: 'channelGain', id: 1, gain: 1 },
    { type: 'createChannel', id: 2, engineId: 'sampler:kit', params: {}, seed: 'wasm-banks-2' },
    { type: 'channelGain', id: 2, gain: 1 },
    /* channel, key, on, off, velocity */
    events([
      [1, 40, 0.0, 0.5, 0.8],
      [1, 30, 0.05, 0.3, 0.7],
      [1, 55, 0.1, 0.9, 0.75],
      [2, 30, 0.15, 0.4, 0.9],
      [1, 66, 0.2, 0.7, 0.6],
      [1, 78, 0.3, 0.6, 0.85],
      [2, 90, 0.35, 0.8, 0.3],
      [2, 90, 0.45, 0.9, 0.95],
      [1, 32, 0.5, 0.7, 0.6],
      [2, 33, 0.55, 0.75, 0.6],
      [1, 100, 0.6, 1.2, 0.7],
      [1, 44, 0.65, 1.0, 0.9],
      [1, 57, 0.7, 1.1, 0.8],
      [1, 62, 0.8, 1.0, 0.7],
      [2, 26, 0.85, 1.0, 0.5],
      [1, 34, 0.9, 1.1, 0.65],
    ]),
  ],
  changes: [
    [0.25, { type: 'channelParam', id: 1, name: 'release', value: 0.5 }],
    [0.4, { type: 'channelParam', id: 2, name: 'veltrack', value: 30 }],
    [0.42, { type: 'channelParam', id: 1, name: 'pan', value: -0.2 }],
    [0.6, { type: 'channelParam', id: 1, name: 'decay', value: 0.1 }],
    [0.62, { type: 'channelParam', id: 1, name: 'loopXfade', value: 4 }],
  ],
  /* 4.8e-5 measured; half of it is the note frequencies and param values reaching the module as
   * float32, the rest float envelopes and reads against double */
  gate: 1.2e-4,
};

const GRANULAR = {
  name: 'granular',
  seconds: 1.4,
  setup: () => [
    { type: 'masterGain', gain: 1 },
    { type: 'registerGrain', bankId: 'cloud', ...grainSource() },
    {
      type: 'createChannel',
      id: 1,
      engineId: 'granular:cloud',
      params: { grainSize: 60, density: 23, position: 0.3, spray: 0.2, pitchJitter: 2, spread: 0.8, reverse: 0.25, baseNote: 60, level: 0.8 },
      seed: 'wasm-grains',
    },
    { type: 'channelGain', id: 1, gain: 1 },
    events([
      [1, 60, 0.0, 0.6, 0.9],
      [1, 64, 0.1, 0.7, 0.6],
      [1, 67, 0.2, 0.9, 0.75],
      [1, 72, 0.5, 1.0, 0.8],
    ]),
  ],
  changes: [
    [0.3, { type: 'channelParam', id: 1, name: 'position', value: 0.6 }],
    [0.45, { type: 'channelParam', id: 1, name: 'density', value: 37 }],
    [0.55, { type: 'channelParam', id: 1, name: 'grainSize', value: 120 }],
  ],
  /* 1.3e-4 measured, nearly all of it position 0.3 and spray 0.2 rounded to float32 at the ABI,
   * which moves every grain start by up to 6e-4 frames: 1.7e-5 with float-exact values */
  gate: 3.5e-4,
};

/* ---------------- compare ---------------- */

function render(row, sampleRate, resolveBankEngine) {
  const pending = row.changes.slice();
  return renderOffline(row.setup(), {
    seconds: row.seconds,
    sampleRate,
    kernel: { resolveBankEngine },
    onBlock(engine, t) {
      while (pending.length && t + 1e-9 >= pending[0][0]) engine.apply(pending.shift()[1]);
    },
  });
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

const e2 = (x) => x.toExponential(1);
process.stdout.write(`bellows-wasm bank engines against the TypeScript: rel RMS of the difference\n\n`);
process.stdout.write(`  ${'unit'.padEnd(12)} ${RATES.map((r) => String(r).padStart(8)).join('')}      gate      rms\n`);
let failed = 0;
for (const row of [SAMPLER, GRANULAR]) {
  const figs = RATES.map((sr) => relErr(render(row, sr, bankEngineResolver), render(row, sr, wasmResolver)));
  const worst = Math.max(...figs.map((f) => f.rel));
  const bad = !(worst <= row.gate);
  if (bad) failed++;
  process.stdout.write(
    `  ${row.name.padEnd(12)} ${figs.map((f) => e2(f.rel).padStart(8)).join('')}  ${e2(row.gate).padStart(8)} ${e2(figs[0].rms).padStart(8)}${bad ? '  FAIL' : ''}${row.why ? '   ' + row.why : ''}\n`,
  );
}
for (const b of banks) ex.bw_bank_free(b);

process.stdout.write(`\n${failed ? 'FAILED' : 'ok'}: ${2 - failed} of 2 rows inside their gates\n`);
if (!REPORT && failed) process.exit(1);
