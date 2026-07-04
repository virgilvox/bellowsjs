/*
 * Musical time parsing. Everything resolves to BEATS, where one beat is
 * one quarter note. Meter only matters for measure ('2m') and position
 * ('bar:beat:sixteenth') forms; plain note values are meter independent.
 *
 * Accepted forms:
 *  - number: already beats, returned as is
 *  - numeric string: '2.5' parses as beats
 *  - notation: '1n' = 4, '2n' = 2, '4n' = 1, '8n' = 0.5, '16n' = 0.25, ...
 *  - dotted: '4n.' or '4nd' = plain value * 1.5
 *  - triplet: '8t' = two thirds of '8n'
 *  - measures: '2m' = 2 * beatsPerBar(meter), meter defaults to 4/4
 *  - whole-note fraction: '3/8' = (3/8) * 4 beats = 1.5
 *  - position: 'bar:beat:sixteenth', ZERO-BASED bars and beats, so
 *    '2:1:2' in 4/4 = 2 * 4 + 1 + 2 * 0.25 = 9.5 beats. The last field
 *    counts sixteenth notes (quarter beats) and may be fractional.
 *
 * Anything else throws.
 */

import type { TimeValue } from '../types';

export interface Meter {
  /** Beats per bar as written, e.g. 6 in 6/8. */
  num: number;
  /** The note value of one written beat, e.g. 8 in 6/8. */
  den: number;
}

export const DEFAULT_METER: Meter = { num: 4, den: 4 };

/** Quarter-note beats in one bar of the given meter. 6/8 has 3, 3/4 has 3, 4/4 has 4. */
export function beatsPerBar(meter: Meter): number {
  if (!(meter.num > 0) || !(meter.den > 0)) {
    throw new Error(`invalid meter: ${meter.num}/${meter.den}`);
  }
  return (meter.num * 4) / meter.den;
}

const NOTATION = /^(\d+)(n|t)(\.|d)?$/;
const MEASURES = /^(\d+(?:\.\d+)?)m$/;
const FRACTION = /^(\d+)\/(\d+)$/;
const POSITION = /^(\d+):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/** Parse a TimeValue into beats (quarter notes). See the header comment for forms. */
export function parseTime(value: TimeValue, meter: Meter = DEFAULT_METER): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite time value: ${value}`);
    return value;
  }

  const s = value.trim();

  if (NUMERIC.test(s)) return parseFloat(s);

  const nota = NOTATION.exec(s);
  if (nota) {
    const div = parseInt(nota[1], 10);
    if (div === 0) throw new Error(`invalid note division: ${s}`);
    let beats = 4 / div;
    if (nota[2] === 't') beats *= 2 / 3;
    if (nota[3]) beats *= 1.5;
    return beats;
  }

  const meas = MEASURES.exec(s);
  if (meas) return parseFloat(meas[1]) * beatsPerBar(meter);

  const frac = FRACTION.exec(s);
  if (frac) {
    const den = parseInt(frac[2], 10);
    if (den === 0) throw new Error(`zero denominator: ${s}`);
    return (parseInt(frac[1], 10) / den) * 4;
  }

  const pos = POSITION.exec(s);
  if (pos) {
    const bar = parseInt(pos[1], 10);
    const beat = parseFloat(pos[2]);
    const sixteenth = parseFloat(pos[3]);
    return bar * beatsPerBar(meter) + beat + sixteenth * 0.25;
  }

  throw new Error(`unparseable time value: '${value}'`);
}
