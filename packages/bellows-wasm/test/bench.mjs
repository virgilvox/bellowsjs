/* Time through the kernel, the plugin's JavaScript-to-module crossing included: a held
 * eight-note chord for five seconds, best of three after a warm-up, TypeScript unit against
 * the module's. node test/bench.mjs */
import { renderOffline } from 'bellowsjs';
import { bellowsWasm } from '../dist/index.js';
bellowsWasm().register();
const SR = 48000, SEC = 5;
const chord = { type: 'events', events: [0, 3, 7, 10, 12, 15, 19, 22].map((s, i) => ({ time: 0.01 * i, kind: 0, target: 1, a: i + 1, b: 110 * 2 ** (s / 12), c: 0.7 })) };
const eng = (id) => [{ type: 'createChannel', id: 1, engineId: id, params: {}, seed: 'b', polyphony: 8 }, chord];
const fx = (id) => [{ type: 'createChannel', id: 1, engineId: 'kick', params: {}, seed: 'b' }, { type: 'channelFx', id: 1, chain: [{ effectId: id, params: {} }] }, chord];
const time = (score) => {
  renderOffline(score, { seconds: 1, sampleRate: SR });
  let best = Infinity;
  for (let k = 0; k < 3; k++) { const t = performance.now(); renderOffline(score, { seconds: SEC, sampleRate: SR }); best = Math.min(best, performance.now() - t); }
  return best / SEC;
};
const rows = [...['va', 'fm', 'additive', 'wavetable', 'string', 'modal', 'westcoast', 'harmonic'].map((u) => [u, eng]), ...['plate', 'delay', 'saturator', 'compressor', 'chorus'].map((u) => [u, fx])];
console.log('ms of compute per second of audio, 48 kHz' + '\n');
for (const [u, s] of rows) {
  const base = s === fx ? time(fx('eq').slice(0, 1).concat([chord])) : 0;
  const a = time(s(u)) - base, b = time(s('wasm-' + u)) - base;
  console.log(`  ${u.padEnd(11)} ts ${a.toFixed(1).padStart(6)}   wasm ${b.toFixed(1).padStart(6)}   ${(a / b).toFixed(2)}x${s === fx ? '  (effect alone, the kick source subtracted)' : '  (eight voices)'}`);
}
