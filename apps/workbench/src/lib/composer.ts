/*
 * The piece brain. Given a booted Bellows instance and the bench state, a
 * Composer builds the whole generative arrangement from the seed: chord
 * progression, per-track euclidean gates, markov melody matrices with
 * chord-tone gravity, nearest-motion pad voicings, and drum patterns. One
 * clock subscription walks a 16-step cycle over an 8 bar phrase.
 *
 * Every stochastic decision flows through b.rng() streams, so a seed fully
 * determines the piece and offline renders reproduce it.
 */

import type { Bellows, Instrument, BusHandle } from 'bellowsjs';
import {
  Scale,
  buildProgression,
  buildStepwiseMatrix,
  weightedWalk,
  voiceLead,
  detectChord,
  pitchClassName,
  mod12,
  clamp,
} from 'bellowsjs';

export const STEPS = 16;
export const PROG_BARS = 8;
const MEL_STATES = 15;
const STATE_IDX: number[] = [];
for (let i = 0; i < MEL_STATES; i++) STATE_IDX.push(i);

/* ------------------------------------------------------------------ */
/* shared state contracts (the store implements these)                 */
/* ------------------------------------------------------------------ */

export interface MacroState {
  label: string;
  param: string;
  min: number;
  max: number;
  value: number;
  /** kit strips address one of three drum channels */
  target?: 'kick' | 'snare' | 'hat';
}

export type TrackRole = 'bass' | 'melody' | 'pad' | 'kit' | 'texture';

export interface TrackState {
  id: string;
  name: string;
  kind: 'melodic' | 'pad' | 'kit';
  role: TrackRole;
  engine: string;
  oct: number;
  pulses: number;
  rot: number;
  density: number;
  level: number;
  mute: boolean;
  sendDelay: number;
  sendVerb: number;
  macros: MacroState[];
  pattern: number[];
}

export interface FxState {
  delayTime: number;
  delayFb: number;
  verbSize: number;
  verbDecay: number;
  comp: boolean;
}

/** The slice of bench state the composer reads every tick. */
export interface PieceState {
  mood: string;
  evolve: boolean;
  root: number;
  scaleName: string;
  tracks: TrackState[];
  fx: FxState;
}

export interface DrawItem {
  t: number;
  step: number;
  bar: number;
  chord: string;
  phrase: string;
}

/* ------------------------------------------------------------------ */
/* engine macro maps: the loudest params of each engine                */
/* ------------------------------------------------------------------ */

