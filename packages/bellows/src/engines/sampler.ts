/*
 * Sample playback engine. A SamplerBank maps key/velocity space onto
 * SampleZones (raw audio plus mapping metadata); makeSamplerEngine wraps
 * a bank in the EngineDef/Voice contract.
 *
 * Playback details:
 *   - Pitch tracks the noteOn frequency: the played key comes back
 *     through ftom and the playback rate is the semitone distance from
 *     the zone root (plus fineTune cents), scaled by the ratio of the
 *     zone's sample rate to the output rate.
 *   - Reads are 4-point Catmull-Rom with edge clamping.
 *   - Loops crossfade equal power over the loopXfade window: near the
 *     loop end the read blends with the material just before the loop
 *     start, so the seam lands exactly on loopStart at full weight.
 *     The window is clamped to the frames available before loopStart.
 *   - The amp envelope comes from the zone (AHDSR) or from the engine
 *     attack/decay/sustain/release params when the zone has none. Hold
 *     freezes the Adsr at peak for the hold time (the Adsr class has no
 *     hold stage of its own).
 *   - Velocity maps to gain with amp_veltrack semantics:
 *     gain = 1 - (veltrack/100) * (1 - vel^2).
 *   - Round robin cycles through zones that share a roundRobinGroup,
 *     ordered by seqPosition. The counter is shared per engine instance
 *     so successive notes cycle across pooled voices.
 *
 * Nothing here is stochastic and nothing allocates on the audio path:
 * zone lookup allocates small arrays at note-on rate only.
 */

import type { EngineDef, ParamSpec, Voice } from '../types';
import { clamp, dbToGain, ftom } from '../types';
import { Adsr } from '../dsp/envelopes';

/** Zone amplitude envelope, times in seconds, sustain 0..1 linear. */
export interface SampleZoneEnv {
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SampleZone {
  /** Mono data, or the left channel of a stereo zone. */
  data: Float32Array;
  /** Right channel; present makes the zone stereo. */
  dataR?: Float32Array;
  /** Sample rate the data was recorded at. */
  sampleRate: number;
  /** MIDI key at which the data plays back at rate sampleRate/outputRate. */
  rootKey: number;
  /** Cents added to the played pitch, positive plays sharper (SF2 sign). */
  fineTune?: number;
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  /** Loop start frame, inclusive. */
  loopStart?: number;
  /** Loop end frame, exclusive: loop length is loopEnd - loopStart. */
  loopEnd?: number;
  /** 'loop' sustains forever, 'loopRelease' plays through after noteOff. */
  loopMode: 'none' | 'loop' | 'loopRelease';
  gainDb?: number;
  /** -1 full left to 1 full right. */
  pan?: number;
  env?: SampleZoneEnv;
  /** Zones sharing a group cycle round robin instead of layering. */
  roundRobinGroup?: number;
  /** 1-based slot in the round robin cycle. */
  seqPosition?: number;
}

/**
 * Equal-power fade of one zone's gain across its velocity boundaries.
 * Fades are centered on the half step between adjacent layers (velHi
 * of one layer and velLo of the next), so complementary layers sum to
 * constant power. Boundaries at 0 and 127 never fade. Width 0 is a
 * hard switch.
 */
export function velCrossfadeGain(zone: SampleZone, vel: number, width: number): number {
  if (width <= 0) return vel >= zone.velLo && vel <= zone.velHi ? 1 : 0;
  let g = 1;
  if (zone.velLo > 0) {
    const t = clamp((vel - (zone.velLo - 0.5 - width / 2)) / width, 0, 1);
    g *= Math.sin((t * Math.PI) / 2);
  }
  if (zone.velHi < 127) {
    const t = clamp((vel - (zone.velHi + 0.5 - width / 2)) / width, 0, 1);
    g *= Math.cos((t * Math.PI) / 2);
  }
  return g;
}

export interface SamplerBankOptions {
  /**
   * Velocity crossfade width in velocity units. Above 0, zones within
   * the fade of their velocity boundary still match and velGain reports
   * the equal-power crossfade weight. 0 (default) switches hard.
   */
  velXfade?: number;
}

export class SamplerBank {
  readonly zones: SampleZone[] = [];
  readonly velXfade: number;

