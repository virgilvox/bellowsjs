/*
 * The geometric glottis (dsp/geometric-glottis.ts): the closed-form edge
 * integral against a brute-force one, the area at rest and at full swing,
 * and what the phase lag between the edges and the skew do to the pulse.
 */

import { describe, expect, it } from 'vitest';
import { GeometricGlottis, edgeOpen } from '../../src/dsp/geometric-glottis';
import { GlottalSource } from '../../src/dsp/glottal';
import { rng } from '../../src/core/prng';

/** The integral over u in [0, 1] of max(a (1 - u) + b sin(pi u), 0), by the midpoint rule. */
function brute(a: number, b: number): number {
  const n = 200000;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const f = a * (1 - u) + b * Math.sin(Math.PI * u);
    if (f > 0) s += f;
  }
  return s / n;
}

/** A source with no perturbation: exact pitch, unit amplitude. */
function cleanSource(sr: number, hz: number): GlottalSource {
  const src = new GlottalSource(sr, rng('geo'));
  src.setDrift(0);
  src.setJitter(0);
  src.setShimmer(0);
  src.setDiplophonia(0);
  src.setChaos(0);
  src.setFreq(hz);
  return src;
}

/** One second of area from a glottis with these settings, after the first 0.2 s. */
function areas(set: Partial<GeometricGlottis>, hz = 100, sr = 48000): Float64Array {
  const g = new GeometricGlottis();
  Object.assign(g, { xRest1: 0, xRest2: 0, chink: 0, xMax: 0.1, length: 1.6, lag: 0, skew: 0, doublePulse: 0 }, set);
  const src = cleanSource(sr, hz);
  const out = new Float64Array(sr);
  g.process(src, out, 0, Math.round(0.2 * sr));
  g.process(src, out, 0, sr);
  return out;
}

describe('GeometricGlottis', () => {
  it('integrates an edge in closed form: within 1e-5 cm of a brute-force integral, open, shut or partly closed', () => {
    const r = rng('edges');
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const a = (r() - 0.5) * 0.2;
      const b = (r() - 0.5) * 0.4;
      worst = Math.max(worst, Math.abs(edgeOpen(a, b) - brute(a, b)));
    }
    // and the boundaries: a full triangle, nothing, the root entering at either end
    for (const [a, b] of [[0.03, 0], [-0.03, 0], [0, 0.1], [0, -0.1], [0.03, -0.03 / Math.PI], [-0.03, 0.03 / Math.PI]]) {
      worst = Math.max(worst, Math.abs(edgeOpen(a, b) - brute(a, b)));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('rests at L x_rest plus the chink, and opens to 2 L (2 / pi) x_max with straight edges', () => {
    const rest = areas({ xRest1: 0.03, xRest2: 0.06, chink: 0.01, xMax: 0 });
    expect(rest[1000]).toBeCloseTo(1.6 * 0.03 + 0.01, 9);
    const swing = areas({ xMax: 0.1 });
    let mx = 0;
    for (const v of swing) mx = Math.max(mx, v);
    expect(mx).toBeCloseTo((2 * 1.6 * 2 * 0.1) / Math.PI, 3);
  });

  it('closes for longer the more the upper edge lags: open for half the cycle less the lag', () => {
    const open = (lagDeg: number) => {
      const a = areas({ lag: lagDeg / 360 });
      let n = 0;
      for (const v of a) if (v > 1e-9) n++;
      return n / a.length;
    };
    expect(open(0)).toBeCloseTo(0.5, 2);
    expect(open(50)).toBeCloseTo(0.5 - 50 / 360, 2);
    expect(open(70)).toBeCloseTo(0.5 - 70 / 360, 2);
  });

  it('lags the upper edge: the glottis opens later by the lag and closes when the lower edge does', () => {
    // the first opening and the closing after it, in samples (100 Hz: 480 a cycle)
    const crossings = (lagDeg: number, from: number) => {
      const a = areas({ lag: lagDeg / 360 });
      let open = from;
      while (!(a[open - 1] <= 1e-12 && a[open] > 1e-12)) open++;
      let shut = open;
      while (a[shut] > 1e-12) shut++;
      return { open, shut };
    };
    const none = crossings(0, 960);
    const lag = crossings(70, none.open - 20);
    // the same source from the same start: the open phase loses its first 70 degrees, not its last
    expect(lag.shut - none.shut).toBe(0);
    expect(lag.open - none.open).toBeCloseTo((70 / 360) * 480, -1);
  });

  it('double pulses: every second cycle peaks lower, by the fraction d', () => {
    const a = areas({ doublePulse: 0.2 }, 100);
    // one peak a cycle (480 samples), skipping the first
    const peaks: number[] = [];
    for (let c = 1; c < 9; c++) {
      let mx = 0;
      for (let i = c * 480; i < (c + 1) * 480; i++) mx = Math.max(mx, a[i]);
      peaks.push(mx);
    }
    for (let c = 1; c < peaks.length; c++) {
      const lo = Math.min(peaks[c], peaks[c - 1]);
      const hi = Math.max(peaks[c], peaks[c - 1]);
      expect(lo / hi).toBeCloseTo(0.8, 2);
    }
    const flat = areas({ doublePulse: 0 }, 100);
    let p0 = 0;
    let p1 = 0;
    for (let i = 480; i < 960; i++) p0 = Math.max(p0, flat[i]);
    for (let i = 960; i < 1440; i++) p1 = Math.max(p1, flat[i]);
    expect(p1 / p0).toBeCloseTo(1, 6);
  });

  it('skews the pulse to the right for s > 0: the peak moves from a quarter of the cycle toward (1 + s) / 4', () => {
    const peakAt = (skew: number) => {
      const a = areas({ skew }, 100);
      // one cycle is 480 samples; find the peak in the cycle starting at a closed-to-open crossing
      let start = 1;
      while (!(a[start - 1] <= 1e-12 && a[start] > 1e-12)) start++;
      let best = start;
      for (let i = start; i < start + 480; i++) if (a[i] > a[best]) best = i;
      return (best - start) / 480;
    };
    expect(peakAt(0)).toBeCloseTo(0.25, 2);
    expect(peakAt(0.4)).toBeCloseTo(0.35, 2);
  });

  it('a slightly open glottis never quite closes: the posterior triangle stays open while the front zips shut', () => {
    const a = areas({ xRest1: 0.03, xRest2: 0.06, lag: 70 / 360, chink: 0 });
    let mn = Infinity;
    for (const v of a) mn = Math.min(mn, v);
    expect(mn).toBeGreaterThan(0);
    expect(mn).toBeLessThan(0.01 * 1.6 * 0.03 * 10);
  });

  it('ramps its inputs over a call: a new rest displacement arrives without a step', () => {
    const g = new GeometricGlottis();
    Object.assign(g, { xRest1: 0.01, xRest2: 0.01, chink: 0, xMax: 0 });
    const src = cleanSource(48000, 100);
    const out = new Float64Array(64);
    g.process(src, out, 0, 32);
    g.xRest1 = g.xRest2 = 0.05;
    g.process(src, out, 32, 64);
    let step = 0;
    for (let i = 1; i < 64; i++) step = Math.max(step, Math.abs(out[i] - out[i - 1]));
    expect(step).toBeLessThan((1.6 * 0.04) / 16);
    expect(out[63]).toBeCloseTo(1.6 * 0.05, 9);
  });
});