export const ENGINE_MACROS: Record<string, MacroState[]> = {
  va: [
    { label: 'CUTOFF', param: 'cutoff', min: 120, max: 12000, value: 2800 },
    { label: 'RESO', param: 'resonance', min: 0, max: 0.95, value: 0.3 },
    { label: 'ENV AMT', param: 'envAmount', min: 0, max: 5, value: 2.2 },
  ],
  fm: [
    { label: 'BRIGHT', param: 'brightness', min: 0, max: 2, value: 0.7 },
    { label: 'FEEDBK', param: 'feedback', min: 0, max: 1, value: 0.15 },
    { label: 'DECAY', param: 'decay', min: 0.05, max: 4, value: 0.5 },
  ],
  additive: [
    { label: 'ROLLOFF', param: 'rolloff', min: 0.3, max: 1, value: 0.75 },
    { label: 'INHARM', param: 'inharm', min: 0, max: 0.02, value: 0.002 },
    { label: 'DECAY', param: 'decay', min: 0.1, max: 12, value: 3 },
  ],
  wavetable: [
    { label: 'POS', param: 'position', min: 0, max: 1, value: 0.2 },
    { label: 'SCAN', param: 'scanDepth', min: 0, max: 1, value: 0.35 },
    { label: 'CUTOFF', param: 'cutoff', min: 120, max: 14000, value: 6000 },
  ],
  pluck: [
    { label: 'DAMP', param: 'damp', min: 0, max: 1, value: 0.35 },
    { label: 'PICK', param: 'pickPos', min: 0.02, max: 0.95, value: 0.28 },
    { label: 'DECAY', param: 'decay', min: 0.2, max: 8, value: 2.5 },
  ],
  string: [
    { label: 'DAMP', param: 'damp', min: 0, max: 1, value: 0.35 },
    { label: 'SUSTAIN', param: 'sustain', min: 0, max: 1, value: 0.6 },
    { label: 'BOW', param: 'bow', min: 0, max: 1, value: 0 },
  ],
  tube: [
    { label: 'BREATH', param: 'breath', min: 0, max: 1, value: 0.85 },
    { label: 'NOISE', param: 'noise', min: 0, max: 1, value: 0.12 },
  ],
  modal: [
    { label: 'BRIGHT', param: 'brightness', min: 0, max: 1, value: 0.5 },
    { label: 'DECAY', param: 'decay', min: 0.1, max: 10, value: 2 },
    { label: 'STRIKE', param: 'strikeHardness', min: 0, max: 1, value: 0.6 },
  ],
  westcoast: [
    { label: 'FOLD', param: 'foldAmount', min: 0, max: 1, value: 0.4 },
    { label: 'COLOR', param: 'lpgColor', min: 0, max: 1, value: 0.7 },
    { label: 'LPG DEC', param: 'lpgDecay', min: 0.02, max: 3, value: 0.4 },
  ],
  formant: [
    { label: 'VOWEL', param: 'vowel', min: 0, max: 4, value: 0 },
    { label: 'BREATH', param: 'breath', min: 0, max: 1, value: 0.15 },
    { label: 'VIB', param: 'vibratoDepth', min: 0, max: 2, value: 0.3 },
  ],
  granular: [
    { label: 'GRAIN', param: 'grainSize', min: 15, max: 400, value: 90 },
    { label: 'DENSITY', param: 'density', min: 2, max: 120, value: 24 },
    { label: 'SPRAY', param: 'spray', min: 0, max: 1, value: 0.08 },
  ],
  harmonic: [
    { label: 'BRIGHT', param: 'brightness', min: 0, max: 1, value: 0.5 },
    { label: 'EVENODD', param: 'evenOdd', min: 0, max: 1, value: 0.5 },
    { label: 'NOISE', param: 'noiseMix', min: 0, max: 1, value: 0.1 },
  ],
};

export const KIT_MACROS: MacroState[] = [
  { label: 'KICK DRV', param: 'drive', min: 0, max: 10, value: 2, target: 'kick' },
  { label: 'SNR TONE', param: 'tone', min: 0, max: 1, value: 0.5, target: 'snare' },
  { label: 'HAT DEC', param: 'decay', min: 0.02, max: 0.35, value: 0.08, target: 'hat' },
];

/** Every melodic engine, offered on every melodic strip. */
export const MELODIC_ENGINES: Array<[string, string]> = [
  ['va', 'VA'],
  ['fm', 'FM'],
  ['additive', 'ADDITIVE'],
  ['wavetable', 'WAVETBL'],
  ['pluck', 'PLUCK'],
  ['string', 'STRING'],
  ['tube', 'TUBE'],
  ['modal', 'MODAL'],
  ['westcoast', 'WESTCST'],
  ['formant', 'FORMANT'],
  ['harmonic', 'HARMONIC'],
  ['granular', 'GRANULAR'],
];

export function macrosFor(engine: string): MacroState[] {
  const src = engine === 'kit' ? KIT_MACROS : ENGINE_MACROS[engine] ?? [];
  return src.map((m) => ({ ...m }));
}

/** Longer envelopes when an engine with an ADSR lands on the pad strip. */
function padParams(engine: string): Record<string, number> {
  switch (engine) {
    case 'va':
      return { attack: 0.5, release: 1.6, sustain: 0.85, cutoff: 3200 };
    case 'wavetable':
      return { attack: 0.5, release: 1.6, sustain: 0.85 };
    case 'fm':
      return { attack: 0.6, release: 1.6, sustain: 0.8 };
    case 'additive':
      return { attack: 0.8, release: 2 };
    case 'harmonic':
      return { attack: 0.6, release: 2 };
    default:
      return {};
  }
}

/* ------------------------------------------------------------------ */
/* moods                                                               */
/* ------------------------------------------------------------------ */

export interface MoodDef {
  scaleName: string;
  bpm: number;
  swing: number;
  tracks: Record<string, Partial<Pick<TrackState, 'engine' | 'oct' | 'pulses' | 'density' | 'level' | 'mute'>>>;
}

