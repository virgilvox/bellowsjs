/*
 * The FFT and STFT under the spectral effects, the C++ (bellows/dsp/fft.h, stft.h, built to
 * WebAssembly) against the TypeScript (src/dsp/fft.ts, stft.ts), on the same seeded input.
 *
 *   cd packages/bellows && npx vite-node ../bellows-wasm/test/spectral-dsp.mjs [--report]
 *
 * Transform figures are the worst absolute difference over the largest TypeScript magnitude;
 * window figures are the worst absolute difference; STFT figures are the worst absolute
 * difference over a full scale input after the first window, and the relative RMS. Gates are
 * about two and a half times the measured worst.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWasm } from '../../bellows-embedded/tools/wasm/host.mjs';
import { Fft, RealFft, hann, hamming, blackmanHarris } from '../../bellows/src/dsp/fft.ts';
import { StftProcessor } from '../../bellows/src/dsp/stft.ts';
import { rng } from '../../bellows/src/core/prng.ts';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const REPORT = process.argv.includes('--report');
const out = join(PKG, 'build', 'spectral-dsp.wasm');
buildWasm([join(PKG, 'test', 'spectral-dsp.cpp')], out, {
  include: [join(PKG, '..', 'bellows-embedded', 'src')],
  runtime: join(PKG, 'src', 'rt.c'),
});
const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(out)), {}).exports;

function arr(n) {
  const p = ex.bw_alloc(4 * n);
  return { p, n, get: () => new Float32Array(ex.memory.buffer, p, n) };
}
function put(a, src) {
  a.get().set(src);
}
const noise = (label, n) => {
  const r = rng(label);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 2 * r() - 1;
  return x;
};
const maxAbs = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const maxDiff = (a, b, from = 0) => {
  let m = 0;
  for (let i = from; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

const rows = [];
const row = (name, fig, gate) => rows.push({ name, fig, gate });

for (const n of [2, 4, 8, 256, 1024, 2048]) {
  const nb = (n >> 1) + 1;
  const x = noise('fft/' + n, n);
  const ts = new RealFft(n);
  const re = new Float32Array(nb), im = new Float32Array(nb);
  ts.forward(x, re, im);
  const a = arr(n), r = arr(nb), i = arr(nb), o = arr(n);
  put(a, x);
  if (!ex.sd_real_forward(n, a.p, r.p, i.p)) throw new Error('RealFft Init failed at ' + n);
  const scale = Math.max(maxAbs(re), maxAbs(im));
  row(`real forward ${n}`, Math.max(maxDiff(r.get(), re), maxDiff(i.get(), im)) / scale, 1e-6);
  /* inverse of the TypeScript bins, so the two inverses see the same input */
  const back = new Float32Array(n);
  ts.inverse(re, im, back);
  put(r, re);
  put(i, im);
  ex.sd_real_inverse(n, r.p, i.p, o.p);
  row(`real inverse ${n}`, maxDiff(o.get(), back) / maxAbs(back), 1e-6);

  const cr = noise('cfft/re/' + n, n), ci = noise('cfft/im/' + n, n);
  for (const inverse of [0, 1]) {
    const tr = cr.slice(), tim = ci.slice();
    const f = new Fft(n);
    inverse ? f.inverse(tr, tim) : f.forward(tr, tim);
    const wr = arr(n), wi = arr(n);
    put(wr, cr);
    put(wi, ci);
    ex.sd_complex(n, wr.p, wi.p, inverse);
    const s = Math.max(maxAbs(tr), maxAbs(tim));
    row(`complex ${inverse ? 'inverse' : 'forward'} ${n}`, Math.max(maxDiff(wr.get(), tr), maxDiff(wi.get(), tim)) / s, 1e-6);
  }
}

for (const [kind, name, fn] of [[0, 'hann', hann], [1, 'hamming', hamming], [2, 'blackman-harris', blackmanHarris]]) {
  for (const n of [1024, 2048]) {
    const w = arr(n);
    ex.sd_window(kind, n, w.p);
    row(`${name} ${n}`, maxDiff(w.get(), fn(n)), 3e-7);
  }
}

/*
 * [n, hop, gate on the worst sample, gate on the relative RMS, per mode]. The effects run hop n/4,
 * where the overlap-add sum is 1.5 everywhere. Hop 1000 of 1024 is the far edge of what
 * stft.ts accepts: the sum falls to 3.7e-6 at offset 12, so synthesis multiplies by 2.7e5 there
 * and a last-place difference in the window or a bin becomes 8e-5 at that offset (2.3e-3 once
 * half the bins are zeroed and the frames stop cancelling). The RMS stays under 1e-5.
 */
const STFT = [
  [1024, 256, [1e-6, 1e-6], [5e-7, 5e-7]],
  [2048, 512, [1e-6, 1e-6], [5e-7, 5e-7]],
  [1024, 1000, [2e-4, 6e-3], [2e-5, 1.5e-5]],
];
for (const [n, hop, gMax, gRms] of STFT) {
  for (const mode of [0, 1]) {
    const len = 6 * n;
    const sr = 48000;
    const x = new Float32Array(len);
    const r = rng('stft/' + n);
    for (let t = 0; t < len; t++) x[t] = 0.6 * Math.sin((2 * Math.PI * 431 * t) / sr) + 0.4 * (2 * r() - 1);
    const p = new StftProcessor(n, hop);
    if (mode === 1) p.spectral = (re, im) => { for (let k = 1; k < re.length; k += 2) re[k] = im[k] = 0; };
    const y = new Float32Array(len);
    for (let t = 0; t < len; t++) y[t] = p.tick(x[t]);
    const a = arr(len), o = arr(len);
    put(a, x);
    if (!ex.sd_stft(n, hop, a.p, o.p, len, mode)) throw new Error('StftProcessor Init failed');
    const w = o.get();
    let d = 0, s = 0;
    for (let t = 0; t < len; t++) { d += (w[t] - y[t]) ** 2; s += y[t] ** 2; }
    row(`stft ${n}/${hop}${mode ? ' odd bins out' : ''} max`, maxDiff(w, y), gMax[mode]);
    row(`stft ${n}/${hop}${mode ? ' odd bins out' : ''} rel rms`, Math.sqrt(d / s), gRms[mode]);
  }
}

let failed = 0;
process.stdout.write('bellows/dsp/fft.h and stft.h against src/dsp/fft.ts and stft.ts\n\n');
for (const r of rows) {
  const bad = !(r.fig <= r.gate);
  if (bad) failed++;
  process.stdout.write(`  ${r.name.padEnd(36)} ${r.fig.toExponential(2).padStart(9)}  gate ${r.gate.toExponential(1)}${bad ? '  FAIL' : ''}\n`);
}
process.stdout.write(`\n${failed ? 'FAILED' : 'ok'}: ${rows.length - failed} of ${rows.length} inside their gates\n`);
if (failed && !REPORT) process.exit(1);
