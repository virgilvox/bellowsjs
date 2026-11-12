/*
 * The phonation threshold (dsp/phonation-threshold.ts): linear in the
 * prephonatory half-width (Titze 1988), with onset and offset apart
 * (Lucero 1999), and a level that grows and decays rather than steps.
 */

import { describe, expect, it } from 'vitest';
import { OFFSET_RATIO, PhonationThreshold, THRESHOLD_FLOOR, THRESHOLD_SLOPE } from '../../src/dsp/phonation-threshold';
import { CM_H2O } from '../../src/dsp/air';

const DT = 32 / 48000;

describe('PhonationThreshold', () => {
  it('rises linearly with the half-width: 2 cmH2O for folds that touch, 4 more per mm', () => {
    const t = new PhonationThreshold(DT);
    const onsetAt = (xi: number) => {
      t.halfWidth = xi;
      t.step();
      return t.onset;
    };
    expect(onsetAt(0) / CM_H2O).toBeCloseTo(THRESHOLD_FLOOR / CM_H2O, 9);
    expect((onsetAt(0.05) - onsetAt(0)) / CM_H2O).toBeCloseTo(2, 9);
    expect((onsetAt(0.1) - onsetAt(0.05)) / (onsetAt(0.05) - onsetAt(0))).toBeCloseTo(1, 9);
    expect(THRESHOLD_SLOPE).toBeCloseTo(40 * CM_H2O, 9);
    t.halfWidth = -1;
    t.step();
    expect(t.onset).toBe(THRESHOLD_FLOOR);
  });

  it('starts above the onset pressure and stops only below the offset pressure, with the ratio in Lucero\'s 0.5 to 1', () => {
    expect(OFFSET_RATIO).toBeGreaterThanOrEqual(0.5);
    expect(OFFSET_RATIO).toBeLessThan(1);
    const t = new PhonationThreshold(DT);
    t.halfWidth = 0.02;
    t.step();
    const on = t.onset;
    const off = OFFSET_RATIO * on;
    const states: number[] = [];
    // up past the onset, down through the band between, below the offset, back up into the band
    for (const p of [0.5 * on, 0.95 * on, 1.05 * on, 0.9 * on, 0.75 * on, 1.01 * off, 0.99 * off, 0.8 * on, 0.99 * on, 1.01 * on]) {
      t.pressure = p;
      t.step();
      states.push(t.on);
    }
    expect(states).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0, 1]);
  });

  it('grows into its level over milliseconds and dies out of it, and a closure (drive 0) holds it at 0', () => {
    const t = new PhonationThreshold(DT);
    t.pressure = 10 * CM_H2O;
    t.step();
    expect(t.level).toBeGreaterThan(0);
    expect(t.level).toBeLessThan(0.2);
    let steps = 1;
    while (t.level < 0.95) {
      t.step();
      steps++;
    }
    const ms = steps * DT * 1000;
    expect(ms).toBeGreaterThan(10);
    expect(ms).toBeLessThan(30);
    t.drive = 0;
    for (let i = 0; i < 300; i++) t.step();
    expect(t.level).toBeLessThan(1e-6);
    expect(t.on).toBe(1);
  });
});
