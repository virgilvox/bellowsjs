/*
 * One example per ported engine. Each answers "what is this engine for"
 * rather than "this engine exists": the drum kit is playable because the
 * drums tune from the note frequency, the FM patch is struck because its
 * modulator envelope dies first, the string costs what its lowest note
 * costs.
 *
 * The cpp of every entry is compiled by scripts/check-embedded-examples.mjs
 * against the real headers. Param names come from the Params structs in
 * packages/bellows-embedded/src/bellows/engines; the browser names are the
 * camelCase versions of the same fields, with the same defaults, which the
 * parity harness compares numerically on every commit.
 */

import type { EmbeddedExample } from './types';

export const engExamples: EmbeddedExample[] = [
  {
    id: 'eng-drum-kit',
    title: 'DRUM KIT',
    category: 'ENGINES',
    description:
      'Kick, snare and hat on one sixteenth-note grid, the render function splitting each block at the step boundaries so a hit lands on its exact sample. Every drum tunes from the frequency passed to NoteOn, so the kit is playable: the same Kick object is a bass drum at 50 Hz and a tom at 96 Hz. Snare needs the Rng because its body is noise; Kick and Hat do not take one.',
    seed: 'eng-kit',
    code: `var kick = b.voice('kick', { decay: 0.5, drive: 3 });
var snare = b.voice('snare');
var hat = b.voice('hat');
hat.gain(0.5);

b.bpm(120);

var off = b.clock.at('16n', function (t, step) {
  var s = step % 16;
  if (s === 0 || s === 6 || s === 10) kick.note('G1', { at: t, vel: 0.95 });
  if (s === 14) kick.note('G2', { at: t, vel: 0.7 });   // same voice, tom pitch
  if (s === 4 || s === 12) snare.note('G3', { at: t, vel: 0.85 });
  hat.note('E4', { at: t, vel: s % 2 ? 0.3 : 0.5 });
});
onCleanup(off);

b.start();
log('one Kick covers the bass drum and the tom: only the pitch differs');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/drums.h"

static bellows::Rng rng;
static bellows::Kick kick;
static bellows::Snare snare;
static bellows::Hat hat;

/* The sequencer is three integers: which step we are on, how many samples
 * are left of it, and how long a step is. */
static int step = 0;
static int countdown = 0;
static int step_samples = 0;

void setup() {
  rng.Init("eng-kit");

  bellows::Kick::Params kp;
  kp.decay = 0.5f;   /* default 0.4 */
  kp.drive = 3.0f;   /* default 2.0, harder into the tanh */
  kick.Init(kSampleRate, kp);

  /* Snare is the only drum that takes the Rng: its body is filtered
   * noise, and the stream is what makes a seeded piece reproduce. */
  snare.Init(kSampleRate, &rng);
  hat.Init(kSampleRate);

  /* Sixteenths at 120 bpm: eight steps a second. */
  step_samples = static_cast<int>(kSampleRate / 8.0f);
}

static void Step() {
  const int s = step & 15;
  /* Drums tune from the noteOn frequency, so one Kick is a bass drum at
   * 50 Hz and a tom an octave up. There is no second engine for toms. */
  if (s == 0 || s == 6 || s == 10) kick.NoteOn(50.0f, 0.95f);
  if (s == 14) kick.NoteOn(96.0f, 0.7f);
  if (s == 4 || s == 12) snare.NoteOn(190.0f, 0.85f);
  hat.NoteOn(330.0f, (s & 1) ? 0.3f : 0.5f);
  ++step;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      Step();
      countdown = step_samples;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    /* Voices add, so all three write the same range with no mix pass. */
    kick.Process(l, r, i, i + span);
    snare.Process(l, r, i, i + span);
    hat.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/drums.h'],
    parityRow: 'kick',
    parityRelRms: 9.79e-5,
    caveat: null,
  },
  {
    id: 'eng-va-bass',
    title: 'VIRTUAL ANALOG',
    category: 'ENGINES',
    description:
      'Two band-limited oscillators detuned against each other, a square sub an octave down, and a ladder filter with its own envelope. envAmount is what makes it a synth bass rather than a drone: it opens the ladder three octaves above the 220 Hz base cutoff at each note and lets it fall back. drift adds a slow random pitch walk, which is why the voice wants an Rng.',
    seed: 'eng-va',
    code: `var bass = b.voice('va', {
  shape: 0,          // 0 saw, 1 square, 2 triangle, 3 sine
  detune: 12,        // cents between the two oscillators
  sub: 0.6,          // square one octave down
  cutoff: 220,       // where the ladder sits with the envelope closed
  resonance: 0.55,
  filterType: 0,     // 0 ladder, 1 svf
  envAmount: 3,      // octaves the filter envelope adds
  fDecay: 0.18, fSustain: 0.05,
  decay: 0.25, sustain: 0.4, release: 0.08,
  drift: 0.3,
});

b.bpm(120);
var line = ['A1', 'A1', 'E2', 'C2'];

var off = b.clock.at('8n', function (t, step) {
  bass.note(line[step % 4], { at: t, dur: '16n', vel: step % 2 ? 0.7 : 1 });
});
onCleanup(off);

b.start();
log('cutoff sits at 220 Hz and the envelope opens it three octaves per note');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/va.h"

static bellows::Rng rng;
static bellows::Va bass;

/* A1, A1, E2, C2. */
static const float kLine[4] = {55.0f, 55.0f, 82.41f, 65.41f};

static int step = 0;
static int countdown = 0;
static int step_samples = 0;

void setup() {
  rng.Init("eng-va");   /* the drift walk draws from this stream */

  bellows::Va::Params p;
  p.shape = 0.0f;         /* 0 saw, 1 square, 2 triangle, 3 sine */
  p.detune = 12.0f;       /* cents between the two oscillators */
  p.sub = 0.6f;           /* square one octave down */
  p.cutoff = 220.0f;      /* the ladder with the envelope closed */
  p.resonance = 0.55f;
  p.filter_type = 0.0f;   /* 0 ladder, 1 svf */
  /* The filter envelope is the point of the engine. Three octaves above
   * the base cutoff at the attack, falling back to nearly nothing. */
  p.env_amount = 3.0f;
  p.f_decay = 0.18f;
  p.f_sustain = 0.05f;
  p.decay = 0.25f;
  p.sustain = 0.4f;
  p.release = 0.08f;
  p.drift = 0.3f;
  bass.Init(kSampleRate, &rng, p);

  /* Eighths at 120 bpm, one gate change per step: on, off, on, off. */
  step_samples = static_cast<int>(kSampleRate * 0.25f);
}

static void Step() {
  if (step & 1) {
    bass.NoteOff();   /* the release stage runs after this */
  } else {
    const int n = (step >> 1) & 3;
    bass.NoteOn(kLine[n], (n & 1) ? 0.7f : 1.0f);
  }
  ++step;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      Step();
      countdown = step_samples;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    bass.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/va.h'],
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    caveat: null,
  },
  {
    id: 'eng-fm-struck',
    title: 'FM: WHY IT SOUNDS STRUCK',
    category: 'ENGINES',
    description:
      'Two operators, one modulating the other, at a ratio of 3.5 so the partials land between the harmonics. The one idea worth taking away: the modulator envelope is over in 120 ms while the carrier rings for two seconds, and that mismatch is the whole difference between a struck bell and an electric organ. Carriers share attack/decay/sustain/release, modulators share mAttack/mDecay/mSustain/mRelease, so this is one parameter change either way.',
    seed: 'eng-fm',
    code: `var bell = b.voice('fm', {
  ops: 2, algorithm: 1,        // 2 > 1: one modulator into one carrier
  ratio2: 3.5,                 // inharmonic against the carrier
  level2: 0.9,                 // modulation index
  attack: 0.002, decay: 2, sustain: 0, release: 0.4,
  mAttack: 0.001, mDecay: 0.12, mSustain: 0, mRelease: 0.1,
});

b.bpm(100);

var off = b.clock.at('2n', function (t, step) {
  if (step === 4) {
    // the same patch with a modulator that outlives the carrier
    bell.param('mDecay', 3, t);
    bell.param('mSustain', 0.8, t);
    log('mDecay 0.12 -> 3: the strike becomes a drone, nothing else changed');
  }
  bell.note('A3', { at: t, dur: '2n', vel: 0.9 });
});
onCleanup(off);

b.start();
log('four struck notes, then four with the modulator held open');`,
    cpp: `#include "bellows/engines/fm.h"

static bellows::Fm bell;

static int countdown = 0;
static int period_samples = 0;

void setup() {
  bellows::Fm::Params p;
  p.ops = 2.0f;         /* two operators */
  p.algorithm = 1.0f;   /* algorithm 1 of the two op set: 2 > 1 */
  p.ratio[1] = 3.5f;    /* the modulator, inharmonic against the carrier */
  p.level[1] = 0.9f;    /* modulation index */

  /* The carrier rings for two seconds. */
  p.attack = 0.002f;
  p.decay = 2.0f;
  p.sustain = 0.0f;
  p.release = 0.4f;

  /* The modulator is gone in 120 ms, so the bright, inharmonic part of
   * the sound is only the attack. That is what a struck object does, and
   * it is the whole reason this reads as a bell rather than an organ.
   * Raise m_decay to 3.0 and the same two operators drone. Envelopes are
   * grouped by role, not per operator: every carrier under the current
   * algorithm shares attack/decay/sustain/release, every modulator
   * shares the m_ set. */
  p.m_attack = 0.001f;
  p.m_decay = 0.12f;
  p.m_sustain = 0.0f;
  p.m_release = 0.1f;

  bell.Init(kSampleRate, p);

  period_samples = static_cast<int>(kSampleRate * 1.2f);
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      bell.NoteOn(220.0f, 0.9f);
      countdown = period_samples;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    bell.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/engines/fm.h'],
    parityRow: 'fm',
    parityRelRms: 5.25e-4,
    caveat:
      'The browser version switches mDecay and mSustain halfway through so you hear the struck patch and the drone back to back. The C++ keeps the struck settings and repeats.',
  },
  {
    id: 'eng-pluck-string',
    title: 'PLUCKED STRING',
    category: 'ENGINES',
    description:
      'Karplus-Strong: a noise burst pushed into a delay line one period long, with a damping filter in the loop that eats the high partials faster than the low ones. The template argument is the lowest note the instance can hold and it sizes that delay line, which is the one thing an MCU cannot defer to runtime. Pluck<110> is 5408 bytes measured with sizeof; the default Pluck<> floor of 20 Hz is 28976 bytes for the same object, so you pay for the range you actually play.',
    seed: 'eng-pluck',
    code: `var str = b.voice('pluck', {
  damp: 0.2,         // loop filter: lower keeps the highs longer
  pickPos: 0.15,     // comb notch, where along the string it is plucked
  exciteType: 0,     // 0 noise burst, 1 filtered pulse
  decay: 4,
  level: 0.9,
});

b.bpm(120);
var arp = ['A2', 'C#3', 'E3', 'A3', 'E3', 'C#3'];

var off = b.clock.at('8n', function (t, step) {
  str.note(arp[step % 6], { at: t, dur: '4n', vel: 0.85 });
});
onCleanup(off);

b.start();
log('A2 is 110 Hz, exactly the floor the C++ instance is sized for');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/pluck.h"

static bellows::Rng rng;

/* The template argument is the lowest note in Hz this instance can hold,
 * and it sizes the delay line. 110 Hz (A2) makes the object 5408 bytes;
 * the default floor of 20 Hz makes it 28976 bytes. NoteOn clamps to
 * MinFreq(), so asking for a lower note is quiet failure, not a fault. */
static bellows::Pluck<110> str;

/* A2, C#3, E3, A3, E3, C#3. */
static const float kArp[6] = {110.0f, 138.59f, 164.81f, 220.0f, 164.81f, 138.59f};

static int step = 0;
static int countdown = 0;
static int step_samples = 0;

void setup() {
  rng.Init("eng-pluck");   /* the excitation burst is drawn from it */

  bellows::Pluck<110>::Params p;
  p.damp = 0.2f;         /* loop filter: lower keeps the highs longer */
  p.pick_pos = 0.15f;    /* comb notch, where the string is plucked */
  p.excite_type = 0.0f;  /* 0 noise burst, 1 filtered pulse */
  p.decay = 4.0f;
  p.level = 0.9f;
  str.Init(kSampleRate, &rng, p);

  step_samples = static_cast<int>(kSampleRate * 0.25f);
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      str.NoteOn(kArp[step % 6], 0.85f);
      ++step;
      countdown = step_samples;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    str.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/pluck.h'],
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    caveat:
      'The browser pluck has no compile-time floor, so a note below 110 Hz sounds there and is clamped to 110 Hz by Pluck<110> on the board.',
  },
  {
    id: 'eng-modal-material',
    title: 'MODAL MATERIALS',
    category: 'ENGINES',
    description:
      'A bank of decaying two-pole resonators struck by a short burst. The material param picks the table of partial ratios and per-mode decay times, and moving it from 2 to 4 is the whole distance between a bell and a marimba: the bell partials sit at 1, 2, 2.4, 3 with a decay multiplier of 1.8, the wood ones at 1, 2.572, 4.644 with a multiplier of 0.12. This example strikes the same four notes both ways, changing nothing else.',
    seed: 'eng-modal',
    code: `var bar = b.voice('modal', {
  material: 2,        // 0 bar, 1 membrane, 2 bell, 3 glass, 4 wood
  decay: 3,
  brightness: 0.6,
  strikeHardness: 0.7,
  level: 0.35,        // 24 resonators in phase peak hard: leave headroom
});

b.bpm(100);
var tune = ['A3', 'C4', 'E4', 'D4'];

var off = b.clock.at('4n', function (t, step) {
  if (step % 4 === 0) {
    var mat = (step % 8) === 0 ? 2 : 4;
    bar.param('material', mat, t);
    log(mat === 2 ? 'material 2: bell' : 'material 4: wood');
  }
  bar.note(tune[step % 4], { at: t, dur: '4n', vel: 0.9 });
});
onCleanup(off);

b.start();`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/modal.h"

static bellows::Rng rng;
static bellows::Modal bar;
static bellows::Modal::Params params;

/* A3, C4, E4, D4. */
static const float kTune[4] = {220.0f, 261.63f, 329.63f, 293.66f};

static int step = 0;
static int countdown = 0;
static int step_samples = 0;

void setup() {
  rng.Init("eng-modal");   /* the strike burst is drawn from it */

  params.material = 2.0f;        /* 0 bar, 1 membrane, 2 bell, 3 glass, 4 wood */
  params.decay = 3.0f;           /* T60 of the fundamental, in seconds */
  params.brightness = 0.6f;      /* tilts the mode gains around the fundamental */
  params.strike_hardness = 0.7f; /* shorter, sharper burst */
  /* Every mode starts in phase at the strike, so the peak is well above
   * the steady level. 0.35 rather than the 0.6 default leaves room. */
  params.level = 0.35f;
  bar.Init(kSampleRate, &rng, params);

  step_samples = static_cast<int>(kSampleRate * 0.6f);
}

static void Step() {
  /* One number, four strikes apart. Material 2 is the bell table
   * (partials at 1, 2, 2.4, 3, decay multiplier 1.8) and material 4 is
   * wood (1, 2.572, 4.644, multiplier 0.12), so the same bank of
   * resonators stops ringing and starts knocking. Nothing else changes:
   * same decay, same brightness, same strike. */
  if ((step & 3) == 0) {
    params.material = (step & 4) ? 4.0f : 2.0f;
    bar.SetParams(params);
  }
  bar.NoteOn(kTune[step & 3], 0.9f);
  ++step;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      Step();
      countdown = step_samples;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    bar.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/modal.h'],
    parityRow: 'modal',
    parityRelRms: 1.23e-4,
    caveat: null,
  },
  {
    id: 'eng-tube-breath',
    title: 'BLOWN TUBE',
    category: 'ENGINES',
    description:
      'A cylindrical bore with a reed at one end: a delay line, an inverting reflection filter, and a memoryless reed table driven by breath pressure. Nothing here is struck, so nothing decays on its own. The reed keeps pumping the bore for as long as the gate is held, which is why the note sustains, and Glide() moves the sounding pitch without re-attacking, which is what makes a slur a slur.',
    seed: 'eng-tube',
    code: `var pipe = b.voice('tube', {
  breath: 0.9,        // how hard the reed is blown
  noise: 0.1,         // breath noise in the pressure signal
  level: 0.7,
  glide: 0.08,        // seconds to slur to a new pitch
});

var t = b.now() + 0.1;
var id = pipe.on('D3', 0.85, t);          // gate opens, and stays open

// 'freq' on a live tube voice slurs: no re-attack, only the bore retunes
pipe.param('freq', 196, t + 0.5);         // up to G3
pipe.param('freq', 146.83, t + 1);        // and back
pipe.off(id, t + 1.5);                    // gate closes, the bore empties

log('one note on, two slurs, one note off. the reed holds it up in between');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/engines/tube.h"

static bellows::Rng rng;

/* Sized like Pluck: the template argument is the lowest note, and the
 * bore is a half period long, so Tube<110> is 1112 bytes. */
static bellows::Tube<110> pipe;

static int phase = 0;
static int countdown = 0;
static int step_samples = 0;

void setup() {
  rng.Init("eng-tube");   /* breath noise draws from this stream */

  bellows::Tube<110>::Params p;
  p.breath = 0.9f;   /* reed pressure while the gate is held */
  p.noise = 0.1f;    /* breath noise mixed into that pressure */
  p.level = 0.7f;
  p.glide = 0.08f;   /* seconds to slur to a new pitch */
  pipe.Init(kSampleRate, &rng, p);

  step_samples = static_cast<int>(kSampleRate * 0.5f);
}

/* Blow D3, slur up to G3, slur back, release, rest. The note holds
 * because the reed keeps driving the bore while the gate is open, not
 * because an envelope is long: a struck engine has no such loop, and
 * that is the difference the engine exists for. */
static void Step() {
  switch (phase) {
    case 0: pipe.NoteOn(146.83f, 0.85f); break;
    /* Glide retunes the bore without re-attacking, so the two notes are
     * one breath. Only a short scratch cue marks the move. */
    case 1: pipe.Glide(196.0f); break;
    case 2: pipe.Glide(146.83f); break;
    case 3: pipe.NoteOff(); break;
    default: break;   /* one step of rest, then blow again */
  }
  phase = (phase >= 4) ? 0 : phase + 1;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      Step();
      countdown = step_samples;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    pipe.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/engines/tube.h'],
    parityRow: 'tube',
    parityRelRms: 1.7e-3,
    caveat:
      "The browser reaches the same legato through param('freq', hz) on a held voice; the C++ names it Glide(hz) so there is no string compare on the audio path.",
  },
  {
    id: 'eng-westcoast-fold',
    title: 'WEST COAST FOLD',
    category: 'ENGINES',
    description:
      'The other way to get a bright sound: start with a triangle, which has almost no harmonics, and fold it back on itself instead of filtering harmonics away. The fold gain rides an envelope, so each note opens up and relaxes, and the output goes through a low pass gate rather than a VCA. lpgColor sets how much of that gate is filter and how much is level, and the vactrol fall gets slower as it darkens, which is why the tail hangs on after the gate closes.',
    seed: 'eng-west',
    code: `var west = b.voice('westcoast', {
  foldAmount: 0.55,   // how far the triangle is driven into the folder
  foldStages: 3,      // folds per sample, each one adds partials
  foldEnv: 0.8,       // how much of the fold gain the envelope drives
  lpgColor: 0.4,      // 0 pure VCA, 1 pure filter
  lpgDecay: 0.6,      // vactrol fall time
  level: 0.8,
});

b.bpm(96);
var notes = ['C3', 'G3', 'Eb3', 'Bb3', 'F3', 'C4'];

var off = b.clock.at('8n', function (t, step) {
  west.note(notes[step % 6], { at: t, dur: '16n', vel: step % 3 ? 0.6 : 1 });
});
onCleanup(off);

b.start();
log('velocity opens the gate further, so a soft note is darker as well as quieter');`,
    cpp: `#include "bellows/engines/westcoast.h"

static bellows::WestCoast west;

/* C3, G3, Eb3, Bb3, F3, C4. */
static const float kNotes[6] = {130.81f, 196.0f, 155.56f, 233.08f, 174.61f, 261.63f};

static int step = 0;
static int countdown = 0;
static int step_samples = 0;

void setup() {
  bellows::WestCoast::Params p;
  /* A triangle has almost no harmonics to filter, so this engine makes
   * them instead: each fold stage reflects the waveform back on itself
   * and adds partials. Bright here means folded further, not filtered
   * less. */
  p.fold_amount = 0.55f;
  p.fold_stages = 3.0f;
  p.fold_env = 0.8f;   /* the fold gain rides the envelope */
  /* The output stage is a low pass gate, not a VCA: cutoff and level
   * both follow a vactrol model whose fall slows down as it darkens. */
  p.lpg_color = 0.4f;  /* 0 pure VCA, 1 pure filter */
  p.lpg_decay = 0.6f;
  p.level = 0.8f;
  west.Init(kSampleRate, p);

  /* Eighths at 96 bpm, one gate change per half step. */
  step_samples = static_cast<int>(kSampleRate * 0.15625f);
}

static void Step() {
  if (step & 1) {
    /* The gate has to close before the vactrol falls, and it falls
     * slower the darker it gets, so the tail outlasts the gate. */
    west.NoteOff();
  } else {
    /* Velocity is how far the gate opens, not only how loud the note
     * is, so a soft note comes out darker as well as quieter. */
    const int n = (step >> 1) % 6;
    west.NoteOn(kNotes[n], (n % 3) ? 0.6f : 1.0f);
  }
  ++step;
}

void render(float* l, float* r, int from, int to) {
  int i = from;
  while (i < to) {
    if (countdown <= 0) {
      Step();
      countdown = step_samples;
    }
    int span = to - i;
    if (span > countdown) span = countdown;
    west.Process(l, r, i, i + span);
    i += span;
    countdown -= span;
  }
}`,
    needs: ['bellows/engines/westcoast.h'],
    parityRow: 'westcoast',
    parityRelRms: 2.75e-3,
    caveat: null,
  },
];
