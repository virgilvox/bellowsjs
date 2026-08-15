/* Shared logic for the 21_Presets example: the whole preset table, played.
 *
 * 20_Instruments is eleven patches written out by hand, one header each.
 * This is the other half of the same idea: bellows/presets/instruments.h
 * already holds all 50 presets as data, so the program here is the shell
 * that turns a row of that table into a sounding voice, and it is short
 * because the table does the describing.
 *
 * HOW A ROW BECOMES A VOICE
 *
 * The table splits a preset into an engine tag, a slot, and a params row
 * in that engine's own table, because no single struct can hold eleven
 * different Params. So the shell needs one voice pool per engine, and a
 * way to send a preset to the right one. That is bellows::Bank, indexed by
 * the engine tag itself:
 *
 *   book_.With(pre.engine, [&](auto& slot) { slot.Load(pre); });
 *
 * Bank::With is a chain of integer compares resolved at the call site, so
 * the dispatch is the same shape a registry would give and costs no
 * vtable, no string and no allocation. Each Slot then asks the table for
 * ITS params (PluckParamsOf returns nullptr for a modal preset) and
 * applies them into its own engine's Params, where the field names are
 * checked by the compiler.
 *
 * Loading re-Inits the pool rather than calling SetParams, because Pluck
 * has no SetParams: its loop filter and delay length are derived at Init.
 * Re-Init is free here, since a preset only changes between phrases.
 *
 * ELEVEN ENGINES IN ONE IMAGE, WHICH IS THE HONEST WAY TO SIZE IT
 *
 * This sketch names every engine the table uses, so all eleven are linked,
 * and the size it reports is the whole book rather than the cheapest
 * preset in it. A sketch that only wanted the mallets would name
 * kEngineModal's slot and nothing else, and --gc-sections would drop the
 * other ten engines and their ten param tables. That property is the
 * reason the preset table is split the way it is, and it is only worth
 * anything if nobody has to take it on faith: build this, then build it
 * with the Bank cut down to one slot, and compare.
 *
 * WHAT IS PLAYED
 *
 * The same four bars for every preset, in A natural minor through the
 * tuning layer, alternating: a broken line, then a held triad, twice. One
 * part rather than 20_Instruments' four, because the question here is what
 * the preset table sounds like, not what part suits a clarinet. A pad gets
 * an arpeggio it would not have chosen and a woodblock gets a held chord
 * it cannot sustain, and both are informative.
 *
 * LEVELS ARE NOT MATCHED, AND THE TABLE DOES NOT CLAIM THEY ARE
 *
 * Each preset carries a gain trim from the JS, mostly 0.8, and that is a
 * channel trim someone chose in a browser, not a measured loudness match
 * like 20_Instruments' kTrim. The engines have no common loudness
 * reference, so a struck bar and a sustained reed are far apart on the
 * same numbers, and stepping through the tour means the level moves. The
 * master limiter keeps the peaks in bounds and nothing here pretends to
 * fix the rest.
 *
 * clean-electric asks for a tape delay, which is not ported, so it plays
 * dry. The table says so through kFxTapeDelay rather than quietly
 * substituting the clean delay, and this shell prints it.
 *
 * WHERE THE RAM GOES
 *
 * Three inserts are instantiated once and shared, because only one preset
 * sounds at a time. Two of them are small; the plate is not. Plate<48000,
 * 30> is a 30 ms predelay ceiling, which is all the four string presets
 * ask for (25 ms at the cello and the double bass), and its tank is still
 * the largest single object in the sketch. A preset tour that never
 * selects a string preset does not need it, and cutting it is the first
 * thing to try if this has to fit somewhere smaller. The second is the
 * Pluck and Waveguide pools, which are sized for a 55 Hz floor because
 * bass-guitar and double-bass are shifted two octaves down.
 */
#pragma once

#include <stdint.h>

#include "bellows/bank.h"
#include "bellows/config.h"
#include "bellows/core/prng.h"
#include "bellows/engines/additive.h"
#include "bellows/engines/fm.h"
#include "bellows/engines/formant.h"
#include "bellows/engines/harmonic.h"
#include "bellows/engines/modal.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/engines/va.h"
#include "bellows/engines/waveguide.h"
#include "bellows/engines/wavetable.h"
#include "bellows/engines/westcoast.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"
#include "bellows/presets/instruments.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"
#include "bellows/voicepool.h"

