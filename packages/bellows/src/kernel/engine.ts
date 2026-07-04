/*
 * The kernel: one render core hosting channels (instrument slots), send
 * buses, and a master chain, driven by a sample-accurate event queue.
 *
 * The same class runs inside the AudioWorkletProcessor for realtime and
 * inside a plain loop for offline rendering. It is configured exclusively
 * through KernelMessage, so a recorded message stream replays identically
 * in both worlds.
 *
 * Blocks are split at event frames: everything between two events renders
 * in one vectorized pass, then the events at that boundary apply, then the
 * next span renders. Sample accuracy without per-sample dispatch.
 */

import type { EngineDef, Effect, KernelEvent } from '../types';
import { EventKind, clamp } from '../types';
import { rng } from '../core/prng';
import { VoicePool } from '../core/voicepool';
import { getEngine, getEffect } from '../core/registry';
import type { FxSpec, KernelMessage, SamplerZoneData } from './messages';

/** Linear ramp for gain and pan changes: click-free without dsp deps. */
class Ramp {
  private v: number;
  private target: number;
  private step = 0;
  private readonly rate: number;

  constructor(sampleRate: number, initial: number, timeSec = 0.02) {
    this.v = initial;
    this.target = initial;
    this.rate = 1 / Math.max(1, sampleRate * timeSec);
  }

  set(target: number): void {
    this.target = target;
    this.step = (target - this.v) * this.rate;
  }

  snap(v: number): void {
    this.v = v;
    this.target = v;
    this.step = 0;
  }

  next(): number {
    if (this.step !== 0) {
      const nv = this.v + this.step;
      if ((this.step > 0 && nv >= this.target) || (this.step < 0 && nv <= this.target)) {
        this.v = this.target;
        this.step = 0;
      } else {
        this.v = nv;
      }
    }
    return this.v;
  }

  get value(): number {
    return this.v;
  }
}

interface FxSlot {
  effect: Effect;
  spec: FxSpec;
}

class Channel {
  pool: VoicePool;
  fx: FxSlot[] = [];
  gain: Ramp;
  pan: Ramp;
  /** send levels keyed by bus id */
  sends = new Map<number, Ramp>();
  scratchL: Float32Array;
  scratchR: Float32Array;

  constructor(
    def: EngineDef,
    sampleRate: number,
    params: Record<string, number>,
    seed: string,
    blockSize: number,
    polyphony?: number,
  ) {
    this.pool = new VoicePool(def, sampleRate, params, rng(seed), polyphony);
    this.gain = new Ramp(sampleRate, 0.8);
    this.pan = new Ramp(sampleRate, 0);
    this.scratchL = new Float32Array(blockSize);
    this.scratchR = new Float32Array(blockSize);
  }
}

class Bus {
  fx: FxSlot[] = [];
  returnLevel: Ramp;
  scratchL: Float32Array;
  scratchR: Float32Array;

  constructor(sampleRate: number, blockSize: number, returnLevel: number) {
    this.returnLevel = new Ramp(sampleRate, returnLevel);
    this.scratchL = new Float32Array(blockSize);
    this.scratchR = new Float32Array(blockSize);
  }
}

export interface KernelOptions {
  blockSize?: number;
  /**
   * Hook that turns a registered sample bank into an EngineDef. Injected by
   * the worklet entry and the offline renderer so the kernel itself stays
   * below the engines layer.
   */
  resolveBankEngine?: (
    kind: 'sampler' | 'grain',
    bankId: string,
    data: SamplerZoneData[] | { data: Float32Array; sampleRate: number },
  ) => EngineDef;
}

export class KernelEngine {
  readonly sampleRate: number;
  readonly blockSize: number;
  private channels = new Map<number, Channel>();
  private buses = new Map<number, Bus>();
  private masterFx: FxSlot[] = [];
  private masterGain: Ramp;
  private events: KernelEvent[] = [];
  private eventHead = 0;
  private frame = 0;
  private mixL: Float32Array;
  private mixR: Float32Array;
  private banks = new Map<string, EngineDef>();
  private localEngines = new Map<string, EngineDef>();
  private localEffects = new Map<string, { id: string; create(sampleRate: number, params: Record<string, number>): Effect }>();
  private opts: KernelOptions;

  peakL = 0;
  peakR = 0;
  rmsL = 0;
  rmsR = 0;

  constructor(sampleRate: number, opts: KernelOptions = {}) {
    this.sampleRate = sampleRate;
    this.blockSize = opts.blockSize ?? 128;
    this.masterGain = new Ramp(sampleRate, 0.9);
    this.mixL = new Float32Array(this.blockSize);
    this.mixR = new Float32Array(this.blockSize);
    this.opts = opts;
  }

  get currentFrame(): number {
    return this.frame;
  }

  get currentTime(): number {
    return this.frame / this.sampleRate;
  }

