import { describe, it, expect } from 'vitest';
import { Oversampler } from '../../src/dsp/oversample';
import { Fft, hann } from '../../src/dsp/fft';

const SR = 48000;

/** Run a sine through up() in blocks and concatenate the upsampled output. */
function upsampleSine(os: Oversampler, factor: number, freq: number, totalSamples: number, block: number): Float32Array {
  const outHi = new Float32Array(totalSamples * factor);
  const input = new Float32Array(block);
  let written = 0;
  for (let start = 0; start < totalSamples; start += block) {
    const n = Math.min(block, totalSamples - start);
    for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * freq * (start + i)) / SR);
    const hi = os.up(input, 0, n);
    expect(hi.length).toBe(n * factor);
    outHi.set(hi, written);
    written += hi.length;
  }
  return outHi;
}

/** Ratio of spectral energy above cutoffHz to total, from a windowed slice. */
function highBandRatio(signal: Float32Array, offset: number, fftSize: number, sampleRate: number, cutoffHz: number): number {
  const w = hann(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) re[i] = signal[offset + i] * w[i];
  new Fft(fftSize).forward(re, im);
  const cutBin = Math.round((cutoffHz / sampleRate) * fftSize);
  let total = 0;
  let high = 0;
  for (let k = 1; k <= fftSize / 2; k++) {
    const e = re[k] * re[k] + im[k] * im[k];
    total += e;
    if (k >= cutBin) high += e;
  }
  return high / total;
}

describe('Oversampler up', () => {
  it.each([2, 4] as const)('suppresses images above the source Nyquist at %ix', (factor) => {
    const os = new Oversampler(factor, 128);
    const hi = upsampleSine(os, factor, 1000, 8192, 128);
    // A 1 kHz sine zero-stuffed to the high rate images at 47 kHz (and
    // 95/97 kHz for 4x). Everything above the source Nyquist must be gone.
    const ratio = highBandRatio(hi, 4096, 8192, SR * factor, SR / 2 + 2000);
    expect(10 * Math.log10(ratio)).toBeLessThan(-70);
  });

  it.each([2, 4] as const)('returns cached views for repeated block lengths at %ix', (factor) => {
    // Alternating short and full blocks, as produced by event-boundary
    // block splitting, must not allocate a fresh view per call.
    const os = new Oversampler(factor, 128);
    const input = new Float32Array(128);
    const a96 = os.up(input, 0, 96);
    const a128 = os.up(input, 0, 128);
    const b96 = os.up(input, 0, 96);
    const b128 = os.up(input, 0, 128);
    expect(b96).toBe(a96);
    expect(b128).toBe(a128);
    expect(a96.length).toBe(96 * factor);
    expect(a128.length).toBe(128 * factor);
  });

  it('preserves the amplitude of a passband sine', () => {
    const os = new Oversampler(2, 128);
    const hi = upsampleSine(os, 2, 1000, 4096, 128);
    let peak = 0;
    for (let i = 2048; i < 8192; i++) peak = Math.max(peak, Math.abs(hi[i]));
    expect(peak).toBeGreaterThan(0.99);
    expect(peak).toBeLessThan(1.01);
  });
});

describe('Oversampler roundtrip', () => {
  it.each([2, 4] as const)('reconstructs a bandlimited sine at %ix, delayed by latency', (factor) => {
    const os = new Oversampler(factor, 128);
    const total = 4096;
    const block = 128;
    const freq = 1000;
    const out = new Float32Array(total);
    const input = new Float32Array(block);
    for (let start = 0; start < total; start += block) {
      const n = Math.min(block, total - start);
      for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * freq * (start + i)) / SR);
      const hi = os.up(input, 0, n);
      const slice = out.subarray(start, start + n);
      os.down(hi, slice, 0, n);
    }
    const latency = os.latency;
    let maxErr = 0;
    for (let i = 200; i < total; i++) {
      const expected = Math.sin((2 * Math.PI * freq * (i - latency)) / SR);
      maxErr = Math.max(maxErr, Math.abs(out[i] - expected));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('reports integer latency of 16 at 2x and 24 at 4x', () => {
    expect(new Oversampler(2, 64).latency).toBe(16);
    expect(new Oversampler(4, 64).latency).toBe(24);
  });

  it('passes DC at unity gain', () => {
    const os = new Oversampler(2, 64);
    const input = new Float32Array(64).fill(0.5);
    const out = new Float32Array(64);
    for (let b = 0; b < 8; b++) {
      const hi = os.up(input, 0, 64);
      os.down(hi, out, 0, 64);
    }
    expect(out[63]).toBeCloseTo(0.5, 4);
  });

  it('respects from/to offsets on both paths', () => {
    const osA = new Oversampler(2, 128);
    const osB = new Oversampler(2, 128);
    const freq = 2000;
    const sig = new Float32Array(256);
    for (let i = 0; i < 256; i++) sig[i] = Math.sin((2 * Math.PI * freq * i) / SR);

    // A: one call over [64, 192). B: same samples via a compacted buffer.
    const hiA = osA.up(sig, 64, 192);
    const compact = sig.slice(64, 192);
    const hiB = osB.up(compact, 0, 128);
    for (let i = 0; i < 256; i++) expect(hiA[i]).toBeCloseTo(hiB[i], 6);

    const outA = new Float32Array(256);
    const outB = new Float32Array(128);
    osA.down(hiA, outA, 64, 192);
    osB.down(hiB, outB, 0, 128);
    for (let i = 0; i < 128; i++) expect(outA[64 + i]).toBeCloseTo(outB[i], 6);
  });

  it('reset clears filter state', () => {
    const os = new Oversampler(2, 64);
    const input = new Float32Array(64).fill(1);
    os.up(input, 0, 64);
    os.reset();
    const silent = new Float32Array(64);
    const hi = os.up(silent, 0, 64);
    for (let i = 0; i < hi.length; i++) expect(hi[i]).toBe(0);
  });
});
