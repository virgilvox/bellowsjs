import { describe, it, expect } from 'vitest';
import { Svf, LadderFilter, OnePole, DcBlocker } from '../../src/dsp/filters';
import type { SvfMode } from '../../src/dsp/filters';

const SR = 48000;

/**
 * Steady-state magnitude response in dB: drive with a sine, let the filter
 * settle, then compare output RMS to input RMS over many whole periods.
 */
function responseDb(filter: { next(x: number): number }, freq: number, amp = 1, sr = SR): number {
  const settle = Math.floor(sr * 0.25);
  const periods = Math.max(30, Math.round(freq * 0.25));
  const measure = Math.round((periods * sr) / freq);
  const w = (2 * Math.PI * freq) / sr;
  for (let n = 0; n < settle; n++) filter.next(amp * Math.sin(w * n));
  let sumIn = 0;
  let sumOut = 0;
  for (let n = settle; n < settle + measure; n++) {
    const x = amp * Math.sin(w * n);
    const y = filter.next(x);
    sumIn += x * x;
    sumOut += y * y;
  }
  return 10 * Math.log10(sumOut / sumIn);
}

function svf(mode: SvfMode, cutoff: number, q: number, gainDb = 0): Svf {
  const f = new Svf(SR);
  f.setMode(mode);
  f.set(cutoff, q, gainDb);
  return f;
}

/*
 * Half power, 10 * log10(0.5). The trapezoidal SVF prewarps with
 * g = tan(pi * fc / fs), which maps the analog cutoff exactly onto fc, so
 * at Butterworth q the lowpass and the highpass both sit here and sit at
 * the same level as each other. Measured with the responseDb helper above
 * at SR = 48000, both read -3.010299957 to within 2e-13 dB at 80, 250,
 * 1000, 3000, 6000 and 12000 Hz, so a 0.01 dB band is ten orders of
 * magnitude above the float noise and still fails on a g that is 0.12
 * percent off. The -4 to -2 dB band this replaced passed a g mistuned by
 * 10 percent and only failed at about 12, which is the whole point of
 * pinning it here: these are the tests that name cutoff, so these are the
 * tests that have to fail when cutoff moves.
 *
 * The tolerance is on the filter, not on the measurement. responseDb sums
 * over a whole number of periods only when the frequency divides the
 * sample rate exactly; at 44100 and 80 Hz the same reading comes back
 * 2.6e-4 dB off for that reason alone, which is still far inside 0.01 but
 * is not the filter moving.
 */
const HALF_POWER_DB = 10 * Math.log10(0.5);

describe('Svf lowpass', () => {
  it('is at the half power point at cutoff with Butterworth q', () => {
    const db = responseDb(svf('lp', 1000, Math.SQRT1_2), 1000);
    expect(Math.abs(db - HALF_POWER_DB)).toBeLessThan(0.01);
  });

  it('is well down an octave above cutoff', () => {
    const db = responseDb(svf('lp', 1000, Math.SQRT1_2), 2000);
    expect(db).toBeLessThan(-10);
  });

  it('is flat in the passband', () => {
    const db = responseDb(svf('lp', 1000, Math.SQRT1_2), 100);
    expect(Math.abs(db)).toBeLessThan(0.5);
  });
});

describe('Svf highpass', () => {
  it('is at the half power point at cutoff with Butterworth q', () => {
    const db = responseDb(svf('hp', 1000, Math.SQRT1_2), 1000);
    expect(Math.abs(db - HALF_POWER_DB)).toBeLessThan(0.01);
  });

  it('is well down an octave below cutoff', () => {
    const db = responseDb(svf('hp', 1000, Math.SQRT1_2), 500);
    expect(db).toBeLessThan(-10);
  });

  it('is flat well above cutoff', () => {
    const db = responseDb(svf('hp', 1000, Math.SQRT1_2), 8000);
    expect(Math.abs(db)).toBeLessThan(0.5);
  });
});

describe('Svf cutoff tuning', () => {
  it('lands on the half power point at every cutoff, to a hundredth of a dB', () => {
    for (const fc of [80, 250, 3000, 6000]) {
      const lp = responseDb(svf('lp', fc, Math.SQRT1_2), fc);
      const hp = responseDb(svf('hp', fc, Math.SQRT1_2), fc);
      expect(Math.abs(lp - HALF_POWER_DB)).toBeLessThan(0.01);
      expect(Math.abs(hp - HALF_POWER_DB)).toBeLessThan(0.01);
    }
  });

  /*
   * A tuning check that no overall gain error can hide in: whatever the
   * level, the two outputs cross at cutoff. Measured, g mistuned by 0.1
   * percent opens this gap to 0.0174 dB and by 1 percent to 0.173 dB, so
   * this one catches about twice as fine a tuning error as the two
   * assertions above.
   */
  it('crosses lowpass and highpass at the same level at cutoff', () => {
    for (const fc of [80, 1000, 6000]) {
      const lp = responseDb(svf('lp', fc, Math.SQRT1_2), fc);
      const hp = responseDb(svf('hp', fc, Math.SQRT1_2), fc);
      expect(Math.abs(lp - hp)).toBeLessThan(0.01);
    }
  });
});

