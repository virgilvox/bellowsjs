import { describe, expect, it } from 'vitest';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { PitchGlide } from '../../src/dsp/pitchglide';
import { CritDamp } from '../../src/dsp/critdamp';

const RATE = 1000;

function run(g: PitchGlide, seconds: number, rate = RATE): number[] {
  const out: number[] = [];
  for (let i = 0; i < seconds * rate; i++) out.push(g.step());
  return out;
}

describe('PitchGlide', () => {
  it('overshoots a step by exp(-pi zeta / sqrt(1 - zeta^2)), the second-order law', () => {
    for (const zeta of [0.3, 0.5, 0.7]) {
      const g = new PitchGlide(48000);
      g.setDamping(zeta);
      g.setTarget(1);
      const peak = Math.max(...run(g, 1, 48000));
      expect(peak - 1).toBeCloseTo(Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 4);
    }
  });

  it('at damping 1 and no preparation is the critically damped glide of CritDamp', () => {
    const g = new PitchGlide(RATE);
    g.setDamping(1);
    g.setSpeed(6);
    const cd = new CritDamp(RATE);
    cd.setOmega(2 * Math.PI * 6);
    g.setTarget(7);
    cd.setTarget(7);
    for (let i = 0; i < 800; i++) expect(g.step()).toBeCloseTo(cd.step(), 10);
  });

  it('prepares: a step up first moves down, then settles on the target', () => {
    const g = new PitchGlide(RATE);
    g.setPreparation(0.5);
    g.setTarget(2);
    const y = run(g, 2);
    const low = Math.min(...y.slice(0, 100));
    expect(low).toBeLessThan(-0.05);
    expect(y[y.length - 1]).toBeCloseTo(2, 6);
    // and a step down first moves up
    const d = new PitchGlide(RATE);
    d.setPreparation(0.5);
    d.setTarget(-2);
    expect(Math.max(...run(d, 0.1))).toBeGreaterThan(0.05);
  });

  it('follows the same trajectory at any step rate, being the exact solution sampled', () => {
    const slow = new PitchGlide(500);
    const fast = new PitchGlide(8000);
    for (const g of [slow, fast]) {
      g.setDamping(0.45);
      g.setPreparation(0.3);
      g.setSpeed(7);
      g.setTarget(5);
    }
    const ys = run(slow, 0.6, 500);
    const yf = run(fast, 0.6, 8000);
    for (let i = 0; i < ys.length; i++) expect(ys[i]).toBeCloseTo(yf[(i + 1) * 16 - 1], 9);
  });

  it('matches its closed-form step response, and leadTime() is where that response is half way', () => {
    const g = new PitchGlide(48000);
    g.setDamping(0.55);
    g.setPreparation(0.25);
    g.setSpeed(5);
    const lead = g.leadTime();
    expect(g.stepResponse(lead)).toBeCloseTo(0.5, 9);
    g.setTarget(1);
    const y = run(g, 0.5, 48000);
    for (const t of [0.01, 0.05, lead, 0.2, 0.4]) expect(y[Math.round(t * 48000) - 1]).toBeCloseTo(g.stepResponse(Math.round(t * 48000) / 48000), 6);
    // a faster or better damped glide needs less lead
    const quick = new PitchGlide(48000);
    quick.setSpeed(10);
    expect(quick.leadTime()).toBeLessThan(lead);
  });

  it('keeps value and velocity continuous when the target moves mid-glide', () => {
    const g = new PitchGlide(RATE);
    g.setTarget(3);
    run(g, 0.05);
    const x = g.value;
    const v = g.velocity;
    g.setTarget(-1);
    expect(g.value).toBe(x);
    expect(g.velocity).toBe(v);
    const y = run(g, 2);
    expect(y[y.length - 1]).toBeCloseTo(-1, 6);
  });

  it('ignores non-finite settings and snaps cleanly', () => {
    const g = new PitchGlide(RATE);
    g.setTarget(2);
    g.setTarget(NaN);
    g.setSpeed(Infinity);
    g.setDamping(NaN);
    g.setPreparation(NaN);
    expect(g.target).toBe(2);
    g.snap(-4);
    expect(g.value).toBe(-4);
    expect(g.velocity).toBe(0);
    for (const y of run(g, 0.5)) expect(y).toBe(-4);
    expect(() => new PitchGlide(0)).toThrow(RangeError);
  });

  it('allocates nothing per step: no garbage collection starts during two million steps', async () => {
    // the probe of test/dsp-filt/critdamp.test.ts: a collection that starts
    // inside a synchronous run was caused by what the run allocated
    const g = new PitchGlide(48000);
    g.setPreparation(0.3);
    // into a typed slot, not a local: Node 20 boxed a double accumulator (see the CritDamp probe)
    const acc = new Float64Array(1);
    const runs = (n: number) => {
      for (let i = 0; i < n; i++) {
        if ((i & 4095) === 0) g.setTarget(i & 8192 ? 3 : -2);
        acc[0] += g.step();
      }
      return acc[0];
    };
    runs(300_000);
    const starts: number[] = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) starts.push(e.startTime);
    });
    obs.observe({ entryTypes: ['gc'] });
    const t0 = performance.now();
    const sink = runs(2_000_000);
    const t1 = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 100));
    obs.disconnect();
    expect(Number.isFinite(sink)).toBe(true);
    expect(starts.filter((t) => t >= t0 && t <= t1).length).toBe(0);
  });
});
