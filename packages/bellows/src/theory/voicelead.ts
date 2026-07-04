/*
 * Voice leading: pick the voicing of the next chord that moves the voices
 * the least, searching over inversions and octave placements within a
 * range. Also chord inversion and negative harmony reflection.
 */

import { mod12 } from './notes';

export interface VoiceLeadOptions {
  /** Lowest allowed midi note. Default 48 (C3). */
  low?: number;
  /** Highest allowed midi note. Default 84 (C6). */
  high?: number;
  /** Cost added per crossed voice pair when voice counts differ. Default 2. */
  crossPenalty?: number;
  /** Cost added per doubled pitch class. Default 3. */
  doublePenalty?: number;
}

/**
 * Invert a chord: positive inversions move bottom notes up an octave,
 * negative inversions move top notes down. Returns a new sorted array.
 */
export function invert(chordMidis: readonly number[], inversion: number): number[] {
  const out = chordMidis.slice().sort((a, b) => a - b);
  if (out.length === 0) return out;
  for (let i = 0; i < inversion; i++) out.push((out.shift() as number) + 12);
  for (let i = 0; i > inversion; i--) out.unshift((out.pop() as number) - 12);
  return out;
}

/**
 * Negative harmony: reflect a midi note around the axis between the key
 * root and its fifth (the axis sits 3.5 semitones above the root).
 * keyRoot is a midi note; it fixes the register of the axis. In key C
 * (keyRoot 60), C maps to G, E to Eb, and the G major triad maps to an
 * F minor shape.
 */
export function negativeHarmony(midi: number, keyRoot: number): number {
  return 2 * keyRoot + 7 - midi;
}

/** Unique pitch classes of a chord, ordered by ascending first occurrence. */
function pcOrder(chordMidis: readonly number[]): number[] {
  const sorted = chordMidis.slice().sort((a, b) => a - b);
  const pcs: number[] = [];
  for (const m of sorted) {
    const pc = mod12(m);
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return pcs;
}

/**
 * All closed voicings of `size` voices over the pitch classes, one per
 * (rotation, bass octave) pair, with every note inside [low, high].
 * Voices stack upward from the bass, cycling pitch classes when size
 * exceeds the pitch class count.
 */
function closedVoicings(pcs: number[], size: number, low: number, high: number): number[][] {
  const out: number[][] = [];
  const n = pcs.length;
  for (let r = 0; r < n; r++) {
    const order: number[] = [];
    for (let i = 0; i < n; i++) order.push(pcs[(r + i) % n]);
    let bass = low + mod12(order[0] - low);
    for (; bass <= high; bass += 12) {
      const notes = [bass];
      let ok = true;
      for (let k = 1; k < size; k++) {
        const prev = notes[k - 1];
        const next = prev + 1 + mod12(order[k % n] - prev - 1);
        if (next > high) {
          ok = false;
          break;
        }
        notes.push(next);
      }
      if (ok) out.push(notes);
    }
  }
  return out;
}

/**
 * Motion cost from a sorted previous voicing to a candidate voicing.
 * Equal sizes match voice to voice in sorted order (which is the optimal
 * assignment for total absolute motion and never crosses). Unequal sizes
 * match each new note to its nearest old note and penalize crossings in
 * that assignment.
 */
function motionCost(prev: readonly number[], notes: readonly number[], crossPenalty: number): number {
  if (prev.length === notes.length) {
    let c = 0;
    for (let i = 0; i < notes.length; i++) c += Math.abs(notes[i] - prev[i]);
    return c;
  }
  let c = 0;
  const assigned: number[] = [];
  for (const note of notes) {
    let bestJ = 0;
    let bestD = Infinity;
    for (let j = 0; j < prev.length; j++) {
      const d = Math.abs(note - prev[j]);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    c += bestD;
    assigned.push(bestJ);
  }
  for (let i = 0; i < assigned.length; i++) {
    for (let j = i + 1; j < assigned.length; j++) {
      if (assigned[i] > assigned[j]) c += crossPenalty;
    }
  }
  return c;
}

/**
 * Choose the voicing with minimal total voice motion from prevVoicing,
 * searching every candidate chord over its inversions and octave
 * placements within the range. Doubling (needed when the previous voicing
 * has more voices than the chord has pitch classes) and crossing are
 * penalized. With an empty prevVoicing the first candidate is voiced
 * closest to the center of the range. Returns an ascending voicing.
 */
export function voiceLead(
  prevVoicing: readonly number[],
  candidateChordMidis: readonly (readonly number[])[],
  options: VoiceLeadOptions = {},
): number[] {
  const low = options.low ?? 48;
  const high = options.high ?? 84;
  const crossPenalty = options.crossPenalty ?? 2;
  const doublePenalty = options.doublePenalty ?? 3;
  const prev = prevVoicing.slice().sort((a, b) => a - b);
  const center = (low + high) / 2;
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const cand of candidateChordMidis) {
    const pcs = pcOrder(cand);
    if (pcs.length === 0) continue;
    const size = prev.length > pcs.length ? prev.length : pcs.length;
    for (const notes of closedVoicings(pcs, size, low, high)) {
      let cost = (size - pcs.length) * doublePenalty;
      if (prev.length === 0) {
        let mean = 0;
        for (const m of notes) mean += m;
        cost += Math.abs(mean / notes.length - center);
      } else {
        cost += motionCost(prev, notes, crossPenalty);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  if (!best) throw new Error('no voicing fits the range');
  return best;
}
