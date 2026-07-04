/*
 * Theory and tuning: functional harmony with voice leading, negative
 * harmony, equal temperaments beyond 12, just intonation, and Scala files.
 */

import type { Example } from './types';

export const theoryExamples: Example[] = [
  {
    id: 'voice-led-progression',
    title: 'VOICE-LED PROGRESSION',
    category: 'THEORY + TUNING',
    description:
      'lib.buildProgression walks a functional-harmony weight matrix (predominants pull to dominants, dominants resolve home) and ends with a cadence. lib.voiceLead picks each chord voicing with minimal voice motion, and lib.chordToRoman labels every bar.',
    seed: 'cadence',
    code: `var scale = b.scale('C major');
var degrees = lib.buildProgression(b.rng('prog'), 8); // one degree per bar, cadence at the end
var triads = lib.diatonicTriads(scale);

// voice-lead the whole progression up front
var prev = [];
var plan = [];
for (var i = 0; i < degrees.length; i++) {
  var ch = triads[degrees[i]];
  prev = lib.voiceLead(prev, [ch.midi(4)], { low: 48, high: 79 });
  plan.push({ roman: lib.chordToRoman(ch, scale), name: lib.chordName(ch), notes: prev });
}
log('progression: ' + plan.map(function (p) { return p.roman; }).join(' '));

var pad = b.voice('va', { shape: 2, attack: 0.25, release: 1, cutoff: 2600, detune: 9 });
pad.gain(0.6);

var off = b.clock.at('1m', function (t, step) {
  var bar = plan[step % plan.length];
  pad.chord(bar.notes, { at: t, dur: '1m', vel: 0.6 });
  log('bar ' + (step % plan.length) + '  ' + bar.roman.padEnd(5) + ' ' + bar.name.padEnd(4) +
    '  ' + bar.notes.map(function (m) { return lib.noteName(m); }).join(' '));
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'negative-harmony',
    title: 'NEGATIVE HARMONY MIRROR',
    category: 'THEORY + TUNING',
    description:
      'lib.negativeHarmony reflects a midi note around the axis midway between the key root and its fifth, so in C the note C maps to G and E to Eb: major melodies come back minor. A phrase plays, then its exact reflection.',
    seed: 'mirror',
    code: `var keyRoot = lib.parseNote('C4');
var phrase = ['C4', 'E4', 'G4', 'E4', 'A4', 'G4', 'F4', 'E4'].map(lib.parseNote);
var mirror = phrase.map(function (m) { return lib.negativeHarmony(m, keyRoot); });

log('phrase: ' + phrase.map(function (m) { return lib.noteName(m); }).join(' '));
log('mirror: ' + mirror.map(function (m) { return lib.noteName(m, true); }).join(' '));

var inst = b.voice('pluck', { decay: 2.5, damp: 0.3 });
inst.gain(0.85);
var drone = b.voice('va', { shape: 3, attack: 0.5, release: 1, sustain: 1 });
drone.gain(0.3);
var droneId = drone.on('C3', 0.5); // hold the key center under both halves
onCleanup(function () { drone.off(droneId); });

var off = b.clock.at('8n', function (t, step) {
  var s = step % 16;
  if (s === 0) log('> original');
  if (s === 8) log('> reflection');
  var src = s < 8 ? phrase : mirror;
  inst.note(src[s % 8], { at: t, dur: '8n', vel: 0.85 });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'edo19-walk',
    title: '19-EDO SCALE WALK',
    category: 'THEORY + TUNING',
    description:
      'Set b.tuning to lib.Tuning.edo(19) and note numbers become 19-EDO indices: each step is 63.2 cents and index 69 still lands on 440 Hz. A major-like walk in 19-EDO steps sounds almost familiar, with sweeter thirds.',
    seed: 'edo19',
    code: `b.tuning = lib.Tuning.edo(19);
log('19-EDO: ' + (1200 / 19).toFixed(1) + ' cents per step, index 69 = 440 Hz');

// major-like scale in 19-EDO steps: 0 3 6 8 11 14 17 (19 = octave)
var steps = [0, 3, 6, 8, 11, 14, 17, 19];
var base = 50; // 19 steps below 440, so one octave down

var inst = b.voice('additive', { decay: 2.5, rolloff: 0.7 });
inst.gain(0.8);

var off = b.clock.at('8n', function (t, step) {
  var s = step % 16;
  // walk up then down
  var idx = base + steps[s < 8 ? s : 15 - s];
  inst.note(idx, { at: t, dur: '8n', vel: 0.8 });
  log('index ' + idx + '  ' + b.freqOf(idx).toFixed(1) + ' Hz');
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'ji-vs-12edo',
    title: 'JUST VS 12-EDO BEATING',
    category: 'THEORY + TUNING',
    description:
      'A just major third is the ratio 5/4 (386.3 cents); 12-EDO stretches it to 400. Over a sine root the just third locks in while the tempered third beats audibly. The two alternate every two bars with their cent values logged.',
    seed: 'commas',
    code: `var root = 220; // A3
var inst = b.voice('va', { shape: 3, attack: 0.05, release: 0.3, sustain: 1, detune: 0 });
inst.gain(0.6);

var held = [];
var off = b.clock.at('2m', function (t, step) {
  // release the previous pair
  for (var i = 0; i < held.length; i++) inst.off(held[i], t);
  held = [];

  var just = step % 2 === 0;
  var third = just ? root * 5 / 4 : root * Math.pow(2, 4 / 12);
  var cents = 1200 * Math.log2(third / root);
  log((just ? 'JUST 5/4     ' : '12-EDO third ') + cents.toFixed(1) + ' cents  ' +
    third.toFixed(2) + ' Hz' + (just ? '  (locked)' : '  (beats ~' + Math.abs(third - root * 1.25).toFixed(1) + ' Hz vs 5/4)'));

  held.push(inst.on({ hz: root }, 0.5, t));
  held.push(inst.on({ hz: third }, 0.45, t));
});
onCleanup(off);
onCleanup(function () {
  for (var i = 0; i < held.length; i++) inst.off(held[i]);
});
b.start();`,
  },
  {
    id: 'scala-import',
    title: 'SCALA IMPORT',
    category: 'THEORY + TUNING',
    description:
      'lib.parseScl reads a Scala .scl file (here embedded as a string) and lib.tuningFromScala turns it into a Tuning. The same melody plays a bar in 12-EDO, then the instrument retunes live to a five-limit just pentatonic.',
    seed: 'scala',
    code: `var sclText = [
  '! pent5.scl',
  'Five-limit just pentatonic',
  ' 5',
  ' 9/8',
  ' 5/4',
  ' 3/2',
  ' 5/3',
  ' 2/1',
].join('\\n');

var scl = lib.parseScl(sclText);
log('scl: "' + scl.description + '" // ' + scl.size + ' notes per octave');
for (var i = 0; i < scl.notes.length; i++) log('  degree ' + (i + 1) + '  ' + scl.notes[i].toFixed(1) + ' cents');

var justTuning = lib.tuningFromScala(scl); // degree 0 on key 60, 440 Hz anchor
var inst = b.voice('pluck', { decay: 2.2 });
inst.gain(0.85);

// with a 5-note period, consecutive indices step through the scl degrees
var walk = [60, 61, 62, 63, 64, 65, 64, 62];

var off = b.clock.at('8n', function (t, step) {
  if (step % 8 === 0) {
    var just = (step / 8) % 2 === 1;
    b.tuning = just ? justTuning : lib.Tuning.edo(12); // retune live
    log(just ? '> retuned: just pentatonic' : '> 12-EDO (indices are midi notes)');
  }
  var idx = walk[step % 8];
  inst.note(idx, { at: t, dur: '8n', vel: 0.85 });
});
onCleanup(off);
b.start();`,
  },
];
