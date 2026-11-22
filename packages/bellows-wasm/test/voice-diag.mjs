/* One voice straight from its def, TypeScript against the module, params given on the command line:
 *   node test/voice-diag.mjs wavetable 48000 position=0.25 filter=1 */
import { getEngine, registerBuiltins, rng } from 'bellowsjs';
import { bellowsWasm } from '../dist/index.js';
registerBuiltins();
bellowsWasm().register();
const [id, srArg, ...kv] = process.argv.slice(2);
const sr = Number(srArg || 48000);
const params = Object.fromEntries(kv.map((s) => s.split('=')).map(([k, v]) => [k, Number(v)]));
function run(def) {
  const v = def.createVoice(sr, { ...params }, rng('diag'));
  const n = Math.round(0.8 * sr);
  const l = new Float32Array(n), r = new Float32Array(n);
  v.noteOn(220, 0.9);
  for (let i = 0; i < n; i += 128) v.process(l, r, i, Math.min(n, i + 128));
  return [l, r];
}
const a = run(getEngine(id)), b = run(getEngine('wasm-' + id));
let d = 0, s = 0, first = -1;
for (let c = 0; c < 2; c++) for (let i = 0; i < a[c].length; i++) { const e = a[c][i] - b[c][i]; d += e * e; s += a[c][i] ** 2; if (first < 0 && Math.abs(e) > 1e-3 * Math.max(1e-3, Math.abs(a[c][i]))) first = i; }
console.log(id, sr, JSON.stringify(params), 'rel', Math.sqrt(d / s).toExponential(2), 'first>1e-3 at', first);