  get voiceCount(): number {
    let n = 0;
    for (const c of this.channels.values()) n += c.pool.activeCount;
    return n;
  }

  /* ---------------- configuration ---------------- */

  apply(msg: KernelMessage): void {
    switch (msg.type) {
      case 'createChannel': {
        const def = this.resolveEngine(msg.engineId);
        this.channels.set(
          msg.id,
          new Channel(def, this.sampleRate, msg.params, msg.seed, this.blockSize, msg.polyphony),
        );
        break;
      }
      case 'removeChannel':
        this.channels.delete(msg.id);
        break;
      case 'channelFx': {
        const c = this.channels.get(msg.id);
        if (c) c.fx = this.buildChain(msg.chain);
        break;
      }
      case 'fxParam': {
        const c = this.channels.get(msg.channelId);
        const slot = c?.fx[msg.fxIndex];
        if (slot) slot.effect.setParam(msg.name, msg.value);
        break;
      }
      case 'channelParam': {
        const c = this.channels.get(msg.id);
        if (c) c.pool.setParam(msg.name, msg.value);
        break;
      }
      case 'channelGain': {
        const c = this.channels.get(msg.id);
        if (c) this.setLevel(c.gain, msg.gain);
        break;
      }
      case 'channelPan': {
        const c = this.channels.get(msg.id);
        if (c) this.setLevel(c.pan, clamp(msg.pan, -1, 1));
        break;
      }
      case 'createBus': {
        const bus = new Bus(this.sampleRate, this.blockSize, msg.returnLevel);
        bus.fx = this.buildChain(msg.chain);
        this.buses.set(msg.id, bus);
        break;
      }
      case 'busFxParam': {
        const b = this.buses.get(msg.busId);
        const slot = b?.fx[msg.fxIndex];
        if (slot) slot.effect.setParam(msg.name, msg.value);
        break;
      }
      case 'send': {
        const c = this.channels.get(msg.channelId);
        if (!c) break;
        const existing = c.sends.get(msg.busId);
        if (existing) this.setLevel(existing, msg.level);
        else {
          const r = new Ramp(this.sampleRate, 0);
          this.setLevel(r, msg.level);
          c.sends.set(msg.busId, r);
        }
        break;
      }
      case 'masterFx':
        this.masterFx = this.buildChain(msg.chain);
        break;
      case 'masterFxParam': {
        const slot = this.masterFx[msg.fxIndex];
        if (slot) slot.effect.setParam(msg.name, msg.value);
        break;
      }
      case 'masterGain':
        this.setLevel(this.masterGain, msg.gain);
        break;
      case 'events':
        for (const e of msg.events) this.pushEvent(e);
        break;
      case 'internParam':
        // Param names are interned main-thread side; the kernel mirrors the
        // table so numeric Param events resolve to names in this realm too.
        paramNames[msg.index] = msg.name;
        paramIndex.set(msg.name, msg.index);
        break;
      case 'registerBank': {
        if (this.opts.resolveBankEngine) {
          this.banks.set('sampler:' + msg.bankId, this.opts.resolveBankEngine('sampler', msg.bankId, msg.zones));
        }
        break;
      }
      case 'registerGrain': {
        if (this.opts.resolveBankEngine) {
          this.banks.set('granular:' + msg.bankId, this.opts.resolveBankEngine('grain', msg.bankId, { data: msg.data, sampleRate: msg.sampleRate }));
        }
        break;
      }
      case 'defOp': {
        // Tier 3: user DSP. The code string must evaluate to an EngineDef or
        // EffectDef object. Documented constraint: self-contained, numeric
        // params only. Blocked by CSP in some hosts; that is the host's call.
        const def = new Function('return (' + msg.code + ')')();
        if (msg.kind === 'engine') this.localEngines.set(def.id, def);
        else this.localEffects.set(def.id, def);
        break;
      }
      case 'panic':
        for (const c of this.channels.values()) c.pool.allNotesOff();
        this.events.length = 0;
        this.eventHead = 0;
        break;
    }
  }

  /** Before the first rendered frame, level changes snap: initial setup is not automation. */
  private setLevel(ramp: Ramp, v: number): void {
    if (this.frame === 0) ramp.snap(v);
    else ramp.set(v);
  }

  private resolveEngine(id: string): EngineDef {
    const banked = this.banks.get(id);
    if (banked) return banked;
    const local = this.localEngines.get(id);
    if (local) return local;
    return getEngine(id);
  }

  private buildChain(chain: FxSpec[]): FxSlot[] {
    return chain.map((spec) => {
      const local = this.localEffects.get(spec.effectId);
      const def = local ?? getEffect(spec.effectId);
      const effect = def.create(this.sampleRate, spec.params ?? {});
      if (spec.params) {
        for (const [name, value] of Object.entries(spec.params)) effect.setParam(name, value);
      }
      return { effect, spec };
    });
  }

  /* ---------------- events ---------------- */

