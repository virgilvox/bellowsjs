/*
 * Standard MIDI file reader and writer. parseMidi handles formats 0/1/2,
 * running status, sysex, and the common meta events (tempo, time
 * signature, track name, end of track); other meta events are preserved
 * as raw payloads. writeMidi emits explicit status bytes and appends a
 * missing end-of-track. toScore flattens note on/off pairs to
 * tempo-independent beats (beats = ticks / ticksPerQuarter).
 *
 * This module never touches audio; it only maps bytes to note and meta
 * data structures.
 */

export type MidiFileEvent =
  | { tick: number; type: 'noteOn'; channel: number; data: { note: number; velocity: number } }
  | { tick: number; type: 'noteOff'; channel: number; data: { note: number; velocity: number } }
  | { tick: number; type: 'keyPressure'; channel: number; data: { note: number; value: number } }
  | { tick: number; type: 'controlChange'; channel: number; data: { controller: number; value: number } }
  | { tick: number; type: 'programChange'; channel: number; data: { program: number } }
  | { tick: number; type: 'channelPressure'; channel: number; data: { value: number } }
  /** value is the raw 14-bit bend, 0..16383, center 8192. */
  | { tick: number; type: 'pitchBend'; channel: number; data: { value: number } }
  | { tick: number; type: 'tempo'; data: { usPerQuarter: number } }
  | {
      tick: number;
      type: 'timeSignature';
      data: {
        numerator: number;
        denominator: number;
        clocksPerClick: number;
        thirtySecondsPerQuarter: number;
      };
    }
  | { tick: number; type: 'trackName'; data: { text: string } }
  | { tick: number; type: 'endOfTrack'; data: Record<string, never> }
  | { tick: number; type: 'meta'; data: { metaType: number; bytes: Uint8Array } }
  | { tick: number; type: 'sysex'; data: { bytes: Uint8Array } };

export interface ParsedMidi {
  format: 0 | 1 | 2;
  ticksPerQuarter: number;
  tracks: MidiFileEvent[][];
}

export interface ParseMidiOptions {
  /** Convert note on with velocity 0 to note off. Default true. */
  velocityZeroIsNoteOff?: boolean;
}

/* ------------------------------------------------------------------ */
/* Variable-length quantities                                          */
/* ------------------------------------------------------------------ */

/** Encode a non-negative integer as a MIDI variable-length quantity. */
export function encodeVlq(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new Error(`midi: VLQ out of range: ${value}`);
  }
  const bytes: number[] = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return new Uint8Array(bytes);
}