  constructor(opts: SamplerBankOptions = {}) {
    this.velXfade = opts.velXfade ?? 0;
  }

  addZone(zone: SampleZone): void {
    this.zones.push(zone);
  }

  /** Crossfade weight of one zone at a velocity, honoring the bank width. */
  velGain(zone: SampleZone, vel: number): number {
    return velCrossfadeGain(zone, vel, this.velXfade);
  }

  /**
   * Every zone that sounds for one key/velocity hit. Zones sharing a
   * roundRobinGroup collapse to the single member picked by rrCounter
   * (sorted by seqPosition, index rrCounter mod group size). Called at
   * note-on rate; allocates its result arrays.
   */
  zonesFor(key: number, vel: number, rrCounter: number): SampleZone[] {
    const out: SampleZone[] = [];
    let groups: Map<number, SampleZone[]> | null = null;
    for (const z of this.zones) {
      if (key < z.keyLo || key > z.keyHi) continue;
      if (this.velXfade > 0) {
        if (velCrossfadeGain(z, vel, this.velXfade) <= 1e-6) continue;
      } else if (vel < z.velLo || vel > z.velHi) continue;
      if (z.roundRobinGroup === undefined) {
        out.push(z);
        continue;
      }
      if (!groups) groups = new Map();
      const members = groups.get(z.roundRobinGroup);
      if (members) members.push(z);
      else groups.set(z.roundRobinGroup, [z]);
    }
    if (groups) {
      for (const members of groups.values()) {
        members.sort((a, b) => (a.seqPosition ?? 1) - (b.seqPosition ?? 1));
        const n = members.length;
        out.push(members[((rrCounter % n) + n) % n]);
      }
    }
    return out;
  }
}

/** Catmull-Rom read at a fractional position, indices clamped at the edges. */
function readCubic(data: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  const t = pos - i;
  const last = data.length - 1;
  const y0 = data[i - 1 < 0 ? 0 : i - 1];
  const y1 = data[i < 0 ? 0 : i > last ? last : i];
  const y2 = data[i + 1 > last ? last : i + 1];
  const y3 = data[i + 2 > last ? last : i + 2];
  return y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
}

/**
 * Adsr plus a hold stage: after the attack reaches peak the level
 * freezes at 1 for the hold time, then the wrapped Adsr resumes with
 * its decay. Release cancels any pending hold.
 */
class HoldAdsr {
  private readonly sampleRate: number;
  private readonly adsr: Adsr;
  private holdSamples = 0;
  private holdLeft = 0;
  private peaked = false;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.adsr = new Adsr(sampleRate);
  }

  set(attack: number, hold: number, decay: number, sustain: number, release: number): void {
    this.adsr.set(attack, decay, sustain, release);
    this.holdSamples = Math.max(0, Math.round(hold * this.sampleRate));
  }

  trigger(): void {
    this.adsr.reset();
    this.adsr.trigger();
    this.holdLeft = 0;
    this.peaked = false;
  }

  release(): void {
    this.holdLeft = 0;
    this.peaked = true;
    this.adsr.release();
  }

  next(): number {
    if (this.holdLeft > 0) {
      this.holdLeft--;
      return 1;
    }
    const v = this.adsr.next();
    if (!this.peaked && v >= 1) {
      this.peaked = true;
      this.holdLeft = this.holdSamples;
    }
    return v;
  }

  get active(): boolean {
    return this.holdLeft > 0 || this.adsr.active;
  }
}

