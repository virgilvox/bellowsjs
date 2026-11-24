/*
 * The module's kernel (src/kernel.cpp and src/kernel.js) against the TypeScript KernelEngine, on
 * whole scores.
 *
 *   cd packages/bellows && npx vite-node ../bellows-wasm/test/kernel-parity.mjs [--report] [--only=name]
 *
 * Two kinds of row.
 *
 * Exact rows play only units the module does not carry: copies of the TypeScript defs under new
 * ids (a different def object, so the module's kernel plays them in JavaScript), tier 3 defOps,
 * and sample banks. Every sample those units make is the TypeScript's own, so whatever the module
 * does around them (the event queue and its block splitting, voice allocation and stealing,
 * param ramps, gains and pans and their glides, sends, buses, chains, the master, panic,
 * channels replaced and removed) is compared bit for bit, apart from the units.
 *
 * Native rows play the units the module carries, under their TypeScript ids, and are gated
 * like test/parity.mjs: the RMS of the difference over the RMS of the TypeScript render.
 *
 * Then the path: the plugin's worklet script, run in a worklet scope on this thread, must give
 * what register() and renderOffline gave, bit for bit.
 *
 * Everything comes from one copy of bellowsjs (the built dist the plugin imports), because the
 * registry, the builtin defs and the interned param names are that copy's.
 */

import {
  EventKind,
  bankEngineResolver,
  getEffect,
  getEngine,
  internParam,
  registerBuiltins,
  registerEffect,
  registerEngine,
  renderOffline,
} from 'bellowsjs';
import { renderWorkletInProcess } from '../../bellows/src/kernel/offline-context.ts';
import { KERNEL_NAME, bellowsWasm, engineIds, effectIds } from '../dist/index.js';

const REPORT = process.argv.includes('--report');
const EXACT = process.argv.includes('--exact');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

registerBuiltins();
const plugin = bellowsWasm({ kernel: true });
plugin.register();

/* JavaScript copies of builtins under new ids: the module's kernel plays these as foreign units. */
const jsEngine = (id) => {
  const def = { ...getEngine(id), id: 'js-' + id };
  registerEngine(def);
  return def.id;
};
const jsEffect = (id) => {
  const def = { ...getEffect(id), id: 'js-' + id };
  registerEffect(def);
  return def.id;
};

const P = {
  cutoff: internParam('cutoff'),
  resonance: internParam('resonance'),
  decay: internParam('decay'),
  damp: internParam('damp'),
  nothing: internParam('noSuchParam'),
};

const N = (time, target, a, b, c = 0.8) => ({ time, kind: EventKind.NoteOn, target, a, b, c });
const O = (time, target, a) => ({ time, kind: EventKind.NoteOff, target, a, b: 0, c: 0 });
const PR = (time, target, param, value) => ({ time, kind: EventKind.Param, target, a: param, b: value, c: 0 });
const RMP = (time, target, param, value, seconds) => ({ time, kind: EventKind.ParamRamp, target, a: param, b: value, c: seconds });
const ALL = (time, target) => ({ time, kind: EventKind.AllNotesOff, target, a: 0, b: 0, c: 0 });

/* messages applied at the first block at or after their time */
function timed(list) {
  const done = new Set();
  return (engine, t) => {
    list.forEach(([at, msg], i) => {
      if (!done.has(i) && t + 1e-9 >= at) {
        engine.apply(msg);
        done.add(i);
      }
    });
  };
}

function sine(n, hz, sr, amp = 0.5) {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr) * (1 - i / n);
  return d;
}

