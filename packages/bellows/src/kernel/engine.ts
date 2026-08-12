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

  /*
   * Non-finite values are rejected at every entry point, including the
   * initial one, and the last good value stays put. This ramp is recursive
   * and unrecoverable once poisoned: step = (NaN - v) * rate is NaN,
   * `this.step !== 0` is TRUE for NaN, both landing comparisons are false, so
   * next() assigns v = NaN, and every later set() recomputes
   * step = (good - NaN) * rate = NaN. It backs channel gain, channel pan,
   * per-bus send levels, bus return level and master gain, so one
   * masterGain(NaN) used to silence the whole output for the life of the
   * page with no error, no 'error' reply and nothing on the console, and
   * panic did not clear it either. Same policy as VoicePool.setParam and the
   * dsp setters: a non-finite value is a caller error, so keep the last good
   * one. Costs nothing per sample; next() is untouched.
   */
  constructor(sampleRate: number, initial: number, timeSec = 0.02) {
    const v = Number.isFinite(initial) ? initial : 0;
    this.v = v;
    this.target = v;
    this.rate = 1 / Math.max(1, sampleRate * timeSec);
  }

  set(target: number): void {
    if (!Number.isFinite(target)) return;
    this.target = target;
    this.step = (target - this.v) * this.rate;
  }

  snap(v: number): void {
    if (!Number.isFinite(v)) return;
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

/**
 * One in-flight parameter ramp. The table is fixed size and preallocated,
 * because claiming a ramp happens on the audio path and the audio path does
 * not allocate.
 */
interface ParamRampSlot {
  active: boolean;
  /** channel id */
  target: number;
  /** interned param index */
  param: number;
  from: number;
  to: number;
  startFrame: number;
  endFrame: number;
}

/**
 * How many parameters may ramp at once. Automation is sparse in practice: a
 * filter sweep here, a detune glide there. Past this the kernel degrades to
 * immediate jumps rather than growing the table mid-render.
 */
const RAMP_SLOTS = 32;

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
  private hasProcessed = false;
  private banks = new Map<string, EngineDef>();
  private localEngines = new Map<string, EngineDef>();
  private localEffects = new Map<string, { id: string; create(sampleRate: number, params: Record<string, number>): Effect }>();
  private opts: KernelOptions;
  private ramps: ParamRampSlot[] = [];
  /** Cached count so a render with no automation skips the ramp pass entirely. */
  private activeRamps = 0;

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
    for (let i = 0; i < RAMP_SLOTS; i++) {
      this.ramps.push({ active: false, target: 0, param: 0, from: 0, to: 0, startFrame: 0, endFrame: 0 });
    }
  }

  get currentFrame(): number {
    return this.frame;
  }

  /**
   * Locks the kernel clock to the host clock. The worklet calls this at the
   * top of every process() with AudioWorkletGlobalScope.currentFrame, so
   * engine time equals context time and events stamped with
   * ctx.currentTime land where they were aimed. Offline rendering never
   * calls it: both clocks already start at zero there.
   */
  setFrame(frame: number): void {
    this.frame = frame;
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
        // A ramp outlives its channel otherwise, and would keep looking up a
        // pool that is gone.
        this.clearRamps(msg.id);
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
        if (!c) break;
        // Same rule as the Param event: setting a parameter by hand cancels
        // any ramp still moving it.
        if (this.activeRamps > 0) {
          const idx = paramIndex.get(msg.name);
          if (idx !== undefined) this.clearRamps(msg.id, idx);
        }
        c.pool.setParam(msg.name, msg.value);
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
        // Panic means stop moving, so parameters freeze where they are rather
        // than continuing toward a destination nobody is listening for.
        this.clearRamps();
        break;
    }
  }

  /** Before the first rendered block, level changes snap: initial setup is not automation. */
  private setLevel(ramp: Ramp, v: number): void {
    if (!this.hasProcessed) ramp.snap(v);
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
        // An explicit set outranks automation: without this the ramp would
        // overwrite the value again at the next block boundary.
        if (this.activeRamps > 0) this.clearRamps(e.target, e.a);
        c.pool.setParam(paramNameOf(e), e.b);
        break;
      case EventKind.ParamRamp: {
        // e.b is the destination, e.c the ramp length in seconds. The ramp
        // starts here, from whatever the parameter reads right now.
        const name = paramNameOf(e);
        const current = c.pool.getParam(name);
        // Number.isFinite as well as `> 0`: `e.c > 0` already rejects NaN,
        // but Infinity passed and then wedged a slot for good. endFrame
        // becomes startFrame + Math.round(Infinity) = Infinity, so
        // `frame >= s.endFrame` never fires and the slot is never freed,
        // while t = (frame - start) / Infinity is 0 so the parameter never
        // moves either. Thirty-two of those exhaust RAMP_SLOTS and silently
        // downgrade every later ramp on this kernel to an immediate jump.
        // Reachable as rampParam(name, value, { seconds: 1 / 0 }).
        if (
          e.c > 0 &&
          Number.isFinite(e.c) &&
          current !== undefined &&
          this.startRamp(e.target, e.a, current, e.b, e.c)
        ) {
          break;
        }
        // Immediate fallback, for three cases: a duration that is not a
        // positive finite number of seconds (c <= 0 is the documented
        // meaning), a parameter with no known current value to interpolate
        // from, or every ramp slot busy.
        // Landing early beats dropping the automation on the floor.
        this.clearRamps(e.target, e.a);
        c.pool.setParam(name, e.b);
        break;
      }
      case EventKind.AllNotesOff:
        c.pool.allNotesOff();
        break;
      default:
        break;
    }
  }

  /* ---------------- param ramps ---------------- */

  /**
   * Claim or retarget a ramp slot. Returns false when the table is full, which
   * is the caller's cue to apply the destination immediately.
   */
  private startRamp(target: number, param: number, from: number, to: number, seconds: number): boolean {
    const startFrame = this.frame;
    const endFrame = startFrame + Math.max(1, Math.round(seconds * this.sampleRate));
    // A second ramp on the same channel and parameter would fight the first,
    // two setParam calls per block with neither winning. Retarget instead: the
    // new ramp picks up from where the old one had got to.
    for (const s of this.ramps) {
      if (s.active && s.target === target && s.param === param) {
        s.from = from;
        s.to = to;
        s.startFrame = startFrame;
        s.endFrame = endFrame;
        return true;
      }
    }
    for (const s of this.ramps) {
      if (s.active) continue;
      s.active = true;
      s.target = target;
      s.param = param;
      s.from = from;
      s.to = to;
      s.startFrame = startFrame;
      s.endFrame = endFrame;
      this.activeRamps++;
      return true;
    }
    return false;
  }

  /** Free ramp slots: all of them, one channel's, or one channel parameter's. */
  private clearRamps(target?: number, param?: number): void {
    if (this.activeRamps === 0) return;
    for (const s of this.ramps) {
      if (!s.active) continue;
      if (target !== undefined && s.target !== target) continue;
      if (param !== undefined && s.param !== param) continue;
      s.active = false;
      this.activeRamps--;
    }
  }

  /**
   * Step every active ramp one block forward.
   *
   * Block granularity, not per sample, is deliberate. setParam on most engines
   * recomputes filter coefficients, wavetable phase increments, and envelope
   * rates, so calling it per sample per ramp would cost far more than the
   * audio it improves. One update per block is 2.7 ms at 48k with 128 frames,
   * below the ear's resolution for parameter movement. Gain and pan, where
   * stepping matters, already have their own per-sample Ramp.
   */
  private advanceRamps(frame: number): void {
    for (const s of this.ramps) {
      if (!s.active) continue;
      const c = this.channels.get(s.target);
      if (!c) {
        s.active = false;
        this.activeRamps--;
        continue;
      }
      const name = paramNames[s.param] ?? '';
      if (frame >= s.endFrame) {
        // Land exactly on the destination, never on the last interpolated step.
        c.pool.setParam(name, s.to);
        s.active = false;
        this.activeRamps--;
        continue;
      }
      if (frame <= s.startFrame) continue;
      const t = (frame - s.startFrame) / (s.endFrame - s.startFrame);
      c.pool.setParam(name, s.from + (s.to - s.from) * t);
    }
  }

  /* ---------------- render ---------------- */

  /**
   * Render exactly blockSize frames into outL/outR (overwrites).
   */
  process(outL: Float32Array, outR: Float32Array): void {
    this.hasProcessed = true;
    const N = this.blockSize;
    const blockStart = this.frame;
    const blockEndTime = (blockStart + N) / this.sampleRate;

    // Parameter automation moves once per block, before the block renders.
    // With nothing ramping this is a single integer compare and the render
    // path is exactly what it was before ramps existed.
    if (this.activeRamps > 0) this.advanceRamps(blockStart);

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

    /*
     * Compact the drained queue occasionally. copyWithin and a length
     * assignment rather than splice, because splice builds and returns an
     * array of everything it removed and this runs on the audio thread.
     * The rule is "no allocation at steady state" and steady state has no
     * events to drain, so splice was inside the letter of it; this is
     * inside the spirit as well and is not slower.
     */
    if (this.eventHead > 256) {
      const left = this.events.length - this.eventHead;
      this.events.copyWithin(0, this.eventHead);
      this.events.length = left;
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
