/*
 * Value parity for the modules that make no sound.
 *
 * A wrong euclidean pattern, scale table or chord interval is silent in
 * the sense that no audio test can hear it: the note that plays is
 * confident, plausible and wrong. This dumps the values as text so
 * tables.mjs can diff them against the TypeScript exactly, with no
 * tolerance, because integers have no excuse.
 */
#include <stdio.h>

#include "bellows/seq/euclid.h"
#include "bellows/seq/arp.h"
#include "bellows/seq/automata.h"
#include "bellows/seq/tempomap.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/chords.h"
#include "bellows/theory/notes.h"
#include "bellows/io/midi_parse.h"

int main() {
  /* Euclid across the whole useful space. */
  for (int steps = 1; steps <= 16; ++steps) {
    for (int pulses = 0; pulses <= steps; ++pulses) {
      bellows::Euclid<32> e;
      e.Init();
      if (!e.Generate(pulses, steps)) { printf("euclid %d %d REJECT\n", pulses, steps); continue; }
      printf("euclid %d %d ", pulses, steps);
      for (int i = 0; i < steps; ++i) printf("%d", e.At(i) ? 1 : 0);
      printf("\n");
    }
  }
  /* Euclid rotation. */
  for (int rot = -3; rot <= 3; ++rot) {
    bellows::Euclid<32> e;
    e.Init();
    e.Generate(3, 8, rot);
    printf("euclidrot %d ", rot);
    for (int i = 0; i < 8; ++i) printf("%d", e.At(i) ? 1 : 0);
    printf("\n");
  }
  /* Every scale table. */
  for (int t = 0; t < bellows::kScaleCount; ++t) {
    const uint8_t* st = bellows::ScaleSteps(static_cast<bellows::ScaleType>(t));
    const int n = bellows::ScaleLength(static_cast<bellows::ScaleType>(t));
    printf("scale %d %s ", t, bellows::kScaleNames[t]);
    for (int i = 0; i < n; ++i) printf("%d ", static_cast<int>(st[i]));
    printf("\n");
  }
  /* Every chord table. */
  for (int t = 0; t < bellows::kChordCount; ++t) {
    const int8_t* st = bellows::ChordTypeSteps(static_cast<bellows::ChordType>(t));
    const int n = bellows::ChordTypeLength(static_cast<bellows::ChordType>(t));
    printf("chord %d ", t);
    for (int i = 0; i < n; ++i) printf("%d ", static_cast<int>(st[i]));
    printf("\n");
  }
  /* Note parsing and naming round trip. */
  static const char* kNames[] = {"C4", "C#4", "Db-1", "g3", "A0", "B8", "Fx", "H4"};
  for (const char* n : kNames) printf("parsenote %s %d\n", n, bellows::ParseNote(n));
  for (int m = 0; m <= 127; m += 7) {
    char buf[8];
    bellows::NoteName(m, buf, sizeof(buf));
    printf("notename %d %s\n", m, buf);
  }
  /* Elementary CA, the classic rules. */
  static const uint8_t kRules[] = {30, 90, 110, 150};
  for (uint8_t rule : kRules) {
    bellows::ElementaryCa<32> ca;
    ca.Init(rule);
    for (int g = 0; g < 8; ++g) {
      printf("ca %d %d ", static_cast<int>(rule), g);
      for (int i = 0; i < ca.Width(); ++i) printf("%d", ca.Cell(i));
      printf("\n");
      ca.Step();
    }
  }
  /* Arp traversal for every mode. */
  static const float kNotes[] = {60.0f, 64.0f, 67.0f};
  const char* kModeName[] = {"up", "down", "updown", "downup", "random", "order"};
  for (int m = 0; m < 6; ++m) {
    if (m == 4) continue; /* random draws from an rng, compared separately */
    bellows::Arp<16> a;
    bellows::Arp<16>::Params p;
    p.mode = static_cast<bellows::ArpMode>(m);
    p.octaves = 2;
    a.Init(p);
    a.SetNotes(kNotes, 3);
    printf("arp %s ", kModeName[m]);
    for (int i = 0; i < 12; ++i) printf("%d ", static_cast<int>(a.Next()));
    printf("\n");
  }
  /* Tempo map: the closed form beat/second conversion, including a ramp. */
  {
    bellows::TempoMap<8> tm;
    tm.Init(120);
    tm.RampTo(8, 180);
    for (int b = 0; b <= 16; ++b) {
      printf("tempo %d %.9f %.9f\n", b, static_cast<double>(tm.BeatToSeconds(b)),
             static_cast<double>(tm.BpmAt(b)));
    }
    for (int i = 0; i <= 8; ++i) {
      const double t = i * 0.75;
      printf("tempoinv %.3f %.9f\n", t, static_cast<double>(tm.SecondsToBeat(t)));
    }
  }
  /* MIDI parsing. */
  {
    const uint8_t msgs[][3] = {
        {0x90, 60, 100}, {0x90, 60, 0}, {0x80, 60, 64}, {0xB0, 7, 100},
        {0xC0, 5, 0},    {0xD0, 90, 0}, {0xE0, 0, 64},  {0xE0, 127, 127},
        {0xA0, 60, 50},  {0xF8, 0, 0},
    };
    for (const auto& m : msgs) {
      bellows::midi::MidiMessage out;
      const bool ok = bellows::midi::Parse(m, 3, &out);
      /* For pitch bend the meaningful value is the assembled 14 bit word,
       * not the raw second byte, so compare that. */
      const int d2 = !ok ? -1
                     : (out.kind == bellows::midi::Kind::kPitchBend
                            ? static_cast<int>(out.bend14)
                            : static_cast<int>(out.data2));
      printf("midi %02x %d %d -> %d kind=%d ch=%d d1=%d d2=%d\n", m[0], m[1], m[2], ok ? 1 : 0,
             ok ? static_cast<int>(out.kind) : -1, ok ? out.channel : -1,
             ok ? out.data1 : -1, d2);
    }
  }
  return 0;
}
