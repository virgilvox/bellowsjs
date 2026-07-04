import { describe, expect, it } from 'vitest';
import { saturatorDef } from '../../src/fx/saturator';
import type { Effect } from '../../src/types';
import { RealFft } from '../../src/dsp/fft';
import { tanhShape } from '../../src/dsp/waveshaper';
import { rng } from '../../src/core/prng';
import { allFinite, db, maxAbs, processBlocks, sineBuf, toneMag } from './helpers';

const SR = 44100;
const N = 8192;
const BIN = 560;
const F0 = (BIN * SR) / N; // exactly bin-aligned, about 3015 Hz

/**
 * Split the spectrum of the last N samples into energy at the harmonic
 * bins of F0 (below Nyquist) and energy everywhere else. Aliased
 * harmonics land on non-harmonic bins because F0 is bin-exact.
 */
function aliasRatio(buf: Float32Array): number {
  const fft = new RealFft(N);
  const input = buf.slice(buf.length - N);
  const re = new Float32Array(N / 2 + 1);
  const im = new Float32Array(N / 2 + 1);
  fft.forward(input, re, im);
  const harmonic = new Set<number>();
  for (let m = 1; m * BIN <= N / 2; m++) {
    for (let d = -3; d <= 3; d++) harmonic.add(m * BIN + d);
  }
  let harmEnergy = 0;
  let aliasEnergy = 0;
  for (let k = 3; k <= N / 2; k++) {
    const e = re[k] * re[k] + im[k] * im[k];
    if (harmonic.has(k)) harmEnergy += e;
    else aliasEnergy += e;
  }
  return aliasEnergy / harmEnergy;
}

describe('saturator', () => {
  it('has a well formed EffectDef', () => {
    expect(saturatorDef.id).toBe('saturator');
    const names = saturatorDef.params.map((p) => p.name);
    for (const n of ['drive', 'curve', 'tone', 'output', 'mix']) {
      expect(names).toContain(n);
    }
    for (const p of saturatorDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('aliases far less than a naive non-oversampled waveshaper at high drive', () => {
    const drive = 8;
    const n = N * 3;
    const x = sineBuf(n, F0, SR, 0.85);

    // Naive reference: the same curve applied at the base rate.
    const naive = new Float32Array(n);
    for (let i = 0; i < n; i++) naive[i] = tanhShape(x[i], drive);

    const fx = saturatorDef.create(SR, { drive, curve: 0, tone: 0, output: 0, mix: 1 });
    const l = x.slice();
    const r = x.slice();
    processBlocks(fx, l, r);

    const naiveRatio = aliasRatio(naive);
    const fxRatio = aliasRatio(l);
    const improvementDb = 10 * Math.log10(naiveRatio / fxRatio);
    expect(improvementDb).toBeGreaterThan(12);
    // The oversampled path keeps aliasing at least 30 dB under the harmonics.
    expect(10 * Math.log10(fxRatio)).toBeLessThan(-30);
  });

  it('reports the oversampler round trip as latency and delays an impulse by it', () => {
    const fx = saturatorDef.create(SR, { drive: 0.1, curve: 0, mix: 1 }) as Effect & {
      latency: number;
    };
    expect(fx.latency).toBe(24);
    const n = 512;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    l[200] = 1;
    r[200] = 1;
    processBlocks(fx, l, r);
    let peakAt = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(l[i]) > peak) {
        peak = Math.abs(l[i]);
        peakAt = i;
      }
    }
    expect(peakAt).toBe(200 + fx.latency);
  });

  it('is close to transparent at minimum drive', () => {
    const fx = saturatorDef.create(SR, { drive: 0.1, curve: 0, tone: 0, output: 0, mix: 1 });
    const n = 16384;
    const l = sineBuf(n, 1000, SR, 0.5);
    const r = sineBuf(n, 1000, SR, 0.5);
    processBlocks(fx, l, r);
    const mag = toneMag(l, 4096, 8192, 1000, SR);
    expect(Math.abs(db(mag / 0.5))).toBeLessThan(0.5);
  });

  it('tone tilts highs against lows', () => {
    const tilt = (tone: number): number => {
      const fx = saturatorDef.create(SR, { drive: 0.1, curve: 0, tone, output: 0, mix: 1 });
      const n = 32768;
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      const wLo = (2 * Math.PI * 150) / SR;
      const wHi = (2 * Math.PI * 6000) / SR;
      for (let i = 0; i < n; i++) {
        l[i] = 0.25 * (Math.sin(wLo * i) + Math.sin(wHi * i));
        r[i] = l[i];
      }
      processBlocks(fx, l, r);
      const lo = toneMag(l, 8192, 16384, 150, SR);
      const hi = toneMag(l, 8192, 16384, 6000, SR);
      return db(hi / lo);
    };
    expect(tilt(1) - tilt(0)).toBeGreaterThan(8);
    expect(tilt(-1) - tilt(0)).toBeLessThan(-8);
  });

  it('mix 0 outputs the dry signal delayed by the wet-path latency', () => {
    const fx = saturatorDef.create(SR, { drive: 10, curve: 2, mix: 0 }) as Effect & {
      latency: number;
    };
    const n = 4096;
    const l = sineBuf(n, 700, SR, 0.8);
    const r = sineBuf(n, 701, SR, 0.8);
    const lRef = l.slice();
    processBlocks(fx, l, r);
    for (let i = fx.latency; i < n; i += 5) {
      expect(Math.abs(l[i] - lRef[i - fx.latency])).toBe(0);
    }
  });

  it('every curve stays finite and bounded at high drive', () => {
    const noise = rng('fx-dyn/sat-noise');
    const base = new Float32Array(8192);
    for (let i = 0; i < base.length; i++) base[i] = noise() * 2 - 1;
    for (const curve of [0, 1, 2, 3]) {
      const fx = saturatorDef.create(SR, { drive: 20, curve, tone: 0.5, output: 0, mix: 1 });
      const l = base.slice();
      const r = base.slice();
      processBlocks(fx, l, r);
      expect(allFinite(l)).toBe(true);
      expect(allFinite(r)).toBe(true);
      expect(maxAbs(l)).toBeLessThan(10);
    }
  });

  it('auto compensation holds a half-scale sine near its input level across drives', () => {
    const level = (drive: number): number => {
      const fx = saturatorDef.create(SR, { drive, curve: 0, tone: 0, output: 0, mix: 1 });
      const n = 16384;
      const l = sineBuf(n, 500, SR, 0.5);
      const r = sineBuf(n, 500, SR, 0.5);
      processBlocks(fx, l, r);
      return db(toneMag(l, 4096, 8192, 500, SR) / 0.5);
    };
    // The fundamental sheds some energy into harmonics, so allow a few dB.
    for (const d of [0.5, 2, 8, 20]) {
      expect(Math.abs(level(d))).toBeLessThan(3);
    }
  });

  it('is deterministic', () => {
    const run = (): Float32Array => {
      const fx = saturatorDef.create(SR, { drive: 6, curve: 3, tone: -0.3, mix: 0.7 });
      const l = sineBuf(8192, 523.25, SR, 0.8);
      const r = sineBuf(8192, 659.25, SR, 0.8);
      processBlocks(fx, l, r);
      return l;
    };
    expect(run()).toEqual(run());
  });
});
