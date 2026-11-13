import { describe, expect, it } from 'vitest';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import {
  CRITDAMP_MAX_OMEGA,
  CRITDAMP_SETTLE_98,
  CritDamp,
  CritDampBank,
} from '../../src/dsp/critdamp';

/** Linear-interpolated time at which a rising run first reaches level, stepping at rate. */
function crossingTime(cd: CritDamp, rate: number, level: number, maxSeconds: number): number {
  let prev = cd.value;
  const n = Math.ceil(maxSeconds * rate);
  for (let i = 1; i <= n; i++) {
    const x = cd.step();
    if (x >= level) return (i - 1 + (level - prev) / (x - prev)) / rate;
    prev = x;
  }
  return Infinity;
}

function tracker(rate: number, seconds: number, from = 0, to = 1): CritDamp {
  const cd = new CritDamp(rate);
  cd.setTime(seconds);
  cd.snap(from);
  cd.setTarget(to);
  return cd;
}

/** Control rate of a kernel that updates every 32 samples at 44100. */
const CONTROL = 44100 / 32;

describe('CritDamp', () => {
  it('reaches 98 percent of a step at the time setTime promises, within 2 percent', () => {
    for (const rate of [CONTROL, 44100, 96000]) {
      for (const seconds of [0.03, 0.093, 0.25, 1]) {
        const t = crossingTime(tracker(rate, seconds), rate, 0.98, 4 * seconds);
        expect(Math.abs(t - seconds) / seconds).toBeLessThan(0.02);
      }
    }
  });

  it('reaches 98 percent at 5.8339 / w when set by omega', () => {
    const rate = 48000;
    for (const hz of [6, 10, 13]) {
      const w = 2 * Math.PI * hz;
      const cd = new CritDamp(rate);
      cd.setOmega(w);
      cd.setTarget(1);
      const t = crossingTime(cd, rate, 0.98, 1);
      expect(Math.abs(t - CRITDAMP_SETTLE_98 / w) / (CRITDAMP_SETTLE_98 / w)).toBeLessThan(0.02);
    }
    // The constant is the root it claims to be.
    const u = CRITDAMP_SETTLE_98;
    expect(Math.abs((1 + u) * Math.exp(-u) - 0.02)).toBeLessThan(1e-14);
  });

  it('rises monotonically and never overshoots, up and down', () => {
    for (const rate of [CONTROL, 44100]) {
      for (const [from, to] of [
        [0, 1],
        [3000, 250],
        [-2, 5],
      ]) {
        const cd = tracker(rate, 0.1, from, to);
        const dir = Math.sign(to - from);
        let prev = from;
        for (let i = 0; i < rate; i++) {
          const x = cd.step();
          expect(dir * (x - prev)).toBeGreaterThanOrEqual(0);
          expect(dir * (x - to)).toBeLessThanOrEqual(0);
          prev = x;
        }
        expect(Math.abs(prev - to)).toBeLessThan(1e-9 * Math.abs(to - from));
      }
    }
  });

  it('follows the same trajectory at every step rate, to well within 1 percent', () => {
    /*
     * The exact solution of a step from rest: the share of the way still
     * to go is (1 + w t) exp(-w t). The target then jumps at 0.05 s, a
     * time every rate below lands on exactly, and the run is compared
     * against 96000 sampled on the coarsest grid.
     */
    const seconds = 0.12;
    const w = CRITDAMP_SETTLE_98 / seconds;
    const rates = [100, 1000, 44100, 48000, 96000];
    const runs = rates.map((rate) => {
      const cd = tracker(rate, seconds, 0, 1);
      const per = rate / 100; // steps per 10 ms
      const out: number[] = [];
      for (let k = 1; k <= 30; k++) {
        if (k === 6) cd.setTarget(-0.5);
        for (let i = 0; i < per; i++) cd.step();
        out.push(cd.value);
      }
      return out;
    });
    for (let k = 0; k < 5; k++) {
      const t = (k + 1) * 0.01;
      const exact = 1 - (1 + w * t) * Math.exp(-w * t);
      for (const run of runs) expect(Math.abs(run[k] - exact)).toBeLessThan(1e-9);
    }
    // The brief asks for 1 percent; the exact step holds a billionth.
    const ref = runs[runs.length - 1];
    for (const run of runs) {
      for (let k = 0; k < run.length; k++) expect(Math.abs(run[k] - ref[k])).toBeLessThan(1e-9);
    }
    // And the control rate a kernel uses, on its own grid, crosses 98 percent with the rest.
    const tc = crossingTime(tracker(CONTROL, seconds), CONTROL, 0.98, 1);
    const ta = crossingTime(tracker(96000, seconds), 96000, 0.98, 1);
    expect(Math.abs(tc - ta) / ta).toBeLessThan(0.01);
  });

  it('is stable for any step size, where the semi-implicit Euler step diverges', () => {
    /*
     * w h = 58 here. CHIMERA's semi-implicit Euler (its comment: stable
     * for w dt < 1) multiplies the velocity by about 1 - 2 w h = -115 a
     * step at this setting; the exact step multiplies by exp(-w h).
     */
    const rate = 10;
    const cd = tracker(rate, 0.01, 0, 1);
    const w = CRITDAMP_SETTLE_98 / 0.01;
    let ex = 0;
    let ev = 0;
    for (let i = 0; i < 20; i++) {
      const x = cd.step();
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeLessThanOrEqual(1);
      ev += (w * w * (1 - ex) - 2 * w * ev) / rate;
      ex += ev / rate;
    }
    expect(cd.value).toBe(1);
    expect(Math.abs(ex)).toBeGreaterThan(1e30);
  });

  it('keeps value and velocity when the target moves mid-glide', () => {
    const cd = tracker(48000, 0.1, 0, 1);
    for (let i = 0; i < 1000; i++) cd.step();
    const x = cd.value;
    const v = cd.velocity;
    expect(v).toBeGreaterThan(0);
    cd.setTarget(-1);
    expect(cd.value).toBe(x);
    expect(cd.velocity).toBe(v);
    // The next step still moves the way it was going, by about v h.
    const next = cd.step();
    expect(next).toBeGreaterThan(x);
    expect(Math.abs(next - x - v / 48000)).toBeLessThan(0.01 * (v / 48000));
  });

  it('snaps immediately and rests there', () => {
    const cd = tracker(44100, 0.2, 0, 1);
    for (let i = 0; i < 500; i++) cd.step();
    cd.snap(7.5);
    expect(cd.value).toBe(7.5);
    expect(cd.target).toBe(7.5);
    expect(cd.velocity).toBe(0);
    for (let i = 0; i < 100; i++) expect(cd.step()).toBe(7.5);
  });

  it('arrives on the next step with time 0 or the fastest omega', () => {
    const a = tracker(44100, 0, 0, 3);
    expect(a.step()).toBe(3);
    const b = new CritDamp(1000);
    b.setOmega(CRITDAMP_MAX_OMEGA * 10);
    b.setTarget(-4);
    expect(b.step()).toBe(-4);
    expect(Math.abs(b.velocity)).toBe(0);
  });

  it('ignores non-finite arguments and keeps the last good setting', () => {
    const ref = tracker(44100, 0.05, 0, 1);
    const cd = tracker(44100, 0.05, 0, 1);
    cd.setTarget(NaN);
    cd.setTime(NaN);
    cd.setTime(Infinity);
    cd.setOmega(NaN);
    cd.setOmega(-Infinity);
    cd.snap(NaN);
    for (let i = 0; i < 4410; i++) expect(cd.step()).toBe(ref.step());
  });

  it('throws on a step rate that would make every value NaN', () => {
    for (const bad of [0, -48000, NaN, Infinity, 1e-9]) expect(() => new CritDamp(bad)).toThrow(RangeError);
    expect(() => new CritDamp(1378.125)).not.toThrow();
  });
});

