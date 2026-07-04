/*
 * Bridges from the soundfont parsers (src/io/sf2.ts, src/io/sfz.ts) to
 * the sampler engine's SamplerBank.
 *
 * samplerBankFromSf2 enumerates every distinct resolved zone of one
 * preset by probing zonesFor across the key/velocity grid (stepping
 * velocity by range boundaries so the probe stays cheap), then maps
 * generators onto SampleZone fields: attenuation to gainDb, the
 * timecents-derived envelope seconds straight through, sampleModes to
 * loopMode, root key overrides, coarse/fine tune plus the sample's
 * pitch correction into fineTune cents, and pan. Stereo pairs (left
 * sample linked to a right sample) collapse into one stereo zone.
 *
 * samplerBankFromSfz maps resolved SfzRegions, loading each distinct
 * sample path once through the caller's loader. seq_length/seq_position
 * round robins become roundRobinGroup cycles keyed by the region's
 * key/velocity range.
 */

import type { ResolvedZone, SoundFont } from '../io/sf2';
import type { SfzEnvelope, SfzRegion } from '../io/sfz';
import { clamp, gainToDb } from '../types';
import { SamplerBank, type SampleZone } from './sampler';

function loopModeFromSf2(sampleModes: number): SampleZone['loopMode'] {
  if (sampleModes === 1) return 'loop';
  if (sampleModes === 3) return 'loopRelease';
  return 'none';
}

/** Identity of a resolved zone, so per-key probing deduplicates. */
function zoneId(z: ResolvedZone): string {
  return [
    z.sampleIndex,
    z.keyLo,
    z.keyHi,
    z.velLo,
    z.velHi,
    z.rootKey,
    z.coarseTune,
    z.fineTune,
    z.sampleModes,
    z.attenuation,
    z.pan,
    z.start,
    z.end,
    z.loopStart,
    z.loopEnd,
    z.volEnv.attack,
    z.volEnv.hold,
    z.volEnv.decay,
    z.volEnv.sustain,
    z.volEnv.release,
  ].join('|');
}

function sampleZoneFromResolved(sf: SoundFont, z: ResolvedZone): SampleZone {
  const full = sf.sampleData(z.sampleIndex);
  const start = clamp(z.start, 0, full.length);
  const end = clamp(z.end, start, full.length);
  const data = full.subarray(start, end);

  let dataR: Float32Array | undefined;
  if ((z.sample.sampleType & 0x7fff) === 4 && z.linkedSampleIndex !== null) {
    const fullR = sf.sampleData(z.linkedSampleIndex);
    dataR = fullR.subarray(Math.min(start, fullR.length), Math.min(end, fullR.length));
  }

  const loopMode = loopModeFromSf2(z.sampleModes);
  const loopStart = z.loopStart - start;
  const loopEnd = z.loopEnd - start;
  const loopValid = loopMode !== 'none' && loopStart >= 0 && loopEnd > loopStart + 1 && loopEnd <= data.length;

  return {
    data,
    dataR,
    sampleRate: z.sample.sampleRate,
    rootKey: z.rootKey,
    fineTune: z.fineTune + z.coarseTune * 100 + z.sample.pitchCorrection,
    keyLo: z.keyLo,
    keyHi: z.keyHi,
    velLo: z.velLo,
    velHi: z.velHi,
    loopStart: loopValid ? loopStart : undefined,
    loopEnd: loopValid ? loopEnd : undefined,
    loopMode: loopValid ? loopMode : 'none',
    gainDb: gainToDb(z.attenuation),
    pan: z.pan,
    env: {
      attack: z.volEnv.attack,
      hold: z.volEnv.hold,
      decay: z.volEnv.decay,
      sustain: z.volEnv.sustain,
      release: z.volEnv.release,
    },
  };
}

/**
 * Build a SamplerBank for one preset of a parsed SoundFont. Throws when
 * the bank/program pair does not exist. The volume envelope delay stage
 * is dropped (its default is under a millisecond); modulators and the
 * per-zone lowpass (filterFc/filterQ) are not interpreted.
 */
export function samplerBankFromSf2(sf: SoundFont, bank: number, program: number): SamplerBank {
  const preset = sf.getPreset(bank, program);
  if (!preset) {
    throw new Error(`soundfont: no preset at bank ${bank} program ${program}`);
  }

  const seen = new Set<string>();
  const resolved: ResolvedZone[] = [];
  for (let key = 0; key < 128; key++) {
    let vel = 0;
    while (vel < 128) {
      const zones = sf.zonesFor(preset.index, key, vel);
      if (zones.length === 0) {
        vel++;
        continue;
      }
      /* Jump to the earliest range end so every velocity split is hit. */
      let minHi = 127;
      for (const z of zones) {
        const id = zoneId(z);
        if (!seen.has(id)) {
          seen.add(id);
          resolved.push(z);
        }
        if (z.velHi < minHi) minHi = z.velHi;
      }
      vel = Math.max(minHi + 1, vel + 1);
    }
  }

  /* Right samples consumed by a left zone's stereo pairing get skipped. */
  const consumedRight = new Set<number>();
  for (const z of resolved) {
    if ((z.sample.sampleType & 0x7fff) === 4 && z.linkedSampleIndex !== null) {
      consumedRight.add(z.linkedSampleIndex);
    }
  }

  const out = new SamplerBank();
  for (const z of resolved) {
    if ((z.sample.sampleType & 0x7fff) === 2 && consumedRight.has(z.sampleIndex)) continue;
    out.addZone(sampleZoneFromResolved(sf, z));
  }
  return out;
}

