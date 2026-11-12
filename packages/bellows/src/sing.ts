/*
 * A sung plan as kernel events: how a lyric reaches the vocal engine.
 *
 * planSung (lyrics/sing.ts) times phonemes in seconds and pitches in Hz
 * and knows nothing about engines. The vocal engine (engines/vocal.ts)
 * knows a phoneme only as an index on its `phoneme` parameter, and a pitch
 * inside a note only as `bend` in semitones. This file is the join. One
 * phrase becomes one note with ordinary Param events inside it, so nothing
 * in the kernel knows a phoneme exists, and realtime playback, offline
 * rendering and b.render() replays all sing the same way (docs/VOICE.md,
 * "The design as built").
 *
 * Each phrase, in this order:
 *
 *   bend 0     at start
 *   phoneme    at start, the first span
 *   NoteOn     at start, with the phrase's first Hz and its velocity
 *   phoneme    at each later span start where the sound changes
 *   bend       at each later pitch time (less bendLead), 12 log2(hz / first Hz)
 *   nextIn, nextPhoneme  planLead before each later sound (see below)
 *   NoteOff    at end
 *   bend and phoneme at end, back to the channel's own (restBend, restPhoneme)
 *
 * The Params at `start` go before the NoteOn at the same time. The kernel
 * keeps insertion order for equal times (kernel/engine.ts, pushEvent), and
 * the voice snaps every tracked value at note-on, so the phrase opens on
 * its own sound and pitch instead of gliding in from the channel's last
 * ones. The vocal engine also snaps a phoneme or bend that arrives after
 * its note-on but before it renders, so for that engine the order is a
 * second guarantee rather than the only one.
 *
 * While a phrase sings, `bend` belongs to it: 0 on its first note, so a
 * channel's own bend does not transpose a sung line, whose pitches already
 * came through the caller's tuning exactly. The resets at `end` go after
 * the NoteOff at the same time. A released vocal voice ignores phoneme and
 * bend (the pool sends every Param to every voice, and a tail must not be
 * reshaped by what follows), so they do not touch the phrase's tail. They
 * put back the phoneme and bend the channel had of its own, which the
 * caller passes in, so a plain note() after a sung line sings what it sang
 * before the line, at its own pitch, not the line's last consonant a fifth
 * away.
 *
 * ONE PHRASE AT A TIME ON A CHANNEL
 *
 * Because phoneme and bend are channel parameters, two phrases that
 * overlap on one channel reshape each other: the later one's opening
 * consonants reach the earlier one's live voice, and the earlier one's
 * resets land on the later one. planSung keeps the phrases of one plan
 * apart; `busy` carries the phrases earlier calls posted. A phrase that
 * would start inside one starts where it ends instead, dropping or
 * shortening its opening sounds; a phrase that would run into a later one
 * already posted ends where that one starts, and posts no resets there,
 * since they would land after the later phrase's opening events at the
 * same time. What is left out is counted in `trimmed`. The earlier phrase
 * wins because its events are already in the kernel and cannot be taken
 * back.
 *
 * EARLY RELEASES
 *
 * The vocal engine releases a stop when the next sound's phoneme arrives,
 * and after an aspirated release (p t k, not after /s/) voicing waits for
 * the glottis to close again; the formant voice held it off for the stop's
 * VOT, 58 to 80 ms, and the rule below was set for that. Posted at the vowel's own beat, the
 * vowel then started 70 to 91 ms late (MEASURED, 110 Hz). So the release
 * goes out early by lead = VOT + VOICING_LAG, the time from the release to
 * the voicing's half level: the stop starts `lead` before its span (but
 * not before the middle of the sound ahead of it, which keeps half its
 * time) and the vowel at its beat minus `lead` (but at least MIN_CLOSURE
 * after the stop starts). A phrase that opens on such a stop moves its
 * NoteOn back with it, and `leadIn` counts that. Measured on the posted
 * events, the vowel after /p t k/ moved from 70, 81, 91 ms after its beat
 * to 2, 4, 5. The plan's spans keep their times, vowel on the beat;
 * only the events that sing them move. At sixteenths the VOT outlasts a
 * short vowel whatever the release time; that needs a shorter VOT, which
 * nothing here can ask the engine for.
 *
 * SOUNDS AHEAD AND EARLY BENDS
 *
 * The articulatory vocal engine plans like a singer: a stop closes 22 to
 * 31 ms before its own time, a nasal lowers the velum 20 ms early, the next
 * vowel ramps in through the consonants before it, and a closure releases
 * before the sound after it. So with `planLead` each sound after a phrase's
 * first is also announced that far ahead (but not before the NoteOn, after
 * which the announcements at the NoteOn's time go): `nextIn`, the seconds
 * until it starts, then `nextPhoneme`, the sound. Its `phoneme` event still
 * goes at its own time and confirms it. With `bendLead` each bend goes out
 * that much early (not before the NoteOn), the time the engine's glide
 * takes to be half way, so its preparation lands before the note and its
 * overshoot after. Both default to 0, the old events exactly; the facade
 * passes VOCAL_PLAN_LEAD and vocalGlideLead() of the channel's glide,
 * overshoot and preparation.
 *
 * bend is a unit conversion, not a tuning. The Hz came through the
 * caller's tuning layer, and 12 log2 of a frequency ratio is that ratio in
 * semitones whatever divided the octave; test/integration/sing.test.ts
 * checks that a 19-EDO line comes back from its bends to 1e-12 of each
 * note's Hz. The engine's bend spans 48 semitones either way, four octaves
 * from the phrase's first note, and clamps beyond that.
 *
 * A span whose IPA the engine has no phoneme for (vocalPhonemeIndex gives
 * -1: typed IPA can ask for ç or ʍ) keeps the sound before it, which at a
 * phrase's start is the silence of the breath before it. That invents no
 * sound and keeps every later span on its time. The symbols are reported,
 * once each, rather than thrown, so one exotic letter does not cost a
 * caller the whole line.
 *
 * A planner, run off the audio thread; it allocates.
 */

