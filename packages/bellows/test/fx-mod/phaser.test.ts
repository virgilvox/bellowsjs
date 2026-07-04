import { describe, expect, it } from 'vitest';
import { phaserDef } from '../../src/fx/modfx';
import { rng } from '../../src/core/prng';
import { allFinite, irMag, maxAbs, maxAbsDiff, processBlocks, sineBuf } from './helpers';
import type { Effect } from '../../src/types';

const SR = 48000;

function runSilence(fx: Effect, samples: number): void {
  const l = new Float32Array(4096);
  const r = new Float32Array(4096);
  let left = samples;
  while (left > 0) {
    const n = Math.min(left, 4096);
    l.fill(0);
    r.fill(0);
    fx.process(l, r, 0, n);
    left -= n;
  }
}

/** Capture an impulse response from the effect's current state. */
function captureIr(fx: Effect, n: number): Float32Array {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  l[0] = 1;
  r[0] = 1;
  fx.process(l, r, 0, n);
  return l;
}

interface Response {
  freqs: number[];
  mags: number[];
}

function measure(h: Float32Array): Response {
  const freqs: number[] = [];
  const mags: number[] = [];
  const lo = 60;
  const hi = 10000;
  const points = 160;
  for (let k = 0; k < points; k++) {
    const f = lo * Math.pow(hi / lo, k / (points - 1));
    freqs.push(f);
    mags.push(irMag(h, f, SR));
  }
  return { freqs, mags };
}

function deepestDip(resp: Response): { freq: number; mag: number; max: number } {
  let max = 0;
  for (const m of resp.mags) if (m > max) max = m;
  let minIdx = 0;
  for (let i = 1; i < resp.mags.length; i++) {
    if (resp.mags[i] < resp.mags[minIdx]) minIdx = i;
  }
  return { freq: resp.freqs[minIdx], mag: resp.mags[minIdx], max };
}

describe('phaser', () => {
  it('has a well formed EffectDef', () => {
    expect(phaserDef.id).toBe('phaser');
    const names = phaserDef.params.map((p) => p.name);
    for (const n of ['rate', 'freqlo', 'freqhi', 'feedback', 'stages', 'spread', 'mix']) {
      expect(names).toContain(n);
    }
    for (const p of phaserDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('passes dry through exactly at mix 0', () => {
    const fx = phaserDef.create(SR, { mix: 0 });
    const l = sineBuf(4096, 440, SR);
    const r = sineBuf(4096, 700, SR);
    const refL = l.slice();
    const refR = r.slice();
    processBlocks(fx, l, r);
    expect(maxAbsDiff(l, refL)).toBe(0);
    expect(maxAbsDiff(r, refR)).toBe(0);
  });

  it('has notches that move with the lfo phase', () => {
    const fx = phaserDef.create(SR, {
      rate: 0.25,
      spread: 0,
      mix: 0.5,
      feedback: 0.3,
      stages: 6,
      freqlo: 300,
      freqhi: 3000,
    });

    // rate 0.25 Hz: one second of silence parks the sine lfo at its peak,
    // so the sweep center sits at freqHi for the first capture.
    runSilence(fx, SR);
    const respHigh = measure(captureIr(fx, 4096));

    // advance to lfo phase 0.75 (trough): center at freqLo
    runSilence(fx, 3 * SR - (SR + 4096));
    const respLow = measure(captureIr(fx, 4096));

    const dipHigh = deepestDip(respHigh);
    const dipLow = deepestDip(respLow);

    // notches exist: deepest dip at least 10 dB below the response max
    expect(dipHigh.mag).toBeLessThan(dipHigh.max * 0.3);
    expect(dipLow.mag).toBeLessThan(dipLow.max * 0.3);

    // and they moved: the sweep center dropped by a factor of ten, so the
    // deepest notch frequency must drop substantially too
    expect(dipHigh.freq / dipLow.freq).toBeGreaterThan(2);
  });

  it('stereo spread decorrelates the channels', () => {
    const x = sineBuf(SR, 800, SR);
    const fx = phaserDef.create(SR, { rate: 1, spread: 0.25, mix: 0.5, feedback: 0.3 });
    const l = x.slice();
    const r = x.slice();
    processBlocks(fx, l, r);
    expect(maxAbsDiff(l, r)).toBeGreaterThan(0.05);
  });

  it('stages setting changes the response', () => {
    const x = sineBuf(8192, 1200, SR);
    const a = phaserDef.create(SR, { rate: 0.2, stages: 4, mix: 0.5 });
    const la = x.slice();
    const ra = x.slice();
    processBlocks(a, la, ra);

    const b = phaserDef.create(SR, { rate: 0.2, stages: 8, mix: 0.5 });
    const lb = x.slice();
    const rb = x.slice();
    processBlocks(b, lb, rb);

    expect(maxAbsDiff(la, lb)).toBeGreaterThan(0.01);
  });

  it('stays bounded and finite at feedback 0.9', () => {
    const fx = phaserDef.create(SR, { rate: 2, feedback: 0.9, mix: 0.5 });
    const noise = rng('phaser/fb');
    const l = new Float32Array(SR);
    const r = new Float32Array(SR);
    for (let i = 0; i < l.length; i++) {
      l[i] = 2 * noise() - 1;
      r[i] = 2 * noise() - 1;
    }
    processBlocks(fx, l, r);
    expect(allFinite(l)).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(maxAbs(l)).toBeLessThan(30);
    expect(maxAbs(r)).toBeLessThan(30);
  });
});
