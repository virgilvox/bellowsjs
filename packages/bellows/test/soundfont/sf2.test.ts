import { describe, expect, it } from 'vitest';
import {
  SoundFont,
  timecentsToSeconds,
  centibelsToGain,
  absoluteCentsToHz,
} from '../../src/io/sf2';
import {
  buildTestSf2,
  buildSimpleSf2,
  shdrRec,
  samples16,
  sineSamples,
  riff,
  infoList,
  list,
  chunk,
  phdrRec,
  instRec,
  bag,
  gen,
  modTerminal,
} from './sf2fixture';

describe('unit conversions', () => {
  it('converts timecents to seconds', () => {
    expect(timecentsToSeconds(0)).toBe(1);
    expect(timecentsToSeconds(-1200)).toBeCloseTo(0.5, 12);
    expect(timecentsToSeconds(1200)).toBeCloseTo(2, 12);
    expect(timecentsToSeconds(-32768)).toBe(0);
  });

  it('converts centibels to linear gain', () => {
    expect(centibelsToGain(0)).toBe(1);
    expect(centibelsToGain(200)).toBeCloseTo(0.1, 12);
    expect(centibelsToGain(60)).toBeCloseTo(Math.pow(10, -0.3), 12);
  });

  it('converts absolute cents to Hz anchored at 8.176', () => {
    expect(absoluteCentsToHz(0)).toBeCloseTo(8.176, 9);
    // 6900 cents above key 0 is key 69, which should land near 440 Hz
    expect(absoluteCentsToHz(6900)).toBeCloseTo(440, 0);
  });
});

describe('SoundFont.parse', () => {
  const sf = SoundFont.parse(buildTestSf2());

  it('reads INFO name and version', () => {
    expect(sf.name).toBe('Bellows Test');
    expect(sf.version).toEqual({ major: 2, minor: 4 });
  });

  it('lists presets without the terminal record', () => {
    expect(sf.presets).toHaveLength(1);
    expect(sf.presets[0]).toEqual({ index: 0, name: 'TestPreset', bank: 0, program: 0 });
  });

  it('finds presets by bank and program', () => {
    expect(sf.getPreset(0, 0)?.name).toBe('TestPreset');
    expect(sf.getPreset(1, 0)).toBeUndefined();
    expect(sf.getPreset(0, 5)).toBeUndefined();
  });

  it('lists sample headers without the terminal record', () => {
    expect(sf.samples).toHaveLength(1);
    const h = sf.samples[0];
    expect(h.name).toBe('Sine');
    expect(h.start).toBe(0);
    expect(h.end).toBe(64);
    expect(h.loopStart).toBe(8);
    expect(h.loopEnd).toBe(56);
    expect(h.sampleRate).toBe(44100);
    expect(h.originalPitch).toBe(69);
    expect(h.sampleType).toBe(1);
  });

  it('parses modulator chunks (terminal records only here)', () => {
    expect(sf.presetModulators).toHaveLength(0);
    expect(sf.instrumentModulators).toHaveLength(0);
  });
});

