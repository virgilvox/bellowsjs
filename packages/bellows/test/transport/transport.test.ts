import { describe, it, expect } from 'vitest';
import { Transport, type TransportTick } from '../../src/seq/transport';

function collect(gen: Generator<TransportTick, void, void>): TransportTick[] {
  return Array.from(gen);
}

describe('Transport running clock', () => {
  it('anchors beat 0 at the start time', () => {
    const t = new Transport({ bpm: 120 });
    t.start(10);
    expect(t.beatAt(10)).toBeCloseTo(0, 12);
    expect(t.beatAt(11)).toBeCloseTo(2, 12);
    expect(t.secondsAt(4)).toBeCloseTo(12, 12);
  });

  it('beatAt and secondsAt are inverses over a tempo curve', () => {
    const t = new Transport({ bpm: 120 });
    t.tempo.rampTo(8, 60);
    t.tempo.setBpm(12, 150);
    t.start(3);
    for (let b = 0; b <= 16; b += 0.5) {
      expect(t.beatAt(t.secondsAt(b))).toBeCloseTo(b, 9);
    }
  });

  it('reports beat 0 when stopped and the frozen beat when paused', () => {
    const t = new Transport({ bpm: 120 });
    expect(t.state).toBe('stopped');
    expect(t.beatAt(99)).toBe(0);
    t.start(0);
    t.pause(2);
    expect(t.state).toBe('paused');
    expect(t.beatAt(50)).toBeCloseTo(4, 12);
    t.stop();
    expect(t.beatAt(50)).toBe(0);
  });
});

describe('Transport pause and resume', () => {
  it('preserves the beat position across a gap', () => {
    const t = new Transport({ bpm: 120 });
    t.start(0);
    t.pause(2); // beat 4
    t.resume(5);
    expect(t.beatAt(5)).toBeCloseTo(4, 12);
    expect(t.beatAt(5.5)).toBeCloseTo(5, 12);
    expect(t.secondsAt(6)).toBeCloseTo(6, 12);
  });

  it('preserves position across a gap with a tempo ramp underfoot', () => {
    const t = new Transport({ bpm: 120 });
    t.tempo.rampTo(8, 60);
    t.start(0);
    const tPause = t.secondsAt(3);
    t.pause(tPause);
    t.resume(tPause + 10);
    expect(t.beatAt(tPause + 10)).toBeCloseTo(3, 9);
    // still follows the same curve after resuming
    const later = t.secondsAt(6);
    expect(t.beatAt(later)).toBeCloseTo(6, 9);
  });

  it('ignores pause when not running and resume when not paused', () => {
    const t = new Transport();
    t.pause(1);
    expect(t.state).toBe('stopped');
    t.start(0);
    t.resume(2);
    expect(t.state).toBe('running');
    expect(t.beatAt(1)).toBeCloseTo(2, 12);
  });
});

describe('Transport live bpm changes', () => {
  it('keeps the beat position continuous when bpm changes while running', () => {
    const t = new Transport({ bpm: 120 });
    t.start(0);
    expect(t.beatAt(2)).toBeCloseTo(4, 12);
    t.setBpm(60, 2);
    expect(t.beatAt(2)).toBeCloseTo(4, 12);
    expect(t.beatAt(3)).toBeCloseTo(5, 12);
    expect(t.secondsAt(6)).toBeCloseTo(4, 12);
  });

  it('applies from beat 0 when not running', () => {
    const t = new Transport({ bpm: 120 });
    t.setBpm(60);
    t.start(0);
    expect(t.beatAt(2)).toBeCloseTo(2, 12);
  });
});

