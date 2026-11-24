#!/usr/bin/env node
/*
 * The plugin in a real browser: bundles test/browser/entry.mjs, serves it on localhost, loads it in
 * headless Chrome, and reads back what the page measured. Each row renders through the kernel
 * worklet in an OfflineAudioContext with the plugin added by audioWorklet.addModule, which is the
 * path a page takes and the one the Node test cannot reach (it runs the same script on its own
 * thread). The module's render must also hash the same as Node's renderOffline of the same score.
 *
 *   node tools/browser-test.mjs [--chrome=/path/to/chrome]
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOffline } from 'bellowsjs';
import { KERNEL_NAME, bellowsWasm } from '../dist/index.js';
import { KERNEL_ROWS, ROWS, SR, SECONDS, hash } from '../test/browser/rows.mjs';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = join(PKG, '..', '..');
const DIR = join(PKG, 'test', 'browser');
const arg = process.argv.find((a) => a.startsWith('--chrome='));
const CHROME = arg ? arg.slice(9) : process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

execFileSync(join(REPO, 'node_modules', '.bin', 'esbuild'), [
  join(DIR, 'entry.mjs'), '--bundle', '--format=esm', '--log-level=warning',
  `--alias:bellowsjs=${join(REPO, 'packages', 'bellows', 'src', 'index.ts')}`,
  `--outfile=${join(PKG, 'build', 'browser', 'bundle.js')}`,
], { stdio: 'inherit' });

const files = {
  '/': [join(DIR, 'index.html'), 'text/html'],
  '/bundle.js': [join(PKG, 'build', 'browser', 'bundle.js'), 'text/javascript'],
};
const server = createServer((req, res) => {
  const f = files[req.url.split('?')[0]];
  if (!f) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': f[1], 'cache-control': 'no-store' }).end(readFileSync(f[0]));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

/* Chrome with the DevTools protocol on a pipe-free port: poll #out until the page has written it. */
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + join(PKG, 'build', 'chrome-profile'), '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let s = '';
  chrome.stderr.on('data', (d) => {
    s += d;
    const m = /DevTools listening on (ws:\S+)/.exec(s);
    if (m) resolve(m[1]);
  });
  chrome.on('error', reject);
  setTimeout(() => reject(new Error('chrome did not start')), 20000);
});
let res;
try {
  const port = new URL(wsUrl).port;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
    else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') logs.push(JSON.stringify(m.params).slice(0, 300));
  };
  const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await call('Runtime.enable');
  const deadline = Date.now() + 180000;
  let text = 'running';
  while (Date.now() < deadline) {
    const r = await call('Runtime.evaluate', { expression: "document.getElementById('out')?.textContent ?? 'running'", returnByValue: true });
    text = r?.result?.value ?? 'running';
    if (text !== 'running') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  ws.close();
  if (text === 'running') throw new Error('the page did not finish in 180 s' + (logs.length ? ': ' + logs.join(' | ') : ''));
  res = JSON.parse(text);
} finally {
  chrome.kill();
  server.close();
}
if (res.error) {
  process.stderr.write(`the page failed: ${res.error}\n`);
  process.exit(1);
}
/* The same scores through register() and renderOffline on this thread. */
bellowsWasm().register();
const GATE = 4e-2; /* the loosest row of test/parity.mjs; that file carries the per-unit gates */
let bad = 0;
process.stdout.write(`${res.ua}\n\n`);
for (const r of res.rows) {
  const score = ROWS.find(([n]) => n === r.name)[1]('wasm-');
  const node = hash(renderOffline(score, { seconds: SECONDS, sampleRate: SR }));
  const same = node === r.wasmHash;
  const ok = same && r.rel <= GATE;
  if (!ok) bad++;
  process.stdout.write(`  ${r.name.padEnd(12)} rel ${r.rel.toExponential(1).padStart(8)}   ${same ? 'same samples as Node' : `DIFFERENT from Node (${r.wasmHash} against ${node})`}${ok ? '' : '  FAIL'}\n`);
}
bellowsWasm({ kernel: true }).register();
process.stdout.write('\nthe module kernel, chosen by the processor\n\n');
for (const r of res.kernelRows) {
  const score = KERNEL_ROWS.find(([n]) => n === r.name)[1];
  const node = hash(renderOffline(score, { seconds: SECONDS, sampleRate: SR, kernelName: KERNEL_NAME }));
  const same = node === r.wasmHash;
  const ok = same && r.rel <= GATE;
  if (!ok) bad++;
  process.stdout.write(`  ${r.name.padEnd(12)} rel ${r.rel.toExponential(1).padStart(8)}   ${same ? 'same samples as Node' : `DIFFERENT from Node (${r.wasmHash} against ${node})`}${ok ? '' : '  FAIL'}\n`);
}
const total = res.rows.length + res.kernelRows.length;
process.stdout.write(`\n${bad ? 'FAILED' : 'ok'}: ${total - bad} of ${total} rows\n`);
if (bad) process.exit(1);