describe('zone resolution', () => {
  const sf = SoundFont.parse(buildTestSf2());

  it('selects zone A for a low key', () => {
    const zones = sf.zonesFor(0, 40, 100);
    expect(zones).toHaveLength(1);
    const z = zones[0];
    expect(z.keyLo).toBe(0);
    expect(z.keyHi).toBe(60);
    expect(z.velLo).toBe(0);
    expect(z.velHi).toBe(127);
    expect(z.sampleIndex).toBe(0);
    expect(z.sample.name).toBe('Sine');
  });

  it('applies overridingRootKey in zone A', () => {
    const z = sf.zonesFor(0, 40, 100)[0];
    expect(z.rootKey).toBe(60);
  });

  it('falls back to the sample original pitch in zone B', () => {
    const z = sf.zonesFor(0, 80, 100)[0];
    expect(z.rootKey).toBe(69);
  });

  it('converts envelope timecents, local over instrument-global', () => {
    const a = sf.zonesFor(0, 40, 100)[0];
    // local attackVolEnv -1200 tc = 0.5 s
    expect(a.volEnv.attack).toBeCloseTo(0.5, 9);
    // instrument global releaseVolEnv -3600 tc = 0.125 s
    expect(a.volEnv.release).toBeCloseTo(0.125, 9);
    // untouched phases sit at the -12000 tc default
    expect(a.volEnv.delay).toBeCloseTo(Math.pow(2, -10), 12);
    expect(a.volEnv.hold).toBeCloseTo(Math.pow(2, -10), 12);
    expect(a.volEnv.decay).toBeCloseTo(Math.pow(2, -10), 12);
    // sustain default 0 cB = full level
    expect(a.volEnv.sustain).toBe(1);
  });

  it('adds preset generators to instrument values', () => {
    const a = sf.zonesFor(0, 40, 100)[0];
    // preset global initialAttenuation 100 cB onto the instrument default 0
    expect(a.attenuation).toBeCloseTo(Math.pow(10, -0.5), 9);
    // preset local fineTune 25 onto the instrument default 0
    expect(a.fineTune).toBe(25);
    const b = sf.zonesFor(0, 80, 100)[0];
    // zone B has instrument coarseTune 2, preset adds nothing
    expect(b.coarseTune).toBe(2);
    expect(b.fineTune).toBe(25);
  });

  it('reads pan from the instrument global zone', () => {
    const a = sf.zonesFor(0, 40, 100)[0];
    expect(a.pan).toBeCloseTo(0.5, 9);
  });

  it('applies loop point offset generators relative to sampleData', () => {
    const a = sf.zonesFor(0, 40, 100)[0];
    expect(a.start).toBe(0);
    expect(a.end).toBe(64);
    expect(a.loopStart).toBe(10); // 8 + 2
    expect(a.loopEnd).toBe(54); // 56 - 2
    expect(a.sampleModes).toBe(1);
  });

  it('leaves sample-only generators alone in zone B', () => {
    const b = sf.zonesFor(0, 80, 100)[0];
    expect(b.sampleModes).toBe(0);
    expect(b.loopStart).toBe(8);
    expect(b.loopEnd).toBe(56);
    expect(b.exclusiveClass).toBe(0);
  });

  it('uses spec defaults for filter and scale tuning', () => {
    const a = sf.zonesFor(0, 40, 100)[0];
    expect(a.scaleTuning).toBe(100);
    expect(a.filterQ).toBe(0);
    // default 13500 absolute cents is roughly 19.9 kHz
    expect(a.filterFc).toBeGreaterThan(19000);
    expect(a.filterFc).toBeLessThan(21000);
  });

  it('filters zones by velocity range', () => {
    // zone B allows velocities up to 100; zone A does not cover key 80
    expect(sf.zonesFor(0, 80, 100)).toHaveLength(1);
    expect(sf.zonesFor(0, 80, 101)).toHaveLength(0);
    const b = sf.zonesFor(0, 80, 50)[0];
    expect(b.velHi).toBe(100);
  });

  it('splits zones exactly at the key boundary', () => {
    expect(sf.zonesFor(0, 60, 64)[0].rootKey).toBe(60);
    expect(sf.zonesFor(0, 61, 64)[0].rootKey).toBe(69);
  });

  it('is deterministic across calls', () => {
    expect(sf.zonesFor(0, 40, 100)).toEqual(sf.zonesFor(0, 40, 100));
  });

  it('rejects a preset index out of range', () => {
    expect(() => sf.zonesFor(1, 60, 100)).toThrow(/preset index/);
    expect(() => sf.zonesFor(-1, 60, 100)).toThrow(/preset index/);
  });
});