import type { KernelEvent } from './types';
import { EventKind } from './types';
import type { SungPhrase, SungPlan } from './lyrics/types';
import {
  VOCAL_ACOUSTICS,
  VOCAL_DEFAULT_PHONEME,
  vocalPhonemeIndex,
  vocalReleaseAspirated,
  vocalReleaseVot,
} from './engines/vocal-phonemes';

/** The silence a phrase opens from, '_' in VOCAL_PHONEMES. */
const SILENCE = vocalPhonemeIndex('_');

/**
 * Seconds from the end of a VOT to the voicing's half level in the vocal
 * engine at articulation 1: its VOICING_TIME is 30 ms to 98 percent, and a
 * critically damped step is half way at 0.29 of that, 8.6 ms; release to
 * half voicing measured 79, 65 and 88 ms after /t p k/ for VOTs of 70, 58
 * and 80.
 */
const VOICING_LAG = 0.01;
/** The shortest closure an early release leaves a stop, in seconds. */
const MIN_CLOSURE = 0.02;

/** One phrase as posted on a channel: from its first event to its NoteOff. */
export interface SungWindow {
  start: number;
  end: number;
  /** Whether the phrase put the channel's own phoneme and bend back at `end`. */
  resets: boolean;
}

export interface SungEventOptions {
  /** Kernel channel the vocal instrument plays on. */
  channel: number;
  /** Interned index of the engine's `phoneme` parameter: internParam('phoneme'). */
  phonemeParam: number;
  /** Interned index of `bend`: internParam('bend'). */
  bendParam: number;
  /**
   * Interned indices of `nextPhoneme` and `nextIn`. With planLead > 0, each
   * sound after a phrase's first is also posted planLead early (but not
   * before the phrase's NoteOn) as nextIn, the seconds until it starts,
   * then nextPhoneme, the sound: the engine's planner then starts the
   * gestures that lead a sound before it (engines/vocal-planner.ts).
   */
  nextPhonemeParam?: number;
  nextInParam?: number;
  /** Seconds each sound is announced ahead. Default 0, none. */
  planLead?: number;
  /**
   * Seconds each bend goes out early (but not before the NoteOn), so the
   * engine's pitch glide, with its preparation and overshoot, is half way
   * on the note: vocalGlideLead() of the channel's settings. Default 0.
   */
  bendLead?: number;
  /** Note id of the first phrase; phrase k plays as firstNoteId + k. Default 1. */
  firstNoteId?: number;
  /** The phoneme index the channel returns to after each phrase, its own. Default VOCAL_DEFAULT_PHONEME. */
  restPhoneme?: number;
  /** The bend the channel returns to after each phrase, its own. Default 0. */
  restBend?: number;
  /** Phrases earlier calls posted on this channel, in time order. New phrases fit between them. */
  busy?: readonly SungWindow[];
  /**
   * The earliest time an early release may move a stop to: 0 in an offline
   * render, the context's time live. A stop moved before it would never sound.
   */
  notBefore?: number;
}

