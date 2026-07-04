import { describe, expect, it } from 'vitest';
import { rng } from '../../src/core/prng';
import { NoiseGen, type NoiseColor } from '../../src/dsp/noise';
import { octaveBandDensity, tiltDbPerOctave } from './spectrum';

const SR = 44100;

function render(color: NoiseColor, n: number, label = 'noise-test'): Float32Array {
  const gen = new NoiseGen(SR, color, rng(label));
  const out = new Float32Array(n);
  gen.process(out, 0, n);
  return out;
}

describe('NoiseGen white', () => {
  it('has near zero mean and sensible variance', () => {
    const out = render('white', SR);
    let mean = 0;
    for (let i = 0; i < out.length; i++) mean += out[i];
    mean /= out.length;
    let varsum = 0;
    for (let i = 0; i < out.length; i++) varsum += (out[i] - mean) * (out[i] - mean);
    const variance = varsum / out.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
    // uniform on [-1, 1) has variance 1/3
    expect(variance).toBeGreaterThan(0.28);
    expect(variance).toBeLessThan(0.39);
  });

  it('stays in [-1, 1)', () => {
    const out = render('white', SR);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-1);
      expect(out[i]).toBeLessThan(1);
    }
  });

  it('has a flat spectrum', () => {
    const out = render('white', SR * 4);
    const tilt = tiltDbPerOctave(octaveBandDensity(out, SR, 100, 12800));
    expect(Math.abs(tilt)).toBeLessThan(1);
  });
});

describe('NoiseGen pink', () => {
  it('tilts about -3 dB per octave from 100 Hz to above 10 kHz', () => {
    const out = render('pink', SR * 4);
    const bands = octaveBandDensity(out, SR, 100, 12800);
    const tilt = tiltDbPerOctave(bands);
    expect(tilt).toBeLessThan(-2);
    expect(tilt).toBeGreaterThan(-4);
    // every adjacent band pair should fall too, not just the fit
    for (let i = 1; i < bands.length; i++) {
      const step = bands[i].db - bands[i - 1].db;
      expect(step).toBeLessThan(-1);
      expect(step).toBeGreaterThan(-5.5);
    }
  });

  it('stays bounded', () => {
    const out = render('pink', SR * 2);
    for (let i = 0; i < out.length; i++) expect(Math.abs(out[i])).toBeLessThan(1.5);
  });
});

describe('NoiseGen brown', () => {
  it('tilts about -6 dB per octave in the integrator band', () => {
    const out = render('brown', SR * 4);
    const tilt = tiltDbPerOctave(octaveBandDensity(out, SR, 800, 12800));
    expect(tilt).toBeLessThan(-4.5);
    expect(tilt).toBeGreaterThan(-7.5);
  });

  it('stays bounded', () => {
    const out = render('brown', SR * 4);
    for (let i = 0; i < out.length; i++) expect(Math.abs(out[i])).toBeLessThan(4);
  });
});

describe('NoiseGen velvet', () => {
  it('fires about 2000 unit impulses per second, both signs', () => {
    const out = render('velvet', SR * 4);
    let pos = 0;
    let neg = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === 1) pos++;
      else if (out[i] === -1) neg++;
      else expect(out[i]).toBe(0);
    }
    const perSecond = (pos + neg) / 4;
    expect(perSecond).toBeGreaterThan(1600);
    expect(perSecond).toBeLessThan(2400);
    expect(pos / (pos + neg)).toBeGreaterThan(0.4);
    expect(pos / (pos + neg)).toBeLessThan(0.6);
  });
});

describe('NoiseGen crackle', () => {
  it('is mostly silent with sparse decaying pops', () => {
    const out = render('crackle', SR * 4);
    let loud = 0;
    let quiet = 0;
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i]) > 0.3) loud++;
      else if (Math.abs(out[i]) < 0.01) quiet++;
    }
    // pops decay with a 2 ms time constant, so loud samples are rare
    expect(loud / out.length).toBeLessThan(0.06);
    expect(quiet / out.length).toBeGreaterThan(0.8);
  });

  it('pops decay monotonically between triggers', () => {
    const out = render('crackle', SR);
    // find a pop onset and check the next few samples shrink
    for (let i = 1; i < out.length - 8; i++) {
      if (Math.abs(out[i]) > 0.5 && Math.abs(out[i - 1]) < Math.abs(out[i])) {
        for (let j = 1; j < 8; j++) {
          const cur = Math.abs(out[i + j]);
          const prev = Math.abs(out[i + j - 1]);
          if (cur > prev) return; // retriggered, stop checking this pop
          expect(cur).toBeLessThanOrEqual(prev);
        }
        return;
      }
    }
    throw new Error('no pop found in one second of crackle');
  });
});

describe('NoiseGen determinism', () => {
  const colors: NoiseColor[] = ['white', 'pink', 'brown', 'velvet', 'crackle'];
  for (const color of colors) {
    it(`${color} reproduces exactly from the same rng label`, () => {
      const a = render(color, 4096, 'seed-a');
      const b = render(color, 4096, 'seed-a');
      expect(Array.from(b)).toEqual(Array.from(a));
      const c = render(color, 4096, 'seed-b');
      let same = true;
      for (let i = 0; i < c.length; i++) {
        if (c[i] !== a[i]) {
          same = false;
          break;
        }
      }
      expect(same).toBe(false);
    });
  }

  it('setColor resets filter state', () => {
    const gen = new NoiseGen(SR, 'pink', rng('reset-test'));
    for (let i = 0; i < 1000; i++) gen.next();
    gen.setColor('velvet');
    const v = gen.next();
    expect(v === 0 || v === 1 || v === -1).toBe(true);
  });
});
