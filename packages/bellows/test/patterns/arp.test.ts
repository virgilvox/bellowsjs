import { describe, it, expect } from 'vitest';
import { Arpeggiator } from '../../src/seq/arp';
import { rng } from '../../src/core/prng';

function take(arp: Arpeggiator, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(arp.next());
  return out;
}

describe('Arpeggiator', () => {
  it('up sorts ascending regardless of input order', () => {
    const arp = new Arpeggiator({ mode: 'up' });
    arp.setNotes([67, 60, 64]);
    expect(take(arp, 6)).toEqual([60, 64, 67, 60, 64, 67]);
  });

  it('down plays descending', () => {
    const arp = new Arpeggiator({ mode: 'down' });
    arp.setNotes([60, 64, 67]);
    expect(take(arp, 6)).toEqual([67, 64, 60, 67, 64, 60]);
  });

  it('updown does not repeat endpoints', () => {
    const arp = new Arpeggiator({ mode: 'updown' });
    arp.setNotes([60, 64, 67]);
    expect(take(arp, 8)).toEqual([60, 64, 67, 64, 60, 64, 67, 64]);
  });

  it('downup does not repeat endpoints', () => {
    const arp = new Arpeggiator({ mode: 'downup' });
    arp.setNotes([60, 64, 67]);
    expect(take(arp, 8)).toEqual([67, 64, 60, 64, 67, 64, 60, 64]);
  });

  it('updown degenerates gracefully with one or two notes', () => {
    const one = new Arpeggiator({ mode: 'updown' });
    one.setNotes([60]);
    expect(take(one, 3)).toEqual([60, 60, 60]);
    const two = new Arpeggiator({ mode: 'updown' });
    two.setNotes([60, 64]);
    expect(take(two, 4)).toEqual([60, 64, 60, 64]);
  });

  it('octaves expand the pool upward', () => {
    const arp = new Arpeggiator({ mode: 'up', octaves: 2 });
    arp.setNotes([60, 64, 67]);
    expect(take(arp, 7)).toEqual([60, 64, 67, 72, 76, 79, 60]);
  });

  it('updown across octaves keeps the no-repeat rule at the octave seam', () => {
    const arp = new Arpeggiator({ mode: 'updown', octaves: 2 });
    arp.setNotes([60, 64]);
    expect(take(arp, 7)).toEqual([60, 64, 72, 76, 72, 64, 60]);
  });

  it('order preserves the given order', () => {
    const arp = new Arpeggiator({ mode: 'order' });
    arp.setNotes([67, 60, 64]);
    expect(take(arp, 6)).toEqual([67, 60, 64, 67, 60, 64]);
  });

  it('random draws from the pool, deterministically per seed', () => {
    const notes = [60, 64, 67];
    const draw = (label: string) => {
      const arp = new Arpeggiator({ mode: 'random', octaves: 2 });
      arp.setNotes(notes);
      const r = rng(label);
      const out: number[] = [];
      for (let i = 0; i < 40; i++) out.push(arp.next(r));
      return out;
    };
    const a = draw('arp-1');
    expect(a).toEqual(draw('arp-1'));
    expect(a).not.toEqual(draw('arp-2'));
    const pool = [60, 64, 67, 72, 76, 79];
    for (const v of a) expect(pool).toContain(v);
  });

  it('reset returns to the start of the cycle', () => {
    const arp = new Arpeggiator({ mode: 'up' });
    arp.setNotes([60, 64, 67]);
    arp.next();
    arp.next();
    arp.reset();
    expect(arp.next()).toBe(60);
  });

  it('setNotes keeps the position modulo the new cycle', () => {
    const arp = new Arpeggiator({ mode: 'up' });
    arp.setNotes([60, 64, 67]);
    arp.next(); // position 1
    arp.setNotes([50, 55, 59]);
    expect(arp.next()).toBe(55);
  });

  it('validates construction and use', () => {
    expect(() => new Arpeggiator({ mode: 'sideways' as never })).toThrow(RangeError);
    expect(() => new Arpeggiator({ mode: 'up', octaves: 0 })).toThrow(RangeError);
    expect(() => new Arpeggiator({ mode: 'up', octaves: 1.5 })).toThrow(RangeError);
    const arp = new Arpeggiator({ mode: 'up' });
    expect(() => arp.next()).toThrow();
    expect(() => arp.setNotes([60, NaN])).toThrow(RangeError);
    const rnd = new Arpeggiator({ mode: 'random' });
    rnd.setNotes([60]);
    expect(() => rnd.next()).toThrow();
  });
});
