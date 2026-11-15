/*
 * Writes data/vocal/extra-vowels.json: the vowel qualities General American lacks, which other
 * accents need (ɒ ɐ ɜ ʉ ɨ ɘ ɵ y ø œ ɯ ɤ). Each is a male formant target, scaled to the female and child
 * bodies by the ratio of their General American vowels' formants to the male body's, and solved into
 * articulator targets with src/engines/vowel-solver.ts from a General American vowel's posture: the
 * nearest, except ɨ and y, which start from the rounded back vowels because from i and ɪ the closed
 * loop settled on a fit with F2 too high (MEASURED: male ɨ 14.6 percent off from ɪ, 1.4 from ʊ). The
 * child y stays about 12 percent high in F1: that body's floor for a rounded close vowel. Then the loop is closed through the engine itself: the fit is rendered, its formants measured
 * (estimateFormants), and the target the solver aims at moved by most of the error, up to six rounds,
 * keeping the best. The model alone missed three vowels by up to 14 percent through the engine
 * (MEASURED). The high-note tuning row is the starting vowel's. Bellows' own data, not CHIMERA's.
 *
 *   node scripts/gen-extra-vowels.mjs --only=ɨ,y   re-solve those vowels, keep the rest
 *
 *   node scripts/gen-extra-vowels.mjs           write the file
 *   node scripts/gen-extra-vowels.mjs --check   exit 1 if it is stale
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');

/*
 * Male targets, Hz (F1, F2, F3), and the General American vowel each starts from. Values place each
 * symbol where the accent literature puts that quality for adult men: British LOT [ɒ] and NURSE [ɜː]
 * near Deterding 1997 and Ferragne and Pellegrino 2010, fronted GOOSE [ʉ] as in Australian and Scottish
 * English, and the rest at the corresponding cardinal positions. INFERRED, to be refined per accent.
 */
const TARGETS = {
  'ɒ': { f: [600, 900, 2500], from: 'ɔ' },
  'ɐ': { f: [700, 1300, 2500], from: 'ʌ' },
  'ɜ': { f: [480, 1350, 2450], from: 'ʌ' },
  'ʉ': { f: [330, 1600, 2300], from: 'u' },
  'ɨ': { f: [330, 1750, 2600], from: 'ʊ' },
  'ɘ': { f: [450, 1550, 2500], from: 'ɪ' },
  'ɵ': { f: [450, 1300, 2300], from: 'ʊ' },
  'y': { f: [290, 1900, 2150], from: 'u' },
  'ø': { f: [400, 1600, 2200], from: 'e' },
  'œ': { f: [550, 1500, 2300], from: 'ɛ' },
  'ɯ': { f: [330, 1300, 2400], from: 'u' },
  'ɤ': { f: [470, 1150, 2500], from: 'o' },
};
const GA = ['i', 'ɪ', 'e', 'ɛ', 'æ', 'ɑ', 'ɔ', 'o', 'ʊ', 'u', 'ʌ'];
const KEYS = ['tbX', 'tbY', 'jaw', 'lipAp', 'lipProt', 'lipWidth', 'root', 'larynx', 'ttCurl'];
const BODIES = ['male', 'female', 'child'];

