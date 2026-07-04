import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'custom-dsp',
  title: 'Custom DSP',
  blurb: 'Write your own engines and effects and run them like built-ins.',
  prev: 'midi',
  next: null,
  body: `
By the end of this page you can register an engine and an effect of your own, play them by id like built-ins, and prove them correct offline.

## The tier 3 contracts

Two small interfaces sit under everything you have used so far. A voice adds into its output buffers; an effect processes them in place. Both work over an index range so the kernel can split blocks at event boundaries for sample accuracy.

\`\`\`js
// Voice: created per note by an engine's factory
{
  noteOn(freq, vel) {},                 // freq already tuned, in Hz; vel 0..1
  noteOff() {},                         // enter release; keep running until the tail dies
  process(outL, outR, from, to) {},     // ADD samples into outL/outR over [from, to)
  setParam(name, value) {},             // unknown names are ignored
  get active() { return true; },        // false once silent; the pool reclaims you
}

// Effect: one instance per chain slot
{
  process(l, r, from, to) {},           // rewrite l and r IN PLACE over [from, to)
  setParam(name, value) {},
  reset() {},
}
\`\`\`

The two verbs are the whole model. Voices add because many voices share one buffer; overwrite it and you erase your neighbors. Effects rewrite because they own the signal at their slot in the chain. Voices are pooled and reused, so \`noteOn\` must fully reset internal state, and nothing on the audio path may allocate at steady state: preallocate in the factory, reuse scratch.

## The serialization constraint

\`b.defEngine(def)\` and \`b.defEffect(def)\` send your code into the AudioWorklet realm by serializing the def with \`toString()\`. That realm has none of your module scope, so the def must be self-contained: no imports, no closures over outside variables, only its own arguments, locals, and globals like \`Math\`. Params must be numeric. If a def secretly reads an outer variable it will throw inside the worklet, not at registration. The \`rng\` argument passed to \`createVoice\` is a seeded stream, so even per-voice randomness stays reproducible.

## A complete engine

\`\`\`js
b.defEngine({
  id: 'buzz',
  label: 'Buzz',
  params: [
    { name: 'detune', min: 0, max: 50, default: 14 },
    { name: 'decay', min: 0.05, max: 4, default: 0.5 },
  ],
  polyphony: 8,
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
        p2 = rng(); // random phase per note, still seeded
        env = 1;
        coef = Math.exp(-6.9 / (decay * sampleRate)); // -60 dB over decay
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

b.voice('buzz', { detune: 18 }).note('C3', { dur: '4n' });
\`\`\`

Two detuned square oscillators and an exponential envelope, about forty lines. Once registered, \`'buzz'\` is a first-class engine id: it works in \`b.voice\`, sequences, presets of your own, and offline renders. Note the shape of the closure: everything the voice touches is an argument or a local.

## A complete effect: bitcrusher

\`\`\`js
b.defEffect({
  id: 'crusher',
  label: 'Crusher',
  params: [
    { name: 'bits', min: 1, max: 16, default: 8 },
    { name: 'downsample', min: 1, max: 32, default: 1 },
    { name: 'mix', min: 0, max: 1, default: 1 },
  ],
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

drums.fx(['crusher', { bits: 6, downsample: 4 }]);
drums.fxParam(0, 'bits', 3); // live, like any effect
\`\`\`

Amplitude quantization plus a sample-and-hold downsampler. It slots into insert chains, buses, and the master chain exactly like the [built-in effects](/docs/effects), and \`fxParam\` addresses it by chain position.

## Testing your op offline

\`\`\`js
// node test-buzz.mjs
import { registerBuiltins, registerEngine, registerEffect, renderOffline, EventKind } from 'bellowsjs';

registerBuiltins();
registerEngine(buzzDef);      // same def objects as above
registerEffect(crusherDef);

const out = renderOffline([
  { type: 'createChannel', id: 0, engineId: 'buzz', params: { detune: 18 }, seed: 'test' },
  { type: 'channelFx', id: 0, chain: [{ effectId: 'crusher', params: { bits: 6, downsample: 4 } }] },
  { type: 'events', events: [
    { time: 0.02, kind: EventKind.NoteOn, target: 0, a: 1, b: 110, c: 0.9 },
    { time: 0.8, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
  ] },
], { seconds: 1.5, sampleRate: 44100 });

const peak = Math.max(...out.left.map(Math.abs));
console.log('peak', peak.toFixed(3)); // nonzero, deterministic on every run
\`\`\`

In Node, \`registerEngine\` and \`registerEffect\` put your defs in the same registry \`registerBuiltins\` fills, and \`renderOffline\` drives them through the real kernel with no browser anywhere. Renders are deterministic, so you can assert exact peaks or diff whole buffers against a golden file, which is how the library tests its own DSP. It is the fastest loop for developing an op: edit, render, listen or assert, repeat, then paste the finished def into \`b.defEngine\` for the [live kernel](/docs/getting-started).

One deployment note: serialized defs are evaluated inside the worklet, so hosts with a CSP that blocks blob or eval need \`Bellows.boot({ workletUrl })\` pointed at the packaged \`bellowsjs/worklet.js\`.
`,
};

export default page;
