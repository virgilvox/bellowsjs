/*
 * Theory and tuning on a microcontroller. The theory layer is the part of
 * bellows that ports across with the least change: it is integer
 * arithmetic and tables in flash, no sample rate, no buffers, nothing that
 * allocates. A Scale is twelve bytes and a Chord is twelve, both cheap
 * enough to copy around, and neither cares what is rendering.
 *
 * The five snippets here write a phrase in degrees, stack a progression
 * out of a scale, play the same shape in two divisions of the octave,
 * move between note names and numbers, and snap an off-key note back into
 * a scale.
 */

import type { EmbeddedExample } from './types';

export const thExamples: EmbeddedExample[] = [
  {
    id: 'th-scale-degrees',
    title: 'SCALES AND DEGREES',
    category: 'THEORY + TUNING',
    description:
      'A phrase written as scale degrees instead of note numbers, played on a plucked string. Degree 0 is the root and degree 7 is the root an octave up, so the phrase says its shape and the Scale says the key. Change the scale type and the same eight numbers stay in tune.',
    seed: 'th-degrees',
    code: `var scale = b.scale('D dorian');   // try 'D minor pentatonic', 'D phrygian'
var synth = b.voice('pluck');

// the phrase, in degrees. no note names anywhere in it.
var phrase = [0, 2, 4, 2, 7, 6, 4, 0];

var t = b.now() + 0.1;
for (var pass = 0; pass < 2; pass++) {
  for (var i = 0; i < phrase.length; i++) {
    var midi = scale.degreeToMidi(phrase[i], 3);
    synth.note(midi, { at: t, dur: { seconds: 0.14 }, vel: 0.85 });
    t += 0.16;
  }
}

log('degrees ' + phrase.join(' '));
log('midi    ' + phrase.map(function (d) { return scale.degreeToMidi(d, 3); }).join(' '));
log('names   ' + phrase.map(function (d) { return lib.noteName(scale.degreeToMidi(d, 3)); }).join(' '));`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Pluck<> string_voice;
static bellows::Scale scale;
static bellows::Tuning12 tuning;

/* The phrase, in scale degrees. 0 is the root, 7 is the root an octave
 * up, -1 would be the step below the root. No key is written down here:
 * the Scale decides what these eight numbers mean. */
static const int8_t kPhrase[8] = {0, 2, 4, 2, 7, 6, 4, 0};

static int step = 0;
static int countdown = 0;
static bool held = false;
static int hold_samples = 0;
static int gap_samples = 0;

void setup() {
  rng.Init("th-degrees");
  string_voice.Init(kSampleRate, &rng);

  /* D dorian: root pitch class 2, and the scale table supplies the rest.
   * Swap kScaleDorian for kScaleMinorPentatonic and the same phrase
   * plays a different tune, still in key, with no other edit. A Scale is
   * a root, a length, a pointer into flash and a 12 bit membership mask,
   * so keeping several of them costs almost nothing. */
  scale.Init(2, bellows::kScaleDorian);

  hold_samples = static_cast<int>(kSampleRate * 0.14f);
  gap_samples = static_cast<int>(kSampleRate * 0.02f);
}

static void Strike() {
  /* Degree to MIDI with the root in octave 3, then MIDI to Hz through
   * the tuning. A default Tuning12 is 12-EDO with A4 at 440, which is
   * where every pitch in the library passes even when nothing is
   * microtonal yet. */
  const int midi = scale.DegreeToMidi(kPhrase[step], 3);
  string_voice.NoteOn(tuning.MidiToFreq(midi), 0.85f);
  step = (step + 1) & 7;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      /* Two phases per step: hold the note, then damp it and wait. The
       * block is split at every phase change so a note starts on the
       * sample it is due on rather than at the next block boundary. */
      if (held) {
        string_voice.NoteOff();
        held = false;
        countdown = gap_samples;
      } else {
        Strike();
        held = true;
        countdown = hold_samples;
      }
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    string_voice.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/pluck.h',
      'bellows/theory/scales.h',
      'bellows/theory/tuning.h',
    ],
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    caveat: null,
  },
  {
    id: 'th-chords',
    title: 'CHORDS FROM A SCALE',
    category: 'THEORY + TUNING',
    description:
      'A I vi IV V progression built by stacking thirds through a scale rather than by naming chord types. DiatonicChord walks the scale for its notes, so degree 0 comes back major and degree 5 comes back minor without either quality being written down. Move the scale to minor and the whole progression changes quality on its own.',
    seed: 'th-chords',
    code: `var scale = b.scale('C major');    // try 'C minor', 'C mixolydian'
var triads = lib.diatonicTriads(scale);
var degrees = [0, 5, 3, 4];        // I vi IV V

var pad = b.voice('va', { shape: 1, detune: 9, cutoff: 2200, attack: 0.15, release: 0.5 });
pad.gain(0.6);

var t = b.now() + 0.1;
for (var pass = 0; pass < 2; pass++) {
  for (var i = 0; i < degrees.length; i++) {
    var ch = triads[degrees[i]];
    pad.chord(ch.midi(3), { at: t, dur: { seconds: 1.5 }, vel: 0.6 });
    if (pass === 0) log(lib.chordToRoman(ch, scale) + '  ' + lib.chordName(ch) + '  ' +
      ch.midi(3).map(function (m) { return lib.noteName(m); }).join(' '));
    t += 2;
  }
}`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"
#include "bellows/theory/chords.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Va pad[3]; /* one voice per chord tone */
static bellows::Scale scale;
static bellows::Tuning12 tuning;

/* I vi IV V, as scale degrees. The qualities are not in this table.
 * Degree 0 of a major scale stacks to a major triad and degree 5 to a
 * minor one because the scale says so, which is why moving to
 * kScaleMinor rewrites the progression without touching this line. */
static const int8_t kProgression[4] = {0, 5, 3, 4};

static int bar = 0;
static int countdown = 0;
static bool held = false;
static int hold_samples = 0;
static int gap_samples = 0;

void setup() {
  rng.Init("th-chords");

  bellows::Va::Params p;
  p.shape = 1.0f;    /* square */
  p.detune = 9.0f;
  p.cutoff = 2200.0f;
  p.attack = 0.15f;
  p.release = 0.5f;
  for (int v = 0; v < 3; ++v) pad[v].Init(kSampleRate, &rng, p);

  scale.Init(0, bellows::kScaleMajor); /* C major */
  hold_samples = static_cast<int>(kSampleRate * 1.5f);
  gap_samples = static_cast<int>(kSampleRate * 0.5f);
}

static void StartBar() {
  /* Three scale thirds stacked on the degree. Because the notes come
   * from the scale rather than a chord table, a scale that stacks to
   * something with no name (hungarian minor does it regularly) comes
   * back as kChordUnknown with its intervals intact and still plays. */
  const bellows::Chord ch = bellows::DiatonicChord(scale, kProgression[bar], 3);
  int midi[3];
  const int n = ch.Midi(3, midi, 3); /* root in octave 3 */
  for (int v = 0; v < n; ++v) pad[v].NoteOn(tuning.MidiToFreq(midi[v]), 0.6f);
  bar = (bar + 1) & 3;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      if (held) {
        for (int v = 0; v < 3; ++v) pad[v].NoteOff();
        held = false;
        countdown = gap_samples;
      } else {
        StartBar();
        held = true;
        countdown = hold_samples;
      }
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    for (int v = 0; v < 3; ++v) pad[v].Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/va.h',
      'bellows/theory/chords.h',
      'bellows/theory/scales.h',
      'bellows/theory/tuning.h',
    ],
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    caveat:
      'The browser version prints the roman numeral and the chord name, which pulls in the chord name tables. The C++ never names anything, so the string tables never link.',
  },
  {
    id: 'th-microtonal',
    title: 'THE SAME PHRASE IN 19-EDO',
    category: 'THEORY + TUNING',
    description:
      'One phrase played twice: once in 12 equal divisions of the octave, once in 19. Both start on 440 Hz, so only the size of a step changes, and 19-EDO gives a major third of 379 cents against 400. The trap is in the two interval tables: an interval table is in steps of its own tuning, never in semitones, so major is 0 2 4 5 7 9 11 in 12 and 0 3 6 8 11 14 17 in 19.',
    seed: 'th-edo19',
    code: `var edo12 = lib.Tuning.edo(12);
var edo19 = lib.Tuning.edo(19);

// the same seven note shape, each measured in steps of ITS OWN tuning
var major12 = [0, 2, 4, 5, 7, 9, 11];
var major19 = [0, 3, 6, 8, 11, 14, 17];

var phrase = [0, 2, 4, 2, 6, 4, 2, 0];
var inst = b.voice('pluck');

var t = b.now() + 0.1;
for (var pass = 0; pass < 4; pass++) {
  var wide = pass % 2 === 1;
  var tuning = wide ? edo19 : edo12;
  var table = wide ? major19 : major12;
  for (var i = 0; i < phrase.length; i++) {
    // index 69 is the 440 Hz reference in both tunings
    var hz = lib.degreeFreq(tuning, 69, table, phrase[i]);
    inst.note({ hz: hz }, { at: t, dur: { seconds: 0.16 }, vel: 0.85 });
    t += 0.18;
  }
}

log('12-EDO step ' + (1200 / 12).toFixed(1) + ' cents, major third ' + (1200 * 4 / 12).toFixed(1));
log('19-EDO step ' + (1200 / 19).toFixed(1) + ' cents, major third ' + (1200 * 6 / 19).toFixed(1));
log('a just 5/4 is 386.3, so 19 gets closer than 12 does');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Pluck<> string_voice;

/* The template argument is the size of the cents table, so this holds up
 * to 19 degrees per period. One float per degree plus four fields, fixed
 * at compile time, which is why nothing here allocates. */
static bellows::Tuning<19> tuning;

/* The trap. Both of these are the same seven note major shape, and
 * neither is in semitones: an interval table is in STEPS of its own
 * tuning. A major third is 4 steps of 12 and 6 steps of 19, a fifth is 7
 * and 11, so the second table is not the first one scaled by anything
 * you would guess from looking at it. */
static const int8_t kMajor12[7] = {0, 2, 4, 5, 7, 9, 11};
static const int8_t kMajor19[7] = {0, 3, 6, 8, 11, 14, 17};

static const int8_t kPhrase[8] = {0, 2, 4, 2, 6, 4, 2, 0};

static int step = 0;
static int countdown = 0;
static bool held = false;
static bool wide = false; /* false: 12-EDO, true: 19-EDO */
static int hold_samples = 0;
static int gap_samples = 0;

void setup() {
  rng.Init("th-edo19");
  string_voice.Init(kSampleRate, &rng);
  tuning.InitEdo(12);
  hold_samples = static_cast<int>(kSampleRate * 0.16f);
  gap_samples = static_cast<int>(kSampleRate * 0.02f);
}

static void Strike() {
  if (step == 0) {
    /* Swap divisions every eight notes. Index 69 is the reference in
     * both, so it stays at 440 Hz and only the width of a step moves. */
    wide = !wide;
    tuning.InitEdo(wide ? 19 : 12);
  }
  const int8_t* table = wide ? kMajor19 : kMajor12;
  /* DegreeFreq takes the table as tuning steps above a root index, and
   * wraps degrees past the end by whole periods. It is templated on the
   * element type, so the uint8_t table a Scale hands out works here too. */
  const float hz = bellows::DegreeFreq(tuning, 69, table, 7, kPhrase[step]);
  string_voice.NoteOn(hz, 0.85f);
  step = (step + 1) & 7;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      if (held) {
        string_voice.NoteOff();
        held = false;
        countdown = gap_samples;
      } else {
        Strike();
        held = true;
        countdown = hold_samples;
      }
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    string_voice.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/pluck.h', 'bellows/theory/tuning.h'],
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    caveat: null,
  },
  {
    id: 'th-note-names',
    title: 'NOTE NAMES',
    category: 'THEORY + TUNING',
    description:
      'ParseNote turns "F#4" into 66 and NoteName turns 66 back into a string. The number round trips, the spelling does not: "Eb4" parses to 63 and comes back as "D#4" unless you ask for flats. Parsing reports failure with the sentinel kNoteInvalid rather than throwing, because there are no exceptions in this library.',
    seed: 'th-names',
    code: `var names = ['C4', 'Eb4', 'F#4', 'A4', 'Bb4', 'C5'];
var midi = names.map(lib.parseNote);

for (var i = 0; i < names.length; i++) {
  log(names[i] + ' -> ' + midi[i] + ' -> ' + lib.noteName(midi[i]) +
    '  (flats: ' + lib.noteName(midi[i], true) + ')');
}

var bell = b.voice('modal');
var t = b.now() + 0.1;
for (var pass = 0; pass < 2; pass++) {
  for (var i = 0; i < midi.length; i++) {
    bell.note(midi[i], { at: t, dur: { seconds: 0.22 }, vel: 0.8 });
    t += 0.25;
  }
}`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/modal.h"
#include "bellows/theory/notes.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Modal bell;
static bellows::Tuning12 tuning;

static const char* const kNames[6] = {"C4", "Eb4", "F#4", "A4", "Bb4", "C5"};
static int notes[6];

static int step = 0;
static int countdown = 0;
static bool held = false;
static int hold_samples = 0;
static int gap_samples = 0;

void setup() {
  rng.Init("th-names");
  bell.Init(kSampleRate, &rng);

  /* ParseNote returns kNoteInvalid for a malformed string rather than
   * throwing, so a bad name is a value you check, not a trap. Letters
   * may be either case and accidentals repeat, so "C##4" and "ebb3"
   * both parse. */
  for (int i = 0; i < 6; ++i) {
    const int m = bellows::ParseNote(kNames[i]);
    notes[i] = (m == bellows::kNoteInvalid) ? 60 : m;
  }

  hold_samples = static_cast<int>(kSampleRate * 0.22f);
  gap_samples = static_cast<int>(kSampleRate * 0.03f);
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      if (held) {
        bell.NoteOff();
        held = false;
        countdown = gap_samples;
      } else {
        bell.NoteOn(tuning.MidiToFreq(notes[step]), 0.8f);
        step = (step + 1) % 6;
        held = true;
        countdown = hold_samples;
      }
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    bell.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}

void loop() {
  /* NoteName writes into a buffer you own and returns the length. Six
   * bytes covers the longest name ("C##-1" plus its terminator) and a
   * short buffer truncates rather than overruns. Sharps are the default
   * spelling, so "Eb4" comes back as "D#4": the MIDI number round trips,
   * the spelling does not.
   *
   * This is also the only part of notes.h that costs string bytes. A
   * sketch that parses and plays but never prints links none of the
   * name tables at all. */
  char buf[8];
  for (int i = 0; i < 6; ++i) {
    bellows::NoteName(notes[i], buf, 8);
    Serial.print(kNames[i]);
    Serial.print(" -> ");
    Serial.print(notes[i]);
    Serial.print(" -> ");
    Serial.println(buf);
  }
  delay(2000);
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/modal.h',
      'bellows/theory/notes.h',
      'bellows/theory/tuning.h',
    ],
    parityRow: 'modal',
    parityRelRms: 1.23e-4,
    caveat:
      'The C++ prints the round trip over Serial from loop(), which the browser version writes to the console instead. The audio is the same six notes either way.',
  },
  {
    id: 'th-quantise',
    title: 'QUANTISE TO A SCALE',
    category: 'THEORY + TUNING',
    description:
      'Eight chromatic notes, played raw and then snapped to A minor pentatonic with Scale::Quantize. Quantize leaves a note that is already in the scale alone and otherwise walks outward a semitone at a time, checking below before above, so ties resolve downward. It searches six semitones each way and gives up rather than jumping an octave.',
    seed: 'th-quantise',
    code: `var scale = b.scale('A minor pentatonic');
var lead = b.voice('fm');

// a chromatic walk: half of these are not in the scale
var raw = [57, 59, 61, 62, 64, 66, 67, 69];

for (var i = 0; i < raw.length; i++) {
  var q = scale.quantize(raw[i]);
  log(lib.noteName(raw[i]) + ' -> ' + lib.noteName(q) +
    (q === raw[i] ? '   (already in)' : '   (moved ' + (q - raw[i]) + ')'));
}

var t = b.now() + 0.1;
for (var pass = 0; pass < 4; pass++) {
  var snap = pass % 2 === 1;
  for (var i = 0; i < raw.length; i++) {
    lead.note(snap ? scale.quantize(raw[i]) : raw[i], { at: t, dur: { seconds: 0.16 }, vel: 0.8 });
    t += 0.2;
  }
}
log('raw pass, snapped pass, raw pass, snapped pass');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/fm.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

static bellows::Rng rng;
static bellows::Fm lead;
static bellows::Scale scale;
static bellows::Tuning12 tuning;

/* A chromatic walk. Half of these notes are not in the scale, which is
 * the point: this is the shape an LFO, a knob or a random stream hands
 * you, and quantising is how it becomes playable. */
static const int8_t kRaw[8] = {57, 59, 61, 62, 64, 66, 67, 69};

static int step = 0;
static int countdown = 0;
static bool held = false;
static bool snap = false; /* alternates every eight notes */
static int hold_samples = 0;
static int gap_samples = 0;

void setup() {
  rng.Init("th-quantise");
  lead.Init(kSampleRate);

  /* A minor pentatonic: root pitch class 9, steps 0 3 5 7 10. */
  scale.Init(9, bellows::kScaleMinorPentatonic);

  hold_samples = static_cast<int>(kSampleRate * 0.16f);
  gap_samples = static_cast<int>(kSampleRate * 0.04f);
}

static void Play() {
  /* Quantize returns the note untouched when its pitch class is already
   * in the scale, and otherwise steps outward a semitone at a time,
   * testing below before above so a tie lands on the lower note. It
   * gives up after six semitones and returns the input, which is the
   * only case where an out of scale note gets through. The test is on
   * pitch class, so the answer is always within that semitone window
   * and never leaps an octave. */
  const int note = snap ? scale.Quantize(kRaw[step]) : kRaw[step];
  lead.NoteOn(tuning.MidiToFreq(note), 0.8f);

  step = (step + 1) & 7;
  if (step == 0) snap = !snap;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      if (held) {
        lead.NoteOff();
        held = false;
        countdown = gap_samples;
      } else {
        Play();
        held = true;
        countdown = hold_samples;
      }
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    lead.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: [
      'bellows/core/prng.h',
      'bellows/engines/fm.h',
      'bellows/theory/scales.h',
      'bellows/theory/tuning.h',
    ],
    parityRow: 'fm',
    parityRelRms: 5.25e-4,
    caveat: null,
  },
];
