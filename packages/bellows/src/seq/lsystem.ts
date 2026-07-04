/*
 * Lindenmayer systems for melodic and rhythmic growth. Rules rewrite every
 * symbol in parallel each generation. A rule is either a plain replacement
 * string or a weighted list of alternatives; stochastic rules draw from a
 * seeded rng so expansion stays reproducible. Symbols without a rule pass
 * through unchanged.
 */

import type { NamedRng } from '../types';

export interface StochasticOption {
  out: string;
  weight: number;
}

export type LRule = string | StochasticOption[];

export function lsystem(
  axiom: string,
  rules: Record<string, LRule>,
  generations: number,
  rng?: NamedRng,
): string {
  if (!Number.isInteger(generations) || generations < 0) {
    throw new RangeError('lsystem: generations must be a non-negative integer');
  }
  // Split each stochastic rule into parallel arrays once, up front.
  const outs = new Map<string, string[]>();
  const weights = new Map<string, number[]>();
  const plain = new Map<string, string>();
  for (const sym of Object.keys(rules)) {
    if (sym.length !== 1) throw new RangeError('lsystem: rule keys must be single symbols');
    const rule = rules[sym];
    if (typeof rule === 'string') {
      plain.set(sym, rule);
    } else {
      if (rule.length === 0) throw new RangeError('lsystem: stochastic rule for "' + sym + '" is empty');
      if (rng === undefined) throw new Error('lsystem: stochastic rules require an rng');
      outs.set(sym, rule.map((o) => o.out));
      weights.set(sym, rule.map((o) => o.weight));
    }
  }

  let current = axiom;
  for (let g = 0; g < generations; g++) {
    const parts: string[] = [];
    for (const ch of current) {
      const fixed = plain.get(ch);
      if (fixed !== undefined) {
        parts.push(fixed);
        continue;
      }
      const options = outs.get(ch);
      if (options !== undefined && rng !== undefined) {
        parts.push(options[rng.weighted(weights.get(ch) as number[])]);
        continue;
      }
      parts.push(ch);
    }
    current = parts.join('');
  }
  return current;
}

/**
 * Map each symbol of an L-system string to a scale degree (number) or a
 * rest (null). Symbols absent from the mapping are structural (turtle
 * commands, brackets) and are skipped.
 */
export function mapToDegrees(
  str: string,
  mapping: Record<string, number | null>,
): Array<number | null> {
  const out: Array<number | null> = [];
  for (const ch of str) {
    if (Object.prototype.hasOwnProperty.call(mapping, ch)) out.push(mapping[ch]);
  }
  return out;
}