namespace presets {

/* ------------------------------------------------------------------ */
/* The part                                                             */
/* ------------------------------------------------------------------ */

inline constexpr int kSteps = 16; /* sixteenths in a bar */
inline constexpr int kBars = 4;

/* Degrees of the scale, relative to the root. kRest is outside any degree
 * the scale can produce. */
inline constexpr int kRest = -99;
inline constexpr int kLine[kSteps] = {0, kRest, 4,     kRest, 2,     kRest, 7,     kRest,
                                      4, kRest, 2,     kRest, 0,     kRest, kRest, kRest};

/* The held triad, in degrees. Three notes is also the polyphony every
 * pool below is sized for. */
inline constexpr int kTriad[3] = {0, 2, 4};

/* Step the triad is released on, leaving four sixteenths of tail before
 * the bar turns over. */
inline constexpr int kChordRelease = 12;

/* A3 in 12-EDO. The line reaches degree 7, an octave up, and the preset's
 * own octave shift moves the lot: bass-guitar at -2 puts the root on 55 Hz,
 * which is why the Pluck below is sized for 55 and not for 110. */
inline constexpr int kRootIndex = 57;

/* ------------------------------------------------------------------ */
/* One engine's voices                                                  */
/* ------------------------------------------------------------------ */

/*
 * Engines do not agree on how they are initialised: Pluck, Modal, Va,
 * Tube, Formant and Harmonic take an Rng, Waveguide takes two, and Fm,
 * WestCoast, Additive and Wavetable take none, because only some of them
 * have noise in them. Rather than detect that, each traits struct below
 * writes the call out. Eleven lines of explicitness beats a SFINAE probe
 * that fails to read.
 *
 * The second Rng Waveguide wants is the JS rng.fork('note') stream, which
 * per note jitter and the pitch settle draw from so they never shift the
 * main stream. Fork is string concatenation, so the label is the parent's
 * plus "::note".
 *
 * Voice counts are three everywhere, which is what the held triad needs.
 * The two waveguides are the expensive ones. Pluck at a 55 Hz floor is 876
 * samples of delay plus twice that of excitation table, 10.5 KB a voice,
 * 31.5 KB for the pool. Waveguide at the same floor is three delay lines,
 * about 11.3 KB a voice and 34 KB for the pool, and it is 55 Hz for the
 * same reason: double-bass is shifted two octaves down. Tube at a 110 Hz
 * floor is a bore half period, an order of magnitude less. Those are the
 * numbers to cut first if this has to fit somewhere smaller.
 */
inline constexpr int kVoices = 3;

struct PluckTraits {
  using Engine = bellows::Pluck<55>;
  using Data = bellows::PluckPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) { return bellows::PluckParamsOf(p); }
  static void Init(Engine& v, float sr, bellows::Rng* rng, bellows::Rng*,
                   const Engine::Params& p) {
    v.Init(sr, rng, p);
  }
};

struct ModalTraits {
  using Engine = bellows::Modal;
  using Data = bellows::ModalPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) { return bellows::ModalParamsOf(p); }
  static void Init(Engine& v, float sr, bellows::Rng* rng, bellows::Rng*,
                   const Engine::Params& p) {
    v.Init(sr, rng, p);
  }
};

struct VaTraits {
  using Engine = bellows::Va;
  using Data = bellows::VaPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) { return bellows::VaParamsOf(p); }
  static void Init(Engine& v, float sr, bellows::Rng* rng, bellows::Rng*,
                   const Engine::Params& p) {
    v.Init(sr, rng, p);
  }
};

struct FmTraits {
  using Engine = bellows::Fm;
  using Data = bellows::FmPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) { return bellows::FmParamsOf(p); }
  static void Init(Engine& v, float sr, bellows::Rng*, bellows::Rng*, const Engine::Params& p) {
    v.Init(sr, p);
  }
};

struct TubeTraits {
  using Engine = bellows::Tube<110>;
  using Data = bellows::TubePresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) { return bellows::TubeParamsOf(p); }
  static void Init(Engine& v, float sr, bellows::Rng* rng, bellows::Rng*,
                   const Engine::Params& p) {
    v.Init(sr, rng, p);
  }
};

struct FormantTraits {
  using Engine = bellows::Formant;
  using Data = bellows::FormantPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) {
    return bellows::FormantParamsOf(p);
  }
  static void Init(Engine& v, float sr, bellows::Rng* rng, bellows::Rng*,
                   const Engine::Params& p) {
    v.Init(sr, rng, p);
  }
};

