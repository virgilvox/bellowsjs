/*
 * Loop-pedal state for the instrument page. The looper owns a private
 * Transport and Scheduler ticked by its own interval: the workbench owns
 * b.transport, b.clock, b.start, and b.bpm, and both views stay alive
 * under KeepAlive, so this store never touches the shared clock.
 *
 * A take arms at REC, waits for a loop top, counts in for one bar, then
 * records bars * 4 beats while the existing layers keep playing. Captured
 * notes come in through the instrument-store note tap (keys, mouse, and
 * MIDI all pass through the same ledger) and are stored as loop-phase
 * beats, so a take always plays back in phase with the layers that were
 * audible while it was recorded. Each finalized layer gets its own kernel
 * channel with a snapshot of the engine and params at finalize time.
 */

import { markRaw, reactive, type Raw } from 'vue';
import { Scheduler, Transport, type Bellows, type Instrument } from 'bellowsjs';
import { bellows as bellowsRef, ensureBellows } from './audio';
import { boot, engineLabel, instState, resolveEngineId, setNoteTap, setPanicHook } from './instrument-store';

const SIXTEENTH = 0.25;
/** metronome quarter click, loop-top accent, and count-in pitches (drum
 * engines tune from the note frequency, so higher midi = higher click) */
const CLICK_MIDI = 76;
const ACCENT_MIDI = 84;
const COUNT_MIDI = 96;

export interface LoopEvent {
  /** loop-phase beat of the note start, in [0, bars * 4) */
  beat: number;
  durBeats: number;
  midi: number;
  vel: number;
}

export interface LooperLayer {
  id: number;
  name: string;
  engineId: string;
  params: Record<string, number>;
  events: LoopEvent[];
  on: boolean;
  /** kernel channel handle, markRaw'd so reactive() leaves it alone */
  channel: Raw<Instrument>;
}

export type RecState = 'idle' | 'armed' | 'count' | 'recording';

interface LooperState {
  playing: boolean;
  /** 60..180 */
  bpm: number;
  /** loop length in 4/4 bars */
  bars: 1 | 2 | 4;
  metronome: boolean;
  quantize: boolean;
  recState: RecState;
  /** count-in readout, 4 down to 1 */
  countBeat: number;
  /** current 16th within the loop, for the playhead */
  posStep: number;
  /** transient status line, empty when quiet */
  status: string;
  layers: LooperLayer[];
}

export const looperState = reactive<LooperState>({
  playing: false,
  bpm: 100,
  bars: 1,
  metronome: true,
  quantize: true,
  recState: 'idle',
  countBeat: 0,
  posStep: 0,
  status: '',
  layers: [],
});

/* ------------------------------------------------------------------ */
/* private clock                                                        */
/* ------------------------------------------------------------------ */

let b: Bellows | null = null;
let transport: Transport | null = null;
let scheduler: Scheduler | null = null;
let offTick: (() => void) | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let raf = 0;
let metro: Instrument | null = null;

/* ------------------------------------------------------------------ */
/* recording bookkeeping (beats live on the private transport)          */
/* ------------------------------------------------------------------ */

let nextLayerId = 1;
let takeNumber = 1;
let countStartStep = 0;
let recStartStep = 0;
let recEndStep = 0;
/** loop length in beats, frozen when the count begins */
let recLoopBeats = 4;
/** recording start phase within the loop; with bars = 1 the count-in is a
 * full pass and this is 0, with longer loops recording starts one bar
 * into a pass, so stored beats shift by this offset to stay loop-aligned */
let recPhaseOffset = 0;
let takeEvents: LoopEvent[] = [];
const openNotes = new Map<number, Array<{ vel: number; relBeat: number }>>();
/** finalize runs at a tick, which fires ahead of real time: hits landing
 * in that gap still belong to the take, so the window stays open on the
 * finalized layer until the real end time passes */
let lateLayer: LooperLayer | null = null;

let statusTimer: ReturnType<typeof setTimeout> | null = null;

