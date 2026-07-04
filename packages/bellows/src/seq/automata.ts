/*
 * Elementary cellular automata with Wolfram rule numbering and wraparound
 * edges. Bit b of the rule number gives the next state for neighborhood
 * (left << 2) | (center << 1) | right = b. The default initial condition
 * is a single live cell in the center.
 */

import type { NamedRng } from '../types';

export class ElementaryCA {
  /** Current generation's cells, 0 or 1 each. Mutated in place by step(). */
  readonly row: Uint8Array;
  generation = 0;

  private readonly table: Uint8Array;
  private readonly scratch: Uint8Array;

  constructor(rule: number, width: number, init?: readonly number[] | NamedRng) {
    if (!Number.isInteger(rule) || rule < 0 || rule > 255) {
      throw new RangeError('ElementaryCA: rule must be an integer in [0, 255]');
    }
    if (!Number.isInteger(width) || width < 1) {
      throw new RangeError('ElementaryCA: width must be a positive integer');
    }
    this.table = new Uint8Array(8);
    for (let b = 0; b < 8; b++) this.table[b] = (rule >> b) & 1;
    this.row = new Uint8Array(width);
    this.scratch = new Uint8Array(width);
    if (init === undefined) {
      this.row[width >> 1] = 1;
    } else if (typeof init === 'function') {
      for (let i = 0; i < width; i++) this.row[i] = init() < 0.5 ? 0 : 1;
    } else {
      if (init.length !== width) {
        throw new RangeError('ElementaryCA: init length must equal width');
      }
      for (let i = 0; i < width; i++) this.row[i] = init[i] ? 1 : 0;
    }
  }

  /** Advance one generation. Edges wrap. */
  step(): void {
    const r = this.row;
    const s = this.scratch;
    const w = r.length;
    for (let i = 0; i < w; i++) {
      const left = r[(i - 1 + w) % w];
      const right = r[(i + 1) % w];
      s[i] = this.table[(left << 2) | (r[i] << 1) | right];
    }
    r.set(s);
    this.generation++;
  }
}

/**
 * Sample one column of a CA's evolution into a gate array. Reads the cell
 * at `column` (default: center), then steps, `steps` times. Advances the
 * automaton by `steps` generations.
 */
export function caRhythm(ca: ElementaryCA, steps: number, column = ca.row.length >> 1): number[] {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError('caRhythm: steps must be a non-negative integer');
  }
  if (!Number.isInteger(column) || column < 0 || column >= ca.row.length) {
    throw new RangeError('caRhythm: column out of range');
  }
  const out = new Array<number>(steps);
  for (let i = 0; i < steps; i++) {
    out[i] = ca.row[column];
    ca.step();
  }
  return out;
}
