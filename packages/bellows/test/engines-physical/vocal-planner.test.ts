import { describe, expect, it } from 'vitest';
import {
  ARTICULATOR_RATE,
  CASCADE_LAG,
  LIP_COMPRESSED,
  LIP_VIRTUAL,
  VocalPlanner,
} from '../../src/engines/vocal-planner';
import { ART } from '../../src/engines/vocal-articulators';
import { VOCAL_ARTICULATOR_HZ, VOCAL_TABLE_PHONEMES } from '../../src/engines/vocal-tables.gen';
import { vocalEngine } from '../../src/engines/vocal';
import { vocalPhonemeIndex } from '../../src/engines/vocal-phonemes';
import { CASCADE_SETTLE_98 } from '../../src/dsp/cascade';
import { CRITDAMP_SETTLE_98 } from '../../src/dsp/critdamp';
import { rng } from '../../src/core/prng';
import { defaultParams } from './helpers';

const idx = (ipa: string) => {
  const i = VOCAL_TABLE_PHONEMES.indexOf(ipa as never);
  if (i < 0) throw new Error(`no table phoneme ${ipa}`);
  return i;
};

/** A planner holding the line [ipa, start] ..., ending at `end`. */
function plan(line: Array<[string, number]>, end: number): VocalPlanner {
  const p = new VocalPlanner();
  for (const [ipa, t] of line) p.addUpcoming(idx(ipa), t);
  p.setEnd(end);
  return p;
}

/** Speeds and targets of articulator a over [from, to] in 1 ms steps. */
function trace(p: VocalPlanner, a: number, from: number, to: number): { t: number[]; speed: number[]; target: number[] } {
  const out = { t: [] as number[], speed: [] as number[], target: [] as number[] };
  for (let t = from; t <= to + 1e-9; t += 0.001) {
    p.evaluate(t, 6.45, 7.3);
    out.t.push(t);
    out.speed.push(p.speed[a]);
    out.target.push(p.target[a]);
  }
  return out;
}

/** The 98 percent time of articulator a at speed s, seconds. */
const t98 = (a: number, s: number) => CRITDAMP_SETTLE_98 / (2 * Math.PI * VOCAL_ARTICULATOR_HZ[a] * s);

describe('vocal planner: the cascade', () => {
  it('keeps each articulator\'s 98 percent time: rate = 2 pi f 12.03 / 5.83', () => {
    for (let a = 0; a < ARTICULATOR_RATE.length; a++) {
      expect(CASCADE_SETTLE_98 / ARTICULATOR_RATE[a]).toBeCloseTo(t98(a, 1), 12);
    }
  });

  it('leads each articulator by the cascade\'s added lag, 0.18 of its 98 percent time', () => {
    expect(CASCADE_LAG).toBeCloseTo(0.1836, 3);
    // a vowel after silence: the jaw (10 Hz), the tongue body (12 Hz) and the lips (11 Hz) start toward it that far ahead
    const p = plan([['_', 0], ['ɑ', 0.5]], 2);
    for (const a of [ART.jaw, ART.tbX, ART.lipAp]) {
      const tr = trace(p, a, 0.3, 0.6);
      const first = tr.t[tr.target.findIndex((v) => Math.abs(v - tr.target[0]) > 1e-9)];
      const lead = CASCADE_LAG * t98(a, 1);
      // a phrase's first vowel ramps in over 0.07 s before it; its target moves within 1 ms of that, less the lead
      expect(first).toBeGreaterThan(0.5 - 0.07 - lead - 0.0015);
      expect(first).toBeLessThan(0.5 - 0.07 - lead + 0.0015);
    }
  });
});

