/* Transcription of src/core/voicepool.ts. Polyphony is a template
 * parameter: the pool is a plain array, no allocation, and the steal
 * order is the JS order (free, then oldest released, then oldest held). */
#pragma once
#include <stdint.h>

namespace bellows {

template <class V, int kPoly>
class VoicePool {
 public:
  static constexpr int kPolyphony = kPoly;

  V& at(int i) { return slots_[i].voice; }

  /* The note id a slot took, or -1 if it never took one. Paired with
   * at(i).Active() this is how a caller reaches the voices that are
   * actually sounding: the pool picks the slot by the steal order, so the
   * caller cannot derive which slot holds which note from the order the
   * note ons arrived in. */
  int NoteIdAt(int i) const { return slots_[i].note_id; }

  void NoteOn(int note_id, float freq, float vel, uint32_t frame) {
    Slot* pick = nullptr;
    for (auto& s : slots_) if (!s.voice.Active()) { pick = &s; break; }
    if (!pick) for (auto& s : slots_) if (!s.held && (!pick || s.start < pick->start)) pick = &s;
    if (!pick) for (auto& s : slots_) if (!pick || s.start < pick->start) pick = &s;
    if (!pick) return;
    pick->note_id = note_id;
    pick->start = frame;
    pick->held = true;
    pick->voice.NoteOn(freq, vel);
  }

  void NoteOff(int note_id) {
    for (auto& s : slots_) if (s.held && s.note_id == note_id) { s.held = false; s.voice.NoteOff(); }
  }

  void Process(float* l, float* r, int from, int to) {
    for (auto& s : slots_) if (s.voice.Active()) s.voice.Process(l, r, from, to);
  }

  int ActiveCount() const {
    int n = 0;
    for (auto& s : slots_) if (s.voice.Active()) ++n;
    return n;
  }

 private:
  struct Slot { V voice; int note_id = -1; uint32_t start = 0; bool held = false; };
  Slot slots_[kPoly];
};

}  // namespace bellows
