import { describe, expect, it } from 'vitest';
import { timeStretch, pitchShiftOffline } from '../../src/fx/spectral';
import { sine, rms, maxAbs, dominantFreq } from './helpers';

const SR = 44100;

describe('timeStretch', () => {
  it('stretching one second by 2 gives about two seconds of tone', () => {
    const input = sine(440, SR, SR, 0.8);
    const out = timeStretch(input, SR, 2);
    expect(Math.abs(out.length - 2 * SR) / (2 * SR)).toBeLessThan(0.05);
    // Real signal near the end, not zero padding.
    const lateRms = rms(out, Math.floor(SR * 1.7), Math.floor(SR * 1.95));
    const earlyRms = rms(out, Math.floor(SR * 0.5), Math.floor(SR * 0.75));
    expect(lateRms).toBeGreaterThan(0.5 * earlyRms);
    expect(earlyRms).toBeGreaterThan(0.3);
  });

  it('keeps a 440 Hz sine at 440 within one percent when stretched', () => {
    const input = sine(440, SR, SR, 0.8);
    const out = timeStretch(input, SR, 2);
    const mid = out.length >> 1;
    const f = dominantFreq(out, SR, mid - 8192, mid + 8192);
    expect(Math.abs(f - 440) / 440).toBeLessThan(0.01);
    expect(maxAbs(out)).toBeLessThan(2);
  });

  it('compresses with ratio 0.5 and keeps pitch', () => {
    const input = sine(523.25, SR, SR, 0.7);
    const out = timeStretch(input, SR, 0.5);
    expect(Math.abs(out.length - SR / 2) / (SR / 2)).toBeLessThan(0.05);
    const mid = out.length >> 1;
    const f = dominantFreq(out, SR, mid - 4096, mid + 4096);
    expect(Math.abs(f - 523.25) / 523.25).toBeLessThan(0.01);
  });

  it('clamps the ratio to [0.25, 4]', () => {
    const input = sine(440, SR, 8192, 0.5);
    expect(timeStretch(input, SR, 100).length).toBe(8192 * 4);
    expect(timeStretch(input, SR, 0.001).length).toBe(2048);
  });

  it('ratio 1 approximates identity', () => {
    const input = sine(440, SR, SR / 2, 0.8);
    const out = timeStretch(input, SR, 1);
    expect(out.length).toBe(input.length);
    const f = dominantFreq(out, SR, 4096, out.length - 4096);
    expect(Math.abs(f - 440) / 440).toBeLessThan(0.005);
    const mid = out.length >> 1;
    expect(rms(out, mid - 4096, mid + 4096)).toBeGreaterThan(0.4);
  });

  it('handles empty input', () => {
    expect(timeStretch(new Float32Array(0), SR, 2).length).toBe(0);
  });

  it('is deterministic', () => {
    const input = sine(660, SR, 22050, 0.6);
    const a = timeStretch(input, SR, 1.5);
    const b = timeStretch(input, SR, 1.5);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('pitchShiftOffline', () => {
  it('moves 440 to 880 within one percent at the original length', () => {
    const input = sine(440, SR, SR / 2, 0.8);
    const out = pitchShiftOffline(input, SR, 12);
    expect(Math.abs(out.length - input.length)).toBeLessThanOrEqual(2);
    const mid = out.length >> 1;
    const f = dominantFreq(out, SR, mid - 8192, mid + 8192);
    expect(Math.abs(f - 880) / 880).toBeLessThan(0.01);
    expect(maxAbs(out)).toBeLessThan(2);
    expect(rms(out, mid - 4096, mid + 4096)).toBeGreaterThan(0.3);
  });

  it('moves 440 down to 220 within one percent', () => {
    const input = sine(440, SR, SR / 2, 0.8);
    const out = pitchShiftOffline(input, SR, -12);
    const mid = out.length >> 1;
    const f = dominantFreq(out, SR, mid - 8192, mid + 8192);
    expect(Math.abs(f - 220) / 220).toBeLessThan(0.01);
  });

  it('handles fractional shifts', () => {
    const input = sine(440, SR, SR / 2, 0.8);
    const out = pitchShiftOffline(input, SR, 7);
    const expected = 440 * Math.pow(2, 7 / 12);
    const mid = out.length >> 1;
    const f = dominantFreq(out, SR, mid - 8192, mid + 8192);
    expect(Math.abs(f - expected) / expected).toBeLessThan(0.01);
  });

  it('zero semitones approximates identity', () => {
    const input = sine(440, SR, 22050, 0.5);
    const out = pitchShiftOffline(input, SR, 0);
    expect(out.length).toBe(input.length);
    const mid = out.length >> 1;
    const f = dominantFreq(out, SR, mid - 4096, mid + 4096);
    expect(Math.abs(f - 440) / 440).toBeLessThan(0.005);
  });
});