describe('CritDampBank', () => {
  it('steps every channel bit for bit as a lone CritDamp would', () => {
    const rate = 44100 / 64;
    const n = 15;
    const bank = new CritDampBank(n, rate);
    const lone = Array.from({ length: n }, () => new CritDamp(rate));
    for (let i = 0; i < n; i++) {
      const seconds = 0.03 + 0.01 * i;
      bank.setTime(i, seconds);
      lone[i].setTime(seconds);
      bank.snap(i, 100 * i);
      lone[i].snap(100 * i);
    }
    bank.setOmega(3, 40);
    lone[3].setOmega(40);
    for (let s = 0; s < 3000; s++) {
      if (s % 97 === 0) {
        for (let i = 0; i < n; i++) {
          const t = 50 * ((s * 31 + i * 17) % 23);
          bank.setTarget(i, t);
          lone[i].setTarget(t);
        }
      }
      if (s === 1500) {
        bank.snap(7, -3);
        lone[7].snap(-3);
      }
      bank.step();
      for (let i = 0; i < n; i++) {
        lone[i].step();
        expect(bank.value(i)).toBe(lone[i].value);
        expect(bank.values[i]).toBe(lone[i].value);
        expect(bank.velocity(i)).toBe(lone[i].velocity);
        expect(bank.target(i)).toBe(lone[i].target);
      }
    }
  });

  it('keeps its channels independent and its arrays in place', () => {
    const bank = new CritDampBank(4, 1000);
    const values = bank.values;
    bank.setTarget(2, 10);
    for (let s = 0; s < 50; s++) bank.step();
    expect(bank.values).toBe(values);
    expect(bank.value(0)).toBe(0);
    expect(bank.value(1)).toBe(0);
    expect(bank.value(2)).toBeGreaterThan(5);
    expect(bank.value(3)).toBe(0);
  });

  it('ignores non-finite arguments and rejects impossible shapes', () => {
    const bank = new CritDampBank(2, 1000);
    bank.setTarget(0, 1);
    bank.setTarget(0, NaN);
    bank.setTime(0, NaN);
    bank.setOmega(0, Infinity);
    bank.snap(1, NaN);
    expect(bank.target(0)).toBe(1);
    for (let s = 0; s < 1000; s++) bank.step();
    expect(Number.isFinite(bank.value(0))).toBe(true);
    expect(bank.value(1)).toBe(0);
    for (const bad of [0, -1, 1.5, NaN, 2 ** 21]) expect(() => new CritDampBank(bad, 1000)).toThrow(RangeError);
    expect(() => new CritDampBank(15, 0)).toThrow(RangeError);
  });
});

