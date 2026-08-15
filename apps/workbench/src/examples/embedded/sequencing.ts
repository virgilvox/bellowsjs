/*
 * Sequencing on the board: euclidean rhythms, a step sequencer, an
 * arpeggiator, a markov chain, an L-system and a cellular automaton.
 *
 * This is the half of the library that has no equivalent in DaisySP or
 * Mozzi. It is also the half that costs almost nothing: Euclid<16> is a
 * bitmask and a cursor, ElementaryCa<16> is sixteen bytes, and none of it
 * allocates. Every example counts samples down to the next step inside
 * render and cuts the block at the boundary, which is the same thing the
 * browser kernel does for you.
 */

import type { EmbeddedExample } from './types';

export const seqExamples: EmbeddedExample[] = [
  {
    id: 'seq-euclid',
    title: 'EUCLIDEAN RHYTHM',
    category: 'SEQUENCING',
    description:
      'Euclid builds E(3, 8): three pulses spread as evenly as eight steps allow, which is x . . x . . x . , the tresillo. Bjorklund\'s algorithm gives you that from two integers, so a rhythm is a call rather than a table you typed in. The hat plays the plain grid underneath so the displacement is audible. The pattern lives in a bitmask, so a 16 step rhythm is two bytes plus a cursor.',
    seed: 'tresillo',
    code: `var kick = b.voice('kick');
var hat = b.voice('hat', { decay: 0.04 });

b.bpm(104);

// b.euclid takes (steps, pulses): 3 in 8 is the tresillo
var tresillo = b.euclid(8, 3);
log('E(3,8)  ' + tresillo.map(function (g) { return g ? 'x' : '.'; }).join(''));

var off = b.clock.at('8n', function (t, step) {
  // { hz } passes a frequency straight through, as NoteOn does in the C++
  if (tresillo[step % 8]) kick.note({ hz: 50 }, { at: t, vel: 0.95 });
  hat.note({ hz: 320 }, { at: t, vel: 0.3 });
});
onCleanup(off);
b.start();`,
    cpp: `#include "bellows/engines/drums.h"
#include "bellows/seq/euclid.h"

static bellows::Kick kick;
static bellows::Hat hat;

/* The pattern is a bitmask plus a cursor, so this costs 12 bytes. */
static bellows::Euclid<8> tresillo;

static int samples_per_step = 0;
static int countdown = 0;

void setup() {
  kick.Init(kSampleRate);

  bellows::Hat::Params hp;
  hp.decay = 0.04f;
  hat.Init(kSampleRate, hp);

  /* Bjorklund's algorithm spreads 3 pulses over 8 steps as evenly as the
   * grid allows, which puts them on 0, 3 and 6: x . . x . . x .  That is
   * the tresillo, the figure under most of the Caribbean and half of
   * everything else. Same call as b.euclid(8, 3) in the browser, same
   * eight bits out. */
  tresillo.Generate(3, 8);

  /* Eighth notes at 104 bpm. */
  samples_per_step = static_cast<int>(kSampleRate * 60.0f / (104.0f * 2.0f));
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      /* Process() returns the gate under the cursor and advances it. */
      if (tresillo.Process()) kick.NoteOn(50.0f, 0.95f);
      hat.NoteOn(320.0f, 0.3f);  /* the plain grid, so the gaps are audible */
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    kick.Process(l, r, i, i + span);
    hat.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/engines/drums.h', 'bellows/seq/euclid.h'],
    parityRow: 'kick',
    parityRelRms: 9.79e-5,
    caveat: null,
  },
  {
    id: 'seq-step-sequencer',
    title: 'STEP SEQUENCER',
    category: 'SEQUENCING',
    description:
      'Sixteen MIDI notes with -1 for a rest, played by counting samples down to the next step inside render. The block is cut at every step boundary rather than the step being rounded to the nearest block: 128 samples is 2.7 ms at 48 kHz, which is audible jitter on anything percussive. Every other example on this page sequences the same way, and the reload of countdown is what stops the rounding error accumulating.',
    seed: 'stepseq',
    code: `var str = b.voice('pluck');

b.bpm(112);

// sixteen MIDI notes, -1 for a rest
var pattern = [45, -1, 57, 52, 45, -1, 57, 55,
               43, -1, 55, 50, 43, -1, 58, 57];

var off = b.clock.at('16n', function (t, step) {
  var n = pattern[step % 16];
  if (n >= 0) str.note(n, { at: t, vel: 0.85 });
});
onCleanup(off);
b.start();

log('the clock hands you the time of the step; the note lands on the sample');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Pluck<80> str;  /* 80 Hz floor, so the delay line is 4 KB */
static bellows::Tuning<12> tuning;

/* Sixteen steps of MIDI note. -1 is a rest. */
static const int8_t kPattern[16] = {
  45, -1, 57, 52, 45, -1, 57, 55,
  43, -1, 55, 50, 43, -1, 58, 57,
};

static int samples_per_step = 0;
static int countdown = 0;  /* samples left until the next step */
static int step = 0;

void setup() {
  rng.Init("stepseq");
  str.Init(kSampleRate, &rng);
  tuning.InitEdo(12);  /* MIDI to Hz. 12-EDO is the default, not the law */

  /* Sixteenths at 112 bpm. Rounding to whole samples is the only tempo
   * error there is, and it does not accumulate: countdown is reloaded, so
   * a step is never a fraction of a sample late twice. */
  samples_per_step = static_cast<int>(kSampleRate * 60.0f / (112.0f * 4.0f) + 0.5f);
}

void render(float* l, float* r, int from, int to) {
  /* A step boundary almost never lands on a block boundary, so the block
   * is cut at every boundary instead of rounding the step to the block.
   * Fire the step, render up to the next boundary or the end of the
   * block, whichever comes first, and repeat. This is the whole trick,
   * and it is why the note starts on the exact sample rather than up to a
   * block late: 128 samples is 2.7 ms at 48 kHz, which is audible as
   * jitter on a hi-hat. */
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      const int n = kPattern[step];
      if (n >= 0) str.NoteOn(tuning.MidiToFreq(n), 0.85f);
      step = (step + 1) & 15;
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    str.Process(l, r, i, i + span);  /* voices ADD, the caller cleared it */
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/pluck.h', 'bellows/theory/tuning.h'],
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    caveat:
      'The browser does the block splitting for you: b.clock.at schedules ahead and the kernel cuts its own block at the event. The C++ is that loop written out by hand.',
  },
  {
    id: 'seq-arpeggiator',
    title: 'ARPEGGIATOR',
    category: 'SEQUENCING',
    description:
      'Arp holds a chord and hands back one note per call, so the sequencer keeps the timing and the arpeggiator keeps only the order. Cm7 across two octaves runs through four of the six modes, two bars each. updown and downup fold back without repeating their endpoints, so an eight note pool gives a cycle of fourteen. kMaxNotes bounds the expanded pool rather than the chord: Arp<16> at two octaves accepts eight held notes.',
    seed: 'arp-modes',
    code: `var voice = b.voice('va', {
  shape: 1, cutoff: 2600, resonance: 0.3, decay: 0.22, sustain: 0,
});
var dice = b.rng('arp');   // only 'random' draws from it

var chord = [60, 63, 67, 70];              // Cm7
var modes = ['up', 'updown', 'downup', 'random'];
var arp = new lib.Arpeggiator({ mode: 'up', octaves: 2 });
arp.setNotes(chord);

b.bpm(120);

var off = b.clock.at('16n', function (t, step) {
  if (step % 32 === 0) {
    var mode = modes[Math.floor(step / 32) % 4];
    arp = new lib.Arpeggiator({ mode: mode, octaves: 2 });
    arp.setNotes(chord);
    log('mode ' + mode + '  cycle of ' + (mode === 'up' || mode === 'random' ? 8 : 14));
  }
  voice.note(arp.next(dice), { at: t, vel: step % 4 === 0 ? 0.9 : 0.6 });
});
onCleanup(off);
b.start();`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/seq/arp.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Va voice;
static bellows::Tuning<12> tuning;

/* Arp<16> bounds the EXPANDED pool, not the chord: four held notes over
 * two octaves is eight entries, so this could hold a chord of eight. */
static bellows::Arp<16> arp;

static const float kCm7[4] = {60.0f, 63.0f, 67.0f, 70.0f};

/* Four of the six modes, two bars each. kOrder is the fifth and keeps
 * the notes as given; kDown is the sixth. */
static const bellows::ArpMode kModes[4] = {
  bellows::ArpMode::kUp,
  bellows::ArpMode::kUpDown,
  bellows::ArpMode::kDownUp,
  bellows::ArpMode::kRandom,
};

static int samples_per_step = 0;
static int countdown = 0;
static int step = 0;

void setup() {
  rng.Init("arp");

  bellows::Va::Params vp;
  vp.shape = 1.0f;      /* 0 saw, 1 square, 2 triangle, 3 sine */
  vp.cutoff = 2600.0f;
  vp.resonance = 0.3f;
  vp.decay = 0.22f;
  vp.sustain = 0.0f;    /* one shot per step, so no NoteOff is needed */
  voice.Init(kSampleRate, &rng, vp);

  tuning.InitEdo(12);

  bellows::Arp<16>::Params ap;
  ap.mode = bellows::ArpMode::kUp;
  ap.octaves = 2;
  arp.Init(ap);
  arp.SetNotes(kCm7, 4);  /* returns false if notes had to be dropped */

  samples_per_step = static_cast<int>(kSampleRate * 60.0f / (120.0f * 4.0f) + 0.5f);
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      if ((step & 31) == 0) {
        /* SetParams rebuilds the traversal cycle from the notes already
         * held, so the mode changes without re-sending the chord. */
        bellows::Arp<16>::Params ap;
        ap.mode = kModes[(step >> 5) & 3];
        ap.octaves = 2;
        arp.SetParams(ap);
      }
      /* kUpDown and kDownUp never repeat their endpoints, so eight pool
       * notes give a cycle of fourteen. kRandom is the only mode that
       * draws from the rng; the others ignore it. */
      const float midi = arp.Next(rng);
      voice.NoteOn(tuning.MidiToFreq(midi), (step & 3) == 0 ? 0.9f : 0.6f);
      ++step;
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    voice.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/va.h',
      'bellows/seq/arp.h',
      'bellows/theory/tuning.h',
    ],
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    caveat:
      'The three deterministic modes play the same notes on both sides. The random section does not: the browser draws from the page seed forked by name, the sketch from an Rng seeded with the bare label "arp".',
  },
  {
    id: 'seq-markov',
    title: 'MARKOV MELODY',
    category: 'SEQUENCING',
    description:
      'A sixteen note motif is trained into a variable-order chain over scale degrees, then walked. Training records the transition at order 2, order 1 and order 0, so a pair of degrees the motif never held backs off to a shorter context instead of stalling, which for melody is what keeps it playing past the second bar. A state is a byte into an alphabet the chain never interprets: these happen to be degrees of A minor.',
    seed: 'markov-motif',
    code: `var voice = b.voice('fm', {
  ops: 2, algorithm: 1, ratio2: 3, level2: 0.35, decay: 0.45, sustain: 0,
});
var scale = b.scale('A minor');
var dice = b.rng('markov');

// the motif, as scale degrees
var motif = [0, 2, 4, 2, 0, 4, 6, 4, 2, 0, 1, 0, 2, 4, 5, 4];

var chain = new lib.Markov(2);
chain.train(motif);            // counts every transition at orders 2, 1 and 0
chain.seed(motif.slice(0, 2));

b.bpm(96);

var off = b.clock.at('8n', function (t, step) {
  var d = chain.next(dice);
  voice.note({ degree: d, octave: 4 }, { at: t, dur: '8n', vel: 0.8 }, scale);
});
onCleanup(off);
b.start();

log('order 2 with backoff: an unseen pair bends the line, it does not stop it');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/fm.h"
#include "bellows/seq/markov.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Fm voice;
static bellows::Scale scale;
static bellows::Tuning<12> tuning;

/* Seven states (the degrees of a seven-note scale), room for 48 contexts,
 * order 2. A state is an index into whatever alphabet the caller means by
 * it: the chain never learns these are pitches. */
static bellows::Markov<7, 48, 2> chain;

/* The motif, as scale degrees. Train counts every transition in it at
 * order 2, order 1 and order 0. */
static const uint8_t kMotif[16] = {
  0, 2, 4, 2, 0, 4, 6, 4, 2, 0, 1, 0, 2, 4, 5, 4,
};

static int samples_per_step = 0;
static int countdown = 0;

void setup() {
  rng.Init("markov");

  bellows::Fm::Params fp;
  fp.ops = 2.0f;
  fp.algorithm = 1.0f;
  fp.ratio[1] = 3.0f;
  fp.level[1] = 0.35f;
  fp.decay = 0.45f;
  fp.sustain = 0.0f;
  voice.Init(kSampleRate, fp);

  scale.Init(9, bellows::kScaleMinor);  /* A minor */
  tuning.InitEdo(12);

  chain.Init(2);
  chain.Train(kMotif, 16);
  chain.Seed(kMotif, 2);
  /* Check this rather than trusting the capacity: a chain that dropped
   * transitions still plays, it just plays a smaller chain. */
  if (chain.Truncated()) Serial.println("markov: table full, raise kMaxContexts");

  samples_per_step = static_cast<int>(kSampleRate * 60.0f / (96.0f * 2.0f) + 0.5f);
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      uint8_t degree = 0;
      /* Next tries the last two degrees, then the last one, then the
       * order-0 distribution over everything trained, and takes the first
       * order that holds any weight: that backoff is why an unseen pair
       * bends the melody instead of stopping it. */
      if (chain.Next(rng, &degree)) {
        const int midi = scale.DegreeToMidi(static_cast<int>(degree), 4);
        voice.NoteOn(tuning.MidiToFreq(midi), 0.8f);
      }
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    voice.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/fm.h',
      'bellows/seq/markov.h',
      'bellows/theory/scales.h',
      'bellows/theory/tuning.h',
    ],
    parityRow: 'fm',
    parityRelRms: 5.25e-4,
    caveat:
      'Same table, different melody. The browser walks it with the page seed forked by name and the sketch with a bare label, and Rng::Next rounds to float where the browser keeps double, so the same draw can land either side of a weight boundary.',
  },
  {
    id: 'seq-lsystem',
    title: 'L-SYSTEM MELODY',
    category: 'SEQUENCING',
    description:
      'Four rules rewrite every symbol in parallel, seven times, and MapToDegrees turns the result into scale degrees with D as a rest. Growth is explosive, so overflow is the normal case rather than the exception and it is defined: a replacement that does not fit whole stops that generation before writing it, Truncated() latches true, and Result() stays a valid prefix of what the browser would print. Seven generations of this grammar is 93 symbols and fits in 128. Eight would be 168 and would be cut.',
    seed: 'lindenmayer',
    code: `// A grows, B echoes, C turns, D holds. Same four rules as the sketch.
var grammar = { A: 'AB', B: 'CA', C: 'BD', D: 'D' };
var str = lib.lsystem('A', grammar, 7);
log('gen 7: ' + str.length + ' symbols  ' + str.slice(0, 48) + '...');

// D becomes a rest; the browser writes null where the C++ writes kRestDegree
var degrees = lib.mapToDegrees(str, { A: 0, B: 2, C: 4, D: null });

var scale = b.scale('C lydian');
var voice = b.voice('modal');

b.bpm(108);

var off = b.clock.at('8n', function (t, step) {
  var d = degrees[step % degrees.length];
  if (d === null) return;
  voice.note({ degree: d, octave: 4 }, { at: t, vel: 0.75 }, scale);
});
onCleanup(off);
b.start();`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/modal.h"
#include "bellows/seq/lsystem.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Modal voice;
static bellows::Scale scale;
static bellows::Tuning<12> tuning;

/* 128 symbols of headroom, 4 rules. Two buffers of kMaxLen + 1 bytes is
 * the entire cost of growing. */
static bellows::LSystem<128, 4> plant;

/* A -> 0, B -> 2, C -> 4, D -> a rest. */
static const char kSymbols[] = "ABCD";
static const int8_t kDegrees[4] = {0, 2, 4, bellows::kRestDegree};

static int8_t melody[128];
static int melody_len = 0;

static int samples_per_step = 0;
static int countdown = 0;
static int step = 0;

void setup() {
  rng.Init("lsystem");
  voice.Init(kSampleRate, &rng);
  scale.Init(0, bellows::kScaleLydian);
  tuning.InitEdo(12);

  plant.Init();
  plant.SetAxiom("A");
  /* Rule text is borrowed, never copied, so these literals stay in flash
   * and cost no RAM. They have to outlive the LSystem, which for a
   * literal means forever. */
  plant.AddRule('A', "AB");
  plant.AddRule('B', "CA");
  plant.AddRule('C', "BD");
  plant.AddRule('D', "D");

  /* Every symbol is rewritten from the OLD string each generation, which
   * is what makes the shape self-similar rather than merely long.
   *
   * The truncation contract: when a replacement will not fit whole, that
   * generation stops before writing it, the rest is dropped, Truncated()
   * latches true, Grow returns false and does not attempt the remaining
   * generations. What you are left with is always a valid NUL-terminated
   * prefix of what the browser would have produced, so a truncated system
   * plays a shorter phrase rather than a broken one.
   *
   * Seven generations of this grammar is 93 symbols and fits. Eight is
   * 168 and would stop partway through generation 8, which is the case
   * worth knowing about before it happens on the board. */
  if (!plant.Grow(7)) Serial.println("lsystem: hit 128 symbols");

  melody_len = bellows::MapToDegrees(plant.Result(), kSymbols, kDegrees, melody, 128);

  samples_per_step = static_cast<int>(kSampleRate * 60.0f / (108.0f * 2.0f) + 0.5f);
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      if (melody_len > 0) {
        const int8_t d = melody[step % melody_len];
        if (d != bellows::kRestDegree) {
          const int midi = scale.DegreeToMidi(static_cast<int>(d), 4);
          voice.NoteOn(tuning.MidiToFreq(midi), 0.75f);
        }
        ++step;
      }
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    voice.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/modal.h',
      'bellows/seq/lsystem.h',
      'bellows/theory/scales.h',
      'bellows/theory/tuning.h',
    ],
    parityRow: 'modal',
    parityRelRms: 1.23e-4,
    caveat: null,
  },
  {
    id: 'seq-ca-drums',
    title: 'CELLULAR AUTOMATA DRUMS',
    category: 'SEQUENCING',
    description:
      'Rule 30 on a ring of sixteen cells, one generation per sixteenth note, with three fixed columns read as kick, snare and hat. Bit b of the rule number is the next state of the neighbourhood (left, centre, right), so the rule number is the entire program and one live cell is the entire seed. A sixteen cell ring has to cycle eventually and this one does, after 6016 generations: about twelve minutes at 124 bpm, which is longer than the piece.',
    seed: 'rule-30',
    code: `var ca = new lib.ElementaryCA(30, 16);   // rule 30, single live centre cell
var kick = b.voice('kick');
var snare = b.voice('snare');
var hat = b.voice('hat', { decay: 0.045 });

b.bpm(124);

var off = b.clock.at('16n', function (t, step) {
  if (step % 16 === 0) {
    var s = '';
    for (var i = 0; i < ca.row.length; i++) s += ca.row[i] ? '#' : '.';
    log('gen ' + ca.generation + '  ' + s);
  }
  // three fixed columns of the ring are three drum lanes
  if (ca.row[8]) kick.note({ hz: 50 }, { at: t, vel: 0.8 });
  if (ca.row[4]) snare.note({ hz: 190 }, { at: t, vel: 0.55 });
  if (ca.row[12]) hat.note({ hz: 330 }, { at: t, vel: 0.35 });
  ca.step();   // read the row first, then advance
});
onCleanup(off);
b.start();`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"
#include "bellows/seq/automata.h"

static bellows::Rng rng;
static bellows::Kick kick;
static bellows::Snare snare;
static bellows::Hat hat;

/* Sixteen cells, one byte each, wrapping at both edges. */
static bellows::ElementaryCa<16> ca;

static int samples_per_step = 0;
static int countdown = 0;

void setup() {
  rng.Init("rule30");
  kick.Init(kSampleRate);
  snare.Init(kSampleRate, &rng);  /* the only drum that needs noise */

  bellows::Hat::Params hp;
  hp.decay = 0.045f;
  hat.Init(kSampleRate, hp);

  /* Rule 30. Bit b of the rule number is the next state of the
   * neighbourhood (left << 2) | (centre << 1) | right, so 30 is
   * 00011110: alive when exactly one or two of the three are alive, and
   * not the middle-heavy cases. From a single live cell that is chaotic
   * enough that Wolfram shipped it as the random number generator in
   * Mathematica, and on sixteen wrapping cells it never settles. */
  ca.Init(30);

  samples_per_step = static_cast<int>(kSampleRate * 60.0f / (124.0f * 4.0f) + 0.5f);
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      /* Three fixed columns of the ring are three drum lanes. Read the
       * row first, then advance: one generation per sixteenth. */
      if (ca.Cell(8)) kick.NoteOn(50.0f, 0.8f);
      if (ca.Cell(4)) snare.NoteOn(190.0f, 0.55f);
      if (ca.Cell(12)) hat.NoteOn(330.0f, 0.35f);
      ca.Step();
      countdown = samples_per_step;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    kick.Process(l, r, i, i + span);
    snare.Process(l, r, i, i + span);
    hat.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/drums.h', 'bellows/seq/automata.h'],
    parityRow: 'kick',
    parityRelRms: 9.79e-5,
    caveat: null,
  },
];
