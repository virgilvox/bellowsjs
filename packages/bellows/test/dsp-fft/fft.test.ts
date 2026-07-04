import { describe, it, expect } from 'vitest';
import { Fft, RealFft, hann, hamming, blackmanHarris } from '../../src/dsp/fft';
import { rng } from '../../src/core/prng';

/** Reference O(n^2) DFT in doubles. */
function naiveDft(re: Float32Array, im: Float32Array): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      sr += re[t] * c - im[t] * s;
      si += re[t] * s + im[t] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

function randomSignal(n: number, label: string): Float32Array {
  const r = rng(label);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  return x;
}

describe('Fft', () => {
  it('rejects non power of two sizes', () => {
    expect(() => new Fft(100)).toThrow();
    expect(() => new Fft(0)).toThrow();
  });

  it('matches a naive DFT at size 64', () => {
    const n = 64;
    const re = randomSignal(n, 'fft-naive-re');
    const im = randomSignal(n, 'fft-naive-im');
    const ref = naiveDft(re, im);
    const fft = new Fft(n);
    fft.forward(re, im);
    for (let k = 0; k < n; k++) {
      expect(Math.abs(re[k] - ref.re[k])).toBeLessThan(1e-4);
      expect(Math.abs(im[k] - ref.im[k])).toBeLessThan(1e-4);
    }
  });

  it.each([256, 512, 1024, 4096, 8192])('roundtrips within 1e-5 at size %i', (n) => {
    const re = randomSignal(n, 'fft-rt-re-' + n);
    const im = randomSignal(n, 'fft-rt-im-' + n);
    const origRe = re.slice();
    const origIm = im.slice();
    const fft = new Fft(n);
    fft.forward(re, im);
    fft.inverse(re, im);
    let maxErr = 0;
    for (let i = 0; i < n; i++) {
      maxErr = Math.max(maxErr, Math.abs(re[i] - origRe[i]), Math.abs(im[i] - origIm[i]));
    }
    expect(maxErr).toBeLessThan(1e-5);
  });

  it('concentrates a pure sine at its bin', () => {
    const n = 1024;
    const k = 37;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * k * i) / n);
    const fft = new Fft(n);
    fft.forward(re, im);
    let total = 0;
    for (let i = 0; i < n; i++) total += re[i] * re[i] + im[i] * im[i];
    const atBin =
      re[k] * re[k] + im[k] * im[k] + re[n - k] * re[n - k] + im[n - k] * im[n - k];
    expect(atBin / total).toBeGreaterThan(0.999);
  });

  it('satisfies Parseval', () => {
    const n = 2048;
    const re = randomSignal(n, 'fft-parseval');
    const im = new Float32Array(n);
    let timeEnergy = 0;
    for (let i = 0; i < n; i++) timeEnergy += re[i] * re[i];
    const fft = new Fft(n);
    fft.forward(re, im);
    let freqEnergy = 0;
    for (let i = 0; i < n; i++) freqEnergy += re[i] * re[i] + im[i] * im[i];
    freqEnergy /= n;
    expect(Math.abs(freqEnergy - timeEnergy) / timeEnergy).toBeLessThan(1e-4);
  });
});

describe('RealFft', () => {
  it('matches the complex Fft on real input', () => {
    const n = 1024;
    const x = randomSignal(n, 'rfft-match');
    const re = x.slice();
    const im = new Float32Array(n);
    new Fft(n).forward(re, im);

    const outRe = new Float32Array(n / 2 + 1);
    const outIm = new Float32Array(n / 2 + 1);
    new RealFft(n).forward(x, outRe, outIm);

    let maxMag = 0;
    for (let k = 0; k <= n / 2; k++) maxMag = Math.max(maxMag, Math.hypot(re[k], im[k]));
    for (let k = 0; k <= n / 2; k++) {
      expect(Math.abs(outRe[k] - re[k])).toBeLessThan(1e-3 * maxMag);
      expect(Math.abs(outIm[k] - im[k])).toBeLessThan(1e-3 * maxMag);
    }
  });

  it('zeroes the imaginary parts of DC and Nyquist', () => {
    const n = 256;
    const x = randomSignal(n, 'rfft-dc');
    const outRe = new Float32Array(n / 2 + 1);
    const outIm = new Float32Array(n / 2 + 1);
    new RealFft(n).forward(x, outRe, outIm);
    expect(outIm[0]).toBe(0);
    expect(outIm[n / 2]).toBe(0);
  });

  it.each([256, 1024, 8192])('roundtrips within 1e-5 at size %i', (n) => {
    const x = randomSignal(n, 'rfft-rt-' + n);
    const outRe = new Float32Array(n / 2 + 1);
    const outIm = new Float32Array(n / 2 + 1);
    const out = new Float32Array(n);
    const rf = new RealFft(n);
    rf.forward(x, outRe, outIm);
    rf.inverse(outRe, outIm, out);
    let maxErr = 0;
    for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - x[i]));
    expect(maxErr).toBeLessThan(1e-5);
  });

  it('handles the smallest size', () => {
    const rf = new RealFft(2);
    const outRe = new Float32Array(2);
    const outIm = new Float32Array(2);
    rf.forward(new Float32Array([3, 1]), outRe, outIm);
    expect(outRe[0]).toBeCloseTo(4, 6);
    expect(outRe[1]).toBeCloseTo(2, 6);
    const out = new Float32Array(2);
    rf.inverse(outRe, outIm, out);
    expect(out[0]).toBeCloseTo(3, 6);
    expect(out[1]).toBeCloseTo(1, 6);
  });
});

describe('windows', () => {
  const n = 64;

  function checkPeriodicSymmetry(w: Float32Array) {
    for (let i = 1; i < n; i++) {
      expect(Math.abs(w[i] - w[n - i])).toBeLessThan(1e-6);
    }
  }

  it('hann is periodic with zero start and unit center', () => {
    const w = hann(n);
    expect(w[0]).toBeCloseTo(0, 6);
    expect(w[n / 2]).toBeCloseTo(1, 6);
    checkPeriodicSymmetry(w);
  });

  it('hann sums flat at 50 percent overlap', () => {
    const w = hann(n);
    for (let i = 0; i < n / 2; i++) {
      expect(w[i] + w[i + n / 2]).toBeCloseTo(1, 6);
    }
  });

  it('hamming is periodic with 0.08 start and unit center', () => {
    const w = hamming(n);
    expect(w[0]).toBeCloseTo(0.08, 6);
    expect(w[n / 2]).toBeCloseTo(1, 6);
    checkPeriodicSymmetry(w);
  });

  it('blackmanHarris is periodic with the standard endpoint', () => {
    const w = blackmanHarris(n);
    expect(w[0]).toBeCloseTo(0.35875 - 0.48829 + 0.14128 - 0.01168, 6);
    expect(w[n / 2]).toBeCloseTo(1, 5);
    checkPeriodicSymmetry(w);
  });
});
