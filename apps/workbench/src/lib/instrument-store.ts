/*
 * State and actions for the instrument page. One Bellows channel plays
 * whatever engine is selected; keyboard, mouse, and MIDI all press notes
 * through a single ledger so the piano lamps and sustain logic agree no
 * matter where the note came from. Param and fx-param writes coalesce to
 * one post per frame per name.
 */

import { computed, reactive } from 'vue';
import {
  listEngines,
  listEffects,
  registerBuiltins,
  getPreset,
  SAMPLER_PARAMS,
  type Bellows,
  type Instrument,
  type InstrumentPreset,
  type ParamSpec,
} from 'bellowsjs';
import { bellows as bellowsRef, ensureBellows } from './audio';
import { ensureRegistered, sfState } from './soundfonts';

/* the registries fill at boot normally; fill them now so the UI can list
 * engines and effects before the first sound */
registerBuiltins();

export const MELODIC_ENGINE_IDS = [
  'va',
  'fm',
  'additive',
  'wavetable',
  'pluck',
  'string',
  'tube',
  'modal',
  'westcoast',
  'formant',
  'harmonic',
  'granular',
];

export const PERCUSSION_ENGINE_IDS = ['kick', 'snare', 'hat', 'clap', 'tom', 'noise'];

export interface FxSlot {
  effectId: string;
  params: Record<string, number>;
}

/** Where a note press came from. Octave shift applies to 'kb' only: the
 * piano sends absolute midi numbers (its window already follows the
 * shift), and hardware MIDI is always absolute. */
export type NoteSource = 'kb' | 'ptr' | 'midi';

interface InstState {
  ready: boolean;
  booting: boolean;
  engineId: string;
  params: Record<string, number>;
  fx: FxSlot[];
  gain: number;
  pan: number;
  /** octaves, -3..+3 */
  octave: number;
  /** default velocity 0..1 for keyboard and MIDI-less presses */
  velocity: number;
  sustain: boolean;
  /** live voice count from the kernel meter */
  voices: number;
}

export const instState = reactive<InstState>({
  ready: false,
  booting: false,
  engineId: 'pluck',
  params: {},
  fx: [],
  gain: 0.8,
  pan: 0,
  octave: 0,
  velocity: 0.8,
  sustain: false,
  voices: 0,
});

/** Sounding midi numbers, for lighting piano keys. */
export const activeNotes = reactive(new Set<number>());

/** A listener on actually-sounding notes, for the looper. Ons fire after
 * the ledger resolves them (octave shift applied); offs fire when they
 * really sound, so a sustain-deferred off records once, at pedal release.
 * Times are b.now() seconds. */
export interface NoteTap {
  on(midi: number, vel: number, timeSec: number): void;
  off(midi: number, timeSec: number): void;
}

let noteTap: NoteTap | null = null;
let panicHook: (() => void) | null = null;

export function setNoteTap(tap: NoteTap | null): void {
  noteTap = tap;
}

/** Extra silencer run by panic(), so the looper can hush its layers. */
export function setPanicHook(hook: (() => void) | null): void {
  panicHook = hook;
}

/* ------------------------------------------------------------------ */
/* specs and lookups                                                    */
/* ------------------------------------------------------------------ */

const PRESET_PREFIX = 'preset:';

/** The preset behind a 'preset:<id>' engine id, null for anything else
 * (including a preset id that no longer exists). */
export function presetFor(engineId: string): InstrumentPreset | null {
  if (!engineId.startsWith(PRESET_PREFIX)) return null;
  try {
    return getPreset(engineId.slice(PRESET_PREFIX.length));
  } catch {
    return null;
  }
}

/** Resolve a possibly preset-prefixed engine id to the concrete engine
 * id the kernel knows. Everything that hands an engine id to b.voice
 * (the instrument channel here, layer channels in the looper) goes
 * through this one function. */
export function resolveEngineId(engineId: string): string {
  const preset = presetFor(engineId);
  if (preset) return preset.engineId;
  return engineId.startsWith(PRESET_PREFIX) ? 'pluck' : engineId;
}

/** Specs always come from the underlying engine, so a preset's params
 * stay fully editable in the panel. */
export function paramSpecsFor(engineId: string): ParamSpec[] {
  const resolved = resolveEngineId(engineId);
  if (resolved.startsWith('sampler:')) return SAMPLER_PARAMS;
  return listEngines().find((e) => e.id === resolved)?.params ?? [];
}

export function engineLabel(engineId: string): string {
  const preset = presetFor(engineId);
  if (preset) return preset.label;
  if (engineId.startsWith('sampler:')) {
    return sfState.active.find((a) => a.engineId === engineId)?.label ?? engineId;
  }
  return listEngines().find((e) => e.id === engineId)?.label ?? engineId;
}

export const isPercussion = computed(() => PERCUSSION_ENGINE_IDS.includes(instState.engineId));

function defaultsFor(specs: ParamSpec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of specs) out[s.name] = s.default;
  return out;
}

