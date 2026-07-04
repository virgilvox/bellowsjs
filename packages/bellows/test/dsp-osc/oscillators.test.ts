import { describe, expect, it } from 'vitest';
import { BlepOscillator, SineOscillator } from '../../src/dsp/oscillators';
import { correlation, measureAliasing, zeroCrossings } from './spectrum';

const SR = 44100;
const N = 16384;

function render(osc: BlepOscillator, n = N): Float32Array {
  const out = new Float32Array(n);
  osc.process(out, 0, n);
  return out;
}

function naiveSaw(freq: number, n = N): Float32Array {
  const out = new Float32Array(n);
  const dt = freq / SR;
  let t = 0;
  for (let i = 0; i < n; i++) {
    out[i] = 2 * t - 1;
    t += dt;
    if (t >= 1) t -= 1;
  }
  return out;
}

describe('BlepOscillator antialiasing', () => {
  it('keeps saw aliases at least 40 dB under the fundamental at 2637 Hz', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('saw');
    osc.setFreq(2637);
    const blep = measureAliasing(render(osc), SR, 2637);
    expect(blep.worstAliasRelDb).toBeLessThan(-40);
  });

  it('improves on a naive saw by at least 20 dB', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('saw');
    osc.setFreq(2637);
    const blep = measureAliasing(render(osc), SR, 2637);
    const naive = measureAliasing(naiveSaw(2637), SR, 2637);
    // sanity: the naive saw really does alias badly
    expect(naive.worstAliasRelDb).toBeGreaterThan(-30);
    expect(blep.worstAliasRelDb).toBeLessThan(naive.worstAliasRelDb - 20);
  });

  it('suppresses square aliases at high frequency', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('square');
    osc.setFreq(2637);
    const rep = measureAliasing(render(osc), SR, 2637);
    expect(rep.worstAliasRelDb).toBeLessThan(-40);
  });

  it('suppresses triangle aliases at high frequency', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('triangle');
    osc.setFreq(2637);
    const rep = measureAliasing(render(osc), SR, 2637);
    // triangle harmonics fall at 1/k^2 so residual aliasing is tiny
    expect(rep.worstAliasRelDb).toBeLessThan(-55);
  });
});

describe('BlepOscillator shapes', () => {
  it('matches the ideal saw at low frequency', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('saw');
    osc.setFreq(110);
    const got = render(osc, 8192);
    const want = naiveSaw(110, 8192);
    // the bandlimited saw only differs near the wrap, where the BLEP
    // smears the step across the kernel span
    expect(correlation(got, want)).toBeGreaterThan(0.98);
  });

  it('matches the ideal triangle at low frequency', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('triangle');
    osc.setFreq(110);
    const got = render(osc, 8192);
    const want = new Float32Array(8192);
    let t = 0;
    const dt = 110 / SR;
    for (let i = 0; i < want.length; i++) {
      want[i] = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
      t += dt;
      if (t >= 1) t -= 1;
    }
    expect(correlation(got, want)).toBeGreaterThan(0.999);
  });

  it('respects pulse width in the square duty cycle', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('square');
    osc.setFreq(220);
    osc.setPulseWidth(0.25);
    const out = render(osc, SR);
    let mean = 0;
    for (let i = 0; i < out.length; i++) mean += out[i];
    mean /= out.length;
    // duty 25 percent: mean of +1/-1 wave is 2 * 0.25 - 1 = -0.5
    expect(mean).toBeCloseTo(-0.5, 1);
  });

  it('produces a pure tone on the sine shape', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('sine');
    osc.setFreq(1000);
    const rep = measureAliasing(render(osc), SR, 1000);
    expect(rep.worstAliasRelDb).toBeLessThan(-80);
  });

  it('oscillates at the requested frequency', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('saw');
    osc.setFreq(441);
    const out = render(osc, SR); // one second
    // a saw crosses zero twice per cycle
    expect(zeroCrossings(out)).toBeGreaterThan(441 * 2 - 4);
    expect(zeroCrossings(out)).toBeLessThan(441 * 2 + 4);
  });

  it('is deterministic across reset', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('square');
    osc.setFreq(333);
    osc.setPulseWidth(0.3);
    const a = render(osc, 512);
    osc.reset();
    const b = render(osc, 512);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('reset accepts a starting phase', () => {
    const osc = new BlepOscillator(SR);
    osc.setShape('saw');
    osc.setFreq(100);
    osc.reset(0.5);
    // naive saw value at phase 0.5 is 0, far from any discontinuity
    expect(osc.next()).toBeCloseTo(0, 5);
  });

  it('process only writes inside [from, to)', () => {
    const osc = new BlepOscillator(SR);
    osc.setFreq(1000);
    const out = new Float32Array(64).fill(7);
    osc.process(out, 16, 48);
    expect(out[15]).toBe(7);
    expect(out[48]).toBe(7);
    expect(out[16]).not.toBe(7);
  });
});

describe('SineOscillator', () => {
  it('runs at the requested frequency', () => {
    const osc = new SineOscillator(SR);
    osc.setFreq(441);
    const out = new Float32Array(SR);
    for (let i = 0; i < out.length; i++) out[i] = osc.next();
    expect(zeroCrossings(out)).toBeGreaterThan(441 * 2 - 4);
    expect(zeroCrossings(out)).toBeLessThan(441 * 2 + 4);
  });

  it('stays within [-1, 1] and starts at sin(0)', () => {
    const osc = new SineOscillator(SR);
    osc.setFreq(1234.5);
    expect(osc.next()).toBeCloseTo(0, 10);
    for (let i = 0; i < 10000; i++) {
      const v = osc.next();
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('nextPm offsets phase in radians', () => {
    const a = new SineOscillator(SR);
    const b = new SineOscillator(SR);
    a.setFreq(200);
    b.setFreq(200);
    // constant pm of pi/2 turns sine into cosine
    for (let i = 0; i < 100; i++) {
      const ya = a.nextPm(Math.PI / 2);
      const yb = b.next();
      const t = i * (200 / SR);
      expect(ya).toBeCloseTo(Math.cos(2 * Math.PI * t), 6);
      expect(yb).toBeCloseTo(Math.sin(2 * Math.PI * t), 6);
    }
  });

  it('nextPm(0) matches next()', () => {
    const a = new SineOscillator(SR);
    const b = new SineOscillator(SR);
    a.setFreq(777);
    b.setFreq(777);
    for (let i = 0; i < 256; i++) expect(a.nextPm(0)).toBe(b.next());
  });
});