describe('Svf bandpass and notch', () => {
  it('bandpass peaks at center', () => {
    const center = responseDb(svf('bp', 1000, 2), 1000);
    const above = responseDb(svf('bp', 1000, 2), 4000);
    const below = responseDb(svf('bp', 1000, 2), 250);
    expect(center).toBeGreaterThan(above + 6);
    expect(center).toBeGreaterThan(below + 6);
  });

  it('notch cuts deep at center and passes elsewhere', () => {
    expect(responseDb(svf('notch', 1000, 2), 1000)).toBeLessThan(-25);
    expect(Math.abs(responseDb(svf('notch', 1000, 2), 100))).toBeLessThan(0.5);
    expect(Math.abs(responseDb(svf('notch', 1000, 2), 10000))).toBeLessThan(0.5);
  });
});

describe('Svf allpass and peak', () => {
  it('allpass is unity magnitude across the band', () => {
    for (const f of [100, 500, 1000, 3000, 9000]) {
      expect(Math.abs(responseDb(svf('allpass', 1000, 1), f))).toBeLessThan(0.3);
    }
  });

  it('peak mode is unity far from center', () => {
    expect(Math.abs(responseDb(svf('peak', 1000, 1), 50))).toBeLessThan(0.5);
    expect(Math.abs(responseDb(svf('peak', 1000, 1), 12000))).toBeLessThan(0.5);
  });
});

describe('Svf bell', () => {
  it('boosts by the requested dB at center', () => {
    const db = responseDb(svf('bell', 1000, 1, 6), 1000);
    expect(Math.abs(db - 6)).toBeLessThan(1);
  });

  it('cuts by the requested dB at center', () => {
    const db = responseDb(svf('bell', 1000, 1, -9), 1000);
    expect(Math.abs(db + 9)).toBeLessThan(1);
  });

  it('is near unity far from center', () => {
    expect(Math.abs(responseDb(svf('bell', 1000, 2, 6), 60))).toBeLessThan(1);
    expect(Math.abs(responseDb(svf('bell', 1000, 2, 6), 12000))).toBeLessThan(1);
  });
});

describe('Svf shelves', () => {
  it('lowshelf boosts below and is unity above', () => {
    expect(Math.abs(responseDb(svf('lowshelf', 1000, Math.SQRT1_2, 6), 50) - 6)).toBeLessThan(1);
    expect(Math.abs(responseDb(svf('lowshelf', 1000, Math.SQRT1_2, 6), 12000))).toBeLessThan(1);
  });

  it('highshelf boosts above and is unity below', () => {
    expect(Math.abs(responseDb(svf('highshelf', 1000, Math.SQRT1_2, 6), 12000) - 6)).toBeLessThan(1.5);
    expect(Math.abs(responseDb(svf('highshelf', 1000, Math.SQRT1_2, 6), 50))).toBeLessThan(1);
  });

  it('lowshelf cuts too', () => {
    expect(Math.abs(responseDb(svf('lowshelf', 1000, Math.SQRT1_2, -6), 50) + 6)).toBeLessThan(1);
  });
});

describe('Svf mechanics', () => {
  it('process matches next sample for sample', () => {
    const a = svf('lp', 800, 3);
    const b = svf('lp', 800, 3);
    const n = 512;
    const buf = new Float32Array(n);
    const ref = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = Math.sin(0.05 * i) + 0.3 * Math.sin(0.31 * i);
      buf[i] = x;
      ref[i] = Math.fround(b.next(x));
    }
    a.process(buf, 0, n);
    for (let i = 0; i < n; i++) expect(buf[i]).toBeCloseTo(ref[i], 5);
  });

  it('process respects the (from, to) range', () => {
    const f = svf('lp', 800, 1);
    const buf = new Float32Array(64).fill(0.5);
    f.process(buf, 16, 48);
    expect(buf[15]).toBe(0.5);
    expect(buf[48]).toBe(0.5);
    expect(buf[16]).not.toBe(0.5);
  });

  it('reset restores the initial impulse response', () => {
    const f = svf('lp', 500, 5);
    const fresh = svf('lp', 500, 5);
    for (let i = 0; i < 1000; i++) f.next(Math.sin(0.1 * i));
    f.reset();
    for (let i = 0; i < 32; i++) {
      const x = i === 0 ? 1 : 0;
      expect(f.next(x)).toBeCloseTo(fresh.next(x), 10);
    }
  });
});

