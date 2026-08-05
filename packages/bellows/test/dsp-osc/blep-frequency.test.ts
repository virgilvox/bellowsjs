/*
 * Alias rejection across the whole band, and the high frequency fallback.
 *
 * oscillators.test.ts measures rejection at one frequency, 2637 Hz. That
 * leaves the rest of the range unguarded, which matters because oscillator
 * cost and alias behaviour both change with pitch: the residual sum spans
 * 2 * KERNEL_HALF * dt + 1 edges, so the character of the correction at
 * 7 kHz is not the character of the correction at A440. A change that
 * quietly cost 30 dB above 5 kHz would pass every other test here.
 *
 * The floors are set from measurement with about 10 dB of margin,
 * following the rule the parity harness learned the hard way: a gate made
 * of round numbers has so much headroom that a real regression walks
 * through it. 10 dB is wide enough for platform differences in
 * transcendental rounding and far too narrow for a broken kernel, which
 * costs 30 to 50 dB.
 *
 * The rows above 7040 Hz exist because an audit of the first version of
 * this file found that a six-edge kernel cap cost 39 dB at 11 kHz and
 * 73 dB at 17 kHz while every test in the repository still passed.
 */

import { describe, expect, it } from 'vitest';
import { BlepOscillator } from '../../src/dsp/oscillators';
import type { BlepHighFreqMode, BlepShape } from '../../src/dsp/oscillators';
import { correlation, measureAliasing } from './spectrum';

const SR = 44100;
const N = 16384;

/** Mirrored from SWITCH_DT in oscillators.ts. */
const SWITCH_DT = 0.22;
const SWITCH_HZ = SWITCH_DT * SR; // 9702

function render(
  shape: BlepShape,
  hz: number,
  highFreq: BlepHighFreqMode = 'blep',
  n = N,
): Float32Array {
  const osc = new BlepOscillator(SR, { highFreq });
  osc.setShape(shape);
  osc.setFreq(hz);
  const out = new Float32Array(n);
  osc.process(out, 0, n);
  return out;
}

function rejection(shape: BlepShape, hz: number, mode: BlepHighFreqMode = 'blep'): number {
  return measureAliasing(render(shape, hz, mode), SR, hz).worstAliasRelDb;
}

