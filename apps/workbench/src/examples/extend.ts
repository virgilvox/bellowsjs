/*
 * Render and extend: wav export, and tier 3 custom engines and effects.
 * Custom defs must be self-contained (no closures over outside variables)
 * because they are serialized by toString() into the audio worklet realm.
 */

import type { Example } from './types';

export const extendExamples: Example[] = [
  {
    id: 'render-wav',
    title: 'RENDER TO WAV',
    category: 'RENDER + EXTEND',
    description:
      'b.render replays the setup messages and clock callbacks into a fresh offline kernel, so the file equals what a fresh page load would play. The result carries a wav() encoder; a blob url turns it into a download.',
    seed: 'bounce',
    code: `var kick = b.voice('kick', { decay: 0.3 });
var lead = b.voice('fm', { ops: 2, ratio2: 2, level2: 0.5, decay: 0.35 });
lead.gain(0.7);
var scale = b.scale('G dorian');
var line = [0, 2, 4, 5, 4, 2, 1, 3];

var off = b.clock.at('8n', function (t, step) {
  if (step % 4 === 0) kick.note('C2', { at: t, dur: '16n', vel: 0.9 });
  lead.note({ degree: line[step % 8], octave: 4 }, { at: t, dur: '8n', vel: 0.8 }, scale);
});
onCleanup(off);
b.start(); // audible copy while the file renders

var audio = await b.render({ bars: 4 });
var seconds = audio.left.length / audio.sampleRate;
log('rendered', audio.left, '=', seconds.toFixed(2) + ' s @ ' + audio.sampleRate + ' Hz');

var wavBuffer = audio.wav(16); // 16-bit pcm ArrayBuffer
log('wav file ' + (wavBuffer.byteLength / 1024).toFixed(0) + ' KB');

// trigger a browser download via a blob url
var url = URL.createObjectURL(new Blob([wavBuffer], { type: 'audio/wav' }));
var a = document.createElement('a');
a.href = url;
a.download = 'bellows-render.wav';
a.click();
log('download triggered: bellows-render.wav');
onCleanup(function () { URL.revokeObjectURL(url); });`,
  },
  {
    id: 'custom-engine',
    title: 'CUSTOM ENGINE (defEngine)',
    category: 'RENDER + EXTEND',
    description:
      'b.defEngine registers a tier 3 engine from a plain object: params plus a createVoice factory returning noteOn/noteOff/process/setParam/active. The def is serialized into the worklet, so it must be fully self-contained. This one is a two-oscillator detuned square.',
    seed: 'homebrew',
    code: `b.defEngine({
  id: 'buzz',
  label: 'Buzz',
  params: [
    { name: 'detune', min: 0, max: 50, default: 14 },
    { name: 'decay', min: 0.05, max: 4, default: 0.5 },
  ],
  polyphony: 8,
  // self-contained: only uses its own arguments and Math
  createVoice: function (sampleRate, params, rng) {
    var detune = params.detune === undefined ? 14 : params.detune;
    var decay = params.decay === undefined ? 0.5 : params.decay;
    var p1 = 0, p2 = 0, inc1 = 0, inc2 = 0, env = 0, coef = 1, vel = 1;
    return {
      noteOn: function (freq, v) {
        vel = v;
        inc1 = freq / sampleRate;
        inc2 = (freq * Math.pow(2, detune / 1200)) / sampleRate;
        p1 = 0;
        p2 = rng(); // random phase offset per note
        env = 1;
        coef = Math.exp(-6.9 / (decay * sampleRate)); // 60 dB over decay
      },
      noteOff: function () { coef = Math.exp(-6.9 / (0.06 * sampleRate)); },
      process: function (outL, outR, from, to) {
        for (var i = from; i < to; i++) {
          var s = ((p1 < 0.5 ? 1 : -1) + (p2 < 0.5 ? 1 : -1)) * 0.22 * env * vel;
          p1 += inc1; if (p1 >= 1) p1 -= 1;
          p2 += inc2; if (p2 >= 1) p2 -= 1;
          env *= coef;
          outL[i] += s;
          outR[i] += s;
        }
      },
      setParam: function (name, value) {
        if (name === 'detune') detune = value;
        if (name === 'decay') decay = value;
      },
      get active() { return env > 0.0001; },
    };
  },
});
log('engine "buzz" registered // playable like any builtin');

var inst = b.voice('buzz', { detune: 18, decay: 0.4 });
var scale = b.scale('C minor');
var riff = [0, 3, 5, 3, 7, 5, 3, 2];
var off = b.clock.at('8n', function (t, step) {
  inst.note({ degree: riff[step % 8], octave: 2 }, { at: t, dur: '16n', vel: 0.85 }, scale);
  if (step % 16 === 0) log('bar ' + step / 16);
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'custom-effect',
    title: 'CUSTOM EFFECT (defEffect)',
    category: 'RENDER + EXTEND',
    description:
      'b.defEffect registers a tier 3 stereo in-place effect: a create factory returning process/setParam/reset. This bitcrusher quantizes amplitude and holds samples, and the bit depth steps down each bar over a drum loop.',
    seed: 'crush',
    code: `b.defEffect({
  id: 'crusher',
  label: 'Crusher',
  params: [
    { name: 'bits', min: 1, max: 16, default: 8 },
    { name: 'downsample', min: 1, max: 32, default: 1 },
    { name: 'mix', min: 0, max: 1, default: 1 },
  ],
  // self-contained: effects process in place over [from, to)
  create: function (sampleRate, params) {
    var bits = params.bits === undefined ? 8 : params.bits;
    var down = params.downsample === undefined ? 1 : params.downsample;
    var mix = params.mix === undefined ? 1 : params.mix;
    var holdL = 0, holdR = 0, count = 0;
    return {
      process: function (l, r, from, to) {
        var levels = Math.pow(2, bits);
        for (var i = from; i < to; i++) {
          if (count <= 0) {
            holdL = Math.round(l[i] * levels) / levels;
            holdR = Math.round(r[i] * levels) / levels;
            count = Math.floor(down);
          }
          count--;
          l[i] += (holdL - l[i]) * mix;
          r[i] += (holdR - r[i]) * mix;
        }
      },
      setParam: function (name, value) {
        if (name === 'bits') bits = value;
        if (name === 'downsample') down = value;
        if (name === 'mix') mix = value;
      },
      reset: function () { holdL = 0; holdR = 0; count = 0; },
    };
  },
});
log('effect "crusher" registered');

var kick = b.voice('kick', { decay: 0.3 });
var snare = b.voice('snare');
kick.fx(['crusher', { bits: 12 }]);
snare.fx(['crusher', { bits: 12 }]);

var stages = [12, 8, 5, 3]; // bit depth per bar, harsher every bar
var off = b.clock.at('16n', function (t, step) {
  var s = step % 16;
  if (s === 0) {
    var bitsNow = stages[Math.floor(step / 16) % stages.length];
    kick.fxParam(0, 'bits', bitsNow);
    snare.fxParam(0, 'bits', bitsNow);
    kick.fxParam(0, 'downsample', bitsNow < 6 ? 6 : 1);
    snare.fxParam(0, 'downsample', bitsNow < 6 ? 6 : 1);
    log('bits ' + bitsNow + (bitsNow < 6 ? ' + downsample 6x' : ''));
  }
  if (s === 0 || s === 6 || s === 10) kick.note('C2', { at: t, dur: '16n', vel: 0.95 });
  if (s === 4 || s === 12) snare.note('D3', { at: t, dur: '16n', vel: 0.8 });
});
onCleanup(off);
b.start();`,
  },
];
