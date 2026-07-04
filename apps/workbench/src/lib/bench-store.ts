/*
 * Reactive state and actions for the generative workbench. Components stay
 * dumb: they read `bench` and call the exported actions, which guard on the
 * audio engine being booted. Sound only ever starts inside a user gesture
 * via ensureBellows().
 */

import { reactive, shallowRef } from 'vue';
import { euclid, Tuning, clamp } from 'bellowsjs';
import type { Bellows } from 'bellowsjs';
import { bellows, ensureBellows } from './audio';
import {
  Composer,
  MOODS,
  PROG_BARS,
  STEPS,
  macrosFor,
  type FxState,
  type MacroState,
  type PieceState,
  type TrackState,
} from './composer';

/* ------------------------------------------------------------------ */
/* seed words                                                          */
/* ------------------------------------------------------------------ */

const W1 = ['ember', 'ingot', 'tuyere', 'quench', 'billow', 'draw', 'strike', 'temper', 'forge', 'slag', 'anvil', 'crucible'];
const W2 = ['iron', 'brass', 'copper', 'ash', 'soot', 'flux', 'oxide', 'carbon', 'tin', 'zinc'];

export function freshSeed(): string {
  const p = (a: string[]) => a[(Math.random() * a.length) | 0];
  return p(W1) + '-' + p(W2) + '-' + (100 + ((Math.random() * 900) | 0));
}

/* ------------------------------------------------------------------ */
/* tuning systems                                                      */
/* ------------------------------------------------------------------ */

export type TuningSystemId = '12edo' | '19edo' | '24edo' | '31edo' | 'ji';

export const TUNING_SYSTEMS: Array<{ id: TuningSystemId; label: string }> = [
  { id: '12edo', label: '12-EDO' },
  { id: '19edo', label: '19-EDO' },
  { id: '24edo', label: '24-EDO' },
  { id: '31edo', label: '31-EDO' },
  { id: 'ji', label: 'JUST 5-LIMIT' },
];

