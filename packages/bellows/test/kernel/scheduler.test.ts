import { describe, it, expect } from 'vitest';
import { Scheduler } from '../../src/core/scheduler';
import { Transport } from '../../src/seq/transport';

describe('lookahead scheduler', () => {
  it('fires every subdivision exactly once across overlapping windows', () => {
    const tr = new Transport({ bpm: 120 }); // 0.5 s per beat
    tr.start(0);
    const sched = new Scheduler(tr, { horizon: 0.3 });
    const fired: number[] = [];
    sched.at(0.25, (t, step) => fired.push(step)); // 16ths at 120: every 0.125 s

    // simulate a 25 ms timer over 2 seconds
    for (let now = 0; now < 2; now += 0.025) sched.tick(now);

    // 2.3 s window covered: steps 0..~18
    const unique = new Set(fired);
    expect(unique.size).toBe(fired.length); // no doubles
    for (let i = 0; i < fired.length - 1; i++) expect(fired[i + 1]).toBe(fired[i] + 1); // no gaps
    expect(fired.length).toBeGreaterThan(16);
  });

  it('survives a late timer without losing ticks', () => {
    const tr = new Transport({ bpm: 120 });
    tr.start(0);
    const sched = new Scheduler(tr, { horizon: 0.3 });
    const times: number[] = [];
    sched.at(0.25, (t) => times.push(t));
    sched.tick(0);
    sched.tick(0.28); // long stall, still inside horizon
    sched.tick(0.31);
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i + 1] - times[i]).toBeCloseTo(0.125, 6);
    }
  });

  it('delivers swung tick times', () => {
    const tr = new Transport({ bpm: 120 });
    tr.setSwing(0.5, 0.25);
    tr.start(0);
    const sched = new Scheduler(tr, { horizon: 0.5 });
    const times: number[] = [];
    sched.at(0.25, (t) => times.push(t));
    sched.tick(0);
    // even steps on grid (0, 0.25 beats), odd steps late by 0.5*0.25*0.5 beats = 0.0625 beats = 31.25 ms
    expect(times[0]).toBeCloseTo(0, 6);
    expect(times[1]).toBeCloseTo(0.125 + 0.03125, 6);
    expect(times[2]).toBeCloseTo(0.25, 6);
  });

  it('unsubscribe stops delivery', () => {
    const tr = new Transport({ bpm: 120 });
    tr.start(0);
    const sched = new Scheduler(tr, { horizon: 0.2 });
    let n = 0;
    const off = sched.at(0.25, () => n++);
    sched.tick(0);
    const before = n;
    off();
    sched.tick(0.5);
    expect(n).toBe(before);
  });
});

describe('scheduler resilience (review regressions)', () => {
  it('replays recently missed ticks after a late wakeup instead of dropping them', () => {
    const tr = new Transport({ bpm: 120 });
    tr.start(0);
    const sched = new Scheduler(tr, { horizon: 0.12 });
    const steps: number[] = [];
    sched.at(0.25, (t, step) => steps.push(step));
    sched.tick(0);
    sched.tick(0.3); // stalled past the horizon; ticks in the gap must still fire
    for (let i = 0; i < steps.length - 1; i++) expect(steps[i + 1]).toBe(steps[i] + 1);
    expect(Math.max(...steps)).toBeGreaterThanOrEqual(3);
  });

  it('stretches the lookahead to survive background-tab throttling', () => {
    const tr = new Transport({ bpm: 120 });
    tr.start(0);
    const sched = new Scheduler(tr, { horizon: 0.12 });
    const steps: number[] = [];
    sched.at(0.25, (t, step) => steps.push(step));
    // 1 Hz wakeups, like a throttled background tab
    for (let now = 0; now <= 5; now += 1) sched.tick(now);
    for (let i = 0; i < steps.length - 1; i++) expect(steps[i + 1]).toBe(steps[i] + 1);
    // 5 seconds at 8 steps per second, allow the tail window
    expect(steps.length).toBeGreaterThanOrEqual(38);
  });

  it('resyncTo re-aims delivery at a beat for pause and resume', () => {
    const tr = new Transport({ bpm: 120 });
    tr.start(0);
    const sched = new Scheduler(tr, { horizon: 0.2 });
    const steps: number[] = [];
    sched.at(0.25, (t, step) => steps.push(step));
    sched.tick(0); // delivers a lookahead window
    const delivered = steps.length;
    tr.pause(0.1);
    tr.resume(1.0);
    sched.resyncTo(tr.beatAt(1.0));
    sched.tick(1.0);
    // the first post-resume step continues from the paused beat, no gap, no repeat beyond the re-aim
    expect(steps.length).toBeGreaterThan(delivered);
    const post = steps.slice(delivered);
    for (let i = 0; i < post.length - 1; i++) expect(post[i + 1]).toBe(post[i] + 1);
  });
});