function flash(msg: string): void {
  looperState.status = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    looperState.status = '';
  }, 2800);
}

/** The adopted instance only if it is still the live one; posting to a
 * stale handle after a reforge could hit a fresh channel with the same id. */
function liveB(): Bellows | null {
  return b && bellowsRef.value === b ? b : null;
}

/** The workbench can reforge the shared Bellows instance (same
 * AudioContext, fresh kernel). Layer channels then point at the dead
 * kernel and channel ids restart at zero, so rebuilding handles lazily
 * would need per-layer sampler bank checks. Clearing the layers is the
 * simpler correct recovery: takes are cheap to re-record. */
function syncInstance(): void {
  const cur = bellowsRef.value;
  if (!cur) {
    if (looperState.playing) stop();
    b = null;
    metro = null;
    return;
  }
  if (cur === b) return;
  const first = b === null;
  b = cur;
  metro = null;
  cancelTake();
  if (!first && looperState.layers.length) {
    looperState.layers = [];
    flash('bellows reforged, layers cleared');
  }
}

function ensureMetro(): Instrument | null {
  if (!b) return null;
  if (!metro) {
    metro = markRaw(b.voice('hat'));
    metro.gain(0.4);
  }
  return metro;
}

function cancelTake(): void {
  looperState.recState = 'idle';
  looperState.countBeat = 0;
  openNotes.clear();
  takeEvents = [];
  lateLayer = null;
}

/* ------------------------------------------------------------------ */
/* transport controls                                                   */
/* ------------------------------------------------------------------ */

let starting = false;

export async function play(): Promise<void> {
  if (looperState.playing || starting) return;
  starting = true;
  try {
    // power the whole instrument, not just the audio graph: recording is
    // useless while the keyboard sits behind the boot overlay
    await boot();
    b = await ensureBellows();
  } finally {
    starting = false;
  }
  if (looperState.playing) return;
  syncInstance();
  // a fresh transport per run: reusing one would replay old mid-run bpm
  // edits out of its tempo map after the rewind to beat 0
  transport = new Transport({ bpm: looperState.bpm });
  scheduler = new Scheduler(transport);
  offTick = scheduler.at(SIXTEENTH, onTick);
  transport.start(b.now() + 0.08);
  looperState.playing = true;
  looperState.posStep = 0;
  ticker = setInterval(() => {
    syncInstance();
    if (looperState.playing && b && scheduler) scheduler.tick(b.now());
  }, 25);
  if (!raf) raf = requestAnimationFrame(paint);
}

export function stop(): void {
  if (!looperState.playing) return;
  looperState.playing = false;
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  if (offTick) {
    offTick();
    offTick = null;
  }
  transport?.stop();
  cancelTake();
  looperState.posStep = 0;
  const live = liveB();
  if (live) {
    for (const layer of looperState.layers) live.postAllOff(layer.channel.channel);
    if (metro) live.postAllOff(metro.channel);
  }
}

/** REC while idle starts the looper (if needed) and arms; REC while
 * armed, counting, or recording cancels the take cleanly. */
export async function rec(): Promise<void> {
  if (looperState.recState !== 'idle') {
    cancelTake();
    flash('take canceled');
    return;
  }
  if (!looperState.playing) await play();
  looperState.recState = 'armed';
}

export function setBpm(v: number): void {
  looperState.bpm = Math.max(60, Math.min(180, Math.round(v)));
  const live = liveB();
  if (transport && looperState.playing && live) transport.setBpm(looperState.bpm, live.now());
}

export function setBars(v: number): void {
  // the grid length is locked while a take is in flight
  if (looperState.recState !== 'idle') return;
  if (v === 1 || v === 2 || v === 4) looperState.bars = v;
}

export function toggleMetronome(): void {
  looperState.metronome = !looperState.metronome;
}

export function toggleQuantize(): void {
  looperState.quantize = !looperState.quantize;
}