function tuningFor(id: TuningSystemId): Tuning {
  switch (id) {
    case '19edo': return Tuning.edo(19);
    case '24edo': return Tuning.edo(24);
    case '31edo': return Tuning.edo(31);
    case 'ji':
      return Tuning.ji(
        [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8],
        440, 69,
      );
    default: return Tuning.edo(12);
  }
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface BenchState extends PieceState {
  ready: boolean;
  playing: boolean;
  busy: boolean;
  error: string;
  seed: string;
  bpm: number;
  /** swing percent 0..60 */
  swing: number;
  /** master percent 0..100 */
  master: number;
  tuningSystem: TuningSystemId;
  fx: FxState;
  readout: { chord: string; bar: number; phrase: string; step: number };
  meterInfo: { voices: number; sr: number; peakL: number; peakR: number; rmsL: number; rmsR: number };
  render: { busy: boolean; ms: number; url: string; name: string };
}

function patternFor(pulses: number, rot: number): number[] {
  return euclid(clamp(pulses, 0, STEPS), STEPS, ((rot % STEPS) + STEPS) % STEPS);
}

function track(t: Omit<TrackState, 'macros' | 'pattern'>): TrackState {
  return {
    ...t,
    macros: macrosFor(t.kind === 'kit' ? 'kit' : t.engine),
    pattern: patternFor(t.pulses, t.rot),
  };
}

export function defaultTracks(): TrackState[] {
  return [
    track({ id: 'bass', name: 'BASS', kind: 'melodic', role: 'bass', engine: 'va', oct: 2, pulses: 5, rot: 0, density: 0.92, level: 0.8, mute: false, sendDelay: 0.04, sendVerb: 0.1 }),
    track({ id: 'keys', name: 'KEYS', kind: 'melodic', role: 'melody', engine: 'fm', oct: 4, pulses: 6, rot: 2, density: 0.78, level: 0.62, mute: false, sendDelay: 0.22, sendVerb: 0.22 }),
    track({ id: 'pad', name: 'PAD', kind: 'pad', role: 'pad', engine: 'formant', oct: 3, pulses: 1, rot: 0, density: 1, level: 0.5, mute: false, sendDelay: 0.05, sendVerb: 0.45 }),
    track({ id: 'chime', name: 'CHIME', kind: 'melodic', role: 'melody', engine: 'pluck', oct: 5, pulses: 3, rot: 4, density: 0.55, level: 0.5, mute: false, sendDelay: 0.3, sendVerb: 0.35 }),
    track({ id: 'kit', name: 'KIT', kind: 'kit', role: 'kit', engine: 'kit', oct: 3, pulses: 7, rot: 0, density: 0.9, level: 0.7, mute: false, sendDelay: 0.06, sendVerb: 0.12 }),
    track({ id: 'texture', name: 'TEXTURE', kind: 'melodic', role: 'texture', engine: 'granular', oct: 4, pulses: 2, rot: 5, density: 0.6, level: 0.45, mute: false, sendDelay: 0.15, sendVerb: 0.5 }),
  ];
}

export const bench: BenchState = reactive({
  ready: false,
  playing: false,
  busy: false,
  error: '',
  seed: freshSeed(),
  mood: 'EMBER',
  evolve: true,
  root: 2,
  scaleName: 'minor',
  bpm: 92,
  swing: 10,
  master: 78,
  tuningSystem: '12edo' as TuningSystemId,
  fx: { delayTime: 0.42, delayFb: 0.35, verbSize: 1.2, verbDecay: 3, comp: true },
  tracks: defaultTracks(),
  readout: { chord: '--', bar: 0, phrase: 'A', step: -1 },
  meterInfo: { voices: 0, sr: 0, peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 },
  render: { busy: false, ms: 0, url: '', name: '' },
});

export const composer = shallowRef<Composer | null>(null);

/*
 * The Bellows instance the current composer was built against. Code mode
 * disposes and reboots the shared instance under us, so play must reforge
 * when the live instance is not the one the composer holds.
 */
let composedFor: Bellows | null = null;

function fail(err: unknown): void {
  bench.error = err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* mood application                                                    */
/* ------------------------------------------------------------------ */

/**
 * Apply the active mood's presets to the tracks. When a Bellows instance
 * is given the seeded parts (root pick, bpm jitter) come from its rng
 * streams so seed plus mood fully determine the setup.
 */
function applyMood(b: Bellows | null): void {
  const mood = MOODS[bench.mood];
  if (!mood) return;
  bench.scaleName = mood.scaleName;
  bench.swing = mood.swing;
  if (b) {
    const r = b.rng('mood:' + bench.mood);
    bench.root = r.int(12);
    bench.bpm = clamp(mood.bpm + r.int(9) - 4, 52, 160);
  } else {
    bench.bpm = mood.bpm;
  }
  for (const tr of bench.tracks) {
    const ov = mood.tracks[tr.id];
    if (!ov) continue;
    if (ov.engine !== undefined && tr.kind !== 'kit' && ov.engine !== tr.engine) {
      tr.engine = ov.engine;
      tr.macros = macrosFor(ov.engine);
    }
    if (ov.oct !== undefined) tr.oct = ov.oct;
    if (ov.pulses !== undefined) tr.pulses = ov.pulses;
    if (ov.density !== undefined) tr.density = ov.density;
    if (ov.level !== undefined) tr.level = ov.level;
    tr.mute = ov.mute ?? false;
    if (b) tr.rot = b.rng('rot:' + tr.id).int(8);
    tr.pattern = patternFor(tr.pulses, tr.rot);
  }
}

/* ------------------------------------------------------------------ */
/* boot, play, compose                                                 */
/* ------------------------------------------------------------------ */

function applyGlobals(b: Bellows): void {
  b.bpm(bench.bpm);
  b.swing(clamp(bench.swing, 0, 60) / 100, '16n');
  b.masterGain((bench.master / 100) * 0.9);
  b.tuning = tuningFor(bench.tuningSystem);
}

async function bootAndCompose(seed: string): Promise<void> {
  bench.busy = true;
  try {
    composer.value?.dispose();
    composer.value = null;
    // always pass the seed so a stale instance is disposed and reforged
    const b = await ensureBellows(seed);
    bench.seed = seed;
    applyMood(b);
    composer.value = new Composer(b, bench);
    composedFor = b;
    applyGlobals(b);
    bench.ready = true;
    bench.error = '';
    bench.readout.step = -1;
    bench.readout.bar = 0;
    bench.readout.phrase = 'A';
  } finally {
    bench.busy = false;
  }
}

function startTransport(): void {
  const b = bellows.value;
  const c = composer.value;
  if (!b || !c) return;
  c.resetPosition();
  b.start();
  bench.playing = true;
}

export async function pressPlay(): Promise<void> {
  if (bench.busy) return;
  try {
    // reforge when nothing is composed yet, or when code mode swapped or
    // disposed the shared instance behind our back
    if (!bench.ready || !composer.value || bellows.value !== composedFor) {
      await bootAndCompose(bench.seed);
      startTransport();
      return;
    }
    const b = bellows.value;
    if (!b) return;
    if (bench.playing) {
      b.stop();
      bench.playing = false;
      bench.readout.step = -1;
      composer.value.clearQueue();
    } else {
      startTransport();
    }
  } catch (err) {
    fail(err);
  }
}

export async function compose(seed?: string): Promise<void> {
  if (bench.busy) return;
  try {
    const wasPlaying = bench.playing;
    if (wasPlaying) {
      bellows.value?.stop();
      bench.playing = false;
    }
    await bootAndCompose((seed ?? '').trim() || freshSeed());
    if (wasPlaying) startTransport();
  } catch (err) {
    fail(err);
  }
}

export async function setMood(mood: string): Promise<void> {
  bench.mood = mood;
  if (bench.ready) await compose(bench.seed);
  else applyMood(null);
}

export function toggleEvolve(): void {
  bench.evolve = !bench.evolve;
}

export function panic(): void {
  try {
    bellows.value?.panic();
    composer.value?.clearQueue();
  } catch (err) {
    fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* tuning panel                                                        */
/* ------------------------------------------------------------------ */

export function setRoot(pc: number): void {
  bench.root = clamp(Math.round(pc), 0, 11);
  composer.value?.setScale(bench.root, bench.scaleName);
}

export function setScaleName(name: string): void {
  bench.scaleName = name;
  try {
    composer.value?.setScale(bench.root, name);
  } catch (err) {
    fail(err);
  }
}

export function setBpm(v: number): void {
  bench.bpm = clamp(Math.round(v), 52, 160);
  try {
    bellows.value?.bpm(bench.bpm);
  } catch (err) {
    fail(err);
  }
}

export function setSwing(v: number): void {
  bench.swing = clamp(Math.round(v), 0, 60);
  try {
    bellows.value?.swing(bench.swing / 100, '16n');
  } catch (err) {
    fail(err);
  }
}

export function setMaster(v: number): void {
  bench.master = clamp(Math.round(v), 0, 100);
  bellows.value?.masterGain((bench.master / 100) * 0.9);
}

export function setTuningSystem(id: TuningSystemId): void {
  bench.tuningSystem = id;
  const b = bellows.value;
  if (b) b.tuning = tuningFor(id);
}

/* ------------------------------------------------------------------ */
/* fx panel                                                            */
/* ------------------------------------------------------------------ */

export function setDelayFx(time: number, feedback: number): void {
  bench.fx.delayTime = clamp(time, 0.02, 2);
  bench.fx.delayFb = clamp(feedback, 0, 0.9);
  composer.value?.setDelay(bench.fx.delayTime, bench.fx.delayFb);
}

export function setVerbFx(size: number, decay: number): void {
  bench.fx.verbSize = clamp(size, 0.25, 3);
  bench.fx.verbDecay = clamp(decay, 0.2, 12);
  composer.value?.setVerb(bench.fx.verbSize, bench.fx.verbDecay);
}

export function toggleComp(): void {
  bench.fx.comp = !bench.fx.comp;
  composer.value?.applyMasterFx();
}

/* ------------------------------------------------------------------ */
/* track strip actions                                                 */
/* ------------------------------------------------------------------ */

export function setPulses(tr: TrackState, v: number): void {
  tr.pulses = clamp(Math.round(v), 0, STEPS);
  tr.pattern = patternFor(tr.pulses, tr.rot);
}

export function setRot(tr: TrackState, v: number): void {
  tr.rot = ((Math.round(v) % STEPS) + STEPS) % STEPS;
  tr.pattern = patternFor(tr.pulses, tr.rot);
}

export function setOct(tr: TrackState, v: number): void {
  tr.oct = clamp(Math.round(v), 1, 7);
}

export function setDensity(tr: TrackState, pct: number): void {
  tr.density = clamp(pct, 0, 100) / 100;
}

export function toggleMute(tr: TrackState): void {
  tr.mute = !tr.mute;
}

export function setLevel(tr: TrackState, v: number): void {
  tr.level = clamp(v, 0, 1);
  composer.value?.setLevel(tr);
}

export function setSendDelay(tr: TrackState, v: number): void {
  tr.sendDelay = clamp(v, 0, 1);
  composer.value?.setSends(tr);
}

export function setSendVerb(tr: TrackState, v: number): void {
  tr.sendVerb = clamp(v, 0, 1);
  composer.value?.setSends(tr);
}

export function setMacro(tr: TrackState, macro: MacroState, v: number): void {
  macro.value = clamp(v, macro.min, macro.max);
  try {
    composer.value?.setMacro(tr, macro);
  } catch (err) {
    fail(err);
  }
}

export function switchEngine(tr: TrackState, engine: string): void {
  if (tr.kind === 'kit' || engine === tr.engine) return;
  tr.engine = engine;
  tr.macros = macrosFor(engine);
  try {
    composer.value?.swapEngine(tr);
  } catch (err) {
    fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

export async function renderEight(): Promise<void> {
  const b = bellows.value;
  const c = composer.value;
  if (!b || !c || bench.render.busy) return;
  bench.render.busy = true;
  // b.render is synchronous DSP on the main thread and freezes the page
  // for its duration; two animation frames let the busy lamp paint first
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))));
  const t0 = performance.now();
  try {
    c.beginRender();
    let out: Awaited<ReturnType<Bellows['render']>>;
    try {
      out = await b.render({ bars: PROG_BARS });
    } finally {
      c.endRender();
    }
    const wav = out.wav(16);
    const blob = new Blob([wav], { type: 'audio/wav' });
    if (bench.render.url) URL.revokeObjectURL(bench.render.url);
    bench.render.url = URL.createObjectURL(blob);
    bench.render.name = 'bellows-' + bench.seed + '.wav';
    bench.render.ms = Math.round(performance.now() - t0);
    const a = document.createElement('a');
    a.href = bench.render.url;
    a.download = bench.render.name;
    a.click();
  } catch (err) {
    fail(err);
  } finally {
    bench.render.busy = false;
  }
}

/* ------------------------------------------------------------------ */
/* readout drain, called once per animation frame by the view          */
/* ------------------------------------------------------------------ */

export function drainReadout(): void {
  const b = bellows.value;
  const c = composer.value;
  if (!b || !c) return;
  const horizon = b.now() + 0.02;
  const q = c.drawQueue;
  let item = null;
  while (q.length > 0 && q[0].t <= horizon) item = q.shift() ?? null;
  if (item && bench.playing) {
    bench.readout.step = item.step;
    bench.readout.bar = item.bar;
    bench.readout.chord = item.chord;
    bench.readout.phrase = item.phrase;
  }
  const m = b.meter;
  if (m) {
    bench.meterInfo.voices = m.voices;
    bench.meterInfo.peakL = m.peakL;
    bench.meterInfo.peakR = m.peakR;
    bench.meterInfo.rmsL = m.rmsL;
    bench.meterInfo.rmsR = m.rmsR;
  }
  bench.meterInfo.sr = b.ctx.sampleRate;
}
