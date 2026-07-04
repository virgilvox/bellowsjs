/*
 * BELLOWS shared contracts.
 *
 * Everything DSP-shaped in this library follows two conventions:
 *
 * 1. Sample rate arrives at construction time. Units never read globals.
 * 2. Processing works on Float32Array index ranges `(from, to)` so the
 *    kernel can split a 128-frame block at event boundaries and stay
 *    sample accurate without per-sample dispatch.
 *
 * Voices ADD into their output buffers (many voices share a bus).
 * Effects process IN PLACE (they own the bus while they run).
 * Neither may allocate on the audio path at steady state.
 */

/** A pseudorandom stream. Every stochastic decision in the library draws from one. */
export interface Rng {
  /** Uniform float in [0, 1). */
  (): number;
}

export interface NamedRng extends Rng {
  /** Derive an independent, reproducible child stream. */
  fork(label: string): NamedRng;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Pick one element. */
  pick<T>(arr: readonly T[]): T;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Fisher-Yates shuffle, returns a new array. */
  shuffle<T>(arr: readonly T[]): T[];
  /** Approximately normal (Irwin-Hall of 4), mean 0, roughly unit variance. */
  gauss(): number;
  /** Weighted index pick. */
  weighted(weights: ArrayLike<number>): number;
  readonly label: string;
}

/** Parameter metadata used by UIs and by the kernel param registry. */
export interface ParamSpec {
  name: string;
  min: number;
  max: number;
  default: number;
  /** 'lin' | 'exp' | 'db' hint for UI mapping. */
  curve?: 'lin' | 'exp' | 'db';
  unit?: string;
}

/**
 * A playing voice. Created by an EngineDef factory, owned by a voice pool.
 * Voices are reused: noteOn must fully reset internal state.
 */
export interface Voice {
  /** Begin a note. freq is the already-tuned frequency in Hz. vel in [0, 1]. */
  noteOn(freq: number, vel: number): void;
  /** Enter release. The voice stays active until its tail decays. */
  noteOff(): void;
  /** Add samples into outL/outR over [from, to). */
  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void;
  /** Update a parameter by name. Unknown names are ignored. */
  setParam(name: string, value: number): void;
  /** False once the voice has fully decayed and can be reclaimed. */
  readonly active: boolean;
}

/**
 * An instrument engine: a named voice factory plus its parameter surface.
 * Engines are interchangeable: a score never knows which engine renders it.
 */
export interface EngineDef {
  id: string;
  label: string;
  params: ParamSpec[];
  /** Max simultaneous voices a pool should preallocate by default. */
  polyphony?: number;
  createVoice(sampleRate: number, params: Record<string, number>, rng: NamedRng): Voice;
}

/** A stereo in-place effect. */
export interface Effect {
  process(l: Float32Array, r: Float32Array, from: number, to: number): void;
  setParam(name: string, value: number): void;
  reset(): void;
}

export interface EffectDef {
  id: string;
  label: string;
  params: ParamSpec[];
  create(sampleRate: number, params: Record<string, number>): Effect;
}

/** A mono analysis tap fed post-mix. */
export interface Analyzer {
  /** Consume samples; may produce results via poll methods on the concrete type. */
  push(mono: Float32Array, from: number, to: number): void;
  reset(): void;
}

/* ------------------------------------------------------------------ */
/* Musical time                                                        */
/* ------------------------------------------------------------------ */

/**
 * Musical durations and positions accepted across the API:
 *  - beat count as number (1 = one quarter note at the transport meter)
 *  - notation strings: '4n', '8n', '8t' (triplet), '4n.' or legacy '4nd' (dotted),
 *    '3/8' (fraction of a whole note), '2m' (measures), '16n'
 *  - 'bar:beat:sixteenth' position strings where a position is expected
 */
export type TimeValue = number | string;

/** A tempo automation point. Interpolation from the previous point is linear in bpm. */
export interface TempoPoint {
  /** Position in beats. */
  beat: number;
  bpm: number;
}

/* ------------------------------------------------------------------ */
/* Kernel events                                                       */
/* ------------------------------------------------------------------ */

export const enum EventKind {
  NoteOn = 0,
  NoteOff = 1,
  Param = 2,
  ParamRamp = 3,
  AllNotesOff = 4,
}

/**
 * A timestamped kernel event. `time` is engine time in seconds
 * (kernel converts to a frame index). `target` addresses a channel
 * (instrument slot) in the kernel.
 */
export interface KernelEvent {
  time: number;
  kind: EventKind;
  target: number;
  /** NoteOn/NoteOff: note id. Param: param index. */
  a: number;
  /** NoteOn: frequency Hz. Param: value. */
  b: number;
  /** NoteOn: velocity. ParamRamp: ramp seconds. */
  c: number;
}

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

/**
 * A pattern is a pull-based generator of events per step or per query span.
 * Generators (euclid, markov, lsystem, ca) implement this so schedulers can
 * treat them uniformly.
 */
export interface StepPattern<T = number> {
  /** Value at step i (patterns may be infinite; finite ones wrap). */
  at(step: number): T;
  readonly length: number;
}

/** Convert a MIDI-style note number to Hz at A4 = 440 in 12-EDO. Tunings override this. */
export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function ftom(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(g, 1e-10));
}