/** Amplitude of one exact frequency, in cycles per sample. */
function amplitudeAt(buf: Float32Array, cyclesPerSample: number): number {
  let re = 0;
  let im = 0;
  const w = 2 * Math.PI * cyclesPerSample;
  for (let i = 0; i < buf.length; i++) {
    re += buf[i] * Math.cos(w * i);
    im -= buf[i] * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / buf.length;
}

/* Measured floors, dB below the fundamental. Triangle is allowed to fall
 * off with pitch because its harmonics drop as 1/n^2, so what little is
 * left to alias sits close to the noise floor by the top of the range. */
const FLOORS: Array<{ hz: number; saw: number; square: number; triangle: number }> = [
  { hz: 55, saw: -84, square: -84, triangle: -85 },
  { hz: 110, saw: -93, square: -93, triangle: -93 },
  { hz: 220, saw: -88, square: -88, triangle: -88 },
  { hz: 440, saw: -84, square: -84, triangle: -84 },
  { hz: 880, saw: -88, square: -91, triangle: -79 },
  { hz: 1760, saw: -82, square: -88, triangle: -67 },
  { hz: 2637, saw: -80, square: -80, triangle: -60 },
  { hz: 3520, saw: -75, square: -75, triangle: -55 },
  { hz: 5000, saw: -77, square: -77, triangle: -49 },
  { hz: 7040, saw: -76, square: -79, triangle: -46 },
  { hz: 9000, saw: -71, square: -71, triangle: -39 },
  { hz: 11000, saw: -79, square: -79, triangle: -37 },
  { hz: 13000, saw: -67, square: -80, triangle: -36 },
  { hz: 15000, saw: -70, square: -79, triangle: -35 },
  { hz: 17000, saw: -71, square: -78, triangle: -34 },
  { hz: 19000, saw: -63, square: -73, triangle: -24 },
];

describe('BlepOscillator alias rejection across the band', () => {
  for (const row of FLOORS) {
    it(`holds its floor at ${row.hz} Hz`, () => {
      expect(rejection('saw', row.hz)).toBeLessThan(row.saw);
      expect(rejection('square', row.hz)).toBeLessThan(row.square);
      expect(rejection('triangle', row.hz)).toBeLessThan(row.triangle);
    });
  }

  it('puts the kernel band edge where CUTOFF says it is', () => {
    /* Nothing else in the repository notices a change to CUTOFF or to
     * KAISER_BETA. The alias floors do not move enough to fail, the
     * correlation tests run at 110 Hz where the band edge is nowhere near,
     * and the golden render never drives a bare oscillator. So this
     * measures the band edge itself, by comparing a low note's harmonics
     * against the ideal 1/n saw. Half amplitude at the cutoff is the
     * defining property of a windowed-sinc lowpass at its design point. */
    const dt = 0.02; // 882 Hz, 25 harmonics under Nyquist
    const buf = render('saw', dt * SR, 'blep', 1 << 16);
    const gain = (n: number) => amplitudeAt(buf, n * dt) / (2 / Math.PI / n);
    expect(gain(18)).toBeGreaterThan(0.99); // 0.36, still passband
    expect(gain(21)).toBeGreaterThan(0.47); // 0.42, the cutoff itself
    expect(gain(21)).toBeLessThan(0.53);
    expect(gain(23)).toBeLessThan(0.06); // 0.46, into the stopband
    expect(gain(24)).toBeLessThan(0.01); // 0.48, gone
  });

  it('never returns a non finite sample anywhere in the band', () => {
    for (const shape of ['saw', 'square', 'triangle', 'sine'] as BlepShape[]) {
      for (const hz of [55, 440, 2637, 7040, 11000, 20000]) {
        const out = render(shape, hz);
        for (let i = 0; i < out.length; i++) {
          if (!Number.isFinite(out[i])) throw new Error(`${shape} at ${hz} Hz produced ${out[i]}`);
        }
      }
    }
  });
});

describe('BlepOscillator high frequency fallback', () => {
  it('is inert below the switch, sample for sample', () => {
    /* The whole musical range has to be untouched by the option, or
     * turning it on would be a tone change rather than a cost change. */
    for (const shape of ['saw', 'square', 'triangle'] as BlepShape[]) {
      for (const hz of [55, 440, 2637, 5000, 7040, 9000, SWITCH_HZ - 1]) {
        const a = render(shape, hz, 'blep');
        const b = render(shape, hz, 'additive');
        expect(Array.from(b)).toEqual(Array.from(a));
      }
    }
  });

  it('leaves the sine shape alone at every pitch', () => {
    for (const hz of [5000, 11000, 17000]) {
      const a = render('sine', hz, 'blep');
      const b = render('sine', hz, 'additive');
      expect(Array.from(b)).toEqual(Array.from(a));
    }
  });

  it('crosses the switch without a step', () => {
    /* The switch is hard, with no crossfade, so the two paths have to
     * already agree at the switch point. Compared at the SAME dt, where
     * one mode takes the residual path and the other the harmonic path,
     * which is the discontinuity a note sweeping through actually meets. */
    for (const dt of [SWITCH_DT, 0.24, 0.28, 0.35]) {
      for (const shape of ['saw', 'square', 'triangle'] as BlepShape[]) {
        const a = render(shape, dt * SR, 'blep');
        const b = render(shape, dt * SR, 'additive');
        let maxDiff = 0;
        for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
        expect(correlation(a, b)).toBeGreaterThan(0.999);
        expect(maxDiff).toBeLessThan(0.02);
      }
    }
  });

  it('is cleaner than the residual path everywhere it runs', () => {
    for (const hz of [11000, 13000, 17000, 21000]) {
      for (const shape of ['saw', 'square'] as BlepShape[]) {
        expect(rejection(shape, hz, 'additive')).toBeLessThan(rejection(shape, hz, 'blep'));
      }
    }
  });

  it('gives each harmonic the amplitude the ideal series calls for', () => {
    /* Without this, a wrong Fourier coefficient is invisible: the alias
     * gates only look at what is NOT a harmonic, so a saw built with the
     * wrong fundamental amplitude passes every one of them. */
    const cases: Array<{ shape: BlepShape; want: number }> = [
      { shape: 'saw', want: 2 / Math.PI },
      { shape: 'square', want: 4 / Math.PI },
      { shape: 'triangle', want: 8 / (Math.PI * Math.PI) },
    ];
    for (const { shape, want } of cases) {
      const hz = 11000; // above the switch, and h2 is past Nyquist
      const got = amplitudeAt(render(shape, hz, 'additive', 1 << 16), hz / SR);
      expect(got).toBeGreaterThan(want * 0.995);
      expect(got).toBeLessThan(want * 1.005);
    }
  });

  it('fades a harmonic out with the kernel instead of cutting it', () => {
    /* Cutting at the cutoff would step the output by half that harmonic's
     * amplitude, 0.16 for the second harmonic of a saw. Sweeping dt across
     * the point where harmonic 2 leaves Nyquist must not move the level. */
    let prev = -1;
    for (const dt of [0.242, 0.246, 0.2499, 0.2501, 0.254]) {
      const buf = render('saw', dt * SR, 'additive');
      let acc = 0;
      for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
      const rms = Math.sqrt(acc / buf.length);
      if (prev >= 0) expect(Math.abs(rms - prev)).toBeLessThan(0.002);
      prev = rms;
    }
  });

  it('keeps the fundamental at the right level through the switch', () => {
    for (const hz of [SWITCH_HZ, 11000, 13000, 17000]) {
      const rep = measureAliasing(render('saw', hz, 'additive'), SR, hz);
      const ref = measureAliasing(render('saw', hz, 'blep'), SR, hz);
      expect(Math.abs(rep.fundamentalDb - ref.fundamentalDb)).toBeLessThan(0.5);
    }
  });

  it('stays bounded past the point where only the fundamental survives', () => {
    for (const hz of [11000, 15000, 20000]) {
      const out = render('saw', hz, 'additive');
      let peak = 0;
      for (let i = 0; i < out.length; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        peak = Math.max(peak, Math.abs(out[i]));
      }
      expect(peak).toBeLessThan(1.5);
    }
  });
});
