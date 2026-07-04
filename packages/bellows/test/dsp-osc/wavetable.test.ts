import { describe, expect, it } from 'vitest';
import {
  classicWavetables,
  WavetableOscillator,
  WavetableSet,
} from '../../src/dsp/wavetable';
import { correlation, magnitudeSpectrum, measureAliasing, zeroCrossings } from './spectrum';

const SR = 44100;
const N = 16384;

function render(osc: WavetableOscillator, n = N): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = osc.next();
  return out;
}

function sineFrame(len: number, harmonic: number): Float32Array {
  const f = new Float32Array(len);
  for (let i = 0; i < len; i++) f[i] = Math.sin((2 * Math.PI * harmonic * i) / len);
  return f;
}

describe('WavetableSet.fromFrames', () => {
  it('rejects empty input, non power of two, and mismatched lengths', () => {
    expect(() => WavetableSet.fromFrames([], SR)).toThrow();
    expect(() => WavetableSet.fromFrames([new Float32Array(1000)], SR)).toThrow();
    expect(() =>
      WavetableSet.fromFrames([new Float32Array(256), new Float32Array(512)], SR),
    ).toThrow();
  });

  it('reports frameCount', () => {
    const set = WavetableSet.fromFrames([sineFrame(256, 1), sineFrame(256, 2)], SR);
    expect(set.frameCount).toBe(2);
  });

  it('reproduces a pure sine frame unchanged at the top level', () => {
    const frame = sineFrame(256, 1);
    const set = WavetableSet.fromFrames([frame], SR);
    const osc = new WavetableOscillator(SR, set);
    osc.setFreq(SR / 256); // one table sample per output sample
    const out = render(osc, 256);
    expect(correlation(out, frame)).toBeGreaterThan(0.99999);
  });
});

describe('WavetableOscillator antialiasing', () => {
  it('keeps saw aliases at least 40 dB under the fundamental at 2637 Hz', () => {
    const { saw } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, saw);
    osc.setFreq(2637);
    const rep = measureAliasing(render(osc), SR, 2637);
    expect(rep.worstAliasRelDb).toBeLessThan(-40);
  });

  it('keeps square aliases down as well', () => {
    const { square } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, square);
    osc.setFreq(2637);
    const rep = measureAliasing(render(osc), SR, 2637);
    expect(rep.worstAliasRelDb).toBeLessThan(-40);
  });

  it('emits no partials above Nyquist even at very high pitch', () => {
    const { saw } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, saw);
    osc.setFreq(9000);
    const rep = measureAliasing(render(osc), SR, 9000);
    expect(rep.worstAliasRelDb).toBeLessThan(-40);
  });
});

describe('WavetableOscillator classic shapes', () => {
  it('saw matches the ideal ramp at low frequency', () => {
    const { saw } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, saw);
    osc.setFreq(110);
    const got = render(osc, 8192);
    const want = new Float32Array(8192);
    let t = 0;
    for (let i = 0; i < want.length; i++) {
      want[i] = 2 * t - 1;
      t += 110 / SR;
      if (t >= 1) t -= 1;
    }
    expect(correlation(got, want)).toBeGreaterThan(0.99);
  });

  it('triangle matches the ideal triangle at low frequency', () => {
    const { triangle } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, triangle);
    osc.setFreq(110);
    const got = render(osc, 8192);
    const want = new Float32Array(8192);
    let t = 0;
    for (let i = 0; i < want.length; i++) {
      // series used rises through 0 at t = 0 with peak at t = 0.25
      want[i] = t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4;
      t += 110 / SR;
      if (t >= 1) t -= 1;
    }
    expect(correlation(got, want)).toBeGreaterThan(0.999);
  });

  it('square has near unit amplitude and 50 percent duty', () => {
    const { square } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, square);
    osc.setFreq(110);
    const out = render(osc, 8192);
    let mean = 0;
    for (let i = 0; i < out.length; i++) mean += out[i];
    expect(Math.abs(mean / out.length)).toBeLessThan(0.05);
    // away from edges the plateau sits near 1
    const sorted = Array.from(out).sort((a, b) => a - b);
    expect(Math.abs(sorted[Math.floor(sorted.length * 0.25)])).toBeGreaterThan(0.9);
  });

  it('runs at the requested frequency', () => {
    const { saw } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, saw);
    osc.setFreq(441);
    const out = render(osc, SR);
    expect(zeroCrossings(out)).toBeGreaterThan(441 * 2 - 6);
    expect(zeroCrossings(out)).toBeLessThan(441 * 2 + 6);
  });
});

describe('WavetableOscillator position scanning', () => {
  const len = 1024;
  const set = WavetableSet.fromFrames([sineFrame(len, 1), sineFrame(len, 2)], SR);

  it('position 0 plays the first frame', () => {
    const osc = new WavetableOscillator(SR, set);
    osc.setFreq(100);
    osc.setPosition(0);
    const out = render(osc, SR);
    expect(zeroCrossings(out)).toBeGreaterThan(100 * 2 - 4);
    expect(zeroCrossings(out)).toBeLessThan(100 * 2 + 4);
  });

  it('position 1 plays the last frame (second harmonic, double rate)', () => {
    const osc = new WavetableOscillator(SR, set);
    osc.setFreq(100);
    osc.setPosition(1);
    const out = render(osc, SR);
    expect(zeroCrossings(out)).toBeGreaterThan(200 * 2 - 4);
    expect(zeroCrossings(out)).toBeLessThan(200 * 2 + 4);
  });

  it('position 0.5 blends both frames equally', () => {
    const osc = new WavetableOscillator(SR, set);
    osc.setFreq(SR / N); // fundamental lands exactly on a DFT bin
    osc.setPosition(0.5);
    const mags = magnitudeSpectrum(render(osc));
    // fundamental at bin 1 region and second harmonic at bin 2 region
    const f0 = mags[1];
    const f1 = mags[2];
    expect(f1 / f0).toBeGreaterThan(0.8);
    expect(f1 / f0).toBeLessThan(1.25);
  });

  it('setTable switches sets and keeps the frequency', () => {
    const { saw, square } = classicWavetables(SR);
    const osc = new WavetableOscillator(SR, saw);
    osc.setFreq(441);
    render(osc, 100);
    osc.setTable(square);
    const out = render(osc, SR);
    expect(zeroCrossings(out)).toBeGreaterThan(441 * 2 - 6);
    expect(zeroCrossings(out)).toBeLessThan(441 * 2 + 6);
  });

  it('replays identically after reset', () => {
    const osc = new WavetableOscillator(SR, set);
    osc.setFreq(555);
    osc.setPosition(0.3);
    const a = render(osc, 1024);
    osc.reset();
    const b = render(osc, 1024);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});

describe('WavetableSet mip levels', () => {
  it('picks lower resolution levels as frequency rises', () => {
    const { saw } = classicWavetables(SR);
    expect(saw.levelFor(20)).toBe(0);
    expect(saw.levelFor(2637)).toBeGreaterThan(saw.levelFor(220));
    expect(saw.levelFor(20000)).toBe(saw.maxHarm.length - 1);
  });

  it('keeps strictly decreasing harmonic counts down to 1', () => {
    const set = WavetableSet.fromFrames([sineFrame(512, 1)], SR);
    for (let i = 1; i < set.maxHarm.length; i++) {
      expect(set.maxHarm[i]).toBeLessThan(set.maxHarm[i - 1]);
    }
    expect(set.maxHarm[set.maxHarm.length - 1]).toBe(1);
  });
});
