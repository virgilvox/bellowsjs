/*
 * GlottalSource: the parametric glottal pulse ported from CHIMERA by
 * Jameson Hodge, with the area-to-flow step and the closure correction
 * that are new here. Periods are measured from the output, not read from
 * the unit: a cycle starts on the sample where the glottal flow leaves
 * zero, which it does exactly once per cycle while fry is below 0.3.
 */

import { describe, expect, it } from 'vitest';
import { rng } from '../../src/core/prng';
import { GlottalSource } from '../../src/dsp/glottal';
import { correlation, magnitudeSpectrum } from './spectrum';

const SR = 48000;

function unit(label = 'glottal-test', sr = SR): GlottalSource {
  return new GlottalSource(sr, rng(label));
}

/** Every perturbation off: no jitter, shimmer, diplophonia, chaos, drift or fry. */
function still(g: GlottalSource): GlottalSource {
  g.setRoughness(0);
  g.setJitter(0);
  g.setShimmer(0);
  g.setDiplophonia(0);
  g.setChaos(0);
  g.setDrift(0);
  g.setFry(0);
  return g;
}

function render(g: GlottalSource, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = g.next();
  return out;
}

/** Sample indices on which the flow leaves zero, up to `limit` of them. */
function onsets(g: GlottalSource, n: number, limit = Infinity): number[] {
  const out: number[] = [];
  let prev = g.flow;
  for (let i = 0; i < n && out.length < limit; i++) {
    g.next();
    const f = g.flow;
    if (prev === 0 && f > 0) out.push(i);
    prev = f;
  }
  return out;
}

function diffs(x: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length; i++) out.push(x[i] - x[i - 1]);
  return out;
}

function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

function sd(x: ArrayLike<number>): number {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) * (x[i] - m);
  return Math.sqrt(s / (x.length - 1));
}

/** Periods in samples, split into alternate cycles so diplophonia's alternation drops out. */
function byParity(periods: number[]): [number[], number[]] {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < periods.length; i++) (i % 2 === 0 ? a : b).push(periods[i]);
  return [a, b];
}

/**
 * Amplitudes of harmonics 1..count, by Hann windowed projection onto each
 * exact harmonic frequency. Over a second of a steady pulse train the
 * window's sidelobes at the neighbouring harmonics are far below anything
 * measured here, so the period need not be a whole number of samples.
 */
function harmonicAmps(y: Float64Array, sr: number, f0: number, count = 10): number[] {
  const n = y.length;
  const w = new Float64Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    wsum += w[i];
  }
  const out: number[] = [];
  for (let k = 1; k <= count; k++) {
    const om = (2 * Math.PI * k * f0) / sr;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += y[i] * w[i] * Math.cos(om * i);
      im -= y[i] * w[i] * Math.sin(om * i);
    }
    out.push((2 * Math.hypot(re, im)) / wsum);
  }
  return out;
}

