/* Shared logic for the 00_BringUp example.
 *
 * This is the header the first flash-and-listen session runs. Every other
 * example in this folder demonstrates one idea; this one demonstrates
 * nothing and measures everything, because until a board has made a sound
 * the whole library is an untested assumption. It walks a fixed sequence of
 * stages, each one chosen so that a specific class of failure has an
 * unmistakable sound, and it holds each stage steady long enough for the
 * Teensy Audio Library's own load counters to settle.
 *
 * There is no Arduino code in here. The stages, the voices and the stage
 * machine are plain C++ over the library; the .ino owns Serial, millis()
 * and the AudioProcessorUsage counters. That split is the same one every
 * example uses, and here it also means the timing of the audio never
 * depends on how fast the USB host is draining the serial buffer.
 *
 * THE STAGE THAT MATTERS
 *
 * kPolyLow and kPolyHigh play the same eight notes six octaves apart, with
 * identical parameters, identical voice count and identical master gain.
 * The only variable is pitch. SumBlep walks the edges within
 * kBlepKernelHalf * dt of the current phase, and the average count of those
 * per sample is exactly 2 * kBlepKernelHalf * dt: 0.32 at A440, 5.1 at
 * 7040 Hz. That is the durable statement of the cost. The host measured the
 * same class through two benchmark harnesses and got 22.6 and 59.8 ns per
 * sample at 7040 Hz, so ns figures from a microbenchmark are not worth
 * carrying onto a board; a ratio measured on the device is.
 *
 * The 14x in docs/AUDIT.md is 55 Hz against 7040 Hz, and 55 Hz is an
 * unusually cheap reference. Measured against A440 in one process the bare
 * oscillator is about 3.7x at 7040 Hz and peaks at 9.0x at the dt clamp.
 *
 * Expect the measured ratio here to be smaller again. These are whole Va
 * voices: two BLEP oscillators plus a square sub, a ladder filter, two
 * envelopes and a control-rate update every 16 samples, and everything
 * except the three oscillators costs the same at both pitches. The number
 * that comes out is the one that actually decides a voice budget, which is
 * why the stage plays voices rather than bare oscillators.
 *
 * WHY THE STAGES ARE IN THIS ORDER
 *
 * Silence first, to get a baseline for the graph itself (the I2S output
 * node, the int16 conversion, the block clear) so the later figures can be
 * read as the cost of the DSP rather than the cost of having an audio graph
 * at all. Then a sine at A440, which is the cheapest possible test of the
 * whole signal path and the only stage whose correctness a phone tuner can
 * confirm to within a cent. Then the same pitch as a band-limited saw,
 * which reads on the same tuner and additionally exercises the 16 KB of
 * BLEP residual table in flash. A saw is buzzy by nature, so the thing to
 * listen for there is grit and crackle rather than buzz; the sweep stage
 * later is where broken band-limiting becomes unmissable, as a second tone
 * descending against the rising one. Only then do the engines run.
 *
 * GAIN, FADES AND GAPS
 *
 * A master gain ramps linearly over 10 ms on every stage change, and the
 * rig sits silent for 400 ms between stages. Both are there for the same
 * reason: the owner is listening for clicks and dropouts as evidence of a
 * real defect, so the program must not manufacture any of its own. The
 * gap also lets the previous stage's release tails reach the envelope's
 * idle threshold, which keeps the CPU figure for a stage attributable to
 * that stage alone. The per-stage gains are set so nothing reaches the hard
 * clip in the Teensy adapter; that clip is deliberate (a wrap would turn
 * overdrive into full-scale noise) but it means a too-hot stage would read
 * as distortion and be mistaken for a DSP fault.
 *
 * The gain multiply costs two multiplies and an add per frame in every
 * stage including the silent baseline, so it cancels out of every
 * comparison rather than favouring one stage over another.
 */
#pragma once

#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/oscillators.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/va.h"
#include "bellows/seq/euclid.h"
#include "bellows/voicepool.h"

