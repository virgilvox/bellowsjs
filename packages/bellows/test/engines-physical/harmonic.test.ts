import { describe, expect, it } from 'vitest';
import { harmonicEngine, HarmonicVoice } from '../../src/engines/harmonic';
import { rng } from '../../src/core/prng';
import {
  cents,
  countDiffs,
  countNonFinite,
  defaultParams,
  estimateFreq,
  goertzel,
  magSpectrum,
  maxAbs,
  mono,
  renderVoice,
  rms,
  spectralCentroid,
} from './helpers';

const SR = 44100;
const SIZE = 16384;

describe('harmonic engine', () => {
  it('plays in tune', () => {
    const { l, r } = renderVoice(harmonicEngine, {
      freq: 440,
      seconds: 0.8,
      gate: 0.8,
      params: { noiseMix: 0 },
    });
    const m = mono(l, r);
    const est = estimateFreq(m, SR, Math.round(0.2 * SR), Math.round(0.7 * SR), 440);
    expect(Math.abs(cents(est.freq, 440))).toBeLessThan(2);
    expect(est.peak).toBeGreaterThan(0.95);
  });

  it('brightness tilts the spectral centroid', () => {
    const render = (brightness: number) => {
      const { l, r } = renderVoice(harmonicEngine, {
        freq: 220,
        seconds: 0.7,
        gate: 0.7,
        params: { brightness, noiseMix: 0 },
      });
      return spectralCentroid(magSpectrum(mono(l, r), Math.round(0.2 * SR), SIZE), SR, SIZE);
    };
    expect(render(0.9)).toBeGreaterThan(render(0.1) * 2);
  });

  it('evenOdd 0 suppresses even harmonics', () => {
    const render = (evenOdd: number) => {
      const { l, r } = renderVoice(harmonicEngine, {
        freq: 220,
        seconds: 0.7,
        gate: 0.7,
        params: { evenOdd, noiseMix: 0, brightness: 0.8 },
      });
      const m = mono(l, r);
      const from = Math.round(0.2 * SR);
      const to = Math.round(0.6 * SR);
      return goertzel(m, SR, 440, from, to) / goertzel(m, SR, 220, from, to);
    };
    expect(render(0)).toBeLessThan(render(0.5) * 0.05);
  });

  it('formantShift moves the rolloff corner independent of f0', () => {
    const render = (formantShift: number) => {
      const { l, r } = renderVoice(harmonicEngine, {
        freq: 220,
        seconds: 0.7,
        gate: 0.7,
        params: { formantShift, noiseMix: 0, brightness: 1 },
      });
      return spectralCentroid(magSpectrum(mono(l, r), Math.round(0.2 * SR), SIZE), SR, SIZE);
    };
    expect(render(2)).toBeGreaterThan(render(0.5) * 1.4);
  });

  it('noiseMix and noiseColor shape the noise band', () => {
    const breathy = renderVoice(harmonicEngine, {
      freq: 220,
      seconds: 0.7,
      gate: 0.7,
      params: { noiseMix: 1, noiseColor: 1 },
    });
    const m = mono(breathy.l, breathy.r);
    const est = estimateFreq(m, SR, Math.round(0.2 * SR), Math.round(0.6 * SR), 220);
    expect(est.peak).toBeLessThan(0.9);

    const render = (noiseColor: number) => {
      const { l, r } = renderVoice(harmonicEngine, {
        freq: 220,
        seconds: 0.7,
        gate: 0.7,
        params: { noiseMix: 1, noiseColor },
      });
      return spectralCentroid(magSpectrum(mono(l, r), Math.round(0.2 * SR), SIZE), SR, SIZE);
    };
    expect(render(8)).toBeGreaterThan(render(1) * 1.5);
  });

  it('portamento glides between legato notes', () => {
    const voice = harmonicEngine.createVoice(
      SR,
      { ...defaultParams(harmonicEngine), noiseMix: 0, portamento: 0.15 },
      rng('port')
    );
    const n = Math.round(1.2 * SR);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    voice.noteOn(220, 1);
    for (let i = 0; i < Math.round(0.3 * SR); i += 128) {
      voice.process(l, r, i, Math.min(i + 128, Math.round(0.3 * SR)));
    }
    voice.noteOn(440, 1);
    for (let i = Math.round(0.3 * SR); i < n; i += 128) {
      voice.process(l, r, i, Math.min(i + 128, n));
    }
    const m = mono(l, r);
    // Shortly after the second noteOn the pitch is still in transit.
    const midFrom = Math.round(0.33 * SR);
    const mid = estimateFreq(m, SR, midFrom, midFrom + Math.round(0.05 * SR), 300).freq;
    expect(mid).toBeGreaterThan(240);
    expect(mid).toBeLessThan(420);
    // Well past the glide it has nearly arrived (the glide is a one
    // pole, so it approaches the target exponentially).
    const lateFrom = Math.round(1.0 * SR);
    const late = estimateFreq(m, SR, lateFrom, lateFrom + Math.round(0.1 * SR), 440).freq;
    expect(Math.abs(cents(late, 440))).toBeLessThan(20);
  });

  it('setControlFrame drives the voice directly', () => {
    const voice = harmonicEngine.createVoice(
      SR,
      { ...defaultParams(harmonicEngine), noiseMix: 0, portamento: 0 },
      rng('frame')
    ) as HarmonicVoice;
    const n = Math.round(1.0 * SR);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    const harmonics = new Float32Array([1]);
    // Frame-driven from silence: no noteOn at all.
    const frameEvery = 128;
    for (let i = 0; i < n; i += frameEvery) {
      const t = i / SR;
      if (t < 0.7) voice.setControlFrame(550, 0.6, harmonics);
      else if (t < 0.7 + frameEvery / SR) voice.noteOff();
      voice.process(l, r, i, Math.min(i + frameEvery, n));
    }
    const m = mono(l, r);
    const from = Math.round(0.2 * SR);
    const to = Math.round(0.6 * SR);
    const est = estimateFreq(m, SR, from, to, 550);
    expect(Math.abs(cents(est.freq, 550))).toBeLessThan(3);
    // Single-harmonic frame: the second partial is absent.
    const h2 = goertzel(m, SR, 1100, from, to);
    const h1 = goertzel(m, SR, 550, from, to);
    expect(h2).toBeLessThan(h1 * 0.02);
    // Fades out after noteOff and frees the voice.
    expect(rms(m, Math.round(0.9 * SR), n)).toBeLessThan(1e-3);
    expect(voice.active).toBe(false);
  });

  it('is finite, bounded, and deterministic', () => {
    const params = { noiseMix: 0.4, brightness: 1 };
    const a = renderVoice(harmonicEngine, { seed: 'h1', seconds: 0.6, params });
    const b = renderVoice(harmonicEngine, { seed: 'h1', seconds: 0.6, params });
    expect(countNonFinite(a.l)).toBe(0);
    expect(maxAbs(a.l)).toBeLessThan(2);
    expect(countDiffs(a.l, b.l)).toBe(0);
  });
});
