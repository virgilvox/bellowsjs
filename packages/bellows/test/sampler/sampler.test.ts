import { describe, expect, it } from 'vitest';
import {
  SamplerBank,
  makeSamplerEngine,
  velCrossfadeGain,
  type SampleZone,
} from '../../src/engines/sampler';
import { rng } from '../../src/core/prng';
import {
  SR,
  estimatePitch,
  hasBadSamples,
  maxDelta,
  maxDiff,
  peak,
  render,
  rms,
  sineBuffer,
  sineZone,
} from './helpers';

/*
 * Loop points chosen so the raw seam jump is near worst case: the sine
 * sits near -1 at loopStart and near +1 just before loopEnd (period is
 * 44100/440 = 100.23 frames, so 2957 frames is about 29.5 periods).
 */
const LOOP_START = 977;
const LOOP_END = 3934;

function loopedZone(overrides: Partial<SampleZone> = {}): SampleZone {
  return sineZone({
    data: sineBuffer(440, 0.1),
    loopMode: 'loop',
    loopStart: LOOP_START,
    loopEnd: LOOP_END,
    ...overrides,
  });
}

function bankWith(...zones: SampleZone[]): SamplerBank {
  const bank = new SamplerBank();
  for (const z of zones) bank.addZone(z);
  return bank;
}

