/*
 * Local spectral helpers for oscillator and noise tests. Independent of
 * src/dsp/fft.ts on purpose: tests must not lean on the unit under test's
 * siblings that are being written concurrently.
 */

export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * cr - im[i + k + half] * ci;
        const vi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Blackman-Harris 4-term window, sidelobes near -92 dB. */
export function blackmanHarris(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1);
    w[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
  }
  return w;
}

/** Windowed magnitude spectrum, bins 0..n/2 inclusive. Signal length must be a power of two. */
export function magnitudeSpectrum(signal: Float32Array | Float64Array): Float64Array {
  const n = signal.length;
  const w = blackmanHarris(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = signal[i] * w[i];
  fft(re, im);
  const mags = new Float64Array((n >> 1) + 1);
  for (let k = 0; k < mags.length; k++) mags[k] = Math.hypot(re[k], im[k]);
  return mags;
}

export interface AliasReport {
  fundamentalDb: number;
  worstAliasDb: number;
  /** worst alias relative to the fundamental, negative when quieter */
  worstAliasRelDb: number;
  worstAliasHz: number;
}

/**
 * Measures how far the loudest non-harmonic component sits below the
 * fundamental. Bins within guardBins of any exact harmonic of f0 are
 * excluded, as are the near-DC bins where window leakage lives.
 */
export function measureAliasing(
  signal: Float32Array,
  sampleRate: number,
  f0: number,
  guardBins = 8,
): AliasReport {
  const mags = magnitudeSpectrum(signal);
  const n = signal.length;
  const binHz = sampleRate / n;

  const isHarmonicBin = new Uint8Array(mags.length);
  for (let k = 1; k * f0 < sampleRate / 2; k++) {
    const bin = Math.round((k * f0) / binHz);
    for (let b = bin - guardBins; b <= bin + guardBins; b++) {
      if (b >= 0 && b < mags.length) isHarmonicBin[b] = 1;
    }
  }
  for (let b = 0; b <= guardBins; b++) isHarmonicBin[b] = 1;

  const fundBin = Math.round(f0 / binHz);
  let fund = 0;
  for (let b = fundBin - guardBins; b <= fundBin + guardBins; b++) {
    if (b >= 0 && b < mags.length && mags[b] > fund) fund = mags[b];
  }

  let worst = 0;
  let worstBin = 0;
  for (let b = 0; b < mags.length; b++) {
    if (!isHarmonicBin[b] && mags[b] > worst) {
      worst = mags[b];
      worstBin = b;
    }
  }

  const fundamentalDb = 20 * Math.log10(fund + 1e-30);
  const worstAliasDb = 20 * Math.log10(worst + 1e-30);
  return {
    fundamentalDb,
    worstAliasDb,
    worstAliasRelDb: worstAliasDb - fundamentalDb,
    worstAliasHz: worstBin * binHz,
  };
}

/**
 * Average per-bin power density in octave bands, Welch style (averaged
 * windowed segments). Returns [centerHz, meanPowerDb] per band. Used to
 * check spectral tilt of noise colors.
 */
export function octaveBandDensity(
  signal: Float32Array,
  sampleRate: number,
  loHz: number,
  hiHz: number,
  segLen = 8192,
): Array<{ centerHz: number; db: number }> {
  const segs = Math.floor(signal.length / segLen);
  const power = new Float64Array((segLen >> 1) + 1);
  const seg = new Float64Array(segLen);
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < segLen; i++) seg[i] = signal[s * segLen + i];
    const mags = magnitudeSpectrum(seg);
    for (let k = 0; k < power.length; k++) power[k] += mags[k] * mags[k];
  }
  const binHz = sampleRate / segLen;
  const bands: Array<{ centerHz: number; db: number }> = [];
  for (let lo = loHz; lo * 2 <= hiHz; lo *= 2) {
    const b0 = Math.max(1, Math.round(lo / binHz));
    const b1 = Math.round((lo * 2) / binHz);
    let sum = 0;
    for (let b = b0; b < b1; b++) sum += power[b];
    bands.push({
      centerHz: lo * Math.SQRT2,
      db: 10 * Math.log10(sum / (b1 - b0) / segs + 1e-30),
    });
  }
  return bands;
}

/** Least squares slope of band density in dB per octave. */
export function tiltDbPerOctave(bands: Array<{ centerHz: number; db: number }>): number {
  const n = bands.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const { centerHz, db } of bands) {
    const x = Math.log2(centerHz);
    sx += x;
    sy += db;
    sxx += x * x;
    sxy += x * db;
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

/** Count sign changes, ignoring exact zeros. */
export function zeroCrossings(signal: Float32Array | number[]): number {
  let count = 0;
  let prev = 0;
  for (let i = 0; i < signal.length; i++) {
    const s = Math.sign(signal[i]);
    if (s !== 0) {
      if (prev !== 0 && s !== prev) count++;
      prev = s;
    }
  }
  return count;
}

/** Pearson correlation between two equal length signals. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    saa += da * da;
    sbb += db * db;
    sab += da * db;
  }
  return sab / Math.sqrt(saa * sbb);
}
