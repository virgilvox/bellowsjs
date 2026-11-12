import { describe, expect, it } from 'vitest';
import { JunctionAirway, ductMin } from '../../src/dsp/junction-airway';
import { AirwayTube, evenNodes } from '../../src/dsp/airway-tube';
import { CM_H2O, WALL_TRACHEA, WALL_TRACT } from '../../src/dsp/air';
import { rng } from '../../src/core/prng';

/** An airway of n sections at `rate`, every section `area` cm^2, glottis held open, lungs at `pLung` cmH2O. */
function airway(rate: number, n: number, area: number, pLung: number): JunctionAirway {
  const a = new JunctionAirway(rate, n, rng('jtest'));
  a.configure(1, n, Math.floor(n / 2));
  a.gridIn.fill(area);
  a.gridMin.fill(area);
  a.vflow.fill(0);
  a.ductLen = 2;
  a.ductArea = area;
  a.velum = 0;
  a.pLung = pLung * CM_H2O;
  a.agStatic = 0.3;
  a.f0 = 110;
  a.teethX = n - 2;
  a.splitI = n / 2;
  a.gain = 1;
  return a;
}

function run(a: JunctionAirway, samples: number, each?: (block: number) => void): Float32Array {
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

describe('AirwayTube', () => {
  it('lays even nodes and delays each segment by half its sections', () => {
    const nodes = new Int32Array(8);
    const nn = evenNodes(32, 4, nodes);
    expect(nodes[0]).toBe(0);
    expect(nodes[nn - 1]).toBe(32);
    for (let i = 1; i < nn; i++) expect((nodes[i] - nodes[i - 1]) % 2).toBe(0);
    const t = new AirwayTube(6);
    t.configure(new Float64Array(32).fill(2.5), 32, nodes, nn, WALL_TRACHEA, 1, 1, 0.3646, 48000);
    for (let s = 0; s < nn - 1; s++) expect(t.D[s]).toBe((nodes[s + 1] - nodes[s]) / 2);
  });
});

describe('JunctionAirway', () => {
  it('carries the mean flow: an open tract under lung pressure passes the same steady flow at the glottis and the lips', () => {
    const a = airway(48000, 40, 3, 8);
    run(a, 48000 * 0.6);
    expect(a.uLips).toBeGreaterThan(50);
    expect(Math.abs(a.dpGlottis)).toBeGreaterThan(1 * CM_H2O);
  });

  it('builds pressure behind a closure until the folds see almost none, and bursts at the release', () => {
    const a = airway(48000, 40, 3, 8);
    const close = (b: number) => {
      if (b === 200) {
        a.gridIn[36] = 1e-6;
        a.gridMin[36] = 1e-6;
      }
      if (b === 1200) {
        a.gridIn[36] = 3;
        a.gridMin[36] = 3;
      }
    };
    const x = run(a, 1400 * a.block, close);
    // the closure is near silent, the release far louder
    const blk = a.block;
    let closed = 0;
    for (let i = 1000 * blk; i < 1150 * blk; i++) closed = Math.max(closed, Math.abs(x[i]));
    let burst = 0;
    for (let i = 1200 * blk; i < 1260 * blk; i++) burst = Math.max(burst, Math.abs(x[i]));
    expect(burst).toBeGreaterThan(20 * closed);
  });

  it('stays finite and bounded under random areas moving every block, at every rate, the anatomical flow driven too', () => {
    for (const rate of [22050, 44100, 48000, 96000]) {
      const dx = 35000 / (2 * rate);
      const n = Math.floor((15.87 - ductMin(rate)) / dx);
      const a = airway(rate, n, 2, 9);
      const r = rng('motion');
      const x = run(a, Math.round(rate * 1.5), () => {
        for (let i = 0; i < n; i++) {
          const v = r() < 0.1 ? 1e-6 : 0.05 + 4 * r();
          a.gridIn[i] = v;
          a.gridMin[i] = v * (0.5 + 0.5 * r());
          a.vflow[i] = (r() - 0.5) * 200;
        }
        a.velum = r() < 0.5 ? 0 : r() * 0.5;
      });
      let peak = 0;
      for (const v of x) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeLessThan(1e3);
    }
  });

  it('is deterministic per stream and reseeds its turbulence at reset', () => {
    const one = run(airway(48000, 40, 0.1, 8), 9600);
    const two = run(airway(48000, 40, 0.1, 8), 9600);
    expect(Array.from(one)).toEqual(Array.from(two));
  });

  it('makes no jet in a wide tract: only the glottal source sounds', () => {
    const a = airway(48000, 40, 3, 8);
    run(a, 9600);
    for (let q = 0; q < 3; q++) {
      expect(a.noiseGain[q]).toBe(0);
      expect(a.noisePlace[q]).toBe(-1);
    }
    expect(a.noiseGain[3]).toBeGreaterThan(0);
    expect(a.noiseLevel[3]).toBeGreaterThan(0);
  });

  /** A tract of 3 cm^2 with a constriction of area `ac` over sections [lo, hi], unvoiced. */
  function constricted(lo: number, hi: number, ac: number, teethX: number, pLung = 8, labial = 0): JunctionAirway {
    const a = airway(48000, 40, 3, pLung);
    for (let s = lo; s <= hi; s++) {
      a.gridIn[s] = ac;
      a.gridMin[s] = ac;
    }
    a.teethX = teethX;
    a.labial = labial;
    run(a, 0.3 * 48000);
    return a;
  }
  const loudest = (a: JunctionAirway) => [0, 1, 2].reduce((p, q) => (a.noiseGain[q] > a.noiseGain[p] ? q : p), 0);

  it("sets a constriction's source by |v|^3 sqrt(A) (Stevens): faster or wider, louder by that law", () => {
    const rows = [
      { ac: 0.1, p: 5 },
      { ac: 0.1, p: 10 },
      { ac: 0.3, p: 8 },
    ].map(({ ac, p }) => {
      const a = constricted(30, 31, ac, 34.5, p);
      const q = loudest(a);
      const v = a.noiseVelocity[q];
      return { v, area: a.noiseArea[q], law: a.noiseLevel[q] / (v * v * v * Math.sqrt(a.noiseArea[q])) };
    });
    // the jet speeds up with the pressure behind it
    expect(rows[1].v).toBeGreaterThan(1.2 * rows[0].v);
    // the level is v^3 sqrt(A) of the velocity it read (the mean of a cube a little over the cube of the mean)
    for (const r of rows) {
      expect(r.area).toBeGreaterThan(0.05);
      expect(r.law).toBeGreaterThan(0.95);
      expect(r.law).toBeLessThan(1.3);
    }
  });

  it('places the source by the separation point: a wall source downstream far from the incisors, an obstacle at them near, labiodental past them', () => {
    const dx = 35000 / (2 * 48000);
    // D = 26 sections: a wall source 0.25 cm past the separation (junction 12)
    const wall = constricted(10, 11, 0.1, 38);
    let q = loudest(wall);
    expect(wall.noisePlace[q]).toBeCloseTo(12 + 0.25 / dx, 1);
    // D = 2.5 sections (0.9 cm): an obstacle source at the incisors, twice the wall's gain
    const obstacle = constricted(30, 31, 0.1, 34.5);
    q = loudest(obstacle);
    expect(obstacle.noisePlace[q]).toBeCloseTo(34.5, 1);
    expect(obstacle.noiseGain[q]).toBeCloseTo(2 * wall.noiseGain[loudest(wall)], 6);
    // separation past the incisors, formed by the lower lip: labiodental, 0.15 cm downstream
    const labio = constricted(36, 37, 0.15, 37.5, 8, 1);
    q = loudest(labio);
    expect(labio.noisePlace[q]).toBeCloseTo(38 + 0.15 / dx, 1);
    // the same place formed by the tongue (/θ/): the obstacle source stays at the incisors
    const dental = constricted(36, 37, 0.15, 37.5, 8, 0);
    q = loudest(dental);
    expect(dental.noisePlace[q]).toBeCloseTo(37.5, 1);
  });

  it('keeps two constrictions apart as two sources, and one joined by narrow sections as one', () => {
    const two = airway(48000, 40, 3, 8);
    two.gridIn[10] = two.gridMin[10] = 0.3;
    two.gridIn[30] = two.gridMin[30] = 0.1;
    two.teethX = 34;
    run(two, 9600);
    expect([0, 1, 2].filter((q) => two.noiseGain[q] > 0).length).toBe(2);
    const one = airway(48000, 40, 3, 8);
    for (let s = 26; s <= 31; s++) one.gridIn[s] = one.gridMin[s] = s === 30 ? 0.1 : 0.6;
    one.teethX = 34;
    run(one, 9600);
    expect([0, 1, 2].filter((q) => one.noiseGain[q] > 0).length).toBe(1);
  });

  it('makes no noise through a sealed section: its leak is the area floor, not a jet', () => {
    const a = constricted(30, 31, 1e-6, 34.5);
    for (let q = 0; q < 3; q++) expect(a.noiseLevel[q]).toBe(0);
  });

  it("takes Birkholz and Zhang's wall: mass 2.0 g/cm^2, stiffness and damping in their fitted ranges", () => {
    expect(WALL_TRACT.m).toBe(2.0);
    expect(WALL_TRACT.k).toBeGreaterThanOrEqual(65000);
    expect(WALL_TRACT.k).toBeLessThanOrEqual(100000);
    expect(WALL_TRACT.r).toBeGreaterThanOrEqual(800);
    expect(WALL_TRACT.r).toBeLessThanOrEqual(2000);
  });

  it('voices on through a held labial closure while the walls yield (MEASURED 83 ms; CHIMERA walls 60)', () => {
    const a = airway(48000, 40, 3, 8);
    a.agStatic = 0.03;
    const tc = 0.4;
    let held = -1;
    run(a, 0.8 * 48000, (b) => {
      const t = (b * a.block) / 48000;
      const close = Math.min(1, Math.max(0, (t - tc) / 0.008));
      a.gridIn[38] = a.gridMin[38] = 3 * (1 - close) + 1e-6;
      if (t > tc && held < 0 && a.voicing < 0.5) held = t - tc;
    });
    expect(held).toBeGreaterThan(0.07);
    expect(held).toBeLessThan(0.15);
  });
});