const dir = mkdtempSync(join(tmpdir(), 'bellows-vowels-'));
const outfile = join(dir, 'solver.mjs');
try {
  await build({
    stdin: {
      contents: `export * from './src/engines/vowel-solver';
export { VOCAL_BODIES, VOCAL_NEUTRAL, VOCAL_ARTICULATOR_NAMES, VOCAL_TABLE_PHONEMES } from './src/engines/vocal-tables.gen';
export { vocalEngine } from './src/engines/vocal';
export { estimateFormants } from './src/analysis/formants';
export { rng } from './src/core/prng';`,
      resolveDir: pkg,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'error',
  });
  const m = await import(pathToFileURL(outfile).href);
  const tuning = JSON.parse(readFileSync(join(pkg, 'data/vocal/tuning-table.json'), 'utf8'));
  const posture = (body, ipa) => {
    const row = m.VOCAL_BODIES[body].vowelTargets[m.VOCAL_TABLE_PHONEMES.indexOf(ipa)];
    return Float64Array.from(m.VOCAL_NEUTRAL, (n, k) => (row[k] === row[k] ? row[k] : n));
  };
  const geos = BODIES.map((_, b) => m.vowelGeometry(b));
  /* A held vowel through the engine with `post` as its target row; the median F1 and F2 of its steady part. */
  const render = (b, ipa, post) => {
    const rows = m.VOCAL_BODIES[b].vowelTargets;
    const idx = m.VOCAL_TABLE_PHONEMES.indexOf(ipa);
    const saved = rows[idx];
    rows[idx] = Array.from(m.VOCAL_ARTICULATOR_NAMES, (k, i) => (KEYS.includes(k) ? post[i] : NaN));
    const sr = 48000;
    const params = {};
    for (const p of m.vocalEngine.params) params[p.name] = p.default;
    Object.assign(params, { body: b, vibratoDepth: 0, drift: 0, roughness: 0 });
    const v = m.vocalEngine.createVoice(sr, params, m.rng('solve-' + ipa));
    for (const [k, val] of Object.entries(params)) v.setParam(k, val);
    v.setParam('phoneme', idx);
    v.noteOn(110, 0.8);
    const l = new Float32Array(sr);
    const r = new Float32Array(sr);
    for (let i = 0; i < sr; i += 128) v.process(l, r, i, Math.min(sr, i + 128));
    rows[idx] = saved;
    const f1 = [];
    const f2 = [];
    for (let t = 0.45; t <= 0.9; t += 0.05) {
      const fm = m.estimateFormants(l, sr, Math.round(t * sr)).filter((f) => f.f > 200 && f.bw < 500);
      if (fm.length >= 2) {
        f1.push(fm[0].f);
        f2.push(fm[1].f);
      }
    }
    const med = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
    return [med(f1), med(f2)];
  };
  const ga = BODIES.map((_, b) => GA.map((v) => m.predictFormants(geos[b], posture(b, v))));
  const ratio = BODIES.map((_, b) => [0, 1, 2].map((f) => ga[b].reduce((s, row, i) => s + row[f] / ga[0][i][f], 0) / GA.length));
  /* --only=ɨ,y re-solves those vowels and keeps the rest of the committed file. */
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',') : null;
  const previous = only ? JSON.parse(readFileSync(join(pkg, 'data/vocal/extra-vowels.json'), 'utf8')) : null;
  const out = {
    note: 'Generated by scripts/gen-extra-vowels.mjs. Bellows data (MIT), not CHIMERA: solved from formant targets with src/engines/vowel-solver.ts.',
    order: Object.keys(TARGETS),
    bodyFormantRatio: Object.fromEntries(BODIES.map((n, b) => [n, ratio[b].map((r) => Number(r.toFixed(4)))])),
    targets: {},
    vowelTargetsByBody: {},
    tuning: {},
  };
  for (const [b, name] of BODIES.entries()) {
    out.vowelTargetsByBody[name] = {};
    out.tuning[name] = {};
    for (const [ipa, t] of Object.entries(TARGETS)) {
      if (only && !only.includes(ipa)) {
        out.vowelTargetsByBody[name][ipa] = previous.vowelTargetsByBody[name][ipa];
        out.tuning[name][ipa] = previous.tuning[name][ipa];
        if (b === 0) out.targets[ipa] = previous.targets[ipa];
        continue;
      }
      const target = { f1: t.f[0] * ratio[b][0], f2: t.f[1] * ratio[b][1], f3: t.f[2] * ratio[b][2] };
      const aim = { ...target };
      let fit = null;
      let best = Infinity;
      let got = null;
      for (let round = 0; round < 6; round++) {
        const f = m.solveVowel(geos[b], aim, posture(b, t.from));
        const meas = render(b, ipa, f.posture);
        const err = Math.max(Math.abs(meas[0] / target.f1 - 1), Math.abs(meas[1] / target.f2 - 1));
        if (err < best) {
          best = err;
          fit = f;
          got = meas;
        }
        if (err < 0.03) break;
        // damped: the posture is not linear in the aim, and a full step can jump to another fit
        aim.f1 *= (target.f1 / meas[0]) ** 0.7;
        aim.f2 *= (target.f2 / meas[1]) ** 0.7;
      }
      console.log(`${name} ${ipa}: engine ${got.map(Math.round).join('/')} for ${Math.round(target.f1)}/${Math.round(target.f2)} (${(100 * best).toFixed(1)}% worst)`);
      const row = {};
      for (const k of KEYS) row[k] = Number(fit.posture[m.VOCAL_ARTICULATOR_NAMES.indexOf(k)].toPrecision(6));
      out.vowelTargetsByBody[name][ipa] = row;
      out.tuning[name][ipa] = tuning[name][t.from];
      if (b === 0) out.targets[ipa] = { male: t.f, from: t.from };
    }
  }
  const text = JSON.stringify(out, null, 1) + '\n';
  const target = join(pkg, 'data/vocal/extra-vowels.json');
  if (process.argv.includes('--check')) {
    let old = '';
    try {
      old = readFileSync(target, 'utf8');
    } catch {}
    if (old !== text) {
      console.error('data/vocal/extra-vowels.json is stale: run npm run gen:vowels -w packages/bellows');
      process.exit(1);
    }
    console.log('extra vowels up to date');
  } else {
    writeFileSync(target, text);
    console.log(`extra vowels: ${out.order.length} per body, ratios ${JSON.stringify(out.bodyFormantRatio)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
