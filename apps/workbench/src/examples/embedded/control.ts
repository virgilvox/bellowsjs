/*
 * Control and polyphony: the board-facing half of a bellows program.
 *
 * The engine examples are about making a sound. These are about what
 * decides when a sound happens and which voice plays it: a pool and its
 * steal order, a bank instead of a registry, a pin, a button, a MIDI
 * cable, and the one number that says whether any of it fits in time.
 *
 * Every cpp field compiles. The browser field next to it plays the same
 * idea, minus the pin, because a web page has no potentiometer.
 */

import type { EmbeddedExample } from './types';

export const ctlExamples: EmbeddedExample[] = [
  {
    id: 'ctl-polyphony',
    title: 'POLYPHONY',
    category: 'CONTROL + POLYPHONY',
    description:
      'VoicePool is a plain array of one engine type with polyphony as a template parameter, so nothing allocates and there is no factory: you Init each slot yourself. Eight notes go into four voices here, which means the pool has to steal. The steal order is a free voice first, then the oldest released one, then the oldest held one, and the frame you pass to NoteOn is what oldest is measured in.',
    seed: 'ctl-poly',
    needs: ['bellows/core/prng.h', 'bellows/engines/va.h', 'bellows/voicepool.h'],
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    caveat: null,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/voicepool.h"

static constexpr int kPoly = 4;

static bellows::Rng rng;
static bellows::VoicePool<bellows::Va, kPoly> pool;

/* Eight notes into four voices, so from the fifth on the pool steals. */
static const float kHz[8] = {110.0f, 130.8f, 164.8f, 196.0f,
                             220.0f, 261.6f, 329.6f, 392.0f};

static int samples_per_step = 0;
static int countdown = 0;
static int step = 0;
static uint32_t frame = 0;

void setup() {
  rng.Init("poly");

  bellows::Va::Params p;
  p.shape = 0.3f;
  p.cutoff = 2600.0f;
  p.sustain = 0.55f;
  p.release = 1.2f;   /* a long tail, so a stolen voice is easy to hear */

  /* The pool is a plain array of Va. Init each slot yourself: there is
   * no factory and nothing allocates. */
  for (int i = 0; i < kPoly; ++i) pool.at(i).Init(kSampleRate, &rng, p);

  samples_per_step = static_cast<int>(kSampleRate * 0.35f);
}

/* note_id is any int you pick. Here it is the index into kHz, so NoteOff
 * finds the slot holding that note by scanning four slots, no map. */
static void Step() {
  const int n = step & 7;
  if (n == 0) {
    for (int k = 0; k < 8; ++k) pool.NoteOff(k);
  }
  /* Steal order, from src/core/voicepool.ts: a slot whose voice has gone
   * quiet, else the oldest released one, else the oldest held one. The
   * frame you pass is what "oldest" is measured in. */
  pool.NoteOn(n, kHz[n], 0.7f, frame);
  ++step;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      Step();
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    /* Split the block at the step so a note starts on its sample rather
     * than at the block edge. */
    pool.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
    frame += static_cast<uint32_t>(span);
  }
}`,
    code: `// polyphony is an option on the channel, the same number the C++ passes
// as a template parameter
var synth = b.voice('va',
  { shape: 0.3, cutoff: 2600, sustain: 0.55, release: 1.2 },
  { polyphony: 4 });

var hz = [110, 130.8, 164.8, 196, 220, 261.6, 329.6, 392];
var t = b.now() + 0.1;
var ids = [];

// hold every note: nothing is released while they stack up, so from the
// fifth on the pool takes a voice back off the oldest held note
for (var i = 0; i < hz.length; i++) {
  ids.push(synth.on({ hz: hz[i] }, 0.7, t + i * 0.35));
}
for (var i = 0; i < ids.length; i++) synth.off(ids[i], t + 3.2);

log('four voices, eight notes, none released while they stack');
log('steal order: free voice, then oldest released, then oldest held');
log('the first four notes are the ones that disappear');`,
  },

  {
    id: 'ctl-bank',
    title: 'A COMPILE-TIME BANK',
    category: 'CONTROL + POLYPHONY',
    description:
      'Bank is what replaces the browser registry. You name the engines as template arguments and select one with a runtime integer, exactly as you would with a string id, but With() resolves that integer through compares generated at compile time: no vtable, no table of function pointers, no string compare. The reason is measured. Playing one kick through a string-keyed registry of five engines costs 30488 bytes of flash against 3760 direct, because a registry names every engine and so the linker has to keep every engine, every constant table and every delay buffer, including the ones the program can never reach.',
    seed: 'ctl-bank',
    needs: ['bellows/bank.h', 'bellows/core/prng.h', 'bellows/engines/drums.h'],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'Three engines mixed, so there is no single parity row: the individual rows are kick 9.79e-5, snare 3.17e-5 and hat 2.47e-4.',
    cpp: `#include "bellows/bank.h"
#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"

/* Declaration order is dispatch order: pad 0 is the first template
 * argument. This enum is the whole "registry". */
enum Pad { kKick = 0, kSnare, kHat, kPadCount };

static bellows::Rng rng;
static bellows::Bank<bellows::Kick, bellows::Snare, bellows::Hat> kit;

/* One byte per sixteenth, one bit per pad. */
static const uint8_t kSteps[16] = {
    0x5, 0x4, 0x6, 0x4, 0x5, 0x4, 0x6, 0x5,
    0x5, 0x4, 0x6, 0x4, 0x5, 0x4, 0x7, 0x6,
};
static const float kHz[kPadCount] = {50.0f, 190.0f, 330.0f};
static const float kVel[kPadCount] = {0.75f, 0.6f, 0.4f};

static int samples_per_step = 0;
static int countdown = 0;
static int step = 0;

void setup() {
  rng.Init("bank");
  /* Reach the members directly to init them: head is the first engine,
   * tail is the rest of the bank. Snare takes an Rng, the others do
   * not, which is exactly why they are not behind one interface. */
  kit.head.Init(kSampleRate);
  kit.tail.head.Init(kSampleRate, &rng);
  kit.tail.tail.head.Init(kSampleRate);

  samples_per_step = static_cast<int>(kSampleRate * 0.125f);  /* 120 bpm */
}

static void Step() {
  const uint8_t mask = kSteps[step & 15];
  for (int pad = 0; pad < kPadCount; ++pad) {
    if ((mask & (1u << pad)) == 0) continue;
    const float hz = kHz[pad];
    const float vel = kVel[pad];
    /* A runtime int selects the engine, the same way a string id would
     * in the browser. With() resolves it through a chain of compares
     * generated at compile time: no vtable, no function pointer table,
     * no string compare, and the linker still sees three concrete
     * types. */
    kit.With(pad, [hz, vel](auto& voice) { voice.NoteOn(hz, vel); });
  }
  ++step;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      Step();
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    kit.ForEach([l, r, i, span](auto& voice) { voice.Process(l, r, i, i + span); });
    i += span;
    countdown -= span;
  }
}`,
    code: `// in the browser the registry is free: naming an engine costs a string
