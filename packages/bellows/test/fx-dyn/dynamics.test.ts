import { describe, expect, it } from 'vitest';
import { compressorDef, gateDef, limiterDef, transientDef } from '../../src/fx/dynamics';
import type { Effect } from '../../src/types';
import { dbToGain } from '../../src/types';
import { rng } from '../../src/core/prng';
import { db, maxAbs, processBlocks, rms, sineBuf, squareBuf } from './helpers';

const SR = 44100;

describe('compressor', () => {
  it('has a well formed EffectDef', () => {
    expect(compressorDef.id).toBe('compressor');
    const names = compressorDef.params.map((p) => p.name);
    for (const n of [
      'threshold',
      'ratio',
      'knee',
      'attack',
      'release',
      'makeup',
      'lookahead',
      'mix',
    ]) {
      expect(names).toContain(n);
    }
    for (const p of compressorDef.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });

  it('reduces a 6 dB over-threshold sine to about 1.5 dB over at ratio 4', () => {
    const fx = compressorDef.create(SR, {
      threshold: -18,
      ratio: 4,
      knee: 0,
      attack: 0.002,
      release: 0.2,
      makeup: 0,
      lookahead: 0,
      mix: 1,
    });
    const n = Math.floor(SR * 1.5);
    const l = sineBuf(n, 220, SR, dbToGain(-12));
    const r = sineBuf(n, 220, SR, dbToGain(-12));
    processBlocks(fx, l, r);
    const peakDb = db(maxAbs(l, n - Math.floor(0.2 * SR), n));
    // Expected output level: threshold + 6 / ratio = -16.5 dBFS.
    expect(peakDb).toBeGreaterThan(-17.5);
    expect(peakDb).toBeLessThan(-15.5);
  });

  it('soft knee compresses an at-threshold signal that a hard knee ignores', () => {
    const run = (knee: number): number => {
      const fx = compressorDef.create(SR, {
        threshold: -18,
        ratio: 4,
        knee,
        attack: 0.002,
        release: 0.2,
        makeup: 0,
        lookahead: 0,
        mix: 1,
      });
      const n = SR;
      const l = sineBuf(n, 220, SR, dbToGain(-18));
      const r = sineBuf(n, 220, SR, dbToGain(-18));
      processBlocks(fx, l, r);
      return db(maxAbs(l, n - Math.floor(0.2 * SR), n));
    };
    const hard = run(0);
    const soft = run(12);
    // Quadratic knee at threshold: (1/4 - 1) * 6^2 / 24 = -1.125 dB.
    const diff = hard - soft;
    expect(diff).toBeGreaterThan(0.5);
    expect(diff).toBeLessThan(1.8);
  });

  it('auto makeup (-1) raises the output by half the max static reduction', () => {
    const run = (makeup: number): number => {
      const fx = compressorDef.create(SR, {
        threshold: -18,
        ratio: 4,
        knee: 0,
        attack: 0.002,
        release: 0.2,
        makeup,
        lookahead: 0,
        mix: 1,
      });
      const n = SR;
      const l = sineBuf(n, 220, SR, dbToGain(-12));
      const r = sineBuf(n, 220, SR, dbToGain(-12));
      processBlocks(fx, l, r);
      return db(maxAbs(l, n - Math.floor(0.2 * SR), n));
    };
    // Half of (1 - 1/4) * 18 = 6.75 dB of auto makeup.
    const gain = run(-1) - run(0);
    expect(gain).toBeGreaterThan(5.75);
    expect(gain).toBeLessThan(7.75);
  });

  it('attack time controls how fast gain comes down after a step', () => {
    const run = (attack: number): number => {
      const fx = compressorDef.create(SR, {
        threshold: -18,
        ratio: 4,
        knee: 0,
        attack,
        release: 0.2,
        makeup: 0,
        lookahead: 0,
        mix: 1,
      });
      const step = Math.floor(0.3 * SR);
      const n = step + Math.floor(0.2 * SR);
      const l = sineBuf(n, 1000, SR, 1);
      for (let i = 0; i < n; i++) l[i] *= i < step ? dbToGain(-30) : dbToGain(-6);
      const r = l.slice();
      processBlocks(fx, l, r);
      const w0 = step + Math.floor(0.0015 * SR);
      const w1 = step + Math.floor(0.0045 * SR);
      return db(maxAbs(l, w0, w1));
    };
    const fast = run(0.0005);
    const slow = run(0.05);
    expect(fast).toBeLessThan(slow - 3);
  });

  it('release time controls how fast gain recovers after a drop', () => {
    const run = (release: number): number => {
      const fx = compressorDef.create(SR, {
        threshold: -18,
        ratio: 4,
        knee: 0,
        attack: 0.002,
        release,
        makeup: 0,
        lookahead: 0,
        mix: 1,
      });
      const drop = Math.floor(0.5 * SR);
      const n = drop + Math.floor(0.2 * SR);
      const l = sineBuf(n, 1000, SR, 1);
      for (let i = 0; i < n; i++) l[i] *= i < drop ? dbToGain(-6) : dbToGain(-30);
      const r = l.slice();
      processBlocks(fx, l, r);
      const w0 = drop + Math.floor(0.04 * SR);
      const w1 = drop + Math.floor(0.06 * SR);
      return maxAbs(l, w0, w1);
    };
    const fast = run(0.02);
    const slow = run(0.5);
    expect(fast).toBeGreaterThan(slow * 1.3);
  });

  it('lookahead catches a step transient that non-lookahead overshoots', () => {
    const run = (lookahead: number): { peak: number; settled: number } => {
      const fx = compressorDef.create(SR, {
        threshold: -24,
        ratio: 4,
        knee: 0,
        attack: 0.001,
        release: 0.1,
        makeup: 0,
        lookahead,
        mix: 1,
      });
      const onset = Math.floor(0.3 * SR);
      const n = SR;
      const l = new Float32Array(n);
      const w0 = (2 * Math.PI * 500) / SR;
      for (let i = onset; i < n; i++) l[i] = dbToGain(-6) * Math.sin(w0 * (i - onset));
      const r = l.slice();
      processBlocks(fx, l, r);
      return {
        peak: db(maxAbs(l)),
        settled: db(maxAbs(l, n - Math.floor(0.1 * SR), n)),
      };
    };
    const withLook = run(0.01);
    const without = run(0);
    expect(without.peak).toBeGreaterThan(without.settled + 3);
    expect(withLook.peak).toBeLessThan(withLook.settled + 1);
  });

  it('mix 0 with no lookahead passes the input through untouched', () => {
    const fx = compressorDef.create(SR, { mix: 0, lookahead: 0 });
    const n = 8192;
    const l = sineBuf(n, 330, SR, 0.9);
    const r = sineBuf(n, 331, SR, 0.9);
    const lRef = l.slice();
    const rRef = r.slice();
    processBlocks(fx, l, r);
    for (let i = 0; i < n; i += 7) {
      expect(l[i]).toBe(lRef[i]);
      expect(r[i]).toBe(rRef[i]);
    }
  });
});

describe('limiter', () => {
  const buildBursts = (): Float32Array => {
    const noise = rng('fx-dyn/limiter-noise');
    const n = SR;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const inBurst =
        (i > 0.05 * SR && i < 0.25 * SR) ||
        (i > 0.4 * SR && i < 0.55 * SR) ||
        (i > 0.7 * SR && i < 0.9 * SR);
      if (inBurst) x[i] = (noise() * 2 - 1) * 2;
    }
    return x;
  };

  it('never exceeds ceiling + 0.1 dB on white noise bursts', () => {
    for (const truePeak of [0, 1]) {
      const fx = limiterDef.create(SR, { ceiling: -1, release: 0.05, truePeak });
      const l = buildBursts();
      const r = buildBursts();
      processBlocks(fx, l, r);
      const limit = dbToGain(-1 + 0.1);
      expect(maxAbs(l)).toBeLessThanOrEqual(limit);
      expect(maxAbs(r)).toBeLessThanOrEqual(limit);
    }
  });

  it('reports the 5 ms lookahead as latency and passes quiet audio delayed but intact', () => {
    const fx = limiterDef.create(SR, { ceiling: -0.3 }) as Effect & { latency: number };
    expect(fx.latency).toBe(Math.ceil(0.005 * SR));
    const n = 8192;
    const l = sineBuf(n, 440, SR, 0.3);
    const r = sineBuf(n, 440, SR, 0.3);
    const ref = l.slice();
    processBlocks(fx, l, r);
    let maxDiff = 0;
    for (let i = fx.latency; i < n; i++) {
      const d = Math.abs(l[i] - ref[i - fx.latency]);
      if (d > maxDiff) maxDiff = d;
    }
    expect(maxDiff).toBeLessThan(1e-9);
  });

  it('changes gain smoothly, no per-sample jumps', () => {
    const fx = limiterDef.create(SR, { ceiling: -0.3, release: 0.05 }) as Effect & {
      latency: number;
    };
    const n = SR;
    const l = sineBuf(n, 300, SR, 0.9);
    for (let i = Math.floor(0.4 * SR); i < Math.floor(0.5 * SR); i++) l[i] *= 3;
    const ref = l.slice();
    const r = l.slice();
    processBlocks(fx, l, r);
    const lat = fx.latency;
    let prev = Number.NaN;
    let maxJump = 0;
    for (let i = lat; i < n; i++) {
      const x = ref[i - lat];
      if (Math.abs(x) < 0.25) {
        prev = Number.NaN;
        continue;
      }
      const g = l[i] / x;
      if (!Number.isNaN(prev)) {
        const jump = Math.abs(g - prev);
        if (jump > maxJump) maxJump = jump;
      }
      prev = g;
    }
    expect(maxJump).toBeLessThan(0.02);
  });

  it('true-peak mode catches inter-sample overs that sample peaks miss', () => {
    // fs/4 sine at phase pi/4: samples sit at 0.707 of the true peak,
    // so a 1.2 amplitude reads 0.849 in the sample domain, under the
    // -0.3 dB ceiling. Only the oversampled detector sees the over.
    const build = (): Float32Array => sineBuf(SR / 2, SR / 4, SR, 1.2, Math.PI / 4);
    const spFx = limiterDef.create(SR, { ceiling: -0.3, release: 0.05, truePeak: 0 });
    const l0 = build();
    const r0 = build();
    processBlocks(spFx, l0, r0);
    const tpFx = limiterDef.create(SR, { ceiling: -0.3, release: 0.05, truePeak: 1 });
    const l1 = build();
    const r1 = build();
    processBlocks(tpFx, l1, r1);
    const sp = maxAbs(l0, Math.floor(0.1 * SR), l0.length);
    const tp = maxAbs(l1, Math.floor(0.1 * SR), l1.length);
    expect(sp).toBeGreaterThan(0.84);
    expect(tp).toBeLessThan(sp - 0.05);
  });

  it('is deterministic', () => {
    const run = (): Float32Array => {
      const fx = limiterDef.create(SR, { ceiling: -1, release: 0.02, truePeak: 1 });
      const l = buildBursts().subarray(0, 16384).slice();
      const r = l.slice();
      processBlocks(fx, l, r);
      return l;
    };
    expect(run()).toEqual(run());
  });
});