describe('Transport position and meter map', () => {
  it('computes bar, beat, phase in the default 4/4', () => {
    const t = new Transport({ bpm: 120 });
    t.start(0);
    // 12 seconds at 120 bpm is beat 4.5
    expect(t.position(2.25)).toEqual({ bar: 1, beat: 0, phase: 0.5 });
    const p0 = t.position(0);
    expect(p0.bar).toBe(0);
    expect(p0.beat).toBe(0);
    expect(p0.phase).toBeCloseTo(0, 12);
  });

  it('honors a constructor meter', () => {
    const t = new Transport({ bpm: 60, meter: { num: 3, den: 4 } });
    t.start(0);
    expect(t.position(3).bar).toBe(1);
    expect(t.position(4)).toEqual({ bar: 1, beat: 1, phase: 0 });
  });

  it('meter changes shift the bar math from their bar onward', () => {
    const t = new Transport({ bpm: 60 });
    t.setMeter(2, { num: 3, den: 4 });
    t.start(0);
    // bars 0 and 1 are 4/4 (beats 0..8), bar 2 onward is 3/4
    expect(t.position(7)).toEqual({ bar: 1, beat: 3, phase: 0 });
    expect(t.position(8)).toEqual({ bar: 2, beat: 0, phase: 0 });
    expect(t.position(10)).toEqual({ bar: 2, beat: 2, phase: 0 });
    expect(t.position(11)).toEqual({ bar: 3, beat: 0, phase: 0 });
    expect(t.position(14)).toEqual({ bar: 4, beat: 0, phase: 0 });
  });

  it('supports stacked meter changes', () => {
    const t = new Transport({ bpm: 60 });
    t.setMeter(1, { num: 6, den: 8 }); // 3 beats per bar from bar 1
    t.setMeter(3, { num: 2, den: 4 }); // 2 beats per bar from bar 3
    t.start(0);
    expect(t.position(4)).toEqual({ bar: 1, beat: 0, phase: 0 });
    expect(t.position(10)).toEqual({ bar: 3, beat: 0, phase: 0 });
    expect(t.position(13)).toEqual({ bar: 4, beat: 1, phase: 0 });
  });

  it('rejects invalid meter placement', () => {
    const t = new Transport();
    expect(() => t.setMeter(-1, { num: 4, den: 4 })).toThrow();
    expect(() => t.setMeter(1.5, { num: 4, den: 4 })).toThrow();
    expect(() => t.setMeter(1, { num: 0, den: 4 })).toThrow();
  });
});

describe('Transport swing', () => {
  it('shifts only odd subdivision steps, by amount * subdivision * 0.5', () => {
    const t = new Transport({ bpm: 120 });
    t.setSwing(0.5, 0.5);
    expect(t.swungBeat(0)).toBe(0); // step 0, even
    expect(t.swungBeat(0.5)).toBeCloseTo(0.625, 12); // step 1, odd
    expect(t.swungBeat(1)).toBe(1); // step 2, even
    expect(t.swungBeat(1.5)).toBeCloseTo(1.625, 12); // step 3, odd
  });

  it('zero swing is identity and amount 1 hits the two-thirds point', () => {
    const t = new Transport();
    expect(t.swungBeat(0.5)).toBe(0.5);
    t.setSwing(1, 0.5);
    expect(t.swungBeat(0.5)).toBeCloseTo(0.75, 12);
  });

  it('validates its arguments', () => {
    const t = new Transport();
    expect(() => t.setSwing(-0.1)).toThrow();
    expect(() => t.setSwing(1.1)).toThrow();
    expect(() => t.setSwing(0.5, 0)).toThrow();
  });
});

