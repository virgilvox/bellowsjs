/*
 * SoundFont 2 (.sf2) parser: RIFF container walk, INFO metadata, sample
 * data (16-bit smpl plus the optional sm24 extension for 24-bit), and
 * every pdta sub-chunk: phdr, pbag, pmod, pgen, inst, ibag, imod, igen,
 * shdr.
 *
 * Generator resolution follows SF2.04 section 9.4. An instrument zone
 * starts from spec default values, overridden by the instrument global
 * zone, overridden by the local zone. Preset zone generators (local
 * over preset global) are relative: they add to the instrument-level
 * value. Key and velocity ranges filter zones at both levels, and
 * generators that the spec forbids at preset level (sample offsets,
 * sampleModes, exclusiveClass, overridingRootKey) are read from the
 * instrument level only. Units convert at resolution time: timecents to
 * seconds, centibels to linear gain, absolute cents to Hz.
 *
 * Parsing and data modeling only. The sampler engine that plays
 * resolved zones lives elsewhere.
 */

import { clamp } from '../types';

/* Generator operator numbers from SF2.04 section 8.1.2. */
const enum Gen {
  StartAddrsOffset = 0,
  EndAddrsOffset = 1,
  StartloopAddrsOffset = 2,
  EndloopAddrsOffset = 3,
  StartAddrsCoarseOffset = 4,
  InitialFilterFc = 8,
  InitialFilterQ = 9,
  EndAddrsCoarseOffset = 12,
  Pan = 17,
  DelayVolEnv = 33,
  AttackVolEnv = 34,
  HoldVolEnv = 35,
  DecayVolEnv = 36,
  SustainVolEnv = 37,
  ReleaseVolEnv = 38,
  Instrument = 41,
  KeyRange = 43,
  VelRange = 44,
  StartloopAddrsCoarseOffset = 45,
  InitialAttenuation = 48,
  EndloopAddrsCoarseOffset = 50,
  CoarseTune = 51,
  FineTune = 52,
  SampleID = 53,
  SampleModes = 54,
  ScaleTuning = 56,
  ExclusiveClass = 57,
  OverridingRootKey = 58,
}

/** Timecents to seconds: 2^(tc/1200). The sentinel -32768 means zero. */
export function timecentsToSeconds(tc: number): number {
  if (tc <= -32768) return 0;
  return Math.pow(2, tc / 1200);
}

/** Centibels of attenuation to linear gain: 10^(-cb/200). */
export function centibelsToGain(cb: number): number {
  return Math.pow(10, -cb / 200);
}

/** Absolute cents to Hz, where 0 cents is 8.176 Hz (MIDI key 0). */
export function absoluteCentsToHz(cents: number): number {
  return 8.176 * Math.pow(2, cents / 1200);
}

export interface PresetInfo {
  /** Index into the parse order, usable with zonesFor. */
  index: number;
  name: string;
  bank: number;
  program: number;
}

/** One shdr record. Frame positions are absolute indices into the smpl chunk. */
export interface SampleHeader {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  originalPitch: number;
  /** Signed cents. */
  pitchCorrection: number;
  sampleLink: number;
  /** 1 mono, 2 right, 4 left, 8 linked; 0x8000 flags ROM samples. */
  sampleType: number;
}

/** A raw pmod or imod record. Modulators are parsed but not interpreted. */
export interface Modulator {
  srcOper: number;
  destOper: number;
  amount: number;
  amtSrcOper: number;
  transOper: number;
}

export interface VolEnvelope {
  /** Seconds. */
  delay: number;
  /** Seconds. */
  attack: number;
  /** Seconds. */
  hold: number;
  /** Seconds. */
  decay: number;
  /** Linear level relative to peak, 0..1. */
  sustain: number;
  /** Seconds. */
  release: number;
}

/**
 * Everything a sampler needs to start a voice for one key/velocity hit.
 * Sample frame positions (start, end, loopStart, loopEnd) are relative
 * to the Float32Array returned by sampleData(sampleIndex), with all
 * address offset generators already applied.
 */
export interface ResolvedZone {
  sampleIndex: number;
  sample: SampleHeader;
  /** The other half of a stereo pair (sampleType 2/4), or null. */
  linkedSampleIndex: number | null;
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  /** MIDI key at which the sample plays back untransposed. */
  rootKey: number;
  /** Semitones. */
  coarseTune: number;
  /** Cents. */
  fineTune: number;
  /** Cents of pitch change per key, 100 is normal. */
  scaleTuning: number;
  /** 0 no loop, 1 continuous loop, 3 loop until release. */
  sampleModes: number;
  /** Nonzero: starting this zone cuts others with the same class. */
  exclusiveClass: number;
  /** Linear gain from initialAttenuation. */
  attenuation: number;
  /** -1 full left to 1 full right. */
  pan: number;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  volEnv: VolEnvelope;
  /** Lowpass cutoff in Hz. */
  filterFc: number;
  /** Resonance in dB above DC gain. */
  filterQ: number;
}

