/*
 * Effects: sends and inserts, tape character, dynamics, spectral
 * processing, frequency shifting, and saturation.
 */

import type { Example } from './types';

export const effectExamples: Example[] = [
  {
    id: 'send-architecture',
    title: 'SEND ARCHITECTURE',
    category: 'EFFECTS',
    description:
      'b.bus builds a wet return chain (mix 1 inside the bus), and instrument.send sets how much of a channel feeds it. The same phrase alternates between bone dry and sent to both a ping-pong delay and a long reverb.',
    seed: 'sends',
    code: `// two wet buses: chains run at mix 1, send levels do the blending
var delay = b.bus([['delay', { timeL: 0.375, timeR: 0.5, feedback: 0.45, mix: 1 }]]);
var verb = b.bus([['fdn', { decay: 5, damp: 4500, mix: 1 }]]);

var inst = b.voice('pluck', { decay: 1.2, damp: 0.25 });
inst.gain(0.85);
inst.send(delay, 0);
inst.send(verb, 0);

var scale = b.scale('D minor pentatonic');
var line = [0, 4, 2, 5, 3, 7, 4, 2];

var off = b.clock.at('8n', function (t, step) {
  if (step % 16 === 0) {
    var wet = (step / 16) % 2 === 1;
    inst.send(delay, wet ? 0.5 : 0);
    inst.send(verb, wet ? 0.6 : 0);
    log(wet ? 'B // delay send 0.5, reverb send 0.6' : 'A // dry');
  }
  if (step % 2 === 0) {
    inst.note({ degree: line[(step / 2) % 8], octave: 4 }, { at: t, dur: '8n', vel: 0.85 }, scale);
  }
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'tape-delay',
    title: 'TAPE DELAY CHARACTER',
    category: 'EFFECTS',
    description:
      'The tapeDelay effect models a worn tape loop: wow and flutter modulate the transport speed, saturation squashes the repeats. A sparse phrase repeats while both wobble params sweep from pristine to broken.',
    seed: 'tape',
    code: `var inst = b.voice('pluck', { decay: 1.4, pickPos: 0.18 });
inst.gain(0.85);
inst.fx(['tapeDelay', {
  time: 0.42, feedback: 0.55, mix: 0.5,
  saturation: 0.6, tone: 4000,
  wow: 0, flutter: 0,
}]);

var notes = ['A3', null, 'C4', null, null, 'E4', null, 'G4'];

var off = b.clock.at('8n', function (t, step) {
  // sweep wow and flutter up over 8 bars, then reset
  var ph = (step % 64) / 64;
  inst.fxParam(0, 'wow', ph);
  inst.fxParam(0, 'flutter', ph * 0.8);
  if (step % 8 === 0) {
    log('wow ' + ph.toFixed(2) + '  flutter ' + (ph * 0.8).toFixed(2) +
      (ph < 0.15 ? '  (clean)' : ph > 0.8 ? '  (dying tape)' : ''));
  }
  var n = notes[step % 8];
  if (n) inst.note(n, { at: t, dur: '8n', vel: 0.85 });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'dynamics-ab',
    title: 'DYNAMICS CHAIN A/B',
    category: 'EFFECTS',
    description:
      'b.masterFx puts a compressor across the whole mix. Every four bars its mix param toggles between bypass and 8:1 with +8 dB makeup, so you hear exactly what the box does to the groove. Master fx params ride the structural message channel.',
    seed: 'squash',
    code: `// a compressor across the master bus, starting bypassed (mix 0)
b.masterFx(['compressor', {
  threshold: -24, ratio: 8, attack: 0.003, release: 0.15,
  knee: 4, makeup: 8, mix: 0,
}]);

var kick = b.voice('kick', { decay: 0.32, drive: 2 });
var snare = b.voice('snare', { decay: 0.16 });
var hat = b.voice('hat', { decay: 0.05 });
hat.gain(0.6);

var off = b.clock.at('16n', function (t, step) {
  var s = step % 16;
  if (step % 64 === 0) {
    var on = (step / 64) % 2 === 1;
    // master chain params are set with a structural message
    b.structural({ type: 'masterFxParam', fxIndex: 0, name: 'mix', value: on ? 1 : 0 });
    log(on ? 'B // compressed 8:1, makeup +8 dB' : 'A // bypass');
  }
  if (s === 0 || s === 7 || s === 10) kick.note('C2', { at: t, dur: '16n', vel: 0.95 });
  if (s === 4 || s === 12) snare.note('D3', { at: t, dur: '16n', vel: 0.8 });
  if (s % 2 === 0) hat.note('F#4', { at: t, dur: '16n', vel: s % 4 === 0 ? 0.7 : 0.4 });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'spectral-freeze',
    title: 'SPECTRAL FREEZE PAD',
    category: 'EFFECTS',
    description:
      'The freeze effect captures the current STFT frame and holds it forever when its freeze param goes to 1. A chord sounds for one bar, freezes into an infinite pad for two, then thaws for the next chord.',
    seed: 'freeze',
    code: `var pad = b.voice('va', { shape: 2, attack: 0.15, release: 0.6, sustain: 1, detune: 12 });
pad.gain(0.6);
pad.fx(['freeze', { freeze: 0, mix: 1 }]);

var chords = [
  ['A2', 'E3', 'C4', 'B4'],
  ['F2', 'C3', 'A3', 'G4'],
  ['D2', 'A2', 'F3', 'E4'],
];

var off = b.clock.at('1m', function (t, step) {
  var phase = step % 4;
  if (phase === 0) {
    pad.fxParam(0, 'freeze', 0);
    var ch = chords[Math.floor(step / 4) % chords.length];
    pad.chord(ch, { at: t, dur: '1m', vel: 0.6 });
    log('thawed // chord ' + ch.join(' '));
  }
  if (phase === 1) {
    pad.fxParam(0, 'freeze', 1);
    log('FROZEN // holding the last spectrum');
  }
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'freqshift-drone',
    title: 'FREQUENCY SHIFTER DRONE',
    category: 'EFFECTS',
    description:
      'Unlike a pitch shifter, freqshift adds a fixed Hz offset to every partial, destroying harmonic ratios into bell-like inharmonicity. A two-note drone holds while the shift sweeps slowly between -120 and +120 Hz.',
    seed: 'shifter',
    code: `var drone = b.voice('va', { shape: 0, detune: 10, cutoff: 1400, sustain: 1, attack: 0.4 });
drone.gain(0.55);
drone.fx(['freqshift', { shift: 0, mix: 0.55 }]);

var ids = [drone.on('A2', 0.6), drone.on('E3', 0.5)];
onCleanup(function () { drone.off(ids[0]); drone.off(ids[1]); });

var off = b.clock.at('16n', function (t, step) {
  // one full sweep every 8 bars
  var shift = 120 * Math.sin((step % 128) / 128 * Math.PI * 2);
  drone.fxParam(0, 'shift', shift);
  if (step % 16 === 0) {
    log('shift ' + shift.toFixed(1) + ' Hz' + (Math.abs(shift) < 10 ? '  (near harmonic)' : '  (inharmonic)'));
  }
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'saturator-stages',
    title: 'SATURATOR DRIVE STAGES',
    category: 'EFFECTS',
    description:
      'The saturator waveshapes with a drive from 0.1 to 20. The same sub-heavy riff climbs through four drive stages, two bars each, with the output trimmed as drive rises so loudness stays comparable and only the harmonics change.',
    seed: 'drive',
    code: `var inst = b.voice('va', { shape: 0, sub: 0.6, cutoff: 900, decay: 0.3, sustain: 0.5, release: 0.1 });
inst.gain(0.8);
inst.fx(['saturator', { drive: 0.5, tone: 0, output: 0 }]);

var stages = [
  { drive: 0.5, trim: 0,   label: 'clean' },
  { drive: 2,   trim: -3,  label: 'warm' },
  { drive: 6,   trim: -8,  label: 'driven' },
  { drive: 16,  trim: -14, label: 'scorched' },
];
var riff = [0, 0, 3, 0, 5, 3, 0, 7];
var scale = b.scale('E minor');

var off = b.clock.at('8n', function (t, step) {
  if (step % 16 === 0) {
    var st = stages[Math.floor(step / 16) % stages.length];
    inst.fxParam(0, 'drive', st.drive);
    inst.fxParam(0, 'output', st.trim);
    log('drive ' + st.drive + '  output ' + st.trim + ' dB  // ' + st.label);
  }
  inst.note({ degree: riff[step % 8], octave: 1 }, { at: t, dur: '16n', vel: 0.9 }, scale);
});
onCleanup(off);
b.start();`,
  },
];
