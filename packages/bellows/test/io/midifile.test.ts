import { describe, expect, it } from 'vitest';
import {
  decodeVlq,
  encodeVlq,
  parseMidi,
  toScore,
  writeMidi,
  type MidiFileEvent,
} from '../../src/io/midifile';

describe('variable-length quantities', () => {
  const fixtures: [number, number[]][] = [
    [0x00, [0x00]],
    [0x40, [0x40]],
    [0x7f, [0x7f]],
    [0x80, [0x81, 0x00]],
    [0x2000, [0xc0, 0x00]],
    [0x3fff, [0xff, 0x7f]],
    [0x4000, [0x81, 0x80, 0x00]],
    [0x1fffff, [0xff, 0xff, 0x7f]],
    [0x200000, [0x81, 0x80, 0x80, 0x00]],
    [0x0fffffff, [0xff, 0xff, 0xff, 0x7f]],
  ];

  it('encodes the spec fixtures', () => {
    for (const [value, bytes] of fixtures) {
      expect(Array.from(encodeVlq(value)), `value 0x${value.toString(16)}`).toEqual(bytes);
    }
  });

  it('decodes the spec fixtures', () => {
    for (const [value, bytes] of fixtures) {
      const r = decodeVlq(new Uint8Array(bytes), 0);
      expect(r.value).toBe(value);
      expect(r.next).toBe(bytes.length);
    }
  });

  it('rejects out-of-range and truncated input', () => {
    expect(() => encodeVlq(-1)).toThrow();
    expect(() => encodeVlq(0x10000000)).toThrow();
    expect(() => encodeVlq(1.5)).toThrow();
    expect(() => decodeVlq(new Uint8Array([0x81]), 0)).toThrow();
    expect(() => decodeVlq(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x7f]), 0)).toThrow();
  });
});

/* A hand-built format 0 file at 480 tpq using running status. */
function fixtureSmf(): ArrayBuffer {
  const track = [
    // delta 0, track name "lead"
    0x00, 0xff, 0x03, 0x04, 0x6c, 0x65, 0x61, 0x64,
    // delta 0, tempo 500000 us per quarter
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    // delta 0, time signature 3/8
    0x00, 0xff, 0x58, 0x04, 0x03, 0x03, 0x0c, 0x08,
    // delta 0, note on ch0 note 60 vel 100
    0x00, 0x90, 0x3c, 0x64,
    // delta 96, running status: note on note 62 vel 80
    0x60, 0x3e, 0x50,
    // delta 96, running status: note 60 vel 0 (note off)
    0x60, 0x3c, 0x00,
    // delta 0, running status: note 62 vel 0
    0x00, 0x3e, 0x00,
    // delta 0, pitch bend center on ch0
    0x00, 0xe0, 0x00, 0x40,
    // delta 480, end of track
    0x83, 0x60, 0xff, 0x2f, 0x00,
  ];
  const bytes = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff,
    (track.length >>> 8) & 0xff, track.length & 0xff,
    ...track,
  ];
  return new Uint8Array(bytes).buffer;
}