const TIER3_ENGINE = `{
  id: 'tier3-sine', label: 'tier 3 sine', params: [{ name: 'level', default: 0.3, min: 0, max: 1 }],
  createVoice(sr, params) {
    let ph = 0, inc = 0, amp = 0, on = false, env = 0;
    return {
      noteOn(f, v) { inc = f / sr; amp = v * (params.level ?? 0.3); on = true; env = 1; },
      noteOff() { on = false; },
      get active() { return on || env > 1e-4; },
      setParam(n, v) { if (n === 'level') params.level = v; },
      process(l, r, from, to) {
        for (let i = from; i < to; i++) {
          if (!on) env *= 0.999;
          const s = Math.sin(2 * Math.PI * ph) * amp * env;
          ph += inc; if (ph >= 1) ph -= 1;
          l[i] += s; r[i] += s * 0.5;
        }
      },
    };
  },
}`;
const TIER3_EFFECT = `{
  id: 'tier3-crush', label: 'tier 3 crush', params: [{ name: 'steps', default: 16, min: 2, max: 64 }],
  create(sr, params) {
    let steps = params.steps ?? 16;
    return {
      setParam(n, v) { if (n === 'steps') steps = v; },
      reset() {},
      process(l, r, from, to) { for (let i = from; i < to; i++) { l[i] = Math.round(l[i] * steps) / steps; r[i] = Math.round(r[i] * steps) / steps; } },
    };
  },
}`;

/* ---------------- exact rows ---------------- */

