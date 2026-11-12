/*
 * The Bellows facade: tier 2 of the API. One object owning the context,
 * the transport, the clock, and the kernel connection.
 *
 * Everything structural (channels, fx chains, buses, sample banks) is
 * recorded as kernel messages when it happens, which is what makes
 * render() possible: the same message stream replays into a fresh offline
 * kernel, the same clock callbacks re-run against an offline transport,
 * and the piece renders start-to-finish without an AudioContext.
 */

import type { EngineDef, EffectDef, NamedRng, TimeValue, KernelEvent } from './types';
import { EventKind, mtof, clamp } from './types';
import { rng } from './core/prng';
import { registerEngine, registerEffect } from './core/registry';
import { SetupLog } from './kernel/setuplog';
import { Scheduler, type TickCallback } from './core/scheduler';
import { Transport } from './seq/transport';
import { parseTime, DEFAULT_METER, type Meter } from './seq/time';
import { parseNote } from './theory/notes';
import { Scale } from './theory/scales';
import { Tuning } from './theory/tuning';
import { euclid } from './seq/euclid';
import { internParam, KernelEngine } from './kernel/engine';
import { createKernelNode, type KernelNode } from './kernel/node';
import type { FxSpec, KernelMessage, MeterFrame, SamplerZoneData } from './kernel/messages';
import { renderOffline, type RenderedAudio } from './render/offline';
import { bankEngineResolver } from './render/banks';
import { registerBuiltins } from './register';
import { encodeWav } from './io/wav';
import { SoundFont } from './io/sf2';
import { samplerBankFromSf2 } from './engines/soundfont';
import { serializeDef } from './core/serialize';
import type { PronouncingDictionary, SungNote, SungPlan, Syllable } from './lyrics/types';
import { lyricsToSyllables } from './lyrics/read';
import { planSung } from './lyrics/sing';
import { sungEvents, type SungWindow } from './sing';
import { VOCAL_PLAN_LEAD, vocalGlideLead } from './engines/vocal';

export interface BootOptions {
  seed?: string;
  context?: AudioContext;
  workletUrl?: string;
  masterGain?: number;
  bpm?: number;
  meter?: Meter;
  /**
   * Whether dispose() closes the AudioContext. Defaults to true when boot
   * created the context and false when the caller passed one. Set it false
   * to keep a boot-created context alive for a later reboot.
   */
  closeContextOnDispose?: boolean;
}

export interface NoteOptions {
  /** Absolute context time in seconds. Defaults to a few ms from now. */
  at?: number;
  /** Duration as beats, notation ('8n', '3/8'), or { seconds }. Default '8n'. */
  dur?: TimeValue | { seconds: number };
  /** Velocity 0..1. Default 0.8. */
  vel?: number;
}

export type NoteValue = number | string | { hz: number } | { degree: number; octave?: number };

/** One note of a sung line. `note: null` is a rest: it takes time and no syllable. */
export interface SingNote {
  note: NoteValue | null;
  /** Beats, notation ('8n', '3/8'), or { seconds }, through the tempo map. */
  dur: TimeValue | { seconds: number };
  /** Velocity 0..1, default 0.8. A phrase plays at its first note's. */
  vel?: number;
}

export interface SingOptions {
  /**
   * Context time of the first note's beat, where its vowel lands. Left out,
   * a live line starts as soon as its opening consonants can all still
   * sound, and a line in a clock callback replayed by render() starts at the
   * callback's tick.
   */
  at?: number;
  /** Pronouncing dictionary for this line, over b.dictionary. */
  dictionary?: PronouncingDictionary;
  /** Scale for { degree } notes, as note()'s third argument. Default C major. */
  scale?: Scale;
  /**
   * American flaps and dark l on English words ("little" sings lɪ.ɾəɫ), default true. False
   * keeps every /t d l/ as written, as classical diction does. IPA is sung as written either way.
   */
  allophones?: boolean;
}

/**
 * What sing() planned and posted. `phrases` are the plan, each vowel on its
 * beat. `leadIn` is the longest any phrase starts before its own first
 * beat, which can be more than the plan's own lead-in: a phrase that opens
 * on an aspirated p, t or k releases it early, so its vowel is voiced on the
 * beat. Live, call at least that far ahead of the first beat.
 */
export interface SingResult extends SungPlan {
  /** IPA the vocal engine has no phoneme for, each once; those spans keep the sound before them. */
  unknown: string[];
  /**
   * Seconds of the line left out because the instrument was still singing
   * an earlier line there, or had a later one posted already: the opening
   * consonants that would have overlapped it, or whole phrases. 0 when the
   * instrument was free.
   */
  trimmed: number;
}

/**
 * A vocal channel's own phoneme and bend, which sung lines hand back when
 * they end (undefined: the engine's default), and the phrases sing() has
 * posted on it, so the next line fits around them.
 */
interface SingState {
  restPhoneme?: number;
  restBend?: number;
  /** The channel's own glide settings, which set how early sung bends go out. */
  glide?: number;
  overshoot?: number;
  preparation?: number;
  windows: SungWindow[];
}

export type FxInput = string | [string, Record<string, number>] | FxSpec;

