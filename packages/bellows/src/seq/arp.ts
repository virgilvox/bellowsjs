/*
 * Arpeggiator over MIDI note numbers. setNotes rebuilds the traversal
 * cycle for the configured mode and octave span; next() pulls one note at
 * a time so schedulers stay in control of timing. 'updown' and 'downup'
 * never repeat the endpoints ([a,b,c] plays a b c b a b c b ...).
 */

import type { NamedRng } from '../types';

export type ArpMode = 'up' | 'down' | 'updown' | 'downup' | 'random' | 'order';

const MODES: readonly ArpMode[] = ['up', 'down', 'updown', 'downup', 'random', 'order'];

export interface ArpOpts {
  mode: ArpMode;
  /** Octave span, 1 = the notes as given. Default 1. */
  octaves?: number;
}

export class Arpeggiator {
  private readonly mode: ArpMode;
  private readonly octaves: number;
  /** Full note pool expanded across octaves, used by 'random'. */
  private pool: number[] = [];
  /** Ordered traversal for the deterministic modes. */
  private cycle: number[] = [];
  private index = 0;

  constructor(opts: ArpOpts) {
    if (!MODES.includes(opts.mode)) {
      throw new RangeError('Arpeggiator: unknown mode "' + String(opts.mode) + '"');
    }
    const octaves = opts.octaves ?? 1;
    if (!Number.isInteger(octaves) || octaves < 1) {
      throw new RangeError('Arpeggiator: octaves must be a positive integer');
    }
    this.mode = opts.mode;
    this.octaves = octaves;
  }

  /**
   * Replace the held notes. The playback position is kept modulo the new
   * cycle length so live chord changes do not restart the pattern.
   */
  setNotes(midis: readonly number[]): void {
    for (const m of midis) {
      if (!Number.isFinite(m)) throw new RangeError('Arpeggiator: notes must be finite numbers');
    }
    // 'order' preserves the given order per octave; others sort ascending.
    const base = this.mode === 'order' ? midis.slice() : midis.slice().sort((a, b) => a - b);
    const pool: number[] = [];
    for (let k = 0; k < this.octaves; k++) {
      for (const m of base) pool.push(m + 12 * k);
    }
    this.pool = pool;
    switch (this.mode) {
      case 'up':
      case 'order':
      case 'random':
        this.cycle = pool;
        break;
      case 'down':
        this.cycle = pool.slice().reverse();
        break;
      case 'updown': {
        const desc = pool.slice().reverse();
        this.cycle = pool.concat(desc.slice(1, desc.length - 1));
        break;
      }
      case 'downup': {
        const desc = pool.slice().reverse();
        this.cycle = desc.concat(pool.slice(1, pool.length - 1));
        break;
      }
    }
    this.index = this.cycle.length > 0 ? this.index % this.cycle.length : 0;
  }

  /** Emit the next note. 'random' mode requires an rng. */
  next(rng?: NamedRng): number {
    if (this.cycle.length === 0) throw new Error('Arpeggiator: no notes set');
    if (this.mode === 'random') {
      if (rng === undefined) throw new Error('Arpeggiator: random mode requires an rng');
      return this.pool[rng.int(this.pool.length)];
    }
    const v = this.cycle[this.index];
    this.index = (this.index + 1) % this.cycle.length;
    return v;
  }

  /** Return to the start of the cycle. */
  reset(): void {
    this.index = 0;
  }
}