describe('Transport scheduleHorizon', () => {
  it('yields nothing unless running', () => {
    const t = new Transport();
    expect(collect(t.scheduleHorizon(0, 10, 0.5))).toEqual([]);
  });

  it('ticks a constant tempo grid with consecutive steps', () => {
    const t = new Transport({ bpm: 120 });
    t.start(0);
    const ticks = collect(t.scheduleHorizon(0, 2, 0.5));
    expect(ticks.length).toBe(8);
    ticks.forEach((tick, i) => {
      expect(tick.step).toBe(i);
      expect(tick.beat).toBeCloseTo(i * 0.5, 12);
      expect(tick.seconds).toBeCloseTo(i * 0.25, 12);
    });
  });

  it('windows are half open and abut without gaps or duplicates', () => {
    const t = new Transport({ bpm: 137 });
    t.tempo.rampTo(16, 92);
    t.start(1);
    const a = collect(t.scheduleHorizon(1, 2.3, 0.25));
    const b = collect(t.scheduleHorizon(2.3, 4.1, 0.25));
    const steps = [...a, ...b].map((tk) => tk.step);
    steps.forEach((s, i) => expect(s).toBe(steps[0] + i));
  });

  it('follows a tempo ramp: monotonic and matching secondsAt', () => {
    const t = new Transport({ bpm: 120 });
    t.tempo.rampTo(8, 60);
    t.start(0);
    const end = t.secondsAt(8);
    const ticks = collect(t.scheduleHorizon(0, end, 0.5));
    expect(ticks.length).toBe(16); // grid beats 0, 0.5, ... 7.5
    let prev = -Infinity;
    for (const tick of ticks) {
      expect(tick.seconds).toBeGreaterThan(prev);
      prev = tick.seconds;
      expect(tick.seconds).toBeCloseTo(t.secondsAt(tick.beat), 12);
      expect(tick.seconds).toBeCloseTo(t.tempo.beatToSeconds(tick.beat), 12);
    }
    // late ticks are spaced wider than early ones as the tempo falls
    const first = ticks[1].seconds - ticks[0].seconds;
    const last = ticks[15].seconds - ticks[14].seconds;
    expect(last).toBeGreaterThan(first);
  });

  it('applies swing to odd steps only', () => {
    const t = new Transport({ bpm: 120 });
    t.setSwing(0.6, 0.5);
    t.start(0);
    const ticks = collect(t.scheduleHorizon(0, 2, 0.5));
    for (const tick of ticks) {
      const grid = tick.step * 0.5;
      const expected = tick.step % 2 === 1 ? grid + 0.6 * 0.5 * 0.5 : grid;
      expect(tick.beat).toBeCloseTo(expected, 12);
      expect(tick.seconds).toBeCloseTo(t.secondsAt(expected), 12);
    }
    expect(ticks.some((tk) => tk.step % 2 === 1)).toBe(true);
  });

  it('a swung tick pulled across the window edge lands in the later window', () => {
    const t = new Transport({ bpm: 120 });
    t.setSwing(1, 0.5); // odd steps land 0.25 beats late = 0.125 s at 120
    t.start(0);
    // unswung step 1 would be at 0.25 s; swung it lands at 0.375 s
    const early = collect(t.scheduleHorizon(0, 0.3, 0.5));
    expect(early.map((tk) => tk.step)).toEqual([0]);
    const later = collect(t.scheduleHorizon(0.3, 0.5, 0.5));
    expect(later.map((tk) => tk.step)).toEqual([1]);
    expect(later[0].seconds).toBeCloseTo(0.375, 12);
  });

  it('never yields negative steps', () => {
    const t = new Transport({ bpm: 120 });
    t.start(5);
    const ticks = collect(t.scheduleHorizon(0, 6, 0.5));
    expect(ticks[0].step).toBe(0);
    expect(ticks[0].seconds).toBeCloseTo(5, 12);
  });

  it('resumes on the same grid after pause', () => {
    const t = new Transport({ bpm: 120 });
    t.start(0);
    t.pause(1); // beat 2, step 4 at 0.5 subdivision
    t.resume(10);
    const ticks = collect(t.scheduleHorizon(10, 11, 0.5));
    expect(ticks.map((tk) => tk.step)).toEqual([4, 5, 6, 7]);
    expect(ticks[0].seconds).toBeCloseTo(10, 12);
  });
});

describe('Transport determinism', () => {
  it('two identically configured transports agree everywhere', () => {
    const make = () => {
      const t = new Transport({ bpm: 96, meter: { num: 3, den: 4 } });
      t.tempo.rampTo(6, 132);
      t.setSwing(0.3, 0.25);
      t.setMeter(4, { num: 4, den: 4 });
      t.start(2);
      return t;
    };
    const a = make();
    const b = make();
    const ta = collect(a.scheduleHorizon(2, 8, 0.25));
    const tb = collect(b.scheduleHorizon(2, 8, 0.25));
    expect(ta).toEqual(tb);
    for (let s = 2; s < 8; s += 0.7) {
      expect(a.beatAt(s)).toBe(b.beatAt(s));
      expect(a.position(s)).toEqual(b.position(s));
    }
  });
});
