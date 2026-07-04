/*
 * First sounds: the smallest possible paths into the library. One-line
 * notes, scales and chords through the clock, and the seeded rng.
 */

import type { Example } from './types';

export const firstSounds: Example[] = [
  {
    id: 'hello-note',
    title: 'HELLO NOTE',
    category: 'FIRST SOUNDS',
    description:
      'The shortest path to sound: b.voice(engineId) makes an instrument channel, .note() plays it. Three engines, one line each, staggered half a second apart with the at option.',
    seed: 'hello',
    code: `// b.voice(engineId) creates an instrument. .note() plays one note.
// Note values: 'C3' names, midi numbers, { hz }, or scale degrees.
b.voice('va').note('C3', { dur: '4n', vel: 0.9 });

// schedule later notes with at, in absolute engine seconds
b.voice('fm').note('E4', { at: b.now() + 0.5, dur: '4n', vel: 0.8 });
b.voice('pluck').note('G4', { at: b.now() + 1.0, dur: '2n', vel: 0.9 });

log('va C3 now // fm E4 at +0.5s // pluck G4 at +1s');
log('edit anything and press RUN again');`,
  },
  {
    id: 'chords-scales',
    title: 'CHORDS + SCALES',
    category: 'FIRST SOUNDS',
    description:
      'b.scale() builds a rooted Scale, lib.diatonicTriads stacks a triad on every degree, and b.clock.at fires a callback ahead of each bar with the exact tick time. Each chord is strummed by offsetting the at times.',
    seed: 'strum',
    code: `var scale = b.scale('E minor');
var triads = lib.diatonicTriads(scale); // one chord per scale degree
var order = [0, 5, 3, 4];               // i VI iv v

var inst = b.voice('va', { shape: 2, attack: 0.02, release: 0.6, cutoff: 3500 });
inst.gain(0.7);

// clock.at fires ahead of every subdivision; t is the exact tick time
// in seconds, ready to pass straight to note({ at: t })
var off = b.clock.at('1m', function (t, step) {
  var ch = triads[order[step % order.length]];
  var notes = ch.midi(3); // midi numbers, root in octave 3
  log('bar ' + step + '  ' + lib.chordName(ch) + '  ' +
    notes.map(function (m) { return lib.noteName(m); }).join(' '));
  // strum: stagger each chord tone by 30 ms
  for (var i = 0; i < notes.length; i++) {
    inst.note(notes[i], { at: t + i * 0.03, dur: '2n', vel: 0.7 });
  }
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'seeded-dice',
    title: 'SEEDED DICE',
    category: 'FIRST SOUNDS',
    description:
      'Every random decision draws from b.rng(label), a named stream forked off the piece seed. The same seed and label always produce the same numbers, so a run is exactly reproducible: press RUN twice and compare.',
    seed: 'dice-042',
    code: `// b.rng(label) returns a deterministic stream tied to the piece seed
var red = b.rng('red');
var rollsA = [];
for (var i = 0; i < 8; i++) rollsA.push(1 + red.int(6));
log('red stream      : ' + rollsA.join(' '));

// asking for the same label returns the SAME stream, already advanced
var same = b.rng('red');
var rollsB = [];
for (i = 0; i < 8; i++) rollsB.push(1 + same.int(6));
log('red, continued  : ' + rollsB.join(' '));

// fork() derives an independent child stream, also reproducible
var blue = red.fork('blue');
var rollsC = [];
for (i = 0; i < 8; i++) rollsC.push(1 + blue.int(6));
log('red::blue fork  : ' + rollsC.join(' '));
log('press RUN again: every line repeats exactly');

// play the first batch as pitches so you can hear the seed
var scale = b.scale('C major pentatonic');
var inst = b.voice('pluck', { decay: 2 });
for (i = 0; i < rollsA.length; i++) {
  inst.note({ degree: rollsA[i], octave: 4 }, { at: b.now() + i * 0.16, dur: '8n', vel: 0.8 }, scale);
}`,
  },
];