describe('LadderFilter', () => {
  function ladder(cutoff: number, res: number, drive = 1): LadderFilter {
    const f = new LadderFilter(SR);
    f.set(cutoff, res, drive);
    return f;
  }

  it('attenuates above cutoff much more than below', () => {
    const below = responseDb(ladder(1000, 0), 200, 0.1);
    const above = responseDb(ladder(1000, 0), 8000, 0.1);
    expect(below - above).toBeGreaterThan(25);
  });

  it('resonance raises the peak at cutoff measurably', () => {
    const flat = responseDb(ladder(1000, 0), 1000, 0.02);
    const peaked = responseDb(ladder(1000, 0.9), 1000, 0.02);
    expect(peaked - flat).toBeGreaterThan(5);
  });

  /*
   * The peak does not become an oscillator anywhere in the documented
   * range, which is what set() now says. Measured on an impulse followed
   * by silence, at resonance 1 the peak over the second half second is
   * 2.3e-4 at fc 250, 7e-25 at 1000 and 0 at 4000, each far below the peak
   * over the first half second. Raising k past 4 puts fc 250 into a steady
   * 9e-2 tail that never decays, which is what this catches.
   *
   * Do not add a lower cutoff to the list. The decay is slower the lower
   * the cutoff goes: fc 125 reads 1.3e-3 at the same point, which is still
   * decaying (3e-9 by nine seconds) but is over the bound below.
   */
  it('does not self-oscillate at the top of the documented resonance range', () => {
    const half = Math.round(SR * 0.5);
    for (const fc of [250, 1000, 4000]) {
      const f = ladder(fc, 1);
      f.next(1);
      let early = 0;
      for (let n = 0; n < half; n++) early = Math.max(early, Math.abs(f.next(0)));
      let late = 0;
      for (let n = 0; n < half; n++) late = Math.max(late, Math.abs(f.next(0)));
      expect(late).toBeLessThan(1e-3);
      expect(late).toBeLessThan(early * 0.5);
    }
  });

  it('stays bounded under loud input at high resonance for one second', () => {
    const f = ladder(2000, 0.95, 2);
    let maxAbs = 0;
    for (let n = 0; n < SR; n++) {
      const x = 2 * Math.sin((2 * Math.PI * 220 * n) / SR);
      const y = f.next(x);
      expect(Number.isFinite(y)).toBe(true);
      const a = Math.abs(y);
      if (a > maxAbs) maxAbs = a;
    }
    expect(maxAbs).toBeLessThan(10);
  });

  it('reset clears state', () => {
    const f = ladder(2000, 0.9);
    for (let n = 0; n < 1000; n++) f.next(Math.sin(0.2 * n));
    f.reset();
    expect(f.next(0)).toBe(0);
  });
});

describe('OnePole', () => {
  it('lowpass is about -3 dB at cutoff', () => {
    const f = new OnePole(SR);
    f.setLowpass(1000);
    const db = responseDb(f, 1000);
    expect(Math.abs(db + 3)).toBeLessThan(1);
  });

  it('lowpass rolls off at 6 dB per octave', () => {
    const a = new OnePole(SR);
    a.setLowpass(500);
    expect(responseDb(a, 4000)).toBeLessThan(-12);
  });

  it('highpass is about -3 dB at cutoff and passes highs', () => {
    const f = new OnePole(SR);
    f.setHighpass(1000);
    expect(Math.abs(responseDb(f, 1000) + 3)).toBeLessThan(1.25);
    // small rise near Nyquist is expected from the digital pole mapping
    const g = new OnePole(SR);
    g.setHighpass(1000);
    expect(Math.abs(responseDb(g, 10000))).toBeLessThan(0.8);
  });

  it('highpass blocks lows', () => {
    const f = new OnePole(SR);
    f.setHighpass(1000);
    expect(responseDb(f, 125)).toBeLessThan(-12);
  });

  it('reset clears state', () => {
    const f = new OnePole(SR);
    f.setLowpass(100);
    for (let i = 0; i < 100; i++) f.next(1);
    f.reset();
    expect(f.next(0)).toBe(0);
  });
});

describe('DcBlocker', () => {
  it('removes a DC offset', () => {
    const f = new DcBlocker(SR);
    let y = 0;
    for (let n = 0; n < SR; n++) y = f.next(1);
    let sum = 0;
    for (let n = 0; n < 4800; n++) sum += f.next(1);
    expect(Math.abs(sum / 4800)).toBeLessThan(0.01);
    expect(Math.abs(y)).toBeLessThan(0.01);
  });

  it('passes audio band content at unity', () => {
    const f = new DcBlocker(SR);
    expect(Math.abs(responseDb(f, 1000))).toBeLessThan(0.5);
  });

  it('reset clears state', () => {
    const f = new DcBlocker(SR);
    for (let n = 0; n < 100; n++) f.next(1);
    f.reset();
    expect(f.next(0)).toBe(0);
  });
});
