/*
 * Euclidean rhythms via Bjorklund's algorithm: distribute `pulses` onsets
 * as evenly as possible across `steps` slots. This is the true recursive
 * bucket pairing (repeatedly zip the shorter group list into the longer),
 * not the naive floor-accumulator, so E(3, 8) yields the tresillo
 * [1,0,0,1,0,0,1,0] and E(5, 8) the cinquillo [1,0,1,1,0,1,1,0].
 */

/** Rotate an array left by n positions (element at index n moves to index 0). */
export function rotate<T>(arr: readonly T[], n: number): T[] {
  const len = arr.length;
  if (len === 0) return [];
  const k = ((n % len) + len) % len;
  return arr.slice(k).concat(arr.slice(0, k));
}

/**
 * Euclidean rhythm as a gate array of 0s and 1s.
 * `rotation` rotates the result left, so the downbeat can land elsewhere.
 */
export function euclid(pulses: number, steps: number, rotation = 0): number[] {
  if (!Number.isInteger(pulses) || !Number.isInteger(steps) || !Number.isInteger(rotation)) {
    throw new RangeError('euclid: pulses, steps, and rotation must be integers');
  }
  if (steps <= 0) throw new RangeError('euclid: steps must be positive');
  if (pulses < 0 || pulses > steps) {
    throw new RangeError('euclid: pulses must be in [0, steps]');
  }
  if (pulses === 0) return new Array<number>(steps).fill(0);
  if (pulses === steps) return new Array<number>(steps).fill(1);

  // Bucket pairing. `a` holds the longer-prefix groups, `b` the remainder.
  // Each round appends one b-group to each a-group; the leftovers become
  // the new remainder. Stop when the remainder is a single group or empty.
  let a: number[][] = Array.from({ length: pulses }, () => [1]);
  let b: number[][] = Array.from({ length: steps - pulses }, () => [0]);
  while (b.length > 1) {
    const n = Math.min(a.length, b.length);
    const paired: number[][] = [];
    for (let i = 0; i < n; i++) paired.push(a[i].concat(b[i]));
    const rest = a.length > n ? a.slice(n) : b.slice(n);
    a = paired;
    b = rest;
  }
  const flat: number[] = [];
  for (const g of a) flat.push(...g);
  for (const g of b) flat.push(...g);
  return rotation === 0 ? flat : rotate(flat, rotation);
}
