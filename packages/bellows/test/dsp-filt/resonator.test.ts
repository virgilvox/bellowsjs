import { describe, expect, it } from 'vitest';
import {
  AntiResonator,
  RESONATOR_MAX_FREQ,
  RESONATOR_MIN_BW,
  Resonator,
  higherPoleCorrection,
} from '../../src/dsp/resonator';
import { rng } from '../../src/core/prng';

type Unit = { next(x: number): number; reset(): void };

/**
 * Impulse response long enough that the tail is below e^-40 of the start:
 * the envelope of a pole pair decays as exp(-pi bw t).
 */
function impulseResponse(u: Unit, sr: number, bw: number): Float64Array {
  u.reset();
  const n = Math.ceil((40 / (Math.PI * bw)) * sr);
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) h[i] = u.next(i === 0 ? 1 : 0);
  return h;
}

/**
 * Squared magnitude of the DTFT of h at f, summed directly. On a response
 * that has decayed below e^-40 this is the filter's exact frequency
 * response to double precision, at any frequency, with no bin grid.
 */
function mag2(h: Float64Array, f: number, sr: number): number {
  const w = (2 * Math.PI * f) / sr;
  let re = 0;
  let im = 0;
  for (let n = 0; n < h.length; n++) {
    re += h[n] * Math.cos(w * n);
    im -= h[n] * Math.sin(w * n);
  }
  return re * re + im * im;
}

const db = (p: number) => 10 * Math.log10(p);

/** Peak by golden section near f, then each -3 dB edge by bisection. */
function peakAndWidth(h: Float64Array, sr: number, f: number, bw: number) {
  const g = (Math.sqrt(5) - 1) / 2;
  let lo = Math.max(0, f - 2 * bw);
  let hi = Math.min(sr / 2, f + 2 * bw);
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let m1 = mag2(h, x1, sr);
  let m2 = mag2(h, x2, sr);
  for (let i = 0; i < 60; i++) {
    if (m1 > m2) {
      hi = x2;
      x2 = x1;
      m2 = m1;
      x1 = hi - g * (hi - lo);
      m1 = mag2(h, x1, sr);
    } else {
      lo = x1;
      x1 = x2;
      m1 = m2;
      x2 = lo + g * (hi - lo);
      m2 = mag2(h, x2, sr);
    }
  }
  const peak = (lo + hi) / 2;
  const half = mag2(h, peak, sr) / 2;
  const edge = (inside: number, outside: number) => {
    for (let i = 0; i < 60; i++) {
      const m = (inside + outside) / 2;
      if (mag2(h, m, sr) > half) inside = m;
      else outside = m;
    }
    return (inside + outside) / 2;
  };
  const low = edge(peak, Math.max(0, peak - 20 * bw));
  const high = edge(peak, Math.min(sr / 2, peak + 20 * bw));
  return { peak, width: high - low };
}

function resonator(sr: number, f: number, bw: number): Resonator {
  const r = new Resonator(sr);
  r.set(f, bw);
  return r;
}

function antiResonator(sr: number, f: number, bw: number): AntiResonator {
  const z = new AntiResonator(sr);
  z.set(f, bw);
  return z;
}

/*
 * Formant-like settings from 250 Hz to the top of the clamp at 44100.
 * Measured with the helpers above, the worst peak error is -0.72 percent
 * (250 Hz, 60 wide) and the worst width error +2.7 percent (19000 Hz, 1000
 * wide at 44100, where the image of the conjugate pole across Nyquist
 * widens the skirt). The low peak at 250/60 is the all-pole shift
 * sqrt(1 - (bw/2f)^2) = 0.99277, not a tuning error: it is what an analog
 * resonance with the same poles does too.
 */
const CASES: Array<[number, number]> = [
  [250, 60],
  [700, 130],
  [1500, 90],
  [2500, 110],
  [3500, 250],
  [8000, 400],
  [15000, 800],
  [19000, 1000],
];

