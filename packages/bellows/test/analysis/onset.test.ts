import { describe, it, expect } from 'vitest';
import { OnsetDetector, detectOnsets, estimateTempo } from '../../src/analysis/onset';
import { rng } from '../../src/core/prng';

const SR = 44100;

/** Noise bursts every `period` seconds over `seconds`, 20 ms decaying tails. */
function clickTrack(seconds: number, period: number, seed: string): {
  buf: Float32Array;
  times: number[];
} {
  const r = rng(seed);
  const buf = new Float32Array(Math.round(seconds * SR));
  const times: number[] = [];
  const burstLen = Math.round(0.02 * SR);
  for (let t = 0; t + 0.01 < seconds; t += period) {
    const start = Math.round(t * SR);
    times.push(t);
    for (let i = 0; i < burstLen && start + i < buf.length; i++) {
      const env = Math.exp(-i / (0.005 * SR));
      buf[start + i] += 0.8 * env * (r() * 2 - 1);
    }
  }
  return { buf, times };
}

describe('detectOnsets', () => {
  it('finds every click of a 0.5 s click track within 30 ms', () => {
    const { buf, times } = clickTrack(3, 0.5, 'onset/clicks');
    const onsets = detectOnsets(buf, SR);
    expect(onsets.length).toBe(times.length);
    for (let i = 0; i < times.length; i++) {
      expect(Math.abs(onsets[i] - times[i])).toBeLessThan(0.03);
    }
  });

  it('reports no doubles inside the refractory period', () => {
    const { buf } = clickTrack(3, 0.5, 'onset/clicks');
    const onsets = detectOnsets(buf, SR, { refractory: 0.08 });
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i] - onsets[i - 1]).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('returns nothing for silence', () => {
    expect(detectOnsets(new Float32Array(SR), SR)).toEqual([]);
  });

  it('returns nothing for steady noise after the initial attack', () => {
    const r = rng('onset/steady');
    const buf = new Float32Array(2 * SR);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * (r() * 2 - 1);
    const onsets = detectOnsets(buf, SR);
    // The very start is a legitimate onset; nothing after it.
    expect(onsets.filter((t) => t > 0.1)).toEqual([]);
  });
});

describe('OnsetDetector streaming', () => {
  it('matches the offline result when pushed in small blocks', () => {
    const { buf } = clickTrack(3, 0.5, 'onset/clicks');
    const offline = detectOnsets(buf, SR);

    const det = new OnsetDetector(SR);
    const collected: number[] = [];
    for (let i = 0; i < buf.length; i += 512) {
      det.push(buf, i, Math.min(i + 512, buf.length));
      collected.push(...det.poll());
    }
    // Flush the lookahead with a block of silence.
    const tail = new Float32Array(2048);
    det.push(tail, 0, tail.length);
    collected.push(...det.poll());

    expect(collected).toEqual(offline);
  });

  it('poll drains pending onsets exactly once', () => {
    const { buf } = clickTrack(1, 0.5, 'onset/drain');
    const det = new OnsetDetector(SR);
    det.push(buf, 0, buf.length);
    const first = det.poll();
    expect(first.length).toBeGreaterThan(0);
    expect(det.poll()).toEqual([]);
  });

  it('reset clears detector state', () => {
    const { buf } = clickTrack(1, 0.5, 'onset/reset');
    const det = new OnsetDetector(SR);
    det.push(buf, 0, buf.length);
    det.reset();
    expect(det.poll()).toEqual([]);
    det.push(buf, 0, buf.length);
    const tail = new Float32Array(2048);
    det.push(tail, 0, tail.length);
    expect(det.poll().length).toBeGreaterThan(0);
  });
});

describe('estimateTempo', () => {
  it('estimates 120 bpm from onset times within 2 bpm', () => {
    const onsets: number[] = [];
    for (let t = 0; t < 8; t += 0.5) onsets.push(t);
    const r = estimateTempo(onsets);
    expect(Math.abs(r.bpm - 120)).toBeLessThan(2);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('estimates 120 bpm from a rendered click track within 2 bpm', () => {
    const { buf } = clickTrack(6, 0.5, 'tempo/clicks');
    const r = estimateTempo(buf, SR);
    expect(Math.abs(r.bpm - 120)).toBeLessThan(2);
    expect(r.confidence).toBeGreaterThan(0.4);
  });

  it('folds 60 and 240 bpm inputs onto 120 (documented factor-of-two fold)', () => {
    const slow: number[] = [];
    for (let t = 0; t < 12; t += 1) slow.push(t);
    expect(Math.abs(estimateTempo(slow).bpm - 120)).toBeLessThan(2);

    const fast: number[] = [];
    for (let t = 0; t < 4; t += 0.25) fast.push(t);
    expect(Math.abs(estimateTempo(fast).bpm - 120)).toBeLessThan(2);
  });

  it('handles jittered onsets', () => {
    const r = rng('tempo/jitter');
    const onsets: number[] = [];
    for (let t = 0; t < 10; t += 0.5) onsets.push(t + (r() - 0.5) * 0.02);
    const est = estimateTempo(onsets);
    expect(Math.abs(est.bpm - 120)).toBeLessThan(2);
  });

  it('returns zero confidence for too few onsets', () => {
    expect(estimateTempo([0, 0.5])).toEqual({ bpm: 0, confidence: 0 });
    expect(estimateTempo([])).toEqual({ bpm: 0, confidence: 0 });
  });

  it('throws for audio input without a sample rate', () => {
    expect(() => estimateTempo(new Float32Array(1024))).toThrow();
  });
});
