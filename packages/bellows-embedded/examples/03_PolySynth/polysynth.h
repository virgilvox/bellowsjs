/* Shared logic for the 03_PolySynth example.
 *
 * Eight virtual-analog voices in a VoicePool with an LFO sweeping the
 * filter cutoff. VoicePool is a plain array of Va with the steal order
 * from src/core/voicepool.ts: a free voice first, then the oldest
 * released one, then the oldest held one. Nothing allocates, and note
 * identity is an int the caller chooses, so NoteOff finds its voice
 * without a search structure.
 *
 * The sweep is applied per block rather than per sample, which is the
 * same rate the TypeScript kernel steps a param ramp at. Filter cutoff is
 * a control signal; recomputing it 375 times a second at 128 frames is
 * far above anything audible in the movement and costs one SetParams per
 * voice per block instead of one per sample.
 *
 * Va is the expensive engine in this library (about 28.5 KB) because its
 * oscillators are band-limited and pull in the BLEP residual tables. That
 * is a fixed cost paid once, not per voice: eight voices cost eight times
 * the RAM but the same flash as one. */
#pragma once

#include "bellows/config.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/lfo.h"
#include "bellows/engines/va.h"
#include "bellows/voicepool.h"

namespace polysynth {

inline constexpr int kPoly = 8;

class Synth {
 public:
  void Init(float sample_rate) {
    rng_.Init("polysynth");

    /* Defaults match va.ts, so this is the browser patch until changed. */
    bellows::Va::Params p;
    p.shape = 0.35f;        /* between saw and square */
    p.detune = 9.0f;        /* cents between the two oscillators */
    p.sub = 0.25f;
    p.resonance = 0.55f;    /* enough to hear the sweep sing */
    p.env_amount = 0.0f;    /* the LFO drives cutoff here, not the envelope */
    p.attack = 0.01f;
    p.decay = 0.25f;
    p.sustain = 0.7f;
    p.release = 0.35f;
    base_ = p;

    for (int i = 0; i < kPoly; ++i) pool_.at(i).Init(sample_rate, &rng_, base_);

    /* A slow triangle so the sweep moves in both directions evenly. */
    sweep_.Init(sample_rate, &rng_);
    sweep_.SetShape(bellows::LfoShape::kTriangle);
    sweep_.SetFreq(0.12f);
  }

  void NoteOn(int note_id, float hz, float vel) { pool_.NoteOn(note_id, hz, vel, frame_); }
  void NoteOff(int note_id) { pool_.NoteOff(note_id); }

  int ActiveCount() { return pool_.ActiveCount(); }

  void operator()(float* l, float* r, int from, int to) {
    /* One LFO sample per block drives the whole sweep. */
    float lfo = sweep_.Process();                 /* -1 .. 1 */
    float norm = 0.5f * (lfo + 1.0f);             /*  0 .. 1 */

    /* Sweep exponentially, because pitch and filter cutoff are both
     * perceived in octaves: 200 Hz to 200 * 2^5.5 which is about 9 kHz. */
    float cutoff = 200.0f * bellows::fm::Exp2(norm * 5.5f);

    bellows::Va::Params p = base_;
    p.cutoff = bellows::Clamp(cutoff, 40.0f, 16000.0f);
    for (int i = 0; i < kPoly; ++i) pool_.at(i).SetParams(p);

    pool_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  bellows::Rng rng_;
  bellows::VoicePool<bellows::Va, kPoly> pool_;
  bellows::Lfo sweep_;
  bellows::Va::Params base_;
  uint32_t frame_ = 0;
};

}  // namespace polysynth
