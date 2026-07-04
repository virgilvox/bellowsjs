import { describe, expect, it } from 'vitest';
import { stringEngine, tubeEngine } from '../../src/engines/waveguide';
import { rng } from '../../src/core/prng';
import {
  bandEnergy,
  cents,
  countDiffs,
  countNonFinite,
  estimateFreq,
  goertzel,
  magSpectrum,
  maxAbs,
  mono,
  peakFreq,
  renderVoice,
  rms,
  spectralCentroid,
} from './helpers';

const SR = 44100;

describe('string engine', () => {
  it('plays 440 within 3 cents when plucked', () => {
    const { l, r } = renderVoice(stringEngine, {
      freq: 440,
      seconds: 1.2,
      gate: 1.2,
      params: { sustain: 0.8, dispersion: 0 },
    });
    const m = mono(l, r);
    const est = estimateFreq(m, SR, Math.round(0.3 * SR), Math.round(0.9 * SR), 440);
    expect(Math.abs(cents(est.freq, 440))).toBeLessThan(3);
    expect(est.peak).toBeGreaterThan(0.9);
  });

  it('keeps the fundamental partial in tune with dispersion engaged', () => {
    // Dispersion stretches the upper partials by design, which shifts
    // the composite waveform period, so the fundamental partial is
    // measured by spectral peak instead of autocorrelation.
    const { l, r } = renderVoice(stringEngine, {
      freq: 220,
      seconds: 1.2,
      gate: 1.2,
      params: { sustain: 0.8, dispersion: 0.5 },
    });
    const size = 32768;
    const mags = magSpectrum(mono(l, r), Math.round(0.2 * SR), size);
    const f1 = peakFreq(mags, SR, size, 190, 250);
    expect(Math.abs(cents(f1, 220))).toBeLessThan(3);
  });

  it('dispersion detunes the second partial away from 2 f0', () => {
    const size = 32768;
    const render = (dispersion: number) => {
      const { l, r } = renderVoice(stringEngine, {
        freq: 220,
        seconds: 1.2,
        gate: 1.2,
        params: { sustain: 0.8, dispersion },
      });
      const mags = magSpectrum(mono(l, r), Math.round(0.2 * SR), size);
      const f1 = peakFreq(mags, SR, size, 190, 250);
      const f2 = peakFreq(mags, SR, size, 380, 500);
      return Math.abs(f2 - 2 * f1);
    };
    const clean = render(0);
    const dispersed = render(0.8);
    expect(dispersed).toBeGreaterThan(clean + 1);
  });

  it('sustain lengthens the tail', () => {
    const long = renderVoice(stringEngine, {
      seconds: 1.5,
      gate: 1.5,
      params: { sustain: 1 },
    });
    const short = renderVoice(stringEngine, {
      seconds: 1.5,
      gate: 1.5,
      params: { sustain: 0.1 },
    });
    const from = Math.round(1.1 * SR);
    const to = Math.round(1.5 * SR);
    expect(rms(mono(short.l, short.r), from, to)).toBeLessThan(
      rms(mono(long.l, long.r), from, to) * 0.2
    );
  });

  it('bowing sustains while the gate is held, plucks decay', () => {
    const bowed = renderVoice(stringEngine, {
      freq: 220,
      seconds: 2,
      gate: 2,
      params: { bow: 1, bowPressure: 0.6, bowSpeed: 0.5, sustain: 0.8 },
    });
    const plucked = renderVoice(stringEngine, {
      freq: 220,
      seconds: 2,
      gate: 2,
      params: { bow: 0, sustain: 0.4 },
    });
    const bm = mono(bowed.l, bowed.r);
    const pm = mono(plucked.l, plucked.r);
    const early = [Math.round(0.3 * SR), Math.round(0.6 * SR)] as const;
    const late = [Math.round(1.6 * SR), Math.round(1.9 * SR)] as const;
    const bowedLate = rms(bm, late[0], late[1]);
    expect(bowedLate).toBeGreaterThan(0.005);
    expect(bowedLate).toBeGreaterThan(rms(bm, early[0], early[1]) * 0.3);
    expect(rms(pm, late[0], late[1])).toBeLessThan(rms(pm, early[0], early[1]) * 0.2);
  });

  it('bowed output is finite and bounded', () => {
    // The bound moved from 2 to 4 with the corrected bow table: the old
    // code compressed the whole loop through tanh every sample, which
    // capped this extreme corner (max pressure, speed, and sustain) but
    // dulled every sustained note. The corrected junction bounds only
    // the injected force, so the loop settles at its natural equilibrium
    // amplitude, about 3.1 peak here. The equilibrium is verified stable
    // by comparing early and late peaks.
    const { l } = renderVoice(stringEngine, {
      seconds: 2,
      gate: 2,
      params: { bow: 1, bowPressure: 1, bowSpeed: 1, dispersion: 0.6, sustain: 1 },
    });
    expect(countNonFinite(l)).toBe(0);
    expect(maxAbs(l)).toBeLessThan(4);
    const early = rms(l, Math.round(0.4 * SR), Math.round(0.8 * SR));
    const late = rms(l, Math.round(1.6 * SR), Math.round(2 * SR));
    expect(late).toBeLessThan(early * 1.2);
  });

  it('is deterministic per seed', () => {
    const a = renderVoice(stringEngine, { seed: 'w1', seconds: 0.5 });
    const b = renderVoice(stringEngine, { seed: 'w1', seconds: 0.5 });
    expect(countDiffs(a.l, b.l)).toBe(0);
  });
});