interface TransportOp {
  kind: 'bpm' | 'ramp' | 'swing' | 'meter';
  atBeat: number;
  a: number;
  b: number;
  /** ramp: the anchored instantaneous bpm at atBeat, replayed before the ramp */
  c?: number;
  meter?: Meter;
}

interface RenderContext {
  events: KernelEvent[];
  transport: Transport;
  rngCache: Map<string, NamedRng>;
  /** the tick time of the callback currently re-running, default for untimed calls */
  now: number;
  /** sing() state per vocal channel, fresh for the render as the rng streams are */
  singing: Map<number, SingState>;
}

function normalizeFx(fx: FxInput[]): FxSpec[] {
  return fx.map((f) => {
    if (typeof f === 'string') return { effectId: f, params: {} };
    if (Array.isArray(f)) return { effectId: f[0], params: f[1] };
    return f;
  });
}

let bootCount = 0;

export class Bellows {
  readonly ctx: AudioContext;
  readonly seed: string;
  readonly transport: Transport;
  readonly analyser: AnalyserNode;

  private kernel: KernelNode;
  private scheduler: Scheduler;
  private setup = new SetupLog();
  private transportOps: TransportOp[] = [];
  private subs: Array<{ subdivision: number; cb: TickCallback }> = [];
  private liveRng = new Map<string, NamedRng>();
  /** One stable handle per label, reused across renders. See rng(). */
  private rngHandles = new Map<string, NamedRng>();
  private renderCtx: RenderContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextChannel = 0;
  private nextBus = 1;
  private nextNote = 1;
  private internedParams = new Map<string, number>();
  /** sing() state per vocal channel, live. A render keeps its own copy. */
  private singing = new Map<number, SingState>();
  private localDefs: Array<{ kind: 'engine' | 'effect'; code: string }> = [];
  private lastMeter: MeterFrame | null = null;
  private gone = false;
  /** Deferred channel removals, so dispose() can cancel them. */
  private pendingRemovals = new Set<ReturnType<typeof setTimeout>>();
  /** last kernel error messages, newest last */
  readonly kernelErrors: string[] = [];
  /** when set, receives kernel errors instead of console.error */
  onError: ((message: string) => void) | null = null;
  private initialBpm: number;
  private initialMeter: Meter;

  tuning: Tuning = Tuning.edo(12);

  /**
   * Pronunciations for sing(): lowercase word to CMUdict ARPAbet, as
   * parseCmudict() returns. bellows ships none. While this is null, words
   * go through letter-to-sound rules, and IPA between slashes sets the
   * sounds directly either way.
   */
  dictionary: PronouncingDictionary | null = null;

  /** boot() made the context, so dispose() is the one allowed to close it */
  private ownsContext: boolean;

  private constructor(ctx: AudioContext, kernel: KernelNode, opts: BootOptions, ownsContext = false) {
    this.ctx = ctx;
    this.kernel = kernel;
    this.ownsContext = ownsContext;
    this.seed = opts.seed ?? 'bellows-' + bootCount++;
    this.initialBpm = opts.bpm ?? 120;
    this.initialMeter = opts.meter ?? DEFAULT_METER;
    this.transport = new Transport({ bpm: this.initialBpm, meter: this.initialMeter });
    this.scheduler = new Scheduler(this.transport);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    kernel.node.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    kernel.onReply((reply) => {
      if (reply.type === 'meter') this.lastMeter = reply;
      else if (reply.type === 'error') {
        this.kernelErrors.push(reply.message);
        if (this.kernelErrors.length > 20) this.kernelErrors.shift();
        if (this.onError) this.onError(reply.message);
        else console.error('bellows kernel:', reply.message);
      }
    });
    if (opts.masterGain !== undefined) this.post({ type: 'masterGain', gain: opts.masterGain });
    this.timer = setInterval(() => {
      if (this.transport.state === 'running') this.scheduler.tick(this.ctx.currentTime);
    }, 25);
  }