describe('SamplerBank zone selection', () => {
  it('filters by key and velocity ranges', () => {
    const low = sineZone({ keyLo: 0, keyHi: 60 });
    const high = sineZone({ keyLo: 61, keyHi: 127 });
    const soft = sineZone({ keyLo: 0, keyHi: 127, velLo: 0, velHi: 63 });
    const bank = bankWith(low, high, soft);
    expect(bank.zonesFor(60, 100, 0)).toEqual([low]);
    expect(bank.zonesFor(61, 100, 0)).toEqual([high]);
    expect(bank.zonesFor(60, 40, 0)).toEqual([low, soft]);
    expect(bank.zonesFor(128, 100, 0)).toEqual([]);
  });

  it('cycles round robin zones by counter, sorted by seqPosition', () => {
    const r2 = sineZone({ roundRobinGroup: 1, seqPosition: 2 });
    const r1 = sineZone({ roundRobinGroup: 1, seqPosition: 1 });
    const r3 = sineZone({ roundRobinGroup: 1, seqPosition: 3 });
    const plain = sineZone();
    const bank = bankWith(r2, r1, r3, plain);
    expect(bank.zonesFor(60, 100, 0)).toEqual([plain, r1]);
    expect(bank.zonesFor(60, 100, 1)).toEqual([plain, r2]);
    expect(bank.zonesFor(60, 100, 2)).toEqual([plain, r3]);
    expect(bank.zonesFor(60, 100, 3)).toEqual([plain, r1]);
  });

  it('independent round robin groups cycle independently', () => {
    const a1 = sineZone({ roundRobinGroup: 1, seqPosition: 1 });
    const a2 = sineZone({ roundRobinGroup: 1, seqPosition: 2 });
    const b1 = sineZone({ roundRobinGroup: 2, seqPosition: 1 });
    const b2 = sineZone({ roundRobinGroup: 2, seqPosition: 2 });
    const b3 = sineZone({ roundRobinGroup: 2, seqPosition: 3 });
    const bank = bankWith(a1, a2, b1, b2, b3);
    expect(bank.zonesFor(60, 100, 2)).toEqual([a1, b3]);
    expect(bank.zonesFor(60, 100, 3)).toEqual([a2, b1]);
  });

  it('velocity crossfade returns both layers near the boundary', () => {
    const soft = sineZone({ velLo: 0, velHi: 63 });
    const loud = sineZone({ velLo: 64, velHi: 127 });
    const bank = new SamplerBank({ velXfade: 20 });
    bank.addZone(soft);
    bank.addZone(loud);
    expect(bank.zonesFor(60, 64, 0)).toEqual([soft, loud]);
    expect(bank.zonesFor(60, 30, 0)).toEqual([soft]);
    expect(bank.velGain(soft, 30)).toBe(1);
  });

  it('crossfade weights are equal power across a shared boundary', () => {
    const soft = sineZone({ velLo: 0, velHi: 63 });
    const loud = sineZone({ velLo: 64, velHi: 127 });
    for (const vel of [55, 60, 63.5, 67, 72]) {
      const a = velCrossfadeGain(soft, vel, 20);
      const b = velCrossfadeGain(loud, vel, 20);
      expect(a * a + b * b).toBeCloseTo(1, 6);
    }
    /* Center of the fade splits power evenly. */
    const mid = velCrossfadeGain(soft, 63.5, 20);
    expect(mid).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('crossfade width zero is a hard switch and edges 0/127 never fade', () => {
    const soft = sineZone({ velLo: 0, velHi: 63 });
    expect(velCrossfadeGain(soft, 63, 0)).toBe(1);
    expect(velCrossfadeGain(soft, 64, 0)).toBe(0);
    expect(velCrossfadeGain(soft, 1, 20)).toBe(1);
    const full = sineZone({ velLo: 0, velHi: 127 });
    expect(velCrossfadeGain(full, 127, 20)).toBe(1);
  });
});

describe('sampler engine pitch tracking', () => {
  it('plays A4 at 440 Hz within 0.5 percent', () => {
    const def = makeSamplerEngine(bankWith(sineZone()));
    const { l } = render(def, { freq: 440 });
    expect(hasBadSamples(l)).toBe(false);
    expect(estimatePitch(l)).toBeCloseTo(440, -Math.log10(440 * 0.005));
    expect(Math.abs(estimatePitch(l) - 440) / 440).toBeLessThan(0.005);
  });

  it('plays E5 at 659.3 Hz within 1 percent', () => {
    const def = makeSamplerEngine(bankWith(sineZone()));
    const e5 = 440 * Math.pow(2, 7 / 12);
    const { l } = render(def, { freq: e5 });
    expect(Math.abs(estimatePitch(l) - 659.26) / 659.26).toBeLessThan(0.01);
  });

  it('fineTune shifts pitch in cents', () => {
    const def = makeSamplerEngine(bankWith(sineZone({ fineTune: 100 })));
    const { l } = render(def, { freq: 440 });
    const want = 440 * Math.pow(2, 100 / 1200);
    expect(Math.abs(estimatePitch(l) - want) / want).toBeLessThan(0.01);
  });

  it('rootKey maps the sample onto the keyboard', () => {
    /* Same 440 Hz data claimed at rootKey 57: playing 220 gives 440. */
    const def = makeSamplerEngine(bankWith(sineZone({ rootKey: 57 })));
    const { l } = render(def, { freq: 220 });
    expect(Math.abs(estimatePitch(l) - 440) / 440).toBeLessThan(0.005);
  });

  it('resamples zones recorded at a different sample rate', () => {
    /* 440 Hz rendered at 22050 must still play back at 440. */
    const def = makeSamplerEngine(
      bankWith(sineZone({ data: sineBuffer(440, 1, 22050), sampleRate: 22050 })),
    );
    const { l } = render(def, { freq: 440 });
    expect(Math.abs(estimatePitch(l) - 440) / 440).toBeLessThan(0.005);
  });
});

describe('sampler engine layers and velocity', () => {
  it('velocity selects the matching layer', () => {
    const soft = sineZone({ velLo: 0, velHi: 63 });
    const loud = sineZone({ data: sineBuffer(880, 1), velLo: 64, velHi: 127 });
    const def = makeSamplerEngine(bankWith(soft, loud));
    const params = { veltrack: 0 };
    const a = render(def, { freq: 440, vel: 0.3, params });
    const b = render(def, { freq: 440, vel: 0.9, params });
    expect(Math.abs(estimatePitch(a.l) - 440) / 440).toBeLessThan(0.005);
    expect(Math.abs(estimatePitch(b.l) - 880) / 880).toBeLessThan(0.005);
  });

  it('round robin cycles across successive notes of one engine', () => {
    const freqs = [440, 550, 660];
    const zones = freqs.map((f, i) =>
      sineZone({ data: sineBuffer(f, 1), roundRobinGroup: 1, seqPosition: i + 1 }),
    );
    const def = makeSamplerEngine(bankWith(...zones));
    const got: number[] = [];
    for (let n = 0; n < 4; n++) got.push(estimatePitch(render(def, { freq: 440 }).l));
    const want = [440, 550, 660, 440];
    for (let n = 0; n < 4; n++) {
      expect(Math.abs(got[n] - want[n]) / want[n]).toBeLessThan(0.01);
    }
  });

  it('stereo zones play each channel', () => {
    const zone = sineZone({ data: sineBuffer(440, 1), dataR: sineBuffer(880, 1) });
    const def = makeSamplerEngine(bankWith(zone));
    const { l, r } = render(def, { freq: 440 });
    expect(Math.abs(estimatePitch(l) - 440) / 440).toBeLessThan(0.005);
    expect(Math.abs(estimatePitch(r) - 880) / 880).toBeLessThan(0.005);
  });

  it('amp_veltrack scales gain by velocity squared', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const win: [number, number] = [Math.round(0.2 * SR), Math.round(0.4 * SR)];
    const full = rms(render(def, { vel: 1, params: { veltrack: 100 } }).l, ...win);
    const half = rms(render(def, { vel: 0.5, params: { veltrack: 100 } }).l, ...win);
    const flat = rms(render(def, { vel: 0.5, params: { veltrack: 0 } }).l, ...win);
    expect(half / full).toBeCloseTo(0.25, 2);
    expect(flat / full).toBeCloseTo(1, 2);
  });

  it('zone gainDb attenuates and pan steers', () => {
    const loud = makeSamplerEngine(bankWith(loopedZone()));
    const quiet = makeSamplerEngine(bankWith(loopedZone({ gainDb: -6 })));
    const win: [number, number] = [Math.round(0.2 * SR), Math.round(0.4 * SR)];
    const a = rms(render(loud).l, ...win);
    const b = rms(render(quiet).l, ...win);
    expect(b / a).toBeCloseTo(Math.pow(10, -6 / 20), 2);

    const hardLeft = makeSamplerEngine(bankWith(loopedZone({ pan: -1 })));
    const { l, r } = render(hardLeft);
    expect(rms(l, ...win)).toBeGreaterThan(0.3);
    expect(rms(r, ...win)).toBeLessThan(1e-6);
  });
});

describe('sampler engine looping', () => {
  it('sustains past the buffer length without clicks when crossfaded', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const { l } = render(def, { seconds: 1, params: { loopXfade: 10 } });
    /* Buffer is 0.1 s; the last tenth of a 1 s render is loop material. */
    expect(rms(l, Math.round(0.9 * SR), SR)).toBeGreaterThan(0.3);
    /* A clean 440 sine at amp 0.8 steps at most 0.051 per sample. */
    expect(maxDelta(l, Math.round(0.1 * SR), SR)).toBeLessThan(0.09);
  });

  it('the raw loop seam clicks with the crossfade disabled', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const { l } = render(def, { seconds: 1, params: { loopXfade: 0 } });
    expect(maxDelta(l, Math.round(0.1 * SR), SR)).toBeGreaterThan(0.5);
  });

  it('loopRelease plays through to the end after noteOff', () => {
    const env = { attack: 0.002, hold: 0, decay: 0.1, sustain: 1, release: 10 };
    const through = makeSamplerEngine(bankWith(loopedZone({ loopMode: 'loopRelease', env })));
    const held = makeSamplerEngine(bankWith(loopedZone({ loopMode: 'loop', env })));
    const a = render(through, { seconds: 1.2, offAt: 0.5 });
    const b = render(held, { seconds: 1.2, offAt: 0.5 });
    const tail: [number, number] = [Math.round(0.8 * SR), Math.round(1.2 * SR)];
    /* loopRelease runs out of sample soon after the release... */
    expect(rms(a.l, ...tail)).toBeLessThan(1e-3);
    expect(a.voice.active).toBe(false);
    /* ...while a continuous loop with a 10 s release keeps sounding. */
    expect(rms(b.l, ...tail)).toBeGreaterThan(0.3);
    expect(b.voice.active).toBe(true);
  });

  it('a non-looping zone stops at the end of its data', () => {
    const def = makeSamplerEngine(bankWith(sineZone({ data: sineBuffer(440, 0.1) })));
    const { l, voice } = render(def, { seconds: 0.3 });
    expect(rms(l, Math.round(0.15 * SR), Math.round(0.3 * SR))).toBe(0);
    expect(voice.active).toBe(false);
  });
});

