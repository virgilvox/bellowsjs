/*
 * Sequencing: euclid, markov walks, l-systems, cellular automata,
 * arpeggiators, pattern combinators, and transport control.
 */

import type { Example } from './types';

export const sequencingExamples: Example[] = [
  {
    id: 'euclid-lab',
    title: 'EUCLIDEAN GROOVE LAB',
    category: 'SEQUENCING',
    description:
      'b.euclid(steps, pulses, rotation) spreads pulses as evenly as possible. Every two bars the kick pattern re-rolls its pulse count and rotation from a seeded rng while a steady hat keeps the grid audible.',
    seed: 'euclid-lab',
    code: `var kick = b.voice('kick', { decay: 0.3, drive: 2.5 });
var hat = b.voice('hat', { decay: 0.04 });
hat.gain(0.45);

var dice = b.rng('lab');
var pulses = 5, rot = 0;
var pattern = b.euclid(16, pulses, rot);
log('E(16,' + pulses + ',' + rot + ')  ' + pattern.map(function (g) { return g ? '#' : '.'; }).join(''));

var off = b.clock.at('16n', function (t, step) {
  var s = step % 16;
  // re-roll the pattern every two bars, live
  if (s === 0 && step > 0 && (step / 16) % 2 === 0) {
    pulses = 3 + dice.int(8);   // 3..10 pulses
    rot = dice.int(16);
    pattern = b.euclid(16, pulses, rot);
    log('E(16,' + pulses + ',' + rot + ')  ' + pattern.map(function (g) { return g ? '#' : '.'; }).join(''));
  }
  hat.note('F#4', { at: t, dur: '16n', vel: s % 4 === 0 ? 0.7 : 0.35 });
  if (pattern[s]) kick.note('C2', { at: t, dur: '16n', vel: 0.95 });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'markov-melody',
    title: 'MARKOV MELODY + CHORD GRAVITY',
    category: 'SEQUENCING',
    description:
      'lib.buildStepwiseMatrix makes a transition matrix over scale positions that favors stepwise motion; lib.weightedWalk steps through it. A gravity set of the current chord tones multiplies their weights, pulling the walk toward the harmony without forcing it.',
    seed: 'markov',
    code: `var scale = b.scale('A minor');
var positions = scale.degrees(2, 3); // 14 midi notes, two octaves from A3
var matrix = lib.buildStepwiseMatrix(positions, b.rng('matrix'));
var triads = lib.diatonicTriads(scale);
var bars = [0, 3, 4, 0]; // i iv v i

var lead = b.voice('pluck', { damp: 0.3, decay: 2 });
var pad = b.voice('va', { shape: 2, attack: 0.4, release: 0.8, cutoff: 1800 });
pad.gain(0.35);
lead.gain(0.85);

var walk = b.rng('walk');
var pos = 0;

var off = b.clock.at('8n', function (t, step) {
  var chord = triads[bars[Math.floor(step / 8) % bars.length]];
  if (step % 8 === 0) {
    pad.chord(chord.midi(3), { at: t, dur: '1m', vel: 0.5 });
    log('bar ' + step / 8 + '  chord ' + lib.chordName(chord));
  }
  // gravity: positions whose pitch class is a chord tone
  var gravity = new Set();
  for (var i = 0; i < positions.length; i++) {
    var pc = ((positions[i] - chord.root) % 12 + 12) % 12;
    if (chord.intervals.indexOf(pc) >= 0) gravity.add(i);
  }
  pos = lib.weightedWalk(matrix, pos, walk, gravity, 3);
  lead.note(positions[pos], { at: t, dur: '8n', vel: 0.8 });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'lsystem-melody',
    title: 'L-SYSTEM MELODY',
    category: 'SEQUENCING',
    description:
      'lib.lsystem rewrites every symbol in parallel each generation; lib.mapToDegrees turns the result into scale degrees (null is a rest). Four generations of a three-rule grammar yield a self-similar phrase, printed before it plays.',
    seed: 'lindenmayer',
    code: `// A grows, B echoes, C rests. Four generations from the axiom 'A'.
var grammar = { A: 'AB', B: 'CA', C: 'BD', D: 'D' };
var str = lib.lsystem('A', grammar, 5);
log('expanded (' + str.length + ' symbols): ' + str.slice(0, 48) + (str.length > 48 ? '...' : ''));

// map symbols to scale degrees; D becomes a rest
var degrees = lib.mapToDegrees(str, { A: 0, B: 2, C: 4, D: null });
log('degrees: ' + degrees.slice(0, 24).map(function (d) { return d === null ? '.' : d; }).join(' '));

var scale = b.scale('C lydian');
var inst = b.voice('fm', { ops: 2, algorithm: 1, ratio2: 3, level2: 0.4, decay: 0.4 });
inst.gain(0.8);

var off = b.clock.at('8n', function (t, step) {
  var d = degrees[step % degrees.length];
  if (d === null) return; // rest
  // the grammar repeats its shape at different scales; shift register slowly
  var octave = 4 + (Math.floor(step / 32) % 2);
  inst.note({ degree: d, octave: octave }, { at: t, dur: '8n', vel: 0.8 }, scale);
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'ca-drums',
    title: 'CELLULAR AUTOMATA DRUMS',
    category: 'SEQUENCING',
    description:
      'lib.ElementaryCA runs Wolfram rule 110 on a 16-cell ring. Each 16th note reads three fixed columns as kick, snare, and hat gates, then steps the automaton. Rows print as # and . once per bar.',
    seed: 'rule-110',
    code: `var ca = new lib.ElementaryCA(110, 16); // rule 110, single center seed
var kick = b.voice('kick', { decay: 0.28 });
var snare = b.voice('snare', { decay: 0.15 });
var hat = b.voice('hat', { decay: 0.04 });
hat.gain(0.5);

function rowString(row) {
  var s = '';
  for (var i = 0; i < row.length; i++) s += row[i] ? '#' : '.';
  return s;
}

var off = b.clock.at('16n', function (t, step) {
  if (step % 16 === 0) log('gen ' + ca.generation + '  ' + rowString(ca.row));
  // three columns of the ring are the three drum lanes
  if (ca.row[3]) kick.note('C2', { at: t, dur: '16n', vel: 0.95 });
  if (ca.row[8]) snare.note('D3', { at: t, dur: '16n', vel: 0.75 });
  if (ca.row[13]) hat.note('F#4', { at: t, dur: '16n', vel: 0.55 });
  ca.step(); // advance one generation per 16th
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'arp-modes',
    title: 'ARPEGGIATOR MODES',
    category: 'SEQUENCING',
    description:
      'lib.Arpeggiator traverses held notes in a chosen mode over an octave span. A Cm7 chord runs through all six modes, two bars each; updown and downup never repeat their endpoints.',
    seed: 'arp',
    code: `var modes = ['up', 'down', 'updown', 'downup', 'random', 'order'];
var chord = [60, 63, 67, 70]; // Cm7
var inst = b.voice('pluck', { decay: 1.5, pickPos: 0.15 });
inst.gain(0.85);

var dice = b.rng('arp'); // only 'random' mode consumes randomness
var arp = new lib.Arpeggiator({ mode: 'up', octaves: 2 });
arp.setNotes(chord);

var off = b.clock.at('16n', function (t, step) {
  if (step % 32 === 0) {
    var mode = modes[Math.floor(step / 32) % modes.length];
    arp = new lib.Arpeggiator({ mode: mode, octaves: 2 });
    arp.setNotes(chord);
    log('mode ' + mode);
  }
  inst.note(arp.next(dice), { at: t, dur: '16n', vel: step % 4 === 0 ? 0.9 : 0.65 });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'pattern-combinators',
    title: 'PATTERN COMBINATORS',
    category: 'SEQUENCING',
    description:
      'Step patterns compose: lib.seq builds a cycle, lib.every applies a transform on every nth cycle (here rev), and lib.sometimes lifts random steps an octave with a seeded mask. The first cycles print so you can compare plain vs transformed.',
    seed: 'patterns',
    code: `var base = lib.seq(0, 2, 4, 7, 9, 7, 4, 2);              // 8-step degree cycle
// every(4, rev) reverses cycles 0, 4, 8, ...; other cycles play plain
var flipped = lib.every(4, function (p) { return lib.rev(p); }, base);
var spiced = lib.sometimes(0.25, function (d) { return d + 7; }, flipped, b.rng('spice'));
var gate = lib.gates(b.euclid(8, 7, 0));                   // drop one step per cycle

function cycle(p, c) {
  var out = [];
  for (var i = 0; i < 8; i++) out.push(p.at(c * 8 + i));
  return out.join(' ');
}
log('base           : ' + cycle(base, 0));
log('spiced cycle 1 : ' + cycle(spiced, 1) + '   (plain, sometimes +7)');
log('spiced cycle 0 : ' + cycle(spiced, 0) + '   (reversed by every(4, rev))');

var scale = b.scale('E minor pentatonic');
var inst = b.voice('va', { shape: 1, cutoff: 2500, decay: 0.2, sustain: 0.3, release: 0.1 });
inst.gain(0.75);

var off = b.clock.at('8n', function (t, step) {
  if (step % 8 === 0) log('cycle ' + step / 8 + ((step / 8) % 4 === 0 ? ' (reversed)' : ''));
  if (!gate.at(step)) return;
  inst.note({ degree: spiced.at(step), octave: 3 }, { at: t, dur: '16n', vel: 0.8 }, scale);
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'tempo-curve',
    title: 'TEMPO CURVE RIDE',
    category: 'SEQUENCING',
    description:
      'b.bpm sets the tempo, b.rampBpm bends it linearly over a span of beats. A metronome (kick on the downbeat, hats elsewhere) rides a 90 to 150 bpm ramp across eight bars, logging the live bpm from the tempo map each bar.',
    seed: 'accelerando',
    code: `var kick = b.voice('kick', { decay: 0.25 });
var hat = b.voice('hat', { decay: 0.04 });
hat.gain(0.5);

b.bpm(90);
b.rampBpm(150, '8m'); // linear ramp over 8 bars, then hold

var off = b.clock.at('4n', function (t, step) {
  if (step % 4 === 0) {
    kick.note('C2', { at: t, dur: '16n', vel: 0.95 });
    var beat = b.transport.beatAt(t);
    log('bar ' + step / 4 + '  bpm ' + b.transport.tempo.bpmAt(beat).toFixed(1));
  } else {
    hat.note('F#4', { at: t, dur: '16n', vel: 0.6 });
  }
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'swing-ab',
    title: 'SWING A/B',
    category: 'SEQUENCING',
    description:
      'b.swing(amount, subdivision) delays every offbeat of the subdivision. Straight eighths alternate with 60 percent swing every four bars over an unchanging kick, which makes the shuffle easy to isolate by ear.',
    seed: 'shuffle',
    code: `var kick = b.voice('kick', { decay: 0.3 });
var hat = b.voice('hat', { decay: 0.05 });
var snare = b.voice('snare', { decay: 0.14 });
hat.gain(0.55);

var off = b.clock.at('8n', function (t, step) {
  if (step % 32 === 0) {
    var swung = (step / 32) % 2 === 1;
    b.swing(swung ? 0.6 : 0, '8n');
    log(swung ? 'B // swing 0.6 on 8ths' : 'A // straight');
  }
  hat.note('F#4', { at: t, dur: '16n', vel: step % 2 === 0 ? 0.85 : 0.45 });
  if (step % 8 === 0) kick.note('C2', { at: t, dur: '16n', vel: 0.9 });
  if (step % 8 === 4) snare.note('D3', { at: t, dur: '16n', vel: 0.7 });
});
onCleanup(off);
b.start();`,
  },
];
