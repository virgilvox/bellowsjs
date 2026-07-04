/*
 * Web MIDI wrapper. parseMidiMessage and MpeZone are pure and run in
 * Node; MidiInput and MidiOutput bind to navigator.requestMIDIAccess and
 * throw a clear error where Web MIDI does not exist. MPE support groups
 * per-note member channels into note objects carrying per-note bend,
 * pressure, and timbre (cc74).
 */

/* ------------------------------------------------------------------ */
/* Pure message parsing                                                */
/* ------------------------------------------------------------------ */

export type MidiMessage =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'keyPressure'; channel: number; note: number; value: number }
  | { type: 'controlChange'; channel: number; controller: number; value: number }
  | { type: 'programChange'; channel: number; program: number }
  | { type: 'channelPressure'; channel: number; value: number }
  /** value is the raw 14-bit bend 0..16383; bend maps it to [-1, 1) with 8192 at 0. */
  | { type: 'pitchBend'; channel: number; value: number; bend: number };

/**
 * Parse one channel voice message. Note on with velocity 0 becomes note
 * off. System messages and truncated input return null.
 */
export function parseMidiMessage(bytes: ArrayLike<number>): MidiMessage | null {
  if (bytes.length < 1) return null;
  const status = bytes[0];
  if (status < 0x80 || status >= 0xf0) return null;
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const d1 = bytes.length > 1 ? bytes[1] & 0x7f : 0;
  const d2 = bytes.length > 2 ? bytes[2] & 0x7f : 0;

  switch (kind) {
    case 0x90:
      if (bytes.length < 3) return null;
      if (d2 === 0) return { type: 'noteOff', channel, note: d1, velocity: 0 };
      return { type: 'noteOn', channel, note: d1, velocity: d2 };
    case 0x80:
      if (bytes.length < 3) return null;
      return { type: 'noteOff', channel, note: d1, velocity: d2 };
    case 0xa0:
      if (bytes.length < 3) return null;
      return { type: 'keyPressure', channel, note: d1, value: d2 };
    case 0xb0:
      if (bytes.length < 3) return null;
      return { type: 'controlChange', channel, controller: d1, value: d2 };
    case 0xc0:
      if (bytes.length < 2) return null;
      return { type: 'programChange', channel, program: d1 };
    case 0xd0:
      if (bytes.length < 2) return null;
      return { type: 'channelPressure', channel, value: d1 };
    case 0xe0: {
      if (bytes.length < 3) return null;
      const value = d1 | (d2 << 7);
      return { type: 'pitchBend', channel, value, bend: (value - 8192) / 8192 };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* MPE                                                                 */
/* ------------------------------------------------------------------ */

export interface MpeZoneConfig {
  /** 0 for the lower zone (default), 15 for the upper zone. */
  masterChannel?: 0 | 15;
  /** Member channel count adjacent to the master. Default 15. */
  memberChannels?: number;
  /** Per-note pitch bend range in semitones. Default 48. */
  bendRange?: number;
  /** Master channel pitch bend range in semitones. Default 2. */
  masterBendRange?: number;
}

export interface MpeNote {
  note: number;
  /** Normalized 0..1. */
  velocity: number;
  channel: number;
  /** Total bend in semitones: per-note bend plus master bend. */
  bend: number;
  /** Channel pressure, normalized 0..1. */
  pressure: number;
  /** cc74, normalized 0..1. */
  timbre: number;
  active: boolean;
}

/**
 * Groups an MPE member-channel stream into per-note objects. Feed raw
 * message bytes (or parsed messages); listen with onNoteStart,
 * onNoteChange, onNoteEnd. Master channel bend shifts every note.
 */
export class MpeZone {
  private readonly masterChannel: number;
  private readonly memberSet: Set<number>;
  private readonly bendRange: number;
  private readonly masterBendRange: number;
  private masterBend = 0;
  /** Last per-note bend in semitones, kept per channel across notes. */
  private readonly perNoteBend = new Map<number, number>();
  private readonly byChannel = new Map<number, MpeNote>();
  private startCbs: ((n: MpeNote) => void)[] = [];
  private changeCbs: ((n: MpeNote) => void)[] = [];
  private endCbs: ((n: MpeNote) => void)[] = [];

  constructor(config: MpeZoneConfig = {}) {
    this.masterChannel = config.masterChannel ?? 0;
    this.bendRange = config.bendRange ?? 48;
    this.masterBendRange = config.masterBendRange ?? 2;
    const count = config.memberChannels ?? 15;
    this.memberSet = new Set();
    const dir = this.masterChannel === 15 ? -1 : 1;
    for (let i = 1; i <= count; i++) {
      const ch = this.masterChannel + dir * i;
      if (ch >= 0 && ch <= 15) this.memberSet.add(ch);
    }
  }

  onNoteStart(cb: (n: MpeNote) => void): void {
    this.startCbs.push(cb);
  }

  onNoteChange(cb: (n: MpeNote) => void): void {
    this.changeCbs.push(cb);
  }

  onNoteEnd(cb: (n: MpeNote) => void): void {
    this.endCbs.push(cb);
  }

  /** Currently sounding notes. */
  get notes(): MpeNote[] {
    return [...this.byChannel.values()];
  }

  feed(bytes: ArrayLike<number>): void {
    const msg = parseMidiMessage(bytes);
    if (msg !== null) this.handle(msg);
  }

  handle(msg: MidiMessage): void {
    const ch = msg.channel;

    if (ch === this.masterChannel) {
      if (msg.type === 'pitchBend') {
        this.masterBend = msg.bend * this.masterBendRange;
        for (const note of this.byChannel.values()) {
          note.bend = this.noteBend(note.channel);
          this.emit(this.changeCbs, note);
        }
      }
      return;
    }
    if (!this.memberSet.has(ch)) return;

    switch (msg.type) {
      case 'noteOn': {
        const note: MpeNote = {
          note: msg.note,
          velocity: msg.velocity / 127,
          channel: ch,
          bend: this.noteBend(ch),
          pressure: 0,
          timbre: 0.5,
          active: true,
        };
        this.byChannel.set(ch, note);
        this.emit(this.startCbs, note);
        break;
      }
      case 'noteOff': {
        const note = this.byChannel.get(ch);
        if (note !== undefined && note.note === msg.note) {
          note.active = false;
          this.byChannel.delete(ch);
          this.emit(this.endCbs, note);
        }
        break;
      }
      case 'pitchBend': {
        this.perNoteBend.set(ch, msg.bend * this.bendRange);
        const note = this.byChannel.get(ch);
        if (note !== undefined) {
          note.bend = this.noteBend(ch);
          this.emit(this.changeCbs, note);
        }
        break;
      }
      case 'channelPressure': {
        const note = this.byChannel.get(ch);
        if (note !== undefined) {
          note.pressure = msg.value / 127;
          this.emit(this.changeCbs, note);
        }
        break;
      }
      case 'controlChange': {
        if (msg.controller === 74) {
          const note = this.byChannel.get(ch);
          if (note !== undefined) {
            note.timbre = msg.value / 127;
            this.emit(this.changeCbs, note);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private noteBend(ch: number): number {
    return (this.perNoteBend.get(ch) ?? 0) + this.masterBend;
  }

  private emit(cbs: ((n: MpeNote) => void)[], note: MpeNote): void {
    for (const cb of cbs) cb(note);
  }
}

/* ------------------------------------------------------------------ */
/* Device binding                                                      */
/* ------------------------------------------------------------------ */

/* Minimal structural types for Web MIDI so this file does not depend on
 * DOM lib versions. */
interface MidiPortLike {
  id: string;
  name: string | null;
}
interface MidiInputPortLike extends MidiPortLike {
  onmidimessage: ((e: { data: Uint8Array | null }) => void) | null;
}
interface MidiOutputPortLike extends MidiPortLike {
  send(data: number[] | Uint8Array): void;
}
interface MidiAccessLike {
  inputs: ReadonlyMap<string, MidiInputPortLike>;
  outputs: ReadonlyMap<string, MidiOutputPortLike>;
}

let accessPromise: Promise<MidiAccessLike> | null = null;

function requestAccess(): Promise<MidiAccessLike> {
  // Structural cast: keeps this file independent of DOM lib versions and
  // safe in Node. Runtime MIDIInputMap/MIDIOutputMap are maplike objects.
  const nav = (
    globalThis as unknown as {
      navigator?: { requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike> };
    }
  ).navigator;
  if (nav === undefined || typeof nav.requestMIDIAccess !== 'function') {
    throw new Error(
      'webmidi: Web MIDI is not available in this environment (navigator.requestMIDIAccess missing)',
    );
  }
  if (accessPromise === null) accessPromise = nav.requestMIDIAccess();
  return accessPromise;
}

function findPort<T extends MidiPortLike>(
  ports: ReadonlyMap<string, T>,
  idOrName: string | undefined,
  what: string,
): T {
  if (idOrName === undefined) {
    const first = ports.values().next();
    if (first.done) throw new Error(`webmidi: no MIDI ${what} ports available`);
    return first.value;
  }
  for (const p of ports.values()) {
    if (p.id === idOrName || p.name === idOrName) return p;
  }
  throw new Error(`webmidi: no MIDI ${what} port matching "${idOrName}"`);
}

export interface MidiPortInfo {
  id: string;
  name: string;
}

export interface NoteEvent {
  on: boolean;
  note: number;
  /** Normalized 0..1. */
  velocity: number;
  channel: number;
}

export interface ControlEvent {
  controller: number;
  /** Normalized 0..1. */
  value: number;
  channel: number;
}

export interface PitchBendEvent {
  /** Normalized [-1, 1), center 0. */
  bend: number;
  /** Raw 14-bit value 0..16383. */
  value: number;
  channel: number;
}

export class MidiInput {
  /** Resolves once the port is bound. Binding errors reject here. */
  readonly ready: Promise<void>;
  private port: MidiInputPortLike | null = null;
  private closed = false;
  private noteCbs: ((e: NoteEvent) => void)[] = [];
  private controlCbs: ((e: ControlEvent) => void)[] = [];
  private bendCbs: ((e: PitchBendEvent) => void)[] = [];
  private zones: MpeZone[] = [];

  static async list(): Promise<MidiPortInfo[]> {
    const access = await requestAccess();
    return [...access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? '' }));
  }

  constructor(portIdOrName?: string) {
    const access = requestAccess();
    this.ready = access.then((a) => {
      if (this.closed) return;
      this.port = findPort(a.inputs, portIdOrName, 'input');
      this.port.onmidimessage = (e) => {
        if (e.data !== null) this.dispatch(e.data);
      };
    });
  }

  onNote(cb: (e: NoteEvent) => void): void {
    this.noteCbs.push(cb);
  }

  onControl(cb: (e: ControlEvent) => void): void {
    this.controlCbs.push(cb);
  }

  onPitchBend(cb: (e: PitchBendEvent) => void): void {
    this.bendCbs.push(cb);
  }

  /** Route this input through an MPE zone and return it. */
  mpeZone(config: MpeZoneConfig = {}): MpeZone {
    const zone = new MpeZone(config);
    this.zones.push(zone);
    return zone;
  }

  /** Exposed for tests: parse and dispatch one raw message. */
  dispatch(bytes: ArrayLike<number>): void {
    const msg = parseMidiMessage(bytes);
    if (msg === null) return;
    for (const zone of this.zones) zone.handle(msg);
    if (msg.type === 'noteOn' || msg.type === 'noteOff') {
      const e: NoteEvent = {
        on: msg.type === 'noteOn',
        note: msg.note,
        velocity: msg.velocity / 127,
        channel: msg.channel,
      };
      for (const cb of this.noteCbs) cb(e);
    } else if (msg.type === 'controlChange') {
      const e: ControlEvent = {
        controller: msg.controller,
        value: msg.value / 127,
        channel: msg.channel,
      };
      for (const cb of this.controlCbs) cb(e);
    } else if (msg.type === 'pitchBend') {
      const e: PitchBendEvent = { bend: msg.bend, value: msg.value, channel: msg.channel };
      for (const cb of this.bendCbs) cb(e);
    }
  }

  close(): void {
    this.closed = true;
    if (this.port !== null) this.port.onmidimessage = null;
    this.port = null;
    this.noteCbs = [];
    this.controlCbs = [];
    this.bendCbs = [];
    this.zones = [];
  }
}

export class MidiOutput {
  /** Resolves once the port is bound. Binding errors reject here. */
  readonly ready: Promise<void>;
  private port: MidiOutputPortLike | null = null;
  private closed = false;
  /** Messages sent before binding completes are queued and flushed. */
  private queue: number[][] = [];

  static async list(): Promise<MidiPortInfo[]> {
    const access = await requestAccess();
    return [...access.outputs.values()].map((p) => ({ id: p.id, name: p.name ?? '' }));
  }

  constructor(portIdOrName?: string) {
    const access = requestAccess();
    this.ready = access.then((a) => {
      if (this.closed) return;
      this.port = findPort(a.outputs, portIdOrName, 'output');
      for (const m of this.queue) this.port.send(m);
      this.queue = [];
    });
  }

  send(bytes: number[]): void {
    if (this.closed) return;
    if (this.port === null) {
      this.queue.push(bytes);
    } else {
      this.port.send(bytes);
    }
  }

  /** velocity is normalized 0..1. */
  noteOn(note: number, velocity = 1, channel = 0): void {
    const v = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    this.send([0x90 | (channel & 0x0f), note & 0x7f, v]);
  }

  noteOff(note: number, channel = 0): void {
    this.send([0x80 | (channel & 0x0f), note & 0x7f, 0]);
  }

  /** value is normalized 0..1. */
  cc(controller: number, value: number, channel = 0): void {
    const v = Math.max(0, Math.min(127, Math.round(value * 127)));
    this.send([0xb0 | (channel & 0x0f), controller & 0x7f, v]);
  }

  /** bend is normalized [-1, 1], 0 sends the 14-bit center 8192. */
  pitchBend(bend: number, channel = 0): void {
    const v = Math.max(0, Math.min(16383, Math.round(8192 + bend * 8192)));
    this.send([0xe0 | (channel & 0x0f), v & 0x7f, v >> 7]);
  }

  close(): void {
    this.closed = true;
    this.port = null;
    this.queue = [];
  }
}
