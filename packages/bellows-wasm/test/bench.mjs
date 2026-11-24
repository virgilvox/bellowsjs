/* Time through the kernel: a held eight-note chord for five seconds, best of three after a
 * warm-up, three ways. ts: the TypeScript kernel and unit. plugin: the TypeScript kernel calling
 * the module's unit ('wasm-va'), the crossing per voice per block included. kernel: the module's
 * kernel running the module's unit, one crossing per block. Then a whole mix, every engine the
 * module carries on its own channel with an effect each, two buses and a master chain.
 * node test/bench.mjs (from packages/bellows, through vite-node, like the parity tests) */
import { renderOffline } from 'bellowsjs';
import { KERNEL_NAME, bellowsWasm, engineIds, effectIds } from '../dist/index.js';
bellowsWasm().register();
bellowsWasm({ kernel: true }).register();
const SR = 48000;
const SEC = 5;
const chord = { type: 'events', events: [0, 3, 7, 10, 12, 15, 19, 22].map((s, i) => ({ time: 0.01 * i, kind: 0, target: 1, a: i + 1, b: 110 * 2 ** (s / 12), c: 0.7 })) };
const eng = (id) => [{ type: 'createChannel', id: 1, engineId: id, params: {}, seed: 'b', polyphony: 8 }, chord];
const fx = (id) => [{ type: 'createChannel', id: 1, engineId: 'kick', params: {}, seed: 'b' }, { type: 'channelFx', id: 1, chain: [{ effectId: id, params: {} }] }, chord];
const time = (score, kernelName, seconds = SEC) => {
  renderOffline(score, { seconds: 1, sampleRate: SR, kernelName });
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = performance.now();
    renderOffline(score, { seconds, sampleRate: SR, kernelName });
    best = Math.min(best, performance.now() - t);
  }
  return best / seconds;
};
const ratio = (a, b) => (a / b).toFixed(2) + 'x';
const engines = ['va', 'fm', 'additive', 'wavetable', 'string', 'modal', 'westcoast', 'harmonic'].filter((u) => engineIds.includes(u));
const effects = ['plate', 'delay', 'saturator', 'compressor', 'chorus'].filter((u) => effectIds.includes(u));
console.log('ms of compute per second of audio, 48 kHz\n');
console.log(`  ${''.padEnd(11)} ${'ts'.padStart(7)} ${'plugin'.padStart(8)} ${'kernel'.padStart(8)}   plugin  kernel (speed against ts)`);
for (const u of engines) {
  const a = time(eng(u));
  const b = time(eng('wasm-' + u));
  const c = time(eng(u), KERNEL_NAME);
  console.log(`  ${u.padEnd(11)} ${a.toFixed(1).padStart(7)} ${b.toFixed(1).padStart(8)} ${c.toFixed(1).padStart(8)}   ${ratio(a, b).padStart(6)}  ${ratio(a, c).padStart(6)}   eight voices`);
}
for (const u of effects) {
  const base = time(eng('kick'));
  const baseK = time(eng('kick'), KERNEL_NAME);
  const a = time(fx(u)) - base;
  const b = time(fx('wasm-' + u)) - base;
  const c = time(fx(u), KERNEL_NAME) - baseK;
  console.log(`  ${u.padEnd(11)} ${a.toFixed(1).padStart(7)} ${b.toFixed(1).padStart(8)} ${c.toFixed(1).padStart(8)}   ${ratio(a, b).padStart(6)}  ${ratio(a, c).padStart(6)}   the effect alone, the kick source subtracted`);
}

/* the whole mix */
const chainable = effectIds.filter((id) => !['plate', 'delay', 'limiter', 'eq'].includes(id));
const mix = (prefix) => {
  const score = [];
  const events = [];
  engineIds.forEach((id, ch) => {
    score.push({ type: 'createChannel', id: ch, engineId: prefix + id, params: {}, seed: 'm' + ch, polyphony: 4 });
    score.push({ type: 'channelGain', id: ch, gain: 0.2 });
    score.push({ type: 'channelFx', id: ch, chain: [{ effectId: prefix + chainable[ch % chainable.length], params: {} }] });
    score.push({ type: 'send', channelId: ch, busId: ch % 2, level: 0.3 });
    for (let n = 0; n < 4; n++) events.push({ time: n * 0.3, kind: 0, target: ch, a: n + 1, b: 110 * 2 ** ((ch + n * 5) / 12), c: 0.6 });
  });
  score.push({ type: 'createBus', id: 0, chain: [{ effectId: prefix + 'plate', params: { mix: 1 } }], returnLevel: 0.3 });
  score.push({ type: 'createBus', id: 1, chain: [{ effectId: prefix + 'delay', params: { mix: 1 } }], returnLevel: 0.3 });
  score.push({ type: 'masterFx', chain: [{ effectId: prefix + 'eq', params: {} }, { effectId: prefix + 'limiter', params: {} }] });
  score.push({ type: 'events', events });
  return score;
};
const a = time(mix(''), undefined, 3);
const b = time(mix('wasm-'), undefined, 3);
const c = time(mix(''), KERNEL_NAME, 3);
console.log(`\n  ${'whole mix'.padEnd(11)} ${a.toFixed(1).padStart(7)} ${b.toFixed(1).padStart(8)} ${c.toFixed(1).padStart(8)}   ${ratio(a, b).padStart(6)}  ${ratio(a, c).padStart(6)}   ${engineIds.length} channels of 4 voices, an effect each, 2 buses, a master chain`);