describe('generators after the terminal generator', () => {
  /*
   * One preset zone whose generator list continues past the instrument
   * generator (fineTune 30 after instrument 0), and one instrument zone
   * that continues past sampleID (coarseTune 5 after sampleID 0). SF2.04
   * section 7 says everything after the terminal generator is ignored.
   */
  function buildTrailingGenSf2(): ArrayBuffer {
    const phdr = [...phdrRec('P', 0, 0, 0), ...phdrRec('EOP', 0, 0, 1)];
    const pbag = [...bag(0, 0), ...bag(2, 0)];
    const pgen = [
      ...gen(41, 0), // instrument 0 (zone terminator)
      ...gen(52, 30), // fineTune after the terminator: must be ignored
      ...gen(0, 0), // terminal record
    ];
    const inst = [...instRec('I', 0), ...instRec('EOI', 1)];
    const ibag = [...bag(0, 0), ...bag(2, 0)];
    const igen = [
      ...gen(53, 0), // sampleID (zone terminator)
      ...gen(51, 5), // coarseTune after the terminator: must be ignored
      ...gen(0, 0), // terminal record
    ];
    const shdr = [
      ...shdrRec('S', 0, 64, 8, 56, 44100, 60, 0, 0, 1),
      ...shdrRec('EOS', 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ];
    return riff('sfbk', [
      ...infoList('Trailing'),
      ...list('sdta', chunk('smpl', samples16(sineSamples(64)))),
      ...list('pdta', [
        ...chunk('phdr', phdr),
        ...chunk('pbag', pbag),
        ...chunk('pmod', modTerminal()),
        ...chunk('pgen', pgen),
        ...chunk('inst', inst),
        ...chunk('ibag', ibag),
        ...chunk('imod', modTerminal()),
        ...chunk('igen', igen),
        ...chunk('shdr', shdr),
      ]),
    ]);
  }

  it('ignores generators that appear after sampleID or instrument', () => {
    const sf = SoundFont.parse(buildTrailingGenSf2());
    const zones = sf.zonesFor(0, 60, 100);
    expect(zones).toHaveLength(1);
    const z = zones[0];
    expect(z.coarseTune).toBe(0);
    expect(z.fineTune).toBe(0);
  });
});

describe('sampleData', () => {
  it('decodes 16-bit samples to floats', () => {
    const sf = SoundFont.parse(buildTestSf2());
    const data = sf.sampleData(0);
    expect(data).toHaveLength(64);
    const expected = sineSamples(64);
    for (let i = 0; i < 64; i++) {
      expect(data[i]).toBeCloseTo(expected[i] / 32768, 6);
    }
    // one sine cycle rises through zero once and falls through once
    let crossings = 0;
    for (let i = 1; i < 64; i++) {
      if (data[i - 1] < 0 !== data[i] < 0) crossings++;
    }
    expect(crossings).toBe(1); // data[0] is exactly zero, one sign flip at midpoint
  });

  it('caches decoded samples', () => {
    const sf = SoundFont.parse(buildTestSf2());
    expect(sf.sampleData(0)).toBe(sf.sampleData(0));
  });

  it('decodes 24-bit samples when sm24 is present', () => {
    const buf = buildSimpleSf2({
      shdrs: [shdrRec('S', 0, 4, 0, 4, 44100, 60, 0, 0, 1)],
      smpl: samples16([16384, -16384, 1000, 0]),
      sm24: [0x80, 0x00, 0xff, 0x01],
    });
    const sf = SoundFont.parse(buf);
    const data = sf.sampleData(0);
    expect(data[0]).toBeCloseTo((16384 * 256 + 0x80) / 8388608, 9);
    expect(data[1]).toBeCloseTo(-0.5, 9);
    expect(data[2]).toBeCloseTo((1000 * 256 + 0xff) / 8388608, 9);
    expect(data[3]).toBeCloseTo(1 / 8388608, 9);
  });

  it('rejects a sample index out of range', () => {
    const sf = SoundFont.parse(buildTestSf2());
    expect(() => sf.sampleData(1)).toThrow(/sample index/);
  });

  it('rejects a sample lying outside the smpl chunk', () => {
    const buf = buildSimpleSf2({
      shdrs: [shdrRec('S', 0, 999, 0, 4, 44100, 60, 0, 0, 1)],
      smpl: samples16([1, 2, 3, 4]),
    });
    expect(() => SoundFont.parse(buf).sampleData(0)).toThrow(/outside the smpl chunk/);
  });
});

describe('stereo sample links', () => {
  const buf = buildSimpleSf2({
    shdrs: [
      shdrRec('L', 0, 32, 4, 28, 44100, 60, 0, 1, 4),
      shdrRec('R', 32, 64, 36, 60, 44100, 60, 0, 0, 2),
    ],
    smpl: samples16(sineSamples(64)),
  });
  const sf = SoundFont.parse(buf);

  it('resolves the linked sample index for left/right pairs', () => {
    const z = sf.zonesFor(0, 60, 100)[0];
    expect(z.sampleIndex).toBe(0);
    expect(z.sample.sampleType).toBe(4);
    expect(z.linkedSampleIndex).toBe(1);
    expect(sf.samples[1].sampleType).toBe(2);
    expect(sf.samples[1].sampleLink).toBe(0);
  });

  it('decodes each half of the pair independently', () => {
    expect(sf.sampleData(0)).toHaveLength(32);
    expect(sf.sampleData(1)).toHaveLength(32);
  });
});

describe('malformed files', () => {
  it('rejects non-RIFF data', () => {
    expect(() => SoundFont.parse(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(/RIFF/);
    const junk = new Uint8Array(32).fill(0x41);
    expect(() => SoundFont.parse(junk.buffer)).toThrow(/RIFF/);
  });

  it('rejects a RIFF file that is not sfbk', () => {
    expect(() => SoundFont.parse(riff('WAVE', []))).toThrow(/sfbk/);
  });

  it('rejects a file with no pdta list', () => {
    expect(() => SoundFont.parse(riff('sfbk', infoList('X')))).toThrow(/pdta/);
  });

  it('rejects a file with no INFO list', () => {
    const buf = riff('sfbk', list('pdta', chunk('phdr', phdrRec('EOP', 0, 0, 0))));
    expect(() => SoundFont.parse(buf)).toThrow(/INFO/);
  });

  it('rejects a phdr chunk with a bad record size', () => {
    const buf = riff('sfbk', [
      ...infoList('X'),
      ...list('pdta', chunk('phdr', phdrRec('EOP', 0, 0, 0).slice(0, 37))),
    ]);
    expect(() => SoundFont.parse(buf)).toThrow(/phdr/);
  });

  it('rejects a chunk that overruns its parent', () => {
    const body = chunk('junk', [0, 0]);
    // lie about the sub-chunk size
    body[4] = 200;
    expect(() => SoundFont.parse(riff('sfbk', body))).toThrow(/overruns/);
  });
});