describe('sampler engine envelope', () => {
  it('release fades the note out', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const { l, voice } = render(def, {
      seconds: 0.8,
      offAt: 0.3,
      params: { release: 0.05 },
    });
    expect(rms(l, Math.round(0.2 * SR), Math.round(0.3 * SR))).toBeGreaterThan(0.3);
    expect(rms(l, Math.round(0.7 * SR), Math.round(0.8 * SR))).toBeLessThan(0.01);
    expect(voice.active).toBe(false);
  });

  it('zone envelopes override engine defaults, including hold', () => {
    const env = { attack: 0.001, hold: 0.2, decay: 0.02, sustain: 0.1, release: 0.1 };
    const def = makeSamplerEngine(bankWith(loopedZone({ env })));
    const { l } = render(def, { seconds: 0.6 });
    const during = peak(l, Math.round(0.08 * SR), Math.round(0.15 * SR));
    const after = peak(l, Math.round(0.35 * SR), Math.round(0.45 * SR));
    /* Held at full level through 0.2 s, then decayed to sustain 0.1. */
    expect(during).toBeGreaterThan(0.7);
    expect(after / during).toBeGreaterThan(0.05);
    expect(after / during).toBeLessThan(0.2);
  });

  it('engine attack param shapes the onset when the zone has no env', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const { l } = render(def, { seconds: 0.5, params: { attack: 0.1 } });
    const early = peak(l, 0, Math.round(0.01 * SR));
    const late = peak(l, Math.round(0.2 * SR), Math.round(0.3 * SR));
    expect(early).toBeLessThan(late * 0.3);
  });
});