// lookup and the whole library is already downloaded either way
var kit = [b.voice('kick'), b.voice('snare'), b.voice('hat')];
var hz = [50, 190, 330];
var vel = [0.75, 0.6, 0.4];

// the same table as the C++: one byte per sixteenth, one bit per pad
var steps = [0x5, 0x4, 0x6, 0x4, 0x5, 0x4, 0x6, 0x5,
             0x5, 0x4, 0x6, 0x4, 0x5, 0x4, 0x7, 0x6];

b.bpm(120);

var off = b.clock.at('16n', function (t, step) {
  var mask = steps[step % 16];
  for (var pad = 0; pad < 3; pad++) {
    if (mask & (1 << pad)) kit[pad].note({ hz: hz[pad] }, { at: t, vel: vel[pad] });
  }
});
onCleanup(off);

b.start();
log('three pads, selected by index, from one 16 byte table');
log('on a board that index goes through Bank and links three engines');
log('a string-keyed registry of five would link all five: 30488 B vs 3760');`,
  },

  {
    id: 'ctl-pot',
    title: 'READ A POTENTIOMETER',
    category: 'CONTROL + POLYPHONY',
    description:
      'A knob on an analog pin moving the filter cutoff of a droning voice. Two things make it usable. The mapping is exponential, because cutoff is heard in octaves and a linear pot on a linear range spends most of its travel above 10 kHz doing nothing. And the value is smoothed, because a 10-bit ADC never sits still: the bottom bit or two dither, the raw number hops between neighbours on every read, and each hop is a step change in a filter coefficient that you hear as zipper noise.',
    seed: 'ctl-pot',
    needs: [
      'bellows/core/fastmath.h',
      'bellows/core/prng.h',
      'bellows/dsp/envelopes.h',
      'bellows/engines/va.h',
    ],
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    caveat:
      'A web page has no pin, so the browser version ramps the cutoff on a schedule instead of reading a knob. rampParam is the browser end of the same smoothing argument.',
    cpp: `#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/engines/va.h"