describe('CritDamp slowing down mid-move', () => {
  /*
   * A move started fast and slowed partway through used to keep the speed
   * it had built, and a critically damped channel carrying more velocity
   * than its new rate times the remaining error overshoots: a 40 ms glide
   * to 12 stretched to 300 ms 10 ms in peaked at 18.5, and 5 ms to 500 ms
   * at 57. Scaling the velocity with the rate keeps it monotone.
   */
  const RATE = 48000 / 32;
  for (const [fast, slow, after] of [[0.04, 0.3, 0.01], [0.04, 0.3, 0.005], [0.005, 0.5, 0.002], [0.01, 2, 0.004]] as const) {
    it(`never passes the target when ${fast * 1000} ms becomes ${slow * 1000} ms ${after * 1000} ms in`, () => {
      const cd = tracker(RATE, fast, 0, 12);
      const bank = new CritDampBank(1, RATE);
      bank.setTime(0, fast);
      bank.snap(0, 0);
      bank.setTarget(0, 12);
      let hi = 0;
      for (let i = 0; i < 3 * RATE; i++) {
        if (i === Math.round(after * RATE)) {
          cd.setTime(slow);
          bank.setTime(0, slow);
        }
        const x = cd.step();
        bank.step();
        expect(bank.value(0)).toBe(x);
        hi = Math.max(hi, x);
      }
      expect(hi).toBeLessThanOrEqual(12 + 1e-9);
      expect(cd.value).toBeCloseTo(12, 1);
    });
  }

  it('settles exactly on its target, so no subnormal stays in the state', () => {
    const cd = tracker(1000, 0.01, 0, 1);
    const bank = new CritDampBank(1, 1000);
    bank.setTime(0, 0.01);
    bank.snap(0, 0);
    bank.setTarget(0, 1e-300);
    cd.setTarget(1e-300);
    for (let i = 0; i < 5000; i++) {
      cd.step();
      bank.step();
    }
    expect(cd.value).toBe(1e-300);
    expect(cd.velocity).toBe(0);
    expect(bank.value(0)).toBe(1e-300);
    expect(bank.velocity(0)).toBe(0);
  });
});

