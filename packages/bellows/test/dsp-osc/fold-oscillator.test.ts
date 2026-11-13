/*
 * The self-oscillating folds (dsp/fold-oscillator.ts) inside the junction
 * airway, whose glottal flow drives them: they start from rest under lung
 * pressure, the servo lands them on a target pitch at every rate, a wide
 * rest opening or a held closure stops them, and the geometric glottis and
 * its threshold run in the same airway.
 */

import { describe, expect, it } from 'vitest';
import { GLOTTIS_GEOMETRIC, GLOTTIS_PULSE, GLOTTIS_SELF_OSCILLATING, JunctionAirway } from '../../src/dsp/junction-airway';
import { FOLD_F_REF, FoldOscillator } from '../../src/dsp/fold-oscillator';
import { PitchServo } from '../../src/dsp/pitch-servo';
import { CM_H2O } from '../../src/dsp/air';
import { rng } from '../../src/core/prng';

/** A uniform open tract of n sections of 3 cm^2, lungs at pLung cmH2O, the folds of `model`. */
function airway(rate: number, model: number, hz: number, pLung = 8): JunctionAirway {
  const n = Math.round((16 * rate) / 48000);
  const a = new JunctionAirway(rate, n, rng('folds'));
  a.configure(1, n, Math.floor(n / 2));
  a.gridIn.fill(3);
  a.gridMin.fill(3);
  a.vflow.fill(0);
  a.ductLen = 2;
  a.ductArea = 3;
  a.velum = 0;
  a.pLung = pLung * CM_H2O;
  a.model = model;
  a.chink = 0.012;
  a.agStatic = 0.015;
  a.restOffset = 0.01;
  a.foldLength = 1.6;
  a.f0 = hz;
  a.teethX = n - 2;
  a.splitI = n / 2;
  a.gain = 1;
  a.glottis.setDrift(0);
  a.glottis.setJitter(0);
  a.glottis.setShimmer(0);
  a.reset();
  return a;
}

function run(a: JunctionAirway, seconds: number, each?: (block: number) => void): Float32Array {
  const samples = Math.round(seconds * a.rate);
  const out = new Float32Array(samples);
  const r = new Float32Array(samples);
  const env = new Float32Array(a.block).fill(1);
  let b = 0;
  for (let at = 0; at + a.block <= samples; at += a.block, b++) {
    if (each) each(b);
    a.beginBlock();
    a.render(out, r, at, a.block, 0, env);
  }
  return out;
}

describe('FoldOscillator', () => {
  it('starts from rest under lung pressure and the servo lands it within 5 cents of its target, at every rate', () => {
    for (const rate of [22050, 44100, 48000, 96000]) {
      for (const hz of [98, 196, 392]) {
        const a = airway(rate, GLOTTIS_SELF_OSCILLATING, hz);
        const out = run(a, 1.2);
        let bad = 0;
        let pk = 0;
        for (const v of out) {
          if (!Number.isFinite(v)) bad++;
          else pk = Math.max(pk, Math.abs(v));
        }
        expect(bad, `${rate} ${hz}`).toBe(0);
        expect(pk, `${rate} ${hz}`).toBeLessThan(1e9);
        expect(a.folds.cycles, `${rate} ${hz}`).toBeGreaterThan(0.5 * hz);
        const cents = 1200 * Math.log2(a.folds.servo.measured / hz);
        expect(Math.abs(cents), `${rate} Hz, target ${hz}: ${cents.toFixed(2)} cents`).toBeLessThan(5);
      }
    }
  });

  it('finds its own frequency near FOLD_F_REF at Q = 1: the feedforward leaves the servo under a fifth', () => {
    const a = airway(48000, GLOTTIS_SELF_OSCILLATING, FOLD_F_REF);
    run(a, 0.6);
    expect(a.folds.servo.correction).toBeGreaterThan(0.8);
    expect(a.folds.servo.correction).toBeLessThan(1.25);
  });

  it('a wide rest opening keeps the folds apart: no collision, and a smaller swing than the adducted folds', () => {
    const swing = (rest: number) => {
      const a = airway(48000, GLOTTIS_SELF_OSCILLATING, 110);
      a.restOffset = rest;
      let mn = Infinity;
      let mx = 0;
      run(a, 0.6, (b) => {
        if (b < 600) return;
        mn = Math.min(mn, a.folds.area);
        mx = Math.max(mx, a.folds.area);
      });
      return { mn, mx };
    };
    const adducted = swing(0.01);
    const wide = swing(0.3);
    expect(adducted.mn).toBeLessThan(0.02);
    expect(wide.mn).toBeGreaterThan(0.1);
    expect(wide.mx - wide.mn).toBeLessThan(adducted.mx - adducted.mn);
  });

  it('a held closure (a glottal stop) stops the swing: the area range falls 40 dB within 100 ms', () => {
    const a = airway(48000, GLOTTIS_SELF_OSCILLATING, 110);
    const range = (seconds: number) => {
      let mn = Infinity;
      let mx = -Infinity;
      run(a, seconds, (b) => {
        if (b * a.block < (seconds - 0.05) * a.rate) return;
        mn = Math.min(mn, a.folds.area);
        mx = Math.max(mx, a.folds.area);
      });
      return mx - mn;
    };
    const voiced = range(0.4);
    a.closure = 1;
    const held = range(0.15);
    expect(voiced).toBeGreaterThan(0.05);
    expect(held / voiced).toBeLessThan(0.01);
  });

  it('is deterministic per stream: two airways from the same seed render the same samples', () => {
    const x = run(airway(48000, GLOTTIS_SELF_OSCILLATING, 150), 0.3);
    const y = run(airway(48000, GLOTTIS_SELF_OSCILLATING, 150), 0.3);
    expect(Array.from(y)).toEqual(Array.from(x));
  });
});