struct WestCoastTraits {
  using Engine = bellows::WestCoast;
  using Data = bellows::WestCoastPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) {
    return bellows::WestCoastParamsOf(p);
  }
  static void Init(Engine& v, float sr, bellows::Rng*, bellows::Rng*, const Engine::Params& p) {
    v.Init(sr, p);
  }
};

/* The bowed waveguide. The second polarization stays compiled in, since
 * the four bowed presets set polDetune and the engine switches it off by
 * itself when the value is 0, which is what pizzicato-strings gets. */
struct StringTraits {
  using Engine = bellows::Waveguide<55>;
  using Data = bellows::StringPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) { return bellows::StringParamsOf(p); }
  static void Init(Engine& v, float sr, bellows::Rng* rng, bellows::Rng* note_rng,
                   const Engine::Params& p) {
    v.Init(sr, rng, note_rng, p);
  }
};

struct HarmonicTraits {
  using Engine = bellows::Harmonic;
  using Data = bellows::HarmonicPresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) {
    return bellows::HarmonicParamsOf(p);
  }
  static void Init(Engine& v, float sr, bellows::Rng* rng, bellows::Rng*,
                   const Engine::Params& p) {
    v.Init(sr, rng, p);
  }
};

struct AdditiveTraits {
  using Engine = bellows::Additive<>;
  using Data = bellows::AdditivePresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) {
    return bellows::AdditiveParamsOf(p);
  }
  static void Init(Engine& v, float sr, bellows::Rng*, bellows::Rng*, const Engine::Params& p) {
    v.Init(sr, p);
  }
};

struct WavetableTraits {
  using Engine = bellows::Wavetable;
  using Data = bellows::WavetablePresetParams;
  static const Data* Find(const bellows::InstrumentPreset& p) {
    return bellows::WavetableParamsOf(p);
  }
  static void Init(Engine& v, float sr, bellows::Rng*, bellows::Rng*, const Engine::Params& p) {
    v.Init(sr, p);
  }
};

/* A pool of one engine, plus the two calls the shell makes on it. */
template <class T>
class Slot {
 public:
  void Init(float sample_rate, bellows::Rng* rng, bellows::Rng* note_rng) {
    sr_ = sample_rate;
    rng_ = rng;
    note_rng_ = note_rng;
    typename T::Engine::Params p; /* engine defaults until a preset lands */
    for (int i = 0; i < kVoices; ++i) T::Init(pool_.at(i), sr_, rng_, note_rng_, p);
  }

  /* False when the preset belongs to another engine, which is how the
   * Bank's other ten slots answer. */
  bool Load(const bellows::InstrumentPreset& pre) {
    const typename T::Data* d = T::Find(pre);
    if (d == nullptr) return false;
    typename T::Engine::Params p;
    bellows::ApplyPreset(*d, &p);
    for (int i = 0; i < kVoices; ++i) T::Init(pool_.at(i), sr_, rng_, note_rng_, p);
    return true;
  }

  void NoteOn(int id, float hz, float vel) { pool_.NoteOn(id, hz, vel, frame_); }
  void NoteOff(int id) { pool_.NoteOff(id); }

  void operator()(float* l, float* r, int from, int to) {
    pool_.Process(l, r, from, to);
    frame_ += static_cast<uint32_t>(to - from);
  }

 private:
  bellows::VoicePool<typename T::Engine, kVoices> pool_;
  bellows::Rng* rng_ = nullptr;
  bellows::Rng* note_rng_ = nullptr;
  float sr_ = BELLOWS_SAMPLE_RATE;
  uint32_t frame_ = 0;
};

/* Declaration order IS bellows::PresetEngine order. The static_assert
 * below is what keeps it that way: get it wrong and a modal preset is
 * loaded into the pluck pool, which sounds like nothing at all. */
using Book =
    bellows::Bank<Slot<PluckTraits>, Slot<ModalTraits>, Slot<VaTraits>, Slot<FmTraits>,
                  Slot<TubeTraits>, Slot<FormantTraits>, Slot<WestCoastTraits>,
                  Slot<StringTraits>, Slot<HarmonicTraits>, Slot<AdditiveTraits>,
                  Slot<WavetableTraits>>;

static_assert(Book::kCount == bellows::kPresetEngineCount,
              "the bank must have one slot per PresetEngine, in enum order");

