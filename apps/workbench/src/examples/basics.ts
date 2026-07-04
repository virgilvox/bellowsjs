/*
 * The everyday recipes: the things everyone reaches for first in an audio
 * library. Short, heavily commented, no theory required. Each runs in the
 * code-mode sandbox as (b, lib, log, onCleanup) with a fresh seeded
 * Bellows instance.
 */

import type { Example } from './types';

export const basicsExamples: Example[] = [
  {
    id: 'play-a-note',
    title: 'PLAY A NOTE',
    category: 'BASICS',
    description:
      'The one-liner. Make an instrument, play middle C. Change the note name, the duration, or the velocity and press RUN again.',
    seed: 'basics-note',
    code: `// pick an engine (try: 'pluck', 'va', 'fm', 'modal', 'string')
var synth = b.voice('pluck');

// note names are 'C4' style. dur is musical time. vel is 0..1 loudness.
synth.note('C4', { dur: '2n', vel: 0.9 });

log('played C4 on pluck');
log('try changing pluck to modal, or C4 to G2');`,
  },
  {
    id: 'play-a-melody',
    title: 'PLAY A MELODY',
    category: 'BASICS',
    description:
      'Schedule several notes ahead of time with the at option. Times are in seconds; b.now() is the current engine time.',
    seed: 'basics-melody',
    code: `var synth = b.voice('pluck');

// a tune as note names, one every 0.3 seconds
var tune = ['C4', 'E4', 'G4', 'B4', 'A4', 'G4', 'E4', 'C4'];
var start = b.now() + 0.1;

for (var i = 0; i < tune.length; i++) {
  synth.note(tune[i], { at: start + i * 0.3, dur: '8n', vel: 0.8 });
}

log('scheduled ' + tune.length + ' notes');
log('every note lands sample-accurately, even if the page is busy');`,
  },
  {
    id: 'play-a-chord',
    title: 'PLAY A CHORD',
    category: 'BASICS',
    description:
      'Chords are just several notes at once. chord() takes an array; strum by offsetting each note a few milliseconds.',
    seed: 'basics-chord',
    code: `var synth = b.voice('va', { cutoff: 1200 });

// block chord: all at once
synth.chord(['C3', 'E3', 'G3', 'B3'], { dur: '1n', vel: 0.7 });

// strummed chord: stagger the starts slightly
var t = b.now() + 1.2;
var notes = ['A2', 'E3', 'A3', 'C#4', 'E4'];
for (var i = 0; i < notes.length; i++) {
  synth.note(notes[i], { at: t + i * 0.035, dur: '1n', vel: 0.7 });
}

log('Cmaj7 block, then A major strum');`,
  },
  {
    id: 'drum-beat',
    title: 'MAKE A DRUM BEAT',
    category: 'BASICS',
    description:
      'A basic rock beat: kick on 1 and 3, snare on 2 and 4, hats on eighths. The clock calls you ahead of every eighth note; pass its time straight into note().',
    seed: 'basics-beat',
    code: `var kick = b.voice('kick');
var snare = b.voice('snare');
var hat = b.voice('hat');
hat.gain(0.5);

b.bpm(100);

// step counts eighth notes: 0 1 2 3 4 5 6 7 per bar
var off = b.clock.at('8n', function (t, step) {
  var s = step % 8;
  if (s === 0 || s === 4) kick.note('C2', { at: t, vel: 0.95 });
  if (s === 2 || s === 6) snare.note('D2', { at: t, vel: 0.8 });
  hat.note('F#3', { at: t, vel: s % 2 === 0 ? 0.6 : 0.35 });
});
onCleanup(off);

b.start();
log('kick 1+3, snare 2+4, hats on eighths at 100 bpm');
log('press STOP when done. try changing the bpm or the pattern');`,
  },
  {
    id: 'volume-and-pan',
    title: 'VOLUME AND PAN',
    category: 'BASICS',
    description:
      'Every instrument has a channel with gain (0 to 1) and pan (-1 left to +1 right). Set them any time; changes ramp smoothly.',
    seed: 'basics-mix',
    code: `var left = b.voice('pluck');
var right = b.voice('pluck');

left.gain(0.9).pan(-0.9);   // loud, hard left
right.gain(0.45).pan(0.9);  // quieter, hard right

var t = b.now() + 0.1;
for (var i = 0; i < 6; i++) {
  left.note('C4', { at: t + i * 0.5, dur: '8n' });
  right.note('G4', { at: t + i * 0.5 + 0.25, dur: '8n' });
}

log('C4 loud on the left, G4 soft on the right');
log('gain and pan are click-free: they ramp over 20 ms');`,
  },
  {
    id: 'hold-a-note',
    title: 'HOLD AND RELEASE A NOTE',
    category: 'BASICS',
    description:
      'For notes without a fixed length, on() starts a note and returns an id; off(id) releases it later. This is how you wire a keyboard.',
    seed: 'basics-hold',
    code: `// tube is a blown pipe model: it sustains while held
var pipe = b.voice('tube');

var id = pipe.on('D3', 0.8);       // press
log('note on, holding for 2 seconds...');

var t = b.now() + 2;
pipe.off(id, t);                   // release at a scheduled time
log('release scheduled. the tail decays naturally');

// hold a second one shorter
var id2 = pipe.on('A3', 0.6, b.now() + 0.5);
pipe.off(id2, b.now() + 1.4);`,
  },
  {
    id: 'add-effects',
    title: 'ADD REVERB AND DELAY',
    category: 'BASICS',
    description:
      'fx() puts effects directly on an instrument. Buses share one effect between many instruments through send levels, like a mixing desk.',
    seed: 'basics-fx',
    code: `var synth = b.voice('pluck');

// insert effects: chained onto this instrument only
synth.fx(['tapeDelay', { time: 0.3, feedback: 0.4, mix: 0.3 }]);

// a shared reverb bus: any instrument can send to it
var verb = b.bus([['fdn', { decay: 2.5, mix: 1 }]], { level: 0.6 });
synth.send(verb, 0.5);

var t = b.now() + 0.1;
['C4', 'E4', 'G4'].forEach(function (n, i) {
  synth.note(n, { at: t + i * 0.6, dur: '8n', vel: 0.85 });
});

log('pluck through tape delay, sending half its signal to a reverb bus');
log('effect ids: delay tapeDelay multitap fdn plate chorus flanger phaser');
log('  compressor limiter gate eq saturator freqshift pitchshift freeze...');`,
  },
  {
    id: 'filter-sweep',
    title: 'TURN A KNOB (FILTER SWEEP)',
    category: 'BASICS',
    description:
      'param() changes an engine parameter, now or at a scheduled time. Here the va synth cutoff sweeps up while a bass note holds.',
    seed: 'basics-sweep',
    code: `var bass = b.voice('va', { shape: 0, cutoff: 200, resonance: 0.6 });

var id = bass.on('C2', 0.9);

// schedule a cutoff step every 100 ms: a staircase sweep
var t0 = b.now() + 0.2;
for (var i = 0; i <= 20; i++) {
  var hz = 200 * Math.pow(1.18, i);    // exponential rise
  bass.param('cutoff', hz, t0 + i * 0.1);
}

bass.off(id, t0 + 2.6);
log('cutoff sweeps 200 Hz to about 5.5 kHz over 2 seconds');
log('every engine lists its params: check the engine selector macros');`,
  },
  {
    id: 'metronome',
    title: 'METRONOME',
    category: 'BASICS',
    description:
      'A click on every beat, accented on the bar. Shows the clock, the transport, and tempo changes while running.',
    seed: 'basics-metronome',
    code: `var click = b.voice('hat', { decay: 0.03 });

b.bpm(90);

var off = b.clock.at('4n', function (t, step) {
  var accent = step % 4 === 0;
  click.note(accent ? 'A5' : 'A4', { at: t, vel: accent ? 1 : 0.5 });
  if (accent) log('bar ' + (step / 4 + 1));
});
onCleanup(off);

b.start();

// speed up after 4 bars, smoothly over 4 more
var timer = setTimeout(function () {
  b.rampBpm(140, '4m');
  log('ramping to 140 bpm over 4 bars...');
}, (60 / 90) * 16 * 1000);
onCleanup(function () { clearTimeout(timer); });`,
  },
  {
    id: 'random-melody',
    title: 'RANDOM MELODY FROM A SCALE',
    category: 'BASICS',
    description:
      'Pick random notes that always sound right by drawing scale degrees instead of raw pitches. Seeded: the same seed plays the same melody every run.',
    seed: 'basics-random',
    code: `var synth = b.voice('pluck');
var scale = b.scale('A minor');   // try 'C major', 'D dorian', 'E phrygian'
var dice = b.rng('melody');       // a named random stream from the seed

b.bpm(110);

var off = b.clock.at('8n', function (t, step) {
  // degree 0..6 in octave 4, occasionally resting
  if (dice.chance(0.8)) {
    var degree = dice.int(7);
    synth.note(scale.degreeToMidi(degree, 4), { at: t, dur: '8n', vel: 0.6 + dice() * 0.3 });
  }
});
onCleanup(off);

b.start();
log('random but musical: degrees of A minor, seeded by "basics-random"');
log('same seed, same melody. change the seed in the code panel and rerun');`,
  },
];