/** One playing zone inside a voice. Preallocated and reused. */
class Layer {
  zone: SampleZone | null = null;
  readonly env: HoldAdsr;
  playing = false;
  pos = 0;
  rate = 1;
  gainL = 0;
  gainR = 0;
  stereo = false;
  looping = false;
  loopStart = 0;
  loopEnd = 0;
  loopLen = 0;
  /** Crossfade window in source frames, 0 disables the fade. */
  xf = 0;
  /** Last readable frame position for non-looping playback. */
  endPos = 0;

  constructor(sampleRate: number) {
    this.env = new HoldAdsr(sampleRate);
  }
}

const MAX_LAYERS = 8;
const HALF_PI = Math.PI / 2;

/** The sampler parameter surface, exported so hosts can build editors for bank-backed engines. */
export const SAMPLER_PARAMS: ParamSpec[] = [
  { name: 'attack', min: 0, max: 10, default: 0.002, curve: 'exp', unit: 's' },
  { name: 'decay', min: 0, max: 10, default: 0.1, curve: 'exp', unit: 's' },
  { name: 'sustain', min: 0, max: 1, default: 1 },
  { name: 'release', min: 0, max: 10, default: 0.25, curve: 'exp', unit: 's' },
  { name: 'loopXfade', min: 0, max: 100, default: 8, unit: 'ms' },
  { name: 'veltrack', min: 0, max: 100, default: 100, unit: '%' },
  { name: 'gain', min: -60, max: 24, default: 0, curve: 'db', unit: 'dB' },
  { name: 'pan', min: -1, max: 1, default: 0 },
];

function fillDefaults(given: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SAMPLER_PARAMS) out[s.name] = given[s.name] !== undefined ? given[s.name] : s.default;
  return out;
}

class SamplerVoice implements Voice {
  private readonly sampleRate: number;
  private readonly bank: SamplerBank;
  private readonly rr: { count: number };
  private readonly p: Record<string, number>;
  private readonly layers: Layer[];

  constructor(
    sampleRate: number,
    params: Record<string, number>,
    bank: SamplerBank,
    rr: { count: number },
  ) {
    this.sampleRate = sampleRate;
    this.bank = bank;
    this.rr = rr;
    this.p = fillDefaults(params);
    this.layers = new Array<Layer>(MAX_LAYERS);
    for (let i = 0; i < MAX_LAYERS; i++) this.layers[i] = new Layer(sampleRate);
  }

  setParam(name: string, value: number): void {
    if (!(name in this.p)) return;
    this.p[name] = value;
    if (name === 'attack' || name === 'decay' || name === 'sustain' || name === 'release') {
      const p = this.p;
      for (const lay of this.layers) {
        if (lay.playing && lay.zone && !lay.zone.env) {
          lay.env.set(p.attack, 0, p.decay, p.sustain, p.release);
        }
      }
    }
  }

  noteOn(freq: number, vel: number): void {
    const p = this.p;
    const playedKey = ftom(freq);
    const key = clamp(Math.round(playedKey), 0, 127);
    const vel127 = clamp(Math.round(vel * 127), 0, 127);
    const zones = this.bank.zonesFor(key, vel127, this.rr.count++);
    const velGain = 1 - (p.veltrack / 100) * (1 - vel * vel);
    const engineGain = dbToGain(p.gain) * velGain;
    for (let i = 0; i < MAX_LAYERS; i++) {
      const lay = this.layers[i];
      const zone = i < zones.length ? zones[i] : null;
      lay.zone = zone;
      if (!zone) {
        lay.playing = false;
        continue;
      }
      this.startLayer(lay, zone, playedKey, vel127, engineGain);
    }
  }