function exactRows() {
  const va = jsEngine('va');
  const fm = jsEngine('fm');
  const pluck = jsEngine('pluck');
  const kick = jsEngine('kick');
  const plate = jsEffect('plate');
  const delay = jsEffect('delay');
  const comp = jsEffect('compressor');
  const sat = jsEffect('saturator');
  const chorus = jsEffect('chorus');
  const rows = {};

  rows.mix = {
    seconds: 1.2,
    score: [
      { type: 'createChannel', id: 0, engineId: va, params: { cutoff: 900, resonance: 0.4 }, seed: 'k0' },
      { type: 'createChannel', id: 1, engineId: fm, params: {}, seed: 'k1' },
      { type: 'createChannel', id: 2, engineId: kick, params: {}, seed: 'k2' },
      { type: 'createChannel', id: 3, engineId: pluck, params: { damp: 0.4 }, seed: 'k3' },
      { type: 'channelGain', id: 0, gain: 0.7 },
      { type: 'channelGain', id: 1, gain: 0.5 },
      { type: 'channelPan', id: 1, pan: 0.4 },
      { type: 'channelPan', id: 3, pan: -2 },
      { type: 'createBus', id: 1, chain: [{ effectId: plate, params: { decay: 0.6, mix: 1 } }], returnLevel: 0.35 },
      { type: 'createBus', id: 2, chain: [{ effectId: delay, params: { timeL: 0.1, timeR: 0.15, mix: 1 } }], returnLevel: 0.3 },
      { type: 'send', channelId: 1, busId: 1, level: 0.5 },
      { type: 'send', channelId: 3, busId: 1, level: 0.6 },
      { type: 'send', channelId: 3, busId: 2, level: 0.4 },
      { type: 'send', channelId: 0, busId: 9, level: 0.4 },
      { type: 'channelFx', id: 0, chain: [{ effectId: sat, params: { drive: 2 } }, { effectId: chorus, params: {} }] },
      { type: 'masterFx', chain: [{ effectId: comp, params: { threshold: -14, ratio: 3 } }] },
      { type: 'masterGain', gain: 0.9 },
      {
        type: 'events',
        events: [
          N(0.02, 0, 1, 110, 0.9),
          O(0.5, 0, 1),
          N(0.25, 1, 2, 440, 0.7),
          O(0.6, 1, 2),
          N(0.02, 2, 3, 55, 1),
          O(0.1, 2, 3),
          N(0.75, 3, 4, 330),
          O(1.1, 3, 4),
          N(0.75, 3, 5, 392),
          O(0.9, 3, 5),
        ],
      },
    ],
    // gains, pans, sends and parameters moved after the first block, so they glide
    timed: [
      [0.3, { type: 'channelGain', id: 0, gain: 0.2 }],
      [0.35, { type: 'channelPan', id: 0, pan: -0.8 }],
      [0.4, { type: 'send', channelId: 1, busId: 1, level: 0.1 }],
      [0.45, { type: 'masterGain', gain: 0.6 }],
      [0.5, { type: 'fxParam', channelId: 0, fxIndex: 0, name: 'drive', value: 5 }],
      [0.55, { type: 'busFxParam', busId: 1, fxIndex: 0, name: 'decay', value: 0.9 }],
      [0.6, { type: 'masterFxParam', fxIndex: 0, name: 'threshold', value: -24 }],
      [0.62, { type: 'fxParam', channelId: 0, fxIndex: 7, name: 'drive', value: 5 }],
      [0.65, { type: 'channelParam', id: 3, name: 'damp', value: 0.7 }],
      [0.7, { type: 'masterGain', gain: NaN }],
      // a send to a bus that does not exist yet glides only once the bus does
      [0.3, { type: 'send', channelId: 0, busId: 9, level: 0.9 }],
      [0.8, { type: 'createBus', id: 9, chain: [], returnLevel: 0.8 }],
    ],
  };

  rows.ramps = {
    seconds: 1.4,
    score: [
      { type: 'createChannel', id: 0, engineId: va, params: { cutoff: 600 }, seed: 'r0' },
      { type: 'createChannel', id: 1, engineId: va, params: {}, seed: 'r1' },
      {
        type: 'events',
        events: [
          N(0.0, 0, 1, 220),
          N(0.0, 1, 2, 330),
          RMP(0.05, 0, P.cutoff, 4000, 0.5),
          // retargets the first, from wherever it got to
          RMP(0.2, 0, P.cutoff, 300, 0.3),
          // shorter than a block
          RMP(0.1, 1, P.resonance, 0.8, 0.001),
          // no current value in the record: lands at once
          RMP(0.12, 1, P.cutoff, 2000, 0.2),
          // zero, infinite and absurd durations: all land at once
          RMP(0.3, 1, P.resonance, 0.2, 0),
          RMP(0.32, 1, P.resonance, 0.5, Infinity),
          RMP(0.34, 1, P.resonance, 0.3, 1e308),
          // a set cancels a ramp in flight
          RMP(0.6, 0, P.cutoff, 5000, 0.5),
          PR(0.8, 0, P.cutoff, 700),
          // a name no engine has
          RMP(0.6, 1, P.nothing, 1, 0.2),
          O(1.2, 0, 1),
          O(1.2, 1, 2),
        ],
      },
    ],
    timed: [[0.9, { type: 'channelParam', id: 1, name: 'resonance', value: 0.6 }]],
  };

  rows.steal = {
    seconds: 1.0,
    score: [
      { type: 'createChannel', id: 0, engineId: pluck, params: {}, seed: 's0', polyphony: 2 },
      { type: 'createChannel', id: 1, engineId: va, params: {}, seed: 's1', polyphony: 0 },
      {
        type: 'events',
        events: [
          N(0.0, 0, 1, 220),
          N(0.05, 0, 2, 247),
          N(0.1, 0, 3, 262),
          O(0.12, 0, 1),
          N(0.15, 0, 4, 294),
          O(0.2, 0, 99),
          N(0.25, 0, 5, 330),
          N(0.25, 0, 6, 349),
          N(0.25, 0, 7, 392),
          ALL(0.5, 0),
          N(0.6, 0, 8, 440),
          N(0.6, 1, 9, 440),
          // same time as the one before it: applied in the order given
          N(0.7, 0, 10, 494),
          O(0.7, 0, 10),
          // in the past by the time it lands
          N(-1, 0, 11, 523),
          // exactly on a block boundary
          N(256 / 44100, 0, 12, 587),
        ],
      },
    ],
  };

  rows.lifecycle = {
    seconds: 1.2,
    score: [
      { type: 'createChannel', id: 5, engineId: va, params: { cutoff: 1200 }, seed: 'l5' },
      { type: 'createChannel', id: 6, engineId: fm, params: {}, seed: 'l6' },
      { type: 'createChannel', id: 7, engineId: pluck, params: {}, seed: 'l7' },
      { type: 'channelGain', id: 6, gain: 0.4 },
      { type: 'createBus', id: 3, chain: [{ effectId: plate, params: { mix: 1 } }], returnLevel: 0.5 },
      { type: 'send', channelId: 6, busId: 3, level: 0.7 },
      { type: 'events', events: [N(0, 5, 1, 220), N(0, 6, 2, 440), N(0, 7, 3, 330), RMP(0.1, 5, P.cutoff, 300, 0.8)] },
    ],
    timed: [
      // replaced in place: keeps its slot in the mix order, and its ramp
      [0.2, { type: 'createChannel', id: 6, engineId: pluck, params: {}, seed: 'l6b' }],
      [0.2, { type: 'events', events: [N(0.21, 6, 4, 523)] }],
      // removed with a ramp running, then made again at the end of the order
      [0.3, { type: 'removeChannel', id: 5 }],
      [0.35, { type: 'createChannel', id: 5, engineId: va, params: {}, seed: 'l5b' }],
      [0.35, { type: 'events', events: [N(0.36, 5, 5, 262), N(0.9, 7, 6, 196)] }],
      // a bus replaced while it rings
      [0.5, { type: 'createBus', id: 3, chain: [{ effectId: delay, params: { mix: 1 } }], returnLevel: 0.4 }],
      [0.6, { type: 'panic' }],
      [0.7, { type: 'events', events: [N(0.72, 6, 7, 440), O(0.9, 6, 7)] }],
    ],
  };

  rows.tier3 = {
    seconds: 0.8,
    score: [
      { type: 'defOp', kind: 'engine', code: TIER3_ENGINE },
      { type: 'defOp', kind: 'effect', code: TIER3_EFFECT },
      { type: 'createChannel', id: 0, engineId: 'tier3-sine', params: { level: 0.5 }, seed: 't0' },
      { type: 'channelFx', id: 0, chain: [{ effectId: 'tier3-crush', params: { steps: 8 } }] },
      { type: 'events', events: [N(0, 0, 1, 220), N(0.1, 0, 2, 330), O(0.4, 0, 1), O(0.5, 0, 2)] },
    ],
    timed: [[0.2, { type: 'fxParam', channelId: 0, fxIndex: 0, name: 'steps', value: 3 }]],
  };

  const sr = 44100;
  rows.banks = {
    seconds: 1.0,
    kernel: { resolveBankEngine: bankEngineResolver },
    score: [
      {
        type: 'registerBank',
        bankId: 'b',
        zones: [
          { data: sine(8000, 220, sr), sampleRate: sr, rootKey: 57, keyLo: 0, keyHi: 63, velLo: 0, velHi: 127, loopMode: 'none' },
          {
            data: sine(4000, 440, sr),
            dataR: sine(4000, 445, sr),
            sampleRate: sr,
            rootKey: 69,
            keyLo: 64,
            keyHi: 127,
            velLo: 0,
            velHi: 127,
            loopStart: 1000,
            loopEnd: 3000,
            loopMode: 'loop',
          },
        ],
      },
      { type: 'registerGrain', bankId: 'g', data: sine(20000, 330, sr), sampleRate: sr },
      { type: 'createChannel', id: 0, engineId: 'sampler:b', params: {}, seed: 'b0' },
      { type: 'createChannel', id: 1, engineId: 'granular:g', params: {}, seed: 'g0' },
      { type: 'events', events: [N(0, 0, 1, 220), N(0.1, 0, 2, 523), O(0.6, 0, 1), O(0.7, 0, 2), N(0, 1, 3, 330), O(0.5, 1, 3)] },
    ],
  };

  /* more than 256 events, so the drained queue is compacted mid-render */
  const many = [];
  for (let i = 0; i < 600; i++) {
    const t = i * 0.0011;
    many.push(N(t, 0, i + 1, 200 + (i % 12) * 20, 0.3), O(t + 0.004, 0, i + 1));
  }
  rows.queue = {
    seconds: 0.8,
    score: [{ type: 'createChannel', id: 0, engineId: kick, params: {}, seed: 'q0' }, { type: 'events', events: many }],
  };
  return rows;
}