describe('FoldOscillator tension', () => {
  it('scales the masses as Q^-1.5 and the springs as Q^0.5: f0 rises as Q and the swing falls as Q^-0.5', () => {
    // the folds alone under fixed pressures, the servo frozen (tau huge), at Q 1 and 2
    const swing = (q: number) => {
      const f = new FoldOscillator(96000);
      f.rest1 = f.rest2 = 0.005;
      f.chink = 0;
      f.length = 1.4;
      f.servo.target = q * FOLD_F_REF;
      f.servo.tau = 1e9;
      f.tune();
      f.x1 = 0.02;
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = 0; i < 96000; i++) {
        f.ps = 8 * CM_H2O;
        f.pe = 0;
        f.step();
        if (i > 48000) {
          mn = Math.min(mn, f.x1);
          mx = Math.max(mx, f.x1);
        }
      }
      return { swing: mx - mn, cycles: f.cycles, q: f.tension };
    };
    const one = swing(1);
    const two = swing(2);
    expect(one.q).toBeCloseTo(1, 9);
    expect(two.q).toBeCloseTo(2, 9);
    expect(two.cycles / one.cycles).toBeGreaterThan(1.8);
    expect(two.cycles / one.cycles).toBeLessThan(2.2);
    // Ishizaka and Flanagan's own law (masses Q^-1, springs Q^1) would halve it
    expect(two.swing / one.swing).toBeGreaterThan(0.62);
    expect(two.swing / one.swing).toBeLessThan(0.8);
  });
});

describe('PitchServo', () => {
  it('moves its correction by 1 - exp(-T / tau) of the log error a cycle, and ignores a cycle far off', () => {
    const s = new PitchServo();
    s.target = 200;
    s.tau = 0.05;
    s.measured = 100;
    s.pending = 1;
    s.cycle();
    expect(s.correction).toBe(1);
    s.measured = 180;
    s.pending = 1;
    s.cycle();
    const g = 1 - Math.exp(-1 / (180 * 0.05));
    expect(Math.log2(s.correction)).toBeCloseTo(g * Math.log2(200 / 180), 12);
    expect(s.pending).toBe(0);
    // with no cycle pending (the folds call it every sample) it changes nothing
    const c = s.correction;
    s.measured = 190;
    s.cycle();
    expect(s.correction).toBe(c);
  });
});

describe('PitchServo, adaptive rate', () => {
  it('speeds up by 1 + |error| / 40 cents when two cycles in a row agree, and not when they disagree', () => {
    const step = (s: PitchServo, m: number) => {
      s.measured = m;
      s.pending = 1;
      s.cycle();
    };
    // two cycles 200 cents flat (two semitones under a 220 Hz target)
    const flat = 220 / Math.pow(2, 200 / 1200);
    const s = new PitchServo();
    s.target = 220;
    s.tau = 0.04;
    step(s, flat);
    const c1 = s.correction;
    // the first has no agreeing predecessor: the plain rate
    const g1 = 1 - Math.exp(-1 / (flat * 0.04));
    expect(Math.log(c1)).toBeCloseTo(g1 * Math.log(220 / flat), 12);
    step(s, flat);
    const g2 = 1 - Math.exp(-(1 + 200 / 40) / (flat * 0.04));
    expect(Math.log(s.correction / c1)).toBeCloseTo(g2 * Math.log(220 / flat), 9);
    // a sharp cycle after a flat one: no speed-up
    const sharp = 220 * Math.pow(2, 200 / 1200);
    const c2 = s.correction;
    step(s, sharp);
    const g3 = 1 - Math.exp(-1 / (sharp * 0.04));
    expect(Math.log(s.correction / c2)).toBeCloseTo(g3 * Math.log(220 / sharp), 9);
  });
});