describe('sampler engine voice contract', () => {
  it('adds into the output buffers instead of overwriting', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const solo = render(def, { seconds: 0.2 });
    const n = Math.round(0.2 * SR);
    const l = new Float32Array(n).fill(0.5);
    const r = new Float32Array(n).fill(0.5);
    const voice = def.createVoice(SR, {}, rng('test/add'));
    voice.noteOn(440, 1);
    for (let i = 0; i < n; i += 128) voice.process(l, r, i, Math.min(i + 128, n));
    for (const i of [100, 1000, 5000]) {
      expect(l[i] - 0.5).toBeCloseTo(solo.l[i], 5);
    }
  });

  it('is deterministic across identical renders', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const a = render(def, { seconds: 0.4, offAt: 0.2, seed: 'det' });
    const b = render(def, { seconds: 0.4, offAt: 0.2, seed: 'det' });
    expect(maxDiff(a.l, b.l)).toBe(0);
    expect(maxDiff(a.r, b.r)).toBe(0);
  });

  it('a reused voice resets fully on the next noteOn', () => {
    const def = makeSamplerEngine(bankWith(loopedZone()));
    const first = render(def, { seconds: 0.4, offAt: 0.1, params: { release: 0.05 } });
    expect(first.voice.active).toBe(false);
    const again = render(def, {
      seconds: 0.4,
      offAt: 0.1,
      params: { release: 0.05 },
      voice: first.voice,
    });
    expect(maxDiff(first.l, again.l)).toBe(0);
  });

  it('a note with no matching zones is immediately inactive and silent', () => {
    const def = makeSamplerEngine(bankWith(sineZone({ keyLo: 0, keyHi: 40 })));
    const { l, voice } = render(def, { freq: 440, seconds: 0.1 });
    expect(rms(l)).toBe(0);
    expect(voice.active).toBe(false);
  });

  it('unknown params are ignored', () => {
    const def = makeSamplerEngine(bankWith(sineZone()));
    const voice = def.createVoice(SR, {}, rng('test/params'));
    expect(() => voice.setParam('nope', 1)).not.toThrow();
  });
});