/* ---------------- native rows ---------------- */

function nativeRows() {
  const rows = {};
  rows.golden = {
    seconds: 1.6,
    gate: 5e-3,
    why: 'the VA and the FM set it, as in test/parity.mjs (6e-3 and 4e-3 there)',
    score: [
      { type: 'createChannel', id: 0, engineId: 'va', params: { cutoff: 900, resonance: 0.4 }, seed: 'g0' },
      { type: 'createChannel', id: 1, engineId: 'fm', params: {}, seed: 'g1' },
      { type: 'createChannel', id: 2, engineId: 'kick', params: {}, seed: 'g2' },
      { type: 'createChannel', id: 3, engineId: 'pluck', params: {}, seed: 'g3' },
      { type: 'channelGain', id: 0, gain: 0.7 },
      { type: 'channelGain', id: 1, gain: 0.5 },
      { type: 'channelGain', id: 2, gain: 0.9 },
      { type: 'channelGain', id: 3, gain: 0.6 },
      { type: 'channelPan', id: 1, pan: 0.4 },
      { type: 'channelPan', id: 3, pan: -0.3 },
      { type: 'createBus', id: 1, chain: [{ effectId: 'fdn', params: { decay: 1.4, mix: 1 } }], returnLevel: 0.35 },
      { type: 'send', channelId: 1, busId: 1, level: 0.5 },
      { type: 'send', channelId: 3, busId: 1, level: 0.6 },
      { type: 'channelFx', id: 0, chain: [{ effectId: 'saturator', params: { drive: 2 } }] },
      { type: 'masterFx', chain: [{ effectId: 'compressor', params: { threshold: -14, ratio: 3 } }] },
      { type: 'masterGain', gain: 0.9 },
      {
        type: 'events',
        events: [N(0.02, 0, 1, 110, 0.9), O(0.5, 0, 1), N(0.25, 1, 2, 440, 0.7), O(0.6, 1, 2), N(0.02, 2, 3, 55, 1), O(0.1, 2, 3), N(0.75, 3, 4, 330), O(1.1, 3, 4)],
      },
    ],
  };

  /* every engine the module carries, each on its own channel with a chord, and every effect it
   * carries on one of them, a bus or the master, with ramps and live changes */
  const chainable = effectIds.filter((id) => !['plate', 'delay', 'limiter', 'eq'].includes(id));
  const score = [];
  const events = [];
  engineIds.forEach((id, ch) => {
    score.push({ type: 'createChannel', id: ch, engineId: id, params: {}, seed: 'all' + ch });
    score.push({ type: 'channelGain', id: ch, gain: 0.25 });
    score.push({ type: 'channelPan', id: ch, pan: ((ch % 5) - 2) / 2 });
    const fx = chainable[ch % chainable.length];
    if (fx) score.push({ type: 'channelFx', id: ch, chain: [{ effectId: fx, params: {} }] });
    score.push({ type: 'send', channelId: ch, busId: ch % 2, level: 0.3 });
    const t = (ch % 7) * 0.05;
    events.push(N(t, ch, 1, 196), N(t + 0.02, ch, 2, 247), O(t + 0.5, ch, 1), O(t + 0.6, ch, 2));
  });
  score.push({ type: 'createBus', id: 0, chain: [{ effectId: 'plate', params: { mix: 1 } }], returnLevel: 0.3 });
  score.push({ type: 'createBus', id: 1, chain: [{ effectId: 'delay', params: { mix: 1, feedback: 0.4 } }], returnLevel: 0.3 });
  score.push({ type: 'masterFx', chain: [{ effectId: 'eq', params: { b2gain: 3 } }, { effectId: 'limiter', params: { ceiling: -3 } }] });
  events.push(RMP(0.1, 0, P.cutoff, 300, 0.4), PR(0.3, 3, P.decay, 0.2));
  score.push({ type: 'events', events });
  rows.everything = {
    seconds: 1.2,
    gate: 2.8e-2,
    why: 'every engine at once: the loosest per-unit rows (modal at 96 kHz, westcoast, string) set it',
    score,
    timed: [
      [0.4, { type: 'channelGain', id: 2, gain: 0.6 }],
      [0.45, { type: 'busFxParam', busId: 0, fxIndex: 0, name: 'decay', value: 0.8 }],
    ],
  };

  /* the module's own voice pool: allocation, stealing (oldest released first, then oldest held),
   * note off by id, all notes off and a pool of none, on the pluck, whose unit row is gated at
   * 4e-5, so a wrong voice taken shows */
  rows.steal = {
    seconds: 1.0,
    gate: 1e-4,
    score: [
      { type: 'createChannel', id: 0, engineId: 'pluck', params: { decay: 4 }, seed: 'ns0', polyphony: 2 },
      { type: 'createChannel', id: 1, engineId: 'va', params: {}, seed: 'ns1', polyphony: 0 },
      {
        type: 'events',
        events: [
          N(0.0, 0, 1, 220),
          N(0.05, 0, 2, 247),
          N(0.1, 0, 3, 262),
          O(0.12, 0, 3),
          N(0.15, 0, 4, 294),
          N(0.2, 0, 5, 330),
          O(0.22, 0, 99),
          O(0.25, 0, 4),
          // two released and ringing: the older one goes
          O(0.27, 0, 5),
          N(0.3, 0, 6, 349),
          N(0.3, 0, 7, 392),
          ALL(0.5, 0),
          N(0.6, 0, 8, 440),
          N(0.6, 1, 9, 440),
          N(0.7, 0, 10, 494),
          O(0.7, 0, 10),
        ],
      },
    ],
  };

  /* the path check's score: module units and a tier 3 def, nothing registered on this thread only */
  rows.path = {
    seconds: 0.8,
    gate: 3.5e-3,
    why: 'the VA sets it',
    score: [
      { type: 'defOp', kind: 'engine', code: TIER3_ENGINE },
      { type: 'createChannel', id: 0, engineId: 'va', params: { cutoff: 1500 }, seed: 'p0' },
      { type: 'createChannel', id: 1, engineId: 'tier3-sine', params: {}, seed: 'p1' },
      { type: 'createChannel', id: 2, engineId: 'pluck', params: {}, seed: 'p2' },
      { type: 'channelFx', id: 1, chain: [{ effectId: 'saturator', params: { drive: 3 } }] },
      { type: 'createBus', id: 0, chain: [{ effectId: 'fdn', params: { mix: 1 } }], returnLevel: 0.4 },
      { type: 'send', channelId: 2, busId: 0, level: 0.5 },
      { type: 'events', events: [N(0, 0, 1, 220), N(0.05, 1, 2, 330), N(0.1, 2, 3, 440), O(0.4, 0, 1), O(0.5, 1, 2)] },
    ],
  };

  /* units in the module and foreign units in one render */
  rows.mixed = {
    seconds: 0.8,
    gate: 3.5e-3,
    why: 'the VA sets it; the foreign half is exact',
    score: [
      { type: 'defOp', kind: 'engine', code: TIER3_ENGINE },
      { type: 'createChannel', id: 0, engineId: 'va', params: { cutoff: 1500 }, seed: 'm0' },
      { type: 'createChannel', id: 1, engineId: 'tier3-sine', params: {}, seed: 'm1' },
      { type: 'createChannel', id: 2, engineId: 'js-pluck', params: {}, seed: 'm2' },
      { type: 'channelFx', id: 1, chain: [{ effectId: 'saturator', params: { drive: 3 } }, { effectId: 'js-plate', params: { mix: 0.3 } }] },
      { type: 'events', events: [N(0, 0, 1, 220), N(0.05, 1, 2, 330), N(0.1, 2, 3, 440), O(0.4, 0, 1), O(0.5, 1, 2)] },
    ],
  };
  return rows;
}