static const int kPotPin = A0;

static bellows::Rng rng;
static bellows::Va voice;
static bellows::Va::Params params;
static bellows::Smoother cutoff;

/* Written by loop(), read by render(). The audio callback is an
 * interrupt, so a plain float shared with the main program is the one
 * thing that has to be volatile here. */
static volatile float target_hz = 200.0f;

void setup() {
  rng.Init("pot");
  params.shape = 0.2f;
  params.cutoff = 200.0f;
  params.resonance = 0.55f;
  params.sustain = 0.9f;
  voice.Init(kSampleRate, &rng, params);

  /* 25 ms to settle: slow enough to swallow the ADC's noise, fast
   * enough that the knob still feels connected to the sound. */
  cutoff.Init(kSampleRate, 0.025f);
  cutoff.Snap(200.0f);

  voice.NoteOn(110.0f, 0.8f);   /* a drone, so there is something to filter */
}

void render(float* l, float* r, int from, int to) {
  /* Run the smoother at the sample rate, because its coefficient was
   * computed from the sample rate, and take where it ended. Cutoff is
   * set once per block: at 128 frames that is 375 updates a second,
   * far finer than a hand turns a knob. */
  cutoff.SetTarget(target_hz);
  float hz = cutoff.Value();
  for (int i = from; i < to; ++i) hz = cutoff.Process();

  params.cutoff = hz;
  voice.SetParams(params);
  voice.Process(l, r, from, to);
}

void loop() {
  /* A 10-bit ADC reads 0..1023 and the bottom bit or two never sit
   * still, so the raw number hops between neighbours on every read.
   * Feed that straight to cutoff and you hear the hops as zipper noise,
   * because each one is a step change in a filter coefficient. The
   * smoother turns each step into a 25 ms glide. */
  const int raw = analogRead(kPotPin);

  /* Map exponentially: cutoff is heard in octaves, so a linear pot on a
   * linear range spends most of its travel above 10 kHz doing nothing.
   * 100 Hz at the bottom, six octaves up at the top. */
  target_hz = 100.0f * bellows::fm::Exp2(static_cast<float>(raw) * (6.0f / 1023.0f));
}`,
    code: `var voice = b.voice('va', { shape: 0.2, cutoff: 200, resonance: 0.55, sustain: 0.9 });
var id = voice.on({ hz: 110 }, 0.8);

// no knob here, so the sweep is scheduled. rampParam glides the value
// instead of stepping it, which is the browser end of the same argument
// the Smoother makes on the board: a step in a filter coefficient is
// audible, a glide is not
var t0 = b.now() + 0.2;
voice.rampParam('cutoff', 6400, { seconds: 3 }, t0);        // 100 Hz up six octaves
voice.rampParam('cutoff', 120, { seconds: 3 }, t0 + 3.2);   // and back down

voice.off(id, t0 + 6.4);
log('cutoff up six octaves and back, glided rather than stepped');
log('on a board this number comes from analogRead on A0');
log('exponential mapping: a linear pot on a linear range is all top end');`,
  },

  {
    id: 'ctl-button',
    title: 'A BUTTON TRIGGER',
    category: 'CONTROL + POLYPHONY',
    description:
      'One button to ground, one drum. INPUT_PULLUP ties the pin high through an internal resistor, so the button needs one wire and no external parts, and the press is the falling edge rather than the rising one. Two details do the work: contacts bounce for a few milliseconds and would otherwise read as five presses, so an edge within 20 ms of the last one is ignored; and loop() sets a flag rather than calling NoteOn, so the trigger is consumed at the top of the next audio block instead of landing in the middle of one.',
    seed: 'ctl-button',
    needs: ['bellows/engines/drums.h'],
    parityRow: 'kick',
    parityRelRms: 9.79e-5,
    caveat: 'The browser has no pin, so the kick is fired by the clock instead of by a press.',
    cpp: `#include "bellows/engines/drums.h"

static const int kButtonPin = 2;

static bellows::Kick kick;

/* loop() sets it, render() consumes it. One bool, one writer, one
 * reader: the audio interrupt can land between any two lines of loop()
 * and the worst that happens is the hit waits for the next block. */
static volatile bool pending = false;

static int last_state = HIGH;
static unsigned long last_edge = 0;

void setup() {
  /* INPUT_PULLUP ties the pin to 3.3 V through an internal resistor, so
   * the pin idles HIGH and the button only has to short it to ground.
   * That is one wire and no external resistor, and it means the press
   * is the falling edge, not the rising one. */
  pinMode(kButtonPin, INPUT_PULLUP);

  bellows::Kick::Params p;
  p.decay = 0.5f;
  p.drive = 3.0f;
  kick.Init(kSampleRate, p);
}

