import { describe, it, expect } from 'vitest';
import { Adsr, EnvelopeFollower, Smoother } from '../../src/dsp/envelopes';

const SR = 48000;

describe('Adsr', () => {
  it('is idle before trigger and after reset', () => {
    const env = new Adsr(SR);
    expect(env.active).toBe(false);
    expect(env.next()).toBe(0);
    env.trigger();
    env.next();
    env.reset();
    expect(env.active).toBe(false);
    expect(env.level).toBe(0);
  });

  it('attack reaches 90 percent of peak within the attack time', () => {
    const env = new Adsr(SR);
    env.set(0.01, 0.1, 0.5, 0.1);
    env.trigger();
    const attackSamples = Math.round(0.01 * SR);
    let n = 0;
    while (env.next() < 0.9) {
      n++;
      expect(n).toBeLessThanOrEqual(attackSamples);
    }
    expect(n).toBeLessThanOrEqual(attackSamples);
  });

  it('attack reaches full level close to the attack time', () => {
    const env = new Adsr(SR);
    env.set(0.01, 0.5, 0.5, 0.1);
    env.trigger();
    const attackSamples = Math.round(0.01 * SR);
    let peak = 0;
    for (let n = 0; n < Math.round(attackSamples * 1.1); n++) {
      const v = env.next();
      if (v > peak) peak = v;
    }
    expect(peak).toBeGreaterThanOrEqual(0.999);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('decays to sustain and holds there', () => {
    const env = new Adsr(SR);
    env.set(0.005, 0.05, 0.5, 0.1);
    env.trigger();
    for (let n = 0; n < Math.round(0.25 * SR); n++) env.next();
    expect(Math.abs(env.level - 0.5)).toBeLessThan(0.01);
    for (let n = 0; n < Math.round(0.2 * SR); n++) env.next();
    expect(Math.abs(env.level - 0.5)).toBeLessThan(0.01);
    expect(env.active).toBe(true);
  });

  it('release decays monotonically to idle within a few release times', () => {
    const env = new Adsr(SR);
    env.set(0.005, 0.05, 0.8, 0.1);
    env.trigger();
    for (let n = 0; n < Math.round(0.2 * SR); n++) env.next();
    env.release();
    let prev = env.level;
    let n = 0;
    const limit = Math.round(0.3 * SR);
    while (env.active) {
      const v = env.next();
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
      n++;
      expect(n).toBeLessThanOrEqual(limit);
    }
    expect(env.level).toBe(0);
    expect(env.next()).toBe(0);
  });

  it('retrigger mid-release restarts the attack from the current level', () => {
    const env = new Adsr(SR);
    env.set(0.01, 0.05, 0.8, 0.2);
    env.trigger();
    for (let n = 0; n < Math.round(0.15 * SR); n++) env.next();
    env.release();
    for (let n = 0; n < Math.round(0.05 * SR); n++) env.next();
    const mid = env.level;
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.8);

    env.trigger();
    const first = env.next();
    // no click: the level continues from where release left off
    expect(first).toBeGreaterThanOrEqual(mid);
    expect(first - mid).toBeLessThan(0.02);
    // and it climbs back to the peak within the attack time (then starts decaying)
    let peak = first;
    for (let n = 0; n < Math.round(0.01 * SR); n++) {
      const v = env.next();
      if (v > peak) peak = v;
    }
    expect(peak).toBeGreaterThanOrEqual(0.99);
    expect(env.level).toBeGreaterThan(mid);
  });

  it('retrigger during decay is click free', () => {
    const env = new Adsr(SR);
    env.set(0.005, 0.1, 0.2, 0.1);
    env.trigger();
    for (let n = 0; n < Math.round(0.05 * SR); n++) env.next();
    const mid = env.level;
    env.trigger();
    const first = env.next();
    expect(Math.abs(first - mid)).toBeLessThan(0.02);
  });

  it('zero attack jumps to full level on the first sample', () => {
    const env = new Adsr(SR);
    env.set(0, 0.1, 0.5, 0.1);
    env.trigger();
    expect(env.next()).toBe(1);
  });

  it('release before the attack finishes still decays to idle', () => {
    const env = new Adsr(SR);
    env.set(0.05, 0.1, 0.8, 0.02);
    env.trigger();
    for (let n = 0; n < Math.round(0.01 * SR); n++) env.next();
    env.release();
    for (let n = 0; n < Math.round(0.1 * SR); n++) env.next();
    expect(env.active).toBe(false);
  });
});

describe('EnvelopeFollower', () => {
  it('rises to about 63 percent of a step in the attack time', () => {
    const f = new EnvelopeFollower(SR, 0.01, 0.1);
    let y = 0;
    for (let n = 0; n < Math.round(0.01 * SR); n++) y = f.next(1);
    expect(y).toBeGreaterThan(0.55);
    expect(y).toBeLessThan(0.72);
  });

  it('falls with the release time constant after the input stops', () => {
    const f = new EnvelopeFollower(SR, 0.001, 0.1);
    for (let n = 0; n < Math.round(0.05 * SR); n++) f.next(1);
    let y = 0;
    for (let n = 0; n < Math.round(0.1 * SR); n++) y = f.next(0);
    // one release time constant: about 37 percent remains
    expect(y).toBeGreaterThan(0.25);
    expect(y).toBeLessThan(0.48);
  });

  it('rectifies: negative input tracks like positive', () => {
    const a = new EnvelopeFollower(SR, 0.01, 0.1);
    const b = new EnvelopeFollower(SR, 0.01, 0.1);
    let ya = 0;
    let yb = 0;
    for (let n = 0; n < 1000; n++) {
      ya = a.next(0.7);
      yb = b.next(-0.7);
    }
    expect(ya).toBeCloseTo(yb, 10);
  });

  it('reset clears state', () => {
    const f = new EnvelopeFollower(SR, 0.01, 0.1);
    for (let n = 0; n < 100; n++) f.next(1);
    f.reset();
    expect(f.next(0)).toBe(0);
  });
});

describe('Smoother', () => {
  it('reaches about 63 percent of a step in the configured time', () => {
    const s = new Smoother(SR, 0.02);
    s.setTarget(1);
    let v = 0;
    for (let n = 0; n < Math.round(0.02 * SR); n++) v = s.next();
    expect(v).toBeGreaterThan(0.58);
    expect(v).toBeLessThan(0.68);
  });

  it('converges to the target', () => {
    const s = new Smoother(SR, 0.01);
    s.setTarget(-2);
    for (let n = 0; n < Math.round(0.1 * SR); n++) s.next();
    expect(Math.abs(s.value + 2)).toBeLessThan(0.001);
  });

  it('snap jumps immediately', () => {
    const s = new Smoother(SR, 0.5);
    s.setTarget(1);
    s.next();
    s.snap(0.25);
    expect(s.value).toBe(0.25);
    expect(s.next()).toBe(0.25);
  });

  it('zero time acts as passthrough', () => {
    const s = new Smoother(SR, 0);
    s.setTarget(0.9);
    expect(s.next()).toBe(0.9);
  });

  it('value reflects the last computed sample', () => {
    const s = new Smoother(SR, 0.01);
    s.setTarget(1);
    const v = s.next();
    expect(s.value).toBe(v);
  });
});
