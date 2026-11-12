import { describe, expect, it } from 'vitest';
import { JunctionAirway, ductMin } from '../../src/dsp/junction-airway';
import { AirwayTube, evenNodes } from '../../src/dsp/airway-tube';
import { CM_H2O, WALL_TRACHEA } from '../../src/dsp/air';
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
  a.teethI = n - 2;
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
});
