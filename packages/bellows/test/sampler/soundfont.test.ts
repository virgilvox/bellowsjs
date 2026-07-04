/*
 * Tests for the soundfont-to-sampler bridges. SF2 banks come from the
 * byte-level fixture builders in sf2fixture.ts; SFZ regions come from
 * parseSfz over inline text with a synthetic sample loader.
 */

import { describe, expect, it } from 'vitest';
import { SoundFont } from '../../src/io/sf2';
import { parseSfz } from '../../src/io/sfz';
import {
  samplerBankFromSf2,
  samplerBankFromSfz,
  type LoadedSample,
} from '../../src/engines/soundfont';
import { makeSamplerEngine, type SampleZone } from '../../src/engines/sampler';
import { estimatePitch, render, sineBuffer } from './helpers';
import {
  buildSimpleSf2,
  buildStereoSf2,
  buildTestSf2,
  samples16,
  shdrRec,
  sineSamples,
} from './sf2fixture';

/** n frames of a sine with the given period, as 16-bit sample values. */
function longSine(n: number, period: number): number[] {
  return Array.from({ length: n }, (_, i) =>
    Math.round(Math.sin((2 * Math.PI * i) / period) * 30000),
  );
}

describe('samplerBankFromSf2', () => {
  it('maps resolved generators onto SampleZone fields', () => {
    const sf = SoundFont.parse(buildTestSf2());
    const bank = samplerBankFromSf2(sf, 0, 0);
    expect(bank.zones).toHaveLength(2);

    const zA = bank.zones.find((z) => z.keyHi === 60)!;
    const zB = bank.zones.find((z) => z.keyLo === 61)!;
    expect(zA).toBeDefined();
    expect(zB).toBeDefined();

    /* Zone A: rootKey override 60, looped 8+2 .. 56-2, attack -1200 tc. */
    expect(zA.rootKey).toBe(60);
    expect(zA.loopMode).toBe('loop');
    expect(zA.loopStart).toBe(10);
    expect(zA.loopEnd).toBe(54);
    expect(zA.data).toHaveLength(64);
    expect(zA.dataR).toBeUndefined();
    expect(zA.sampleRate).toBe(44100);
    expect(zA.env!.attack).toBeCloseTo(0.5, 6);
    /* Instrument global releaseVolEnv -3600 tc = 0.125 s. */
    expect(zA.env!.release).toBeCloseTo(0.125, 6);
    expect(zA.env!.sustain).toBeCloseTo(1, 6);
    /* Preset global initialAttenuation 100 cB = -10 dB. */
    expect(zA.gainDb).toBeCloseTo(-10, 4);
    /* Instrument global pan 250 = half right. */
    expect(zA.pan).toBeCloseTo(0.5, 6);
    /* Preset-relative fineTune 25 cents. */
    expect(zA.fineTune).toBe(25);

    /* Zone B: sample originalPitch root, coarseTune 2 semitones. */
    expect(zB.rootKey).toBe(69);
    expect(zB.fineTune).toBe(225);
    expect(zB.velLo).toBe(0);
    expect(zB.velHi).toBe(100);
    expect(zB.loopMode).toBe('none');
    expect(zB.loopStart).toBeUndefined();
    expect(zB.env!.attack).toBeLessThan(0.002);
  });

  it('throws when the bank/program pair does not exist', () => {
    const sf = SoundFont.parse(buildTestSf2());
    expect(() => samplerBankFromSf2(sf, 1, 5)).toThrow(/no preset/);
  });

  it('collapses a stereo pair into one stereo zone', () => {
    const sf = SoundFont.parse(buildStereoSf2());
    const bank = samplerBankFromSf2(sf, 0, 0);
    expect(bank.zones).toHaveLength(1);
    const z = bank.zones[0];
    expect(z.dataR).toBeDefined();
    expect(z.data).toHaveLength(64);
    expect(z.dataR).toHaveLength(64);
    /* Right channel was rendered at half the left's amplitude. */
    expect(z.data[16]).toBeCloseTo(30000 / 32768, 3);
    expect(z.dataR![16]).toBeCloseTo(15000 / 32768, 3);
  });

  it('carries the sample pitch correction into fineTune', () => {
    const sf = SoundFont.parse(
      buildSimpleSf2({
        shdrs: [shdrRec('S', 0, 64, 0, 0, 44100, 69, 50, 0, 1)],
        smpl: samples16(sineSamples(64)),
      }),
    );
    const bank = samplerBankFromSf2(sf, 0, 0);
    expect(bank.zones).toHaveLength(1);
    expect(bank.zones[0].fineTune).toBe(50);
    expect(bank.zones[0].rootKey).toBe(69);
  });

  it('plays a bridged bank at the sample frequency', () => {
    /* 0.3 s of a period-100 sine: 441 Hz at 44100, rooted at key 69. */
    const n = 13230;
    const sf = SoundFont.parse(
      buildSimpleSf2({
        shdrs: [shdrRec('S', 0, n, 0, 0, 44100, 69, 0, 0, 1)],
        smpl: samples16(longSine(n, 100)),
      }),
    );
    const def = makeSamplerEngine(samplerBankFromSf2(sf, 0, 0), 'sf2test');
    const { l } = render(def, { freq: 440, seconds: 0.28 });
    expect(Math.abs(estimatePitch(l) - 441) / 441).toBeLessThan(0.005);
  });
});

