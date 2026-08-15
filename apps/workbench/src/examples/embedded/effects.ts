/*
 * Effects and mixing on a microcontroller.
 *
 * Every effect here is the same DSP as the browser library, and the
 * interesting difference is never the algorithm: it is memory. A delay is
 * its buffer, a plate is thirteen buffers, and both are template
 * parameters so the sketch pays for the range it asked for. The last
 * example is the one thing the embedded library does not give you at all,
 * a mixer, and what you write instead.
 */

import type { EmbeddedExample } from './types';

export const fxExamples: EmbeddedExample[] = [
  {
    id: 'fx-delay',
    title: 'DELAY IS RAM',
    category: 'EFFECTS + MIXING',
    description:
      'A ping-pong delay across a plucked line: 300 ms left, 400 ms right, each side feeding the other. StereoDelay takes its maximum delay in milliseconds as a template parameter, so the ring is sized at compile time and lives in .bss. The number worth knowing is the arithmetic: seconds times sample rate times 4 bytes times 2 channels, which makes 400 ms at 48 kHz about 150 KB and 2 seconds about 768 KB.',
    seed: 'delay-ram',
    code: `var pluck = b.voice('pluck', { decay: 1.6, damp: 0.3 });
pluck.fx(['delay', {
  timeL: 0.3, timeR: 0.4,
  feedback: 0.45, crossFeedback: 0.6,   // ping pong
  damping: 6000,                        // repeats darken
  mix: 0.35,
}]);

b.bpm(120);
var notes = ['A3', 'C4', 'E4', 'G4'];

var off = b.clock.at('4n', function (t, step) {
  pluck.note(notes[step % 4], { at: t, dur: '8n', vel: 0.85 });
});
onCleanup(off);
b.start();

log('one note every 500 ms, repeats crossing between the channels');
log('the browser ring is always 4 seconds; the C++ one is 400 ms');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"
#include "bellows/fx/delay.h"

/* StereoDelay<max ms, rate>. The ring is (400 * 48000) / 1000 + 4 =
 * 19204 floats per side, so the object is 153768 bytes: seconds times
 * rate times 4 bytes times 2 channels, and nothing else. Ask for 2000
 * instead of 400 and it is 768 KB, which does not fit in the fast RAM of
 * a Teensy 4.1. The browser library has no such dial: it hardcodes a 4
 * second maximum and pays 2 MB for it whatever time you set. */
using Delay = bellows::StereoDelay<400, 48000>;

static bellows::Rng rng;
static bellows::Pluck<110> pluck;
static Delay pingpong;  /* not "delay": Arduino already has one */

/* A4, C5, E5, G5, one every half second. */
static const float kNotes[4] = {220.0f, 261.63f, 329.63f, 392.0f};
static int step = 0;
static int countdown = 0;
static int samples_per_step = 24000;

void setup() {
  rng.Init("delay-ram");
  pluck.Init(kSampleRate, &rng);

  Delay::Params p;
  p.time_l = 0.3f;
  p.time_r = 0.4f;
  p.feedback = 0.45f;
  p.cross_feedback = 0.6f;  /* each side feeds the other: ping pong */
  p.damping = 6000.0f;      /* one pole inside the loop, so repeats darken */
  p.mix = 0.35f;
  pingpong.Init(kSampleRate, p);

  samples_per_step = static_cast<int>(kSampleRate * 0.5f);
}

void render(float* l, float* r, int from, int to) {
  /* Trigger at the block boundary rather than splitting the block, which
   * is up to 2.7 ms of jitter at 128 samples. Split it the way the
   * DrumMachine example does when that matters. */
  countdown -= to - from;
  if (countdown <= 0) {
    countdown += samples_per_step;
    pluck.NoteOn(kNotes[step & 3], 0.85f);
    ++step;
  }

  pluck.Process(l, r, from, to);  /* voices ADD into the block */
  pingpong.Process(l, r, from, to);  /* effects process it in place */
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/pluck.h', 'bellows/fx/delay.h'],
    parityRow: 'delay',
    parityRelRms: 9.54e-8,
    caveat:
      'Same filter, different ring. The C++ holds 400 ms because the template asked for it; the browser delay always allocates its 4 second maximum, 2 MB. Nothing about the sound changes, only what the buffer costs.',
  },
  {
    id: 'fx-plate',
    title: 'PLATE REVERB',
    category: 'EFFECTS + MIXING',
    description:
      "A struck bar into a Dattorro plate: predelay, a bandwidth filter, four input diffusers, then a figure-eight tank of allpasses and delays. All thirteen lengths are quoted at the paper's 29761 Hz and scaled to the real rate in Init. At 48 kHz with a 50 ms predelay ceiling the store is 38807 floats, about 152 KB, which is why the predelay maximum is a template parameter: raising it to the 250 ms default adds 37 KB on its own.",
    seed: 'plate',
    code: `var bar = b.voice('modal', { material: 1, decay: 2.5, brightness: 0.6 });
bar.fx(['plate', {
  decay: 0.72,      // tank feedback, capped at 0.98
  damping: 0.35,    // one pole in each branch
  predelay: 0.02,   // 20 ms before the tank hears anything
  modDepth: 1,
  mix: 0.4,
}]);

b.bpm(84);
var notes = ['D4', 'A4', 'F4', 'C5'];

var off = b.clock.at('2n', function (t, step) {
  bar.note(notes[step % 4], { at: t, dur: '2n', vel: 0.8 });
});
onCleanup(off);
b.start();

log('20 ms of predelay, then a tank that takes a few seconds to die');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/modal.h"
#include "bellows/fx/plate.h"

/* Plate<rate, max predelay ms>. The carve at 48 kHz with a 50 ms ceiling
 * is 38807 floats and the object is 155856 bytes; the default 250 ms
 * ceiling makes that 194256, because the predelay line alone is one
 * float per sample of ceiling. Each of the thirteen elements is sized to
 * exactly what it reads plus four samples of slack for the cubic reader.
 * Rounding those lengths up to a power of two, which is the usual trick,
 * cost 264 KB instead: they are odd and mutually prime by design, which
 * is the worst case for it. */
using Plate = bellows::Plate<48000, 50>;

static bellows::Rng rng;
static bellows::Modal bar;
static Plate plate;

static const float kNotes[4] = {293.66f, 440.0f, 349.23f, 523.25f};
static int step = 0;
static int countdown = 0;
static int samples_per_step = 34285;

void setup() {
  rng.Init("plate");

  bellows::Modal::Params m;
  m.material = 1.0f;
  m.decay = 2.5f;
  m.brightness = 0.6f;
  bar.Init(kSampleRate, &rng, m);

  Plate::Params p;
  p.decay = 0.72f;
  p.damping = 0.35f;
  p.predelay = 0.02f;  /* clamped to the 50 ms the template allows */
  p.mod_depth = 1.0f;
  p.mix = 0.4f;
  /* Init carves the buffer and returns false if it is too short. Plate
   * sizes its own store so it cannot fail here, but PlateExt over a
   * caller-placed buffer (EXTMEM, SDRAM) can, and then Process is a
   * no-op rather than a fault. Check it either way. */
  if (!plate.Init(kSampleRate, p)) Serial.println("plate: store too short");

  samples_per_step = static_cast<int>(kSampleRate * 1.43f);
}

void render(float* l, float* r, int from, int to) {
  countdown -= to - from;
  if (countdown <= 0) {
    countdown += samples_per_step;
    bar.NoteOn(kNotes[step & 3], 0.8f);
    ++step;
  }

  bar.Process(l, r, from, to);
  plate.Process(l, r, from, to);
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/modal.h', 'bellows/fx/plate.h'],
    parityRow: 'plate',
    parityRelRms: 1.34e-5,
    caveat:
      'The predelay ceiling differs: 50 ms here against a fixed 250 ms in the browser. Both run 20 ms of predelay, so the tanks are identical, but ask the C++ for 100 ms and it clamps where the browser would not.',
  },
  {
    id: 'fx-chorus',
    title: 'CHORUS',
    category: 'EFFECTS + MIXING',
    description:
      'Three modulated delay taps per channel, centred at 10, 17.5 and 25 ms, averaged. Each tap has its own sine LFO, the taps sit a third of a cycle apart, and the right channel runs a quarter cycle ahead of the left for width. The LFO phase is a uint32 counter rather than a float accumulator, and that is measured rather than tidiness: a float accumulator loses part of every increment as it nears 1.0, always in the same direction, and it was the entire chorus parity gap at 4e-2 against 6.3e-6 with the modulation switched off.',
    seed: 'chorus',
    code: `var pad = b.voice('va', {
  shape: 0, detune: 9, cutoff: 2400,
  attack: 0.05, sustain: 1,
});
pad.gain(0.6);
pad.fx(['chorus', { rate: 0.4, depth: 0.6, mix: 0.5, feedback: 0.2 }]);

var id = pad.on('D3', 0.7);
onCleanup(function () { pad.off(id); });

log('one held saw through three swept taps per channel');
log('the sweep is a fixed point phase counter, not a float accumulator');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/fx/modfx.h"

/* Chorus<rate>. The taps sit inside a 5 to 30 ms window with 5 ms of
 * sweep each way, which sets the line at 31 ms: 1488 samples a side at
 * 48 kHz, 12272 bytes for the object. Small enough that the three LFOs
 * per channel are a real part of the cost.
 *
 * Those LFOs accumulate phase in a uint32 counter. A float accumulator
 * rounds off part of every increment as it approaches 1.0, systematically
 * rather than randomly, so the error grows with the length of the note;
 * the TypeScript accumulates in double, where the same rounding is about
 * 2^29 times smaller. Measured, that was the whole of the chorus parity
 * gap. The wrap is unsigned overflow, so the counter needs no compare. */
using Chorus = bellows::Chorus<48000>;

static bellows::Rng rng;
static bellows::Va pad;
static Chorus chorus;

void setup() {
  rng.Init("chorus");

  bellows::Va::Params v;
  v.shape = 0.0f;     /* saw */
  v.detune = 9.0f;    /* cents between the two oscillators */
  v.cutoff = 2400.0f;
  v.attack = 0.05f;
  v.sustain = 1.0f;
  pad.Init(kSampleRate, &rng, v);

  Chorus::Params c;
  c.rate = 0.4f;
  c.depth = 0.6f;
  c.mix = 0.5f;
  c.feedback = 0.2f;  /* clamped at 0.5 */
  chorus.Init(kSampleRate, c);

  pad.NoteOn(146.83f, 0.7f);  /* D3, held, no NoteOff */
}

void render(float* l, float* r, int from, int to) {
  pad.Process(l, r, from, to);
  chorus.Process(l, r, from, to);
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/va.h', 'bellows/fx/modfx.h'],
    parityRow: 'chorus',
    parityRelRms: 2.02e-4,
    caveat: null,
  },
  {
    id: 'fx-eq',
    title: 'THREE BAND EQ',
    category: 'EFFECTS + MIXING',
    description:
      'A drum kit through Eq3: a low shelf, one bell, a high shelf, each a stereo pair of state variable filters. A band whose gain is exactly 0 dB is skipped, and the shelf and bell modes are exact identities at 0 dB, so bypass is bit transparent. The whole object is 360 bytes, which is why a pedal usually wants this rather than the six band Eq6 the browser runs.',
    seed: 'eq3',
    code: `// the browser eq is six bands. Move three of them to the Eq3
// frequencies and leave the other three at 0 dB, where they bypass.
b.masterFx(['eq', {
  b0freq: 90, b0gain: 5, b0q: 0.7071,      // low shelf
  b3freq: 450, b3gain: -4, b3q: 0.9,       // bell, scooping the box
  b5freq: 7000, b5gain: 3, b5q: 0.7071,    // high shelf
}]);

var kick = b.voice('kick', { decay: 0.4 });
var snare = b.voice('snare', { decay: 0.16 });
var hat = b.voice('hat', { decay: 0.05 });
hat.gain(0.5);

b.bpm(96);
var off = b.clock.at('16n', function (t, step) {
  var s = step % 16;
  if (s === 0 || s === 6 || s === 10) kick.note('C2', { at: t, vel: 0.95 });
  if (s === 4 || s === 12) snare.note('D3', { at: t, vel: 0.8 });
  if (s % 2 === 0) hat.note('F#4', { at: t, vel: s % 4 === 0 ? 0.6 : 0.35 });
});
onCleanup(off);
b.start();

log('+5 dB under 90 Hz, -4 dB at 450 Hz, +3 dB over 7 kHz');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"
#include "bellows/fx/eq.h"

/* Eq3 is 360 bytes: three EqBands, each a stereo pair of Svfs, and no
 * buffers at all, so it is the same size at every sample rate. Eq6 next
 * to it is 720 and is the faithful port of the browser eq. Set a band's
 * gain to exactly 0 dB and it is skipped, and re-enabling one clears its
 * filter state so stale integrator energy cannot click in. */
static bellows::Rng rng;
static bellows::Kick kick;
static bellows::Snare snare;
static bellows::Hat hat;
static bellows::Eq3 eq;

/* Sixteenths at 96 bpm. The pattern is a bitmask per pad, one bit per
 * step, which is what Euclid stores too. */
static const unsigned kKickMask = 0x0441u;   /* steps 0, 6, 10 */
static const unsigned kSnareMask = 0x1010u;  /* steps 4, 12 */
static int step = 0;
static int countdown = 0;
static int samples_per_step = 7500;

void setup() {
  rng.Init("eq3");
  kick.Init(kSampleRate);
  snare.Init(kSampleRate, &rng);
  hat.Init(kSampleRate);

  bellows::Eq3::Params e;
  e.low_freq = 90.0f;
  e.low_gain = 5.0f;     /* shelf under the kick */
  e.mid_freq = 450.0f;
  e.mid_gain = -4.0f;    /* bell, scooping the box out of the snare */
  e.mid_q = 0.9f;
  e.high_freq = 7000.0f;
  e.high_gain = 3.0f;    /* shelf for the hat */
  eq.Init(kSampleRate, e);

  samples_per_step = static_cast<int>(kSampleRate * 0.15625f);
}

void render(float* l, float* r, int from, int to) {
  countdown -= to - from;
  if (countdown <= 0) {
    countdown += samples_per_step;
    const int s = step & 15;
    if (kKickMask & (1u << s)) kick.NoteOn(50.0f, 0.95f);
    if (kSnareMask & (1u << s)) snare.NoteOn(190.0f, 0.8f);
    if ((s & 1) == 0) hat.NoteOn(370.0f, (s & 3) == 0 ? 0.6f : 0.35f);
    ++step;
  }

  kick.Process(l, r, from, to);
  snare.Process(l, r, from, to);
  hat.Process(l, r, from, to);
  eq.Process(l, r, from, to);
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/drums.h', 'bellows/fx/eq.h'],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'Eq3 is a deliberate reduction, not a port, so nothing measures it against the browser. What is above sets the six band eq to the same three curves and leaves the rest at 0 dB, where they bypass, so the two lines up by construction rather than by measurement. Eq6 is the row that is checked.',
  },
  {
    id: 'fx-limiter',
    title: 'LIMITER ON THE MASTER',
    category: 'EFFECTS + MIXING',
    description:
      'Four detuned voices adding into one block, then a brickwall limiter with a fixed 5 ms lookahead. Per sample the required reduction feeds a sliding maximum over the lookahead window and that maximum is box averaged over the same length, so the output never crosses the ceiling and the attack is a ramp rather than a step. An MCU wants this because voices ADD, the codec conversion clamps hard at full scale, and there is no meter and nobody in the room. Measured on this exact chord: peak 1.65 without the limiter, 0.9661 with it, which is the -0.3 dBFS ceiling to four figures.',
    seed: 'ceiling',
    code: `b.masterFx(['limiter', { ceiling: -0.3, release: 0.05 }]);

var synth = b.voice('va', { shape: 0, detune: 8, cutoff: 3000, sustain: 1, attack: 0.01 });
synth.gain(1);

// four voices at once, each loud enough on its own
var ids = ['A2', 'E3', 'A3', 'C#4'].map(function (n) { return synth.on(n, 0.9); });
onCleanup(function () { ids.forEach(function (id) { synth.off(id); }); });

log('four voices summing well past 1.0, held under -0.3 dBFS');
log('lookahead is 5 ms, so the master is 240 samples late. that is fine');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/fx/dynamics.h"

/* Limiter<rate>. The 5 ms lookahead is 240 samples at 48 kHz, and the
 * whole unit, two delay lines plus the sliding maximum deque plus the box
 * average ring, is 4952 bytes. True peak detection is a template
 * parameter and off here: it adds two 4x oversamplers, about 6 KB of
 * scratch, and a runtime flag would force the linker to keep them.
 *
 * Why the master of an MCU sketch wants one. Voices ADD into the block,
 * so four notes is four times the level of one, and the sketch has no
 * fader, no meter and nobody watching. The codec conversion clamps at
 * full scale, so everything over 1.0 is hard clipped, which is the
 * loudest and ugliest failure the board has. The chord below peaks at
 * 1.65 on its own and at 0.9661 through this, which is the -0.3 dBFS
 * ceiling. 5 KB and 5 ms of latency buys that instead of guessing at
 * gain staging. */
using Limiter = bellows::Limiter<48000>;

static bellows::Rng rng;
static bellows::Va voice[4];
static Limiter limiter;

/* A2, E3, A3, C#4. */
static const float kChord[4] = {110.0f, 164.81f, 220.0f, 277.18f};

void setup() {
  rng.Init("ceiling");

  bellows::Va::Params v;
  v.shape = 0.0f;
  v.detune = 8.0f;
  v.cutoff = 3000.0f;
  v.attack = 0.01f;
  v.sustain = 1.0f;
  for (int i = 0; i < 4; ++i) {
    voice[i].Init(kSampleRate, &rng, v);
    voice[i].NoteOn(kChord[i], 0.9f);
  }

  Limiter::Params p;
  p.ceiling_db = -0.3f;
  p.release = 0.05f;
  limiter.Init(kSampleRate, p);
}

void render(float* l, float* r, int from, int to) {
  for (int i = 0; i < 4; ++i) voice[i].Process(l, r, from, to);
  limiter.Process(l, r, from, to);  /* last thing before the codec */
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/va.h', 'bellows/fx/dynamics.h'],
    parityRow: 'limiter',
    parityRelRms: 1.14e-6,
    caveat: null,
  },
  {
    id: 'fx-send-bus',
    title: 'A SEND BUS BY HAND',
    category: 'EFFECTS + MIXING',
    description:
      'There is no mixer in the embedded library, on purpose: a mixer is a graph, a graph is allocation and indirection, and both are things this port refuses. A send is four lines of arithmetic instead. The one rule is that a voice advances its envelope when it renders, so you cannot render it twice: render the part ONCE into a scratch buffer, add that buffer to the dry mix, add a scaled copy to the send, and run the effect over the send at mix 1.',
    seed: 'sendbus',
    code: `// b.bus is this same graph, built by the library instead of by hand:
// a wet-only chain, and a per-instrument send level into it
var verb = b.bus([['plate', { decay: 0.75, damping: 0.4, mix: 1 }]], { level: 1 });

var kick = b.voice('kick', { decay: 0.4 });
var pluck = b.voice('pluck', { decay: 1.4, damp: 0.3 });

kick.send(verb, 0);       // dry, no send
pluck.send(verb, 0.45);   // dry plus 45 percent into the plate

b.bpm(100);
var notes = ['A3', 'E4', 'C4', 'G4'];

var off = b.clock.at('8n', function (t, step) {
  if (step % 4 === 0) kick.note('C2', { at: t, vel: 0.95 });
  if (step % 2 === 1) pluck.note(notes[(step >> 1) % 4], { at: t, dur: '8n', vel: 0.8 });
});
onCleanup(off);
b.start();

log('kick dry, pluck dry plus a 0.45 send into a wet-only plate');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/pluck.h"
#include "bellows/fx/plate.h"

/* A send bus, written out. Two scratch buffers one block long: one for
 * the part being fanned out, one for what the effect receives.
 *
 * The rule that makes this shape necessary: a voice advances its
 * envelopes and its oscillator phase when it renders, so rendering it
 * twice, once dry and once into the send, plays it at double speed and
 * the two copies do not even match. Render ONCE, then fan the samples
 * out with adds, which is free.
 *
 * The return runs at mix 1, all wet, because the dry path is already in
 * the mix. That is the same reason a bus chain in the browser sets mix
 * to 1 and lets the send level do the blending. */
using Plate = bellows::Plate<48000, 50>;

static constexpr int kMaxBlock = 128;
static float part_l[kMaxBlock], part_r[kMaxBlock];
static float send_l[kMaxBlock], send_r[kMaxBlock];

static bellows::Rng rng;
static bellows::Kick kick;
static bellows::Pluck<110> pluck;
static Plate verb;

/* How much of the pluck reaches the plate. The kick has no send. */
static const float kSendLevel = 0.45f;

static const float kNotes[4] = {220.0f, 329.63f, 261.63f, 392.0f};
static int step = 0;
static int countdown = 0;
static int samples_per_step = 14400;

void setup() {
  rng.Init("sendbus");
  kick.Init(kSampleRate);
  pluck.Init(kSampleRate, &rng);

  Plate::Params p;
  p.decay = 0.75f;
  p.damping = 0.4f;
  p.mix = 1.0f;  /* a return is all wet */
  if (!verb.Init(kSampleRate, p)) Serial.println("plate: store too short");

  samples_per_step = static_cast<int>(kSampleRate * 0.3f);
}

void render(float* l, float* r, int from, int to) {
  if (to > kMaxBlock) return;  /* the scratch is one block long */

  countdown -= to - from;
  if (countdown <= 0) {
    countdown += samples_per_step;
    if ((step & 3) == 0) kick.NoteOn(50.0f, 0.95f);
    if ((step & 1) == 1) pluck.NoteOn(kNotes[(step >> 1) & 3], 0.8f);
    ++step;
  }

  /* Voices add, so the caller clears every buffer it owns. */
  for (int i = from; i < to; ++i) {
    part_l[i] = 0.0f;
    part_r[i] = 0.0f;
    send_l[i] = 0.0f;
    send_r[i] = 0.0f;
  }

  kick.Process(l, r, from, to);            /* straight into the mix */
  pluck.Process(part_l, part_r, from, to); /* ONCE, into scratch */

  for (int i = from; i < to; ++i) {
    l[i] += part_l[i];                     /* the dry path */
    r[i] += part_r[i];
    send_l[i] += kSendLevel * part_l[i];    /* and the send */
    send_r[i] += kSendLevel * part_r[i];
  }

  verb.Process(send_l, send_r, from, to);  /* the return, mix 1 */

  for (int i = from; i < to; ++i) {
    l[i] += send_l[i];
    r[i] += send_r[i];
  }
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/drums.h',
      'bellows/engines/pluck.h',
      'bellows/fx/plate.h',
    ],
    parityRow: 'plate',
    parityRelRms: 1.34e-5,
    caveat:
      'The effect on the send is the measured one; the routing is not measured at all, because the browser builds it for you. b.bus plus send() is this same wiring, with the library owning the scratch buffers and the summing.',
  },
];