export const MOODS: Record<string, MoodDef> = {
  EMBER: {
    scaleName: 'minor', bpm: 76, swing: 14,
    tracks: {
      bass: { engine: 'va', pulses: 4, density: 0.9 },
      keys: { engine: 'pluck', pulses: 5, density: 0.62 },
      pad: { engine: 'formant', level: 0.55, mute: false },
      chime: { engine: 'pluck', pulses: 3, density: 0.45 },
      kit: { mute: false, pulses: 5, density: 0.7, level: 0.5 },
      texture: { engine: 'granular', pulses: 2, density: 0.5, level: 0.4 },
    },
  },
  DRAW: {
    scaleName: 'dorian', bpm: 62, swing: 6,
    tracks: {
      bass: { engine: 'harmonic', pulses: 2, density: 0.95, oct: 2 },
      keys: { engine: 'fm', pulses: 3, density: 0.5 },
      pad: { engine: 'additive', level: 0.6, mute: false },
      chime: { engine: 'modal', pulses: 2, density: 0.5, oct: 6 },
      kit: { mute: true },
      texture: { engine: 'granular', pulses: 3, density: 0.6, level: 0.5 },
    },
  },
  TEMPER: {
    scaleName: 'dorian', bpm: 112, swing: 8,
    tracks: {
      bass: { engine: 'va', pulses: 7, density: 0.95 },
      keys: { engine: 'fm', pulses: 6, density: 0.8 },
      pad: { engine: 'formant', level: 0.38, mute: false },
      chime: { engine: 'pluck', pulses: 4, density: 0.5 },
      kit: { mute: false, pulses: 9, density: 0.95, level: 0.75 },
      texture: { engine: 'harmonic', pulses: 4, density: 0.55, level: 0.35 },
    },
  },
  BILLOW: {
    scaleName: 'lydian', bpm: 88, swing: 12,
    tracks: {
      bass: { engine: 'va', pulses: 4, density: 0.85 },
      keys: { engine: 'pluck', pulses: 5, density: 0.7 },
      pad: { engine: 'additive', level: 0.6, mute: false },
      chime: { engine: 'westcoast', pulses: 5, density: 0.6 },
      kit: { mute: false, pulses: 6, density: 0.6, level: 0.45 },
      texture: { engine: 'granular', pulses: 3, density: 0.65, level: 0.5 },
    },
  },
  QUENCH: {
    scaleName: 'harmonic minor', bpm: 70, swing: 4,
    tracks: {
      bass: { engine: 'fm', pulses: 3, density: 0.85 },
      keys: { engine: 'fm', pulses: 4, density: 0.55 },
      pad: { engine: 'formant', level: 0.45, mute: false },
      chime: { engine: 'modal', pulses: 3, density: 0.6, oct: 6 },
      kit: { mute: true },
      texture: { engine: 'harmonic', pulses: 2, density: 0.5, level: 0.45 },
    },
  },
  STRIKE: {
    scaleName: 'minor pentatonic', bpm: 126, swing: 16,
    tracks: {
      bass: { engine: 'va', pulses: 6, density: 0.95 },
      keys: { engine: 'pluck', pulses: 7, density: 0.85 },
      pad: { engine: 'formant', level: 0.34, mute: false },
      chime: { engine: 'pluck', pulses: 5, density: 0.65 },
      kit: { mute: false, pulses: 11, density: 0.95, level: 0.8 },
      texture: { engine: 'modal', pulses: 4, density: 0.6, level: 0.4 },
    },
  },
};

/* ------------------------------------------------------------------ */
/* the composer                                                        */
/* ------------------------------------------------------------------ */

interface Lane {
  track: TrackState;
  matrix: number[][];
  state: number;
}

interface Snapshot {
  lanes: Map<string, { matrix: number[][]; state: number }>;
  prevVoicing: number[];
  evoCount: number;
  lastEvoBar: number;
}

export class Composer {
  readonly drawQueue: DrawItem[] = [];