  private pushEvent(e: KernelEvent): void {
    // binary insert by time; queue is usually near-sorted
    const arr = this.events;
    let lo = this.eventHead;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time <= e.time) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, e);
  }

  private applyEvent(e: KernelEvent): void {
    const c = this.channels.get(e.target);
    if (!c) return;
    switch (e.kind) {
      case EventKind.NoteOn:
        c.pool.noteOn(e.a, e.b, e.c, this.frame);
        break;
      case EventKind.NoteOff:
        c.pool.noteOff(e.a);
        break;
      case EventKind.Param:
        c.pool.setParam(paramNameOf(e), e.b);
        break;
      case EventKind.AllNotesOff:
        c.pool.allNotesOff();
        break;
      default:
        break;
    }
  }

  /* ---------------- render ---------------- */

  /**
   * Render exactly blockSize frames into outL/outR (overwrites).
   */
  process(outL: Float32Array, outR: Float32Array): void {
    const N = this.blockSize;
    const blockStart = this.frame;
    const blockEndTime = (blockStart + N) / this.sampleRate;

    // clear scratches
    for (const c of this.channels.values()) {
      c.scratchL.fill(0);
      c.scratchR.fill(0);
    }

    // render voice audio, splitting at event boundaries
    let from = 0;
    while (true) {
      const e = this.events[this.eventHead];
      if (!e || e.time >= blockEndTime) break;
      let f = Math.round(e.time * this.sampleRate) - blockStart;
      if (f < from) f = from;
      if (f > from) {
        for (const c of this.channels.values()) c.pool.process(c.scratchL, c.scratchR, from, f);
        from = f;
      }
      this.frame = blockStart + from;
      this.applyEvent(e);
      this.eventHead++;
    }
    if (from < N) {
      for (const c of this.channels.values()) c.pool.process(c.scratchL, c.scratchR, from, N);
    }
    this.frame = blockStart;

    // compact the drained queue occasionally
    if (this.eventHead > 256) {
      this.events.splice(0, this.eventHead);
      this.eventHead = 0;
    }

    // channel fx, then mix into master and sends
    this.mixL.fill(0);
    this.mixR.fill(0);
    for (const b of this.buses.values()) {
      b.scratchL.fill(0);
      b.scratchR.fill(0);
    }
    for (const c of this.channels.values()) {
      for (const slot of c.fx) slot.effect.process(c.scratchL, c.scratchR, 0, N);
      for (let i = 0; i < N; i++) {
        const g = c.gain.next();
        const p = c.pan.next();
        // equal power pan
        const a = 0.25 * Math.PI * (p + 1);
        const gl = Math.cos(a) * Math.SQRT2 * g;
        const gr = Math.sin(a) * Math.SQRT2 * g;
        const l = c.scratchL[i] * gl;
        const r = c.scratchR[i] * gr;
        c.scratchL[i] = l;
        c.scratchR[i] = r;
        this.mixL[i] += l;
        this.mixR[i] += r;
      }
      for (const [busId, level] of c.sends) {
        const bus = this.buses.get(busId);
        if (!bus) continue;
        for (let i = 0; i < N; i++) {
          const s = level.next();
          bus.scratchL[i] += c.scratchL[i] * s;
          bus.scratchR[i] += c.scratchR[i] * s;
        }
      }
    }

    // bus fx and returns
    for (const b of this.buses.values()) {
      for (const slot of b.fx) slot.effect.process(b.scratchL, b.scratchR, 0, N);
      for (let i = 0; i < N; i++) {
        const rl = b.returnLevel.next();
        this.mixL[i] += b.scratchL[i] * rl;
        this.mixR[i] += b.scratchR[i] * rl;
      }
    }

    // master chain
    for (const slot of this.masterFx) slot.effect.process(this.mixL, this.mixR, 0, N);

    let pl = 0;
    let pr = 0;
    let sl = 0;
    let sr = 0;
    for (let i = 0; i < N; i++) {
      const g = this.masterGain.next();
      const l = this.mixL[i] * g;
      const r = this.mixR[i] * g;
      outL[i] = l;
      outR[i] = r;
      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      sl += l * l;
      sr += r * r;
    }
    this.peakL = pl;
    this.peakR = pr;
    this.rmsL = Math.sqrt(sl / N);
    this.rmsR = Math.sqrt(sr / N);
    this.frame = blockStart + N;
  }
}

/*
 * Param events carry the param name via a side table because KernelEvent is
 * numeric. The facade interns names; index travels in e.a.
 */
const paramNames: string[] = [];
const paramIndex = new Map<string, number>();

export function internParam(name: string): number {
  let i = paramIndex.get(name);
  if (i === undefined) {
    i = paramNames.length;
    paramNames.push(name);
    paramIndex.set(name, i);
  }
  return i;
}

function paramNameOf(e: KernelEvent): string {
  return paramNames[e.a] ?? '';
}
