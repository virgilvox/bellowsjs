/* Shared logic for the 05_MidiInstrument example.
 *
 * A MIDI-driven instrument: raw bytes in, eight voices out. The two
 * halves are deliberately separate. bellows/io/midi_parse.h turns three
 * bytes into a MidiMessage and knows nothing about USB, serial, DIN, or
 * the Teensy libraries; the sketch feeds it bytes from wherever they came
 * from. That is what makes the parse testable on a host and identical on
 * every transport.
 *
 * Voice allocation is VoicePool's job. The MIDI note number doubles as
 * the note id, so NoteOff finds the voice holding that note with no map:
 * the pool scans its eight slots, which is cheaper than any structure
 * that would replace it and allocates nothing.
 *
 * Two MIDI details this handles because they bite everyone:
 *   A note-on with velocity 0 is a note-off. Parse already returns
 *   Kind::kNoteOff for it, so there is no special case here.
 *   Pitch bend is 14 bits across two 7-bit bytes, and its centre is 8192,
 *   not 8191 or 8193. MidiMessage::Bend() returns -1..1 already scaled.
 *
 * Bend is applied by retuning every sounding voice once per block, which
 * is the same rate a param ramp steps at in the TypeScript kernel and far
 * finer than a pitch wheel is played. */
#pragma once

#include "bellows/config.h"
#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/io/midi_parse.h"
#include "bellows/voicepool.h"

namespace midiinstrument {

inline constexpr int kPoly = 8;

class Instrument {
 public:
  void Init(float sample_rate) {
    rng_.Init("midiinstrument");

    bellows::Va::Params p;
    p.shape = 0.2f;
    p.detune = 6.0f;
    p.cutoff = 4200.0f;
    p.resonance = 0.3f;
    p.env_amount = 0.45f;      /* the filter envelope gives the note its bite */
    p.attack = 0.006f;
    p.decay = 0.18f;
    p.sustain = 0.65f;
    p.release = 0.28f;
    p.vel_level = 0.7f;        /* velocity to loudness */
    p.vel_filter = 0.4f;       /* and to brightness, which is what sells it */
    base_ = p;

    for (int i = 0; i < kPoly; ++i) {
      pool_.at(i).Init(sample_rate, &rng_, base_);
      note_of_[i] = -1;
    }
  }

  /* Feed one MIDI byte stream chunk. Anything that is not a channel
   * voice message is ignored, including running status and system
   * messages, which Parse rejects rather than guessing at. */
  void HandleBytes(const uint8_t* bytes, int len) {
    bellows::midi::MidiMessage m;
    if (!bellows::midi::Parse(bytes, len, &m)) return;
    HandleMessage(m);
  }

  void HandleMessage(const bellows::midi::MidiMessage& m) {
    switch (m.kind) {
      case bellows::midi::Kind::kNoteOn: {
        int note = m.data1;
        pool_.NoteOn(note, HzOf(note), m.Norm(), frame_);
        Remember(note);
        break;
      }
      case bellows::midi::Kind::kNoteOff:
        pool_.NoteOff(m.data1);
        Forget(m.data1);
        break;
      case bellows::midi::Kind::kPitchBend:
        /* Two semitones either way, the near-universal default range. */
        bend_ratio_ = bellows::fm::SemisRatio(m.Bend() * 2.0f);
        break;
      case bellows::midi::Kind::kControlChange:
        if (m.data1 == 74) {                 /* CC74 is the MPE brightness CC */
          base_.cutoff = 200.0f + m.Norm() * 9800.0f;
          dirty_ = true;
        } else if (m.data1 == 123) {         /* all notes off */
          AllNotesOff();
        }
        break;
      default:
        break;
    }
  }

  void AllNotesOff() {
    for (int i = 0; i < kPoly; ++i) {
      if (note_of_[i] >= 0) pool_.NoteOff(note_of_[i]);
      note_of_[i] = -1;
    }
  }

  int ActiveCount() { return pool_.ActiveCount(); }

  void operator()(float* l, float* r, int from, int to) {
    if (dirty_) {
      for (int i = 0; i < kPoly; ++i) pool_.at(i).SetParams(base_);
      dirty_ = false;
    }
    pool_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  float HzOf(int note) const {
    return bellows::midi::NoteToHz(note) * bend_ratio_;
  }

  /* Track which notes are sounding so an all-notes-off can release them
   * without a search over every possible note number. */
  void Remember(int note) {
    for (int i = 0; i < kPoly; ++i) {
      if (note_of_[i] < 0) { note_of_[i] = note; return; }
    }
  }
  void Forget(int note) {
    for (int i = 0; i < kPoly; ++i) {
      if (note_of_[i] == note) { note_of_[i] = -1; return; }
    }
  }

  bellows::Rng rng_;
  bellows::VoicePool<bellows::Va, kPoly> pool_;
  bellows::Va::Params base_;
  int note_of_[kPoly] = {};
  float bend_ratio_ = 1.0f;
  uint32_t frame_ = 0;
  bool dirty_ = false;
};

}  // namespace midiinstrument