describe('parseMidi', () => {
  it('parses the hand-built fixture with running status', () => {
    const parsed = parseMidi(fixtureSmf());
    expect(parsed.format).toBe(0);
    expect(parsed.ticksPerQuarter).toBe(480);
    expect(parsed.tracks).toHaveLength(1);

    const ev = parsed.tracks[0];
    expect(ev[0]).toEqual({ tick: 0, type: 'trackName', data: { text: 'lead' } });
    expect(ev[1]).toEqual({ tick: 0, type: 'tempo', data: { usPerQuarter: 500000 } });
    expect(ev[2]).toEqual({
      tick: 0,
      type: 'timeSignature',
      data: { numerator: 3, denominator: 8, clocksPerClick: 12, thirtySecondsPerQuarter: 8 },
    });
    expect(ev[3]).toEqual({ tick: 0, type: 'noteOn', channel: 0, data: { note: 60, velocity: 100 } });
    expect(ev[4]).toEqual({ tick: 96, type: 'noteOn', channel: 0, data: { note: 62, velocity: 80 } });
    expect(ev[5]).toEqual({ tick: 192, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } });
    expect(ev[6]).toEqual({ tick: 192, type: 'noteOff', channel: 0, data: { note: 62, velocity: 0 } });
    expect(ev[7]).toEqual({ tick: 192, type: 'pitchBend', channel: 0, data: { value: 8192 } });
    expect(ev[8]).toEqual({ tick: 672, type: 'endOfTrack', data: {} });
  });

  it('keeps velocity-zero note ons when normalization is off', () => {
    const parsed = parseMidi(fixtureSmf(), { velocityZeroIsNoteOff: false });
    expect(parsed.tracks[0][5]).toEqual({
      tick: 192,
      type: 'noteOn',
      channel: 0,
      data: { note: 60, velocity: 0 },
    });
  });

  it('rejects garbage, SMPTE division, and truncated files', () => {
    expect(() => parseMidi(new ArrayBuffer(4))).toThrow();
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(/MThd/);

    const smpte = new Uint8Array(fixtureSmf());
    smpte[12] = 0xe8; // -24 fps
    smpte[13] = 40;
    expect(() => parseMidi(smpte.buffer)).toThrow(/SMPTE/);

    const truncated = new Uint8Array(fixtureSmf()).slice(0, 30);
    expect(() => parseMidi(truncated.buffer)).toThrow();
  });

  it('rejects channel messages with data bytes at or above 0x80', () => {
    const smfWithTrack = (track: number[]): ArrayBuffer => {
      const bytes = [
        0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
        0x4d, 0x54, 0x72, 0x6b,
        (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff,
        (track.length >>> 8) & 0xff, track.length & 0xff,
        ...track,
      ];
      return new Uint8Array(bytes).buffer;
    };
    const eot = [0x00, 0xff, 0x2f, 0x00];

    // note number 0x85
    expect(() => parseMidi(smfWithTrack([0x00, 0x90, 0x85, 0x64, ...eot]))).toThrow(/data byte/);
    // note-on velocity 0x80
    expect(() => parseMidi(smfWithTrack([0x00, 0x90, 0x3c, 0x80, ...eot]))).toThrow(/data byte/);
    // note-off velocity 0xff
    expect(() => parseMidi(smfWithTrack([0x00, 0x80, 0x3c, 0xff, ...eot]))).toThrow(/data byte/);
    // control change value 0x90
    expect(() => parseMidi(smfWithTrack([0x00, 0xb0, 0x07, 0x90, ...eot]))).toThrow(/data byte/);
    // pitch bend MSB 0xc0
    expect(() => parseMidi(smfWithTrack([0x00, 0xe0, 0x00, 0xc0, ...eot]))).toThrow(/data byte/);

    // the highest legal data byte still parses
    const ok = parseMidi(smfWithTrack([0x00, 0x90, 0x7f, 0x7f, ...eot]));
    expect(ok.tracks[0][0]).toEqual({
      tick: 0,
      type: 'noteOn',
      channel: 0,
      data: { note: 127, velocity: 127 },
    });
  });

  it('skips alien chunks between header and tracks', () => {
    const orig = new Uint8Array(fixtureSmf());
    const alien = [0x58, 0x46, 0x49, 0x48, 0, 0, 0, 2, 0xaa, 0xbb]; // 'XFIH' + 2 bytes
    const spliced = new Uint8Array(orig.length + alien.length);
    spliced.set(orig.subarray(0, 14), 0);
    spliced.set(alien, 14);
    spliced.set(orig.subarray(14), 14 + alien.length);
    const parsed = parseMidi(spliced.buffer);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0][3].type).toBe('noteOn');
  });
});