namespace bringup {

/* Stage order is the running order. The .ino carries the durations and the
 * text, because those are presentation and this header is not. */
enum StageId {
  kSilence = 0,
  kSineA440,
  kSawA440,
  kKickOnly,
  kKit,
  kChord,
  kSweep,
  kPolyLow,
  kPolyHigh,
  kStageCount
};

inline constexpr int kPoly = 8;

/* The pitch reference. 440 Hz exactly, so any error a tuner reports is the
 * sample rate or a table and nothing else. */
inline constexpr float kRefHz = 440.0f;

/* The sweep spans the exact range docs/AUDIT.md profiled: 55 Hz to 7040 Hz
 * is seven octaves, and the top is where the saw costs 14 times the bass. */
inline constexpr float kSweepLowHz = 55.0f;
inline constexpr float kSweepOctaves = 7.0f;
inline constexpr float kSweepSeconds = 6.0f;

/* A natural minor from A1, eight notes. The high stage is this table times
 * kPolyShift rather than a second table, so "the same notes six octaves up"
 * is enforced by the code and cannot drift into an unfair comparison. */
inline constexpr float kPolyHz[kPoly] = {55.000f, 61.735f, 65.406f, 73.416f,
                                         82.407f, 87.307f, 97.999f, 110.000f};
inline constexpr float kPolyShift = 64.0f;  /* six octaves */

/* A minor 9 spread over three octaves, for the stage that is only there to
 * confirm eight voices sound like eight voices and not like mush. */
inline constexpr float kChordHz[kPoly] = {110.00f, 164.81f, 220.00f, 261.63f,
                                          329.63f, 392.00f, 493.88f, 659.26f};

class Rig {
 public:
  void Init(float sample_rate) {
    sr_ = sample_rate;
    rng_.Init("bringup");

    fade_step_ = 1.0f / (sr_ * 0.010f);   /* 10 ms, linear, reaches zero */
    gap_samples_ = static_cast<int>(sr_ * 0.400f);

    osc_.Init(sample_rate);

    bellows::Kick::Params kp;
    kp.decay = 0.55f;
    kp.drive = 3.0f;
    kick_.Init(sample_rate, kp);
    snare_.Init(sample_rate, &rng_);
    hat_.Init(sample_rate);

    /* Same three patterns as 02_DrumMachine, so a kit that sounds wrong
     * here and right there is a difference in this sketch and not in the
     * sequencer. */
    pattern_[0].Generate(5, 16);
    pattern_[1].Generate(4, 16, 4);
    pattern_[2].Generate(11, 16, 1);

    /* One parameter set for every voice in every pooled stage. The filter
     * envelope and the velocity-to-cutoff amount are both zero on purpose:
     * a moving cutoff would make the per-block cost drift within a stage
     * and turn the CPU maximum into a measurement of the LFO rather than of
     * the oscillators. Sustain is 1.0 for the same reason. */
    bellows::Va::Params p;
    p.shape = 0.0f;          /* saw, which is the shape AUDIT.md profiled */
    p.detune = 7.0f;
    p.sub = 0.25f;
    p.cutoff = 12000.0f;     /* above the top note, so both stages hear the
                                oscillator rather than the filter */
    p.resonance = 0.2f;
    p.env_amount = 0.0f;
    p.attack = 0.010f;
    p.decay = 0.100f;
    p.sustain = 1.0f;
    p.release = 0.150f;      /* short enough to be idle inside the 400 ms gap */
    p.vel_level = 0.5f;
    p.vel_filter = 0.0f;
    voice_ = p;
    for (int i = 0; i < kPoly; ++i) pool_.at(i).Init(sample_rate, &rng_, voice_);

    /* Init runs before the audio graph is started, so plain stores. */
    stage_ = kSilence;
    pending_ = kSilence;
    requested_ = kSilence;
    req_stage_ = kSilence;
    req_seq_ = 0u;
    seen_seq_ = 0u;
    phase_ = Phase::kRunning;
    running_ = 1;
    target_ = 0.0f;
    gain_ = 0.0f;
  }

  /*
   * Ask for a stage. The rig fades out, waits out the gap, then enters it,
   * so the stage is not actually sounding for about 410 ms. The .ino's
   * settle window is longer than that on purpose.
   *
   * Called from loop(), which the audio software interrupt preempts. The
   * stage machine therefore has exactly one writer, AdvancePhase() inside
   * the interrupt, and this function only publishes a request: the stage
   * first, then the sequence number that makes it visible, and nothing
   * else. It used to write pending_, phase_ and target_ directly, which
   * races AdvancePhase's own store of phase_. One interrupt landing
   * between `pending_ = stage` and `phase_ = kFadeOut` could store
   * kRunning last, losing the fade-out; and because the early-out
   * compared against pending_, which the interrupt had already consumed,
   * the next call for the same stage was a no-op and the rig stayed on
   * the old stage for the rest of the pass while the .ino printed numbers
   * under the new stage's name. The window is one block wide, and this is
   * the sketch whose whole job is to produce numbers worth trusting.
   *
   * requested_ is loop's alone, so the early-out no longer depends on
   * anything the interrupt writes.
   */
  void SetStage(int stage) {
    if (stage == requested_) return;
    requested_ = stage;
    __atomic_store_n(&req_stage_, stage, __ATOMIC_RELAXED);
    /* Release, paired with the acquire in AdvancePhase: the sequence
     * number is what publishes the stage, so the stage has to be visible
     * first. Single word, so there is no half-published request. */
    __atomic_store_n(&req_seq_, req_seq_ + 1u, __ATOMIC_RELEASE);
  }

