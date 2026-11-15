/*
 * The vowel solver (src/engines/vowel-solver.ts) and the vowels it adds to the voice. The resonance
 * model is checked against a uniform tube's quarter-wave resonances, the search against a target it can
 * reach, and the vowels it solved for other accents against their targets through the real engine.
 */

import { describe, expect, it } from 'vitest';
import { bark, predictFormants, solveVowel, tubeResonances, vowelGeometry } from '../../src/engines/vowel-solver';
import { vocalEngine } from '../../src/engines/vocal';
import { VOCAL_PHONEMES, vocalPhonemeIndex } from '../../src/engines/vocal-phonemes';
import { VOCAL_BODIES, VOCAL_NEUTRAL, VOCAL_TABLE_PHONEMES } from '../../src/engines/vocal-tables.gen';
import { rng } from '../../src/core/prng';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultParams, lpcFormants } from './helpers';

const extra = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../data/vocal/extra-vowels.json'), 'utf8')) as {
  order: string[];
  targets: Record<string, { male: [number, number, number]; from: string }>;
};

/** A held vowel on the male body at 110 Hz, its median F1 and F2 over the steady part. */
function measured(ipa: string): [number, number] {
  const sr = 48000;
  const params = { ...defaultParams(vocalEngine), body: 0, vibratoDepth: 0, drift: 0, roughness: 0 };
  const v = vocalEngine.createVoice(sr, params, rng('vowel-' + ipa));
  for (const [k, val] of Object.entries(params)) v.setParam(k, val);
  v.setParam('phoneme', vocalPhonemeIndex(ipa));
  v.noteOn(110, 0.8);
  const n = sr;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i += 128) v.process(l, r, i, Math.min(n, i + 128));
  const f1: number[] = [];
  const f2: number[] = [];
  for (let t = 0.45; t <= 0.9; t += 0.05) {
    const fm = lpcFormants(l, sr, Math.round(t * sr)).filter((f) => f.f > 200 && f.bw < 500);
    if (fm.length >= 2) {
      f1.push(fm[0].f);
      f2.push(fm[1].f);
    }
  }
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  return [med(f1), med(f2)];
}

describe('the vowel solver', () => {
  it('puts a uniform 17.5 cm tube at its quarter-wave resonances, closed at the glottis and open at the lips', () => {
    // c / 4L = 500 Hz and its odd multiples; the radiating lips' end correction lowers each a little
    const areas = new Array(48).fill(4);
    const lengths = new Array(48).fill(17.5 / 48);
    const f = tubeResonances(areas, lengths);
    for (const [i, ideal] of [500, 1500, 2500].entries()) {
      expect(f[i]).toBeLessThan(ideal * 1.01);
      expect(f[i]).toBeGreaterThan(ideal * 0.9);
    }
  });

  it('reaches a target the geometry can make: a vowel solved from the formants of another returns to them', () => {
    const g = vowelGeometry(0);
    const row = VOCAL_BODIES[0].vowelTargets[VOCAL_TABLE_PHONEMES.indexOf('ɔ')];
    const o = Float64Array.from(VOCAL_NEUTRAL, (n, k) => (row[k] === row[k] ? row[k] : n));
    const [f1, f2] = predictFormants(g, o);
    const fit = solveVowel(g, { f1, f2 }, VOCAL_NEUTRAL);
    expect(Math.abs(bark(fit.formants[0]) - bark(f1))).toBeLessThan(0.15);
    expect(Math.abs(bark(fit.formants[1]) - bark(f2))).toBeLessThan(0.15);
  });
});

describe('the vowels solved for other accents', () => {
  it('are real sounds of the voice, after every older index', () => {
    expect(VOCAL_PHONEMES.slice(42)).toEqual(extra.order);
    for (const v of extra.order) expect(vocalPhonemeIndex(v)).toBeGreaterThanOrEqual(42);
  });

  it('sound at their target formants through the engine: F1 and F2 within 10 percent, male body', () => {
    const misses: string[] = [];
    for (const v of extra.order) {
      const [t1, t2] = extra.targets[v].male;
      const [m1, m2] = measured(v);
      const e1 = Math.abs(m1 / t1 - 1);
      const e2 = Math.abs(m2 / t2 - 1);
      if (!(e1 < 0.1 && e2 < 0.1)) misses.push(`${v}: ${Math.round(m1)}/${Math.round(m2)} for ${t1}/${t2}`);
    }
    expect(misses).toEqual([]);
  });

  it('are distinct from the General American vowel each started from: British LOT is not American /ɑ/', () => {
    const [lot1, lot2] = measured('ɒ');
    const [a1, a2] = measured('ɑ');
    expect(Math.abs(bark(lot2) - bark(a2)) + Math.abs(bark(lot1) - bark(a1))).toBeGreaterThan(1.5);
    const [g1, g2] = measured('ʉ');
    const [u1, u2] = measured('u');
    void g1;
    void u1;
    expect(bark(g2) - bark(u2)).toBeGreaterThan(2);
  });
});
