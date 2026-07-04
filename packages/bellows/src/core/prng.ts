/*
 * Seeded PRNG streams. xmur3 hashes a string seed into 32-bit state,
 * mulberry32 generates from it. fork(label) derives an independent child
 * stream by hashing "parentLabel::label", so the tree of streams is stable
 * no matter the order in which streams are consumed.
 */

import type { NamedRng } from '../types';

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rng(label: string): NamedRng {
  const next = mulberry32(xmur3(label)());
  const fn = (() => next()) as NamedRng & { label: string };
  fn.label = label;
  fn.fork = (child: string) => rng(label + '::' + child);
  fn.int = (n: number) => (next() * n) | 0;
  fn.pick = <T>(arr: readonly T[]): T => arr[(next() * arr.length) | 0];
  fn.range = (lo: number, hi: number) => lo + next() * (hi - lo);
  fn.chance = (p: number) => next() < p;
  fn.shuffle = <T>(arr: readonly T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = (next() * (i + 1)) | 0;
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  };
  fn.gauss = () => (next() + next() + next() + next() - 2) * Math.SQRT2 * 0.875;
  fn.weighted = (weights: ArrayLike<number>) => {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };
  return fn;
}