void render(float* l, float* r, int from, int to) {
  if (pending) {
    pending = false;
    kick.NoteOn(50.0f, 0.95f);
  }
  kick.Process(l, r, from, to);
}

void loop() {
  const int state = digitalRead(kButtonPin);

  /* A switch's contacts bounce for a few milliseconds, which reads as
   * five or ten presses. Ignore any edge within 20 ms of the last one:
   * a finger cannot press twice that fast, and a contact cannot bounce
   * that slowly. */
  if (state != last_state && millis() - last_edge >= 20) {
    last_edge = millis();
    last_state = state;
    if (state == LOW) pending = true;
  }
}`,
    code: `var kick = b.voice('kick', { decay: 0.5, drive: 3 });

b.bpm(96);

// stands in for the button: on a board this fires on the falling edge of
// a pin held high by INPUT_PULLUP
var off = b.clock.at('4n', function (t, step) {
  kick.note({ hz: 50 }, { at: t, vel: step % 4 === 0 ? 0.95 : 0.7 });
});
onCleanup(off);

b.start();
log('a kick per beat, accented on the bar');
log('on a board the trigger is a flag set in loop and read in render,');
log('so a hit lands at the top of a block instead of inside one');`,
  },

  {
    id: 'ctl-midi',
    title: 'MIDI NOTE IN',
    category: 'CONTROL + POLYPHONY',
    description:
      'USB MIDI into eight virtual-analog voices. The parser takes raw bytes and knows nothing about USB, DIN or serial, because bytes are the only form every transport agrees on, which is also what lets it be tested on a host. Parse returns false for clock, sysex and truncated messages and leaves the struct untouched rather than handing back a plausible wrong note, and it reports a note-on with velocity zero as a note-off, which is how most controllers release a key. The MIDI note number doubles as the pool note id, so NoteOff finds the right voice by scanning eight slots and needs no map.',
    seed: 'ctl-midi',
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/va.h',
      'bellows/io/midi_parse.h',
      'bellows/voicepool.h',
    ],
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    caveat:
      'Web MIDI needs a device and a permission prompt, so the browser version plays a fixed list of note numbers through the same engine instead of listening.',
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/io/midi_parse.h"
#include "bellows/voicepool.h"

static constexpr int kPoly = 8;

static bellows::Rng rng;
static bellows::VoicePool<bellows::Va, kPoly> pool;
static uint32_t frame = 0;

void setup() {
  rng.Init("midi");

  bellows::Va::Params p;
  p.shape = 0.2f;
  p.cutoff = 4200.0f;
  p.env_amount = 0.45f;
  p.vel_level = 0.7f;    /* velocity to loudness */
  p.vel_filter = 0.4f;   /* and to brightness, which is what sells it */
  for (int i = 0; i < kPoly; ++i) pool.at(i).Init(kSampleRate, &rng, p);
}

void render(float* l, float* r, int from, int to) {
  pool.Process(l, r, from, to);
  frame += static_cast<uint32_t>(to - from);
}

void loop() {
  while (usbMIDI.read()) {
    /* The parser takes raw bytes, because that is the only form every
     * transport agrees on. Teensy hands back a type and a 1-based
     * channel, so put the status byte back together. */
    const uint8_t bytes[3] = {
        static_cast<uint8_t>(usbMIDI.getType() | (usbMIDI.getChannel() - 1)),
        usbMIDI.getData1(),
        usbMIDI.getData2(),
    };

    bellows::midi::MidiMessage m;
    /* False for clock, sysex and anything truncated, and it leaves the
     * struct untouched rather than handing back a plausible wrong note. */
    if (!bellows::midi::Parse(bytes, 3, &m)) continue;

    /* Note-on with velocity 0 is a note-off. Parse already reports it as
     * kNoteOff, so there is no special case to forget here. */
    if (m.kind == bellows::midi::Kind::kNoteOn) {
      /* The note number doubles as the note id, so NoteOff finds the
       * voice holding it by scanning eight slots. */
      pool.NoteOn(m.data1, bellows::midi::NoteToHz(m.data1), m.Norm(), frame);
    } else if (m.kind == bellows::midi::Kind::kNoteOff) {
      pool.NoteOff(m.data1);
    }
  }
}`,
    code: `var synth = b.voice('va',
  { shape: 0.2, cutoff: 4200, envAmount: 0.45, velLevel: 0.7, velFilter: 0.4 },
  { polyphony: 8 });

// midi note numbers, the same integers the parser hands back from data1
var notes = [48, 55, 60, 64, 67, 72, 67, 64];
var t = b.now() + 0.1;

for (var i = 0; i < notes.length; i++) {
  // a plain number is a midi note, so it goes through the tuning layer
  synth.note(notes[i], { at: t + i * 0.35, dur: '4n', vel: 0.4 + (i % 4) * 0.2 });
}

// and a held chord on top, the way a keyboard sends it
var ids = [52, 59, 64].map(function (n) { return synth.on(n, 0.7, t + 3.0); });
ids.forEach(function (id) { synth.off(id, t + 5.0); });

log('eight notes then a held chord, velocity to loudness and brightness');
log('on a board these numbers come from usbMIDI, parsed from three bytes');
log('velocity 0 note-on is a note-off: the parser reports it that way');`,
  },

  {
    id: 'ctl-cpu-load',
    title: 'PRINT CPU LOAD',
    category: 'CONTROL + POLYPHONY',
    description:
      'Six voices and a plate reverb, with the load printed once a second. AudioProcessorUsageMax is the percentage of one audio block\'s budget used by the worst block since the last reset, and it is the number that tells you whether a patch fits in time. The average is the wrong number to watch: it can sit at 40 percent while one block in a thousand runs over, and every one of those is a click. Reset it after each print so the next reading describes the last second rather than the whole run, then raise kPoly until the print stops being comfortable.',
    seed: 'ctl-cpu',
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/va.h',
      'bellows/fx/plate.h',
      'bellows/voicepool.h',
    ],
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    caveat:
      'There is no browser equivalent of the number. The worklet runs on a thread the page cannot time, so the code below plays the patch and nothing more.',
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/fx/plate.h"
#include "bellows/voicepool.h"