/* ------------------------------------------------------------------ */
/* layers                                                               */
/* ------------------------------------------------------------------ */

export function toggleLayer(layer: LooperLayer): void {
  layer.on = !layer.on;
  if (!layer.on) liveB()?.postAllOff(layer.channel.channel);
}

export function deleteLayer(id: number): void {
  const i = looperState.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const layer = looperState.layers[i];
  // kernel channels cannot be destroyed: silence it, zero its gain, and
  // abandon the handle
  const live = liveB();
  if (live) {
    live.postAllOff(layer.channel.channel);
    layer.channel.gain(0);
  }
  if (lateLayer && lateLayer.id === id) lateLayer = null;
  looperState.layers.splice(i, 1);
}

export function clearLayers(): void {
  if (!looperState.layers.length) return;
  for (const layer of [...looperState.layers]) deleteLayer(layer.id);
  flash('layers cleared');
}

/** Hard hush, wired into instrument-store panic. Stopping is the only
 * honest silence: a running looper would re-post its notes on the very
 * next tick. */
export function silenceAll(): void {
  stop();
}

/* ------------------------------------------------------------------ */
/* the tick                                                             */
/* ------------------------------------------------------------------ */

function onTick(t: number, step: number): void {
  if (!b || !transport) return;
  const loopSteps = looperState.bars * 16;
  const stepInLoop = step % loopSteps;
  const spb = 60 / looperState.bpm;
  const click = ensureMetro();

  if (looperState.recState === 'armed' && stepInLoop === 0) {
    looperState.recState = 'count';
    countStartStep = step;
    recStartStep = step + 16;
    recEndStep = recStartStep + loopSteps;
    recLoopBeats = loopSteps * SIXTEENTH;
    recPhaseOffset = (recStartStep * SIXTEENTH) % recLoopBeats;
    takeEvents = [];
    openNotes.clear();
    lateLayer = null;
  }

  let countClick = false;
  if (looperState.recState === 'count') {
    if (step >= recStartStep) {
      looperState.recState = 'recording';
      looperState.countBeat = 0;
    } else if ((step - countStartStep) % 4 === 0) {
      countClick = true;
      looperState.countBeat = 4 - (step - countStartStep) / 4;
      // count-in stays audible with the metronome off
      click?.note(COUNT_MIDI, { at: t, dur: { seconds: 0.05 }, vel: 1 });
    }
  }

  if (looperState.recState === 'recording' && step >= recEndStep) finalizeTake();

  if (looperState.metronome && !countClick && stepInLoop % 4 === 0) {
    const top = stepInLoop === 0;
    click?.note(top ? ACCENT_MIDI : CLICK_MIDI, {
      at: t,
      dur: { seconds: 0.05 },
      vel: top ? 1 : 0.7,
    });
  }

  for (const layer of looperState.layers) {
    if (!layer.on) continue;
    for (const ev of layer.events) {
      const bucket = Math.floor(ev.beat / SIXTEENTH + 1e-6);
      if (bucket % loopSteps !== stepInLoop) continue;
      // quantized starts sit exactly on the tick; unquantized ones keep
      // their sub-16th offset
      const frac = Math.max(0, ev.beat - bucket * SIXTEENTH);
      layer.channel.note(ev.midi, {
        at: t + frac * spb,
        dur: { seconds: Math.max(0.02, ev.durBeats * spb) },
        vel: ev.vel,
      });
    }
  }
}

function paint(): void {
  if (!looperState.playing || !b || !transport) {
    raf = 0;
    return;
  }
  const beat = Math.max(0, transport.beatAt(b.now()));
  looperState.posStep = Math.floor(beat / SIXTEENTH + 1e-6) % (looperState.bars * 16);
  raf = requestAnimationFrame(paint);
}

/* ------------------------------------------------------------------ */
/* capture                                                              */
/* ------------------------------------------------------------------ */