describe('CritDamp allocation', () => {
  /*
   * Counts garbage collections whose start falls inside a synchronous run.
   * Nothing else runs on this thread during the run, so a collection that
   * starts inside it was caused by what the run allocated. The control
   * below proves the probe can see allocation: measured, two million calls
   * that each keep a two-element Float64Array trigger dozens of
   * collections, while two million CritDamp or bank steps trigger none.
   * The warm-up lets V8 optimise the loop first, because unoptimised code
   * boxes every intermediate double and would allocate on its own.
   */
  async function collectionsDuring(run: () => void): Promise<number> {
    const starts: number[] = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) starts.push(e.startTime);
    });
    obs.observe({ entryTypes: ['gc'] });
    const t0 = performance.now();
    run();
    const t1 = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 100));
    obs.disconnect();
    return starts.filter((t) => t >= t0 && t <= t1).length;
  }

  const STEPS = 2_000_000;

  it('step() allocates nothing, single and bank', async () => {
    const one = tracker(48000, 0.08, 0, 1);
    const bank = new CritDampBank(15, 48000 / 32);
    for (let i = 0; i < 15; i++) bank.setTarget(i, 100 * i);
    // the results go to a typed slot, not a local: Node 20's on-stack-replaced loop boxed a double
    // accumulator on every step (MEASURED: 31 collections there, none with the result unused or here)
    const acc = new Float64Array(1);
    const runOne = (n: number) => {
      for (let i = 0; i < n; i++) {
        if ((i & 4095) === 0) one.setTarget(i & 8192 ? 1 : -1);
        acc[0] += one.step();
      }
      return acc[0];
    };
    const runBank = (n: number) => {
      for (let i = 0; i < n; i++) {
        if ((i & 1023) === 0) bank.setTarget(i % 15, i & 2048 ? 300 : 2500);
        bank.step();
      }
      return bank.value(0);
    };
    runOne(300_000);
    runBank(100_000);
    let sink = 0;
    const single = await collectionsDuring(() => {
      sink += runOne(STEPS);
    });
    const banked = await collectionsDuring(() => {
      sink += runBank(STEPS / 4);
    });
    expect(Number.isFinite(sink)).toBe(true);
    expect(single).toBe(0);
    expect(banked).toBe(0);
  });

  it('the probe does see a step that allocates', async () => {
    const keep: Float64Array[] = new Array(1024);
    const leaky = (i: number) => {
      const pair = new Float64Array(2);
      pair[0] = i;
      keep[i & 1023] = pair;
      return pair[0];
    };
    let sink = 0;
    const control = await collectionsDuring(() => {
      for (let i = 0; i < STEPS; i++) sink += leaky(i);
    });
    expect(sink).toBeGreaterThan(0);
    expect(control).toBeGreaterThan(0);
  });
});