describe('vocal planner: return gestures', () => {
  it('holds a stop\'s return speed over a whole release movement, whatever vowel follows', () => {
    for (const vowel of ['ɑ', 'i', 'u']) {
      const p = plan([['ɑ', 0], ['b', 0.5], [vowel, 0.6]], 2);
      const tr = trace(p, ART.lipAp, 0.4, 0.8);
      // after the closure gesture's end (0.6 - 0.025) and its 18 ms ramp, the speed stays at 1.55
      // for one 98 percent time of the lips at 1.55, less the lips' lead, then returns to 1
      const lead = CASCADE_LAG * t98(ART.lipAp, 1.55);
      const end = 0.6 - 0.025 + 0.018 + t98(ART.lipAp, 1.55) - lead;
      const fast = tr.t.filter((_, i) => tr.speed[i] === 1.55);
      expect(Math.max(...fast), vowel).toBeGreaterThan(end - 0.0015);
      expect(Math.max(...fast), vowel).toBeLessThan(end + 0.0015);
      expect(tr.speed[tr.speed.length - 1]).toBe(1);
    }
  });

  it('gives each manner its own return speed: tap 2.8, affricate closure 2.0, stop and nasal 1.55, fricative 1.3', () => {
    const returnSpeed = (c: string, a: number) => {
      const p = plan([['ɑ', 0], [c, 0.5], ['ɑ', 0.62]], 2);
      // just after the gesture's end, inside the ramp out
      p.evaluate(0.62 - 0.005, 6.45, 7.3);
      return p.speed[a];
    };
    expect(returnSpeed('ɾ', ART.ttY)).toBe(2.8);
    expect(returnSpeed('t', ART.ttY)).toBe(1.55);
    expect(returnSpeed('n', ART.ttY)).toBe(1.55);
    expect(returnSpeed('s', ART.ttY)).toBe(1.3);
    expect(returnSpeed('l', ART.ttY)).toBe(1.3);
    // an affricate's fricative part approaches at 1.4 and returns at the fricatives' 1.3
    const p = plan([['ɑ', 0], ['tʃ', 0.5], ['ɑ', 0.62]], 2);
    p.evaluate(0.58, 6.45, 7.3);
    expect(p.speed[ART.ttY]).toBe(1.4);
    p.evaluate(0.625, 6.45, 7.3);
    expect(p.speed[ART.ttY]).toBe(1.3);
  });

  it('lets the next consonant\'s approach take the articulator from a return', () => {
    // /s/ returns at 1.3; the /t/ after it approaches at 1.55 on the same tip
    const p = plan([['ɑ', 0], ['s', 0.5], ['t', 0.6], ['ɑ', 0.68]], 2);
    p.evaluate(0.6, 6.45, 7.3);
    expect(p.speed[ART.ttY]).toBe(1.55);
  });

  it('lets a closure win the articulator from another constriction while both are under way', () => {
    // /t/ then /ð/: while /ð/ ramps in and /t/ still holds, the closure keeps the tip at /t/'s target, where
    // blending by strength would have pulled it 0.24 cm toward /ð/'s (the tip sees the plan 8.5 ms ahead)
    const p = plan([['ɑ', 0], ['t', 0.5], ['ð', 0.56], ['ə', 0.62]], 2);
    const alone = plan([['ɑ', 0], ['t', 0.5], ['ɑ', 0.56]], 2);
    p.evaluate(0.522, 6.45, 7.3);
    alone.evaluate(0.522, 6.45, 7.3);
    expect(p.target[ART.ttY]).toBeCloseTo(alone.target[ART.ttY], 2);
    // and the more anterior of two closures: /t/ (alveolar) before /tʃ/ (postalveolar) keeps the tip
    const q = plan([['ɑ', 0], ['t', 0.5], ['tʃ', 0.56], ['ɑ', 0.66]], 2);
    q.evaluate(0.522, 6.45, 7.3);
    expect(q.target[ART.ttX]).toBeCloseTo(alone.target[ART.ttX], 2);
    expect(q.target[ART.ttY]).toBeCloseTo(alone.target[ART.ttY], 2);
  });

  it('aims a bilabial closure at the virtual target past the lips\' contact', () => {
    expect(LIP_VIRTUAL).toBeLessThan(LIP_COMPRESSED);
    const p = plan([['ɑ', 0], ['m', 0.5], ['ɑ', 0.6]], 2);
    p.evaluate(0.55, 6.45, 7.3);
    expect(p.target[ART.lipAp]).toBeLessThan(LIP_COMPRESSED - 0.5);
  });
});

describe('vocal engine: contact with a cascade', () => {
  /** Drive /ɑbɑ/ and /ɑtɑ/ and read the lips (white box). */
  const run = (cons: string) => {
    const voice = vocalEngine.createVoice(48000, defaultParams(vocalEngine), rng('contact')) as unknown as {
      noteOn(f: number, v: number): void;
      setParam(n: string, v: number): void;
      process(l: Float32Array, r: Float32Array, a: number, b: number): void;
      bank: { values: Float64Array; stage(i: number, k: number): number; velocity(i: number): number };
    };
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    const rows: Array<{ t: number; ap: number; s0: number; v: number }> = [];
    voice.setParam('phoneme', vocalPhonemeIndex('ɑ'));
    voice.noteOn(110, 0.8);
    for (let b = 0; b < 375; b++) {
      const t = (b * 128) / 48000;
      if (b === 75) {
        voice.setParam('nextIn', 0.3);
        voice.setParam('nextPhoneme', vocalPhonemeIndex(cons));
      }
      if (b === 188) voice.setParam('phoneme', vocalPhonemeIndex(cons));
      if (b === 190) {
        voice.setParam('nextIn', 0.1);
        voice.setParam('nextPhoneme', vocalPhonemeIndex('ɑ'));
      }
      if (b === 225) voice.setParam('phoneme', vocalPhonemeIndex('ɑ'));
      voice.process(l, r, 0, 128);
      rows.push({ t, ap: voice.bank.values[ART.lipAp], s0: voice.bank.stage(ART.lipAp, 0), v: voice.bank.velocity(ART.lipAp) });
    }
    return rows;
  };

  it('closes the lips near their fastest, holds them compressed while their motion goes on, and releases', () => {
    const rows = run('b');
    const close = rows.findIndex((q, i) => i > 0 && rows[i - 1].ap > 0 && q.ap <= 0);
    expect(close).toBeGreaterThan(0);
    // the closing speed where the lips meet against the movement's peak (Lofqvist and Gracco 1997: near it)
    let peak = 0;
    for (let i = close - 40; i < close + 10; i++) if (rows[i].ap > LIP_COMPRESSED + 1e-6) peak = Math.min(peak, rows[i].v);
    const at = rows[close - 1].v + (rows[close].v - rows[close - 1].v) * (rows[close - 1].ap / (rows[close - 1].ap - rows[close].ap));
    expect(at / peak).toBeGreaterThan(0.8);
    // held at the compression limit while the first stage goes on past it
    const held = rows.filter((q) => q.ap === LIP_COMPRESSED);
    expect(held.length).toBeGreaterThan(5);
    expect(Math.min(...held.map((q) => q.s0))).toBeLessThan(LIP_COMPRESSED - 0.4);
    expect(Math.min(...rows.map((q) => q.ap))).toBe(LIP_COMPRESSED);
    // and opens again
    expect(rows[rows.length - 1].ap).toBeGreaterThan(0.5);
  });
});