/** The full param set an engine id starts from: engine defaults, with
 * the preset's curated values layered over them for preset ids. */
function voicingFor(engineId: string): Record<string, number> {
  const out = defaultsFor(paramSpecsFor(engineId));
  const preset = presetFor(engineId);
  if (preset) Object.assign(out, preset.params);
  return out;
}

instState.params = voicingFor(instState.engineId);

/* ------------------------------------------------------------------ */
/* engine channel                                                       */
/* ------------------------------------------------------------------ */

let b: Bellows | null = null;
let voiceHandle: Instrument | null = null;
let meterTimer: ReturnType<typeof setInterval> | null = null;

/** One entry per held key per source. */
const ledger = new Map<string, { noteId: number; sounding: number }>();
/** Keys released while sustain was down, waiting for the pedal. */
const deferred = new Set<string>();
/** How many ledger entries sound each midi number. */
const soundingCount = new Map<number, number>();

function applyMix(): void {
  if (!voiceHandle) return;
  voiceHandle.gain(instState.gain);
  voiceHandle.pan(instState.pan);
}

function postFxChain(): void {
  if (!voiceHandle) return;
  voiceHandle.fx(...instState.fx.map((f) => ({ effectId: f.effectId, params: { ...f.params } })));
}

function clearLedger(): void {
  ledger.clear();
  deferred.clear();
  soundingCount.clear();
  activeNotes.clear();
}

function makeVoice(): void {
  if (!b) return;
  ensureRegistered(b);
  // a reforged kernel only knows currently active banks: a sampler engine
  // whose bank was deactivated falls back to pluck instead of a dead channel
  if (
    instState.engineId.startsWith('sampler:') &&
    !sfState.active.some((a) => a.engineId === instState.engineId)
  ) {
    instState.engineId = 'pluck';
    instState.params = defaultsFor(paramSpecsFor('pluck'));
  }
  voiceHandle = b.voice(resolveEngineId(instState.engineId), { ...instState.params });
  applyMix();
  postFxChain();
}

/** The workbench can reforge the shared Bellows instance; if it did, our
 * channel is gone and the voice rebuilds on the new instance. */
function syncInstance(): void {
  if (!instState.ready) return;
  const cur = bellowsRef.value;
  if (cur && cur !== b) {
    b = cur;
    clearLedger();
    makeVoice();
  }
}

export async function boot(): Promise<void> {
  if (instState.ready || instState.booting) return;
  instState.booting = true;
  try {
    b = await ensureBellows();
    makeVoice();
    instState.ready = true;
    if (!meterTimer) {
      meterTimer = setInterval(() => {
        instState.voices = b?.meter?.voices ?? 0;
      }, 200);
    }
  } finally {
    instState.booting = false;
  }
}

export function setEngine(engineId: string): void {
  if (engineId === instState.engineId) return;
  instState.engineId = engineId;
  instState.params = voicingFor(engineId);
  const preset = presetFor(engineId);
  if (preset) {
    // a preset carries its whole playable setup: insert chain, gain
    // trim, and a sensible keyboard octave
    instState.fx = (preset.fx ?? []).map((f) => {
      const def = listEffects().find((e) => e.id === f.effectId);
      return { effectId: f.effectId, params: { ...defaultsFor(def?.params ?? []), ...(f.params ?? {}) } };
    });
    instState.gain = Math.max(0, Math.min(1.2, preset.gain ?? 0.8));
    setOctave(preset.octave ?? 0);
  }
  if (!instState.ready) return;
  syncInstance();
  if (!b) return;
  // silence and abandon the old channel, then build the new one with the
  // fresh defaults but the same gain, pan, and fx chain
  if (voiceHandle) {
    b.postAllOff(voiceHandle.channel);
    voiceHandle.gain(0);
  }
  clearLedger();
  makeVoice();
}

/* ------------------------------------------------------------------ */
/* notes                                                                */
/* ------------------------------------------------------------------ */

function releaseEntry(key: string, entry: { noteId: number; sounding: number }): void {
  voiceHandle?.off(entry.noteId);
  if (b) noteTap?.off(entry.sounding, b.now());
  ledger.delete(key);
  deferred.delete(key);
  const left = (soundingCount.get(entry.sounding) ?? 1) - 1;
  if (left <= 0) {
    soundingCount.delete(entry.sounding);
    activeNotes.delete(entry.sounding);
  } else {
    soundingCount.set(entry.sounding, left);
  }
}

export function noteOn(midi: number, vel = instState.velocity, source: NoteSource = 'ptr'): void {
  syncInstance();
  if (!instState.ready || !voiceHandle) return;
  const shift = source === 'kb' ? instState.octave * 12 : 0;
  const sounding = Math.max(0, Math.min(127, midi + shift));
  const key = source + ':' + midi;
  const prev = ledger.get(key);
  if (prev) releaseEntry(key, prev);
  const clamped = Math.max(0, Math.min(1, vel));
  const noteId = voiceHandle.on(sounding, clamped);
  ledger.set(key, { noteId, sounding });
  soundingCount.set(sounding, (soundingCount.get(sounding) ?? 0) + 1);
  activeNotes.add(sounding);
  if (b) noteTap?.on(sounding, clamped, b.now());
}