describe('bowed string realism', () => {
  // A steady violin-register bow stroke used by most tests below.
  const bowBase = { bow: 0.8, bowPressure: 0.55, bowSpeed: 0.6, sustain: 0.85, damp: 0.18 };

  function renderMono(
    params: Record<string, number>,
    freq: number,
    seconds = 1.5,
    seed = 'realism'
  ): Float32Array {
    const { l, r } = renderVoice(stringEngine, { freq, seconds, gate: seconds, params, seed });
    return mono(l, r);
  }

  describe('body resonator bank', () => {
    // The body bank is linear and sits at the output tap, so rendering
    // the same seed with body off and on gives the exact filter response
    // at each harmonic as a wet/dry Goertzel ratio. f0 = 137.5 Hz puts
    // harmonics right on the violin A0 (275 = 2 f0) and B1+ (550 = 4 f0)
    // modes, with h6 = 825 Hz in the gap between the wood modes and the
    // bridge hill.
    const F0 = 137.5;
    const W0 = Math.round(0.5 * SR);
    const W1 = Math.round(1.45 * SR);

    function wetDryGain(dry: Float32Array, wet: Float32Array, freq: number): number {
      return goertzel(wet, SR, freq, W0, W1) / goertzel(dry, SR, freq, W0, W1);
    }

    it('concentrates energy at the violin modes and the bridge hill', () => {
      const dry = renderMono({ ...bowBase, body: 0, bodySize: 0 }, F0);
      const wet = renderMono({ ...bowBase, body: 0.8, bodySize: 0 }, F0);
      const g275 = wetDryGain(dry, wet, 2 * F0);
      const g550 = wetDryGain(dry, wet, 4 * F0);
      const g825 = wetDryGain(dry, wet, 6 * F0);
      expect(g550).toBeGreaterThan(1.25 * g825);
      expect(g275).toBeGreaterThan(1.2 * g825);
      const avg = (hs: number[]) =>
        hs.reduce((acc, h) => acc + wetDryGain(dry, wet, h * F0), 0) / hs.length;
      const hill = avg([15, 16, 17, 18, 19, 20, 21]); // 2.06 to 2.89 kHz
      const high = avg([32, 34, 36, 38, 40]); // 4.4 to 5.5 kHz
      expect(hill).toBeGreaterThan(1.25 * high);
    });

    it('modes stay fixed when the note moves', () => {
      // 550 Hz is the 4th harmonic of 137.5 and the 5th of 110. If the
      // body tracked the note, the wet/dry gain at 550 would differ
      // between the two renders.
      const dryA = renderMono({ ...bowBase, body: 0, bodySize: 0 }, F0);
      const wetA = renderMono({ ...bowBase, body: 0.8, bodySize: 0 }, F0);
      const dryB = renderMono({ ...bowBase, body: 0, bodySize: 0 }, 110);
      const wetB = renderMono({ ...bowBase, body: 0.8, bodySize: 0 }, 110);
      const gA = wetDryGain(dryA, wetA, 550);
      const gB = wetDryGain(dryB, wetB, 550);
      expect(Math.abs(gA / gB - 1)).toBeLessThan(0.2);
    });

    it('body=0 leaves the output bit-identical whatever bodySize is', () => {
      const a = renderMono({ ...bowBase, body: 0, bodySize: 0 }, 220, 0.5);
      const b = renderMono({ ...bowBase, body: 0, bodySize: 1 }, 220, 0.5);
      expect(countDiffs(a, b)).toBe(0);
    });
  });

  describe('vibrato', () => {
    // f0 track over sliding autocorrelation windows of about 34 ms.
    function track(m: Float32Array, t0: number, t1: number): number[] {
      const out: number[] = [];
      for (let t = t0; t + 0.035 <= t1; t += 0.02) {
        const from = Math.round(t * SR);
        out.push(cents(estimateFreq(m, SR, from, from + 1500, 440).freq, 440));
      }
      return out;
    }
    const p2p = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

    it('modulates f0 at the configured depth after the onset', () => {
      const m = renderMono({ ...bowBase, vibDepth: 14, vibRate: 6, vibOnset: 0.3 }, 440, 1.6);
      const late = track(m, 0.75, 1.55);
      // configured peak-to-peak is 2 x 14 cents; accept a factor of two
      // for window smearing and the intentional depth drift
      expect(p2p(late)).toBeGreaterThan(14);
      expect(p2p(late)).toBeLessThan(56);
      // No vibrato inside the attack: before the onset the pitch track
      // must match a vibrato-free render of the same seed. The track is
      // not flat there anymore (the round-two pitch settle glides the
      // first ~120 ms by design), but vibrato must contribute nothing.
      const ref = renderMono({ ...bowBase, vibDepth: 0, vibRate: 6, vibOnset: 0.3 }, 440, 1.6);
      const pre = track(m, 0.1, 0.28);
      const preRef = track(ref, 0.1, 0.28);
      for (let i = 0; i < pre.length; i++) {
        expect(Math.abs(pre[i] - preRef[i])).toBeLessThan(1);
      }
    });

    it('modulation rate matches vibRate', () => {
      const m = renderMono({ ...bowBase, vibDepth: 14, vibRate: 6, vibOnset: 0.3 }, 440, 1.6);
      const late = track(m, 0.75, 1.55);
      const mean = late.reduce((a, b) => a + b, 0) / late.length;
      // 3 point smoothing, then count sign changes: 6 Hz over 0.8 s
      // gives about 9.6 crossings
      const sm = late.map((_, i) => {
        const a = late[Math.max(0, i - 1)];
        const b = late[i];
        const c = late[Math.min(late.length - 1, i + 1)];
        return (a + b + c) / 3 - mean;
      });
      let crossings = 0;
      for (let i = 1; i < sm.length; i++) if (sm[i - 1] < 0 !== sm[i] < 0) crossings++;
      expect(crossings).toBeGreaterThanOrEqual(6);
      expect(crossings).toBeLessThanOrEqual(16);
    });

    it('vibDepth 0 keeps the pitch steady', () => {
      const m = renderMono({ ...bowBase, vibDepth: 0, vibRate: 6 }, 440, 1.6);
      expect(p2p(track(m, 0.75, 1.55))).toBeLessThan(6);
    });
  });

  describe('bow noise', () => {
    // Rosin noise is measured strictly between harmonics and above the
    // loop damping cutoff (damp 0.5 puts it near 3.3 kHz), where the
    // recirculating tone and its slip-transient skirts are weak and the
    // fresh noise injection at the tap is not.
    function noiseFloor(params: Record<string, number>, seed = 'floor'): number {
      const m = renderMono({ ...bowBase, damp: 0.5, ...params }, 220, 1.5, seed);
      const from = Math.round(0.5 * SR);
      const size = 16384;
      const f0 = estimateFreq(m, SR, from, Math.round(1.45 * SR), 220).freq;
      const spacing = (f0 * size) / SR;
      const mags = magSpectrum(m, from, size);
      let acc = 0;
      let n = 0;
      const b1 = Math.round((4500 * size) / SR);
      const b2 = Math.round((9000 * size) / SR);
      for (let b = b1; b <= b2; b++) {
        const pos = b / spacing;
        if (Math.abs(pos - Math.round(pos)) > 0.35) {
          acc += mags[b] * mags[b];
          n++;
        }
      }
      return acc / n;
    }

    it('raises the inter-harmonic floor by at least 10 dB', () => {
      const dry = noiseFloor({ bowNoise: 0 });
      const wet = noiseFloor({ bowNoise: 0.5 });
      expect(wet / dry).toBeGreaterThan(10);
    });

    it('floor grows with bow speed', () => {
      const slow = noiseFloor({ bowNoise: 0.5, bowSpeed: 0.2 });
      const mid = noiseFloor({ bowNoise: 0.5, bowSpeed: 0.5 });
      const fast = noiseFloor({ bowNoise: 0.5, bowSpeed: 0.8 });
      expect(mid).toBeGreaterThan(slow * 1.3);
      expect(fast).toBeGreaterThan(mid * 1.1);
    });
  });

  describe('attack bite', () => {
    const biteBase = { ...bowBase, bow: 1, bowNoise: 0 };
    const size = 4096;
    function hfFraction(m: Float32Array, from: number): number {
      const mags = magSpectrum(m, from, size);
      return bandEnergy(mags, SR, size, 3000, 10000) / bandEnergy(mags, SR, size, 60, 10000);
    }
    function hfAbs(m: Float32Array, from: number): number {
      const mags = magSpectrum(m, from, size);
      return bandEnergy(mags, SR, size, 3000, 10000);
    }

    it('front-loads high frequency energy into the attack', () => {
      const withBite = renderMono({ ...biteBase, attackBite: 0.6 }, 220, 1.2, 'bite');
      const noBite = renderMono({ ...biteBase, attackBite: 0 }, 220, 1.2, 'bite');
      const sustainAt = Math.round(0.6 * SR);
      const marginWith = hfFraction(withBite, 0) - hfFraction(withBite, sustainAt);
      const marginWithout = hfFraction(noBite, 0) - hfFraction(noBite, sustainAt);
      // attack window (first 93 ms) is HF-heavier than the sustain
      expect(marginWith).toBeGreaterThan(0.06);
      // and the margin collapses with the bite disabled
      expect(marginWith).toBeGreaterThan(marginWithout + 0.05);
      // absolute attack HF energy also rises (same seed, same excitation)
      expect(hfAbs(withBite, 0)).toBeGreaterThan(1.25 * hfAbs(noBite, 0));
    });
  });

  describe('bow pressure regimes', () => {
    it('minimum force starves the tone, maximum stays bounded and periodic', () => {
      const weak = renderMono({ ...bowBase, bowPressure: 0.05 }, 440);
      const normal = renderMono({ ...bowBase, bowPressure: 0.55 }, 440);
      const from = Math.round(0.5 * SR);
      const to = Math.round(1.4 * SR);
      expect(rms(weak, from, to)).toBeLessThan(0.8 * rms(normal, from, to));
      const hard = renderMono({ ...bowBase, bowPressure: 1 }, 440);
      expect(countNonFinite(hard)).toBe(0);
      expect(maxAbs(hard)).toBeLessThan(4);
      expect(estimateFreq(hard, SR, from, to, 440).peak).toBeGreaterThan(0.9);
    });
  });

  describe('all features together', () => {
    const full = {
      ...bowBase,
      body: 0.8,
      bodySize: 0,
      bowNoise: 0.35,
      attackBite: 0.5,
      vibRate: 6.1,
      vibDepth: 14,
      vibOnset: 0.3,
    };

    it('stays pitch-accurate, finite, and bounded', () => {
      const m = renderMono(full, 440, 1.6);
      expect(countNonFinite(m)).toBe(0);
      expect(maxAbs(m)).toBeLessThan(2);
      // full-window autocorrelation averages the vibrato out
      const est = estimateFreq(m, SR, Math.round(0.3 * SR), Math.round(1.5 * SR), 440);
      expect(Math.abs(est.freq - 440) / 440).toBeLessThan(0.04);
    });

    it('is deterministic per seed', () => {
      const a = renderVoice(stringEngine, { seed: 'full', seconds: 1, params: full });
      const b = renderVoice(stringEngine, { seed: 'full', seconds: 1, params: full });
      expect(countDiffs(a.l, b.l)).toBe(0);
    });

    it('noteOff during vibrato and noise decays and frees the voice', () => {
      const { l, r, voice } = renderVoice(stringEngine, {
        freq: 220,
        seconds: 2.2,
        gate: 0.8,
        seed: 'lifecycle',
        params: full,
      });
      const m = mono(l, r);
      expect(rms(m, Math.round(0.4 * SR), Math.round(0.7 * SR))).toBeGreaterThan(0.05);
      expect(rms(m, Math.round(2 * SR), Math.round(2.2 * SR))).toBeLessThan(1e-3);
      expect(voice.active).toBe(false);
    });
  });
});

