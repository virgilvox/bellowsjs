import { describe, expect, it } from 'vitest';
import { granularEngine, makeGranularEngine } from '../../src/engines/granular';
import {
  cents,
  countDiffs,
  countNonFinite,
  magSpectrum,
  maxAbs,
  mono,
  peakFreq,
  renderVoice,
  rms,
} from './helpers';

const SR = 44100;

function sineBuffer(freq: number, seconds = 1, rate = 44100): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

describe('granular engine', () => {
  it('produces sound from the default test tone', () => {
    const { l, r } = renderVoice(granularEngine, { seconds: 0.8, gate: 0.8 });
    const m = mono(l, r);
    expect(rms(m, Math.round(0.1 * SR), Math.round(0.7 * SR))).toBeGreaterThan(0.01);
    expect(countNonFinite(l)).toBe(0);
    expect(maxAbs(l)).toBeLessThan(3);
  });

  it('is deterministic per seed and varies across seeds', () => {
    const params = { spray: 0.3, pitchJitter: 3, spread: 1, reverse: 0.5 };
    const a = renderVoice(granularEngine, { seed: 'g1', seconds: 0.6, params });
    const b = renderVoice(granularEngine, { seed: 'g1', seconds: 0.6, params });
    const c = renderVoice(granularEngine, { seed: 'g2', seconds: 0.6, params });
    expect(countDiffs(a.l, b.l)).toBe(0);
    expect(countDiffs(a.r, b.r)).toBe(0);
    expect(countDiffs(a.l, c.l)).toBeGreaterThan(100);
  });

  it('low density leaves gaps, high density fills them', () => {
    const count = (density: number) => {
      const { l, r } = renderVoice(granularEngine, {
        seconds: 0.8,
        gate: 0.8,
        params: { density, grainSize: 15, spray: 0 },
      });
      const m = mono(l, r);
      let quiet = 0;
      for (let i = Math.round(0.1 * SR); i < m.length; i++) {
        if (Math.abs(m[i]) < 1e-4) quiet++;
      }
      return quiet / (m.length - Math.round(0.1 * SR));
    };
    expect(count(3)).toBeGreaterThan(0.4);
    expect(count(120)).toBeLessThan(0.05);
  });

  it('position selects the region of the buffer', () => {
    const buf = new Float32Array(44100);
    const tone = sineBuffer(330);
    for (let i = 22050; i < 44100; i++) buf[i] = tone[i];
    const engine = makeGranularEngine(buf, 44100, 'granular-split');
    const render = (position: number) => {
      const { l, r } = renderVoice(engine, {
        seconds: 0.6,
        gate: 0.6,
        params: { position, spray: 0, grainSize: 60 },
      });
      return rms(mono(l, r), Math.round(0.1 * SR), Math.round(0.5 * SR));
    };
    expect(render(0.2)).toBeLessThan(1e-4);
    expect(render(0.75)).toBeGreaterThan(0.02);
  });

  it('pitch param transposes the grain playback', () => {
    // Grain onset overlap amplitude-modulates the tone, which biases an
    // autocorrelation period, so the pitch lands on the spectral peak.
    const size = 32768;
    const engine = makeGranularEngine(sineBuffer(220), 44100, 'granular-sine');
    const measure = (pitch: number, expected: number) => {
      const { l, r } = renderVoice(engine, {
        seconds: 0.9,
        gate: 0.9,
        params: { pitch, spread: 0, spray: 0, grainSize: 200, density: 30, position: 0.3 },
      });
      const mags = magSpectrum(mono(l, r), Math.round(0.1 * SR), size);
      return peakFreq(mags, SR, size, expected * 0.85, expected * 1.15);
    };
    expect(Math.abs(cents(measure(1, 220), 220))).toBeLessThan(30);
    expect(Math.abs(cents(measure(2, 440), 440))).toBeLessThan(30);
  });

  it('noteOn frequency transposes relative to baseNote', () => {
    const size = 32768;
    const engine = makeGranularEngine(sineBuffer(220), 44100, 'granular-sine2');
    const { l, r } = renderVoice(engine, {
      freq: 880, // one octave above baseNote 69, so rate 2
      seconds: 0.9,
      gate: 0.9,
      params: { spread: 0, spray: 0, grainSize: 200, density: 30, position: 0.3 },
    });
    const mags = magSpectrum(mono(l, r), Math.round(0.1 * SR), size);
    const f = peakFreq(mags, SR, size, 380, 500);
    expect(Math.abs(cents(f, 440))).toBeLessThan(30);
  });

  it('spread widens the stereo image', () => {
    const narrow = renderVoice(granularEngine, {
      seconds: 0.5,
      params: { spread: 0, density: 40 },
    });
    const wide = renderVoice(granularEngine, {
      seconds: 0.5,
      params: { spread: 1, density: 40 },
    });
    expect(countDiffs(narrow.l, narrow.r)).toBe(0);
    expect(countDiffs(wide.l, wide.r)).toBeGreaterThan(100);
  });

  it('reverse grains still read within bounds', () => {
    const { l } = renderVoice(granularEngine, {
      seconds: 0.8,
      params: { reverse: 1, spray: 1, pitchJitter: 12, grainSize: 400, density: 80 },
    });
    expect(countNonFinite(l)).toBe(0);
    expect(maxAbs(l)).toBeLessThan(3);
  });

  it('finishes its grain tail after noteOff and frees the voice', () => {
    const { l, r, voice } = renderVoice(granularEngine, {
      seconds: 1.5,
      gate: 0.4,
      params: { grainSize: 100, density: 30 },
    });
    const m = mono(l, r);
    expect(rms(m, Math.round(1.0 * SR), Math.round(1.5 * SR))).toBeLessThan(1e-4);
    expect(voice.active).toBe(false);
  });
});