describe('writeMidi roundtrip', () => {
  it('survives write then parse with every event type', () => {
    const track: MidiFileEvent[] = [
      { tick: 0, type: 'trackName', data: { text: 'rt' } },
      { tick: 0, type: 'tempo', data: { usPerQuarter: 375000 } },
      {
        tick: 0,
        type: 'timeSignature',
        data: { numerator: 7, denominator: 8, clocksPerClick: 24, thirtySecondsPerQuarter: 8 },
      },
      { tick: 0, type: 'programChange', channel: 3, data: { program: 42 } },
      { tick: 10, type: 'noteOn', channel: 3, data: { note: 64, velocity: 90 } },
      { tick: 20, type: 'keyPressure', channel: 3, data: { note: 64, value: 33 } },
      { tick: 30, type: 'controlChange', channel: 3, data: { controller: 74, value: 100 } },
      { tick: 40, type: 'channelPressure', channel: 3, data: { value: 77 } },
      { tick: 50, type: 'pitchBend', channel: 3, data: { value: 12288 } },
      { tick: 200, type: 'noteOff', channel: 3, data: { note: 64, velocity: 0 } },
      { tick: 300, type: 'meta', data: { metaType: 0x7f, bytes: new Uint8Array([1, 2, 3]) } },
      { tick: 300, type: 'sysex', data: { bytes: new Uint8Array([0x7e, 0x7f, 0x09, 0x01, 0xf7]) } },
      { tick: 960, type: 'endOfTrack', data: {} },
    ];

    const parsed = parseMidi(writeMidi([track], 480));
    expect(parsed.format).toBe(0);
    expect(parsed.ticksPerQuarter).toBe(480);
    expect(parsed.tracks[0]).toEqual(track);
  });

  it('writes format 1 for multiple tracks and appends end of track', () => {
    const t0: MidiFileEvent[] = [{ tick: 0, type: 'tempo', data: { usPerQuarter: 500000 } }];
    const t1: MidiFileEvent[] = [
      { tick: 0, type: 'noteOn', channel: 0, data: { note: 60, velocity: 64 } },
      { tick: 480, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } },
    ];
    const parsed = parseMidi(writeMidi([t0, t1], 96));
    expect(parsed.format).toBe(1);
    expect(parsed.tracks).toHaveLength(2);
    const last0 = parsed.tracks[0][parsed.tracks[0].length - 1];
    const last1 = parsed.tracks[1][parsed.tracks[1].length - 1];
    expect(last0.type).toBe('endOfTrack');
    expect(last1.type).toBe('endOfTrack');
    expect(last1.tick).toBe(480);
  });

  it('sorts unordered events by tick before writing', () => {
    const track: MidiFileEvent[] = [
      { tick: 480, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } },
      { tick: 0, type: 'noteOn', channel: 0, data: { note: 60, velocity: 100 } },
    ];
    const parsed = parseMidi(writeMidi([track], 480));
    expect(parsed.tracks[0][0].type).toBe('noteOn');
    expect(parsed.tracks[0][1].tick).toBe(480);
  });

  it('rejects invalid ticks per quarter and empty track lists', () => {
    expect(() => writeMidi([[]], 0)).toThrow();
    expect(() => writeMidi([[]], 0x8000)).toThrow();
    expect(() => writeMidi([], 480)).toThrow();
  });

  it('encodes large deltas with multi-byte VLQs', () => {
    const track: MidiFileEvent[] = [
      { tick: 0x4000, type: 'noteOn', channel: 0, data: { note: 60, velocity: 1 } },
      { tick: 0x4000 + 0x3fff, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } },
    ];
    const parsed = parseMidi(writeMidi([track], 480));
    expect(parsed.tracks[0][0].tick).toBe(0x4000);
    expect(parsed.tracks[0][1].tick).toBe(0x4000 + 0x3fff);
  });
});

describe('toScore', () => {
  it('flattens the fixture to beats at ticks / tpq', () => {
    const notes = toScore(parseMidi(fixtureSmf()));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual({
      midi: 60,
      velocity: 100 / 127,
      startBeat: 0,
      durBeats: 192 / 480,
      channel: 0,
      track: 0,
    });
    expect(notes[1]).toEqual({
      midi: 62,
      velocity: 80 / 127,
      startBeat: 96 / 480,
      durBeats: 96 / 480,
      channel: 0,
      track: 0,
    });
  });

  it('is tempo independent', () => {
    const withTempo = parseMidi(fixtureSmf());
    const noTempo: typeof withTempo = {
      ...withTempo,
      tracks: [withTempo.tracks[0].filter((e) => e.type !== 'tempo')],
    };
    expect(toScore(noTempo)).toEqual(toScore(withTempo));
  });

  it('closes unmatched note ons at the end of the track', () => {
    const track: MidiFileEvent[] = [
      { tick: 0, type: 'noteOn', channel: 2, data: { note: 48, velocity: 127 } },
      { tick: 960, type: 'endOfTrack', data: {} },
    ];
    const notes = toScore(parseMidi(writeMidi([track], 480)));
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(48);
    expect(notes[0].channel).toBe(2);
    expect(notes[0].velocity).toBe(1);
    expect(notes[0].durBeats).toBe(2);
  });

  it('pairs overlapping same-pitch notes first-on first-off', () => {
    const track: MidiFileEvent[] = [
      { tick: 0, type: 'noteOn', channel: 0, data: { note: 60, velocity: 100 } },
      { tick: 240, type: 'noteOn', channel: 0, data: { note: 60, velocity: 50 } },
      { tick: 480, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } },
      { tick: 960, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } },
    ];
    const notes = toScore(parseMidi(writeMidi([track], 480)));
    expect(notes).toHaveLength(2);
    expect(notes[0].startBeat).toBe(0);
    expect(notes[0].durBeats).toBe(1);
    expect(notes[1].startBeat).toBe(0.5);
    expect(notes[1].durBeats).toBe(1.5);
  });

  it('keeps channels distinct and reports track indices', () => {
    const t0: MidiFileEvent[] = [
      { tick: 0, type: 'noteOn', channel: 0, data: { note: 60, velocity: 64 } },
      { tick: 480, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } },
    ];
    const t1: MidiFileEvent[] = [
      { tick: 0, type: 'noteOn', channel: 9, data: { note: 60, velocity: 64 } },
      { tick: 240, type: 'noteOff', channel: 9, data: { note: 60, velocity: 0 } },
    ];
    const notes = toScore(parseMidi(writeMidi([t0, t1], 480)));
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.track).sort()).toEqual([0, 1]);
    const drum = notes.find((n) => n.channel === 9);
    expect(drum?.durBeats).toBe(0.5);
  });
});