  static async boot(opts: BootOptions = {}): Promise<Bellows> {
    registerBuiltins();
    const ownsContext = opts.closeContextOnDispose ?? opts.context === undefined;
    const ctx = opts.context ?? new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') {
      // resume() never settles when there is no user activation; racing a
      // short timeout keeps boot() from hanging, and the context resumes on
      // the first real gesture anyway
      try {
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
      } catch {
        // resumes on the first user gesture; boot() from a click handler to avoid this
      }
    }
    const kernel = await createKernelNode(ctx, { workletUrl: opts.workletUrl });
    return new Bellows(ctx, kernel, opts, ownsContext);
  }

  /* ------------------------------------------------------------ */
  /* plumbing                                                      */
  /* ------------------------------------------------------------ */

  /**
   * Post a structural message: applied live and recorded for offline replay.
   * The recording collapses repeated setters (see SetupLog) so a piece that
   * moves a param every bar does not grow its setup stream forever.
   */
  private post(msg: KernelMessage, transfer?: Transferable[]): void {
    this.setup.record(msg);
    // transfers would detach the recorded copy, so bank payloads post a clone
    this.kernel.post(msg, transfer);
  }

  /** Recorded setup message count. Exposed so growth is testable. */
  get setupSize(): number {
    return this.setup.size;
  }

  /**
   * Tear down a channel: free its voice pool in the kernel and drop it from
   * the setup stream so an offline render does not rebuild it. Reached only
   * through Instrument.dispose().
   *
   * removeChannel deletes the voice pool outright, so anything still sounding
   * is cut mid-sample. Held notes are released first, and releaseSeconds
   * defers the removal so a tail can decay instead of clicking. The timer runs
   * on the main thread because the channel only has to survive until it is
   * silent, which is not a sample-accurate deadline.
   *
   * @internal
   */
  disposeChannel(id: number, releaseSeconds = 0): void {
    // Posted straight to the kernel, never recorded: an offline replay should
    // not build the channel and then tear it down again.
    this.setup.forgetChannel(id);
    this.singing.delete(id);
    if (releaseSeconds > 0) {
      this.postEvents([
        { time: this.ctx.currentTime, kind: EventKind.AllNotesOff, target: id, a: 0, b: 0, c: 0 },
      ]);
      const timer = setTimeout(() => {
        this.pendingRemovals.delete(timer);
        if (!this.gone) this.kernel.post({ type: 'removeChannel', id });
      }, releaseSeconds * 1000);
      this.pendingRemovals.add(timer);
      return;
    }
    this.kernel.post({ type: 'removeChannel', id });
  }

  private postEvents(events: KernelEvent[]): void {
    if (this.renderCtx) {
      this.renderCtx.events.push(...events);
    } else {
      this.kernel.post({ type: 'events', events });
    }
  }

  private activeTransport(): Transport {
    return this.renderCtx ? this.renderCtx.transport : this.transport;
  }

  /**
   * Current engine time in seconds. During render() this is the tick time of
   * the callback being re-run, the same value untimed calls resolve to, which
   * makes it a fourth replay invariant alongside the three in HANDOFF item 3.
   * Without the branch a callback written `inst.note(n, { at: b.now() + 0.1 })`
   * stamps live wall-clock times into renderCtx.events during a replay and
   * every note in the export lands at roughly the same instant.
   */
  now(): number {
    return this.renderCtx ? this.renderCtx.now : this.ctx.currentTime;
  }

  /** The stream a label resolves to right now: the render's cache during a
   *  render, the live cache otherwise. */
  private rngStream(label: string): NamedRng {
    const cache = this.renderCtx ? this.renderCtx.rngCache : this.liveRng;
    let r = cache.get(label);
    if (!r) {
      r = rng(this.seed + '::' + label);
      cache.set(label, r);
    }
    return r;
  }

  /**
   * A named random stream forked off the piece seed. Deterministic per seed.
   *
   * What comes back is a stable HANDLE, not the stream itself: every draw
   * resolves the stream for the current context at the moment it is drawn.
   * That is what makes the form every doc page teaches work, capturing once
   * outside the tick callback (`const melody = b.rng('melody')`) and drawing
   * inside it. Returning the raw stream bound the callback to whichever cache
   * was live at capture time, so a render consumed and advanced live state
   * instead of reading its own fresh cache, and two renders of one seed
   * produced different music.
   *
   * fork() delegates rather than being handled here on purpose. A fork depends
   * only on its parent's LABEL, never on the parent's position, so
   * `rng(label).fork(child) === rng(label + '::' + child)` still holds and the
   * C++ port can still land on the same stream by writing the full label path.
   */
  rng(label: string): NamedRng {
    const existing = this.rngHandles.get(label);
    if (existing) return existing;
    const at = (): NamedRng => this.rngStream(label);
    const fn = (() => at()()) as NamedRng & { label: string };
    fn.label = this.seed + '::' + label;
    fn.fork = (child: string) => at().fork(child);
    fn.int = (n: number) => at().int(n);
    fn.pick = <T>(arr: readonly T[]): T => at().pick(arr);
    fn.range = (lo: number, hi: number) => at().range(lo, hi);
    fn.chance = (p: number) => at().chance(p);
    fn.shuffle = <T>(arr: readonly T[]): T[] => at().shuffle(arr);
    fn.gauss = () => at().gauss();
    fn.weighted = (weights: ArrayLike<number>) => at().weighted(weights);
    this.rngHandles.set(label, fn);
    return fn;
  }

  /* ------------------------------------------------------------ */
  /* instruments                                                   */
  /* ------------------------------------------------------------ */

  /** Create an instrument channel running the given engine. */
  voice(engineId: string, params: Record<string, number> = {}, opts?: { polyphony?: number }): Instrument {
    const id = this.nextChannel++;
    this.post({
      type: 'createChannel',
      id,
      engineId,
      params,
      seed: this.seed + '::ch' + id,
      polyphony: opts?.polyphony,
    });
    if (engineId === 'vocal') {
      // what the engine itself does with a creation value that is not a number
      const own = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      this.singing.set(id, {
        restPhoneme: own(params.phoneme),
        restBend: own(params.bend),
        glide: own(params.glide),
        overshoot: own(params.overshoot),
        preparation: own(params.preparation),
        windows: [],
      });
    }
    return new Instrument(this, id, engineId);
  }

  /**
   * Load an instrument by URI. Supported: 'sf2:<url>#<bank>:<program>'.
   * Plain engine ids also work: instrument('fm') equals voice('fm').
   */
  async instrument(uri: string): Promise<Instrument> {
    if (uri.startsWith('sf2:')) {
      const rest = uri.slice(4);
      const [url, sel] = rest.split('#');
      const [bank, program] = (sel ?? '0:0').split(':').map(Number);
      const res = await fetch(url);
      if (!res.ok) throw new Error('bellows: failed to fetch soundfont ' + url);
      return this.sf2Instrument(await res.arrayBuffer(), bank || 0, program || 0);
    }
    return this.voice(uri);
  }

  /** Build a sampler instrument from a parsed or raw SF2 preset. */
  sf2Instrument(data: ArrayBuffer | SoundFont, bank: number, program: number): Instrument {
    const sf = data instanceof SoundFont ? data : SoundFont.parse(data);
    const zones = samplerBankFromSf2(sf, bank, program).zones;
    return this.samplerInstrument(zones, 'sf2-' + bank + '-' + program + '-' + this.nextChannel);
  }

  /** Build a sampler instrument from raw zone data. */
  samplerInstrument(zones: SamplerZoneData[], bankId?: string): Instrument {
    const id = bankId ?? 'bank' + this.nextChannel;
    this.post({ type: 'registerBank', bankId: id, zones });
    return this.voice('sampler:' + id);
  }

  /** Build a granular instrument over an audio buffer. */
  granular(data: Float32Array, sampleRate: number, params: Record<string, number> = {}): Instrument {
    const id = 'grain' + this.nextChannel;
    this.post({ type: 'registerGrain', bankId: id, data, sampleRate });
    const inst = this.voice('granular:' + id, params);
    return inst;
  }

  /** Register a custom engine (tier 3). The def must be self-contained. */
  defEngine(def: EngineDef): void {
    registerEngine(def);
    const code = serializeDef(def);
    this.localDefs.push({ kind: 'engine', code });
    this.post({ type: 'defOp', kind: 'engine', code });
  }

  /** Register a custom effect (tier 3). The def must be self-contained. */
  defEffect(def: EffectDef): void {
    registerEffect(def);
    const code = serializeDef(def);
    this.localDefs.push({ kind: 'effect', code });
    this.post({ type: 'defOp', kind: 'effect', code });
  }

  /* ------------------------------------------------------------ */
  /* mixing                                                        */
  /* ------------------------------------------------------------ */

  /** Create a send bus with an fx chain. */
  bus(fx: FxInput[], opts?: { level?: number }): BusHandle {
    const id = this.nextBus++;
    this.post({ type: 'createBus', id, chain: normalizeFx(fx), returnLevel: opts?.level ?? 1 });
    return new BusHandle(this, id);
  }

  /** Replace the master fx chain. */
  masterFx(...fx: FxInput[]): void {
    this.post({ type: 'masterFx', chain: normalizeFx(fx) });
  }

  masterGain(gain: number): void {
    this.post({ type: 'masterGain', gain });
  }

  /** Hard stop: silence all voices and drop queued events. */
  panic(): void {
    this.kernel.post({ type: 'panic' });
  }

  get meter(): MeterFrame | null {
    return this.lastMeter;
  }

  /* ------------------------------------------------------------ */
  /* time                                                          */
  /* ------------------------------------------------------------ */

  readonly clock = {
    /**
     * Fire cb ahead of every subdivision tick. cb receives the exact tick
     * time in seconds: pass it straight to note({ at }).
     */
    at: (subdivision: TimeValue, cb: TickCallback): (() => void) => {
      const beats = parseTime(subdivision);
      this.subs.push({ subdivision: beats, cb });
      const off = this.scheduler.at(beats, cb);
      return () => {
        off();
        this.subs = this.subs.filter((s) => s.cb !== cb);
      };
    },
  };

  start(): void {
    this.scheduler.rewind();
    this.transport.start(this.ctx.currentTime + 0.05);
  }

  stop(): void {
    this.transport.stop();
    this.panic();
  }

  bpm(value: number): void {
    const beat = this.transport.state === 'running' ? this.transport.beatAt(this.ctx.currentTime) : 0;
    this.transportOps.push({ kind: 'bpm', atBeat: beat, a: value, b: 0 });
    this.transport.setBpm(value, this.ctx.currentTime);
  }

  /** Ramp the tempo linearly over a span of beats (TimeValue accepted). */
  rampBpm(value: number, over: TimeValue): void {
    const beats = parseTime(over);
    const now = this.ctx.currentTime;
    const running = this.transport.state === 'running';
    const beat = running ? this.transport.beatAt(now) : 0;
    const anchor = this.transport.tempo.bpmAt(beat);
    this.transportOps.push({ kind: 'ramp', atBeat: beat, a: value, b: beats, c: anchor });
    this.transport.rampBpm(value, beats, running ? now : undefined);
  }

  /** Freeze the transport, drop queued events, silence held voices. */
  pause(): void {
    this.transport.pause(this.ctx.currentTime);
    this.panic();
  }

  /** Continue from the paused position; delivery re-aims at the paused beat. */
  resume(): void {
    const now = this.ctx.currentTime + 0.05;
    const beat = this.transport.beatAt(now);
    this.transport.resume(now);
    this.scheduler.resyncTo(beat);
  }

  swing(amount: number, subdivision: TimeValue = '8n'): void {
    const sub = parseTime(subdivision);
    this.transportOps.push({ kind: 'swing', atBeat: 0, a: amount, b: sub });
    this.transport.setSwing(amount, sub);
  }

  /* ------------------------------------------------------------ */
  /* musical helpers                                               */
  /* ------------------------------------------------------------ */

  /** 'D dorian' or (root, name). */
  scale(spec: string): Scale;
  scale(root: string | number, name: string): Scale;
  scale(a: string | number, b?: string): Scale {
    if (b !== undefined) return new Scale(a, b);
    const parts = String(a).trim().split(/\s+/);
    const root = parts.shift() ?? 'C';
    return new Scale(root, parts.join(' ') || 'major');
  }

  euclid(steps: number, pulses: number, rotation = 0): number[] {
    return euclid(pulses, steps, rotation);
  }

  /** Resolve a NoteValue to a frequency through the active tuning. */
  freqOf(note: NoteValue, scale?: Scale): number {
    if (typeof note === 'object') {
      if ('hz' in note) return note.hz;
      const sc = scale ?? this.scale('C major');
      return this.tuning.freqOf(sc.degreeToMidi(note.degree, note.octave ?? 4));
    }
    const midi = typeof note === 'string' ? parseNote(note) : note;
    return this.tuning.freqOf(midi);
  }

  /** Duration in seconds for a TimeValue starting at an absolute time. */
  durationSeconds(dur: TimeValue | { seconds: number }, atSeconds: number): number {
    if (typeof dur === 'object') return dur.seconds;
    const beats = parseTime(dur);
    const tr = this.activeTransport();
    // stopped transports still honor the tempo map, matching offline replay
    if (tr.state !== 'running') return tr.tempo.beatToSeconds(beats);
    const startBeat = tr.beatAt(atSeconds);
    return tr.secondsAt(startBeat + beats) - atSeconds;
  }

  /* ------------------------------------------------------------ */
  /* events (used by Instrument)                                   */
  /* ------------------------------------------------------------ */

  noteEvents(channel: number, note: NoteValue, opts: NoteOptions, scale?: Scale): void {
    const at = opts.at ?? (this.renderCtx ? this.renderCtx.now : this.ctx.currentTime + 0.005);
    const dur = this.durationSeconds(opts.dur ?? '8n', at);
    const vel = clamp(opts.vel ?? 0.8, 0, 1);
    const freq = this.freqOf(note, scale);
    const id = this.nextNote++;
    this.postEvents([
      { time: at, kind: EventKind.NoteOn, target: channel, a: id, b: freq, c: vel },
      { time: at + dur, kind: EventKind.NoteOff, target: channel, a: id, b: 0, c: 0 },
    ]);
  }

  /**
   * Plan a sung line and post it: durations through the tempo map, pitches
   * through the tuning, lyrics through the front ends, then one note per
   * phrase with `phoneme` and `bend` events inside it (see src/sing.ts).
   * Instrument.sing() is the API; this checks no engine.
   *
   * @internal
   */
  singEvents(
    channel: number,
    lyrics: string | readonly Syllable[],
    notes: readonly SingNote[],
    opts: SingOptions = {},
  ): SingResult {
    const syllables =
      typeof lyrics === 'string'
        ? lyricsToSyllables(lyrics, { dictionary: opts.dictionary ?? this.dictionary ?? undefined, allophones: opts.allophones })
        : lyrics;
    const state = this.singState(channel);
    const now = this.renderCtx ? this.renderCtx.now : this.ctx.currentTime;
    // live, a phrase that has ended can no longer meet a new one: its events are spent
    if (!this.renderCtx) state.windows = state.windows.filter((w) => w.end >= now);
    const post = (at: number) => {
      const plan = planSung(this.sungNotes(notes, at, opts.scale), syllables);
      const posted = sungEvents(plan, {
        channel,
        phonemeParam: this.paramIndex('phoneme'),
        bendParam: this.paramIndex('bend'),
        nextPhonemeParam: this.paramIndex('nextPhoneme'),
        nextInParam: this.paramIndex('nextIn'),
        planLead: VOCAL_PLAN_LEAD,
        bendLead: vocalGlideLead(state.glide, state.overshoot, state.preparation),
        firstNoteId: this.nextNote,
        restPhoneme: state.restPhoneme,
        restBend: state.restBend,
        busy: state.windows,
        // a stop released before the render starts, or before now, never sounds
        notBefore: this.renderCtx ? 0 : now,
      });
      return { plan, posted };
    };
    let { plan, posted } = post(opts.at ?? (this.renderCtx ? now : now + 0.005));
    // live with no `at`, the first beat goes after the opening consonants, as
    // soon as they can all still sound, instead of losing them to the past
    if (opts.at === undefined && !this.renderCtx && posted.leadIn > 0) ({ plan, posted } = post(now + 0.005 + posted.leadIn));
    this.nextNote += plan.phrases.length;
    if (posted.events.length > 0) this.postEvents(posted.events);
    state.windows = state.windows.concat(posted.windows).sort((a, b) => a.start - b.start);
    return { phrases: plan.phrases, leadIn: posted.leadIn, unknown: posted.unknown, trimmed: posted.trimmed };
  }

  /**
   * A sung line's notes laid end to end from `at`, in seconds and Hz. With
   * the transport running each duration is measured from where its note
   * starts, so a tempo ramp under the line stretches the later notes; with
   * it stopped the line's own beats run through the tempo map from its
   * start, as a stopped note() measures from beat 0.
   */
  private sungNotes(notes: readonly SingNote[], at: number, scale?: Scale): SungNote[] {
    const tr = this.activeTransport();
    const running = tr.state === 'running';
    let t = at;
    let beats = 0;
    const sung: SungNote[] = [];
    for (const n of notes) {
      let d: number;
      if (running || typeof n.dur === 'object') d = this.durationSeconds(n.dur, t);
      else {
        const b = parseTime(n.dur);
        d = tr.tempo.beatToSeconds(beats + b) - tr.tempo.beatToSeconds(beats);
        if (Number.isFinite(b) && b > 0) beats += b;
      }
      // one bad duration would otherwise push every later note to NaN
      const dur = Number.isFinite(d) && d > 0 ? d : 0;
      if (n.note !== null) sung.push({ time: t, dur, hz: this.freqOf(n.note, scale), vel: n.vel });
      t += dur;
    }
    return sung;
  }

  /** The sing() state of a channel in the current context, made on first use. */
  private singState(channel: number): SingState {
    const map = this.renderCtx ? this.renderCtx.singing : this.singing;
    let state = map.get(channel);
    if (!state) {
      state = { windows: [] };
      map.set(channel, state);
    }
    return state;
  }

  /**
   * An untimed phoneme or bend on a vocal channel becomes the channel's own,
   * which sung lines hand back when they end. A line already posted would
   * still hand back the old value at its end, so the new one is posted
   * there too, after that line's resets, unless another line opens at that
   * moment and owns the channel.
   */
  private restOnSungChannel(channel: number, name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const map = this.renderCtx ? this.renderCtx.singing : this.singing;
    const state = map.get(channel);
    if (!state) return;
    if (name === 'glide' || name === 'overshoot' || name === 'preparation') {
      state[name] = value;
      return;
    }
    if (name !== 'phoneme' && name !== 'bend') return;
    if (name === 'phoneme') state.restPhoneme = value;
    else state.restBend = value;
    const now = this.renderCtx ? this.renderCtx.now : this.ctx.currentTime;
    const idx = this.paramIndex(name);
    const fixes: KernelEvent[] = [];
    for (const w of state.windows) {
      if (!w.resets || w.end < now) continue;
      if (state.windows.some((o) => o.start === w.end)) continue;
      fixes.push({ time: w.end, kind: EventKind.Param, target: channel, a: idx, b: value, c: 0 });
    }
    if (fixes.length > 0) this.postEvents(fixes);
  }

  noteOnEvent(channel: number, note: NoteValue, vel: number, at?: number): number {
    const t = at ?? (this.renderCtx ? this.renderCtx.now : this.ctx.currentTime + 0.005);
    const id = this.nextNote++;
    this.postEvents([
      { time: t, kind: EventKind.NoteOn, target: channel, a: id, b: this.freqOf(note), c: clamp(vel, 0, 1) },
    ]);
    return id;
  }

  noteOffEvent(channel: number, noteId: number, at?: number): void {
    const t = at ?? (this.renderCtx ? this.renderCtx.now : this.ctx.currentTime + 0.005);
    this.postEvents([{ time: t, kind: EventKind.NoteOff, target: channel, a: noteId, b: 0, c: 0 }]);
  }

  /** Intern a param name once, telling the kernel the index it answers to. */
  private paramIndex(name: string): number {
    let idx = this.internedParams.get(name);
    if (idx === undefined) {
      idx = internParam(name);
      this.internedParams.set(name, idx);
      this.post({ type: 'internParam', name, index: idx });
    }
    return idx;
  }

  paramEvent(channel: number, name: string, value: number, at?: number): void {
    const idx = this.paramIndex(name);
    if (at === undefined) this.restOnSungChannel(channel, name, value);
    if (at === undefined && !this.renderCtx) {
      this.post({ type: 'channelParam', id: channel, name, value });
      return;
    }
    // in a render, an untimed param lands at the tick being replayed, which
    // is when the live call would have taken effect
    const t = at ?? (this.renderCtx ? this.renderCtx.now : 0);
    this.postEvents([{ time: t, kind: EventKind.Param, target: channel, a: idx, b: value, c: 0 }]);
  }

  /**
   * Glide a param to a value over a span of time. Always an event, never a
   * recorded setter: a ramp is a move through time, so replaying it as a
   * final value would lose the shape.
   */
  rampParamEvent(
    channel: number,
    name: string,
    value: number,
    over: TimeValue | { seconds: number },
    at?: number,
  ): void {
    const idx = this.paramIndex(name);
    const t = at ?? (this.renderCtx ? this.renderCtx.now : this.ctx.currentTime + 0.005);
    const seconds = this.durationSeconds(over, t);
    this.postEvents([
      { time: t, kind: EventKind.ParamRamp, target: channel, a: idx, b: value, c: seconds },
    ]);
  }

  structural(msg: KernelMessage): void {
    this.post(msg);
  }

  postAllOff(channel: number): void {
    const t = this.renderCtx ? this.renderCtx.now : this.ctx.currentTime;
    this.postEvents([{ time: t, kind: EventKind.AllNotesOff, target: channel, a: 0, b: 0, c: 0 }]);
  }

  /* ------------------------------------------------------------ */
  /* offline render                                                */
  /* ------------------------------------------------------------ */

  /**
   * Render the piece offline through a fresh kernel: same setup messages,
   * same clock callbacks, fresh seeded rng streams (a render equals what a
   * fresh page load would play, as long as randomness flows through
   * b.rng()). Returns audio plus a wav() encoder.
   */
  async render(opts: {
    bars?: number;
    beats?: number;
    seconds?: number;
    sampleRate?: number;
  }): Promise<RenderedAudio & { wav(bitDepth?: 16 | 24 | 32): ArrayBuffer }> {
    const sampleRate = opts.sampleRate ?? 44100;

    // rebuild the transport history offline
    const offTransport = new Transport({ bpm: this.initialBpm, meter: this.initialMeter });
    for (const op of this.transportOps) {
      if (op.kind === 'bpm') op.atBeat === 0 ? offTransport.setBpm(op.a) : offTransport.tempo.setBpm(op.atBeat, op.a);
      else if (op.kind === 'ramp') {
        // replay the anchor first so the ramp starts where live playback did
        if (op.c !== undefined && op.atBeat > 0) offTransport.tempo.setBpm(op.atBeat, op.c);
        offTransport.tempo.rampTo(op.atBeat + op.b, op.a);
      } else if (op.kind === 'swing') offTransport.setSwing(op.a, op.b);
    }
    offTransport.start(0);

    let seconds: number;
    if (opts.seconds !== undefined) seconds = opts.seconds;
    else {
      const beats = opts.beats ?? (opts.bars ?? 4) * 4;
      seconds = offTransport.secondsAt(beats);
    }

    // rerun the clock callbacks against the offline transport
    // a render starts from each vocal channel's own values as they are now,
    // which is where the replayed setup leaves the channel, and no lines
    const singing = new Map<number, SingState>();
    for (const [id, st] of this.singing) singing.set(id, { ...st, windows: [] });
    this.renderCtx = { events: [], transport: offTransport, rngCache: new Map(), now: 0, singing };
    try {
      const ticks: Array<{ t: number; step: number; cb: TickCallback }> = [];
      for (const sub of this.subs) {
        for (const tick of offTransport.scheduleHorizon(0, seconds, sub.subdivision)) {
          ticks.push({ t: tick.seconds, step: tick.step, cb: sub.cb });
        }
      }
      ticks.sort((a, b) => a.t - b.t);
      for (const tick of ticks) {
        this.renderCtx.now = tick.t;
        tick.cb(tick.t, tick.step);
      }

      const events = this.renderCtx.events;
      const setup = this.setup.messages.filter((m) => m.type !== 'events');
      const rendered = renderOffline([...setup, { type: 'events', events }], {
        seconds,
        sampleRate,
        kernel: { resolveBankEngine: bankEngineResolver },
      });
      return {
        ...rendered,
        wav: (bitDepth: 16 | 24 | 32 = 16) =>
          encodeWav([rendered.left, rendered.right], sampleRate, { bitDepth }),
      };
    } finally {
      this.renderCtx = null;
    }
  }

  /** True once dispose() has run. Everything below it is torn down. */
  get disposed(): boolean {
    return this.gone;
  }

  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    if (this.timer) clearInterval(this.timer);
    for (const t of this.pendingRemovals) clearTimeout(t);
    this.pendingRemovals.clear();
    this.scheduler.clear();
    this.transport.stop();
    this.kernel.dispose();
    this.analyser.disconnect();
    // browsers cap live AudioContexts per page (around six), so a boot that
    // made its own context has to give it back. A caller supplied context is
    // theirs: leave it running.
    if (this.ownsContext) {
      try {
        const closing = this.ctx.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      } catch {
        // some hosts throw on closing an already closed context
      }
    }
  }
}

