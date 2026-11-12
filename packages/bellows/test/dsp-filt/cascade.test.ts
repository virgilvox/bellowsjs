import { describe, expect, it } from 'vitest';
import { CASCADE_SETTLE_98, CascadeBank, cascadeSettle } from '../../src/dsp/cascade';
import { CRITDAMP_SETTLE_98, CritDamp } from '../../src/dsp/critdamp';

/** The step response of n stages from rest at u = t / tau: the gamma CDF. */
function gammaCdf(n: number, u: number): number {
  let term = 1;
  let sum = 1;
  for (let k = 1; k < n; k++) {
    term *= u / k;
    sum += term;
  }
  return 1 - Math.exp(-u) * sum;
}

function stepFromRest(rate: number, t98: number, order = 6): CascadeBank {
  const b = new CascadeBank(1, rate, order);
  b.setTime(0, t98);
  b.snap(0, 0);
  b.setTarget(0, 1);
  return b;
}

/** Control rate of the vocal engine at 48 kHz (a step every 64 samples). */
const CONTROL = 48000 / 64;

describe('CascadeBank', () => {
  it('settles at the gamma tail roots: 12.03 tau at six stages, CritDamp\'s 5.83 at two', () => {
    expect(CASCADE_SETTLE_98).toBeCloseTo(12.03, 2);
    expect(Math.abs(cascadeSettle(2) - CRITDAMP_SETTLE_98)).toBeLessThan(1e-9);
    expect(Math.abs(gammaCdf(6, CASCADE_SETTLE_98) - 0.98)).toBeLessThan(1e-12);
  });

  it('is the exact step response sampled at the step times, at any step rate', () => {
    for (const rate of [CONTROL, 48000, 50]) {
      for (const t98 of [0.03, 0.093, 0.4]) {
        const b = stepFromRest(rate, t98);
        const tau = t98 / CASCADE_SETTLE_98;
        let worst = 0;
        for (let i = 1; i <= Math.ceil(2 * t98 * rate); i++) {
          b.step();
          worst = Math.max(worst, Math.abs(b.values[0] - gammaCdf(6, i / rate / tau)));
        }
        expect(worst, `rate ${rate} t98 ${t98}`).toBeLessThan(1e-12);
      }
    }
  });

  it('reaches 98 percent at the time setTime promises', () => {
    for (const rate of [CONTROL, 48000]) {
      for (const t98 of [0.04, 0.08, 0.2]) {
        const b = stepFromRest(rate, t98);
        let prev = 0;
        let t = Infinity;
        for (let i = 1; i < 4 * t98 * rate; i++) {
          b.step();
          const x = b.values[0];
          if (x >= 0.98) {
            t = (i - 1 + (0.98 - prev) / (x - prev)) / rate;
            break;
          }
          prev = x;
        }
        // linear interpolation between steps errs by well under a step
        expect(Math.abs(t - t98)).toBeLessThan(0.5 / rate + 1e-4);
      }
    }
  });

  it('peaks in velocity at 0.42 of the 98 percent time with 38 percent of the way done (two stages: 0.17 and 26)', () => {
    const rate = 48000;
    for (const [order, at, done] of [
      [6, 0.4157, 0.3840],
      [2, 0.1714, 0.2642],
    ] as const) {
      const t98 = 0.1;
      const b = stepFromRest(rate, t98, order);
      let best = 0;
      let bestT = 0;
      let bestX = 0;
      for (let i = 1; i < t98 * rate; i++) {
        b.step();
        const v = b.velocity(0);
        if (v > best) {
          best = v;
          bestT = i / rate;
          bestX = b.values[0];
        }
      }
      expect(Math.abs(bestT / t98 - at), `order ${order}`).toBeLessThan(0.002);
      expect(Math.abs(bestX - done), `order ${order}`).toBeLessThan(0.002);
    }
  });

  it('is bell shaped at six stages: the velocity rises and falls over about the same time', () => {
    const b = stepFromRest(48000, 0.1);
    const v: number[] = [];
    for (let i = 0; i < 4800; i++) {
      b.step();
      v.push(b.velocity(0));
    }
    const peak = Math.max(...v);
    const up = v.findIndex((q) => q > peak / 2);
    const down = v.findIndex((q, i) => i > v.indexOf(peak) && q < peak / 2);
    const rise = v.indexOf(peak) - up;
    const fall = down - v.indexOf(peak);
    expect(fall / rise).toBeGreaterThan(1);
    expect(fall / rise).toBeLessThan(1.6);
  });

  it('matches CritDamp from rest at two stages', () => {
    const rate = CONTROL;
    const b = stepFromRest(rate, 0.093, 2);
    const cd = new CritDamp(rate);
    cd.setTime(0.093);
    cd.setTarget(1);
    for (let i = 0; i < 200; i++) {
      b.step();
      expect(Math.abs(b.values[0] - cd.step())).toBeLessThan(1e-12);
    }
  });

  it('rises monotonically and never overshoots, up and down, and a moved target bends the path without a jump', () => {
    const b = new CascadeBank(1, CONTROL);
    b.setTime(0, 0.06);
    b.snap(0, 2);
    b.setTarget(0, -1);
    let prev = 2;
    for (let i = 0; i < 300; i++) {
      b.step();
      expect(b.values[0]).toBeLessThanOrEqual(prev + 1e-15);
      expect(b.values[0]).toBeGreaterThanOrEqual(i > 4 ? -0.5 : -1);
      if (i === 4) b.setTarget(0, -0.5);
      prev = b.values[0];
    }
    expect(b.values[0]).toBeCloseTo(-0.5, 12);
  });

  it('keeps the position when its rate changes mid-move and scales the velocity with it', () => {
    const b = stepFromRest(48000, 0.1);
    for (let i = 0; i < 2000; i++) b.step();
    const x = b.values[0];
    const v = b.velocity(0);
    b.setTime(0, 0.2);
    expect(b.values[0]).toBe(x);
    expect(b.velocity(0) / v).toBeCloseTo(0.5, 12);
  });

  it('place() moves the output alone: held at a surface, it leaves already accelerating when the target turns', () => {
    const rate = CONTROL;
    const b = new CascadeBank(1, rate);
    b.setTime(0, 0.06);
    b.snap(0, 1);
    b.setTarget(0, -0.5);
    const surface = 0;
    for (let i = 0; i < 150; i++) {
      b.step();
      if (b.values[0] < surface) b.place(0, surface);
    }
    // the stages before the output went on to the target past the surface
    expect(b.values[0]).toBe(surface);
    expect(b.stage(0, 0)).toBeCloseTo(-0.5, 6);
    expect(b.stage(0, 4)).toBeLessThan(-0.4);
    // turn back: the output stays until the stages come back, then leaves faster than a start from rest
    b.setTarget(0, 1);
    const free = new CascadeBank(1, rate);
    free.setTime(0, 0.06);
    free.snap(0, surface);
    free.setTarget(0, 1);
    let left = -1;
    for (let i = 0; i < 200; i++) {
      b.step();
      free.step();
      if (b.values[0] < surface) b.place(0, surface);
      if (left < 0 && b.values[0] > 0.01) left = i;
    }
    expect(left).toBeGreaterThan(0);
    // from 0.01 to 0.5: the held output covers it in fewer steps than a start from rest
    const run = (bank: CascadeBank, contact: boolean) => {
      bank.snap(0, contact ? 1 : surface);
      bank.setTarget(0, -0.5);
      if (contact) for (let i = 0; i < 150; i++) {
        bank.step();
        if (bank.values[0] < surface) bank.place(0, surface);
      }
      bank.setTarget(0, 1);
      let a = -1;
      for (let i = 0; i < 400; i++) {
        bank.step();
        if (contact && bank.values[0] < surface) bank.place(0, surface);
        if (a < 0 && bank.values[0] > 0.01) a = i;
        if (bank.values[0] > 0.5) return i - a;
      }
      return Infinity;
    };
    const fresh = new CascadeBank(1, rate);
    fresh.setTime(0, 0.06);
    const rest = new CascadeBank(1, rate);
    rest.setTime(0, 0.06);
    expect(run(fresh, true)).toBeLessThan(run(rest, false));
  });

  it('ignores non-finite settings and stays finite', () => {
    const b = new CascadeBank(2, CONTROL);
    b.snap(0, 1);
    b.setTarget(0, NaN);
    b.setTime(0, Infinity);
    b.setRate(1, NaN);
    b.place(0, Infinity);
    b.setAll(Float64Array.of(NaN, Infinity), Float64Array.of(NaN, -Infinity));
    for (let i = 0; i < 100; i++) b.step();
    expect(b.values[0]).toBe(1);
    expect(Number.isFinite(b.values[1])).toBe(true);
    expect(() => new CascadeBank(0, CONTROL)).toThrow(RangeError);
    expect(() => new CascadeBank(1, 0)).toThrow(RangeError);
    expect(() => new CascadeBank(1, CONTROL, 13)).toThrow(RangeError);
  });

  it('has no allocating syntax in what runs per step', () => {
    for (const name of ['step', 'setAll', 'place', 'placeFrom', 'velocity', 'stage'] as const) {
      const src = (CascadeBank.prototype[name] as (...a: never[]) => unknown).toString().replace(/\/\/.*$/gm, '');
      expect(src, name).not.toMatch(/\bnew\b|=>|\bfunction\b|\.\.\./);
    }
  });
});