  /* Both read state the interrupt owns, so both load it explicitly rather
   * than letting the compiler cache it across a spin in loop(). */
  int CurrentStage() const { return __atomic_load_n(&stage_, __ATOMIC_RELAXED); }
  bool Running() const { return __atomic_load_n(&running_, __ATOMIC_RELAXED) != 0; }
  int ActiveVoices() const { return pool_.ActiveCount(); }

  /* Frames handed to the render, and calls into it. The .ino compares
   * these against elapsed wall time; see the comment on the dropout check
   * there for what the comparison does and does not prove. */
  uint32_t Frames() const { return frames_; }
  uint32_t Updates() const { return updates_; }

  void operator()(float* l, float* r, int from, int to) {
    const int n = to - from;
    ++updates_;
    frames_ += static_cast<uint32_t>(n);

    AdvancePhase(n);
    if (stage_ == kSweep) AdvanceSweep(n);

    int i = from;
    while (i < to) {
      int span = to - i;
      if (step_samples_ > 0) {
        if (countdown_ <= 0) {
          Step();
          countdown_ = step_samples_;
        }
        if (span > countdown_) span = countdown_;
        countdown_ -= span;
      }
      RenderSpan(l, r, i, i + span);
      i += span;
    }

    ApplyGain(l, r, from, to);
  }

 private:
  enum class Phase { kFadeOut, kGap, kRunning };

  /* The stage machine runs at block granularity. Nothing here is sample
   * accurate and nothing needs to be: a stage boundary is a thing a person
   * hears, not a thing a sequencer schedules.
   *
   * This runs in the audio interrupt and is the only writer of pending_,
   * phase_, target_ and stage_. It picks a request up at the top of a
   * block, so a request published anywhere inside a block takes effect on
   * the next one, whatever the interrupt was doing at the time. */
  void AdvancePhase(int n) {
    const uint32_t seq = __atomic_load_n(&req_seq_, __ATOMIC_ACQUIRE);
    if (seq != seen_seq_) {
      seen_seq_ = seq;
      pending_ = __atomic_load_n(&req_stage_, __ATOMIC_RELAXED);
      phase_ = Phase::kFadeOut;
      __atomic_store_n(&running_, static_cast<uint8_t>(0), __ATOMIC_RELAXED);
      target_ = 0.0f;
    }
    if (phase_ == Phase::kFadeOut) {
      if (gain_ <= 0.0f) {
        ReleaseAll();
        phase_ = Phase::kGap;
        gap_left_ = gap_samples_;
      }
      return;
    }
    if (phase_ == Phase::kGap) {
      gap_left_ -= n;
      if (gap_left_ <= 0) {
        Enter(pending_);
        phase_ = Phase::kRunning;
        __atomic_store_n(&running_, static_cast<uint8_t>(1), __ATOMIC_RELAXED);
      }
    }
  }

  /* Drums take a fast 30 ms decay from NoteOff, Va voices take their
   * release. Both are idle well inside the gap, which is what keeps a
   * stage's CPU figure free of the previous stage's tails. */
  void ReleaseAll() {
    kick_.NoteOff();
    snare_.NoteOff();
    hat_.NoteOff();
    for (int i = 0; i < kPoly; ++i) pool_.NoteOff(i);
  }

  void Enter(int stage) {
    /* Published for CurrentStage(), which loop() reads while this runs. */
    __atomic_store_n(&stage_, stage, __ATOMIC_RELAXED);
    step_samples_ = 0;
    countdown_ = 0;
    chord_on_ = false;
    sweep_pos_ = 0.0f;

    switch (stage) {
      case kSilence:
        target_ = 0.0f;
        break;

      case kSineA440:
        osc_.SetShape(bellows::BlepShape::kSine);
        osc_.SetFreq(kRefHz);
        osc_.Reset(0.0f);
        target_ = 0.30f;
        break;

      case kSawA440:
        osc_.SetShape(bellows::BlepShape::kSaw);
        osc_.SetFreq(kRefHz);
        osc_.Reset(0.0f);
        target_ = 0.18f;
        break;

      case kKickOnly:
        step_samples_ = static_cast<int>(sr_ * 0.5f);  /* two a second */
        target_ = 0.80f;
        break;

      case kKit:
        /* Sixteenths at 120 bpm. */
        step_samples_ = static_cast<int>(sr_ * 0.125f);
        for (int i = 0; i < 3; ++i) pattern_[i].Reset();
        target_ = 0.60f;
        break;

      case kChord:
        step_samples_ = static_cast<int>(sr_ * 3.0f);
        target_ = 0.14f;
        break;

      case kSweep:
        osc_.SetShape(bellows::BlepShape::kSaw);
        osc_.SetFreq(kSweepLowHz);
        osc_.Reset(0.0f);
        target_ = 0.18f;
        break;

      case kPolyLow:
      case kPolyHigh: {
        const float mul = (stage == kPolyHigh) ? kPolyShift : 1.0f;
        for (int i = 0; i < kPoly; ++i) {
          pool_.at(i).SetParams(voice_);
          pool_.NoteOn(i, kPolyHz[i] * mul, 0.8f, frames_);
        }
        target_ = 0.14f;
        break;
      }

      default:
        target_ = 0.0f;
        break;
    }
  }

