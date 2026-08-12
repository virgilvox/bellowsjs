import { describe, expect, it } from 'vitest';
import { granularEngine, makeGranularEngine } from '../../src/engines/granular';
import { rng } from '../../src/core/prng';
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

/*
 * The README sells this as "64-grain clouds", which is a claim about
 * MAX_GRAINS, and MAX_GRAINS survived being cut to 16 and doubled to 128.
 * Every test above runs at densities and grain sizes that never fill the
 * pool, so the pool size was unobservable.
 *
 * The first attempt to measure it was wrong twice, and both ways are worth
 * naming. It passed grainSize 0.2 thinking the parameter was seconds; it is
 * milliseconds, so it clamped to 10 and the cloud never had more than four
 * grains alive. Then it zeroed spray and pitch jitter, which makes every
 * grain identical, so they summed coherently and the result was
 * interference rather than saturation and did not even move monotonically.
 */
describe('grain pool size', () => {
  function cloudRms(density: number, seconds = 1.0): number {
    const v = granularEngine.createVoice(SR, { density, grainSize: 500, spread: 0 }, rng('g'));
    const n = Math.round(seconds * SR);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    v.noteOn(220, 1);
    for (let i = 0; i < n; i += 128) v.process(l, r, i, Math.min(i + 128, n));
    const from = Math.round(0.4 * SR);
    let e = 0;
    for (let i = from; i < n; i++) e += l[i] * l[i];
    return Math.sqrt(e / (n - from));
  }

  it('saturates at 64 grains, so the cloud stops getting louder there', () => {
    /*
     * Grains are decorrelated by spray and pitch jitter, so they sum
     * incoherently and the cloud's RMS grows as the square root of how many
     * are alive. 400 grains per second at half a second each asks for 200
     * and gets MAX_GRAINS. Measured at that setting: 0.0448 with a pool of
     * 16, 0.0616 with 32, 0.1268 as shipped with 64, and 0.1559 with 128.
     */
    const saturated = cloudRms(400);
    expect(saturated).toBeGreaterThan(0.10);
    expect(saturated).toBeLessThan(0.145);
  });

  it('is measuring the pool and not the density, which the pool does not bound', () => {
    /* 20 grains per second at half a second each needs 10 slots, so this
     * reads the same at every pool size: measured 0.14446 for 16, 32, 64
     * and 128 alike. Without this the test above could be passing on
     * something else entirely. */
    expect(cloudRms(20)).toBeCloseTo(0.1445, 3);
  });
});