  private readonly b: Bellows;
  private readonly piece: PieceState;
  private scale: Scale;
  private readonly prog: number[];
  private chordLabels: string[];
  private readonly delayBus: BusHandle;
  private readonly verbBus: BusHandle;
  private readonly insts = new Map<string, Instrument>();
  private kit: Record<'kick' | 'snare' | 'hat', Instrument> | null = null;
  private readonly lanes = new Map<string, Lane>();
  private prevVoicing: number[] = [];
  private kickPat: number[] = [];
  private snarePat: number[] = [];
  private evoCount = 0;
  private lastEvoBar = 0;
  private rendering = false;
  private snap: Snapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(b: Bellows, piece: PieceState) {
    this.b = b;
    this.piece = piece;
    const mood = piece.mood;
    this.scale = new Scale(piece.root, piece.scaleName);

    this.prog = buildProgression(b.rng('prog:' + mood), PROG_BARS);
    this.chordLabels = this.prog.map((d) => this.labelChord(d));

    this.delayBus = b.bus(
      [['delay', {
        timeL: piece.fx.delayTime,
        timeR: Math.min(piece.fx.delayTime * 1.5, 3.8),
        feedback: piece.fx.delayFb,
        mix: 1,
      }]],
      { level: 0.85 },
    );
    this.verbBus = b.bus(
      [['fdn', { size: piece.fx.verbSize, decay: piece.fx.verbDecay, mix: 1 }]],
      { level: 0.9 },
    );
    this.applyMasterFx();

    for (const tr of piece.tracks) {
      if (tr.kind === 'kit') this.buildKit(tr);
      else this.buildMelodic(tr);
    }

    const dr = b.rng('drums:' + mood);
    this.kickPat = b.euclid(STEPS, 2 + dr.int(3), 0);
    this.snarePat = new Array<number>(STEPS).fill(0);
    this.snarePat[4] = 1;
    this.snarePat[12] = 1;
    if (dr.chance(0.3)) this.snarePat[14] = 1;
    if (dr.chance(0.15)) this.snarePat[7] = 1;

    for (const tr of piece.tracks) {
      if (tr.role === 'melody' || tr.role === 'texture' || tr.role === 'bass') {
        this.lanes.set(tr.id, {
          track: tr,
          matrix: buildStepwiseMatrix(STATE_IDX, b.rng('mx:' + tr.id)),
          state: 4 + b.rng('st:' + tr.id).int(7),
        });
      }
    }

    this.unsubscribe = b.clock.at('16n', (t, step) => this.tick(t, step));
  }

  /* ---------------- channel construction ---------------- */

  private buildMelodic(tr: TrackState): void {
    const params: Record<string, number> = tr.kind === 'pad' ? padParams(tr.engine) : {};
    for (const m of tr.macros) {
      if (!m.target) params[m.param] = m.value;
    }
    const inst = this.b.voice(tr.engine, params);
    inst.gain(tr.level);
    inst.send(this.delayBus, tr.sendDelay);
    inst.send(this.verbBus, tr.sendVerb);
    this.insts.set(tr.id, inst);
  }

  private buildKit(tr: TrackState): void {
    const kick = this.b.voice('kick');
    const snare = this.b.voice('snare');
    const hat = this.b.voice('hat');
    this.kit = { kick, snare, hat };
    this.setLevel(tr);
    snare.send(this.verbBus, tr.sendVerb);
    hat.send(this.delayBus, tr.sendDelay);
    for (const m of tr.macros) this.setMacro(tr, m);
  }

  /**
   * The interchangeable-engines move: spin up a fresh channel on the new
   * engine, hand the score over, and silence the old channel. The walk,
   * the pattern, and the phrase never notice.
   */
  swapEngine(tr: TrackState): void {
    if (tr.kind === 'kit') return;
    const old = this.insts.get(tr.id);
    this.buildMelodic(tr);
    if (old) {
      try {
        old.allOff();
        old.gain(0);
      } catch {
        // the old channel is already gone; nothing to silence
      }
    }
  }

  /* ---------------- per-control plumbing ---------------- */

  setLevel(tr: TrackState): void {
    if (tr.kind === 'kit') {
      if (!this.kit) return;
      this.kit.kick.gain(tr.level);
      this.kit.snare.gain(tr.level * 0.8);
      this.kit.hat.gain(tr.level * 0.5);
      return;
    }
    this.insts.get(tr.id)?.gain(tr.level);
  }

  setSends(tr: TrackState): void {
    if (tr.kind === 'kit') {
      if (!this.kit) return;
      this.kit.snare.send(this.verbBus, tr.sendVerb);
      this.kit.hat.send(this.delayBus, tr.sendDelay);
      return;
    }
    const inst = this.insts.get(tr.id);
    if (!inst) return;
    inst.send(this.delayBus, tr.sendDelay);
    inst.send(this.verbBus, tr.sendVerb);
  }

