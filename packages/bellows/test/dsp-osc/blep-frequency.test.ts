/*
 * Alias rejection across the band, and the high frequency fallback.
 *
 * oscillators.test.ts measures rejection at one frequency, 2637 Hz. That
 * leaves the whole top of the range unguarded, which matters because
 * oscillator cost and alias behaviour both change with pitch: the residual
 * sum spans 2 * KERNEL_HALF * dt + 1 edges, so the character of the
 * correction at 7 kHz is not the character of the correction at A440. A
 * change that quietly cost 30 dB above 5 kHz would pass every existing
 * test in this directory.
 *
 * The floors below are set from measurement with about 10 dB of margin,
 * following the rule the parity harness learned the hard way: a gate made
 * of round numbers is a gate with so much headroom that a real regression
 * walks through it. 10 dB is wide enough for platform differences in
 * transcendental rounding and far too narrow for a broken kernel, which
 * costs 30 to 50 dB.
 */

import { describe, expect, it } from 'vitest';
import { BlepOscillator } from '../../src/dsp/oscillators';
import type { BlepHighFreqMode, BlepShape } from '../../src/dsp/oscillators';
import { correlation, measureAliasing } from './spectrum';

const SR = 44100;
const N = 16384;

/* The two ends of the fallback blend, mirrored from oscillators.ts. */
const FALLBACK_LO_HZ = 0.14 * SR; // 6174
const FALLBACK_HI_HZ = 0.2 * SR; // 8820

function render(shape: BlepShape, hz: number, highFreq: BlepHighFreqMode = 'blep'): Float32Array {
  const osc = new BlepOscillator(SR, { highFreq });
  osc.setShape(shape);
  osc.setFreq(hz);
  const out = new Float32Array(N);
  osc.process(out, 0, N);
  return out;
}

function rejection(shape: BlepShape, hz: number, mode: BlepHighFreqMode = 'blep'): number {
  return measureAliasing(render(shape, hz, mode), SR, hz).worstAliasRelDb;
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
];

describe('BlepOscillator alias rejection across the band', () => {
  for (const row of FLOORS) {
    it(`holds its floor at ${row.hz} Hz`, () => {
      expect(rejection('saw', row.hz)).toBeLessThan(row.saw);
      expect(rejection('square', row.hz)).toBeLessThan(row.square);
      expect(rejection('triangle', row.hz)).toBeLessThan(row.triangle);
    });
  }

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
  it('is inert below the crossover, sample for sample', () => {
    /* The whole musical range has to be untouched by the option, or
     * turning it on would be a tone change rather than a cost change. */
    for (const shape of ['saw', 'square', 'triangle'] as BlepShape[]) {
      for (const hz of [55, 440, 2637, 5000, FALLBACK_LO_HZ - 1]) {
        const a = render(shape, hz, 'blep');
        const b = render(shape, hz, 'additive');
        expect(Array.from(b)).toEqual(Array.from(a));
      }
    }
  });

  it('leaves the sine shape alone at every pitch', () => {
    for (const hz of [5000, 9000, 11000]) {
      const a = render('sine', hz, 'blep');
      const b = render('sine', hz, 'additive');
      expect(Array.from(b)).toEqual(Array.from(a));
    }
  });

  it('enters the blend continuously rather than stepping into it', () => {
    /* Just inside the blend the additive share is a few percent, so the
     * two modes must still describe nearly the same waveform. A step here
     * would be an audible click on any pitch sweep through the crossover. */
    const hz = FALLBACK_LO_HZ + 20;
    for (const shape of ['saw', 'square'] as BlepShape[]) {
      const a = render(shape, hz, 'blep');
      const b = render(shape, hz, 'additive');
      expect(correlation(a, b)).toBeGreaterThan(0.999);
    }
  });

  it('is at least as clean as the BLEP path where it runs alone', () => {
    /* Above FALLBACK_HI_HZ the residual sum is skipped entirely, so this
     * is the claim that the cheaper path is not also the worse one. */
    for (const hz of [9000, 11000]) {
      for (const shape of ['saw', 'square'] as BlepShape[]) {
        expect(rejection(shape, hz, 'additive')).toBeLessThan(rejection(shape, hz, 'blep'));
      }
    }
  });

  it('keeps the fundamental at the right level through the crossover', () => {
    /* A blend between two forms that disagreed on amplitude would show up
     * as a dip or bump in the fundamental as a note sweeps through. */
    for (const hz of [5000, 6500, 7500, 9000, 11000]) {
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
      expect(peak).toBeGreaterThan(0.1);
      expect(peak).toBeLessThan(1.5);
    }
  });
});
