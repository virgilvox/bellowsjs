/*
 * Transcription of parseMidiMessage from src/io/webmidi.ts, and only
 * that. The Web MIDI binding around it (navigator.requestMIDIAccess,
 * port lookup, callback lists) has no meaning on a board where the USB
 * stack hands you three bytes and a length, so none of it came across.
 * MPE is omitted for now: MpeZone keeps a per-channel note map and a
 * callback list, which needs a design of its own here.
 *
 * The parse itself is byte for byte the JS behaviour, including the two
 * details that bite people: note-on with velocity zero is a note-off,
 * and anything from 0xf0 up (clock, sysex, transport) is not a channel
 * voice message and returns false rather than a garbage note.
 *
 * A full USB MIDI input on a Teensy:
 *
 *   #include "bellows/io/midi_parse.h"
 *   ...
 *   uint8_t b[3] = { usbMIDI.getType() | usbMIDI.getChannel() - 1,
 *                    usbMIDI.getData1(), usbMIDI.getData2() };
 *   bellows::midi::MidiMessage m;
 *   if (bellows::midi::Parse(b, 3, &m) && m.kind == bellows::midi::Kind::kNoteOn)
 *     kernel.PushNoteOn(kernel.CurrentFrame(), m.data1,
 *                       bellows::midi::NoteToHz(m.data1), m.Norm());
 */
#pragma once
#include <stdint.h>

#include "bellows/core/fastmath.h"

namespace bellows {
namespace midi {

enum class Kind : uint8_t {
  kNone = 0,
  kNoteOn,
  kNoteOff,
  kKeyPressure,
  kControlChange,
  kProgramChange,
  kChannelPressure,
  kPitchBend,
};

/*
 * One parsed channel voice message. 8 bytes, plain fields, no union: the
 * two data bytes mean different things per kind and naming them data1 and
 * data2 is less confusing than a union whose active member you have to
 * infer. Read them as:
 *
 *   kNoteOn, kNoteOff    data1 note,       data2 velocity
 *   kKeyPressure         data1 note,       data2 pressure
 *   kControlChange       data1 controller, data2 value
 *   kProgramChange       data1 program
 *   kChannelPressure     data2 pressure
 *   kPitchBend           bend14, raw 0..16383, centre 8192
 */
struct MidiMessage {
  Kind kind;
  uint8_t channel;
  uint8_t data1;
  uint8_t data2;
  uint16_t bend14;

  /* data2 as 0..1, the form every engine parameter wants. */
  float Norm() const { return static_cast<float>(data2) * (1.0f / 127.0f); }

  /* Pitch bend as [-1, 1), 0 at the centre, matching the JS `bend`. */
  float Bend() const { return (static_cast<float>(bend14) - 8192.0f) * (1.0f / 8192.0f); }
};

/*
 * Parse one channel voice message. Returns false for system messages,
 * running status (no status byte), and truncated input, leaving *out
 * untouched. Never reads past len.
 *
 * The comment is honoured rather than corrected: the JS returns null and
 * writes nothing, so "false means the struct did not move" is the same
 * contract on both sides, and it is the one a caller can check cheaply.
 * The earlier form filled channel, data1, data2 and bend14 before the
 * switch, so a truncated message left *out half written with a stale
 * kind: a caller that inspected the struct after a false return read a
 * plausible note on the wrong channel. Everything is assembled in locals
 * now and committed in one place, which costs three registers and no
 * branches: measured by ./tools/size-report.sh, p8_e5_midiinstrument
 * went from 30344 to 30336 bytes of flash.
 */
inline bool Parse(const uint8_t* bytes, int len, MidiMessage* out) {
  if (bytes == nullptr || out == nullptr || len < 1) return false;
  const uint8_t status = bytes[0];
  if (status < 0x80 || status >= 0xf0) return false;
  const uint8_t kind = static_cast<uint8_t>(status & 0xf0);

  const uint8_t channel = static_cast<uint8_t>(status & 0x0f);
  const uint8_t data1 = len > 1 ? static_cast<uint8_t>(bytes[1] & 0x7f) : 0;
  uint8_t data2 = len > 2 ? static_cast<uint8_t>(bytes[2] & 0x7f) : 0;
  uint16_t bend14 = 8192;
  Kind parsed;

  switch (kind) {
    case 0x90:
      if (len < 3) return false;
      /* Velocity zero is a note-off. Most controllers send it that way,
       * so a parser that misses this leaves notes hanging. */
      parsed = data2 == 0 ? Kind::kNoteOff : Kind::kNoteOn;
      break;
    case 0x80:
      if (len < 3) return false;
      parsed = Kind::kNoteOff;
      break;
    case 0xa0:
      if (len < 3) return false;
      parsed = Kind::kKeyPressure;
      break;
    case 0xb0:
      if (len < 3) return false;
      parsed = Kind::kControlChange;
      break;
    case 0xc0:
      if (len < 2) return false;
      parsed = Kind::kProgramChange;
      break;
    case 0xd0:
      if (len < 2) return false;
      /* Channel pressure carries its value in the first data byte; the
       * JS reports it as `value`, mirrored into data2 here so callers
       * read pressure off one field whatever the message. */
      data2 = data1;
      parsed = Kind::kChannelPressure;
      break;
    case 0xe0:
      if (len < 3) return false;
      bend14 = static_cast<uint16_t>(data1 | (data2 << 7));
      parsed = Kind::kPitchBend;
      break;
    default:
      return false;
  }

  out->kind = parsed;
  out->channel = channel;
  out->data1 = data1;
  out->data2 = data2;
  out->bend14 = bend14;
  return true;
}

/*
 * Equal-tempered note number to hertz, A4 at note 69. Here rather than in
 * the theory layer because a MIDI sketch needs it in the same breath as
 * the parse, and this is the 12-EDO default, not an assumption: a sketch
 * with its own tuning ignores it and maps the note number itself.
 */
inline float NoteToHz(int note, float a4 = 440.0f) {
  return a4 * fm::Exp2(static_cast<float>(note - 69) * (1.0f / 12.0f));
}

}  // namespace midi
}  // namespace bellows