/* ------------------------------------------------------------ */
/* handles                                                        */
/* ------------------------------------------------------------ */

export class Instrument {
  private gone = false;

  /**
   * `engineId` is what voice() created the channel with. It is optional so
   * code that built an Instrument by hand keeps compiling; such a handle
   * cannot sing(), because nothing says its engine can.
   */
  constructor(
    private b: Bellows,
    readonly channel: number,
    readonly engineId?: string,
  ) {}

  /** True once dispose() has run. A disposed handle ignores everything. */
  get disposed(): boolean {
    return this.gone;
  }

  /** Play a note. NoteValue: midi number, 'C#4', { hz }, or { degree, octave }. */
  note(note: NoteValue, opts: NoteOptions = {}, scale?: Scale): this {
    if (this.gone) return this;
    this.b.noteEvents(this.channel, note, opts, scale);
    return this;
  }

  chord(notes: NoteValue[], opts: NoteOptions = {}): this {
    if (this.gone) return this;
    for (const n of notes) this.b.noteEvents(this.channel, n, opts);
    return this;
  }

  /**
   * Sing a lyric on a melody. Needs the 'vocal' engine: b.voice('vocal').
   *
   * Notes are laid end to end from `at`, each `dur` through the tempo map
   * and each pitch through the tuning and `scale`, so the line follows
   * b.tuning however it divides the octave. Each note's vowel lands on its
   * beat; opening consonants start before it. Lyrics are English (through
   * b.dictionary or opts.dictionary when set, letter-to-sound rules
   * otherwise) and IPA between slashes: 'the /ˈkæt/ sat'. A hyphen splits
   * a word across notes, a free-standing '-' or '~' holds the vowel onto
   * the next note, and punctuation or a rest ends a phrase with a breath.
   *
   * Returns the plan. Its `leadIn` is the longest any phrase starts before
   * its own first beat: live, call at least that far ahead, or the opening
   * consonants are already past when they reach the kernel. b.render() collects
   * events before rendering, so a sing() inside a clock callback replays
   * exactly.
   *
   * One instrument sings one line at a time, because `phoneme` and `bend`
   * are channel parameters: give a harmony its own voice(). A line that
   * would start while an earlier line on this instrument is still singing
   * starts where that one ends, losing the opening consonants that
   * overlapped it, and `trimmed` says how much went; leave room for the
   * next line's `leadIn` (a rest, or a shorter last note) to hear all of
   * it. While a line sings, `bend` belongs to it, so a channel's own bend
   * does not transpose it; when the line ends the channel gets back the
   * phoneme and bend it was created with, or last given by an untimed
   * param(). Any phoneme or bend change, untimed included, also reaches a
   * line that is singing at that moment, so keep them clear of sung lines.
   */
  sing(lyrics: string | readonly Syllable[], notes: readonly SingNote[], opts: SingOptions = {}): SingResult {
    if (this.gone) return { phrases: [], leadIn: 0, unknown: [], trimmed: 0 };
    if (this.engineId !== 'vocal') {
      const which = this.engineId === undefined ? 'an engine voice() did not record' : `'${this.engineId}'`;
      throw new Error(
        `bellows: sing() needs an instrument on the 'vocal' engine, and this one runs ${which}. ` +
          `Create one with b.voice('vocal').`,
      );
    }
    return this.b.singEvents(this.channel, lyrics, notes, opts);
  }