describe('FoldOscillator rest ramp', () => {
  it('moves rest1 and rest2 linearly to their targets over rampLeft steps, then holds them', () => {
    const f = new FoldOscillator(96000);
    f.rest1 = f.rest2 = 0.3;
    f.rest1To = 0.01;
    f.rest2To = 0.02;
    f.rampLeft = 64;
    for (let i = 1; i <= 64; i++) {
      f.step();
      expect(f.rest1).toBeCloseTo(0.3 + ((0.01 - 0.3) * i) / 64, 12);
      expect(f.rest2).toBeCloseTo(0.3 + ((0.02 - 0.3) * i) / 64, 12);
    }
    f.step();
    expect(f.rest1).toBeCloseTo(0.01, 12);
    expect(f.rampLeft).toBe(0);
  });
});

describe('the self-oscillating folds in the airway: voicing and adduction', () => {
  it('reports voicing from the folds turning: near 1 while they vibrate, near 0 within 60 ms of a wide abduction', () => {
    const a = airway(48000, GLOTTIS_SELF_OSCILLATING, 200);
    run(a, 0.5);
    expect(a.voicing).toBeGreaterThan(0.9);
    a.agStatic = 0.3;
    run(a, 0.06);
    expect(a.voicing).toBeLessThan(0.1);
  });

  it('a fast adduction puts no tone at the block rate into the output (the rest ramps within each block)', () => {
    // 10 ms from a wide voiceless opening to the voiced one, as after a voiceless stop
    const line = (model: number) => {
      const a = airway(48000, model, 220);
      a.agStatic = 0.3;
      const blocks = Math.round(0.01 * a.rate / a.block);
      let b0 = -1;
      const out = run(a, 0.35, (b) => {
        const t = (b * a.block) / a.rate;
        if (t < 0.25) return;
        if (b0 < 0) b0 = b;
        const k = Math.min((b - b0) / blocks, 1);
        a.agStatic = 0.3 + (0.015 - 0.3) * k;
      });
      // the block rate's line over the 30 ms from the adduction's start, against the bands a fifth either side
      const s0 = Math.round(0.25 * a.rate);
      const n = Math.round(0.03 * a.rate);
      const lv = (f: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < n; i++) {
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
          re += out[s0 + i] * w * Math.cos((2 * Math.PI * f * i) / a.rate);
          im += out[s0 + i] * w * Math.sin((2 * Math.PI * f * i) / a.rate);
        }
        return 20 * Math.log10(Math.hypot(re, im) + 1e-12);
      };
      const fb = a.rate / a.block;
      return lv(fb) - Math.max(lv(fb / 1.5), lv(fb * 1.5));
    };
    const folds = line(GLOTTIS_SELF_OSCILLATING);
    const pulse = line(GLOTTIS_PULSE);
    expect(folds, `folds ${folds.toFixed(1)} dB, pulse ${pulse.toFixed(1)} dB`).toBeLessThan(pulse + 6);
  });
});

describe('the geometric glottis in the airway', () => {
  it('voices above its threshold only, and its swing follows the pressure across the folds', () => {
    const peak = (pLung: number) => {
      const a = airway(48000, GLOTTIS_GEOMETRIC, 120, pLung);
      a.restOffset = 0.03;
      run(a, 0.5);
      return { level: a.threshold.level, xMax: a.geometric.xMax, pt: a.pTrans };
    };
    const low = peak(1.5);
    const mid = peak(6);
    const high = peak(12);
    expect(low.level).toBeLessThan(0.01);
    expect(mid.level).toBeGreaterThan(0.99);
    expect(high.xMax / mid.xMax).toBeCloseTo(Math.sqrt(high.pt / mid.pt), 2);
  });

  it('FoldOscillator holds its tension within its limits for any target', () => {
    const f = new FoldOscillator(48000);
    for (const t of [1, 50, 1000, 20000, NaN]) {
      f.servo.target = t;
      f.tune();
      expect(f.tension).toBeGreaterThanOrEqual(0.25);
      expect(f.tension).toBeLessThanOrEqual(12);
    }
  });
});
