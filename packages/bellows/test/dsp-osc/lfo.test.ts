import { describe, expect, it } from 'vitest';
import { rng } from '../../src/core/prng';
import { Lfo, type LfoShape } from '../../src/dsp/lfo';
import { zeroCrossings } from './spectrum';

const SR = 44100;

function render(lfo: Lfo, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lfo.next());
  return out;
}

describe('Lfo shapes', () => {
  it('sine stays bipolar and hits the requested rate', () => {
    const lfo = new Lfo(SR);
    lfo.setShape('sine');
    lfo.setFreq(2);
    const out = render(lfo, SR); // exactly one second at 2 Hz
    // the sine starts exactly on the zero at phase 0, so of the four
    // zeros per second the first is the ignored start sample and the
    // wrap back to zero lands on the first sample of the next second:
    // exactly three sign changes inside the rendered second
    expect(zeroCrossings(out)).toBe(3);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('triangle ramps linearly up then down', () => {
    const lfo = new Lfo(SR);
    lfo.setShape('triangle');
    lfo.setFreq(1);
    const out = render(lfo, SR);
    expect(out[0]).toBeCloseTo(-1, 5);
    expect(out[Math.floor(SR / 4)]).toBeCloseTo(0, 3);
    expect(out[Math.floor(SR / 2)]).toBeCloseTo(1, 3);
    expect(out[Math.floor((3 * SR) / 4)]).toBeCloseTo(0, 3);
  });

  it('saw ramps from -1 to 1 each cycle', () => {
    const lfo = new Lfo(SR);
    lfo.setShape('saw');
    lfo.setFreq(1);
    const out = render(lfo, SR);
    expect(out[0]).toBeCloseTo(-1, 5);
    expect(out[SR - 1]).toBeCloseTo(1, 3);
    for (let i = 1; i < SR; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });

  it('square is +1 the first half cycle, -1 the second', () => {
    const lfo = new Lfo(SR);
    lfo.setShape('square');
    lfo.setFreq(1);
    const out = render(lfo, SR);
    expect(out[100]).toBe(1);
    expect(out[Math.floor(SR * 0.75)]).toBe(-1);
  });
});

describe('Lfo sample and hold', () => {
  it('holds one value per cycle then steps', () => {
    const lfo = new Lfo(SR, rng('lfo-test'));
    lfo.setShape('sh');
    lfo.setFreq(100); // 441 samples per cycle
    const out = render(lfo, SR);
    // constant within a cycle
    for (let i = 1; i < 400; i++) expect(out[i]).toBe(out[0]);
    // collect distinct held values across one second
    const distinct = new Set(out);
    expect(distinct.size).toBeGreaterThan(50);
    for (const v of distinct) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for the same rng label', () => {
    const make = () => {
      const lfo = new Lfo(SR, rng('sh-seed'));
      lfo.setShape('sh');
      lfo.setFreq(500);
      return render(lfo, 4096);
    };
    expect(make()).toEqual(make());
  });

  it('works without an injected rng and stays deterministic', () => {
    const make = () => {
      const lfo = new Lfo(SR);
      lfo.setShape('sh');
      lfo.setFreq(500);
      return render(lfo, 2048);
    };
    expect(make()).toEqual(make());
  });
});

describe('Lfo reset', () => {
  const shapes: LfoShape[] = ['sine', 'triangle', 'saw', 'square'];
  for (const shape of shapes) {
    it(`${shape} replays identically after reset`, () => {
      const lfo = new Lfo(SR);
      lfo.setShape(shape);
      lfo.setFreq(3.7);
      const a = render(lfo, 1000);
      lfo.reset();
      const b = render(lfo, 1000);
      expect(b).toEqual(a);
    });
  }

  it('reset accepts a phase offset', () => {
    const lfo = new Lfo(SR);
    lfo.setShape('saw');
    lfo.setFreq(1);
    lfo.reset(0.5);
    expect(lfo.next()).toBeCloseTo(0, 5);
  });
});