export interface SungEvents {
  /** In time order, ready for a kernel `events` message. */
  events: KernelEvent[];
  /** IPA the engine has no phoneme for, each once, in order of first use. */
  unknown: string[];
  /** Each phrase as posted, in time order: what the caller adds to `busy` for the next call. */
  windows: SungWindow[];
  /** The longest time a posted phrase starts before its first note's beat, early releases included. */
  leadIn: number;
  /** Seconds of the plan left out where phrases would have overlapped `busy` or each other. */
  trimmed: number;
}

/**
 * The kernel events that sing a plan on one channel running the vocal
 * engine: one note per phrase, with `phoneme` and `bend` Param events
 * inside it. Never throws on a plan planSung produced; an unknown IPA
 * symbol keeps the sound before it and is listed in `unknown`.
 */
export function sungEvents(plan: SungPlan, opts: SungEventOptions): SungEvents {
  const result: SungEvents = { events: [], unknown: [], windows: [], leadIn: 0, trimmed: 0 };
  const busy = (opts.busy ?? []).slice().sort((a, b) => a.start - b.start);
  const first = opts.firstNoteId ?? 1;
  plan.phrases.forEach((phrase, k) => phraseEvents(phrase, first + k, opts, busy, result));
  return result;
}

function isVowel(idx: number): boolean {
  return VOCAL_ACOUSTICS[idx].cls === 'vowel';
}