/** Decode a variable-length quantity starting at offset. */
export function decodeVlq(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let i = offset;
  for (let n = 0; n < 4; n++) {
    if (i >= bytes.length) throw new Error('midi: truncated VLQ');
    const b = bytes[i++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return { value, next: i };
  }
  throw new Error('midi: VLQ longer than 4 bytes');
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

class ByteReader {
  private readonly b: Uint8Array;
  pos: number;
  readonly end: number;

  constructor(bytes: Uint8Array, pos = 0, end = bytes.length) {
    this.b = bytes;
    this.pos = pos;
    this.end = end;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  u8(): number {
    if (this.pos >= this.end) throw new Error('midi: unexpected end of data');
    return this.b[this.pos++];
  }

  peek(): number {
    if (this.pos >= this.end) throw new Error('midi: unexpected end of data');
    return this.b[this.pos];
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  bytes(n: number): Uint8Array {
    if (this.pos + n > this.end) throw new Error('midi: unexpected end of data');
    const out = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  vlq(): number {
    const { value, next } = decodeVlq(this.b.subarray(0, this.end), this.pos);
    this.pos = next;
    return value;
  }
}

function ascii(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function parseTrack(r: ByteReader, velocityZeroIsNoteOff: boolean): MidiFileEvent[] {
  const events: MidiFileEvent[] = [];
  let tick = 0;
  let running = 0;

  while (r.remaining > 0) {
    tick += r.vlq();
    let status = r.peek();
    if (status < 0x80) {
      if (running === 0) throw new Error('midi: data byte with no running status');
      status = running;
    } else {
      r.pos++;
    }

    if (status === 0xff) {
      running = 0;
      const metaType = r.u8();
      const len = r.vlq();
      const body = r.bytes(len);
      if (metaType === 0x51 && len === 3) {
        const usPerQuarter = (body[0] << 16) | (body[1] << 8) | body[2];
        events.push({ tick, type: 'tempo', data: { usPerQuarter } });
      } else if (metaType === 0x58 && len === 4) {
        events.push({
          tick,
          type: 'timeSignature',
          data: {
            numerator: body[0],
            denominator: 1 << body[1],
            clocksPerClick: body[2],
            thirtySecondsPerQuarter: body[3],
          },
        });
      } else if (metaType === 0x03) {
        events.push({ tick, type: 'trackName', data: { text: ascii(body) } });
      } else if (metaType === 0x2f) {
        events.push({ tick, type: 'endOfTrack', data: {} });
      } else {
        events.push({ tick, type: 'meta', data: { metaType, bytes: body } });
      }
    } else if (status === 0xf0 || status === 0xf7) {
      running = 0;
      const len = r.vlq();
      events.push({ tick, type: 'sysex', data: { bytes: r.bytes(len) } });
    } else if (status >= 0x80) {
      running = status;
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const d1 = r.u8();
      if (kind === 0x90) {
        const velocity = r.u8();
        if (velocity === 0 && velocityZeroIsNoteOff) {
          events.push({ tick, type: 'noteOff', channel, data: { note: d1, velocity: 0 } });
        } else {
          events.push({ tick, type: 'noteOn', channel, data: { note: d1, velocity } });
        }
      } else if (kind === 0x80) {
        events.push({ tick, type: 'noteOff', channel, data: { note: d1, velocity: r.u8() } });
      } else if (kind === 0xa0) {
        events.push({ tick, type: 'keyPressure', channel, data: { note: d1, value: r.u8() } });
      } else if (kind === 0xb0) {
        events.push({ tick, type: 'controlChange', channel, data: { controller: d1, value: r.u8() } });
      } else if (kind === 0xc0) {
        events.push({ tick, type: 'programChange', channel, data: { program: d1 } });
      } else if (kind === 0xd0) {
        events.push({ tick, type: 'channelPressure', channel, data: { value: d1 } });
      } else if (kind === 0xe0) {
        events.push({ tick, type: 'pitchBend', channel, data: { value: d1 | (r.u8() << 7) } });
      } else {
        throw new Error(`midi: unexpected status byte 0x${status.toString(16)}`);
      }
    }
  }
  return events;
}

export function parseMidi(buf: ArrayBuffer, opts: ParseMidiOptions = {}): ParsedMidi {
  const velocityZeroIsNoteOff = opts.velocityZeroIsNoteOff ?? true;
  const bytes = new Uint8Array(buf);
  const r = new ByteReader(bytes);

  if (r.remaining < 14 || ascii(r.bytes(4)) !== 'MThd') {
    throw new Error('midi: missing MThd header');
  }
  const headerLen = r.u32();
  if (headerLen < 6) throw new Error('midi: MThd too short');
  const format = r.u16();
  if (format !== 0 && format !== 1 && format !== 2) {
    throw new Error(`midi: unknown format ${format}`);
  }
  const trackCount = r.u16();
  const division = r.u16();
  if (division & 0x8000) throw new Error('midi: SMPTE time division is not supported');
  if (division === 0) throw new Error('midi: zero ticks per quarter');
  r.pos += headerLen - 6;

  const tracks: MidiFileEvent[][] = [];
  while (tracks.length < trackCount && r.remaining >= 8) {
    const id = ascii(r.bytes(4));
    const len = r.u32();
    if (r.remaining < len) throw new Error('midi: truncated chunk');
    if (id !== 'MTrk') {
      // The spec requires readers to skip alien chunks.
      r.pos += len;
      continue;
    }
    const trackReader = new ByteReader(bytes, r.pos, r.pos + len);
    tracks.push(parseTrack(trackReader, velocityZeroIsNoteOff));
    r.pos += len;
  }
  if (tracks.length !== trackCount) {
    throw new Error(`midi: expected ${trackCount} tracks, found ${tracks.length}`);
  }

  return { format, ticksPerQuarter: division, tracks };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

function push7(out: number[], v: number): void {
  out.push(v & 0x7f);
}

function writeEvent(out: number[], ev: MidiFileEvent): void {
  switch (ev.type) {
    case 'noteOn':
      out.push(0x90 | (ev.channel & 0x0f));
      push7(out, ev.data.note);
      push7(out, ev.data.velocity);
      break;
    case 'noteOff':
      out.push(0x80 | (ev.channel & 0x0f));
      push7(out, ev.data.note);
      push7(out, ev.data.velocity);
      break;
    case 'keyPressure':
      out.push(0xa0 | (ev.channel & 0x0f));
      push7(out, ev.data.note);
      push7(out, ev.data.value);
      break;
    case 'controlChange':
      out.push(0xb0 | (ev.channel & 0x0f));
      push7(out, ev.data.controller);
      push7(out, ev.data.value);
      break;
    case 'programChange':
      out.push(0xc0 | (ev.channel & 0x0f));
      push7(out, ev.data.program);
      break;
    case 'channelPressure':
      out.push(0xd0 | (ev.channel & 0x0f));
      push7(out, ev.data.value);
      break;
    case 'pitchBend': {
      const v = ev.data.value & 0x3fff;
      out.push(0xe0 | (ev.channel & 0x0f), v & 0x7f, v >> 7);
      break;
    }
    case 'tempo': {
      const t = ev.data.usPerQuarter & 0xffffff;
      out.push(0xff, 0x51, 3, (t >> 16) & 0xff, (t >> 8) & 0xff, t & 0xff);
      break;
    }
    case 'timeSignature': {
      const dd = Math.round(Math.log2(ev.data.denominator));
      out.push(0xff, 0x58, 4, ev.data.numerator & 0xff, dd & 0xff);
      out.push(ev.data.clocksPerClick & 0xff, ev.data.thirtySecondsPerQuarter & 0xff);
      break;
    }
    case 'trackName': {
      out.push(0xff, 0x03);
      for (const b of encodeVlq(ev.data.text.length)) out.push(b);
      for (let i = 0; i < ev.data.text.length; i++) out.push(ev.data.text.charCodeAt(i) & 0xff);
      break;
    }
    case 'endOfTrack':
      out.push(0xff, 0x2f, 0);
      break;
    case 'meta':
      out.push(0xff, ev.data.metaType & 0x7f);
      for (const b of encodeVlq(ev.data.bytes.length)) out.push(b);
      for (const b of ev.data.bytes) out.push(b);
      break;
    case 'sysex':
      out.push(0xf0);
      for (const b of encodeVlq(ev.data.bytes.length)) out.push(b);
      for (const b of ev.data.bytes) out.push(b);
      break;
  }
}

export function writeMidi(tracks: MidiFileEvent[][], ticksPerQuarter: number): ArrayBuffer {
  if (!Number.isInteger(ticksPerQuarter) || ticksPerQuarter < 1 || ticksPerQuarter > 0x7fff) {
    throw new Error(`midi: invalid ticks per quarter ${ticksPerQuarter}`);
  }
  if (tracks.length === 0) throw new Error('midi: no tracks');

  const format = tracks.length > 1 ? 1 : 0;
  const out: number[] = [];
  out.push(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6);
  out.push(0, format, (tracks.length >> 8) & 0xff, tracks.length & 0xff);
  out.push((ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff);

  for (const track of tracks) {
    // Stable sort by tick; equal ticks keep their given order.
    const sorted = track
      .map((ev, i) => ({ ev, i }))
      .sort((a, b) => a.ev.tick - b.ev.tick || a.i - b.i)
      .map((x) => x.ev);

    const body: number[] = [];
    let lastTick = 0;
    for (const ev of sorted) {
      for (const b of encodeVlq(ev.tick - lastTick)) body.push(b);
      lastTick = ev.tick;
      writeEvent(body, ev);
    }
    if (sorted.length === 0 || sorted[sorted.length - 1].type !== 'endOfTrack') {
      body.push(0, 0xff, 0x2f, 0);
    }

    out.push(0x4d, 0x54, 0x72, 0x6b);
    out.push((body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff);
    out.push((body.length >>> 8) & 0xff, body.length & 0xff);
    for (const b of body) out.push(b);
  }

  return new Uint8Array(out).buffer;
}

/* ------------------------------------------------------------------ */
/* Score flattening                                                    */
/* ------------------------------------------------------------------ */

export interface ScoreNote {
  midi: number;
  /** Normalized from MIDI velocity, 0..1. */
  velocity: number;
  startBeat: number;
  durBeats: number;
  channel: number;
  track: number;
}

/**
 * Flatten parsed tracks to notes in beats. The mapping is tempo
 * independent: one beat is one quarter note, beats = ticks / tpq.
 * Note ons left open at end of track close at the track's last tick.
 */
export function toScore(parsed: ParsedMidi): ScoreNote[] {
  const tpq = parsed.ticksPerQuarter;
  const notes: ScoreNote[] = [];

  for (let t = 0; t < parsed.tracks.length; t++) {
    const track = parsed.tracks[t];
    const open = new Map<number, { tick: number; velocity: number }[]>();
    let endTick = 0;

    for (const ev of track) {
      if (ev.tick > endTick) endTick = ev.tick;
      if (ev.type === 'noteOn' && ev.data.velocity > 0) {
        const key = ev.channel * 128 + ev.data.note;
        let stack = open.get(key);
        if (stack === undefined) {
          stack = [];
          open.set(key, stack);
        }
        stack.push({ tick: ev.tick, velocity: ev.data.velocity });
      } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.data.velocity === 0)) {
        const key = ev.channel * 128 + ev.data.note;
        const stack = open.get(key);
        const start = stack?.shift();
        if (start !== undefined) {
          notes.push({
            midi: ev.data.note,
            velocity: start.velocity / 127,
            startBeat: start.tick / tpq,
            durBeats: (ev.tick - start.tick) / tpq,
            channel: ev.channel,
            track: t,
          });
        }
      }
    }

    for (const [key, stack] of open) {
      for (const start of stack) {
        notes.push({
          midi: key % 128,
          velocity: start.velocity / 127,
          startBeat: start.tick / tpq,
          durBeats: (endTick - start.tick) / tpq,
          channel: (key / 128) | 0,
          track: t,
        });
      }
    }
  }

  notes.sort((a, b) => a.startBeat - b.startBeat || a.track - b.track || a.midi - b.midi);
  return notes;
}
