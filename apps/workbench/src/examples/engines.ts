/*
 * Engine tours: one example per synthesis family, each leaning on the
 * params that define that engine's character. Param names come straight
 * from the engine defs in packages/bellows/src/engines.
 */

import type { Example } from './types';

export const engineExamples: Example[] = [
  {
    id: 'va-bass',
    title: 'VA BASS WORKOUT',
    category: 'ENGINES',
    description:
      'The virtual analog engine: two BLEP saws, a sub square, and a ladder filter with its own ADSR. envAmount opens the filter per note, drift adds slow analog pitch wander, and a saturator insert supplies drive.',
    seed: 'va-bass',
    code: `var bass = b.voice('va', {
  shape: 0,          // 0 saw, 1 square, 2 triangle, 3 sine
  sub: 0.6,          // square sub oscillator one octave down
  cutoff: 220,       // base cutoff, the envelope opens up from here
  resonance: 0.5,
  envAmount: 3.2,    // filter env depth in octaves
  fDecay: 0.16, fSustain: 0.05,
  decay: 0.25, sustain: 0.4, release: 0.08,
  drift: 0.35,       // slow random pitch walk per voice
});
bass.fx(['saturator', { drive: 4, tone: -0.2 }]); // insert drive
bass.gain(0.8);

var scale = b.scale('C minor');
var line = [0, 0, 7, 0, 3, 0, 5, 4]; // scale degrees, 7 wraps up an octave
var cutoffs = [180, 420, 900, 300];  // new base cutoff every bar

var off = b.clock.at('8n', function (t, step) {
  if (step % 8 === 0) {
    var cut = cutoffs[(step / 8) % cutoffs.length];
    bass.param('cutoff', cut, t);
    log('bar ' + step / 8 + '  cutoff ' + cut + ' Hz');
  }
  var vel = step % 4 === 0 ? 1 : 0.7;
  bass.note({ degree: line[step % 8], octave: 1 }, { at: t, dur: '16n', vel: vel }, scale);
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'fm-tour',
    title: 'FM ALGORITHM TOUR',
    category: 'ENGINES',
    description:
      'The FM engine ships the eight TX81Z-style four-operator algorithms. This cycles through all eight every two bars while a fixed phrase plays, so you hear the routing change under identical notes. The console names the current algorithm.',
    seed: 'fm-tour',
    code: `var inst = b.voice('fm', {
  ops: 4,
  algorithm: 1,   // 1..8, TX81Z style routing tables
  feedback: 0.25,
  brightness: 0.8,
  ratio2: 2, ratio3: 3.01, ratio4: 7,
  level2: 0.7, level3: 0.4, level4: 0.3,
  mDecay: 0.5, mSustain: 0.2,
});
inst.gain(0.75);

var shapes = ['1: serial 4>3>2>1', '2: 2>1, 4>3>1', '3: 3>2>1, 4>1',
  '4: 4>3>2, two carriers', '5: two stacks', '6: op4 mods three carriers',
  '7: 4>3, three carriers', '8: four parallel carriers'];
var phrase = ['A2', 'C3', 'E3', 'G3', 'A3', 'G3', 'E3', 'C3'];

var off = b.clock.at('8n', function (t, step) {
  if (step % 16 === 0) {
    var algo = 1 + ((step / 16) % 8);
    inst.param('algorithm', algo);
    log('ALGO ' + shapes[algo - 1]);
  }
  inst.note(phrase[step % 8], { at: t, dur: '8n', vel: 0.85 });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'additive-morph',
    title: 'ADDITIVE PARTIAL MORPH',
    category: 'ENGINES',
    description:
      'The additive engine holds 16 partial levels plus a second target set; the morph param crossfades between them. Here the start spectrum is sawtooth-like (1/n), the target keeps only odd partials (square-like), and a slow sine drives the morph.',
    seed: 'additive',
    code: `// partial1..16 is the start spectrum, target1..16 the morph destination
var params = { decay: 8, inharm: 0.0015, release: 0.5 };
for (var n = 1; n <= 16; n++) {
  params['partial' + n] = 1 / n;                    // saw-like: every partial
  params['target' + n] = n % 2 === 1 ? 1 / n : 0;   // square-like: odd only
}
var inst = b.voice('additive', params);
inst.gain(0.8);

// retrigger the note every two bars so the long decay keeps ringing
var off1 = b.clock.at('2m', function (t) {
  inst.note('A2', { at: t, dur: '2m', vel: 0.8 });
  inst.note('E3', { at: t, dur: '2m', vel: 0.5 });
});

// sweep morph 0 -> 1 -> 0 over four bars
var off2 = b.clock.at('16n', function (t, step) {
  var m = 0.5 - 0.5 * Math.cos((step % 64) / 64 * Math.PI * 2);
  inst.param('morph', m, t);
  if (step % 8 === 0) log('morph ' + m.toFixed(2) + (m < 0.1 ? '  (saw-ish)' : m > 0.9 ? '  (square-ish)' : ''));
});
onCleanup(off1);
onCleanup(off2);
b.start();`,
  },
  {
    id: 'wavetable-sweep',
    title: 'WAVETABLE POSITION SWEEP',
    category: 'ENGINES',
    description:
      'The wavetable engine scans a table of frames with the position param. A held chord stays static while the clock writes a new position every 16th, which is the manual version of the engine\'s own scanRate/scanDepth lfo.',
    seed: 'wavetable',
    code: `var inst = b.voice('wavetable', {
  position: 0,
  scanDepth: 0,    // internal lfo off, the clock drives position instead
  attack: 0.05, sustain: 0.9, release: 0.5,
  filter: 1, cutoff: 6000, resonance: 0.15,
});
inst.gain(0.7);

// hold a fifth; on() sustains until off()
var ids = [inst.on('C3', 0.7), inst.on('G3', 0.6)];
onCleanup(function () {
  for (var i = 0; i < ids.length; i++) inst.off(ids[i]);
});

// clock-driven modulation: triangle sweep over 2 bars, plus a slow wobble
var off = b.clock.at('16n', function (t, step) {
  var ph = (step % 32) / 32;
  var tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
  var pos = Math.min(1, Math.max(0, tri + 0.08 * Math.sin(step * 0.9)));
  inst.param('position', pos, t);
  if (step % 8 === 0) log('position ' + pos.toFixed(2));
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'pluck-string-duet',
    title: 'PLUCK + STRING DUET',
    category: 'ENGINES',
    description:
      'Two physical models: pluck is a Karplus-Strong string you strike, string is a waveguide you can bow (bow: 1 sustains). The pluck arpeggiates while the bowed string holds long root notes underneath.',
    seed: 'duet',
    code: `var pl = b.voice('pluck', { damp: 0.25, pickPos: 0.2, decay: 3 });
var st = b.voice('string', { bow: 1, bowPressure: 0.45, bowSpeed: 0.5, sustain: 0.9, damp: 0.2 });
pl.gain(0.8);
st.gain(0.45);

var scale = b.scale('D dorian');
var roots = [0, -2, -4, -3]; // scale degrees for the bowed notes
var held = -1;

var off = b.clock.at('8n', function (t, step) {
  // new bowed root every two bars
  if (step % 16 === 0) {
    if (held >= 0) st.off(held, t);
    var deg = roots[(step / 16) % roots.length];
    held = st.on({ degree: deg, octave: 3 }, 0.7, t);
    log('bow degree ' + deg + ' // ' + lib.noteName(scale.degreeToMidi(deg, 3)));
  }
  // plucked arpeggio over the top
  var arp = [0, 2, 4, 6, 7, 6, 4, 2];
  pl.note({ degree: arp[step % 8], octave: 4 }, { at: t, dur: '8n', vel: 0.75 }, scale);
});
onCleanup(off);
onCleanup(function () { if (held >= 0) st.off(held); });
b.start();`,
  },
  {
    id: 'modal-percussion',
    title: 'MODAL PERCUSSION',
    category: 'ENGINES',
    description:
      'The modal engine is a bank of decaying resonators excited by a strike. The material param swaps the whole mode table: bar, membrane, bell, glass, wood. Same notes, five different objects, two bars each.',
    seed: 'modal',
    code: `var names = ['0 bar', '1 membrane', '2 bell', '3 glass', '4 wood'];
var inst = b.voice('modal', {
  material: 0,
  decay: 2.5,
  brightness: 0.6,
  strikeHardness: 0.7,
});
inst.gain(0.85);

var notes = ['C4', 'E4', 'G4', 'B4', 'C5', 'B4', 'G4', 'E4'];

var off = b.clock.at('8n', function (t, step) {
  if (step % 16 === 0) {
    var mat = (step / 16) % 5;
    inst.param('material', mat);
    log('material ' + names[mat]);
  }
  var vel = step % 4 === 0 ? 0.95 : 0.55;
  inst.note(notes[step % 8], { at: t, dur: '8n', vel: vel });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'westcoast-bongos',
    title: 'WEST COAST BONGOS',
    category: 'ENGINES',
    description:
      'Buchla-style voice: a wavefolder into a lowpass gate. Short lpgDecay with a dark lpgColor gives the classic struck-bongo pop; foldEnv makes hard hits brighter. Pitches and accents come from a seeded rng over a euclidean gate.',
    seed: 'bongo',
    code: `var inst = b.voice('westcoast', {
  foldAmount: 0.5,
  foldEnv: 0.7,     // envelope pushes the folder on loud hits
  lpgColor: 0.35,   // darker = more vactrol thump
  lpgDecay: 0.09,   // very short: percussive
});
inst.gain(0.9);

var dice = b.rng('hits');
var gate = b.euclid(16, 7, 2); // 7 pulses over 16 steps, rotated 2
log('gate ' + gate.map(function (g) { return g ? '#' : '.'; }).join(''));

var pool = [48, 53, 55, 60, 62, 67]; // a pentatonic hand-drum pitch set
var off = b.clock.at('16n', function (t, step) {
  if (!gate[step % 16]) return;
  var midi = dice.pick(pool);
  var vel = dice.range(0.45, 1);
  inst.note(midi, { at: t, dur: '16n', vel: vel });
  if (step % 16 === 0) log('bar ' + step / 16 + '  ' + lib.noteName(midi) + ' vel ' + vel.toFixed(2));
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'formant-choir',
    title: 'FORMANT VOWEL CHOIR',
    category: 'ENGINES',
    description:
      'The formant engine runs a glottal source through five vowel filters. The vowel param morphs continuously through a-e-i-o-u. Four held notes on one channel share the morph, so the whole choir changes mouth shape together.',
    seed: 'choir',
    code: `var vowels = ['a', 'e', 'i', 'o', 'u'];
var inst = b.voice('formant', {
  vowel: 0,
  breath: 0.15,
  vibratoRate: 4.5,
  vibratoDepth: 0.2,
});
inst.gain(0.55);

// hold an A minor add9 voicing; all voices share the channel params
var chord = ['A2', 'E3', 'A3', 'B3', 'C4'];
var ids = [];
for (var i = 0; i < chord.length; i++) ids.push(inst.on(chord[i], 0.6));
onCleanup(function () {
  for (var k = 0; k < ids.length; k++) inst.off(ids[k]);
});

// sweep the vowel 0..4 and back over four bars
var off = b.clock.at('16n', function (t, step) {
  var ph = (step % 64) / 64;
  var v = 4 * (ph < 0.5 ? ph * 2 : 2 - ph * 2);
  inst.param('vowel', v, t);
  if (step % 16 === 0) log('vowel ' + v.toFixed(1) + '  ~' + vowels[Math.round(v)]);
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'granular-texture',
    title: 'GRANULAR TEXTURE',
    category: 'ENGINES',
    description:
      'Renders one pluck note offline with lib.renderOffline (no AudioContext involved), then feeds that buffer to b.granular as grain material. A slow position scan reads through the pluck\'s attack and tail as a frozen cloud.',
    seed: 'grain',
    code: `// render a single pluck note offline: raw kernel messages, 2 seconds
// event kinds: 0 = noteOn (b: freq Hz, c: vel), 1 = noteOff
var setup = [
  { type: 'createChannel', id: 0, engineId: 'pluck', params: { decay: 2 }, seed: 'grain-src' },
  { type: 'events', events: [
    { time: 0.02, kind: 0, target: 0, a: 1, b: 220, c: 0.95 },
    { time: 0.8, kind: 1, target: 0, a: 1, b: 0, c: 0 },
  ] },
];
var audio = lib.renderOffline(setup, { seconds: 2, sampleRate: 44100 });
log('source material', audio.left, '@', audio.sampleRate, 'Hz');

// granulate it; baseNote 57 = A3 = 220 Hz, so A3 plays at original pitch
var g = b.granular(audio.left, audio.sampleRate, {
  grainSize: 120, density: 25, spray: 0.08,
  spread: 0.7, baseNote: 57,
});
g.gain(0.8);
var ids = [g.on('A3', 0.8), g.on('E4', 0.5)];
onCleanup(function () { g.off(ids[0]); g.off(ids[1]); });

// scan the read head through the buffer, front to back and again
var off = b.clock.at('16n', function (t, step) {
  var pos = ((step % 48) / 48);
  g.param('position', pos, t);
  if (step % 12 === 0) log('position ' + pos.toFixed(2) + (pos < 0.2 ? '  (attack)' : '  (tail)'));
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'harmonic-frames',
    title: 'HARMONIC CONTROL FRAMES',
    category: 'ENGINES',
    description:
      'The harmonic engine is a DDSP-style sine bank plus noise, built to be driven by control streams. One held note, and every 16th the clock writes a new frame of brightness, formantShift, and noiseMix values.',
    seed: 'harmonic',
    code: `var inst = b.voice('harmonic', {
  brightness: 0.4,
  evenOdd: 0.5,
  noiseMix: 0.1,
  portamento: 0.15,
  attack: 0.3, release: 1.5,
});
inst.gain(0.8);

var id = inst.on('A2', 0.8);
onCleanup(function () { inst.off(id); });

// a control frame every 16th: three slow curves at different rates
var off = b.clock.at('16n', function (t, step) {
  var bright = 0.35 + 0.3 * Math.sin(step * 0.13);
  var shift = Math.pow(2, Math.sin(step * 0.05));      // 0.5x .. 2x formant
  var noise = 0.08 + 0.25 * Math.max(0, Math.sin(step * 0.021));
  inst.param('brightness', bright, t);
  inst.param('formantShift', shift, t);
  inst.param('noiseMix', noise, t);
  if (step % 16 === 0) {
    log('frame ' + step + '  bright ' + bright.toFixed(2) +
      '  formant x' + shift.toFixed(2) + '  noise ' + noise.toFixed(2));
  }
  // occasional new pitch: release the held note, hold a new one
  if (step % 32 === 24) {
    inst.off(id, t);
    id = inst.on(step % 64 === 24 ? 'C3' : 'A2', 0.8, t);
  }
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'drum-machine',
    title: 'DRUM MACHINE',
    category: 'ENGINES',
    description:
      'All five drum engines (kick, snare, hat, clap, tom), each on its own channel, sequenced by euclidean patterns of different densities. The full grid prints once so you can see what you hear.',
    seed: 'kit-909',
    code: `var kit = {
  kick:  b.voice('kick',  { decay: 0.35, drive: 3 }),
  snare: b.voice('snare', { tone: 0.5, snap: 0.12 }),
  hat:   b.voice('hat',   { decay: 0.05 }),
  clap:  b.voice('clap',  { decay: 0.2 }),
  tom:   b.voice('tom',   { decay: 0.3, sweep: 0.1 }),
};
kit.hat.gain(0.5);
kit.clap.gain(0.7);

// drum engines tune from the note, so each gets a home pitch
var notes = { kick: 'C2', snare: 'D3', hat: 'F#4', clap: 'D#3', tom: 'A2' };
var pats = {
  kick:  b.euclid(16, 4, 0),
  snare: b.euclid(16, 2, 4),
  hat:   b.euclid(16, 11, 0),
  clap:  b.euclid(16, 3, 10),
  tom:   b.euclid(16, 5, 13),
};
var names = Object.keys(pats);
for (var i = 0; i < names.length; i++) {
  log(names[i].padEnd(6) + pats[names[i]].map(function (g) { return g ? '#' : '.'; }).join(''));
}

var off = b.clock.at('16n', function (t, step) {
  var s = step % 16;
  for (var k = 0; k < names.length; k++) {
    var n = names[k];
    if (pats[n][s]) kit[n].note(notes[n], { at: t, dur: '16n', vel: n === 'hat' ? 0.5 : 0.9 });
  }
});
onCleanup(off);
b.start();`,
  },
];