  setMacro(tr: TrackState, m: MacroState): void {
    if (tr.kind === 'kit') {
      if (!this.kit || !m.target) return;
      this.kit[m.target].param(m.param, m.value);
      return;
    }
    this.insts.get(tr.id)?.param(m.param, m.value);
  }

  setScale(root: number, scaleName: string): void {
    this.scale = new Scale(root, scaleName);
    this.chordLabels = this.prog.map((d) => this.labelChord(d));
  }

  setDelay(time: number, feedback: number): void {
    this.delayBus.fxParam(0, 'timeL', time);
    this.delayBus.fxParam(0, 'timeR', Math.min(time * 1.5, 3.8));
    this.delayBus.fxParam(0, 'feedback', feedback);
  }

  setVerb(size: number, decay: number): void {
    this.verbBus.fxParam(0, 'size', size);
    this.verbBus.fxParam(0, 'decay', decay);
  }

  applyMasterFx(): void {
    if (this.piece.fx.comp) {
      this.b.masterFx(
        ['compressor', { threshold: -16, ratio: 3, attack: 0.005, release: 0.2, knee: 8, makeup: 3 }],
        ['limiter', { ceiling: -0.5 }],
      );
    } else {
      this.b.masterFx(['limiter', { ceiling: -0.5 }]);
    }
  }

  /** Reset phrase-position bookkeeping for a transport restart. */
  resetPosition(): void {
    this.lastEvoBar = 0;
    this.prevVoicing = [];
    this.drawQueue.length = 0;
  }

  clearQueue(): void {
    this.drawQueue.length = 0;
  }

  /* ---------------- offline render support ---------------- */

  /**
   * b.render() re-runs the clock callback offline, which would advance the
   * live melodic state. Snapshot before, restore after, so a render leaves
   * the playing piece untouched.
   */
  beginRender(): void {
    const lanes = new Map<string, { matrix: number[][]; state: number }>();
    for (const [id, lane] of this.lanes) lanes.set(id, { matrix: lane.matrix, state: lane.state });
    this.snap = {
      lanes,
      prevVoicing: this.prevVoicing.slice(),
      evoCount: this.evoCount,
      lastEvoBar: this.lastEvoBar,
    };
    this.prevVoicing = [];
    this.lastEvoBar = 0;
    this.rendering = true;
  }