/** Least squares slope of harmonic level against log2 of harmonic number, dB per octave. */
function tilt(amps: number[]): number {
  const n = amps.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let k = 1; k <= n; k++) {
    const x = Math.log2(k);
    const y = 20 * Math.log10(amps[k - 1]);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

function steadySpectrum(tension: number, sr = SR, hz = 220): number[] {
  const g = still(unit('glottal-test', sr));
  g.setTension(tension);
  g.setFreq(hz);
  render(g, Math.round(0.1 * sr));
  return harmonicAmps(render(g, sr), sr, hz, 10);
}

/** The jitter fraction CHIMERA's voice maps roughness to (voice/human_voice.rs). */
const chimeraJitter = (r: number) => 0.0021 + 0.0245 * r;

describe('GlottalSource pitch', () => {
  it.each([110, 220, 446.3])('holds mean f0 within 1 cent at %s Hz with roughness 0, fry 0, drift 0', (hz) => {
    const g = unit();
    g.setRoughness(0);
    g.setFry(0);
    g.setDrift(0);
    g.setFreq(hz);
    const on = onsets(g, 2 * SR);
    const period = (on[on.length - 1] - on[0]) / (on.length - 1);
    const cents = 1200 * Math.log2(SR / period / hz);
    expect(Math.abs(cents)).toBeLessThan(1);
  });

  it('is exact by construction with every perturbation off', () => {
    const g = still(unit());
    g.setFreq(261.63);
    const on = onsets(g, 4 * SR);
    const period = (on[on.length - 1] - on[0]) / (on.length - 1);
    expect(Math.abs(1200 * Math.log2(SR / period / 261.63))).toBeLessThan(0.05);
    expect(g.f0).toBeCloseTo(261.63, 9);
  });

  it('follows a frequency set every sample without dropping or doubling cycles', () => {
    // A 5 Hz, 50 cent vibrato applied from outside, the way the engine does it.
    const g = still(unit());
    let cycles = 0;
    let expected = 0;
    let prev = 0;
    for (let i = 0; i < 2 * SR; i++) {
      const hz = 220 * Math.pow(2, (0.5 * Math.sin((2 * Math.PI * 5 * i) / SR)) / 12);
      g.setFreq(hz);
      g.next();
      expected += hz / SR;
      if (prev === 0 && g.flow > 0) cycles++;
      prev = g.flow;
    }
    expect(Math.abs(cycles - expected)).toBeLessThan(1.5);
  });
});

describe('GlottalSource perturbation', () => {
  it('matches CHIMERA jitter at roughness 1 within 15 percent over 2000 cycles', () => {
    const g = unit();
    g.setRoughness(1);
    g.setDrift(0);
    g.setFreq(220);
    const periods = diffs(onsets(g, 12 * SR, 2001));
    expect(periods.length).toBe(2000);
    const t0 = SR / 220;
    const [even, odd] = byParity(periods);
    const measured = (sd(even) + sd(odd)) / 2 / t0;
    expect(measured / chimeraJitter(1)).toBeGreaterThan(0.85);
    expect(measured / chimeraJitter(1)).toBeLessThan(1.15);
    // Diplophonia at roughness 1 is 0.7: alternate periods 8 percent of that apart each way.
    const split = Math.abs(mean(even) - mean(odd)) / t0;
    expect(split / (2 * 0.08 * 0.7)).toBeGreaterThan(0.9);
    expect(split / (2 * 0.08 * 0.7)).toBeLessThan(1.1);
  });

  it('matches CHIMERA jitter at roughness 0.5, where diplophonia is still off', () => {
    const g = unit();
    g.setRoughness(0.5);
    g.setDrift(0);
    g.setFreq(110);
    const periods = diffs(onsets(g, 25 * SR, 2001));
    const t0 = SR / 110;
    const ratio = sd(periods) / t0 / chimeraJitter(0.5);
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it('matches CHIMERA shimmer at roughness 1 in the per-cycle flow peaks', () => {
    // Inertance makes peak flow slightly less than proportional to area,
    // so the spread of the flow peaks sits a little under the area shimmer.
    const g = unit();
    g.setRoughness(1);
    g.setDiplophonia(0);
    g.setJitter(0);
    g.setDrift(0);
    g.setFreq(220);
    const peaks: number[] = [];
    let peak = 0;
    let prev = 0;
    for (let i = 0; i < 12 * SR && peaks.length < 2000; i++) {
      g.next();
      const f = g.flow;
      if (f > peak) peak = f;
      if (prev > 0 && f === 0) {
        peaks.push(peak);
        peak = 0;
      }
      prev = f;
    }
    const cv = sd(peaks) / mean(peaks);
    const shimmer = 0.02 + 0.22 * 1;
    expect(cv / shimmer).toBeGreaterThan(0.75);
    expect(cv / shimmer).toBeLessThan(1.1);
  });

  it('drifts by the depth CHIMERA intends, with gauss rescaled to unit variance', () => {
    // CHIMERA's Drift sums three unit-variance bands weighted 1, 1/2, 1/3
    // and divides by 1.4, so its standard deviation is about 0.833 of the
    // depth. Without the rescale it would come out near 0.595.
    const sr = 8000;
    const depth = 6;
    const cents: number[] = [];
    for (let u = 0; u < 16; u++) {
      const g = unit('glottal-drift-' + u, sr);
      g.setRoughness(0);
      g.setJitter(0);
      g.setDrift(depth);
      g.setFreq(200);
      for (let i = 0; i < 70 * sr; i++) {
        g.next();
        if (i >= 5 * sr && i % 32 === 0) cents.push(1200 * Math.log2(g.f0 / 200));
      }
    }
    const expected = (depth * Math.sqrt(1 + 1 / 4 + 1 / 9)) / 1.4;
    const ratio = sd(cents) / expected;
    expect(ratio).toBeGreaterThan(0.88);
    expect(ratio).toBeLessThan(1.12);
    expect(Math.abs(mean(cents))).toBeLessThan(1);
  });

  it('gives units on different fork labels uncorrelated period sequences', () => {
    const run = (label: string) => {
      const g = new GlottalSource(SR, rng('glottal-test').fork(label));
      g.setRoughness(0.5);
      g.setDrift(0);
      g.setFreq(220);
      return diffs(onsets(g, 12 * SR, 2001));
    };
    const a = run('a');
    const b = run('b');
    expect(a.length).toBe(2000);
    expect(Math.abs(correlation(a, b))).toBeLessThan(0.1);
  });

  it('is bit identical on the same label, through a reset', () => {
    const busy = (g: GlottalSource) => {
      g.setFreq(180);
      g.setTension(0.3);
      g.setRoughness(0.8);
      g.setChaos(0.7);
      g.setFry(0.5);
      g.setDrift(10);
      return g;
    };
    const a = busy(new GlottalSource(SR, rng('glottal-test').fork('a')));
    const b = busy(new GlottalSource(SR, rng('glottal-test').fork('a')));
    const ya = render(a, SR);
    const yb = render(b, SR);
    a.reset();
    b.reset();
    a.setFreq(310);
    b.setFreq(310);
    const za = render(a, SR / 2);
    const zb = render(b, SR / 2);
    let diff = 0;
    for (let i = 0; i < ya.length; i++) if (ya[i] !== yb[i]) diff++;
    for (let i = 0; i < za.length; i++) if (za[i] !== zb[i]) diff++;
    expect(diff).toBe(0);
    const c = new GlottalSource(SR, rng('glottal-test').fork('b'));
    busy(c);
    const yc = render(c, SR);
    let same = 0;
    for (let i = 0; i < ya.length; i++) if (ya[i] === yc[i]) same++;
    expect(same).toBeLessThan(ya.length * 0.5);
  });

  it('walks the logistic map into period doubling and then chaos', () => {
    const run = (chaos: number, label = 'a') => {
      const g = still(new GlottalSource(SR, rng('glottal-test').fork(label)));
      g.setChaos(chaos);
      g.setFreq(220);
      return diffs(onsets(g, 12 * SR, 1001)).slice(50);
    };
    const t0 = SR / 220;
    // r = 2.9 + 1.1 * 0.3 = 3.23: a stable two-cycle, so a subharmonic.
    const [ea, oa] = byParity(run(0.3));
    expect(Math.abs(mean(ea) - mean(oa))).toBeGreaterThan(0.03 * t0);
    expect(sd(ea)).toBeLessThan(1);
    expect(sd(oa)).toBeLessThan(1);
    // r = 4: chaotic, so even alternate cycles scatter widely.
    const full = run(1);
    const [ec] = byParity(full);
    expect(sd(ec) / t0).toBeGreaterThan(0.05);
    // and the start of the map comes from the stream, so voices do not move in unison
    const other = run(1, 'b');
    expect(Math.abs(correlation(full, other))).toBeLessThan(0.2);
  });

  it('pulls toward 48 Hz and double pulses under full fry', () => {
    const g = still(unit());
    g.setFreq(220);
    g.setFry(1);
    render(g, SR / 10);
    const on = onsets(g, 2 * SR);
    // two flow pulses per cycle: the open quotient falls to 0.28 and the second pulse starts at 0.38
    expect(on.length).toBeGreaterThan(2 * 48 * 2 - 3);
    expect(on.length).toBeLessThan(2 * 48 * 2 + 3);
    expect(g.f0).toBeCloseTo(48, 6);
    const half = still(unit());
    half.setFreq(220);
    half.setFry(0.5);
    render(half, 10);
    expect(half.f0).toBeCloseTo(0.5 * 220 + 0.5 * 48, 6);
  });
});

describe('GlottalSource waveform', () => {
  it('has a steeper spectral tilt when lax than when pressed', () => {
    const lax = tilt(steadySpectrum(0));
    const mid = tilt(steadySpectrum(0.5));
    const pressed = tilt(steadySpectrum(1));
    expect(lax).toBeLessThan(mid);
    expect(mid).toBeLessThan(pressed);
    expect(pressed - lax).toBeGreaterThan(6);
  });

  it.each([0, 0.5, 1])('gives the same harmonics 1 to 10 at 44.1, 48 and 96 kHz at tension %s', (tension) => {
    const rows = [44100, 48000, 96000].map((sr) => steadySpectrum(tension, sr, 220));
    for (let k = 0; k < 10; k++) {
      const db = rows.map((r) => 20 * Math.log10(r[k]));
      expect(Math.max(...db) - Math.min(...db)).toBeLessThan(1);
    }
  });

  it('peaks near unit level at default settings, at any rate and pitch', () => {
    for (const sr of [44100, 48000, 96000]) {
      for (const hz of [110, 220, 440]) {
        const g = still(unit('glottal-test', sr));
        g.setFreq(hz);
        render(g, Math.round(0.05 * sr));
        const y = render(g, Math.round(0.25 * sr));
        let peak = 0;
        for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
        expect(peak).toBeGreaterThan(0.85);
        expect(peak).toBeLessThan(1.15);
      }
    }
  });

  it('is a flow derivative: no DC, flow zero while closed and about 1 at peak', () => {
    const g = still(unit());
    g.setFreq(200);
    render(g, 2400);
    // 240 samples a period, so 200 periods exactly
    const n = 48000;
    let sum = 0;
    let peakY = 0;
    let peakFlow = 0;
    let zeros = 0;
    let negative = 0;
    for (let i = 0; i < n; i++) {
      const y = g.next();
      sum += y;
      peakY = Math.max(peakY, Math.abs(y));
      const f = g.flow;
      peakFlow = Math.max(peakFlow, f);
      if (f === 0) zeros++;
      if (f < 0) negative++;
    }
    expect(Math.abs(sum / n)).toBeLessThan(1e-3 * peakY);
    expect(negative).toBe(0);
    // default tension 0.5 opens for 0.6 of the cycle
    expect(zeros / n).toBeGreaterThan(0.35);
    expect(zeros / n).toBeLessThan(0.45);
    expect(peakFlow).toBeGreaterThan(0.9);
    expect(peakFlow).toBeLessThanOrEqual(1);
  });

  it('starts every note from a closed glottis, without a click', () => {
    const g = unit();
    g.setFreq(300);
    render(g, 3000);
    g.reset();
    expect(g.flow).toBe(0);
    // The first sample barely opens; the opening phase then rises about 0.025 a sample.
    const y = render(g, 48);
    expect(Math.abs(y[0])).toBeLessThan(0.02);
    for (let i = 1; i < y.length; i++) expect(Math.abs(y[i] - y[i - 1])).toBeLessThan(0.1);
  });

  it('keeps aliases 60 dB under the harmonics below 10 kHz at 880 Hz, pressed', () => {
    const g = still(unit());
    g.setTension(1);
    g.setFreq(880);
    render(g, 4800);
    const n = 65536;
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = g.next();
    const mags = magnitudeSpectrum(y);
    const binHz = SR / n;
    const guard = 8;
    const harmonic = new Uint8Array(mags.length);
    for (let k = 1; k * 880 < SR / 2; k++) {
      const b = Math.round((k * 880) / binHz);
      for (let j = b - guard; j <= b + guard; j++) if (j >= 0 && j < mags.length) harmonic[j] = 1;
    }
    for (let j = 0; j <= guard; j++) harmonic[j] = 1;
    let h = 0;
    let a = 0;
    for (let j = 0; j < mags.length; j++) {
      const p = mags[j] * mags[j];
      if (harmonic[j]) h += p;
      else if (j * binHz < 10000) a += p;
    }
    expect(10 * Math.log10(a / h)).toBeLessThan(-60);
  });
});

describe('GlottalSource safety', () => {
  const SETTERS = [
    'setFreq',
    'setTension',
    'setRoughness',
    'setFry',
    'setDrift',
    'setJitter',
    'setShimmer',
    'setDiplophonia',
    'setChaos',
  ] as const;
  const VALUES = [NaN, 0, 1, 1e12, -1e12, Infinity, -Infinity];

  function busy(sr = SR): GlottalSource {
    const g = unit('glottal-safety', sr);
    g.setFreq(140);
    g.setTension(0.6);
    g.setRoughness(0.7);
    g.setChaos(0.5);
    g.setFry(0.4);
    return g;
  }

  function finite(g: GlottalSource, n: number): boolean {
    for (let i = 0; i < n; i++) {
      const y = g.next();
      if (!Number.isFinite(y) || Math.abs(y) > 1e3) return false;
      if (!Number.isFinite(g.flow) || !Number.isFinite(g.f0)) return false;
    }
    return true;
  }

  it.each(SETTERS)('%s stays finite at NaN, 0, 1, huge and negative values', (setter) => {
    for (const v of VALUES) {
      const g = busy();
      g[setter](v);
      expect(finite(g, SR / 5), `${setter}(${v})`).toBe(true);
    }
  });

  it('stays finite with every setter at the same extreme at once', () => {
    for (const v of VALUES) {
      for (const sr of [8000, 44100, 192000]) {
        const g = busy(sr);
        for (const s of SETTERS) g[s](v);
        expect(finite(g, sr / 5), `all at ${v}, ${sr} Hz`).toBe(true);
        g.reset();
        expect(finite(g, sr / 10), `all at ${v}, ${sr} Hz, after reset`).toBe(true);
      }
    }
  });
});

describe('GlottalSource allocation', () => {
  /** Strips comments so the scan below reads only code. */
  const code = (fn: (...args: never[]) => unknown) =>
    fn
      .toString()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  const ALLOCATING = [
    /\bnew\b/, // constructors
    /=>|\bfunction\b/, // closures
    /(^|[=(,:?]|\breturn)\s*[[{]/m, // array and object literals; indexing follows a name
    /\.\.\./, // spread and rest
    /['"`]/, // strings
    /\.(slice|map|filter|concat|subarray|fork|bind)\(/,
  ];

  it('has no allocating syntax in any method the audio path can reach', () => {
    const proto = GlottalSource.prototype;
    const scanned: string[] = [];
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(proto, name)!;
      for (const fn of [d.value, d.get, d.set]) {
        if (typeof fn !== 'function') continue;
        scanned.push(name);
        for (const pattern of ALLOCATING) expect(code(fn), `${name} ${pattern}`).not.toMatch(pattern);
      }
    }
    expect(scanned).toContain('next');
    expect(scanned).toContain('reset');
  });

  it('constructs no typed array, array, map or set from next, process, the setters or reset', () => {
    const names = [
      'Float32Array',
      'Float64Array',
      'Int8Array',
      'Uint8Array',
      'Uint8ClampedArray',
      'Int16Array',
      'Uint16Array',
      'Int32Array',
      'Uint32Array',
      'ArrayBuffer',
      'Array',
      'Map',
      'Set',
    ];
    const g = unit();
    g.setRoughness(1);
    g.setChaos(1);
    g.setFry(1);
    render(g, 1000);
    const block = new Float32Array(128);
    const host = globalThis as unknown as Record<string, unknown>;
    const saved: Array<[string, unknown]> = [];
    let count = 0;
    for (const name of names) {
      const original = host[name] as (...args: unknown[]) => unknown;
      saved.push([name, original]);
      host[name] = new Proxy(original, {
        construct(target, args, newTarget) {
          count++;
          return Reflect.construct(target as never, args, newTarget);
        },
        apply(target, self, args) {
          count++;
          return Reflect.apply(target, self, args);
        },
      });
    }
    let acc = 0;
    try {
      for (let i = 0; i < 200000; i++) {
        g.setFreq(100 + (i % 500));
        if (i % 128 === 0) {
          g.setTension((i % 1000) / 1000);
          g.setFry(i % 3 === 0 ? 0.8 : 0);
          g.setDrift(6);
        }
        if (i % 40000 === 0) g.reset();
        acc += g.next() + g.flow + g.f0;
      }
      for (let b = 0; b < 100; b++) {
        g.process(block, 0, 128);
        g.process(block, 17, 96);
        acc += block[95];
      }
    } finally {
      for (const [name, original] of saved) host[name] = original;
    }
    expect(count).toBe(0);
    expect(Number.isFinite(acc)).toBe(true);
  });
});
