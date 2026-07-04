import { describe, it, expect } from 'vitest';
import { LoudnessMeter, kWeightingCoeffs } from '../../src/analysis/loudness';
import { NoiseGen } from '../../src/dsp/noise';
import { rng } from '../../src/core/prng';
import { sine } from './signals';

const SR = 44100;

function meterFor(buf: Float32Array, sampleRate = SR): LoudnessMeter {
  const m = new LoudnessMeter(sampleRate, 1);
  m.push(buf, null, 0, buf.length);
  return m;
}

describe('kWeightingCoeffs', () => {
  it('reproduces the BS.1770 48 kHz table', () => {
    const { shelf, highpass } = kWeightingCoeffs(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(highpass.b0).toBe(1);
    expect(highpass.b1).toBe(-2);
    expect(highpass.b2).toBe(1);
    expect(highpass.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(highpass.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it('produces stable filters at other rates', () => {
    for (const sr of [22050, 44100, 96000]) {
      const { shelf, highpass } = kWeightingCoeffs(sr);
      // Poles inside the unit circle: |a2| < 1 and |a1| < 1 + a2.
      expect(Math.abs(shelf.a2)).toBeLessThan(1);
      expect(Math.abs(shelf.a1)).toBeLessThan(1 + shelf.a2);
      expect(Math.abs(highpass.a2)).toBeLessThan(1);
      expect(Math.abs(highpass.a1)).toBeLessThan(1 + highpass.a2);
    }
  });
});

describe('LoudnessMeter integrated', () => {
  // BS.1770-4 calibration: a 0 dB FS 997 Hz sine in ONE channel reads
  // -3.01 LKFS. We assert that single-channel case (mono meter, and a
  // stereo meter with a silent right channel). Driving both stereo
  // channels adds 3.01 LU, landing at 0.0 LUFS.
  it('measures a full-scale 997 Hz mono sine at -3.01 LUFS', () => {
    const buf = sine(997, SR, 5 * SR, 1.0);
    const m = meterFor(buf);
    expect(m.integrated()).toBeCloseTo(-3.01, 1);
  });

  it('measures the same sine on one stereo channel at -3.01 LUFS', () => {
    const l = sine(997, SR, 5 * SR, 1.0);
    const r = new Float32Array(l.length);
    const m = new LoudnessMeter(SR, 2);
    m.push(l, r, 0, l.length);
    expect(m.integrated()).toBeCloseTo(-3.01, 1);
  });

  it('measures both stereo channels full scale at 0.0 LUFS', () => {
    const l = sine(997, SR, 5 * SR, 1.0);
    const m = new LoudnessMeter(SR, 2);
    m.push(l, l, 0, l.length);
    expect(m.integrated()).toBeCloseTo(0.0, 1);
  });

  it('works at 48 kHz too', () => {
    const buf = sine(997, 48000, 5 * 48000, 1.0);
    const m = meterFor(buf, 48000);
    expect(m.integrated()).toBeCloseTo(-3.01, 1);
  });

  it('shifts by exactly the applied gain on pink noise', () => {
    const gen = new NoiseGen(SR, 'pink', rng('loudness/pink'));
    const buf = new Float32Array(5 * SR);
    gen.process(buf, 0, buf.length);
    const half = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) half[i] = buf[i] * 0.5;

    const a = meterFor(buf).integrated();
    const b = meterFor(half).integrated();
    expect(a - b).toBeCloseTo(20 * Math.log10(2), 2);
  });

  it('gating ignores long silent gaps', () => {
    const seg = sine(997, SR, 2 * SR, 0.25);
    const gapped = new Float32Array(7 * SR);
    gapped.set(seg, 0);
    gapped.set(seg, 5 * SR);
    const continuous = sine(997, SR, 4 * SR, 0.25);

    const withGap = meterFor(gapped).integrated();
    const solid = meterFor(continuous).integrated();
    expect(Math.abs(withGap - solid)).toBeLessThan(0.5);
  });

  it('absolute gate drops signals below -70 LUFS', () => {
    const buf = sine(997, SR, 2 * SR, 0.00001);
    expect(meterFor(buf).integrated()).toBe(-Infinity);
  });

  it('is -Infinity before any gating block exists', () => {
    const m = new LoudnessMeter(SR, 1);
    expect(m.integrated()).toBe(-Infinity);
  });
});

describe('LoudnessMeter momentary and short-term', () => {
  it('agree with integrated for a steady sine', () => {
    const buf = sine(997, SR, 5 * SR, 0.5);
    const m = meterFor(buf);
    const integrated = m.integrated();
    expect(Math.abs(m.momentary() - integrated)).toBeLessThan(0.2);
    expect(Math.abs(m.shortTerm() - integrated)).toBeLessThan(0.2);
  });

  it('return -Infinity until their windows fill', () => {
    const m = new LoudnessMeter(SR, 1);
    const buf = sine(997, SR, Math.round(0.3 * SR), 0.5);
    m.push(buf, null, 0, buf.length);
    expect(m.momentary()).toBe(-Infinity); // 300 ms < 400 ms
    expect(m.shortTerm()).toBe(-Infinity);
  });

  it('momentary follows a level change', () => {
    const quiet = sine(997, SR, 2 * SR, 0.05);
    const loud = sine(997, SR, 2 * SR, 0.5);
    const m = new LoudnessMeter(SR, 1);
    m.push(quiet, null, 0, quiet.length);
    const before = m.momentary();
    m.push(loud, null, 0, loud.length);
    const after = m.momentary();
    expect(after - before).toBeCloseTo(20, 0); // 20 dB level step
  });
});

describe('LoudnessMeter range', () => {
  it('reports about 10 LU for a two-level program', () => {
    const loud = sine(997, SR, 6 * SR, 0.5);
    const quiet = sine(997, SR, 6 * SR, 0.5 / Math.pow(10, 10 / 20));
    const m = new LoudnessMeter(SR, 1);
    m.push(loud, null, 0, loud.length);
    m.push(quiet, null, 0, quiet.length);
    const lra = m.range();
    expect(lra).toBeGreaterThan(7);
    expect(lra).toBeLessThan(11);
  });

  it('is near 0 for a steady signal', () => {
    const m = meterFor(sine(997, SR, 8 * SR, 0.5));
    expect(m.range()).toBeLessThan(0.5);
  });

  it('is 0 without enough windows', () => {
    const m = new LoudnessMeter(SR, 1);
    expect(m.range()).toBe(0);
  });
});

describe('LoudnessMeter truePeak', () => {
  it('reads a sine amplitude', () => {
    const m = meterFor(sine(997, SR, SR, 0.6));
    expect(m.truePeak()).toBeGreaterThan(0.58);
    expect(m.truePeak()).toBeLessThan(0.63);
  });

  it('catches intersample peaks a sample peak misses', () => {
    // A sine near Nyquist/2 sampled off-crest: raw sample max underreads.
    const n = SR;
    const buf = new Float32Array(n);
    const f = 11025;
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < n; i++) buf[i] = 0.9 * Math.sin(w * i + Math.PI / 4);
    let samplePeak = 0;
    for (let i = 0; i < n; i++) samplePeak = Math.max(samplePeak, Math.abs(buf[i]));
    const m = meterFor(buf);
    expect(m.truePeak()).toBeGreaterThanOrEqual(samplePeak);
    expect(m.truePeak()).toBeCloseTo(0.9, 1);
  });
});

describe('LoudnessMeter memory', () => {
  it('keeps the segment buffer bounded over minutes of audio', () => {
    const m = new LoudnessMeter(SR, 1);
    const buf = sine(997, SR, SR, 0.5);
    // Four minutes of audio, 20 segments per second.
    for (let i = 0; i < 240; i++) m.push(buf, null, 0, buf.length);
    const internals = m as unknown as { segRing: Float64Array; segCount: number };
    expect(internals.segRing.length).toBe(60);
    expect(internals.segCount).toBe(240 * 20);
    // The measurements still read correctly from the bounded buffer.
    expect(m.integrated()).toBeCloseTo(-9.03, 1);
    expect(Math.abs(m.shortTerm() - m.integrated())).toBeLessThan(0.2);
    expect(Math.abs(m.momentary() - m.integrated())).toBeLessThan(0.2);
  });
});

describe('LoudnessMeter reset', () => {
  it('clears all state', () => {
    const m = meterFor(sine(997, SR, 2 * SR, 0.5));
    expect(m.integrated()).not.toBe(-Infinity);
    m.reset();
    expect(m.integrated()).toBe(-Infinity);
    expect(m.momentary()).toBe(-Infinity);
    expect(m.truePeak()).toBe(0);
    expect(m.range()).toBe(0);
  });

  it('rejects stereo pushes without a right channel', () => {
    const m = new LoudnessMeter(SR, 2);
    expect(() => m.push(new Float32Array(64), null, 0, 64)).toThrow();
  });
});
