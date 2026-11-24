/* The scores the browser check renders, and the two measures, shared by the page and by Node. */
export const SR = 48000;
export const SECONDS = 0.8;
const notes = {
  type: 'events',
  events: [
    { time: 0, kind: 0, target: 1, a: 1, b: 220, c: 0.9 },
    { time: 0.05, kind: 0, target: 1, a: 2, b: 277.18, c: 0.6 },
    { time: 0.11, kind: 0, target: 1, a: 3, b: 329.63, c: 0.75 },
    { time: 0.4, kind: 1, target: 1, a: 1, b: 0, c: 0 },
    { time: 0.45, kind: 1, target: 1, a: 2, b: 0, c: 0 },
    { time: 0.5, kind: 1, target: 1, a: 3, b: 0, c: 0 },
  ],
};
const base = (engineId, params, fx) => [
  { type: 'masterGain', gain: 1 },
  { type: 'createChannel', id: 1, engineId, params, seed: 'wasm-parity' },
  { type: 'channelGain', id: 1, gain: 1 },
  ...(fx ? [{ type: 'channelFx', id: 1, chain: [fx] }] : []),
  notes,
];
export const ROWS = [
  ['va', (w) => base(w + 'va', { shape: 1, cutoff: 2400, resonance: 0.5, envAmount: 2 })],
  ['fm', (w) => base(w + 'fm', { algorithm: 3, feedback: 0.3, ratio2: 2 })],
  ['wavetable', (w) => base(w + 'wavetable', { position: 0.25, scanDepth: 0.5, scanRate: 3 })],
  ['string', (w) => base(w + 'string', { bow: 0.8, body: 0.5, polDetune: 2 })],
  ['modal', (w) => base(w + 'modal', { material: 2 })],
  ['plate', (w) => base('va', { shape: 1 }, { effectId: w + 'plate', params: { decay: 0.7, mix: 0.5 } })],
  ['limiter', (w) => base('va', { shape: 1 }, { effectId: w + 'limiter', params: { ceiling: -6, truePeak: 1 } })],
  ['saturator', (w) => base('va', { shape: 1 }, { effectId: w + 'saturator', params: { drive: 5, curve: 3 } })],
];

/* Whole scores for the module's kernel, under the TypeScript ids: units it carries, a tier 3 def
 * it plays in JavaScript, a bus and the master. */
const TIER3 = `{ id: 'tier3-sine', label: 't3', params: [], createVoice(sr) { let ph = 0, inc = 0, a = 0, on = false;
  return { noteOn(f, v) { inc = f / sr; a = v * 0.3; on = true; }, noteOff() { on = false; }, get active() { return on || a > 1e-4; },
    setParam() {}, process(l, r, from, to) { for (let i = from; i < to; i++) { if (!on) a *= 0.999; const s = Math.sin(6.283185307179586 * ph) * a; ph += inc; if (ph >= 1) ph -= 1; l[i] += s; r[i] += s; } } }; } }`;
export const KERNEL_ROWS = [
  [
    'mix',
    [
      { type: 'defOp', kind: 'engine', code: TIER3 },
      { type: 'createChannel', id: 0, engineId: 'va', params: { cutoff: 1500 }, seed: 'k0' },
      { type: 'createChannel', id: 1, engineId: 'tier3-sine', params: {}, seed: 'k1' },
      { type: 'createChannel', id: 2, engineId: 'pluck', params: {}, seed: 'k2' },
      { type: 'createChannel', id: 3, engineId: 'kick', params: {}, seed: 'k3' },
      { type: 'channelPan', id: 2, pan: -0.5 },
      { type: 'channelFx', id: 0, chain: [{ effectId: 'saturator', params: { drive: 3 } }, { effectId: 'chorus', params: {} }] },
      { type: 'createBus', id: 0, chain: [{ effectId: 'plate', params: { mix: 1 } }], returnLevel: 0.4 },
      { type: 'send', channelId: 2, busId: 0, level: 0.5 },
      { type: 'masterFx', chain: [{ effectId: 'limiter', params: { ceiling: -3 } }] },
      {
        type: 'events',
        events: [
          { time: 0, kind: 0, target: 0, a: 1, b: 220, c: 0.8 },
          { time: 0.05, kind: 0, target: 1, a: 2, b: 330, c: 0.8 },
          { time: 0.1, kind: 0, target: 2, a: 3, b: 440, c: 0.8 },
          { time: 0.2, kind: 0, target: 3, a: 4, b: 55, c: 1 },
          { time: 0.4, kind: 1, target: 0, a: 1, b: 0, c: 0 },
          { time: 0.5, kind: 1, target: 1, a: 2, b: 0, c: 0 },
        ],
      },
    ],
  ],
];

export function rel(a, b) {
  let d = 0, s = 0;
  for (const ch of ['left', 'right']) for (let i = 0; i < a[ch].length; i++) { d += (a[ch][i] - b[ch][i]) ** 2; s += a[ch][i] ** 2; }
  return Math.sqrt(d / Math.max(s, 1e-30));
}
/* FNV-1a over the float bits, to compare a render with the one Node makes */
export function hash(r) {
  let h = 0x811c9dc5;
  for (const ch of ['left', 'right']) {
    const u = new Uint32Array(r[ch].buffer, r[ch].byteOffset, r[ch].length);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
  }
  return h.toString(16);
}