export function noteOff(midi: number, source: NoteSource = 'ptr'): void {
  const key = source + ':' + midi;
  const entry = ledger.get(key);
  if (!entry) return;
  if (instState.sustain) {
    deferred.add(key);
    return;
  }
  releaseEntry(key, entry);
}

export function setSustain(on: boolean): void {
  if (instState.sustain === on) return;
  instState.sustain = on;
  if (!on) {
    for (const key of [...deferred]) {
      const entry = ledger.get(key);
      if (entry) releaseEntry(key, entry);
    }
    deferred.clear();
  }
}

export function panic(): void {
  clearLedger();
  panicHook?.();
  b?.panic();
}

/* ------------------------------------------------------------------ */
/* params and fx (rAF-coalesced posts)                                  */
/* ------------------------------------------------------------------ */

const pendingParams = new Map<string, number>();
const pendingFxParams = new Map<string, { index: number; name: string; value: number }>();
let rafId = 0;

function flushPending(): void {
  rafId = 0;
  if (voiceHandle) {
    for (const [name, value] of pendingParams) voiceHandle.param(name, value);
    for (const p of pendingFxParams.values()) voiceHandle.fxParam(p.index, p.name, p.value);
  }
  pendingParams.clear();
  pendingFxParams.clear();
}

function scheduleFlush(): void {
  if (!rafId) rafId = requestAnimationFrame(flushPending);
}

export function setParam(name: string, value: number): void {
  instState.params[name] = value;
  if (!instState.ready) return;
  pendingParams.set(name, value);
  scheduleFlush();
}

export function resetParams(): void {
  // for a preset, reset means back to the preset's voicing
  const defaults = voicingFor(instState.engineId);
  for (const [name, value] of Object.entries(defaults)) setParam(name, value);
}

export function addFx(effectId: string): void {
  const def = listEffects().find((e) => e.id === effectId);
  if (!def) return;
  instState.fx.push({ effectId, params: defaultsFor(def.params) });
  postFxChain();
}

export function removeFx(index: number): void {
  if (index < 0 || index >= instState.fx.length) return;
  instState.fx.splice(index, 1);
  // pending fx-param posts aim at slots by index; drop them rather than
  // let a stale index hit the rebuilt chain
  pendingFxParams.clear();
  postFxChain();
}

export function setFxParam(index: number, name: string, value: number): void {
  const slot = instState.fx[index];
  if (!slot) return;
  slot.params[name] = value;
  if (!instState.ready) return;
  pendingFxParams.set(index + ':' + name, { index, name, value });
  scheduleFlush();
}

/* ------------------------------------------------------------------ */
/* mix and play settings                                                */
/* ------------------------------------------------------------------ */

export function setGain(v: number): void {
  instState.gain = Math.max(0, Math.min(1.2, v));
  voiceHandle?.gain(instState.gain);
}

export function setPan(v: number): void {
  instState.pan = Math.max(-1, Math.min(1, v));
  voiceHandle?.pan(instState.pan);
}

export function setOctave(shift: number): void {
  instState.octave = Math.max(-3, Math.min(3, Math.round(shift)));
}

export function setVelocity(v: number): void {
  instState.velocity = Math.max(0.05, Math.min(1, Math.round(v * 20) / 20));
}

/* ------------------------------------------------------------------ */
/* slider mapping shared by ParamPanel and FxRack                       */
/* ------------------------------------------------------------------ */

/** Map a param value onto a 0..1 slider position honoring the curve.
 * 'exp' uses a log scale (a zero min gets a small floor so the log is
 * finite); 'db' values are already decibels, so linear in dB is right. */
export function toSlider(spec: ParamSpec, value: number): number {
  if (spec.curve === 'exp') {
    const lo = spec.min > 0 ? spec.min : Math.max(spec.max / 1000, 1e-4);
    if (value <= lo) return 0;
    return Math.min(1, Math.log(value / lo) / Math.log(spec.max / lo));
  }
  if (spec.max === spec.min) return 0;
  return Math.max(0, Math.min(1, (value - spec.min) / (spec.max - spec.min)));
}

export function fromSlider(spec: ParamSpec, t: number): number {
  const c = Math.max(0, Math.min(1, t));
  if (spec.curve === 'exp') {
    const lo = spec.min > 0 ? spec.min : Math.max(spec.max / 1000, 1e-4);
    if (c === 0) return spec.min;
    return lo * Math.pow(spec.max / lo, c);
  }
  return spec.min + (spec.max - spec.min) * c;
}

export function formatValue(spec: ParamSpec, value: number): string {
  const a = Math.abs(value);
  const s =
    a >= 100 ? value.toFixed(0) : a >= 10 ? value.toFixed(1) : a >= 1 ? value.toFixed(2) : a === 0 ? '0' : value.toFixed(3);
  return spec.unit ? s + spec.unit : s;
}