export interface LoadedSample {
  data: Float32Array;
  sampleRate: number;
}

export type SampleLoader = (path: string) => LoadedSample | Promise<LoadedSample>;

const SFZ_AMPEG_DEFAULTS: SfzEnvelope = {
  delay: 0,
  attack: 0,
  hold: 0,
  decay: 0,
  sustain: 100,
  release: 0,
};

/** An untouched ampeg means the engine's own envelope defaults apply. */
function isDefaultAmpeg(e: SfzEnvelope): boolean {
  const d = SFZ_AMPEG_DEFAULTS;
  return (
    e.delay === d.delay &&
    e.attack === d.attack &&
    e.hold === d.hold &&
    e.decay === d.decay &&
    e.sustain === d.sustain &&
    e.release === d.release
  );
}

function loopModeFromSfz(
  r: SfzRegion,
  hasLoopPoints: boolean,
): SampleZone['loopMode'] {
  switch (r.loopMode) {
    case 'loop_continuous':
      return 'loop';
    case 'loop_sustain':
      return 'loopRelease';
    case 'no_loop':
    case 'one_shot':
      return 'none';
    default:
      /* Unspecified: loop when the region carries loop points. */
      return hasLoopPoints ? 'loop' : 'none';
  }
}

/**
 * Build a SamplerBank from resolved SFZ regions. The loader maps a
 * region sample path to audio; each distinct path loads once. Honors
 * key/velocity ranges, pitch_keycenter, tune, transpose, volume, pan,
 * ampeg envelopes (sustain percent converts to linear; the delay stage
 * is dropped), offset, loop opcodes (loop_end is inclusive in SFZ and
 * converts to the exclusive convention), and seq_length/seq_position
 * round robins. amp_veltrack stays an engine-level param; lorand/hirand
 * and keyswitches are not interpreted.
 */
export async function samplerBankFromSfz(
  regions: readonly SfzRegion[],
  sampleLoader: SampleLoader,
): Promise<SamplerBank> {
  const bank = new SamplerBank();
  const cache = new Map<string, LoadedSample>();
  const rrGroups = new Map<string, number>();
  let nextGroup = 1;

  for (const r of regions) {
    let loaded = cache.get(r.sample);
    if (!loaded) {
      loaded = await sampleLoader(r.sample);
      cache.set(r.sample, loaded);
    }

    const offset = Math.max(0, Math.floor(r.offset));
    const data = offset > 0 ? loaded.data.subarray(offset) : loaded.data;

    const hasLoopPoints = r.loopStart !== null && r.loopEnd !== null;
    const loopMode = loopModeFromSfz(r, hasLoopPoints);
    let loopStart: number | undefined;
    let loopEnd: number | undefined;
    if (loopMode !== 'none' && hasLoopPoints) {
      loopStart = r.loopStart! - offset;
      loopEnd = r.loopEnd! + 1 - offset;
    }

    let roundRobinGroup: number | undefined;
    let seqPosition: number | undefined;
    if (r.seqLength > 1) {
      const key = `${r.lokey}|${r.hikey}|${r.lovel}|${r.hivel}|${r.seqLength}`;
      let g = rrGroups.get(key);
      if (g === undefined) {
        g = nextGroup++;
        rrGroups.set(key, g);
      }
      roundRobinGroup = g;
      seqPosition = r.seqPosition;
    }

    bank.addZone({
      data,
      sampleRate: loaded.sampleRate,
      rootKey: r.pitchKeycenter,
      fineTune: r.tune + r.transpose * 100,
      keyLo: r.lokey,
      keyHi: r.hikey,
      velLo: r.lovel,
      velHi: r.hivel,
      loopStart,
      loopEnd,
      loopMode,
      gainDb: r.volume,
      pan: clamp(r.pan / 100, -1, 1),
      env: isDefaultAmpeg(r.ampeg)
        ? undefined
        : {
            attack: r.ampeg.attack,
            hold: r.ampeg.hold,
            decay: r.ampeg.decay,
            sustain: clamp(r.ampeg.sustain / 100, 0, 1),
            release: r.ampeg.release,
          },
      roundRobinGroup,
      seqPosition,
    });
  }
  return bank;
}