describe('gate', () => {
  it('has a well formed EffectDef', () => {
    expect(gateDef.id).toBe('gate');
    const names = gateDef.params.map((p) => p.name);
    for (const n of ['threshold', 'attack', 'hold', 'release', 'range']) {
      expect(names).toContain(n);
    }
  });

  it('opens on loud material, holds, then closes to the range floor', () => {
    const fx = gateDef.create(SR, {
      threshold: -40,
      attack: 0.001,
      hold: 0.02,
      release: 0.01,
      range: -60,
    });
    const t0 = Math.floor(0.15 * SR); // loud start
    const t1 = Math.floor(0.35 * SR); // loud end
    const n = Math.floor(0.75 * SR);
    const l = sineBuf(n, 1000, SR, 1);
    for (let i = 0; i < n; i++) {
      l[i] *= i >= t0 && i < t1 ? dbToGain(-20) : dbToGain(-50);
    }
    const ref = l.slice();
    const r = l.slice();
    processBlocks(fx, l, r);

    const ratio = (from: number, to: number): number => rms(l, from, to) / rms(ref, from, to);
    // Closed before the loud section: attenuated near the -60 dB floor.
    expect(ratio(Math.floor(0.05 * SR), Math.floor(0.14 * SR))).toBeLessThan(0.01);
    // Open through the loud section.
    expect(ratio(t0 + Math.floor(0.01 * SR), t1 - Math.floor(0.01 * SR))).toBeGreaterThan(0.7);
    // Hold keeps it open just after the level drops.
    expect(ratio(t1 + Math.floor(0.002 * SR), t1 + Math.floor(0.012 * SR))).toBeGreaterThan(0.5);
    // Closed again once hold and release have run out.
    expect(ratio(t1 + Math.floor(0.08 * SR), t1 + Math.floor(0.1 * SR))).toBeLessThan(0.1);
  });

  it('hysteresis: a level between close and open thresholds keeps the current state', () => {
    // Square waves have a constant rectified level, so the detector sits
    // exactly at the signal level: -41.5 dB lands between the -43 dB
    // close threshold and the -40 dB open threshold.
    const mid = dbToGain(-41.5);
    const params = {
      threshold: -40,
      attack: 0.001,
      hold: 0.05,
      release: 0.01,
      range: -80,
    };

    // Starting closed: the in-between level never opens the gate.
    const a = gateDef.create(SR, params);
    const nA = Math.floor(0.3 * SR);
    const lA = squareBuf(nA, 2000, SR, mid);
    const rA = lA.slice();
    const refA = lA.slice();
    processBlocks(a, lA, rA);
    expect(rms(lA, nA >> 1, nA) / rms(refA, nA >> 1, nA)).toBeLessThan(0.01);

    // Starting open (after a loud lead-in): the same level keeps it open.
    const b = gateDef.create(SR, params);
    const loud = Math.floor(0.1 * SR);
    const nB = Math.floor(0.5 * SR);
    const lB = squareBuf(nB, 2000, SR, 1);
    for (let i = 0; i < nB; i++) lB[i] *= i < loud ? dbToGain(-20) : mid;
    const rB = lB.slice();
    const refB = lB.slice();
    processBlocks(b, lB, rB);
    const tail = nB - Math.floor(0.1 * SR);
    expect(rms(lB, tail, nB) / rms(refB, tail, nB)).toBeGreaterThan(0.7);
  });
});