  /** Sustain a note; returns an id for off(). Disposed: returns -1. */
  on(note: NoteValue, vel = 0.8, at?: number): number {
    if (this.gone) return -1;
    return this.b.noteOnEvent(this.channel, note, vel, at);
  }

  off(noteId: number, at?: number): this {
    if (this.gone) return this;
    this.b.noteOffEvent(this.channel, noteId, at);
    return this;
  }

  /** Set an engine parameter, immediately or at a scheduled time. */
  param(name: string, value: number, at?: number): this {
    if (this.gone) return this;
    this.b.paramEvent(this.channel, name, value, at);
    return this;
  }

  /**
   * Glide a parameter to a value over a span of time, starting at `at` (or
   * now) from wherever the parameter currently sits. `over` takes beats,
   * notation like '4n', or { seconds }.
   */
  rampParam(name: string, value: number, over: TimeValue | { seconds: number }, at?: number): this {
    if (this.gone) return this;
    this.b.rampParamEvent(this.channel, name, value, over, at);
    return this;
  }

  /** Replace this instrument's insert chain. */
  fx(...fx: FxInput[]): this {
    if (this.gone) return this;
    this.b.structural({ type: 'channelFx', id: this.channel, chain: normalizeFx(fx) });
    return this;
  }

  fxParam(fxIndex: number, name: string, value: number): this {
    if (this.gone) return this;
    this.b.structural({ type: 'fxParam', channelId: this.channel, fxIndex, name, value });
    return this;
  }