/* Raise this until the printed number stops being comfortable. That is
 * the whole experiment. */
static constexpr int kPoly = 6;

static bellows::Rng rng;
static bellows::VoicePool<bellows::Va, kPoly> pool;
static bellows::Plate<> reverb;
static uint32_t frame = 0;

static const float kChord[kPoly] = {110.0f, 164.8f, 220.0f,
                                    261.6f, 329.6f, 392.0f};

void setup() {
  Serial.begin(115200);
  rng.Init("cpu");

  bellows::Va::Params p;
  p.shape = 0.4f;
  p.detune = 9.0f;
  p.cutoff = 2400.0f;
  p.resonance = 0.4f;
  p.sustain = 0.7f;
  for (int i = 0; i < kPoly; ++i) pool.at(i).Init(kSampleRate, &rng, p);

  bellows::Plate<>::Params rp;
  rp.decay = 0.7f;
  rp.mix = 0.3f;
  reverb.Init(kSampleRate, rp);

  /* Hold a chord so the load is steady and the number means something. */
  for (int i = 0; i < kPoly; ++i) pool.NoteOn(i, kChord[i], 0.5f, 0);
}

void render(float* l, float* r, int from, int to) {
  pool.Process(l, r, from, to);
  reverb.Process(l, r, from, to);   /* effects process in place */
  frame += static_cast<uint32_t>(to - from);
}

void loop() {
  /* Percent of one audio block's budget. AudioProcessorUsageMax is the
   * worst block since the last reset, which is the number that decides
   * whether the patch fits: the average can sit at 40 percent while one
   * block in a thousand runs over and clicks. Reset it each time so the
   * next reading describes the last second, not the boot. */
  Serial.print("cpu max ");
  Serial.print(AudioProcessorUsageMax(), 1);
  Serial.print("%  voices ");
  Serial.println(pool.ActiveCount());
  AudioProcessorUsageMaxReset();
  delay(1000);
}`,
    code: `var synth = b.voice('va',
  { shape: 0.4, detune: 9, cutoff: 2400, resonance: 0.4, sustain: 0.7 },
  { polyphony: 6 });

var verb = b.bus([['plate', { decay: 0.7, mix: 1 }]], { level: 0.5 });
synth.send(verb, 0.3);

// the same held chord the board holds, so the load is steady
var chord = [110, 164.8, 220, 261.6, 329.6, 392];
var t = b.now() + 0.1;
var ids = chord.map(function (hz) { return synth.on({ hz: hz }, 0.5, t); });
ids.forEach(function (id) { synth.off(id, t + 6); });

log('six voices through a plate: the patch the board is measuring');
log('a board prints AudioProcessorUsageMax, the worst block since reset');
log('the worst block is what matters: one block over budget is one click');`,
  },
];
