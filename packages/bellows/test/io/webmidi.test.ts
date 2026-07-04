import { describe, expect, it } from 'vitest';
import {
  MidiInput,
  MidiOutput,
  MpeZone,
  parseMidiMessage,
  type MpeNote,
} from '../../src/io/webmidi';

describe('parseMidiMessage', () => {
  it('parses note on and note off', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({
      type: 'noteOn',
      channel: 0,
      note: 60,
      velocity: 100,
    });
    expect(parseMidiMessage([0x83, 60, 40])).toEqual({
      type: 'noteOff',
      channel: 3,
      note: 60,
      velocity: 40,
    });
  });

  it('normalizes note on velocity zero to note off', () => {
    expect(parseMidiMessage([0x95, 72, 0])).toEqual({
      type: 'noteOff',
      channel: 5,
      note: 72,
      velocity: 0,
    });
  });

  it('parses control change, program change, and pressures', () => {
    expect(parseMidiMessage([0xb2, 74, 90])).toEqual({
      type: 'controlChange',
      channel: 2,
      controller: 74,
      value: 90,
    });
    expect(parseMidiMessage([0xc1, 12])).toEqual({ type: 'programChange', channel: 1, program: 12 });
    expect(parseMidiMessage([0xd7, 66])).toEqual({ type: 'channelPressure', channel: 7, value: 66 });
    expect(parseMidiMessage([0xa0, 60, 44])).toEqual({
      type: 'keyPressure',
      channel: 0,
      note: 60,
      value: 44,
    });
  });

  it('decodes 14-bit pitch bend with center 8192', () => {
    const center = parseMidiMessage([0xe0, 0x00, 0x40]);
    expect(center).toEqual({ type: 'pitchBend', channel: 0, value: 8192, bend: 0 });

    const min = parseMidiMessage([0xe4, 0x00, 0x00]);
    expect(min).toEqual({ type: 'pitchBend', channel: 4, value: 0, bend: -1 });

    const max = parseMidiMessage([0xef, 0x7f, 0x7f]);
    expect(max?.type).toBe('pitchBend');
    if (max?.type === 'pitchBend') {
      expect(max.value).toBe(16383);
      expect(max.bend).toBeCloseTo(8191 / 8192, 10);
    }

    const up = parseMidiMessage([0xe0, 0x00, 0x60]); // 12288
    if (up?.type === 'pitchBend') expect(up.bend).toBeCloseTo(0.5, 10);
  });

  it('returns null for system messages, data bytes, and truncation', () => {
    expect(parseMidiMessage([])).toBeNull();
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage([0xf0, 0x7e, 0xf7])).toBeNull(); // sysex
    expect(parseMidiMessage([0x40, 0x40])).toBeNull(); // running status not supported here
    expect(parseMidiMessage([0x90, 60])).toBeNull();
    expect(parseMidiMessage([0xe0, 0x00])).toBeNull();
  });
});

describe('MpeZone', () => {
  it('groups a running MPE stream into per-note objects', () => {
    const zone = new MpeZone(); // lower zone, master 0, bend range 48
    const started: MpeNote[] = [];
    const ended: MpeNote[] = [];
    let changes = 0;
    zone.onNoteStart((n) => started.push(n));
    zone.onNoteEnd((n) => ended.push(n));
    zone.onNoteChange(() => changes++);

    zone.feed([0x91, 60, 100]); // note on ch1
    zone.feed([0x92, 64, 80]); // note on ch2
    expect(zone.notes).toHaveLength(2);
    expect(started).toHaveLength(2);
    expect(started[0].note).toBe(60);
    expect(started[0].channel).toBe(1);
    expect(started[0].velocity).toBeCloseTo(100 / 127, 10);
    expect(started[0].bend).toBe(0);
    expect(started[0].timbre).toBe(0.5);

    // Per-note bend on ch1: +25% of 48 semitones = 12.
    zone.feed([0xe1, 0x00, 0x50]); // 10240 -> +0.25
    expect(started[0].bend).toBeCloseTo(12, 10);
    expect(started[1].bend).toBe(0);

    // Per-note pressure and timbre on ch2 only.
    zone.feed([0xd2, 127]);
    zone.feed([0xb2, 74, 0]);
    expect(started[1].pressure).toBe(1);
    expect(started[1].timbre).toBe(0);
    expect(started[0].pressure).toBe(0);
    expect(started[0].timbre).toBe(0.5);

    expect(changes).toBeGreaterThanOrEqual(3);

    zone.feed([0x81, 60, 0]); // note off ch1
    expect(ended).toHaveLength(1);
    expect(ended[0].note).toBe(60);
    expect(ended[0].active).toBe(false);
    expect(zone.notes).toHaveLength(1);
    expect(zone.notes[0].note).toBe(64);
  });

  it('applies master channel bend to every sounding note', () => {
    const zone = new MpeZone({ masterBendRange: 2 });
    zone.feed([0x91, 60, 100]);
    zone.feed([0x92, 67, 100]);
    zone.feed([0xe1, 0x00, 0x60]); // per-note +0.5 * 48 = 24 on ch1

    zone.feed([0xe0, 0x00, 0x60]); // master +0.5 * 2 = 1 semitone
    const byNote = new Map(zone.notes.map((n) => [n.note, n]));
    expect(byNote.get(60)?.bend).toBeCloseTo(25, 10);
    expect(byNote.get(67)?.bend).toBeCloseTo(1, 10);
  });

  it('uses the bend sent just before note on as the starting bend', () => {
    const zone = new MpeZone();
    zone.feed([0xe3, 0x00, 0x50]); // ch3 bend +0.25 before the note
    zone.feed([0x93, 55, 64]);
    expect(zone.notes[0].bend).toBeCloseTo(12, 10);
  });

  it('supports an upper zone with master channel 15', () => {
    const zone = new MpeZone({ masterChannel: 15, memberChannels: 3 });
    zone.feed([0x9e, 60, 100]); // ch14, member
    zone.feed([0x9b, 62, 100]); // ch11, outside the 3 member channels
    expect(zone.notes).toHaveLength(1);
    expect(zone.notes[0].channel).toBe(14);
  });

  it('ignores messages outside the zone and unrelated note offs', () => {
    const zone = new MpeZone({ memberChannels: 2 }); // members 1 and 2
    zone.feed([0x93, 60, 100]); // ch3, not a member
    expect(zone.notes).toHaveLength(0);
    zone.feed([0x91, 60, 100]);
    zone.feed([0x81, 61, 0]); // note off for a different pitch
    expect(zone.notes).toHaveLength(1);
  });
});

describe('device classes in Node', () => {
  it('MidiInput constructor throws a clear error without Web MIDI', () => {
    expect(() => new MidiInput()).toThrow(/Web MIDI/);
  });

  it('MidiOutput constructor throws a clear error without Web MIDI', () => {
    expect(() => new MidiOutput('anything')).toThrow(/Web MIDI/);
  });

  it('list() rejects without Web MIDI', async () => {
    await expect(MidiInput.list()).rejects.toThrow(/Web MIDI/);
    await expect(MidiOutput.list()).rejects.toThrow(/Web MIDI/);
  });
});
