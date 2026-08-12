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

/*
 * The three constants that decide what these detectors accept were
 * reachable by no test. DEFAULT_THRESHOLD 0.1 to 0.3, MPM_K 0.93 to 0.75
 * and MPM_MIN_CLARITY 0.3 to 0.6 all passed the whole suite. The tests
 * above use a clean sawtooth, where every setting agrees, and digital
 * silence, which every setting rejects; "returns null OR low probability
 * for white noise" is satisfied by either branch. Nothing sat near a
 * threshold, so nothing could see one move.
 *
 * Each gate below brackets its constant from both sides, on signals
 * measured to fall either side of it.
 */
describe('pitch detector thresholds', () => {
  const SR = 44100;

  /** A sawtooth at `hz` with uniform noise added, from a fixed generator. */
  function noisySaw(hz: number, noise: number, n = 8192): Float32Array {
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = 0.8 * (2 * (((hz * i) / SR) % 1) - 1);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      b[i] += ((s / 0x7fffffff) * 2 - 1) * noise;
    }
    return b;
  }

  it('accepts and rejects either side of the YIN threshold', () => {
    /*
     * Measured: the normalized difference at the true lag is 0.074 at noise
     * 0.2 and above 0.1 at noise 0.3, so 0.1 is the only value in a
     * reasonable range that gives this pair. A threshold of 0.3 takes both;
     * 0.05 takes neither.
     */
    const near = yin(noisySaw(220, 0.2), SR);
    expect(near).not.toBeNull();
    expect(near!.freq).toBeCloseTo(220, 0);
    expect(near!.probability).toBeGreaterThan(0.9);
    expect(yin(noisySaw(220, 0.3), SR)).toBeNull();
  });

  it('falls back to the default threshold rather than going deaf on a bad one', () => {
    /*
     * Every comparison against NaN is false, so a NaN threshold made yin
     * return null for every input, silently and forever. A caller reaches
     * that with Number(config.threshold) on a missing field. The SFZ parser
     * had the same shape of hole and 0.1.6 closed it the same way.
     */
    const clean = noisySaw(220, 0);
    const good = yin(clean, SR)!;
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      const r = yin(clean, SR, bad);
      expect(r, String(bad)).not.toBeNull();
      expect(r!.freq, String(bad)).toBeCloseTo(good.freq, 6);
    }
    const det = new YinDetector(SR, { threshold: NaN, bufferSize: NaN });
    det.push(clean, 0, clean.length);
    expect(det.poll()).not.toBeNull();
  });

  it('does not take the octave when the fundamental is weak', () => {
    /*
     * MPM_K is the fraction of the highest NSDF peak a peak must reach to
     * be taken as the period, and its whole job is refusing the half period
     * when the second harmonic is louder than the first. Measured on a
     * fundamental at a tenth the amplitude of its octave: 0.93 gives 110 Hz
     * at clarity 1.0 and 0.75 gives 219.9 Hz at clarity 0.78, which is the
     * octave error the constant exists to prevent.
     */
    const n = 8192;
    const weak = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      weak[i] =
        0.1 * Math.sin((2 * Math.PI * 110 * i) / SR) +
        0.9 * Math.sin((2 * Math.PI * 220 * i) / SR) +
        0.3 * Math.sin((2 * Math.PI * 330 * i) / SR);
    }
    const r = mpm(weak, SR);
    expect(r).not.toBeNull();
    expect(r!.freq).toBeCloseTo(110, 0);
    expect(r!.clarity).toBeGreaterThan(0.9);
  });

  it('accepts and rejects either side of the MPM clarity floor', () => {
    /* Measured: clarity 0.376 at noise 1.0 and below 0.3 at noise 1.3. A
     * floor of 0.6 rejects the first; a floor much under 0.3 accepts the
     * second. */
    const near = mpm(noisySaw(220, 1.0), SR);
    expect(near).not.toBeNull();
    expect(near!.freq).toBeCloseTo(220, -1);
    expect(near!.clarity).toBeGreaterThan(0.3);
    expect(near!.clarity).toBeLessThan(0.5);
    expect(mpm(noisySaw(220, 1.3), SR)).toBeNull();
  });
});