describe('round two: source spectrum and life', () => {
  // The item-1 acceptance render: violin register bow stroke, body off.
  const bowBase = { bow: 0.8, bowPressure: 0.55, bowSpeed: 0.6, sustain: 0.85, damp: 0.18 };

  function renderMono(
    params: Record<string, number>,
    freq: number,
    seconds = 2,
    seed = 'round2',
    vel = 1
  ): Float32Array {
    const { l, r } = renderVoice(stringEngine, {
      freq,
      seconds,
      gate: seconds,
      params,
      seed,
      vel,
    });
    return mono(l, r);
  }

  /** Harmonic levels in dB relative to h1, measured by Goertzel at
   * multiples of the tracked fundamental over a sustain window. */
  function harmonicTable(
    m: Float32Array,
    fNominal: number,
    count: number,
    from: number,
    to: number
  ): number[] {
    const f = estimateFreq(m, SR, from, to, fNominal).freq;
    const h1 = goertzel(m, SR, f, from, to);
    const out: number[] = [0];
    for (let h = 2; h <= count; h++) {
      out.push(20 * Math.log10(goertzel(m, SR, h * f, from, to) / h1));
    }
    return out;
  }

  describe('bowed source tilt (item 1)', () => {
    // Measured on 0.1.3 with this exact render: h7 +12.6 dB, h8 +6.5 dB
    // above the fundamental, rms -9.1 dBFS. A violin bridge force is a
    // minus 6 dB per octave sawtooth: upper harmonics must sit well
    // below h1, and the level must stay within 6 dB of the old engine.
    it('body-off A4 spectrum tilts like a Helmholtz sawtooth', () => {
      const m = renderMono({ ...bowBase, body: 0 }, 440, 2, 'tilt');
      const from = Math.round(0.5 * SR);
      const to = Math.round(1.9 * SR);
      const est = estimateFreq(m, SR, from, to, 440);
      expect(Math.abs(cents(est.freq, 440))).toBeLessThan(10);
      const table = harmonicTable(m, 440, 16, from, to);
      for (let h = 2; h <= 16; h++) {
        expect(table[h - 1], 'h' + h + ' above h1').toBeLessThanOrEqual(0);
      }
      expect(table[7], 'h8').toBeLessThanOrEqual(-12);
      expect(table[11], 'h12').toBeLessThanOrEqual(-16);
      // rms within 6 dB of the 0.1.3 level (0.3497 at this render)
      const level = rms(m, from, to);
      expect(level).toBeGreaterThan(0.3497 / 2);
      expect(level).toBeLessThan(0.3497 * 2);
    });
  });

  describe('bow position comb (item 1)', () => {
    it('notches the harmonic nearest 1/bowPos', () => {
      // bowPos 0.11 puts the first coupling null at harmonic 9.09, so
      // h9 must dip at least 6 dB below the mean of its neighbors.
      // Measured at 220 Hz, where h8 to h10 (1.8 to 2.2 kHz) sit below
      // the bowed loop damping cap and the notch is resolvable; at A4
      // the whole region is already 30 dB down the Helmholtz slope.
      const m = renderMono({ ...bowBase, body: 0, bowPos: 0.11 }, 220, 2, 'comb');
      const from = Math.round(0.5 * SR);
      const to = Math.round(1.9 * SR);
      const table = harmonicTable(m, 220, 12, from, to);
      const neighbors = (table[7] + table[9]) / 2;
      expect(table[8], 'h9 dip').toBeLessThanOrEqual(neighbors - 6);
    });
  });

  describe('attack irregularity and settle (item 3)', () => {
    // f0 track over short autocorrelation windows: about 10 ms hops.
    function trackCents(m: Float32Array, t0: number, t1: number, f: number): number[] {
      const out: number[] = [];
      for (let t = t0; t + 0.025 <= t1; t += 0.01) {
        const from = Math.round(t * SR);
        out.push(cents(estimateFreq(m, SR, from, from + Math.round(0.025 * SR), f).freq, f));
      }
      return out;
    }
    const std = (xs: number[]) => {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length);
    };

    it('f0 wanders in the first 120 ms, then locks', () => {
      const m = renderMono({ ...bowBase, body: 0, attackBite: 0.5 }, 440, 1.6, 'settle');
      const attack = std(trackCents(m, 0.005, 0.125, 440));
      const sustain = std(trackCents(m, 0.8, 1.4, 440));
      expect(attack).toBeGreaterThanOrEqual(2 * sustain);
    });

    it('attacks differ note to note under one seed', () => {
      // Two consecutive notes on the same voice draw fresh per-note
      // jitter and settle values from the forked note stream.
      const voiceParams: Record<string, number> = {};
      for (const spec of stringEngine.params) voiceParams[spec.name] = spec.default;
      Object.assign(voiceParams, { ...bowBase, body: 0, attackBite: 0.5 });
      const voice = stringEngine.createVoice(SR, voiceParams, rng('two-notes'));
      const n = Math.round(0.4 * SR);
      const render = () => {
        const l = new Float32Array(n);
        const r = new Float32Array(n);
        voice.noteOn(440, 1);
        for (let i = 0; i < n; i += 128) voice.process(l, r, i, Math.min(i + 128, n));
        voice.noteOff();
        return l;
      };
      const first = render();
      const second = render();
      expect(countDiffs(first, second)).toBeGreaterThan(0);
    });
  });

  describe('vibrato asymmetry (item 4)', () => {
    it('mean f0 during vibrato sits below the no-vibrato mean', () => {
      const withVib = renderMono({ ...bowBase, body: 0, vibDepth: 22, vibOnset: 0.2 }, 440, 2, 'asym');
      const noVib = renderMono({ ...bowBase, body: 0, vibDepth: 0 }, 440, 2, 'asym');
      const from = Math.round(0.8 * SR);
      const to = Math.round(1.9 * SR);
      const track = (m: Float32Array) => {
        const out: number[] = [];
        for (let t = 0.8; t + 0.035 <= 1.9; t += 0.02) {
          const f = Math.round(t * SR);
          out.push(cents(estimateFreq(m, SR, f, f + 1500, 440).freq, 440));
        }
        return out;
      };
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(estimateFreq(noVib, SR, from, to, 440).peak).toBeGreaterThan(0.8);
      expect(mean(track(withVib))).toBeLessThan(mean(track(noVib)) - 2);
    });
  });

  describe('dynamics coupling (item 5)', () => {
    it('velocity brightens and loudens with dynamics up, not with it off', () => {
      const size = 16384;
      const centroid = (m: Float32Array) =>
        spectralCentroid(magSpectrum(m, Math.round(0.6 * SR), size), SR, size);
      const loud = renderMono({ ...bowBase, body: 0, dynamics: 0.7 }, 440, 1.4, 'dyn', 1);
      const soft = renderMono({ ...bowBase, body: 0, dynamics: 0.7 }, 440, 1.4, 'dyn', 0.25);
      const from = Math.round(0.5 * SR);
      const to = Math.round(1.3 * SR);
      expect(rms(loud, from, to)).toBeGreaterThan(1.15 * rms(soft, from, to));
      expect(centroid(loud)).toBeGreaterThan(centroid(soft));
      // with dynamics off, velocity barely moves the sustained level
      const loud0 = renderMono({ ...bowBase, body: 0, dynamics: 0 }, 440, 1.4, 'dyn', 1);
      const soft0 = renderMono({ ...bowBase, body: 0, dynamics: 0 }, 440, 1.4, 'dyn', 0.25);
      const ratio0 = rms(loud0, from, to) / rms(soft0, from, to);
      expect(ratio0).toBeLessThan(1.1);
      expect(ratio0).toBeGreaterThan(0.9);
    });
  });

  describe('dual polarization (item 6)', () => {
    // Envelope undulation: rms per 20 ms hop over the sustain, mean
    // removed, then Goertzel amplitude in the beat band relative to
    // the envelope mean. The band is 0.2 to 1 Hz: polDetune 1.5 to 2.5
    // cents beats at 0.38 to 0.64 Hz at A4, while above 1 Hz the rosin
    // noise raises the envelope floor of the pol-off render too (its
    // measured peak sits near 2 Hz in both), which would only blur the
    // gate.
    function undulation(polDetune: number, seed: string): number {
      const m = renderMono({ ...bowBase, body: 0, polDetune }, 440, 4, seed);
      const hop = Math.round(0.02 * SR);
      const t0 = Math.round(0.5 * SR);
      const env: number[] = [];
      for (let i = t0; i + hop <= m.length; i += hop) env.push(rms(m, i, i + hop));
      const mean = env.reduce((a, b) => a + b, 0) / env.length;
      const envArr = new Float32Array(env.length);
      for (let i = 0; i < env.length; i++) envArr[i] = env[i] - mean;
      const envSr = SR / hop;
      let band = 0;
      let count = 0;
      for (let f = 0.2; f <= 1; f += 0.1) {
        band += goertzel(envArr, envSr, f, 0, envArr.length) ** 2;
        count++;
      }
      return Math.sqrt(band / count) / mean;
    }

    it('polDetune > 0 undulates the sustain envelope, 0 does not', () => {
      const withPol = undulation(2, 'pol');
      const without = undulation(0, 'pol');
      expect(withPol).toBeGreaterThan(2 * without);
      expect(withPol).toBeGreaterThan(0.01);
    });

    it('polDetune 0 is bit-identical to a render without the param wired', () => {
      const a = renderMono({ ...bowBase, body: 0, polDetune: 0 }, 220, 0.5, 'polid');
      const b = renderMono({ ...bowBase, body: 0 }, 220, 0.5, 'polid');
      expect(countDiffs(a, b)).toBe(0);
    });
  });

  describe('non-bowed back-compat (items 1, 3, 6)', () => {
    it('a default pluck render matches the 0.1.3 engine bit for bit', () => {
      // Reference captured from the shipped 0.1.3 engine before the
      // round-two change: seed 'pluck-ref', 220 Hz, engine defaults
      // (bow 0, body 0), 0.6 s held. The new params must leave this
      // path untouched.
      const { l, r } = renderVoice(stringEngine, {
        freq: 220,
        seconds: 0.6,
        gate: 0.6,
        seed: 'pluck-ref',
      });
      const m = mono(l, r);
      const buf = new Uint32Array(m.buffer, 0, m.length);
      let hash = 0;
      for (let i = 0; i < buf.length; i++) hash = (Math.imul(hash, 31) + buf[i]) >>> 0;
      expect(hash).toBe(1908149794);
      expect(rms(m)).toBeCloseTo(0.05224297, 7);
      const ref = [
        -2.35543284e-3, -3.15646417e-2, -5.82306599e-3, 1.99813042e-2, 5.59339346e-3,
        -5.06306477e-2, -1.23216301e-1, -1.65193021e-1,
      ];
      for (let i = 0; i < ref.length; i++) {
        expect(m[1000 + i]).toBeCloseTo(ref[i], 7);
      }
    });
  });
});