/* ---------------- run ---------------- */

function render(row, sr, kernelName) {
  return renderOffline(row.score, {
    seconds: row.seconds,
    sampleRate: sr,
    kernel: row.kernel,
    kernelName,
    onBlock: row.timed ? timed(row.timed) : undefined,
  });
}

function compare(a, b) {
  let d = 0;
  let s = 0;
  let same = true;
  for (const ch of ['left', 'right']) {
    const x = a[ch];
    const y = b[ch];
    if (x.length !== y.length) same = false;
    for (let i = 0; i < x.length; i++) {
      if (!Object.is(x[i], y[i])) same = false;
      d += (x[i] - y[i]) ** 2;
      s += x[i] ** 2;
    }
  }
  return { same, rel: Math.sqrt(d / Math.max(s, 1e-30)), rms: Math.sqrt(s / (2 * a.left.length)) };
}

const pick = (name) => !ONLY.length || ONLY.includes(name);
const e2 = (x) => x.toExponential(1);
let failed = 0;
let count = 0;

process.stdout.write('the module kernel against KernelEngine, bit for bit, foreign units only\n\n');
for (const [name, row] of Object.entries(exactRows())) {
  if (!pick(name)) continue;
  for (const sr of [44100, 48000]) {
    count++;
    const ts = render(row, sr);
    const wk = render(row, sr, KERNEL_NAME);
    const c = compare(ts, wk);
    if (!c.same) failed++;
    process.stdout.write(`  ${(name + ' @' + sr).padEnd(20)} ${c.same ? 'identical' : 'DIFFERENT ' + e2(c.rel)}   rms ${e2(c.rms)}\n`);
  }
}

