import { describe, it, expect } from 'vitest';
import {
  spectralCentroid,
  spectralSpread,
  spectralFlatness,
  spectralRolloff,
  rms,
  zcr,
  mfcc,
  mfccFromSpectrum,
} from '../../src/analysis/descriptors';
import { rng } from '../../src/core/prng';
import { sine, whiteNoise, magSpectrum } from './signals';

const SR = 44100;
const SIZE = 4096;
const BIN = SR / SIZE;

/** Mean of many magnitude spectra, to tame single-frame noise variance. */
function averagedNoiseSpectrum(frames: number, seed: string): Float32Array {
  const r = rng(seed);
  const bins = (SIZE >> 1) + 1;
  const acc = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const buf = whiteNoise(SIZE, r, 0.8);
    const mag = magSpectrum(buf, SIZE);
    for (let k = 0; k < bins; k++) acc[k] += mag[k];
  }
  const out = new Float32Array(bins);
  for (let k = 0; k < bins; k++) out[k] = acc[k] / frames;
  return out;
}

describe('spectralCentroid', () => {
  it('matches a sine frequency within one bin', () => {
    for (const freq of [500, 1000, 5000]) {
      const mag = magSpectrum(sine(freq, SR, SIZE, 0.8), SIZE);
      expect(Math.abs(spectralCentroid(mag, SR) - freq)).toBeLessThan(BIN);
    }
  });

  it('returns 0 for an empty spectrum', () => {
    expect(spectralCentroid(new Float32Array(2049), SR)).toBe(0);
  });

  it('sits near mid-band for white noise', () => {
    const mag = averagedNoiseSpectrum(16, 'desc/centroid');
    const c = spectralCentroid(mag, SR);
    // Flat magnitude implies a centroid near half of Nyquist.
    expect(c).toBeGreaterThan(SR / 4 - 2000);
    expect(c).toBeLessThan(SR / 4 + 2000);
  });
});

describe('spectralFlatness', () => {
  it('is near 1 for white noise', () => {
    const mag = averagedNoiseSpectrum(64, 'desc/flatness');
    expect(spectralFlatness(mag)).toBeGreaterThan(0.9);
  });

  it('is near 0 for a sine', () => {
    const mag = magSpectrum(sine(1000, SR, SIZE, 0.8), SIZE);
    expect(spectralFlatness(mag)).toBeLessThan(0.05);
  });

  it('is 0 for silence', () => {
    expect(spectralFlatness(new Float32Array(2049))).toBe(0);
  });
});

describe('spectralRolloff', () => {
  it('lands at a sine frequency', () => {
    const mag = magSpectrum(sine(2000, SR, SIZE, 0.8), SIZE);
    expect(Math.abs(spectralRolloff(mag, SR) - 2000)).toBeLessThan(3 * BIN);
  });

  it('lands near 85 percent of the band for white noise', () => {
    const mag = averagedNoiseSpectrum(16, 'desc/rolloff');
    const r = spectralRolloff(mag, SR);
    expect(r).toBeGreaterThan(0.7 * (SR / 2) * 0.85);
    expect(r).toBeLessThan(1.1 * (SR / 2) * 0.85);
  });

  it('honors the fraction argument', () => {
    const mag = averagedNoiseSpectrum(16, 'desc/rolloff');
    expect(spectralRolloff(mag, SR, 0.5)).toBeLessThan(spectralRolloff(mag, SR, 0.95));
  });
});

describe('spectralSpread', () => {
  it('is small for a sine and large for noise', () => {
    const sineMag = magSpectrum(sine(2000, SR, SIZE, 0.8), SIZE);
    const noiseMag = averagedNoiseSpectrum(16, 'desc/spread');
    const sineSpread = spectralSpread(sineMag, SR);
    const noiseSpread = spectralSpread(noiseMag, SR);
    expect(sineSpread).toBeLessThan(500);
    expect(noiseSpread).toBeGreaterThan(4000);
  });
});

describe('rms and zcr', () => {
  it('rms of a sine is amplitude over sqrt 2', () => {
    const buf = sine(1000, SR, SIZE * 4, 0.5);
    expect(rms(buf)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('rms of silence is 0', () => {
    expect(rms(new Float32Array(1024))).toBe(0);
  });

  it('zcr of a sine is about 2f over sampleRate', () => {
    const buf = sine(1000, SR, SIZE * 4, 0.8);
    expect(zcr(buf)).toBeCloseTo((2 * 1000) / SR, 3);
  });

  it('zcr grows with frequency', () => {
    const lo = zcr(sine(200, SR, SIZE * 4, 0.8));
    const hi = zcr(sine(4000, SR, SIZE * 4, 0.8));
    expect(hi).toBeGreaterThan(lo * 10);
  });
});

describe('mfcc', () => {
  it('returns the requested number of coefficients', () => {
    const buf = sine(440, SR, 2048, 0.8);
    expect(mfcc(buf, SR).length).toBe(13);
    expect(mfcc(buf, SR, { coefficients: 20, filters: 40 }).length).toBe(20);
  });

  it('is deterministic', () => {
    const buf = whiteNoise(2048, rng('mfcc/det'), 0.8);
    const a = mfcc(buf, SR);
    const b = mfcc(buf, SR);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('first coefficient tracks overall energy', () => {
    const quiet = sine(440, SR, 2048, 0.1);
    const loud = sine(440, SR, 2048, 0.8);
    expect(mfcc(loud, SR)[0]).toBeGreaterThan(mfcc(quiet, SR)[0]);
  });

  it('separates a sine from noise in the higher coefficients', () => {
    const tone = mfcc(sine(440, SR, 2048, 0.5), SR);
    const noise = mfcc(whiteNoise(2048, rng('mfcc/sep'), 0.5), SR);
    let dist = 0;
    for (let i = 1; i < 13; i++) dist += (tone[i] - noise[i]) ** 2;
    expect(Math.sqrt(dist)).toBeGreaterThan(1);
  });

  it('mfccFromSpectrum agrees in shape with the buffer path', () => {
    const buf = sine(440, SR, 2048, 0.5);
    const mag = magSpectrum(buf, 2048);
    const fromSpec = mfccFromSpectrum(mag, SR);
    expect(fromSpec.length).toBe(13);
    for (const v of fromSpec) expect(Number.isFinite(v)).toBe(true);
  });
});
