import { describe, it, expect } from 'vitest';
import {
  chromaFromSpectrum,
  ChromaAnalyzer,
  keyEstimate,
  MAJOR_PROFILE,
  MINOR_PROFILE,
} from '../../src/analysis/chroma';
import { mtof } from '../../src/types';
import { addSine, magSpectrum } from './signals';

const SR = 44100;

/** Notes with a few harmonics each, midi note numbers in, buffer out. */
function toneCluster(midis: number[], seconds: number, harmonics = 3): Float32Array {
  const buf = new Float32Array(Math.round(seconds * SR));
  for (const m of midis) {
    const f = mtof(m);
    for (let h = 1; h <= harmonics; h++) {
      if (h * f >= SR / 2) break;
      addSine(buf, h * f, SR, 0.3 / h);
    }
  }
  return buf;
}

describe('chromaFromSpectrum', () => {
  it('peaks at the pitch classes of a C major triad', () => {
    // C4, E4, G4 (midi 60, 64, 67), pitch classes 0, 4, 7.
    const buf = toneCluster([60, 64, 67], 0.5, 1);
    const mag = magSpectrum(buf, 8192);
    const chroma = chromaFromSpectrum(mag, SR);
    expect(chroma.length).toBe(12);
    const strong = [0, 4, 7];
    for (const pc of strong) expect(chroma[pc]).toBeGreaterThan(0.5);
    for (let pc = 0; pc < 12; pc++) {
      if (!strong.includes(pc)) expect(chroma[pc]).toBeLessThan(0.2);
    }
  });

  it('ignores content below 60 Hz', () => {
    // A loud 40 Hz rumble (pitch class near E) against a quiet 440 Hz A.
    // With the low cut the A must win; without it the rumble would.
    const buf = new Float32Array(16384);
    addSine(buf, 40, SR, 0.9);
    addSine(buf, 440, SR, 0.05);
    const mag = magSpectrum(buf, 16384);
    const chroma = chromaFromSpectrum(mag, SR);
    expect(chroma[9]).toBeCloseTo(1, 5);
    expect(chroma[4]).toBeLessThan(0.1);
    expect(chroma[3]).toBeLessThan(0.1);
  });

  it('reuses the out array without allocation', () => {
    const buf = toneCluster([69], 0.25, 1);
    const mag = magSpectrum(buf, 8192);
    const out = new Float32Array(12);
    const ret = chromaFromSpectrum(mag, SR, out);
    expect(ret).toBe(out);
    expect(out[9]).toBeCloseTo(1, 5); // A = pitch class 9
  });
});

describe('ChromaAnalyzer', () => {
  it('returns null before any frame completes', () => {
    const an = new ChromaAnalyzer(SR);
    const buf = new Float32Array(1024);
    an.push(buf, 0, buf.length);
    expect(an.poll()).toBeNull();
  });

  it('accumulates chroma over pushed blocks', () => {
    const an = new ChromaAnalyzer(SR);
    const buf = toneCluster([60, 64, 67], 1.0);
    for (let i = 0; i < buf.length; i += 1024) {
      an.push(buf, i, Math.min(i + 1024, buf.length));
    }
    const chroma = an.poll();
    expect(chroma).not.toBeNull();
    expect(chroma![0]).toBeGreaterThan(0.5);
    expect(chroma![4]).toBeGreaterThan(0.2);
    expect(chroma![7]).toBeGreaterThan(0.2);
    expect(chroma![1]).toBeLessThan(0.2);
    // Accumulator drained: next poll with no new frames is null.
    expect(an.poll()).toBeNull();
  });

  it('reset clears accumulated state', () => {
    const an = new ChromaAnalyzer(SR);
    const buf = toneCluster([60], 0.5);
    an.push(buf, 0, buf.length);
    an.reset();
    expect(an.poll()).toBeNull();
  });
});

describe('keyEstimate', () => {
  it('calls a C major signal C major', () => {
    const an = new ChromaAnalyzer(SR);
    // C major scale emphasis: triad plus octave and fifth reinforcement.
    const buf = toneCluster([48, 55, 60, 64, 67, 72], 1.0);
    an.push(buf, 0, buf.length);
    const chroma = an.poll()!;
    const key = keyEstimate(chroma);
    expect(key.key).toBe(0);
    expect(key.mode).toBe('major');
    expect(key.confidence).toBeGreaterThan(0.5);
  });

  it('calls an A harmonic minor signal (with G#) A minor', () => {
    const an = new ChromaAnalyzer(SR);
    // A2, A3, C4, E4 plus the raised leading tone G#4.
    const buf = toneCluster([45, 57, 60, 64, 68], 1.0);
    an.push(buf, 0, buf.length);
    const chroma = an.poll()!;
    const key = keyEstimate(chroma);
    expect(key.mode).toBe('minor');
    expect(key.key).toBe(9);
  });

  it('recovers the key from the profile itself', () => {
    for (let key = 0; key < 12; key++) {
      const major = new Float32Array(12);
      const minor = new Float32Array(12);
      for (let pc = 0; pc < 12; pc++) {
        major[pc] = MAJOR_PROFILE[(pc - key + 12) % 12];
        minor[pc] = MINOR_PROFILE[(pc - key + 12) % 12];
      }
      const rMaj = keyEstimate(major);
      expect(rMaj.key).toBe(key);
      expect(rMaj.mode).toBe('major');
      expect(rMaj.confidence).toBeCloseTo(1, 5);
      const rMin = keyEstimate(minor);
      expect(rMin.key).toBe(key);
      expect(rMin.mode).toBe('minor');
    }
  });
});