  void Step() {
    switch (stage_) {
      case kKickOnly:
        kick_.NoteOn(50.0f, 0.9f);
        break;

      case kKit:
        if (pattern_[0].Process()) kick_.NoteOn(50.0f, 0.95f);
        if (pattern_[1].Process()) snare_.NoteOn(190.0f, 0.80f);
        if (pattern_[2].Process()) hat_.NoteOn(330.0f, 0.50f);
        break;

      case kChord:
        chord_on_ = !chord_on_;
        for (int i = 0; i < kPoly; ++i) {
          if (chord_on_) {
            pool_.NoteOn(i, kChordHz[i], 0.7f, frames_);
          } else {
            pool_.NoteOff(i);
          }
        }
        break;

      default:
        break;
    }
  }

  /* Exponential, because a linear sweep spends almost all of its time in
   * the top octave and the interesting part of the BLEP cost curve is the
   * shape of the climb. One update per block is far finer than the ear
   * resolves in a 6 second glide. */
  void AdvanceSweep(int n) {
    sweep_pos_ += static_cast<float>(n) / (sr_ * kSweepSeconds);
    if (sweep_pos_ >= 1.0f) sweep_pos_ -= 1.0f;
    osc_.SetFreq(kSweepLowHz * bellows::fm::Exp2(sweep_pos_ * kSweepOctaves));
  }

  void RenderSpan(float* l, float* r, int from, int to) {
    switch (stage_) {
      case kSineA440:
      case kSawA440:
      case kSweep:
        /* Mono into both channels: a stage that comes out of one ear only
         * is a wiring fault, and the tone stages are where that should be
         * noticed rather than three stages later. */
        for (int i = from; i < to; ++i) {
          const float y = osc_.Process();
          l[i] += y;
          r[i] += y;
        }
        break;

      case kKickOnly:
        kick_.Process(l, r, from, to);
        break;

      case kKit:
        kick_.Process(l, r, from, to);
        snare_.Process(l, r, from, to);
        hat_.Process(l, r, from, to);
        break;

      case kChord:
      case kPolyLow:
      case kPolyHigh:
        pool_.Process(l, r, from, to);
        break;

      default:
        break;
    }
  }

  void ApplyGain(float* l, float* r, int from, int to) {
    float g = gain_;
    const float step = fade_step_;
    const float t = target_;
    for (int i = from; i < to; ++i) {
      if (g < t) {
        g += step;
        if (g > t) g = t;
      } else if (g > t) {
        g -= step;
        if (g < t) g = t;
      }
      l[i] *= g;
      r[i] *= g;
    }
    gain_ = g;
  }

  bellows::Rng rng_;
  bellows::BlepOsc osc_;
  bellows::Kick kick_;
  bellows::Snare snare_;
  bellows::Hat hat_;
  bellows::Euclid<16> pattern_[3];
  bellows::VoicePool<bellows::Va, kPoly> pool_;
  bellows::Va::Params voice_;

  float sr_ = 48000.0f;
  float gain_ = 0.0f, target_ = 0.0f, fade_step_ = 1.0f;
  float sweep_pos_ = 0.0f;
  /* loop() writes req_stage_ and req_seq_ and nothing else; the audio
   * interrupt writes stage_, pending_, phase_, running_ and everything
   * below them. requested_ and seen_seq_ are private to their one side. */
  int requested_ = kSilence;
  int req_stage_ = kSilence;
  uint32_t req_seq_ = 0u, seen_seq_ = 0u;
  int stage_ = kSilence, pending_ = kSilence;
  uint8_t running_ = 1;
  Phase phase_ = Phase::kRunning;
  int gap_samples_ = 0, gap_left_ = 0;
  int step_samples_ = 0, countdown_ = 0;
  bool chord_on_ = false;
  uint32_t frames_ = 0, updates_ = 0;
};

}  // namespace bringup