describe('Resonator', () => {
  for (const sr of [44100, 96000]) {
    it(`peaks within 1 percent of f and is bw wide at -3 dB within 5 percent, at ${sr}`, () => {
      for (const [f, bw] of CASES) {
        const h = impulseResponse(resonator(sr, f, bw), sr, bw);
        const { peak, width } = peakAndWidth(h, sr, f, bw);
        expect(Math.abs(peak - f) / f).toBeLessThan(0.01);
        expect(Math.abs(width - bw) / bw).toBeLessThan(0.05);
      }
    });
  }

  it('responds the same in Hz at 44100 and 96000 away from Nyquist', () => {
    for (const [f, bw] of CASES.slice(0, 6)) {
      const a = peakAndWidth(impulseResponse(resonator(44100, f, bw), 44100, bw), 44100, f, bw);
      const b = peakAndWidth(impulseResponse(resonator(96000, f, bw), 96000, bw), 96000, f, bw);
      expect(Math.abs(a.peak - b.peak) / f).toBeLessThan(0.001);
      expect(Math.abs(a.width - b.width) / bw).toBeLessThan(0.005);
    }
  });

  it('passes DC at unity gain, so a cascade keeps natural formant levels', () => {
    for (const sr of [44100, 96000]) {
      for (const [f, bw] of CASES) {
        const r = resonator(sr, f, bw);
        let y = 0;
        // Ten time constants of exp(-pi bw t) and then some.
        const n = Math.ceil((40 / (Math.PI * bw)) * sr);
        for (let i = 0; i < n; i++) y = r.next(1);
        expect(Math.abs(y - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('is a low-pass at frequency 0: 6 dB down at bw/2 and falling 12 dB an octave', () => {
    for (const sr of [44100, 96000]) {
      const bw = 200;
      const h = impulseResponse(resonator(sr, 0, bw), sr, bw);
      const dc = mag2(h, 0, sr);
      expect(Math.abs(db(dc))).toBeLessThan(1e-6);
      // A double real pole at bw/2: each pole is 3 dB down there.
      expect(Math.abs(db(mag2(h, bw / 2, sr)) + 6.0206)).toBeLessThan(0.02);
      const octave = db(mag2(h, 8 * bw, sr)) - db(mag2(h, 4 * bw, sr));
      expect(octave).toBeLessThan(-11);
      expect(octave).toBeGreaterThan(-12.5);
    }
  });

  it('ignores a non-finite setting and treats a non-finite sample as silence', () => {
    const sr = 44100;
    const ref = impulseResponse(resonator(sr, 1000, 80), sr, 80);
    for (const bad of [
      [NaN, 80],
      [1000, NaN],
      [Infinity, 80],
      [1000, -Infinity],
    ]) {
      const r = resonator(sr, 1000, 80);
      r.set(bad[0], bad[1]);
      const h = impulseResponse(r, sr, 80);
      for (let i = 0; i < h.length; i++) expect(h[i]).toBe(ref[i]);
    }
    const r = resonator(sr, 1000, 80);
    expect(r.next(NaN)).toBe(0);
    expect(r.next(Infinity)).toBe(0);
  });

  it('is stable and finite at every clamp, and decays after an impulse', () => {
    for (const sr of [44100, 96000]) {
      const settings: Array<[number, number]> = [
        [0, RESONATOR_MIN_BW],
        [RESONATOR_MAX_FREQ * sr, RESONATOR_MIN_BW],
        [1e12, 1e-12],
        [-500, -50],
        [1e-300, 1e300],
        [sr, sr],
        [0.5 * sr, 0],
      ];
      for (const [f, bw] of settings) {
        const r = resonator(sr, f, bw);
        // The slowest legal decay is the 1 Hz floor: exp(-pi t), so 12 s is e^-37.
        const n = 12 * sr;
        let early = 0;
        let late = 0;
        let nonFinite = 0;
        for (let i = 0; i < n; i++) {
          const y = r.next(i === 0 ? 1 : 0);
          if (!Number.isFinite(y)) nonFinite++;
          if (i < sr) early = Math.max(early, Math.abs(y));
          if (i >= n - sr) late = Math.max(late, Math.abs(y));
        }
        expect(nonFinite).toBe(0);
        expect(early).toBeGreaterThan(0);
        expect(late).toBeLessThan(early * 1e-12);
      }
    }
  });

  it('process() filters a range in place and leaves the rest alone', () => {
    const sr = 48000;
    const buf = new Float32Array(256);
    const want = new Float32Array(256);
    const noise = rng('resonator/process');
    for (let i = 0; i < buf.length; i++) buf[i] = want[i] = 2 * noise() - 1;
    const a = resonator(sr, 800, 100);
    const b = resonator(sr, 800, 100);
    a.process(buf, 64, 192);
    for (let i = 64; i < 192; i++) want[i] = b.next(want[i]);
    for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe(want[i]);
  });
});

describe('AntiResonator', () => {
  /*
   * Klatt's nasal pair, a formant-like zero, and the corners of the clamp.
   * Measured over one second of white noise through the cascade, the worst
   * sample error is 3.4e-13 everywhere except frequency 0 with the 1 Hz
   * floor, where A' = 1/A reaches 9e8 at 96000 and rounding grows to
   * 1.9e-9. Both are many orders inside 0.01 dB.
   */
  const PAIRS = (sr: number): Array<[number, number]> => [
    [270, 100],
    [450, 100],
    [1000, 50],
    [3000, 300],
    [RESONATOR_MAX_FREQ * sr, RESONATOR_MIN_BW],
    [0, RESONATOR_MIN_BW],
  ];

  it('cancels a resonator with the same f and bw: the cascade is flat within 0.01 dB', () => {
    for (const sr of [44100, 96000]) {
      for (const [f, bw] of PAIRS(sr)) {
        const r = resonator(sr, f, bw);
        const z = antiResonator(sr, f, bw);
        const cascade: Unit = {
          next: (x) => z.next(r.next(x)),
          reset: () => {
            r.reset();
            z.reset();
          },
        };
        const h = impulseResponse(cascade, sr, Math.max(bw, 50));
        for (let k = 0; k <= 64; k++) {
          const fq = (k / 64) * 0.49 * sr;
          expect(Math.abs(db(mag2(h, fq, sr)))).toBeLessThan(0.01);
        }
      }
    }
  });

  it('cancels sample by sample on noise, in either order', () => {
    const sr = 48000;
    const noise = rng('antiresonator/noise');
    for (const [f, bw] of PAIRS(sr)) {
      const r1 = resonator(sr, f, bw);
      const z1 = antiResonator(sr, f, bw);
      const r2 = resonator(sr, f, bw);
      const z2 = antiResonator(sr, f, bw);
      let worst = 0;
      for (let i = 0; i < sr; i++) {
        const x = 2 * noise() - 1;
        worst = Math.max(worst, Math.abs(z1.next(r1.next(x)) - x), Math.abs(r2.next(z2.next(x)) - x));
      }
      expect(worst).toBeLessThan(1e-8);
    }
  });

  it('notches f by exactly the height of the matching resonance, and passes DC at unity', () => {
    for (const sr of [44100, 96000]) {
      for (const [f, bw] of [
        [450, 100],
        [1500, 120],
        [3000, 300],
      ]) {
        const z = antiResonator(sr, f, bw);
        // FIR: three taps are the whole impulse response.
        const hz = new Float64Array([z.next(1), z.next(0), z.next(0)]);
        const hr = impulseResponse(resonator(sr, f, bw), sr, bw);
        expect(Math.abs(db(mag2(hz, f, sr)) + db(mag2(hr, f, sr)))).toBeLessThan(1e-6);
        expect(db(mag2(hz, f, sr))).toBeLessThan(-10);
        expect(Math.abs(hz[0] + hz[1] + hz[2] - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it('ignores a non-finite setting, treats a non-finite sample as silence, and stays finite at the clamps', () => {
    const sr = 44100;
    const z = antiResonator(sr, 450, 100);
    const ref = [z.next(1), z.next(0), z.next(0)];
    z.reset();
    z.set(NaN, 100);
    z.set(450, Infinity);
    expect([z.next(1), z.next(0), z.next(0)]).toEqual(ref);
    expect(z.next(NaN)).toBe(0);
    for (const [f, bw] of [
      [0, 0],
      [1e12, 1e-12],
      [-1, -1],
      [sr, 1e300],
    ]) {
      const u = antiResonator(sr, f, bw);
      const noise = rng('antiresonator/clamp');
      let nonFinite = 0;
      for (let i = 0; i < 4096; i++) if (!Number.isFinite(u.next(2 * noise() - 1))) nonFinite++;
      expect(nonFinite).toBe(0);
    }
  });
});

describe('higherPoleCorrection', () => {
  /*
   * Men's vowels with F5 at 4500 Hz: the uniform tube with Klatt's Table I
   * bandwidths (Klatt 1980, Fig. 9a), and /i/, /ɑ/, /u/ with Hillenbrand et
   * al. (1995) men's F1 to F3, Klatt's Table II B1 to B3, an F4 near 3.8 kHz
   * and his Table I B4 and B5. A scale stands for a shorter tract: every
   * frequency and bandwidth times it, the 10 kHz reference rate too.
   */
  const VOWELS: Array<{ name: string; f: number[]; b: number[] }> = [
    { name: 'ə', f: [500, 1500, 2500, 3500, 4500], b: [50, 70, 110, 250, 200] },
    { name: 'i', f: [342, 2322, 3000, 3906, 4500], b: [45, 200, 400, 250, 200] },
    { name: 'ɑ', f: [768, 1333, 2522, 3996, 4500], b: [130, 70, 160, 250, 200] },
    { name: 'u', f: [378, 997, 2343, 3728, 4500], b: [65, 110, 140, 250, 200] },
  ];

  /** R1 to R5, then the correction for `sr` when asked, as one unit. */
  function cascade(sr: number, v: { f: number[]; b: number[] }, scale: number, corrected: boolean): Unit {
    const units: Resonator[] = v.f.map((f, k) => resonator(sr, f * scale, v.b[k] * scale));
    if (corrected) {
      const hpc = higherPoleCorrection(sr);
      for (let k = 0; k < hpc.stages; k++) units.push(resonator(sr, hpc.hz * scale, hpc.bw * scale));
    }
    return {
      next(x: number) {
        let y = x;
        for (const u of units) y = u.next(y);
        return y;
      },
      reset() {
        for (const u of units) u.reset();
      },
    };
  }

  /** Gain in dB at f of the cascade at `sr`, against the same cascade at 10 kHz times `scale`. */
  function errorAt(sr: number, v: { f: number[]; b: number[] }, scale: number, corrected: boolean) {
    const narrow = Math.min(...v.b) * scale;
    const h = impulseResponse(cascade(sr, v, scale, corrected), sr, narrow);
    const ref = 10000 * scale;
    const href = impulseResponse(cascade(ref, v, scale, false), ref, narrow);
    return (f: number) => db(mag2(h, f, sr)) - db(mag2(href, f, ref));
  }

  it('puts the five formants back on their 10 kHz levels at 44100, 48000 and 96000', () => {
    for (const sr of [44100, 48000, 96000]) {
      for (const v of VOWELS) {
        for (const scale of [1, 1.16]) {
          const fixed = errorAt(sr, v, scale, true);
          const bare = errorAt(sr, v, scale, false);
          const label = `${v.name} at ${sr}, scale ${scale}`;
          let sum = 0;
          let n = 0;
          for (let f = 250; f <= 4500; f += 250) {
            sum += Math.abs(fixed(f * scale));
            n++;
          }
          expect(sum / n, `${label}: mean error`).toBeLessThan(2);
          for (let k = 0; k < 4; k++) expect(Math.abs(fixed(v.f[k] * scale)), `${label}: F${k + 1}`).toBeLessThan(3.5);
          // what it corrects: without it F4 sits far under its 10 kHz level
          expect(bare(v.f[3] * scale), `${label}: F4 uncorrected`).toBeLessThan(-15);
        }
      }
    }
  });

  it('takes fewer stages at lower rates, none at 11025, and keeps every stage under the clamp', () => {
    expect(higherPoleCorrection(11025).stages).toBe(0);
    expect(higherPoleCorrection(8000).stages).toBe(0);
    for (const sr of [16000, 22050, 32000]) {
      const v = VOWELS[0];
      const fixed = errorAt(sr, v, 1, true);
      const bare = errorAt(sr, v, 1, false);
      for (const k of [2, 3]) {
        expect(Math.abs(fixed(v.f[k])), `F${k + 1} at ${sr}`).toBeLessThan(Math.abs(bare(v.f[k])) / 2);
        expect(Math.abs(fixed(v.f[k])), `F${k + 1} at ${sr}`).toBeLessThan(7);
      }
    }
    // a child's tract is about 1.34 times a man's in frequency: its stages still fit
    for (const sr of [14000, 16000, 19000, 22050, 28000, 32000, 40000, 44100, 48000, 96000, 192000]) {
      const hpc = higherPoleCorrection(sr);
      expect(hpc.stages).toBeGreaterThan(0);
      expect(hpc.hz * 1.34).toBeLessThan(RESONATOR_MAX_FREQ * sr);
    }
  });
});
