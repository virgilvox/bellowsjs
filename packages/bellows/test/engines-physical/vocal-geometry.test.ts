/*
 * The vocal engine's control and geometry: the planner, CHIMERA's exact
 * geometry against CHIMERA's own output, the drive onto the airway's grid
 * and CHIMERA's area rate limit.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VocalPlanner, KEY_ABDUCTION } from '../../src/engines/vocal-planner';
import { ART } from '../../src/engines/vocal-articulators';
import { ChimeraGeometry, GEOMETRY_BODIES } from '../../src/engines/vocal-geometry';
import { VocalDrive } from '../../src/engines/vocal-drive';
import { JunctionAirway } from '../../src/dsp/junction-airway';
import { AreaSlew } from '../../src/dsp/area-rate';
import { VOCAL_BODIES, VOCAL_NEUTRAL } from '../../src/engines/vocal-tables.gen';
import { vocalPhonemeIndex } from '../../src/engines/vocal-phonemes';
import { rng } from '../../src/core/prng';

const ph = (s: string) => vocalPhonemeIndex(s);
void KEY_ABDUCTION;

describe('VocalPlanner', () => {
  it('holds a consonant\'s dominant articulators and lets the tongue body follow the vowels', () => {
    const p = new VocalPlanner();
    p.addNow(ph('ɑ'), 0);
    p.addUpcoming(ph('b'), 0.3);
    p.addUpcoming(ph('i'), 0.4);
    p.evaluate(0.36, 6.2, 6.8);
    /* the lips close for /b/ */
    expect(p.target[ART.lipAp]).toBeLessThan(0);
    /* and the tongue body is already on its way from /ɑ/ to /i/ (anticipation) */
    const tbA = VOCAL_BODIES[0].vowelTargets[ph('ɑ')][ART.tbY];
    const tbI = VOCAL_BODIES[0].vowelTargets[ph('i')][ART.tbY];
    expect(p.target[ART.tbY]).toBeGreaterThan(tbA + 0.2 * (tbI - tbA));
  });

  it('starts a stop\'s closure before its segment when it was posted ahead, and not when it was not', () => {
    const ahead = new VocalPlanner();
    ahead.addNow(ph('ɑ'), 0);
    ahead.addUpcoming(ph('t'), 0.3);
    ahead.evaluate(0.29, 6.2, 6.8);
    const now = new VocalPlanner();
    now.addNow(ph('ɑ'), 0);
    now.evaluate(0.29, 6.2, 6.8);
    expect(ahead.target[ART.ttY]).toBeGreaterThan(now.target[ART.ttY] + 0.3);
  });

  it('confirms a posted segment when its phoneme arrives on time, and replaces the plan when another arrives', () => {
    const p = new VocalPlanner();
    p.addNow(ph('ɑ'), 0);
    p.addUpcoming(ph('m'), 0.2);
    p.addNow(ph('m'), 0.2005);
    expect(p.phonemeOf(p.segmentAt(0.25))).toBe(ph('m'));
    expect(p.segmentAt(0.25)).toBe(1);
    p.addUpcoming(ph('u'), 0.5);
    p.addNow(ph('i'), 0.3);
    expect(p.phonemeOf(p.segmentAt(0.6))).toBe(ph('i'));
  });

  it('abducts the glottis for a voiceless sound and at the end of the breath', () => {
    const p = new VocalPlanner();
    p.addNow(ph('ɑ'), 0);
    p.addUpcoming(ph('s'), 0.3);
    p.addUpcoming(ph('ɑ'), 0.45);
    p.evaluate(0.37, 6.2, 6.8);
    expect(p.abduction).toBeGreaterThan(0.2);
    p.evaluate(0.7, 6.2, 6.8);
    expect(p.abduction).toBeLessThan(0.01);
    p.setEnd(0.8);
    p.evaluate(0.9, 6.2, 6.8);
    expect(p.abduction).toBeGreaterThan(0.1);
  });
});

