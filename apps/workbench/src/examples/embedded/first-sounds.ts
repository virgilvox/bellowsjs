/*
 * First sounds on a microcontroller: an oscillator, a frequency, an
 * envelope, a filter, an LFO, and noise. Nothing here uses an engine or
 * the kernel. It is the rung below all of that, and every one of these
 * snippets is a whole program: includes, statics, setup, render.
 */

import type { EmbeddedExample } from './types';

export const fsExamples: EmbeddedExample[] = [
  {
    id: 'fs-a-tone',
    title: 'A TONE',
    category: 'FIRST SOUNDS',
    description:
      'One oscillator, one frequency, straight into the block. There is no envelope and no note, so it starts when the board powers up and runs until the board stops. The += is the whole contract: the caller clears the block, everything that makes sound adds into it, so two voices can share one buffer without a mix pass.',
    seed: 'fs-tone',
    code: `// engine bodies are serialized into the audio worklet, so they cannot
// reach the library's BlepOsc. This is the same idea written out: one
// phase, one increment per sample.
b.defEngine({
  id: 'tone',
  label: 'Tone',
  params: [],
  polyphony: 1,
  createVoice: function (sampleRate) {
    var phase = 0, inc = 0, on = false;
    return {
      noteOn: function (freq) { inc = freq / sampleRate; on = true; },
      noteOff: function () { on = false; },
      setParam: function () {},
      process: function (l, r, from, to) {
        for (var i = from; i < to; i++) {
          var s = on ? (2 * phase - 1) * 0.2 : 0;   // naive saw, -1 to 1
          phase += inc;
          if (phase >= 1) phase -= 1;
          l[i] += s;                                // ADD, never assign
          r[i] += s;
        }
      },
      get active() { return on; },
    };
  },
});

var osc = b.voice('tone');
var id = osc.on({ hz: 220 }, 1);
osc.off(id, b.now() + 4);
onCleanup(function () { osc.allOff(); });

log('220 Hz saw for 4 seconds. no envelope: it is on or it is off');`,
    cpp: `#include "bellows/dsp/oscillators.h"

static bellows::BlepOsc osc;

void setup() {
  osc.Init(kSampleRate);
  osc.SetFreq(220.0f);
}

void render(float* l, float* r, int from, int to) {
  for (int i = from; i < to; ++i) {
    /* ProcessSaw() rather than Process(): naming one shape at the call
     * site leaves the BLAMP residual table unreferenced, and the linker
     * drops it. Process() names all four shapes and keeps both tables. */
    float s = osc.ProcessSaw() * 0.2f;
    l[i] += s;
    r[i] += s;
  }
}`,
    needs: ['bellows/dsp/oscillators.h'],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'The browser voice is a naive saw, so it aliases above a few kHz. BlepOsc subtracts a band-limited step at every discontinuity and does not.',
  },
  {
    id: 'fs-change-the-pitch',
    title: 'CHANGE THE PITCH',
    category: 'FIRST SOUNDS',
    description:
      'The same oscillator, stepping through eight frequencies a quarter second apart. SetFreq takes Hz because an oscillator only knows its phase and how far to move it each sample: note names, MIDI notes, scales and tunings all live a layer above and hand it a number. SetFreq changes the increment and leaves the phase alone, which is why the steps do not click.',
    seed: 'fs-pitch',
    code: `// a frequency param is the browser's SetFreq: param() events are
// scheduled and land on the exact sample, same as the C++ counter.
b.defEngine({
  id: 'sweep',
  label: 'Sweep',
  params: [{ name: 'hz', min: 20, max: 4000, default: 220 }],
  polyphony: 1,
  createVoice: function (sampleRate, params) {
    var hz = params.hz === undefined ? 220 : params.hz;
    var phase = 0, on = false;
    return {
      noteOn: function (freq) { hz = freq; on = true; },
      noteOff: function () { on = false; },
      setParam: function (name, value) { if (name === 'hz') hz = value; },
      process: function (l, r, from, to) {
        var inc = hz / sampleRate;   // phase is untouched, so no click
        for (var i = from; i < to; i++) {
          var s = on ? (2 * phase - 1) * 0.2 : 0;
          phase += inc;
          if (phase >= 1) phase -= 1;
          l[i] += s;
          r[i] += s;
        }
      },
      get active() { return on; },
    };
  },
});

var steps = [220, 247, 262, 294, 330, 349, 392, 440];
var osc = b.voice('sweep');
var t = b.now() + 0.1;
var id = osc.on({ hz: steps[0] }, 1);

// one scheduled param event per step: the browser's SetFreq
for (var i = 1; i < steps.length; i++) osc.param('hz', steps[i], t + i * 0.25);
osc.off(id, t + steps.length * 0.25);
onCleanup(function () { osc.allOff(); });

log('A minor up the scale, in Hz: ' + steps.join(' '));`,
    cpp: `#include "bellows/dsp/oscillators.h"

static bellows::BlepOsc osc;

/* Hz, not note numbers. An oscillator knows two things: its phase and how
 * far to move it each sample. Note names, MIDI notes and scale degrees are
 * a layer above, and they all become Hz before they reach here. */
static const float kSteps[8] = {220.0f, 247.0f, 262.0f, 294.0f,
                                330.0f, 349.0f, 392.0f, 440.0f};
static int step = 0;
static int samples_per_step = 0;
static int countdown = 0;

void setup() {
  osc.Init(kSampleRate);
  osc.SetFreq(kSteps[0]);
  samples_per_step = static_cast<int>(kSampleRate * 0.25f);
  countdown = samples_per_step;
}

void render(float* l, float* r, int from, int to) {
  for (int i = from; i < to; ++i) {
    if (--countdown <= 0) {
      step = (step + 1) & 7;
      /* SetFreq only changes the phase increment. The phase itself is
       * untouched, so the waveform is continuous and the step is silent. */
      osc.SetFreq(kSteps[step]);
      countdown = samples_per_step;
    }
    float s = osc.ProcessSaw() * 0.2f;
    l[i] += s;
    r[i] += s;
  }
}`,
    needs: ['bellows/dsp/oscillators.h'],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'Same naive saw as the previous example. The browser side also reads its frequency once per block rather than once per sample, so a step can land up to one block late.',
  },
  {
    id: 'fs-a-note',
    title: 'A NOTE',
    category: 'FIRST SOUNDS',
    description:
      'An Adsr multiplies the oscillator, so the tone starts and stops instead of running forever. Set(a, d, s, r) takes attack, decay, sustain, release: three of those are times in seconds and sustain is a level from 0 to 1, the level the envelope settles to and holds. Nothing in the envelope decides how long a note lasts. Trigger() starts it and Release() ends it, and whatever calls those owns the timing.',
    seed: 'fs-note',
    code: `// va is this example's two units (a BLEP saw and an Adsr) plus a
// second oscillator and a ladder filter. Detune 0 and the cutoff parked
// high leave the envelope as the thing you hear.
var synth = b.voice('va', {
  shape: 0, detune: 0, sub: 0,
  cutoff: 18000, resonance: 0, envAmount: 0,
  attack: 0.01,      // seconds
  decay: 0.25,       // seconds
  sustain: 0.6,      // LEVEL, 0 to 1
  release: 0.4,      // seconds
});

var t = b.now() + 0.1;
for (var i = 0; i < 4; i++) {
  var start = t + i * 1.2;
  var id = synth.on('A2', 0.9, start);
  synth.off(id, start + 0.6);   // held for 600 ms, then release
}
onCleanup(function () { synth.allOff(); });

log('four A2 notes: 10 ms up, 250 ms down to 0.6, held, 400 ms out');
log('change sustain and the note gets louder, not longer');`,
    cpp: `#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/oscillators.h"

static bellows::BlepOsc osc;
static bellows::Adsr env;

static bool held = false;
static int countdown = 0;
static int hold_samples = 0;
static int gap_samples = 0;

void setup() {
  osc.Init(kSampleRate);
  osc.SetFreq(110.0f);

  env.Init(kSampleRate);
  /* attack 10 ms, decay 250 ms, sustain 0.6, release 400 ms.
   * Three of those are times. Sustain is a LEVEL, 0 to 1: the level the
   * envelope settles to after the decay and holds for as long as the note
   * is held. Nothing about it says how long the note lasts, because that
   * is decided by whoever calls Release(). */
  env.Set(0.01f, 0.25f, 0.6f, 0.4f);

  hold_samples = static_cast<int>(kSampleRate * 0.6f);
  gap_samples = static_cast<int>(kSampleRate * 0.5f);
  env.Trigger();
  held = true;
  countdown = hold_samples;
}

void render(float* l, float* r, int from, int to) {
  for (int i = from; i < to; ++i) {
    if (--countdown <= 0) {
      if (held) {
        env.Release();
        held = false;
        countdown = gap_samples;
      } else {
        env.Trigger();
        held = true;
        countdown = hold_samples;
      }
    }
    float s = osc.ProcessSaw() * env.Process() * 0.3f;
    l[i] += s;
    r[i] += s;
  }
}`,
    needs: ['bellows/dsp/envelopes.h', 'bellows/dsp/oscillators.h'],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'The browser side plays the va engine, which adds a second saw at unison and a ladder filter left wide open. The envelope is the same class with the same numbers; the tone around it is a little thicker.',
  },
  {
    id: 'fs-a-filter',
    title: 'A FILTER',
    category: 'FIRST SOUNDS',
    description:
      'A ladder lowpass with an envelope of its own, faster than the amp envelope. That difference is most of what a synth sounds like: the note opens bright, closes down while it is still sounding, and the pitch never changes. The filter envelope is applied in octaves above the base cutoff rather than in Hz, so the same setting means the same brightness at any note.',
    seed: 'fs-filter',
    code: `// va is a BLEP saw, a ladder filter and two Adsrs: the same parts as
// the C++, wired the same way. envAmount is the filter envelope depth in
// octaves above cutoff.
var synth = b.voice('va', {
  shape: 0, detune: 0, sub: 0,
  filterType: 0,        // 0 ladder, 1 svf
  cutoff: 180, resonance: 0.75,
  envAmount: 4.5,       // octaves
  fAttack: 0.002, fDecay: 0.18, fSustain: 0.15, fRelease: 0.2,
  attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.25,
});

var t = b.now() + 0.1;
for (var i = 0; i < 8; i++) {
  var start = t + i * 0.6;
  var id = synth.on('C2', 0.9, start);
  synth.off(id, start + 0.35);
}
onCleanup(function () { synth.allOff(); });

log('C2, cutoff 180 Hz opening 4.5 octaves and shutting again');
log('drop envAmount to 0 and it is a test tone again');`,
    cpp: `#include "bellows/core/fastmath.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/oscillators.h"

static bellows::BlepOsc osc;
static bellows::LadderFilter lpf;
static bellows::Adsr amp;
static bellows::Adsr feg;

/* Base cutoff, and how far above it the filter envelope reaches. */
static const float kBaseCutoff = 180.0f;
static const float kEnvOctaves = 4.5f;
static const float kResonance = 0.75f;

static bool held = false;
static int countdown = 0;
static int hold_samples = 0;
static int gap_samples = 0;
static int ctrl = 0;

void setup() {
  osc.Init(kSampleRate);
  osc.SetFreq(65.4f);
  lpf.Init(kSampleRate);

  amp.Init(kSampleRate);
  amp.Set(0.005f, 0.3f, 0.7f, 0.25f);

  /* The filter gets its own envelope, faster than the amp one. That
   * difference is most of what a synth sounds like: the note opens bright
   * and closes down while it is still sounding. */
  feg.Init(kSampleRate);
  feg.Set(0.002f, 0.18f, 0.15f, 0.2f);

  hold_samples = static_cast<int>(kSampleRate * 0.35f);
  gap_samples = static_cast<int>(kSampleRate * 0.25f);
  amp.Trigger();
  feg.Trigger();
  held = true;
  countdown = hold_samples;
}

void render(float* l, float* r, int from, int to) {
  for (int i = from; i < to; ++i) {
    if (--countdown <= 0) {
      if (held) {
        amp.Release();
        feg.Release();
        held = false;
        countdown = gap_samples;
      } else {
        amp.Trigger();
        feg.Trigger();
        held = true;
        countdown = hold_samples;
      }
    }

    const float f = feg.Process();
    /* Coefficients cost more than a sample does, so they move at control
     * rate: once every 16 samples, which is 3 kHz at 48k and far above
     * anything an envelope does. The engines in this library all do this. */
    if (--ctrl <= 0) {
      ctrl = 16;
      lpf.Set(kBaseCutoff * bellows::fm::Exp2(f * kEnvOctaves), kResonance);
    }

    float s = lpf.Process(osc.ProcessSaw()) * amp.Process() * 0.4f;
    l[i] += s;
    r[i] += s;
  }
}`,
    needs: [
      'bellows/core/fastmath.h',
      'bellows/dsp/envelopes.h',
      'bellows/dsp/filters.h',
      'bellows/dsp/oscillators.h',
    ],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'The browser side plays va, which is these four units with a second saw added at unison, so it is slightly thicker than one oscillator. Both update filter coefficients every 16 samples.',
  },
  {
    id: 'fs-vibrato',
    title: 'VIBRATO',
    category: 'FIRST SOUNDS',
    description:
      'An Lfo on the oscillator frequency. The depth is in cents, not Hz, because a cent is a ratio: 25 cents is a quarter of a semitone at every pitch, while 6 Hz of wobble is a quarter tone low down and nearly inaudible two octaves up. The LFO has to be advanced every sample, so only the frequency update, which costs an exponential, runs at control rate.',
    seed: 'fs-vibrato',
    code: `b.defEngine({
  id: 'vibrato',
  label: 'Vibrato tone',
  params: [
    { name: 'rate', min: 0.1, max: 12, default: 5.5 },
    { name: 'cents', min: 0, max: 100, default: 25 },
  ],
  polyphony: 1,
  createVoice: function (sampleRate, params) {
    var rate = params.rate === undefined ? 5.5 : params.rate;
    var cents = params.cents === undefined ? 25 : params.cents;
    var base = 220, phase = 0, lfo = 0, on = false;
    return {
      noteOn: function (freq) { base = freq; on = true; },
      noteOff: function () { on = false; },
      setParam: function (name, value) {
        if (name === 'rate') rate = value;
        if (name === 'cents') cents = value;
      },
      process: function (l, r, from, to) {
        for (var i = from; i < to; i++) {
          // cents are a ratio, so the wobble is the same interval at any pitch
          var hz = base * Math.pow(2, (Math.sin(2 * Math.PI * lfo) * cents) / 1200);
          var s = on ? (2 * phase - 1) * 0.2 : 0;
          phase += hz / sampleRate;
          if (phase >= 1) phase -= 1;
          lfo += rate / sampleRate;
          if (lfo >= 1) lfo -= 1;
          l[i] += s;
          r[i] += s;
        }
      },
      get active() { return on; },
    };
  },
});

var osc = b.voice('vibrato', { rate: 5.5, cents: 25 });
var id = osc.on({ hz: 220 }, 1);
osc.param('cents', 70, b.now() + 2.5);   // widen it halfway through
osc.off(id, b.now() + 5);
onCleanup(function () { osc.allOff(); });

log('220 Hz, 5.5 Hz vibrato, 25 cents. widens to 70 cents at 2.5 s');`,
    cpp: `#include "bellows/core/fastmath.h"
#include "bellows/dsp/lfo.h"
#include "bellows/dsp/oscillators.h"

static bellows::BlepOsc osc;
static bellows::Lfo lfo;

static const float kBaseHz = 220.0f;
/* Depth in cents, because a cent is a ratio and Hz is not. 25 cents is a
 * quarter of a semitone at every pitch. 6 Hz of wobble is a quarter tone
 * at A3 and almost nothing two octaves up, so a depth in Hz would make
 * the vibrato shrink as the player goes higher. */
static const float kDepthCents = 25.0f;

static int ctrl = 0;

void setup() {
  osc.Init(kSampleRate);
  osc.SetFreq(kBaseHz);
  lfo.Init(kSampleRate);
  lfo.SetShape(bellows::LfoShape::kSine);
  lfo.SetFreq(5.5f);
}

void render(float* l, float* r, int from, int to) {
  for (int i = from; i < to; ++i) {
    /* Process() every sample, because the LFO advances its phase there
     * and calling it less often would slow it down. Only the frequency
     * update, which costs an Exp2, runs at control rate. */
    const float mod = lfo.Process();
    if (--ctrl <= 0) {
      ctrl = 16;
      osc.SetFreq(kBaseHz * bellows::fm::CentsRatio(mod * kDepthCents));
    }
    float s = osc.ProcessSaw() * 0.2f;
    l[i] += s;
    r[i] += s;
  }
}`,
    needs: ['bellows/core/fastmath.h', 'bellows/dsp/lfo.h', 'bellows/dsp/oscillators.h'],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'The browser voice is a naive saw with a hand written sine LFO, and it recomputes the frequency every sample instead of every 16. The depth in cents is the part that matches.',
  },
  {
    id: 'fs-noise',
    title: 'NOISE',
    category: 'FIRST SOUNDS',
    description:
      'NoiseGen through a bandpass: hiss with a shape, which is where wind, breath and cymbals start. Pink falls 3 dB per octave and sits closer to how most real whooshing things measure than flat white does. NoiseGen holds its Rng by pointer instead of owning one, so the noise belongs to a stream you named and can reproduce, and the same label in the browser library draws the same numbers.',
    seed: 'fs-wind',
    code: `// the noise engine is exactly these two units: a NoiseGen into an Svf,
// with envelopes around them. resonance 0.26 is the engine's mapping of
// q = 3, and sustain 1 holds it steady.
var wind = b.voice('noise', {
  color: 1,           // 0 white, 1 pink, 2 brown, 3 velvet, 4 crackle
  filterMode: 1,      // 0 lowpass, 1 bandpass, 2 highpass
  cutoff: 900,
  resonance: 0.26,
  envAmount: 0,
  attack: 0.8, decay: 0.1, sustain: 1, release: 2,
});

var id = wind.on('A3', 0.9);
wind.off(id, b.now() + 5);
onCleanup(function () { wind.allOff(); });

log('pink noise through a bandpass at 900 Hz');
log('put the LFO from the vibrato example on that cutoff: wind');`,
    cpp: `#include "bellows/core/prng.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/noise.h"

/* NoiseGen holds the Rng by pointer rather than owning one, so the noise
 * in a patch belongs to a stream you named and can reproduce. The same
 * label in the browser library draws the same numbers. */
static bellows::Rng rng;
static bellows::NoiseGen noise;
static bellows::Svf bp;

void setup() {
  rng.Init("wind");
  /* White is flat per Hz, which reads as hiss. Pink falls 3 dB per
   * octave, which is what most things that whoosh actually look like. */
  noise.Init(kSampleRate, bellows::NoiseColor::kPink, &rng);

  bp.Init(kSampleRate);
  bp.SetMode(bellows::SvfMode::kBp);
  bp.Set(900.0f, 3.0f);
}

void render(float* l, float* r, int from, int to) {
  for (int i = from; i < to; ++i) {
    float s = bp.Process(noise.Process()) * 0.5f;
    l[i] += s;
    r[i] += s;
  }
}`,
    needs: ['bellows/core/prng.h', 'bellows/dsp/filters.h', 'bellows/dsp/noise.h'],
    parityRow: null,
    parityRelRms: null,
    caveat:
      'The browser side fades in and out with an amp envelope; the C++ runs from power on. The noise generator and the filter are the same two units with the same settings.',
  },
];
