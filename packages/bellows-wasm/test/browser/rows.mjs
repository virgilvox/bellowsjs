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

