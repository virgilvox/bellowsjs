/*
 * Deterministic test signal builders shared by the analysis tests.
 */

import { RealFft, hann } from '../../src/dsp/fft';
import type { Rng } from '../../src/types';

export function sine(
  freq: number,
  sampleRate: number,
  samples: number,
  amp = 1,
  phase = 0,
): Float32Array {
  const out = new Float32Array(samples);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < samples; i++) out[i] = amp * Math.sin(w * i + phase);
  return out;
}

/** Add a sine into an existing buffer. */
export function addSine(buf: Float32Array, freq: number, sampleRate: number, amp: number): void {
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < buf.length; i++) buf[i] += amp * Math.sin(w * i);
}

/** Band-limited sawtooth built from its Fourier series. */
export function additiveSaw(
  freq: number,
  sampleRate: number,
  samples: number,
  harmonics: number,
  amp = 1,
): Float32Array {
  const out = new Float32Array(samples);
  for (let h = 1; h <= harmonics; h++) {
    const hf = h * freq;
    if (hf >= sampleRate / 2) break;
    const w = (2 * Math.PI * hf) / sampleRate;
    const a = (amp * 2) / (Math.PI * h);
    for (let i = 0; i < samples; i++) out[i] += a * Math.sin(w * i);
  }
  return out;
}

export function whiteNoise(samples: number, rng: Rng, amp = 1): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = amp * (rng() * 2 - 1);
  return out;
}

/** Hann-windowed magnitude spectrum of buffer[0..size). size must be a power of two. */
export function magSpectrum(buffer: Float32Array, size: number, offset = 0): Float32Array {
  const fft = new RealFft(size);
  const win = hann(size);
  const input = new Float32Array(size);
  for (let i = 0; i < size; i++) input[i] = (buffer[offset + i] ?? 0) * win[i];
  const bins = (size >> 1) + 1;
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  fft.forward(input, re, im);
  const mag = new Float32Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return mag;
}
