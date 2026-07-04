import { describe, expect, it } from 'vitest';
import {
  pitchshiftDef,
  freezeDef,
  blurDef,
  robotDef,
  whisperDef,
  denoiseDef,
  spectralEffects,
} from '../../src/fx/spectral';
import { rng } from '../../src/core/prng';
import { sine, rms, maxAbs, dominantFreq, bandFraction, runFx } from './helpers';

const SR = 44100;

describe('effect definitions', () => {
  it('expose the six spectral ids with param specs', () => {
    const ids = spectralEffects.map((d) => d.id);
    expect(ids).toEqual(['pitchshift', 'freeze', 'blur', 'robot', 'whisper', 'denoise']);
    for (const def of spectralEffects) {
      expect(def.params.length).toBeGreaterThan(0);
      for (const p of def.params) {
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
      // Creating with no params must work and produce silence from silence.
      const fx = def.create(SR, {});
      const l = new Float32Array(4096);
      const r = new Float32Array(4096);
      runFx(fx, l, r);
      expect(maxAbs(l)).toBeLessThan(1e-6);
      expect(maxAbs(r)).toBeLessThan(1e-6);
    }
  });
});

describe('pitchshift', () => {
  it('moves a 440 Hz sine up an octave within one percent', () => {
    const fx = pitchshiftDef.create(SR, { semitones: 12, mix: 1 });
    const l = sine(440, SR, SR, 0.8);
    const r = l.slice();
    runFx(fx, l, r);
    const f = dominantFreq(l, SR, SR - 16384, SR);
    expect(Math.abs(f - 880) / 880).toBeLessThan(0.01);
    const fr = dominantFreq(r, SR, SR - 16384, SR);
    expect(Math.abs(fr - 880) / 880).toBeLessThan(0.01);
    expect(maxAbs(l)).toBeLessThan(4);
    expect(maxAbs(r)).toBeLessThan(4);
    // The shifted tone should carry real energy, not just survive.
    expect(rms(l, SR / 2, SR)).toBeGreaterThan(0.1);
  });

  it('moves a 440 Hz sine down an octave', () => {
    const fx = pitchshiftDef.create(SR, { semitones: -12, mix: 1 });
    const l = sine(440, SR, SR, 0.8);
    const r = l.slice();
    runFx(fx, l, r);
    const f = dominantFreq(l, SR, SR - 16384, SR);
    expect(Math.abs(f - 220) / 220).toBeLessThan(0.015);
    expect(maxAbs(l)).toBeLessThan(4);
  });

  it('passes signal through near-unchanged at zero semitones', () => {
    const fx = pitchshiftDef.create(SR, { semitones: 0, mix: 1 });
    const l = sine(440, SR, SR / 2, 0.8);
    const r = l.slice();
    runFx(fx, l, r);
    const f = dominantFreq(l, SR, l.length - 8192, l.length);
    expect(Math.abs(f - 440) / 440).toBeLessThan(0.01);
    expect(rms(l, 8192, l.length)).toBeGreaterThan(0.3);
  });

  it('assigns each bin to exactly one peak region (no boundary double-add)', () => {
    // Two peaks at bins 4 and 8 put a region boundary at bin 6. On the
    // first frame with all-zero phases every region rotation is zero, so
    // the frame must return its input unchanged; a bin shared by both
    // regions would come back with doubled energy.
    const fx = pitchshiftDef.create(SR, { semitones: 0, mix: 1 }) as unknown as {
      bins: number;
      frame(re: Float32Array, im: Float32Array, ch: number): void;
    };
    const nb = fx.bins;
    const re = new Float32Array(nb);
    const im = new Float32Array(nb);
    re[4] = 1;
    re[8] = 1;
    re[6] = 0.5;
    fx.frame(re, im, 0);
    expect(re[4]).toBeCloseTo(1, 6);
    expect(re[8]).toBeCloseTo(1, 6);
    expect(re[6]).toBeCloseTo(0.5, 6);
  });

  it('mix 0 returns the dry signal delayed by the processor latency', () => {
    const fx = pitchshiftDef.create(SR, { semitones: 12, mix: 0 });
    const input = sine(440, SR, SR / 2, 0.8);
    const l = input.slice();
    const r = input.slice();
    runFx(fx, l, r);
    let worst = 0;
    for (let i = 4096; i < l.length; i++) {
      worst = Math.max(worst, Math.abs(l[i] - input[i - 2048]));
    }
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('freeze', () => {
  it('sustains the captured spectrum through silence', () => {
    const fx = freezeDef.create(SR, { freeze: 0, mix: 1 });
    const len = SR; // 0.5 s tone, then 0.5 s silence
    const l = new Float32Array(len);
    const r = new Float32Array(len);
    const tone = sine(440, SR, SR / 2, 0.5);
    l.set(tone, 0);
    r.set(tone, 0);
    // Feed the tone, engage freeze shortly before it ends.
    fx.process(l, r, 0, 20000);
    fx.setParam('freeze', 1);
    fx.process(l, r, 20000, len);
    // Well into the silent region the output still rings at 440.
    const tailFrom = Math.floor(SR * 0.8);
    expect(rms(l, tailFrom, len)).toBeGreaterThan(0.1);
    const f = dominantFreq(l, SR, tailFrom, len);
    expect(Math.abs(f - 440) / 440).toBeLessThan(0.02);
    expect(maxAbs(l)).toBeLessThan(2);
  });

  it('passes through while freeze is off', () => {
    const fx = freezeDef.create(SR, { freeze: 0, mix: 1 });
    const input = sine(440, SR, SR / 2, 0.5);
    const l = input.slice();
    const r = input.slice();
    runFx(fx, l, r);
    let worst = 0;
    for (let i = 8192; i < l.length; i++) {
      worst = Math.max(worst, Math.abs(l[i] - input[i - 2048]));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('is deterministic', () => {
    const render = (): Float32Array => {
      const fx = freezeDef.create(SR, { freeze: 0, mix: 1 });
      const l = sine(330, SR, 22050, 0.5);
      const r = l.slice();
      fx.process(l, r, 0, 11025);
      fx.setParam('freeze', 1);
      fx.process(l, r, 11025, 22050);
      return l;
    };
    expect(Array.from(render())).toEqual(Array.from(render()));
  });
});

describe('blur', () => {
  it('is deterministic for a fixed seed and differs across seeds', () => {
    const render = (seed: number): Float32Array => {
      const fx = blurDef.create(SR, { amount: 0.5, mix: 1, seed });
      const l = sine(440, SR, 16384, 0.5);
      const r = l.slice();
      runFx(fx, l, r);
      return l;
    };
    const a = render(7);
    const b = render(7);
    const c = render(8);
    expect(Array.from(a)).toEqual(Array.from(b));
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - c[i]));
    expect(diff).toBeGreaterThan(1e-3);
  });

  it('smears energy past the end of the input', () => {
    const fx = blurDef.create(SR, { amount: 1, mix: 1, seed: 3 });
    const len = SR;
    const l = new Float32Array(len);
    const r = new Float32Array(len);
    const tone = sine(440, SR, SR / 2, 0.6);
    l.set(tone, 0);
    r.set(tone, 0);
    runFx(fx, l, r);
    // 0.2 s after the tone stops, the averaged magnitudes still sound.
    const from = Math.floor(SR * 0.6);
    const to = Math.floor(SR * 0.75);
    expect(rms(l, from, to)).toBeGreaterThan(0.02);
    expect(maxAbs(l)).toBeLessThan(4);
  });
});

describe('robot', () => {
  it('quantizes pitch to a harmonic of the hop rate', () => {
    const fx = robotDef.create(SR, { mix: 1 });
    const l = sine(300, SR, SR / 2, 0.7);
    const r = l.slice();
    runFx(fx, l, r);
    expect(rms(l, 8192, l.length)).toBeGreaterThan(0.05);
    const f = dominantFreq(l, SR, l.length - 16384, l.length);
    // Zero phase every frame makes the output periodic at sr/hop = 172.27 Hz.
    const hopRate = SR / 256;
    const mult = f / hopRate;
    expect(Math.abs(mult - Math.round(mult))).toBeLessThan(0.05);
    expect(maxAbs(l)).toBeLessThan(4);
  });

  it('is deterministic (no stochastic state)', () => {
    const render = (): Float32Array => {
      const fx = robotDef.create(SR, {});
      const l = sine(250, SR, 8192, 0.5);
      const r = l.slice();
      runFx(fx, l, r);
      return l;
    };
    expect(Array.from(render())).toEqual(Array.from(render()));
  });
});

describe('whisper', () => {
  it('keeps energy near the input band while destroying phase', () => {
    const fx = whisperDef.create(SR, { mix: 1, seed: 5 });
    const l = sine(440, SR, SR / 2, 0.7);
    const r = l.slice();
    runFx(fx, l, r);
    expect(rms(l, 8192, l.length)).toBeGreaterThan(0.05);
    // Magnitudes are preserved per frame, so energy stays around 440,
    // broadened by the frame-rate phase scrambling.
    expect(bandFraction(l, SR, 200, 800, l.length - 16384, l.length)).toBeGreaterThan(0.5);
    expect(maxAbs(l)).toBeLessThan(4);
  });

  it('is deterministic for a fixed seed and differs across seeds', () => {
    const render = (seed: number): Float32Array => {
      const fx = whisperDef.create(SR, { mix: 1, seed });
      const l = sine(440, SR, 12288, 0.5);
      const r = l.slice();
      runFx(fx, l, r);
      return l;
    };
    const a = render(11);
    expect(Array.from(a)).toEqual(Array.from(render(11)));
    let diff = 0;
    const c = render(12);
    for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - c[i]));
    expect(diff).toBeGreaterThan(1e-3);
  });
});

describe('denoise', () => {
  it('gates broadband noise while keeping a tone that enters later', () => {
    const noise = rng('test/denoise');
    const len = SR * 2;
    const l = new Float32Array(len);
    for (let i = 0; i < len; i++) l[i] = (noise() * 2 - 1) * 0.05;
    const inputNoiseRms = rms(l, 0, SR);
    // Tone enters at 1 s on top of the noise.
    const w = (2 * Math.PI * 440) / SR;
    for (let i = SR; i < len; i++) l[i] += 0.3 * Math.sin(w * i);
    const r = l.slice();
    const fx = denoiseDef.create(SR, { amount: 2, mix: 1 });
    runFx(fx, l, r);
    // Noise-only region after the floor has adapted: strongly attenuated.
    const outNoise = rms(l, Math.floor(SR * 0.6), Math.floor(SR * 0.95));
    expect(outNoise).toBeLessThan(0.5 * inputNoiseRms);
    // The tone survives: dominant frequency intact and level near input.
    const f = dominantFreq(l, SR, len - 16384, len);
    expect(Math.abs(f - 440) / 440).toBeLessThan(0.01);
    expect(rms(l, Math.floor(SR * 1.5), len)).toBeGreaterThan(0.12);
  });

  it('leaves a clean signal essentially untouched at amount 0', () => {
    const fx = denoiseDef.create(SR, { amount: 0, mix: 1 });
    const input = sine(440, SR, SR / 2, 0.5);
    const l = input.slice();
    const r = input.slice();
    runFx(fx, l, r);
    let worst = 0;
    for (let i = 8192; i < l.length; i++) {
      worst = Math.max(worst, Math.abs(l[i] - input[i - 2048]));
    }
    expect(worst).toBeLessThan(0.02);
  });
});

describe('reset', () => {
  it('every effect renders identically after reset', () => {
    const input = sine(392, SR, 12288, 0.5);
    for (const def of spectralEffects) {
      const fx = def.create(SR, { seed: 2 });
      const a = input.slice();
      const ar = input.slice();
      runFx(fx, a, ar);
      fx.reset();
      // Stochastic effects keep their rng position; only structural
      // state must clear. Reseed to realign the stream.
      fx.setParam('seed', 2);
      const b = input.slice();
      const br = input.slice();
      runFx(fx, b, br);
      expect(Array.from(b), def.id).toEqual(Array.from(a));
    }
  });
});