function pushEvent(midi: number, vel: number, relOn: number, relOff: number, into: LoopEvent[]): void {
  let q = relOn;
  if (looperState.quantize) {
    q = Math.round(relOn / SIXTEENTH) * SIXTEENTH;
    // a start that quantizes to exactly the loop length wraps to the top
    if (q >= recLoopBeats) q = 0;
  }
  into.push({
    beat: (q + recPhaseOffset) % recLoopBeats,
    durBeats: Math.max(0.05, relOff - relOn),
    midi,
    vel,
  });
}

function finalizeTake(): void {
  // notes still held when recording ends get their off clamped to the
  // loop end; the real off (arriving later, past the end) finds no open
  // entry and is dropped
  for (const [midi, list] of openNotes) {
    for (const note of list) pushEvent(midi, note.vel, note.relBeat, recLoopBeats, takeEvents);
  }
  openNotes.clear();
  if (!takeEvents.length) {
    // nothing played yet: keep rolling into the next pass instead of
    // silently resetting, the way a hardware looper waits for you
    recStartStep += looperState.bars * 16;
    recEndStep += looperState.bars * 16;
    recPhaseOffset = (recStartStep * SIXTEENTH) % recLoopBeats;
    flash('listening: play to record this pass');
    return;
  }
  looperState.recState = 'idle';
  looperState.countBeat = 0;
  if (!b) return;
  // preset ids resolve to their underlying engine, same as the live channel
  const channel = markRaw(b.voice(resolveEngineId(instState.engineId), { ...instState.params }));
  channel.gain(instState.gain);
  const name =
    engineLabel(instState.engineId).toUpperCase() + ' ' + String(takeNumber++).padStart(2, '0');
  looperState.layers.push({
    id: nextLayerId++,
    name,
    engineId: instState.engineId,
    params: { ...instState.params },
    events: takeEvents,
    on: true,
    channel,
  });
  lateLayer = looperState.layers[looperState.layers.length - 1];
  takeEvents = [];
  flash(name.toLowerCase() + ' looped');
}

/* Notes come from instrument-store with b.now() times; the private
 * transport converts them to beats. Ons capture during the count and
 * recording windows (the count gate rejects them by beat, so only real
 * recording-window notes land); offs resolve against the open-note stack
 * whenever they actually sound, so sustain-deferred offs record once. */
setNoteTap({
  on(midi, vel, timeSec) {
    if (!transport || !looperState.playing) return;
    const beat = transport.beatAt(timeSec);
    if (looperState.recState === 'count' || looperState.recState === 'recording') {
      let rel = beat - recStartStep * SIXTEENTH;
      if (rel >= recLoopBeats) return;
      if (rel < 0) {
        // pickup forgiveness: eager hits during the count-in snap to the
        // loop top instead of vanishing, the way hardware loopers behave
        if (looperState.recState !== 'count' || rel < -4) return;
        rel = 0;
      }
      let list = openNotes.get(midi);
      if (!list) {
        list = [];
        openNotes.set(midi, list);
      }
      list.push({ vel, relBeat: rel });
      return;
    }
    // late window: the finalize tick ran ahead of real time, so a hit
    // just before the loop end still joins the finished take (its off
    // clamps to the loop end, matching the held-note rule)
    if (lateLayer && beat < recEndStep * SIXTEENTH) {
      const rel = beat - recStartStep * SIXTEENTH;
      if (rel >= 0 && rel < recLoopBeats) pushEvent(midi, vel, rel, recLoopBeats, lateLayer.events);
    }
  },
  off(midi, timeSec) {
    if (!transport) return;
    const list = openNotes.get(midi);
    const note = list?.pop();
    if (!note) return;
    if (list && !list.length) openNotes.delete(midi);
    const beat = transport.beatAt(timeSec);
    const rel = Math.min(Math.max(beat - recStartStep * SIXTEENTH, note.relBeat), recLoopBeats);
    pushEvent(midi, note.vel, note.relBeat, rel, takeEvents);
  },
});

setPanicHook(silenceAll);
