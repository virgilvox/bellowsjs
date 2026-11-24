/*
 * Runs in a page: renders scores through the kernel worklet in an OfflineAudioContext, the plugin
 * added with audioWorklet.addModule as a page adds it, TypeScript units against the module's.
 * Writes JSON into #out for tools/browser-test.mjs to read back.
 */
import { renderInWorklet } from '../../../bellows/src/kernel/offline-context.ts';
import { KERNEL_NAME, bellowsWasm } from '../../dist/index.js';

import { KERNEL_ROWS, ROWS, SR, SECONDS, rel, hash } from './rows.mjs';

async function main() {
  const out = { ua: navigator.userAgent, isolated: self.crossOriginIsolated, rows: [], kernelRows: [] };
  const plugin = bellowsWasm();
  for (const [name, score] of ROWS) {
    const opts = { frames: Math.ceil(SECONDS * SR), sampleRate: SR, plugins: [plugin] };
    const ts = await renderInWorklet(score(''), opts);
    const t0 = performance.now();
    const wa = await renderInWorklet(score('wasm-'), opts);
    out.rows.push({ name, rel: rel(ts, wa), wasmHash: hash(wa), ms: performance.now() - t0 });
  }
  /* the module's kernel against the TypeScript one, the same score, the processor choosing by name */
  const kernel = bellowsWasm({ kernel: true });
  for (const [name, score] of KERNEL_ROWS) {
    const opts = { frames: Math.ceil(SECONDS * SR), sampleRate: SR, plugins: [kernel] };
    const ts = await renderInWorklet(score, opts);
    const t0 = performance.now();
    const wk = await renderInWorklet(score, { ...opts, kernel: KERNEL_NAME });
    out.kernelRows.push({ name, rel: rel(ts, wk), wasmHash: hash(wk), ms: performance.now() - t0 });
  }
  return out;
}
main().then(
  (r) => (document.getElementById('out').textContent = JSON.stringify(r)),
  (e) => (document.getElementById('out').textContent = JSON.stringify({ error: String(e && e.stack || e) })),
);
