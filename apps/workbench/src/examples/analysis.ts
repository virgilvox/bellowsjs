/*
 * Analysis: everything renders offline through b.render (which replays the
 * clock callbacks into a fresh kernel) and then runs the analyzers over
 * the resulting Float32Array.
 */

import type { Example } from './types';

export const analysisExamples: Example[] = [
  {
    id: 'pitch-tracker',
    title: 'PITCH TRACKER',
    category: 'ANALYSIS',
    description:
      'A one-bar melody plays live and renders offline through b.render. lib.yin then estimates the pitch of a 2048-sample window at each note position, and the console lines up what was played against what the detector heard.',
    seed: 'yin',
    code: `var scale = b.scale('D minor pentatonic');
var mel = [0, 2, 4, 3, 5, 4, 2, 1]; // one note per 8th, one bar
var inst = b.voice('pluck', { damp: 0.25, decay: 1.5 });
inst.gain(0.85);

var off = b.clock.at('8n', function (t, step) {
  inst.note({ degree: mel[step % 8], octave: 3 }, { at: t, dur: '8n', vel: 0.9 }, scale);
});
onCleanup(off);
b.start(); // audible copy

// the render replays the same clock callback offline, deterministically
var audio = await b.render({ bars: 1 });
log('rendered', audio.left, '@ ' + audio.sampleRate + ' Hz');

var sr = audio.sampleRate;
var eighth = (60 / 120) * 0.5; // seconds per 8th at the default 120 bpm
for (var i = 0; i < mel.length; i++) {
  var played = scale.degreeToMidi(mel[i], 3);
  // window starting 60 ms into the note, past the pick transient
  var start = Math.floor((i * eighth + 0.06) * sr);
  var win = audio.left.subarray(start, start + 2048);
  var hit = lib.yin(win, sr, 0.15);
  if (hit) {
    var midi = lib.ftom(hit.freq);
    var name = lib.noteName(Math.round(midi));
    var ok = Math.round(midi) === played;
    log('step ' + i + '  played ' + lib.noteName(played).padEnd(3) + ' -> yin ' + name.padEnd(3) +
      ' ' + hit.freq.toFixed(1) + ' Hz  p=' + hit.probability.toFixed(2) + (ok ? '' : '  MISS'));
  } else {
    log('step ' + i + '  played ' + lib.noteName(played) + ' -> unvoiced');
  }
}`,
  },
  {
    id: 'onset-tempo',
    title: 'ONSET + TEMPO',
    category: 'ANALYSIS',
    description:
      'A four-bar drum loop renders offline, then lib.detectOnsets marks transients by spectral flux and lib.estimateTempo votes on inter-onset intervals. The estimate should land on the transport tempo of 120 bpm.',
    seed: 'onsets',
    code: `var kick = b.voice('kick', { decay: 0.3, drive: 2 });
var snare = b.voice('snare', { decay: 0.15 });
var hat = b.voice('hat', { decay: 0.04 });
hat.gain(0.5);

var kp = b.euclid(16, 4, 0);
var sp = b.euclid(16, 2, 4);

var off = b.clock.at('16n', function (t, step) {
  var s = step % 16;
  if (kp[s]) kick.note('C2', { at: t, dur: '16n', vel: 0.95 });
  if (sp[s]) snare.note('D3', { at: t, dur: '16n', vel: 0.8 });
  if (s % 2 === 0) hat.note('F#4', { at: t, dur: '16n', vel: 0.5 });
});
onCleanup(off);
b.start(); // audible copy

var audio = await b.render({ bars: 4 });
log('rendered', audio.left, '@ ' + audio.sampleRate + ' Hz');

var onsets = lib.detectOnsets(audio.left, audio.sampleRate);
log('detected ' + onsets.length + ' onsets');
log('first eight at: ' + onsets.slice(0, 8).map(function (t) { return t.toFixed(3); }).join(' ') + ' s');

var tempo = lib.estimateTempo(onsets);
log('estimated tempo ' + tempo.bpm.toFixed(1) + ' bpm  confidence ' + tempo.confidence.toFixed(2));
log('transport tempo 120.0 bpm (16ths land on a 0.125 s grid)');`,
  },
  {
    id: 'loudness-meter',
    title: 'LOUDNESS METER',
    category: 'ANALYSIS',
    description:
      'lib.LoudnessMeter implements EBU R128 metering: K-weighted momentary and short-term windows, gated integrated loudness, loudness range, and 4x oversampled true peak. A short chord piece renders offline and gets fully measured.',
    seed: 'lufs',
    code: `var pad = b.voice('va', { shape: 2, attack: 0.1, release: 0.8, detune: 10, cutoff: 3000 });
pad.gain(0.7);
var kick = b.voice('kick', { decay: 0.3 });

var chords = [['A2', 'E3', 'C4'], ['F2', 'C3', 'A3']];
var off = b.clock.at('1m', function (t, step) {
  pad.chord(chords[step % 2], { at: t, dur: '1m', vel: step % 4 < 2 ? 0.8 : 0.4 });
});
var off2 = b.clock.at('4n', function (t, step) {
  if (step % 2 === 0) kick.note('C2', { at: t, dur: '16n', vel: 0.9 });
});
onCleanup(off);
onCleanup(off2);
b.start(); // audible copy

var audio = await b.render({ bars: 4 });
log('rendered', audio.left, '@ ' + audio.sampleRate + ' Hz');

var meter = new lib.LoudnessMeter(audio.sampleRate, 2);
meter.push(audio.left, audio.right, 0, audio.left.length);

log('integrated  ' + meter.integrated().toFixed(1) + ' LUFS');
log('momentary   ' + meter.momentary().toFixed(1) + ' LUFS (last 400 ms window)');
log('short-term  ' + meter.shortTerm().toFixed(1) + ' LUFS (last 3 s window)');
log('range       ' + meter.range().toFixed(1) + ' LU');
// truePeak() is linear; convert to dBTP
log('true peak   ' + lib.gainToDb(meter.truePeak()).toFixed(2) + ' dBTP');`,
  },
];