/* ------------------------------------------------------------------ */
/* The tour                                                             */
/* ------------------------------------------------------------------ */

/* 30 ms of predelay ceiling. The four string presets ask for 20 and 25,
 * and the default 250 would carry 193628 bytes of tank instead of the
 * 25352 this does. Nothing else in the table wants a plate. */
using PlateInsert = bellows::Plate<BELLOWS_SAMPLE_RATE, 30>;

class Tour {
 public:
  void Init(float sample_rate, unsigned bpm = 96) {
    sr_ = sample_rate;
    rng_.Init("presets");
    note_rng_.Init("presets::note");
    scale_.Init(kRootIndex, bellows::kScaleMinor);
    edo12_.InitEdo(12, 440.0f, 69);
    book_.ForEach(
        [this, sample_rate](auto& slot) { slot.Init(sample_rate, &rng_, &note_rng_); });

    bellows::Chorus<>::Params ch; /* replaced per preset, never bypassed by params */
    chorus_.Init(sample_rate, ch);
    bellows::Tremolo::Params tr;
    tremolo_.Init(sample_rate, tr, &rng_);
    /* Init carves the tank out of the plate's own storage and answers
     * false if the rate needs more than it was sized for. Nothing here can
     * recover from that, so it is remembered and printed rather than
     * ignored: a silent false would play the four string presets dry. */
    PlateInsert::Params pl;
    plate_ok_ = plate_.Init(sample_rate, pl);

    /* A trim cannot fix a 30 dB crest factor on a plucked chord, so the
     * peaks are caught here rather than by pulling every preset down to
     * fit the loudest transient in the table. */
    bellows::Limiter<>::Params lim;
    lim.ceiling_db = -1.0f;
    lim.release = 0.06f;
    limiter_.Init(sample_rate, lim);

    SetTempo(bpm);
    Select(0);
  }

  void SetTempo(unsigned bpm) {
    const float steps_per_sec = (static_cast<float>(bpm) / 60.0f) * 4.0f;
    samples_per_step_ = static_cast<int>(sr_ / steps_per_sec + 0.5f);
    if (samples_per_step_ < 1) samples_per_step_ = 1;
  }

  /* Load preset `i` from the table. Out of range wraps, so a caller can
   * hand this a free running counter. */
  void Select(int i) {
    if (bellows::kInstrumentPresetCount <= 0) return;
    i %= bellows::kInstrumentPresetCount;
    if (i < 0) i += bellows::kInstrumentPresetCount;
    /* Release whatever the outgoing preset holds first, or a pad sustains
     * under the next instrument for the rest of the tour. */
    AllOff();
    which_ = i;
    step_ = 0;
    const bellows::InstrumentPreset& pre = bellows::kInstrumentPresets[which_];
    /* Load answers false when the slot it landed on belongs to another
     * engine, which can only happen if the Bank's declaration order stops
     * matching PresetEngine. The count is checked at compile time and the
     * order is checked here, because a preset loaded into the wrong pool
     * plays the previous preset's params and has no other symptom. */
    loaded_ = false;
    book_.With(pre.engine, [this, &pre](auto& slot) { loaded_ = slot.Load(pre); });

    if (const auto* c = bellows::ChorusParamsOf(pre)) {
      bellows::Chorus<>::Params p;
      bellows::ApplyPreset(*c, &p);
      chorus_.SetParams(p);
      chorus_.Reset();
    }
    if (const auto* t = bellows::TremoloParamsOf(pre)) {
      bellows::Tremolo::Params p;
      bellows::ApplyPreset(*t, &p);
      tremolo_.SetParams(p);
      tremolo_.Reset();
    }
    if (const auto* t = bellows::PlateParamsOf(pre)) {
      PlateInsert::Params p;
      bellows::ApplyPreset(*t, &p);
      plate_.SetParams(p);
      plate_.Reset();
    }
  }

  int Selected() const { return which_; }
  const bellows::InstrumentPreset& Current() const { return bellows::kInstrumentPresets[which_]; }
  int Bar() const { return (step_ / kSteps) % kBars; }

  /* False when the last Select found no pool for its engine. */
  bool Loaded() const { return loaded_; }

  /* False when the plate refused the sample rate, which would leave the
   * four string presets dry. */
  bool PlateReady() const { return plate_ok_; }

