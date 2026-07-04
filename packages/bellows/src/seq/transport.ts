/*
 * Transport core: musical position against a wall clock, with no timers
 * inside. Callers pass absolute times in seconds (from performance.now,
 * an AudioContext, or a fake clock in tests) and the transport answers
 * beat and position questions through its TempoMap and meter map.
 *
 * The running origin is a pair (originSeconds, originBeat): the absolute
 * time at which the transport sat at originBeat. Tempo edits while
 * running re-anchor that origin at the current moment first, so the beat
 * position stays continuous across the change.
 *
 * Swing: with setSwing(amount, subdivision), every odd subdivision step
 * lands late by amount * subdivision * 0.5 beats. For a beat b on the
 * grid, step n = floor(b / subdivision); swungBeat(b) = b when n is
 * even, b + amount * subdivision * 0.5 when n is odd. amount = 1 puts
 * off-steps exactly on the triplet-feel two-thirds point of the pair.
 */

import { TempoMap } from './tempomap';
import { beatsPerBar, DEFAULT_METER, type Meter } from './time';

export type TransportState = 'stopped' | 'running' | 'paused';

/** One subdivision tick produced by scheduleHorizon. */
export interface TransportTick {
  /** Swung beat position of the tick. The unswung grid beat is step * subdivision. */
  beat: number;
  /** Absolute time of the tick in seconds. */
  seconds: number;
  /** Subdivision index from beat 0. */
  step: number;
}

export interface TransportPosition {
  /** Zero-based bar. */
  bar: number;
  /** Zero-based whole beat within the bar. */
  beat: number;
  /** Fraction of the current beat, in [0, 1). */
  phase: number;
}

interface MeterChange {
  bar: number;
  meter: Meter;
  /** Beat position where this meter takes effect. Recomputed on edits. */
  startBeat: number;
}

export class Transport {
  readonly tempo: TempoMap;

  private meters: MeterChange[];
  private _state: TransportState = 'stopped';
  private originSeconds = 0;
  private originBeat = 0;
  private pausedBeat = 0;
  private swingAmount = 0;
  private swingSubdivision = 0.5;

  constructor(opts?: { bpm?: number; meter?: Meter }) {
    this.tempo = new TempoMap(opts?.bpm ?? 120);
    this.meters = [{ bar: 0, meter: opts?.meter ?? DEFAULT_METER, startBeat: 0 }];
  }

  get state(): TransportState {
    return this._state;
  }

  /** Begin running with beat 0 at the given absolute time. */
  start(atSeconds: number): void {
    this.originSeconds = atSeconds;
    this.originBeat = 0;
    this.pausedBeat = 0;
    this._state = 'running';
  }

  /** Stop and rewind to beat 0. */
  stop(): void {
    this._state = 'stopped';
    this.pausedBeat = 0;
  }

  /** Freeze the beat position as of the given absolute time. */
  pause(atSeconds: number): void {
    if (this._state !== 'running') return;
    this.pausedBeat = this.beatAt(atSeconds);
    this._state = 'paused';
  }

  /** Continue from the paused beat, re-anchored to the given absolute time. */
  resume(atSeconds: number): void {
    if (this._state !== 'paused') return;
    this.originBeat = this.pausedBeat;
    this.originSeconds = atSeconds;
    this._state = 'running';
  }

  /**
   * Change tempo. While running, pass the current absolute time: the
   * origin re-anchors there so the beat position stays continuous, and
   * the step lands at the current beat. Otherwise the change applies
   * from beat 0.
   */
  setBpm(bpm: number, atSeconds?: number): void {
    if (this._state === 'running' && atSeconds !== undefined) {
      const beat = this.beatAt(atSeconds);
      this.originBeat = beat;
      this.originSeconds = atSeconds;
      this.tempo.setBpm(beat, bpm);
    } else {
      this.tempo.setBpm(0, bpm);
    }
  }

  /**
   * Ramp the tempo linearly over `overBeats`. While running, pass the
   * current absolute time: the ramp anchors at the current beat (a step
   * point pinning the current instantaneous bpm, so already-played tempo
   * history is untouched) and the origin re-anchors for continuity, the
   * same guarantees setBpm gives. Otherwise the ramp starts at beat 0.
   */
  rampBpm(bpm: number, overBeats: number, atSeconds?: number): void {
    if (!(overBeats > 0)) throw new Error(`invalid ramp span: ${overBeats}`);
    let beat = 0;
    if (this._state === 'running' && atSeconds !== undefined) {
      beat = this.beatAt(atSeconds);
      this.tempo.setBpm(beat, this.tempo.bpmAt(beat));
      this.originBeat = beat;
      this.originSeconds = atSeconds;
    }
    this.tempo.rampTo(beat + overBeats, bpm);
  }