  endRender(): void {
    this.rendering = false;
    if (!this.snap) return;
    for (const [id, s] of this.snap.lanes) {
      const lane = this.lanes.get(id);
      if (lane) {
        lane.matrix = s.matrix;
        lane.state = s.state;
      }
    }
    this.prevVoicing = this.snap.prevVoicing;
    this.evoCount = this.snap.evoCount;
    this.lastEvoBar = this.snap.lastEvoBar;
    this.snap = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.unsubscribe) this.unsubscribe();
    try {
      for (const inst of this.insts.values()) inst.allOff();
      if (this.kit) {
        this.kit.kick.allOff();
        this.kit.snare.allOff();
        this.kit.hat.allOff();
      }
    } catch {
      // the bellows instance may already be disposed
    }
  }

  /* ---------------- the clock callback ---------------- */

  private tick(t: number, step: number): void {
    if (this.disposed) return;
    const piece = this.piece;
    const s = step % STEPS;
    const bar = Math.floor(step / STEPS);

    if (s === 0 && piece.evolve && bar > 0 && bar % 4 === 0 && bar !== this.lastEvoBar) {
      this.lastEvoBar = bar;
      this.evoCount++;
      for (const lane of this.lanes.values()) {
        if (lane.track.role === 'bass') continue;
        lane.matrix = buildStepwiseMatrix(
          STATE_IDX,
          this.b.rng('mx:' + lane.track.id + ':evo' + this.evoCount),
        );
      }
    }

    const chord = this.prog[bar % PROG_BARS];
    const len = this.scale.length;
    const chordSet = new Set<number>();
    for (const off of [0, 2, 4]) {
      const pos = (((chord + off) % len) + len) % len;
      for (let j = pos; j < MEL_STATES; j += len) chordSet.add(j);
    }

    if (!this.rendering) {
      this.drawQueue.push({
        t,
        step: s,
        bar,
        chord: this.chordLabels[bar % PROG_BARS],
        phrase: Math.floor(bar / 4) % 2 === 0 ? 'A' : 'B',
      });
      if (this.drawQueue.length > 128) this.drawQueue.splice(0, this.drawQueue.length - 128);
    }

    for (const tr of piece.tracks) {
      if (tr.mute) continue;
      if (tr.kind === 'kit') {
        this.tickKit(tr, s, t);
        continue;
      }
      if (!tr.pattern[s]) continue;
      if (!this.b.rng('gate:' + tr.id).chance(tr.density)) continue;
      const inst = this.insts.get(tr.id);
      if (!inst) continue;
      const vel = 0.5 + this.b.rng('vel:' + tr.id).range(0, 0.4);
      const at = Math.max(0, t + this.b.rng('hum:' + tr.id).range(-0.003, 0.003));

      try {
        if (tr.kind === 'pad') {
          const voicing = this.voiceChord(chord);
          for (const m of voicing) inst.note(m, { at, dur: 3.8, vel: vel * 0.75 });
          continue;
        }
        const midi = this.nextMidi(tr, chord, chordSet, len);
        if (midi === null) continue;
        const dr = this.b.rng('dur:' + tr.id);
        let dur: number;
        if (tr.role === 'bass') dur = 0.4;
        else if (tr.role === 'texture') dur = dr.chance(0.4) ? 2 : 1;
        else dur = dr.chance(0.25) ? 0.75 : 0.35;
        inst.note(midi, { at, dur, vel });
      } catch (err) {
        // a bad param or disposed channel must not kill the clock
        if (!this.rendering) console.error('bellows tick:', err);
      }
    }
  }

  private nextMidi(tr: TrackState, chord: number, chordSet: Set<number>, len: number): number | null {
    if (tr.role === 'bass') {
      const r = this.b.rng('bassdeg');
      let degree = chord;
      if (r.chance(0.14)) degree += 4;
      else if (r.chance(0.1)) degree += len;
      return this.scale.degreeToMidi(degree, clamp(tr.oct, 1, 7));
    }
    const lane = this.lanes.get(tr.id);
    if (!lane) return null;
    lane.state = weightedWalk(lane.matrix, lane.state, this.b.rng('walk:' + tr.id), chordSet, 2.6);
    return this.scale.degreeToMidi(lane.state, clamp(tr.oct, 1, 7));
  }

  private tickKit(tr: TrackState, s: number, t: number): void {
    if (!this.kit) return;
    const kr = this.b.rng('kit');
    try {
      if (this.kickPat[s] && kr.chance(0.97)) {
        this.kit.kick.note(36, { at: t, dur: 0.25, vel: 0.85 + kr.range(0, 0.15) });
      }
      if (this.snarePat[s] && kr.chance(0.95)) {
        this.kit.snare.note(38, { at: t, dur: 0.25, vel: 0.7 + kr.range(0, 0.25) });
      }
      if (tr.pattern[s] && kr.chance(tr.density)) {
        const base = tr.macros.find((m) => m.target === 'hat')?.value ?? 0.08;
        const open = kr.chance(0.08);
        this.kit.hat.param('decay', open ? Math.max(0.25, base * 3) : base, t);
        this.kit.hat.note(42, { at: t + 0.001, dur: 0.2, vel: 0.45 + kr.range(0, 0.3) });
      }
    } catch (err) {
      if (!this.rendering) console.error('bellows kit tick:', err);
    }
  }

  /* ---------------- harmony helpers ---------------- */

  private voiceChord(chord: number): number[] {
    const r = this.b.rng('pad');
    const degs = r.chance(0.35) ? [0, 2, 4, 6] : [0, 2, 4];
    const midis = degs.map((k) => this.scale.degreeToMidi(chord + k, 3));
    try {
      const v = voiceLead(this.prevVoicing, [midis], { low: 48, high: 78 });
      this.prevVoicing = v;
      return v;
    } catch {
      this.prevVoicing = midis;
      return midis;
    }
  }

  private labelChord(degree: number): string {
    const midis = [0, 2, 4].map((k) => this.scale.degreeToMidi(degree + k, 3));
    const name = detectChord(midis.map((m) => mod12(m)));
    return name ?? pitchClassName(mod12(midis[0]));
  }
}