process.stdout.write('\nthe module kernel and its units against KernelEngine, rel RMS of the difference\n\n');
for (const [name, row] of Object.entries(nativeRows())) {
  if (EXACT || !pick(name)) continue;
  const figs = [44100, 48000, 96000].map((sr) => compare(render(row, sr), render(row, sr, KERNEL_NAME)));
  const worst = Math.max(...figs.map((f) => f.rel));
  count++;
  const bad = worst > row.gate;
  if (bad) failed++;
  process.stdout.write(
    `  ${name.padEnd(20)} ${figs.map((f) => e2(f.rel).padStart(8)).join('')}  gate ${e2(row.gate)}${bad ? '  FAIL' : ''}   rms ${e2(figs[0].rms)}${row.why ? '   ' + row.why : ''}\n`,
  );
}

if (!ONLY.length && !EXACT) {
  process.stdout.write('\nthe worklet script against the calling thread, bit for bit\n\n');
  const row = nativeRows().path;
  const sr = 48000;
  const a = render(row, sr, KERNEL_NAME);
  const b = renderWorkletInProcess(row.score, { frames: Math.ceil(row.seconds * sr), sampleRate: sr, plugins: [plugin], kernel: KERNEL_NAME });
  const c = compare(a, b);
  count++;
  if (!c.same) failed++;
  process.stdout.write(`  path @48000          ${c.same ? 'identical' : 'DIFFERENT ' + e2(c.rel)}\n`);
}

process.stdout.write(`\n${failed ? 'FAILED' : 'ok'}: ${count - failed} of ${count}\n`);
if (failed && !REPORT) process.exit(1);