describe('samplerBankFromSfz', () => {
  /** Loader returning a distinct synthesized sine per path, counting calls. */
  function makeLoader(): {
    loader: (path: string) => Promise<LoadedSample>;
    calls: string[];
    byPath: Map<string, Float32Array>;
  } {
    const calls: string[] = [];
    const byPath = new Map<string, Float32Array>();
    const loader = async (path: string): Promise<LoadedSample> => {
      calls.push(path);
      let data = byPath.get(path);
      if (!data) {
        data = sineBuffer(440, 0.1);
        byPath.set(path, data);
      }
      return { data, sampleRate: 44100 };
    };
    return { loader, calls, byPath };
  }

  it('maps region opcodes onto SampleZone fields', async () => {
    const text = `
<region> sample=a.wav lokey=60 hikey=72 pitch_keycenter=69 lovel=10 hivel=100
 tune=25 transpose=1 volume=-6 pan=-50
 ampeg_attack=0.01 ampeg_hold=0.05 ampeg_decay=0.2 ampeg_sustain=50 ampeg_release=0.3
 loop_mode=loop_continuous loop_start=100 loop_end=199
`;
    const { regions } = await parseSfz(text);
    const { loader } = makeLoader();
    const bank = await samplerBankFromSfz(regions, loader);
    expect(bank.zones).toHaveLength(1);
    const z = bank.zones[0];
    expect(z.keyLo).toBe(60);
    expect(z.keyHi).toBe(72);
    expect(z.rootKey).toBe(69);
    expect(z.velLo).toBe(10);
    expect(z.velHi).toBe(100);
    /* tune 25 cents plus transpose 1 semitone. */
    expect(z.fineTune).toBe(125);
    expect(z.gainDb).toBe(-6);
    expect(z.pan).toBeCloseTo(-0.5, 6);
    expect(z.loopMode).toBe('loop');
    expect(z.loopStart).toBe(100);
    /* SFZ loop_end is inclusive; SampleZone loopEnd is exclusive. */
    expect(z.loopEnd).toBe(200);
    expect(z.env).toEqual({
      attack: 0.01,
      hold: 0.05,
      decay: 0.2,
      sustain: 0.5,
      release: 0.3,
    });
  });

  it('loads each distinct sample path once', async () => {
    const text = `
<region> sample=a.wav lokey=0 hikey=60
<region> sample=a.wav lokey=61 hikey=127
<region> sample=b.wav lovel=0 hivel=63
`;
    const { regions } = await parseSfz(text);
    const { loader, calls, byPath } = makeLoader();
    const bank = await samplerBankFromSfz(regions, loader);
    expect(bank.zones).toHaveLength(3);
    expect(calls).toEqual(['a.wav', 'b.wav']);
    expect(bank.zones[0].data).toBe(byPath.get('a.wav'));
    expect(bank.zones[1].data).toBe(byPath.get('a.wav'));
    expect(bank.zones[2].data).toBe(byPath.get('b.wav'));
  });

  it('accepts a synchronous loader', async () => {
    const { regions } = await parseSfz('<region> sample=a.wav');
    const data = sineBuffer(440, 0.05);
    const bank = await samplerBankFromSfz(regions, () => ({ data, sampleRate: 22050 }));
    expect(bank.zones).toHaveLength(1);
    expect(bank.zones[0].data).toBe(data);
    expect(bank.zones[0].sampleRate).toBe(22050);
  });

  it('applies the offset opcode to data and loop points', async () => {
    const text = '<region> sample=a.wav offset=50 loop_start=100 loop_end=199';
    const { regions } = await parseSfz(text);
    const { loader, byPath } = makeLoader();
    const bank = await samplerBankFromSfz(regions, loader);
    const z = bank.zones[0];
    expect(z.data).toHaveLength(byPath.get('a.wav')!.length - 50);
    expect(z.loopStart).toBe(50);
    expect(z.loopEnd).toBe(150);
    /* Loop points present with no loop_mode default to a continuous loop. */
    expect(z.loopMode).toBe('loop');
  });

  it('maps loop modes and leaves default ampeg to the engine', async () => {
    const text = `
<region> sample=a.wav loop_mode=one_shot
<region> sample=a.wav loop_mode=loop_sustain loop_start=10 loop_end=99
<region> sample=a.wav
`;
    const { regions } = await parseSfz(text);
    const { loader } = makeLoader();
    const bank = await samplerBankFromSfz(regions, loader);
    const modes = bank.zones.map((z: SampleZone) => z.loopMode);
    expect(modes).toEqual(['none', 'loopRelease', 'none']);
    for (const z of bank.zones) expect(z.env).toBeUndefined();
  });

  it('turns seq_length/seq_position into round robin cycling', async () => {
    const text = `
<group> seq_length=3
<region> sample=a.wav seq_position=1
<region> sample=b.wav seq_position=2
<region> sample=c.wav seq_position=3
`;
    const { regions } = await parseSfz(text);
    const { loader, byPath } = makeLoader();
    const bank = await samplerBankFromSfz(regions, loader);
    expect(bank.zones).toHaveLength(3);
    const want = ['a.wav', 'b.wav', 'c.wav', 'a.wav'];
    for (let i = 0; i < want.length; i++) {
      const hits = bank.zonesFor(60, 100, i);
      expect(hits).toHaveLength(1);
      expect(hits[0].data).toBe(byPath.get(want[i]));
    }
  });

  it('regions with different ranges round robin independently', async () => {
    const text = `
<region> sample=a.wav lokey=0 hikey=60 seq_length=2 seq_position=1
<region> sample=b.wav lokey=0 hikey=60 seq_length=2 seq_position=2
<region> sample=c.wav lokey=61 hikey=127 seq_length=2 seq_position=1
<region> sample=d.wav lokey=61 hikey=127 seq_length=2 seq_position=2
`;
    const { regions } = await parseSfz(text);
    const { loader, byPath } = makeLoader();
    const bank = await samplerBankFromSfz(regions, loader);
    expect(bank.zonesFor(40, 100, 1)[0].data).toBe(byPath.get('b.wav'));
    expect(bank.zonesFor(80, 100, 1)[0].data).toBe(byPath.get('d.wav'));
  });

  it('plays a bridged region at the right pitch', async () => {
    const text = '<region> sample=a.wav pitch_keycenter=69 loop_start=977 loop_end=3933';
    const { regions } = await parseSfz(text);
    const bank = await samplerBankFromSfz(regions, () => ({
      data: sineBuffer(440, 0.1),
      sampleRate: 44100,
    }));
    const def = makeSamplerEngine(bank, 'sfztest');
    const { l } = render(def, { freq: 440, seconds: 0.5 });
    expect(Math.abs(estimatePitch(l) - 440) / 440).toBeLessThan(0.005);
  });
});