describe('tube engine', () => {
  it('sustains while the gate is held and releases on noteOff', () => {
    const { l, r, voice } = renderVoice(tubeEngine, {
      freq: 200,
      seconds: 2,
      gate: 1.4,
      params: { breath: 0.9 },
    });
    const m = mono(l, r);
    const held1 = rms(m, Math.round(0.4 * SR), Math.round(0.6 * SR));
    const held2 = rms(m, Math.round(1.1 * SR), Math.round(1.3 * SR));
    const tail = rms(m, Math.round(1.85 * SR), Math.round(2 * SR));
    expect(held1).toBeGreaterThan(0.01);
    expect(held2).toBeGreaterThan(held1 * 0.3);
    expect(tail).toBeLessThan(held2 * 0.05);
    expect(voice.active).toBe(false);
  });

  it('plays near the requested pitch', () => {
    const { l, r } = renderVoice(tubeEngine, {
      freq: 233,
      seconds: 1.2,
      gate: 1.2,
      params: { breath: 0.9, noise: 0 },
    });
    const m = mono(l, r);
    const est = estimateFreq(m, SR, Math.round(0.5 * SR), Math.round(1.1 * SR), 233);
    expect(Math.abs(cents(est.freq, 233))).toBeLessThan(60);
  });

  it('is silent without breath and finite with it', () => {
    const quiet = renderVoice(tubeEngine, { seconds: 0.5, params: { breath: 0 } });
    expect(maxAbs(mono(quiet.l, quiet.r))).toBeLessThan(1e-3);
    const loud = renderVoice(tubeEngine, {
      seconds: 1,
      params: { breath: 1, noise: 1 },
    });
    expect(countNonFinite(loud.l)).toBe(0);
    expect(maxAbs(loud.l)).toBeLessThan(3);
  });

  it('is deterministic per seed', () => {
    const a = renderVoice(tubeEngine, { seed: 't1', seconds: 0.5, params: { noise: 0.5 } });
    const b = renderVoice(tubeEngine, { seed: 't1', seconds: 0.5, params: { noise: 0.5 } });
    expect(countDiffs(a.l, b.l)).toBe(0);
  });
});
