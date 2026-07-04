import { describe, it, expect } from 'vitest';
import { yin, mpm, YinDetector } from '../../src/analysis/pitch';
import { rng } from '../../src/core/prng';
import { sine, additiveSaw, whiteNoise } from './signals';

const SR = 44100;
const N = 2048;

function relError(measured: number, expected: number): number {
  return Math.abs(measured - expected) / expected;
}

describe('yin', () => {
  it.each([[82.4], [440], [1318.5]])('detects a %f Hz sine within 0.5 percent', (freq) => {
    const buf = sine(freq, SR, N, 0.8);
    const r = yin(buf, SR);
    expect(r).not.toBeNull();
    expect(relError(r!.freq, freq)).toBeLessThan(0.005);
    expect(r!.probability).toBeGreaterThan(0.9);
  });

  it('finds the fundamental of a harmonically rich sawtooth', () => {
    const buf = additiveSaw(220, SR, N, 40, 0.8);
    const r = yin(buf, SR);
    expect(r).not.toBeNull();
    expect(relError(r!.freq, 220)).toBeLessThan(0.005);
  });

  it('returns null for silence', () => {
    const buf = new Float32Array(N);
    expect(yin(buf, SR)).toBeNull();
  });

  it('returns null or low probability for white noise', () => {
    const buf = whiteNoise(N, rng('yin/noise'), 0.8);
    const r = yin(buf, SR);
    if (r !== null) expect(r.probability).toBeLessThan(0.95);
  });

  it('respects a custom threshold', () => {
    const buf = sine(440, SR, N, 0.8);
    // At a normal threshold the true pitch wins.
    const normal = yin(buf, SR, 0.01);
    expect(normal).not.toBeNull();
    expect(relError(normal!.freq, 440)).toBeLessThan(0.005);
    // At an absurdly strict threshold the first crossing may only happen
    // at an integer period multiple (a subharmonic), or not at all. Both
    // are valid YIN outcomes; a non-integer ratio would be a bug.
    const strict = yin(buf, SR, 0.0001);
    if (strict !== null) {
      const ratio = 440 / strict.freq;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(0.01);
    }
  });
});

describe('mpm', () => {
  it.each([[82.4], [440], [1318.5]])('detects a %f Hz sine within 0.5 percent', (freq) => {
    const buf = sine(freq, SR, N, 0.8);
    const r = mpm(buf, SR);
    expect(r).not.toBeNull();
    expect(relError(r!.freq, freq)).toBeLessThan(0.005);
    expect(r!.clarity).toBeGreaterThan(0.9);
  });

  it('finds the fundamental of a sawtooth', () => {
    const buf = additiveSaw(220, SR, N, 40, 0.8);
    const r = mpm(buf, SR);
    expect(r).not.toBeNull();
    expect(relError(r!.freq, 220)).toBeLessThan(0.005);
  });

  it('returns null for silence', () => {
    expect(mpm(new Float32Array(N), SR)).toBeNull();
  });

  it('returns null or low clarity for white noise', () => {
    const r = mpm(whiteNoise(N, rng('mpm/noise'), 0.8), SR);
    if (r !== null) expect(r.clarity).toBeLessThan(0.9);
  });
});

describe('YinDetector', () => {
  it('returns null before the window fills', () => {
    const det = new YinDetector(SR);
    const buf = sine(440, SR, 1024, 0.8);
    det.push(buf, 0, buf.length);
    expect(det.poll()).toBeNull();
  });

  it('tracks a sine pushed in small blocks', () => {
    const det = new YinDetector(SR);
    const buf = sine(440, SR, 4096, 0.8);
    for (let i = 0; i < buf.length; i += 128) det.push(buf, i, i + 128);
    const r = det.poll();
    expect(r).not.toBeNull();
    expect(relError(r!.freq, 440)).toBeLessThan(0.005);
  });

  it('honors push index ranges', () => {
    const det = new YinDetector(SR, { bufferSize: 2048 });
    const padded = new Float32Array(4096);
    padded.set(sine(330, SR, 2048, 0.8), 1024);
    det.push(padded, 1024, 1024 + 2048);
    const r = det.poll();
    expect(r).not.toBeNull();
    expect(relError(r!.freq, 330)).toBeLessThan(0.005);
  });

  it('is deterministic across identical runs', () => {
    const buf = additiveSaw(196, SR, 4096, 30, 0.7);
    const run = () => {
      const det = new YinDetector(SR);
      det.push(buf, 0, buf.length);
      return det.poll();
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it('resets to the unfilled state', () => {
    const det = new YinDetector(SR);
    const buf = sine(440, SR, 4096, 0.8);
    det.push(buf, 0, buf.length);
    expect(det.poll()).not.toBeNull();
    det.reset();
    expect(det.poll()).toBeNull();
  });
});