  /** Beat position at an absolute time. Paused transports report the frozen beat. */
  beatAt(seconds: number): number {
    if (this._state === 'paused') return this.pausedBeat;
    if (this._state === 'stopped') return 0;
    const originTime = this.tempo.beatToSeconds(this.originBeat);
    return this.tempo.secondsToBeat(originTime + (seconds - this.originSeconds));
  }

  /** Absolute time at which the transport reaches `beat`. Inverse of beatAt while running. */
  secondsAt(beat: number): number {
    const originTime = this.tempo.beatToSeconds(this.originBeat);
    return this.originSeconds + this.tempo.beatToSeconds(beat) - originTime;
  }

  /** Set the meter from `bar` (zero-based) onward. */
  setMeter(bar: number, meter: Meter): void {
    if (!Number.isInteger(bar) || bar < 0) throw new Error(`invalid meter bar: ${bar}`);
    beatsPerBar(meter); // validates
    const ms = this.meters;
    let i = 0;
    while (i < ms.length && ms[i].bar < bar) i++;
    if (i < ms.length && ms[i].bar === bar) ms[i] = { bar, meter, startBeat: 0 };
    else ms.splice(i, 0, { bar, meter, startBeat: 0 });
    for (let j = 1; j < ms.length; j++) {
      const prev = ms[j - 1];
      ms[j].startBeat = prev.startBeat + (ms[j].bar - prev.bar) * beatsPerBar(prev.meter);
    }
  }

  /** Bar, beat-in-bar, and beat phase at an absolute time, honoring meter changes. */
  position(seconds: number): TransportPosition {
    const beat = this.beatAt(seconds);
    const ms = this.meters;
    let i = ms.length - 1;
    while (i > 0 && ms[i].startBeat > beat) i--;
    const seg = ms[i];
    const bpb = beatsPerBar(seg.meter);
    const barsIn = Math.floor((beat - seg.startBeat) / bpb);
    const beatInBar = beat - seg.startBeat - barsIn * bpb;
    return {
      bar: seg.bar + barsIn,
      beat: Math.floor(beatInBar),
      phase: beatInBar - Math.floor(beatInBar),
    };
  }

  /** Configure swing. amount in [0, 1], subdivision in beats (0.5 = eighth notes). */
  setSwing(amount: number, subdivision = 0.5): void {
    if (!(amount >= 0 && amount <= 1)) throw new Error(`swing amount out of range: ${amount}`);
    if (!(subdivision > 0)) throw new Error(`invalid swing subdivision: ${subdivision}`);
    this.swingAmount = amount;
    this.swingSubdivision = subdivision;
  }

  /**
   * Apply swing to a beat position. With step n = floor(beat / subdivision),
   * odd steps shift late by amount * subdivision * 0.5 beats; even steps
   * and zero swing pass through unchanged.
   */
  swungBeat(beat: number): number {
    if (this.swingAmount === 0) return beat;
    const n = Math.floor(beat / this.swingSubdivision + 1e-9);
    if ((n & 1) === 0) return beat;
    return beat + this.swingAmount * this.swingSubdivision * 0.5;
  }

  /**
   * Iterate every subdivision tick whose (swung) time falls in
   * [fromSec, toSec). Honors the tempo curve and swing. Yields nothing
   * unless running. This drives clock callbacks: on each timer wakeup
   * the caller asks for the window it is about to schedule.
   */
  *scheduleHorizon(
    fromSec: number,
    toSec: number,
    subdivision: number,
  ): Generator<TransportTick, void, void> {
    if (this._state !== 'running') return;
    if (!(subdivision > 0)) throw new Error(`invalid subdivision: ${subdivision}`);
    const startBeat = this.beatAt(fromSec);
    // Swing delays a tick by at most subdivision / 2, so backing up one
    // step from the window start covers every candidate.
    let n = Math.max(0, Math.floor(startBeat / subdivision - 1e-9) - 1);
    for (;;) {
      const beat = this.swungBeat(n * subdivision);
      const seconds = this.secondsAt(beat);
      if (seconds >= toSec) return;
      if (seconds >= fromSec) yield { beat, seconds, step: n };
      n++;
    }
  }
}