describe('transient shaper', () => {
  const buildPluck = (): { buf: Float32Array; onset: number } => {
    const onset = 500;
    const n = Math.floor(0.4 * SR);
    const buf = new Float32Array(n);
    const w0 = (2 * Math.PI * 300) / SR;
    const tau = 0.05 * SR;
    for (let i = onset; i < n; i++) {
      const t = i - onset;
      buf[i] = 0.7 * Math.sin(w0 * t) * Math.exp(-t / tau);
    }
    return { buf, onset };
  };

  const peakRatio = (buf: Float32Array, onset: number): number => {
    const onsetPeak = maxAbs(buf, onset, onset + Math.floor(0.005 * SR));
    const tailPeak = maxAbs(buf, onset + Math.floor(0.15 * SR), onset + Math.floor(0.2 * SR));
    return onsetPeak / tailPeak;
  };

  it('attack boost raises the onset peak relative to the tail', () => {
    const { buf, onset } = buildPluck();
    const fx = transientDef.create(SR, { attack: 1, sustain: 0 });
    const l = buf.slice();
    const r = buf.slice();
    processBlocks(fx, l, r);
    expect(peakRatio(l, onset)).toBeGreaterThan(peakRatio(buf, onset) * 1.3);
  });

  it('sustain boost raises the tail relative to the onset', () => {
    const { buf, onset } = buildPluck();
    const fx = transientDef.create(SR, { attack: 0, sustain: 1 });
    const l = buf.slice();
    const r = buf.slice();
    processBlocks(fx, l, r);
    expect(peakRatio(l, onset)).toBeLessThan(peakRatio(buf, onset) / 1.3);
  });

  it('passes audio through untouched at 0 attack and 0 sustain', () => {
    const { buf } = buildPluck();
    const fx = transientDef.create(SR, { attack: 0, sustain: 0 });
    const l = buf.slice();
    const r = buf.slice();
    processBlocks(fx, l, r);
    for (let i = 0; i < buf.length; i += 11) {
      expect(l[i]).toBe(buf[i]);
      expect(r[i]).toBe(buf[i]);
    }
  });
});