describe('ChimeraGeometry', () => {
  const fx = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'chimera-geometry.json'), 'utf8')) as {
    frames: Array<{ body: number; a: number[]; nPh: number; nOr: number; ph: number[]; or: number[]; phMin: number[]; orMin: number[]; phLen: number; orLen: number; teeth: number; velum: number; lipArea: number }>;
  };
  it('reproduces CHIMERA\'s own geometry (its Rust, 36 frames of stops, fricatives and sonorants, three bodies) to 1e-9', () => {
    const close = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThan(1e-9 * Math.max(1, Math.abs(y)));
    for (const f of fx.frames) {
      const g = new ChimeraGeometry(GEOMETRY_BODIES[f.body]);
      const ph = new Float64Array(f.nPh);
      const or = new Float64Array(f.nOr);
      const phm = new Float64Array(f.nPh);
      const orm = new Float64Array(f.nOr);
      g.evaluate(Float64Array.from(f.a));
      g.resample(ph, or, phm, orm);
      for (let i = 0; i < f.nPh; i++) {
        close(ph[i], f.ph[i]);
        close(phm[i], f.phMin[i]);
      }
      for (let i = 0; i < f.nOr; i++) {
        close(or[i], f.or[i]);
        close(orm[i], f.orMin[i]);
      }
      close(g.phLen, f.phLen);
      close(g.orLen, f.orLen);
      close(g.teethS, f.teeth);
      close(g.velumPort, f.velum);
      close(g.lipArea, f.lipArea);
    }
  });

  it('lays a body out again in place: setBody to another body and back gives the same shape', () => {
    const g = new ChimeraGeometry(GEOMETRY_BODIES[0]);
    const a = Float64Array.from(VOCAL_NEUTRAL);
    const ph = new Float64Array(18);
    const or = new Float64Array(18);
    const m1 = new Float64Array(18);
    const m2 = new Float64Array(18);
    g.evaluate(a);
    g.resample(ph, or, m1, m2);
    const before = Array.from(ph);
    const c = GEOMETRY_BODIES[2];
    g.setBody(c.scale, c.pharynx, c.tongueRadius, c.lipWidth);
    g.evaluate(a);
    g.resample(ph, or, m1, m2);
    expect(g.phLen + g.orLen).toBeLessThan(15);
    const m = GEOMETRY_BODIES[0];
    g.setBody(m.scale, m.pharynx, m.tongueRadius, m.lipWidth);
    g.evaluate(a);
    g.resample(ph, or, m1, m2);
    expect(Array.from(ph)).toEqual(before);
  });
});

describe('VocalDrive', () => {
  it('puts the neutral tract on the grid: open sections, the duct at least its minimum, incisors and split inside', () => {
    const air = new JunctionAirway(48000, 40, rng('drive'));
    air.configure(1, 40, 19);
    const d = new VocalDrive(48000);
    d.setBody(1, 1, 2.25, 4.6);
    d.key(Float64Array.from(VOCAL_NEUTRAL), true);
    d.u = 1;
    d.toAirway(air);
    for (let i = 0; i < 40; i++) {
      expect(air.gridIn[i]).toBeGreaterThan(0.2);
      expect(air.gridMin[i]).toBeLessThanOrEqual(air.gridIn[i]);
    }
    expect(air.ductLen).toBeGreaterThanOrEqual(1.25);
    expect(air.teethI).toBeGreaterThan(30);
    expect(air.teethI).toBeLessThanOrEqual(40);
    expect(air.splitI).toBeGreaterThan(10);
    expect(air.splitI).toBeLessThan(30);
    /* a snapped key moves nothing */
    for (let j = 0; j <= 40; j++) expect(air.vflow[j]).toBe(0);
  });

  it('closes a grid section for /b/ at the lips and for /t/ behind the incisors', () => {
    const air = new JunctionAirway(48000, 40, rng('drive'));
    air.configure(1, 40, 19);
    const d = new VocalDrive(48000);
    d.setBody(1, 1, 2.25, 4.6);
    for (const [ipa, lo] of [['b', 36], ['t', 26]] as const) {
      const a = Float64Array.from(VOCAL_NEUTRAL);
      const row = VOCAL_BODIES[0].consonantTargets[vocalPhonemeIndex(ipa)];
      for (let i = 0; i < 17; i++) if (row[i] === row[i]) a[i] = row[i];
      d.key(a, true);
      d.u = 1;
      d.toAirway(air);
      let mi = 0;
      for (let i = 1; i < 40; i++) if (air.gridMin[i] < air.gridMin[mi]) mi = i;
      expect(air.gridMin[mi]).toBeLessThan(0.01);
      expect(mi).toBeGreaterThanOrEqual(lo);
    }
  });
});

describe('AreaSlew', () => {
  it('opens at 45 k^2 + 40 A cm^2/s and eases a seal down so it is reached smoothly', () => {
    const s = new AreaSlew();
    s.setScale(1);
    expect(s.limit(5, 0.5, 0.001)).toBeCloseTo(0.5 + (45 + 40 * 5) * 0.001, 9);
    s.setStep(0.001);
    let a = 1;
    let prev = Infinity;
    const steps: number[] = [];
    for (let i = 0; i < 400; i++) {
      const next = s.limit(0, a, 0.0005);
      steps.push(a - next);
      a = next;
    }
    /* closing slows near the seal: the last steps are much smaller than the first */
    expect(steps[steps.length - 1]).toBeLessThan(steps[0] / 20);
    for (const d of steps) {
      expect(d).toBeLessThanOrEqual(prev + 1e-12);
      prev = Math.max(d, prev === Infinity ? d : prev);
    }
    const all = new Float64Array([0, 3]);
    s.limitAll(all, new Float64Array([1, 1]), 2);
    expect(all[0]).toBeCloseTo(s.limit(0, 1, 0.001), 12);
    expect(all[1]).toBeCloseTo(s.limit(3, 1, 0.001), 12);
  });
});
