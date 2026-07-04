/*
 * Spectral and time-domain descriptors. All spectral functions take a
 * magnitude spectrum of size/2 + 1 bins (the RealFft layout); the FFT
 * size is recovered as (mag.length - 1) * 2 and bin k sits at
 * k * sampleRate / fftSize Hz.
 *
 * mfcc uses the HTK mel scale, mel(f) = 2595 log10(1 + f / 700), a
 * triangular filterbank from 0 Hz to Nyquist over the power spectrum,
 * log energies, and a DCT-II. The first coefficient is the plain sum of
 * log energies, so it tracks overall level.
 */

import { RealFft, hann } from '../dsp/fft';

/** Amplitude-weighted mean frequency in Hz. 0 for an empty spectrum. */
export function spectralCentroid(mag: Float32Array, sampleRate: number): number {
  const fftSize = (mag.length - 1) * 2;
  const binHz = sampleRate / fftSize;
  let sum = 0;
  let weighted = 0;
  for (let k = 0; k < mag.length; k++) {
    sum += mag[k];
    weighted += k * binHz * mag[k];
  }
  return sum > 0 ? weighted / sum : 0;
}

/** Standard deviation of the spectrum around its centroid, in Hz. */
export function spectralSpread(mag: Float32Array, sampleRate: number): number {
  const fftSize = (mag.length - 1) * 2;
  const binHz = sampleRate / fftSize;
  const centroid = spectralCentroid(mag, sampleRate);
  let sum = 0;
  let variance = 0;
  for (let k = 0; k < mag.length; k++) {
    const d = k * binHz - centroid;
    sum += mag[k];
    variance += d * d * mag[k];
  }
  return sum > 0 ? Math.sqrt(variance / sum) : 0;
}

/**
 * Geometric mean over arithmetic mean of the magnitudes, in [0, 1].
 * Near 1 for noise, near 0 for a tone. The DC bin is skipped.
 */
export function spectralFlatness(mag: Float32Array): number {
  const eps = 1e-12;
  let logSum = 0;
  let sum = 0;
  const n = mag.length - 1;
  if (n < 1) return 0;
  for (let k = 1; k < mag.length; k++) {
    logSum += Math.log(mag[k] + eps);
    sum += mag[k];
  }
  const arith = sum / n;
  if (arith <= eps) return 0;
  return Math.exp(logSum / n) / (arith + eps);
}

/**
 * Frequency below which `fraction` of the total magnitude lies.
 * Cumulates plain magnitudes, not power.
 */
export function spectralRolloff(
  mag: Float32Array,
  sampleRate: number,
  fraction = 0.85,
): number {
  const fftSize = (mag.length - 1) * 2;
  const binHz = sampleRate / fftSize;
  let total = 0;
  for (let k = 0; k < mag.length; k++) total += mag[k];
  if (total <= 0) return 0;
  const target = fraction * total;
  let cum = 0;
  for (let k = 0; k < mag.length; k++) {
    cum += mag[k];
    if (cum >= target) return k * binHz;
  }
  return (mag.length - 1) * binHz;
}

/** Root mean square of a buffer. */
export function rms(buffer: Float32Array): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

/**
 * Zero crossing rate as crossings per sample, in [0, 1]. A sine at
 * frequency f gives about 2f / sampleRate.
 */
export function zcr(buffer: Float32Array): number {
  if (buffer.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < buffer.length; i++) {
    if ((buffer[i - 1] >= 0) !== (buffer[i] >= 0)) crossings++;
  }
  return crossings / (buffer.length - 1);
}

export interface MfccOptions {
  /** Number of cepstral coefficients to return. Default 13. */
  coefficients?: number;
  /** Number of mel filters. Default 26. */
  filters?: number;
}

function melOf(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function hzOf(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * MFCC from a magnitude spectrum: mel filterbank over the power
 * spectrum, log, DCT-II. Returns `coefficients` values; index 0 is the
 * unnormalized sum of log filter energies.
 */
export function mfccFromSpectrum(
  mag: Float32Array,
  sampleRate: number,
  opts: MfccOptions = {},
): Float32Array {
  const nCoeff = opts.coefficients ?? 13;
  const nFilters = opts.filters ?? 26;
  const fftSize = (mag.length - 1) * 2;
  const binHz = sampleRate / fftSize;

  // Filter edge frequencies, equally spaced in mel from 0 to Nyquist.
  const melMax = melOf(sampleRate / 2);
  const edges = new Float64Array(nFilters + 2);
  for (let m = 0; m < nFilters + 2; m++) {
    edges[m] = hzOf((melMax * m) / (nFilters + 1));
  }

  const logE = new Float64Array(nFilters);
  const eps = 1e-10;
  for (let m = 0; m < nFilters; m++) {
    const lo = edges[m];
    const center = edges[m + 1];
    const hi = edges[m + 2];
    let e = 0;
    const kLo = Math.max(0, Math.ceil(lo / binHz));
    const kHi = Math.min(mag.length - 1, Math.floor(hi / binHz));
    for (let k = kLo; k <= kHi; k++) {
      const f = k * binHz;
      let w: number;
      if (f < center) {
        w = center > lo ? (f - lo) / (center - lo) : 0;
      } else {
        w = hi > center ? (hi - f) / (hi - center) : 0;
      }
      if (w > 0) e += w * mag[k] * mag[k];
    }
    logE[m] = Math.log(e + eps);
  }

  const out = new Float32Array(nCoeff);
  for (let n = 0; n < nCoeff; n++) {
    let acc = 0;
    for (let m = 0; m < nFilters; m++) {
      acc += logE[m] * Math.cos((Math.PI * n * (m + 0.5)) / nFilters);
    }
    out[n] = acc;
  }
  return out;
}

/**
 * MFCC from a time-domain buffer. The buffer is Hann windowed, zero
 * padded to the next power of two, and transformed with RealFft.
 */
export function mfcc(
  buffer: Float32Array,
  sampleRate: number,
  opts: MfccOptions = {},
): Float32Array {
  let size = 2;
  while (size < buffer.length) size <<= 1;
  const fft = new RealFft(size);
  const win = hann(buffer.length);
  const input = new Float32Array(size);
  for (let i = 0; i < buffer.length; i++) input[i] = buffer[i] * win[i];
  const bins = (size >> 1) + 1;
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  fft.forward(input, re, im);
  const mag = new Float32Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return mfccFromSpectrum(mag, sampleRate, opts);
}
