/*
 * Formant estimation by linear prediction: the vowel resonances of a voiced sound, for measuring a voice
 * against published vowel data (the vowel solver checks its fits this way, and so do the tests).
 * Offline analysis: it allocates per call.
 */

/** One resonance: centre frequency and bandwidth, Hz. */
export interface Formant {
  f: number;
  bw: number;
}
/**
 * Formants of x around sample `center` (an index, not seconds) by LPC: decimate by `decim`
 * (windowed-sinc low-pass), pre-emphasis, a Hamming window of `winSec`, autocorrelation and
 * Levinson-Durbin of `order`, then the roots of the predictor polynomial (Durand-Kerner). Frequencies and
 * bandwidths in Hz, ascending; poles wider than 700 Hz are dropped. The defaults suit an adult voice at
 * 44.1 or 48 kHz: 14 poles over 0 to about 5.5 kHz.
 */
export function estimateFormants(
  x: Float32Array,
  sr: number,
  center: number,
  winSec = 0.04,
  decim = 4,
  order = 14,
): Formant[] {
  const half = Math.round((winSec * sr) / 2);
  const a0 = Math.max(0, center - half);
  const b0 = Math.min(x.length, center + half);
  const taps = 16 * decim + 1;
  const fc = 0.45 / decim;
  const h = new Float64Array(taps);
  let hs = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - (taps - 1) / 2;
    h[i] = (t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    hs += h[i];
  }
  const n = Math.floor((b0 - a0) / decim);
  if (n < order * 3) return [];
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < taps; k++) {
      const j = a0 + i * decim + k - (taps - 1) / 2;
      if (j >= 0 && j < x.length) s += (h[k] / hs) * x[j];
    }
    y[i] = s;
  }
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = (y[i] - 0.97 * (i > 0 ? y[i - 1] : 0)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) for (let i = k; i < n; i++) r[k] += z[i] * z[i - k];
  if (r[0] <= 0) return [];
  r[0] *= 1 + 1e-9;
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let e = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    e *= 1 - k * k;
  }
  // roots of z^p + a1 z^(p-1) + ... + ap
  const c = new Float64Array(order + 1);
  for (let j = 0; j <= order; j++) c[order - j] = a[j];
  const zr = new Float64Array(order);
  const zi = new Float64Array(order);
  for (let k = 0; k < order; k++) {
    zr[k] = 0.9 * Math.cos((2 * Math.PI * k) / order + 0.4);
    zi[k] = 0.9 * Math.sin((2 * Math.PI * k) / order + 0.4);
  }
  for (let it = 0; it < 500; it++) {
    let move = 0;
    for (let k = 0; k < order; k++) {
      let pr = c[order];
      let pi = 0;
      for (let j = order - 1; j >= 0; j--) {
        const tr = pr * zr[k] - pi * zi[k] + c[j];
        pi = pr * zi[k] + pi * zr[k];
        pr = tr;
      }
      let dr = c[order];
      let di = 0;
      for (let j = 0; j < order; j++) {
        if (j === k) continue;
        const ar = zr[k] - zr[j];
        const ai = zi[k] - zi[j];
        const tr = dr * ar - di * ai;
        di = dr * ai + di * ar;
        dr = tr;
      }
      const den = dr * dr + di * di || 1e-300;
      const qr = (pr * dr + pi * di) / den;
      const qi = (pi * dr - pr * di) / den;
      zr[k] -= qr;
      zi[k] -= qi;
      move = Math.max(move, Math.abs(qr) + Math.abs(qi));
    }
    if (move < 1e-12) break;
  }
  const fs = sr / decim;
  const out: Formant[] = [];
  for (let k = 0; k < order; k++) {
    if (zi[k] <= 0) continue;
    const f = (Math.atan2(zi[k], zr[k]) * fs) / (2 * Math.PI);
    const bw = (-Math.log(Math.hypot(zr[k], zi[k])) * fs) / Math.PI;
    if (f > 90 && f < fs / 2 - 100 && bw < 700) out.push({ f, bw });
  }
  return out.sort((p, q) => p.f - q.f);
}