function phraseEvents(phrase: SungPhrase, noteId: number, opts: SungEventOptions, busy: SungWindow[], result: SungEvents): void {
  /* planSung never makes these; a plan built by hand might. */
  if (phrase.spans.length === 0 || phrase.pitches.length === 0) return;
  if (!validHz(phrase.pitches[0].hz)) return;

  const ch = opts.channel;
  const param = (time: number, index: number, value: number): KernelEvent => ({
    time,
    kind: EventKind.Param,
    target: ch,
    a: index,
    b: value,
    c: 0,
  });
  const unknown = result.unknown;
  const lookup = (ipa: string): number => {
    const idx = vocalPhonemeIndex(ipa);
    if (idx < 0 && !unknown.includes(ipa)) unknown.push(ipa);
    return idx;
  };

  /* The sound at each span start where it changes. */
  const times: number[] = [];
  const sounds: number[] = [];
  let sound = SILENCE;
  phrase.spans.forEach((span, s) => {
    const idx = lookup(span.ipa);
    if (s === 0) sound = idx < 0 ? SILENCE : idx;
    else if (idx < 0 || idx === sound) return;
    else sound = idx;
    times.push(s === 0 ? phrase.start : span.start);
    sounds.push(sound);
  });

  /* Aspirated releases go out early, so the vowel's voicing lands on its beat. */
  for (let k = 0; k + 1 < sounds.length; k++) {
    const next = sounds[k + 1];
    // the engine sees the sound before the note's first one as none
    const prev = k > 0 ? sounds[k - 1] : -1;
    if (!isVowel(next) || !vocalReleaseAspirated(sounds[k], prev)) continue;
    const lead = vocalReleaseVot(sounds[k], prev, next) + VOICING_LAG;
    // never back past the middle of the sound before, a phrase already
    // posted on the channel (fitting would cut the stop away), or now
    const floor = k > 0 ? (times[k - 1] + times[k]) / 2 : Math.min(times[0], openingFloor(busy, times[0], opts.notBefore));
    const stop = Math.max(times[k] - lead, floor);
    const beat = times[k + 1];
    times[k] = stop;
    times[k + 1] = Math.min(beat, Math.max(stop + MIN_CLOSURE, beat - lead));
  }

  /* Fit the phrase between the ones already posted on the channel. */
  const start0 = times[0];
  const end0 = phrase.end;
  let start = start0;
  for (const w of busy) if (w.start <= start && w.end > start) start = w.end;
  let end = end0;
  let meets = false;
  for (const w of busy) {
    if (w.start >= start && w.start <= end) {
      end = w.start;
      meets = true;
      break;
    }
  }
  if (!(end > start)) {
    result.trimmed += end0 - start0;
    return;
  }
  result.trimmed += start - start0 + (end0 - end);

  /* What is sounding, and at what pitch, where the fitted phrase opens. */
  let open = 0;
  while (open + 1 < times.length && times[open + 1] <= start) open++;
  let p0 = 0;
  while (p0 + 1 < phrase.pitches.length && phrase.pitches[p0 + 1].time <= start) p0++;
  let openHz = phrase.pitches[p0].hz;
  if (!validHz(openHz)) openHz = phrase.pitches[0].hz;

  /* Inside the note: [time, rank, event], merged by time and, at a tie, by rank, then posting order. */
  const inner: Array<[number, number, KernelEvent]> = [];
  for (let k = open + 1; k < times.length; k++) if (times[k] < end) inner.push([times[k], 0, param(times[k], opts.phonemeParam, sounds[k])]);
  const lead = opts.bendLead !== undefined && opts.bendLead > 0 ? opts.bendLead : 0;
  let bend = 0;
  for (let p = p0 + 1; p < phrase.pitches.length; p++) {
    const t = phrase.pitches[p].time;
    if (t >= end) break;
    const st = 12 * Math.log2(phrase.pitches[p].hz / openHz);
    if (st === bend || !Number.isFinite(st)) continue;
    bend = st;
    const at = Math.max(start, t - lead);
    inner.push([at, 1, param(at, opts.bendParam, st)]);
  }
  const ahead = opts.planLead !== undefined && opts.planLead > 0 ? opts.planLead : 0;
  if (ahead > 0 && opts.nextPhonemeParam !== undefined && opts.nextInParam !== undefined) {
    for (let k = open + 1; k < times.length; k++) {
      if (!(times[k] < end)) continue;
      const at = Math.max(start, times[k] - ahead);
      inner.push([at, 2, param(at, opts.nextInParam, times[k] - at)]);
      inner.push([at, 2, param(at, opts.nextPhonemeParam, sounds[k])]);
    }
  }
  const order = inner.map((_, i) => i);
  order.sort((a, b) => inner[a][0] - inner[b][0] || inner[a][1] - inner[b][1] || a - b);

  const out = result.events;
  out.push(param(start, opts.bendParam, 0));
  out.push(param(start, opts.phonemeParam, sounds[open]));
  out.push({ time: start, kind: EventKind.NoteOn, target: ch, a: noteId, b: openHz, c: phrase.vel });
  /* At a tie the phoneme goes first, then the bend, then what is announced ahead. */
  for (const i of order) out.push(inner[i][2]);
  /* Meeting a later phrase, the NoteOff sorts ahead of that phrase's opening
     events at the same time, or this voice would take its sound before it
     releases; a nanosecond is inside the same frame at any sample rate. */
  out.push({ time: meets ? end - 1e-9 : end, kind: EventKind.NoteOff, target: ch, a: noteId, b: 0, c: 0 });
  if (!meets) {
    out.push(param(end, opts.bendParam, opts.restBend ?? 0));
    out.push(param(end, opts.phonemeParam, opts.restPhoneme ?? VOCAL_DEFAULT_PHONEME));
  }

  const window: SungWindow = { start, end, resets: !meets };
  result.windows.push(window);
  let at = busy.length;
  while (at > 0 && busy[at - 1].start > start) at--;
  busy.splice(at, 0, window);

  const firstVowel = phrase.spans.find((s) => s.kind === 'nucleus');
  const beat = firstVowel ? firstVowel.start : phrase.start;
  if (beat - start > result.leadIn) result.leadIn = beat - start;
}

/** The latest end of a posted phrase at or before `t`, or `notBefore`, whichever is later. */
function openingFloor(busy: readonly SungWindow[], t: number, notBefore = -Infinity): number {
  let floor = notBefore;
  for (const w of busy) if (w.start <= t && w.end > floor) floor = w.end;
  return floor;
}

function validHz(hz: number): boolean {
  return hz > 0 && Number.isFinite(hz);
}