  void operator()(float* l, float* r, int from, int to) {
    int i = from;
    while (i < to) {
      if (countdown_ <= 0) {
        Step();
        countdown_ = samples_per_step_;
      }
      int span = to - i;
      if (span > countdown_) span = countdown_;
      if (span > kMaxBlock) span = kMaxBlock;

      /* Voices ADD, so the preset is rendered into a scratch, run through
       * its insert, trimmed, and only then added to the output. Rendering
       * it straight into l and r would put the insert on everything that
       * was there already. */
      for (int k = 0; k < span; ++k) {
        scratch_l_[k] = 0.0f;
        scratch_r_[k] = 0.0f;
      }
      const bellows::InstrumentPreset& pre = Current();
      book_.With(pre.engine, [this, span](auto& slot) { slot(scratch_l_, scratch_r_, 0, span); });
      if (pre.fx == bellows::kFxChorus) chorus_.Process(scratch_l_, scratch_r_, 0, span);
      if (pre.fx == bellows::kFxTremolo) tremolo_.Process(scratch_l_, scratch_r_, 0, span);
      if (pre.fx == bellows::kFxPlate) plate_.Process(scratch_l_, scratch_r_, 0, span);
      for (int k = 0; k < span; ++k) {
        l[i + k] += pre.gain * scratch_l_[k];
        r[i + k] += pre.gain * scratch_r_[k];
      }
      limiter_.Process(l, r, i, i + span);
      i += span;
      countdown_ -= span;
    }
  }

 private:
  static constexpr int kMaxBlock = BELLOWS_BLOCK_SIZE;

  /* Frequency of a degree, through the tuning layer, shifted by the
   * preset's suggested octave. Nothing here writes 440 * 2^((n - 69) / 12):
   * swap edo12_ for a 19-EDO tuning and the whole tour moves into it. */
  float Hz(int degree) const {
    float hz = bellows::DegreeFreq(edo12_, kRootIndex, scale_.Intervals(), scale_.Length(), degree);
    for (int8_t o = Current().octave; o > 0; --o) hz *= 2.0f;
    for (int8_t o = Current().octave; o < 0; ++o) hz *= 0.5f;
    return hz;
  }

  void Step() {
    const int s = step_ % kSteps;
    const bool chord_bar = (Bar() % 2) == 1;

    if (chord_bar) {
      if (s == 0) {
        AllOff();
        for (int i = 0; i < 3; ++i) {
          const int d = kTriad[i];
          book_.With(Current().engine, [this, d](auto& slot) { slot.NoteOn(d, Hz(d), 0.62f); });
          held_[i] = d;
        }
        held_count_ = 3;
      } else if (s == kChordRelease) {
        AllOff();
      }
    } else {
      const int d = kLine[s];
      if (d != kRest) {
        /* No NoteOff for the line, as 20_Instruments' melody part does
         * nothing either: a plucked string has no key to lift and its
         * NoteOff is a palm mute, so the pool's steal order (free, then
         * oldest released, then oldest held) ends the notes instead. On a
         * sustaining preset that means three notes overlap.
         *
         * Accent the downbeats, which is what moves a filter or a
         * wavefolder and does nothing at all to a struck bar. */
        const float vel = (s % 4 == 0) ? 0.9f : 0.6f;
        book_.With(Current().engine, [this, d, vel](auto& slot) { slot.NoteOn(d, Hz(d), vel); });
      }
    }
    ++step_;
  }

  void AllOff() {
    for (int i = 0; i < held_count_; ++i) {
      const int id = held_[i];
      book_.With(Current().engine, [id](auto& slot) { slot.NoteOff(id); });
    }
    held_count_ = 0;
  }

  Book book_;
  bellows::Rng rng_;
  bellows::Rng note_rng_;
  bellows::Scale scale_;
  bellows::Tuning12 edo12_;
  bellows::Chorus<> chorus_;
  bellows::Tremolo tremolo_;
  PlateInsert plate_;
  bellows::Limiter<> limiter_;
  float scratch_l_[kMaxBlock] = {};
  float scratch_r_[kMaxBlock] = {};
  float sr_ = BELLOWS_SAMPLE_RATE;
  int samples_per_step_ = 1;
  int countdown_ = 0;
  int step_ = 0;
  int which_ = 0;
  int held_[3] = {0, 0, 0};
  int held_count_ = 0;
  bool loaded_ = false;
  bool plate_ok_ = false;
};

}  // namespace presets