interface Chunk {
  id: string;
  offset: number;
  size: number;
}

function fourcc(view: DataView, pos: number): string {
  return String.fromCharCode(
    view.getUint8(pos),
    view.getUint8(pos + 1),
    view.getUint8(pos + 2),
    view.getUint8(pos + 3),
  );
}

/* Walk sibling chunks in [start, end). RIFF pads odd sizes to even. */
function readChunks(view: DataView, start: number, end: number): Chunk[] {
  const chunks: Chunk[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const id = fourcc(view, pos);
    const size = view.getUint32(pos + 4, true);
    if (pos + 8 + size > end) throw new Error(`sf2: chunk ${id} overruns its parent`);
    chunks.push({ id, offset: pos + 8, size });
    pos += 8 + size + (size & 1);
  }
  return chunks;
}

function readFixedString(view: DataView, offset: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

type GenMap = Map<number, number>;

interface Bag {
  genNdx: number;
  modNdx: number;
}

interface RawGen {
  op: number;
  /** Raw unsigned 16-bit amount; sign and range packing applied on read. */
  amount: number;
}

interface ZoneData {
  gens: GenMap;
}

interface ZoneList {
  global: GenMap;
  zones: ZoneData[];
}

/** Signed view of a generator amount, or undefined if absent. */
function sVal(m: GenMap, op: number): number | undefined {
  const v = m.get(op);
  return v === undefined ? undefined : v > 0x7fff ? v - 0x10000 : v;
}

/** Range generator as [lo, hi], defaulting to the full 0..127. */
function rangeOf(m: GenMap, op: number): [number, number] {
  const v = m.get(op);
  return v === undefined ? [0, 127] : [v & 0xff, (v >>> 8) & 0xff];
}

/** Local zone generators override the level's global zone. */
function mergeLevel(global: GenMap, local: GenMap): GenMap {
  const out = new Map(global);
  for (const [k, v] of local) out.set(k, v);
  return out;
}

/*
 * Split a bag range into a global zone plus terminal zones. A zone whose
 * generator list lacks the terminal operator (instrument at preset level,
 * sampleID at instrument level) is the global zone if it comes first,
 * and is ignored otherwise, per SF2.04 section 7.
 */
function buildZones(
  bags: Bag[],
  bagFrom: number,
  bagTo: number,
  gens: RawGen[],
  terminalOp: number,
  what: string,
): ZoneList {
  if (bagFrom > bagTo || bagTo >= bags.length) {
    throw new Error(`sf2: ${what} bag indices out of range`);
  }
  const global: GenMap = new Map();
  const zones: ZoneData[] = [];
  for (let z = bagFrom; z < bagTo; z++) {
    const from = bags[z].genNdx;
    const to = bags[z + 1].genNdx;
    if (from > to || to > gens.length) {
      throw new Error(`sf2: ${what} generator indices out of range`);
    }
    const m: GenMap = new Map();
    for (let g = from; g < to; g++) m.set(gens[g].op, gens[g].amount);
    if (m.has(terminalOp)) {
      zones.push({ gens: m });
    } else if (z === bagFrom && zones.length === 0) {
      for (const [k, v] of m) global.set(k, v);
    }
  }
  return { global, zones };
}

interface PresetData {
  info: PresetInfo;
  global: GenMap;
  zones: ZoneData[];
}

interface InstrumentData {
  name: string;
  global: GenMap;
  zones: ZoneData[];
}

export class SoundFont {
  /** Bank name from INAM, empty if absent. */
  readonly name: string;
  /** SoundFont format version from ifil. */
  readonly version: { major: number; minor: number };
  readonly presets: PresetInfo[];
  readonly samples: SampleHeader[];
  /** Raw preset (pmod) and instrument (imod) modulators, uninterpreted. */
  readonly presetModulators: Modulator[];
  readonly instrumentModulators: Modulator[];

  private readonly view: DataView;
  private readonly smpl: Chunk | null;
  private readonly sm24: Chunk | null;
  private readonly presetData: PresetData[];
  private readonly instrumentData: InstrumentData[];
  private readonly sampleCache = new Map<number, Float32Array>();

  static parse(buf: ArrayBuffer): SoundFont {
    return new SoundFont(buf);
  }

  private constructor(buf: ArrayBuffer) {
    const view = new DataView(buf);
    this.view = view;
    if (buf.byteLength < 12 || fourcc(view, 0) !== 'RIFF') {
      throw new Error('sf2: not a RIFF file');
    }
    if (fourcc(view, 8) !== 'sfbk') {
      throw new Error('sf2: RIFF form is not sfbk');
    }
    const end = Math.min(8 + view.getUint32(4, true), buf.byteLength);

    let info: Chunk[] | null = null;
    let sdta: Chunk[] | null = null;
    let pdta: Chunk[] | null = null;
    for (const c of readChunks(view, 12, end)) {
      if (c.id !== 'LIST' || c.size < 4) continue;
      const type = fourcc(view, c.offset);
      const sub = readChunks(view, c.offset + 4, c.offset + c.size);
      if (type === 'INFO') info = sub;
      else if (type === 'sdta') sdta = sub;
      else if (type === 'pdta') pdta = sub;
    }
    if (!info) throw new Error('sf2: missing INFO list');
    if (!pdta) throw new Error('sf2: missing pdta list');
    const pdtaChunks = pdta;

    const ifil = info.find((c) => c.id === 'ifil');
    if (!ifil || ifil.size !== 4) throw new Error('sf2: missing or malformed ifil version chunk');
    this.version = {
      major: view.getUint16(ifil.offset, true),
      minor: view.getUint16(ifil.offset + 2, true),
    };
    const inam = info.find((c) => c.id === 'INAM');
    this.name = inam ? readFixedString(view, inam.offset, inam.size) : '';

    this.smpl = sdta ? (sdta.find((c) => c.id === 'smpl') ?? null) : null;
    this.sm24 = sdta ? (sdta.find((c) => c.id === 'sm24') ?? null) : null;

    /* Each pdta sub-chunk holds fixed-size records ending in a terminal record. */
    const need = (id: string, recSize: number): Chunk => {
      const c = pdtaChunks.find((x) => x.id === id);
      if (!c) throw new Error(`sf2: missing pdta ${id} chunk`);
      if (c.size % recSize !== 0 || c.size < recSize) {
        throw new Error(`sf2: ${id} chunk size ${c.size} is not a positive multiple of ${recSize}`);
      }
      return c;
    };

    const phdrC = need('phdr', 38);
    const pbagC = need('pbag', 4);
    const pmodC = need('pmod', 10);
    const pgenC = need('pgen', 4);
    const instC = need('inst', 22);
    const ibagC = need('ibag', 4);
    const imodC = need('imod', 10);
    const igenC = need('igen', 4);
    const shdrC = need('shdr', 46);

    const readBags = (c: Chunk): Bag[] => {
      const n = c.size / 4;
      const out = new Array<Bag>(n);
      for (let i = 0; i < n; i++) {
        const o = c.offset + i * 4;
        out[i] = { genNdx: view.getUint16(o, true), modNdx: view.getUint16(o + 2, true) };
      }
      return out;
    };
    const readGens = (c: Chunk): RawGen[] => {
      const n = c.size / 4;
      const out = new Array<RawGen>(n);
      for (let i = 0; i < n; i++) {
        const o = c.offset + i * 4;
        out[i] = { op: view.getUint16(o, true), amount: view.getUint16(o + 2, true) };
      }
      return out;
    };
    const readMods = (c: Chunk): Modulator[] => {
      /* The final record is the terminal record; drop it. */
      const n = c.size / 10 - 1;
      const out = new Array<Modulator>(n);
      for (let i = 0; i < n; i++) {
        const o = c.offset + i * 10;
        out[i] = {
          srcOper: view.getUint16(o, true),
          destOper: view.getUint16(o + 2, true),
          amount: view.getInt16(o + 4, true),
          amtSrcOper: view.getUint16(o + 6, true),
          transOper: view.getUint16(o + 8, true),
        };
      }
      return out;
    };

    const pbags = readBags(pbagC);
    const pgens = readGens(pgenC);
    const ibags = readBags(ibagC);
    const igens = readGens(igenC);
    this.presetModulators = readMods(pmodC);
    this.instrumentModulators = readMods(imodC);

    /* Sample headers, minus the EOS terminal record. */
    const sampleCount = shdrC.size / 46 - 1;
    this.samples = new Array<SampleHeader>(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const o = shdrC.offset + i * 46;
      this.samples[i] = {
        name: readFixedString(view, o, 20),
        start: view.getUint32(o + 20, true),
        end: view.getUint32(o + 24, true),
        loopStart: view.getUint32(o + 28, true),
        loopEnd: view.getUint32(o + 32, true),
        sampleRate: view.getUint32(o + 36, true),
        originalPitch: view.getUint8(o + 40),
        pitchCorrection: view.getInt8(o + 41),
        sampleLink: view.getUint16(o + 42, true),
        sampleType: view.getUint16(o + 44, true),
      };
    }

    /* Instruments, minus the EOI terminal record. */
    const instCount = instC.size / 22 - 1;
    this.instrumentData = new Array<InstrumentData>(instCount);
    for (let i = 0; i < instCount; i++) {
      const o = instC.offset + i * 22;
      const name = readFixedString(view, o, 20);
      const bagFrom = view.getUint16(o + 20, true);
      const bagTo = view.getUint16(o + 22 + 20, true);
      const { global, zones } = buildZones(ibags, bagFrom, bagTo, igens, Gen.SampleID, 'instrument');
      this.instrumentData[i] = { name, global, zones };
    }

    /* Presets, minus the EOP terminal record. */
    const presetCount = phdrC.size / 38 - 1;
    this.presetData = new Array<PresetData>(presetCount);
    this.presets = new Array<PresetInfo>(presetCount);
    for (let i = 0; i < presetCount; i++) {
      const o = phdrC.offset + i * 38;
      const infoRec: PresetInfo = {
        index: i,
        name: readFixedString(view, o, 20),
        program: view.getUint16(o + 20, true),
        bank: view.getUint16(o + 22, true),
      };
      const bagFrom = view.getUint16(o + 24, true);
      const bagTo = view.getUint16(o + 38 + 24, true);
      const { global, zones } = buildZones(pbags, bagFrom, bagTo, pgens, Gen.Instrument, 'preset');
      this.presetData[i] = { info: infoRec, global, zones };
      this.presets[i] = infoRec;
    }
  }

  getPreset(bank: number, program: number): PresetInfo | undefined {
    return this.presets.find((p) => p.bank === bank && p.program === program);
  }

  /**
   * Resolve every zone that sounds for one key/velocity hit on a preset.
   * A note usually returns one zone, or two for stereo splits and
   * crossfaded layers.
   */
  zonesFor(presetIndex: number, key: number, vel: number): ResolvedZone[] {
    const p = this.presetData[presetIndex];
    if (!p) throw new Error(`sf2: preset index ${presetIndex} out of range`);
    const out: ResolvedZone[] = [];
    for (const pz of p.zones) {
      const pg = mergeLevel(p.global, pz.gens);
      const [pkLo, pkHi] = rangeOf(pg, Gen.KeyRange);
      if (key < pkLo || key > pkHi) continue;
      const [pvLo, pvHi] = rangeOf(pg, Gen.VelRange);
      if (vel < pvLo || vel > pvHi) continue;
      const instIdx = pg.get(Gen.Instrument)!;
      const inst = this.instrumentData[instIdx];
      if (!inst) throw new Error(`sf2: preset references missing instrument ${instIdx}`);
      for (const iz of inst.zones) {
        const ig = mergeLevel(inst.global, iz.gens);
        const [ikLo, ikHi] = rangeOf(ig, Gen.KeyRange);
        if (key < ikLo || key > ikHi) continue;
        const [ivLo, ivHi] = rangeOf(ig, Gen.VelRange);
        if (vel < ivLo || vel > ivHi) continue;
        const sampleIdx = ig.get(Gen.SampleID)!;
        const sample = this.samples[sampleIdx];
        if (!sample) throw new Error(`sf2: zone references missing sample ${sampleIdx}`);
        out.push(
          this.resolveZone(
            ig,
            pg,
            sampleIdx,
            sample,
            Math.max(pkLo, ikLo),
            Math.min(pkHi, ikHi),
            Math.max(pvLo, ivLo),
            Math.min(pvHi, ivHi),
          ),
        );
      }
    }
    return out;
  }

  private resolveZone(
    ig: GenMap,
    pg: GenMap,
    sampleIndex: number,
    sample: SampleHeader,
    keyLo: number,
    keyHi: number,
    velLo: number,
    velHi: number,
  ): ResolvedZone {
    /* Instrument value (or default) plus the relative preset value. */
    const add = (op: Gen, def: number): number => (sVal(ig, op) ?? def) + (sVal(pg, op) ?? 0);
    /* Generators the spec forbids at preset level read the instrument only. */
    const instS = (op: Gen, def: number): number => sVal(ig, op) ?? def;
    const instU = (op: Gen, def: number): number => ig.get(op) ?? def;

    const rootOverride = instS(Gen.OverridingRootKey, -1);
    const origPitch = sample.originalPitch > 127 ? 60 : sample.originalPitch;
    const rootKey = rootOverride >= 0 ? rootOverride : origPitch;

    const length = sample.end - sample.start;
    const start = instS(Gen.StartAddrsOffset, 0) + 32768 * instS(Gen.StartAddrsCoarseOffset, 0);
    const endFrame = length + instS(Gen.EndAddrsOffset, 0) + 32768 * instS(Gen.EndAddrsCoarseOffset, 0);
    const loopStart =
      sample.loopStart - sample.start +
      instS(Gen.StartloopAddrsOffset, 0) +
      32768 * instS(Gen.StartloopAddrsCoarseOffset, 0);
    const loopEnd =
      sample.loopEnd - sample.start +
      instS(Gen.EndloopAddrsOffset, 0) +
      32768 * instS(Gen.EndloopAddrsCoarseOffset, 0);

    const linkType = sample.sampleType & 0x7fff;
    const linkedSampleIndex =
      (linkType === 2 || linkType === 4 || linkType === 8) && sample.sampleLink < this.samples.length
        ? sample.sampleLink
        : null;

    return {
      sampleIndex,
      sample,
      linkedSampleIndex,
      keyLo,
      keyHi,
      velLo,
      velHi,
      rootKey,
      coarseTune: clamp(add(Gen.CoarseTune, 0), -120, 120),
      fineTune: clamp(add(Gen.FineTune, 0), -99, 99),
      scaleTuning: add(Gen.ScaleTuning, 100),
      sampleModes: instU(Gen.SampleModes, 0) & 3,
      exclusiveClass: instU(Gen.ExclusiveClass, 0),
      attenuation: centibelsToGain(clamp(add(Gen.InitialAttenuation, 0), 0, 1440)),
      pan: clamp(add(Gen.Pan, 0), -500, 500) / 500,
      start,
      end: endFrame,
      loopStart,
      loopEnd,
      volEnv: {
        delay: timecentsToSeconds(add(Gen.DelayVolEnv, -12000)),
        attack: timecentsToSeconds(add(Gen.AttackVolEnv, -12000)),
        hold: timecentsToSeconds(add(Gen.HoldVolEnv, -12000)),
        decay: timecentsToSeconds(add(Gen.DecayVolEnv, -12000)),
        sustain: centibelsToGain(clamp(add(Gen.SustainVolEnv, 0), 0, 1440)),
        release: timecentsToSeconds(add(Gen.ReleaseVolEnv, -12000)),
      },
      filterFc: absoluteCentsToHz(clamp(add(Gen.InitialFilterFc, 13500), 1500, 13500)),
      filterQ: clamp(add(Gen.InitialFilterQ, 0), 0, 960) / 10,
    };
  }

  /**
   * Decode one sample's frames to Float32Array in [-1, 1). Uses the
   * sm24 low bytes when present, otherwise plain 16-bit. Results are
   * cached per sample index.
   */
  sampleData(sampleIndex: number): Float32Array {
    const cached = this.sampleCache.get(sampleIndex);
    if (cached) return cached;
    const h = this.samples[sampleIndex];
    if (!h) throw new Error(`sf2: sample index ${sampleIndex} out of range`);
    if (h.sampleType & 0x8000) throw new Error(`sf2: ROM sample "${h.name}" carries no data`);
    if (!this.smpl) throw new Error('sf2: file has no smpl chunk');
    const n = h.end - h.start;
    if (n < 0 || h.end * 2 > this.smpl.size) {
      throw new Error(`sf2: sample "${h.name}" lies outside the smpl chunk`);
    }
    const view = this.view;
    const base = this.smpl.offset + h.start * 2;
    const out = new Float32Array(n);
    const sm24 = this.sm24 && this.sm24.size >= h.end ? this.sm24 : null;
    if (sm24) {
      const lowBase = sm24.offset + h.start;
      for (let i = 0; i < n; i++) {
        const hi = view.getInt16(base + i * 2, true);
        out[i] = (hi * 256 + view.getUint8(lowBase + i)) / 8388608;
      }
    } else {
      for (let i = 0; i < n; i++) {
        out[i] = view.getInt16(base + i * 2, true) / 32768;
      }
    }
    this.sampleCache.set(sampleIndex, out);
    return out;
  }
}