  private startLayer(
    lay: Layer,
    zone: SampleZone,
    playedKey: number,
    vel127: number,
    engineGain: number,
  ): void {
    const p = this.p;
    const semis = playedKey - zone.rootKey + (zone.fineTune ?? 0) / 100;
    lay.rate = Math.pow(2, semis / 12) * (zone.sampleRate / this.sampleRate);
    lay.pos = 0;
    lay.stereo = zone.dataR !== undefined;
    const dataLen = lay.stereo
      ? Math.min(zone.data.length, zone.dataR!.length)
      : zone.data.length;
    lay.endPos = dataLen - 1;

    const total = dbToGain(zone.gainDb ?? 0) * engineGain * this.bank.velGain(zone, vel127);
    const pan = clamp((zone.pan ?? 0) + p.pan, -1, 1);
    if (lay.stereo) {
      /* Stereo zones keep unity per channel at center; pan is a balance. */
      lay.gainL = total * Math.min(1, 1 - pan);
      lay.gainR = total * Math.min(1, 1 + pan);
    } else {
      const angle = ((pan + 1) * Math.PI) / 4;
      lay.gainL = total * Math.cos(angle);
      lay.gainR = total * Math.sin(angle);
    }

    const ls = zone.loopStart ?? 0;
    const le = zone.loopEnd ?? dataLen;
    lay.looping =
      zone.loopMode !== 'none' && le > ls + 1 && le <= dataLen && ls >= 0;
    if (lay.looping) {
      lay.loopStart = ls;
      lay.loopEnd = le;
      lay.loopLen = le - ls;
      /* The pre-loop read needs xf frames before loopStart. */
      lay.xf = Math.min((p.loopXfade / 1000) * zone.sampleRate, lay.loopLen - 1, ls);
      if (lay.xf < 1) lay.xf = 0;
    } else {
      lay.xf = 0;
    }

    const env = zone.env;
    if (env) lay.env.set(env.attack, env.hold, env.decay, env.sustain, env.release);
    else lay.env.set(p.attack, 0, p.decay, p.sustain, p.release);
    lay.env.trigger();
    lay.playing = true;
  }

  noteOff(): void {
    for (const lay of this.layers) {
      if (!lay.playing) continue;
      lay.env.release();
      if (lay.zone && lay.zone.loopMode === 'loopRelease') lay.looping = false;
    }
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    for (const lay of this.layers) {
      if (!lay.playing || !lay.zone) continue;
      const zone = lay.zone;
      const data = zone.data;
      const dataR = lay.stereo ? zone.dataR! : data;
      const rate = lay.rate;
      const xf = lay.xf;
      const xfStart = lay.loopEnd - xf;
      let pos = lay.pos;
      for (let i = from; i < to; i++) {
        const g = lay.env.next();
        if (!lay.env.active) {
          lay.playing = false;
          break;
        }
        let l: number;
        let r: number;
        if (lay.looping && xf > 0 && pos >= xfStart) {
          const t = ((pos - xfStart) / xf) * HALF_PI;
          const wOut = Math.cos(t);
          const wIn = Math.sin(t);
          const pre = pos - lay.loopLen;
          l = wOut * readCubic(data, pos) + wIn * readCubic(data, pre);
          r = lay.stereo ? wOut * readCubic(dataR, pos) + wIn * readCubic(dataR, pre) : l;
        } else {
          l = readCubic(data, pos);
          r = lay.stereo ? readCubic(dataR, pos) : l;
        }
        outL[i] += l * lay.gainL * g;
        outR[i] += r * lay.gainR * g;
        pos += rate;
        if (lay.looping) {
          while (pos >= lay.loopEnd) pos -= lay.loopLen;
        } else if (pos >= lay.endPos) {
          lay.playing = false;
          break;
        }
      }
      lay.pos = pos;
    }
  }

  get active(): boolean {
    for (const lay of this.layers) if (lay.playing) return true;
    return false;
  }
}

export function makeSamplerEngine(bank: SamplerBank, id = 'sampler'): EngineDef {
  /* Shared so successive notes cycle round robins across pooled voices. */
  const rr = { count: 0 };
  return {
    id,
    label: 'Sampler',
    params: SAMPLER_PARAMS.map((p) => ({ ...p })),
    polyphony: 16,
    createVoice: (sampleRate, params) => new SamplerVoice(sampleRate, params, bank, rr),
  };
}
