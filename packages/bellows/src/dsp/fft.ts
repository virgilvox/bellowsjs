/*
 * Radix-2 complex FFT with precomputed twiddle and bit-reversal tables,
 * a real-input wrapper over a half-size complex transform, and the
 * common analysis windows.
 *
 * Windows use the periodic convention (denominator n, not n - 1), the
 * form that sums flat under overlap-add, so they are the right choice
 * for STFT processing.
 */

/** Iterative in-place radix-2 Cooley-Tukey. Size must be a power of two. */
export class Fft {
  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(size: number) {
    if (size < 1 || (size & (size - 1)) !== 0) {
      throw new Error('Fft size must be a power of two, got ' + size);
    }
    this.size = size;
    const bits = Math.round(Math.log2(size));
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >>> b) & 1);
      this.rev[i] = r;
    }
    const half = size >> 1;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
  }

  /** In-place forward transform, no scaling. */
  forward(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, 1);
  }

  /** In-place inverse transform, scales by 1/size. */
  inverse(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, -1);
    const inv = 1 / this.size;
    for (let i = 0; i < this.size; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }

  private transform(re: Float32Array, im: Float32Array, sign: number): void {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    const cos = this.cos;
    const sin = this.sin;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k++) {
          const t = k * step;
          const wr = cos[t];
          const wi = sign * sin[t];
          const i0 = start + k;
          const i1 = i0 + half;
          const xr = re[i1] * wr - im[i1] * wi;
          const xi = re[i1] * wi + im[i1] * wr;
          re[i1] = re[i0] - xr;
          im[i1] = im[i0] - xi;
          re[i0] += xr;
          im[i0] += xi;
        }
      }
    }
  }
}

/**
 * Real-input FFT using the standard even-odd packing trick over a
 * half-size complex transform. forward produces size/2 + 1 bins with
 * DC and Nyquist purely real; inverse consumes the same layout.
 */
export class RealFft {
  readonly size: number;
  private readonly half: Fft;
  private readonly zr: Float32Array;
  private readonly zi: Float32Array;
  /** e^(-2 pi i k / size) for k = 0..size/2. */
  private readonly twCos: Float64Array;
  private readonly twSin: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error('RealFft size must be a power of two >= 2, got ' + size);
    }
    this.size = size;
    const m = size >> 1;
    this.half = new Fft(m);
    this.zr = new Float32Array(m);
    this.zi = new Float32Array(m);
    this.twCos = new Float64Array(m + 1);
    this.twSin = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) {
      this.twCos[k] = Math.cos((-2 * Math.PI * k) / size);
      this.twSin[k] = Math.sin((-2 * Math.PI * k) / size);
    }
  }

  /** input has size samples; outRe/outIm receive size/2 + 1 bins. */
  forward(input: Float32Array, outRe: Float32Array, outIm: Float32Array): void {
    const m = this.size >> 1;
    const zr = this.zr;
    const zi = this.zi;
    for (let i = 0; i < m; i++) {
      zr[i] = input[2 * i];
      zi[i] = input[2 * i + 1];
    }
    this.half.forward(zr, zi);
    outRe[0] = zr[0] + zi[0];
    outIm[0] = 0;
    outRe[m] = zr[0] - zi[0];
    outIm[m] = 0;
    // X[k] = Fe[k] + W^k Fo[k], X[m-k] = conj(Fe[k] - W^k Fo[k]) where
    // Fe/Fo are the transforms of the even and odd sample streams.
    for (let k = 1; k <= m >> 1; k++) {
      const j = m - k;
      const er = 0.5 * (zr[k] + zr[j]);
      const ei = 0.5 * (zi[k] - zi[j]);
      const or_ = 0.5 * (zi[k] + zi[j]);
      const oi = -0.5 * (zr[k] - zr[j]);
      const wr = this.twCos[k];
      const wi = this.twSin[k];
      const fr = or_ * wr - oi * wi;
      const fi = or_ * wi + oi * wr;
      outRe[k] = er + fr;
      outIm[k] = ei + fi;
      outRe[j] = er - fr;
      outIm[j] = -ei + fi;
    }
  }

  /** re/im hold size/2 + 1 bins; out receives size samples. */
  inverse(re: Float32Array, im: Float32Array, out: Float32Array): void {
    const m = this.size >> 1;
    const zr = this.zr;
    const zi = this.zi;
    zr[0] = 0.5 * (re[0] + re[m]);
    zi[0] = 0.5 * (re[0] - re[m]);
    for (let k = 1; k < m; k++) {
      const j = m - k;
      const fer = 0.5 * (re[k] + re[j]);
      const fei = 0.5 * (im[k] - im[j]);
      const dr = 0.5 * (re[k] - re[j]);
      const di = 0.5 * (im[k] + im[j]);
      // Fo[k] = D * W^-k
      const wr = this.twCos[k];
      const wi = -this.twSin[k];
      const fr = dr * wr - di * wi;
      const fi = dr * wi + di * wr;
      zr[k] = fer - fi;
      zi[k] = fei + fr;
    }
    this.half.inverse(zr, zi);
    for (let i = 0; i < m; i++) {
      out[2 * i] = zr[i];
      out[2 * i + 1] = zi[i];
    }
  }
}

/** Periodic Hann window: 0.5 - 0.5 cos(2 pi i / n). */
export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}

/** Periodic Hamming window: 0.54 - 0.46 cos(2 pi i / n). */
export function hamming(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}

/** Periodic 4-term Blackman-Harris window, sidelobes at -92 dB. */
export function blackmanHarris(n: number): Float32Array {
  const w = new Float32Array(n);
  const a0 = 0.35875;
  const a1 = 0.48829;
  const a2 = 0.14128;
  const a3 = 0.01168;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    w[i] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2 * t) - a3 * Math.cos(3 * t);
  }
  return w;
}