  send(bus: BusHandle, level: number): this {
    if (this.gone) return this;
    this.b.structural({ type: 'send', channelId: this.channel, busId: bus.id, level });
    return this;
  }

  gain(value: number): this {
    if (this.gone) return this;
    this.b.structural({ type: 'channelGain', id: this.channel, gain: value });
    return this;
  }

  pan(value: number): this {
    if (this.gone) return this;
    this.b.structural({ type: 'channelPan', id: this.channel, pan: value });
    return this;
  }

  allOff(): this {
    if (this.gone) return this;
    this.b.postAllOff(this.channel);
    return this;
  }

  /**
   * Free the channel: the kernel drops its voice pool, and the setup stream
   * forgets it so an offline render does not rebuild it. Idempotent, and a
   * disposed handle goes inert rather than throwing, since a hot swap can
   * easily leave a stale reference in a closure.
   *
   * Dropping the pool cuts anything still sounding mid-sample. Pass
   * releaseSeconds to release held notes and defer the removal by that long,
   * which is what a hot swap wants: the outgoing engine rings out while the
   * incoming one plays.
   */
  dispose(opts: { releaseSeconds?: number } = {}): void {
    if (this.gone) return;
    this.gone = true;
    this.b.disposeChannel(this.channel, opts.releaseSeconds ?? 0);
  }
}

export class BusHandle {
  constructor(private b: Bellows, readonly id: number) {}

  fxParam(fxIndex: number, name: string, value: number): this {
    this.b.structural({ type: 'busFxParam', busId: this.id, fxIndex, name, value });
    return this;
  }
}

/** Frequency helper reexport so engines and users share one 12-EDO mtof. */
export { mtof };
