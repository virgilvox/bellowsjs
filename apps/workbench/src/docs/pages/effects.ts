import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'effects',
  title: 'Effects',
  blurb: 'Inserts, send buses, the master chain, and the full effect roster.',
  prev: 'tuning',
  next: 'soundfonts-and-samples',
  body: `
By the end of this page you can route any instrument through delays, reverbs, and dynamics, and mix a small arrangement.

## Three places an effect can live

\`\`\`js
// insert: replaces this instrument's chain, runs only on its signal
lead.fx('tapeDelay', ['eq', { b0gain: -3 }]);

// bus: one shared chain, many senders
const hall = b.bus([['fdn', { decay: 4 }]], { level: 0.4 });
lead.send(hall, 0.5);
pad.send(hall, 0.8);

// master: the last thing before the speakers
b.masterFx('compressor', 'limiter');
\`\`\`

Inserts shape one voice. Buses share one expensive effect (usually a reverb) among many channels: \`send(bus, amount)\` taps the channel post-insert, and the bus's \`level\` sets its return into the mix. The master chain treats the whole piece as one signal. Each \`fx()\` or \`masterFx()\` call replaces the previous chain, so state the full chain each time.

## Chain syntax

\`\`\`js
inst.fx('chorus');                                  // id string, default params
inst.fx(['delay', { timeL: 0.25, feedback: 0.5 }]); // [id, params] tuple
inst.fx({ effectId: 'plate', params: { decay: 0.6 } }); // explicit spec object
inst.fx('saturator', ['eq', { b5gain: 2 }], 'plate');   // chains mix all three forms
\`\`\`

Order matters and is exactly the order you write: distortion into reverb sounds nothing like reverb into distortion.

## The roster

Delays: \`delay\` (stereo, independent L/R times, cross feedback), \`tapeDelay\` (wow, flutter, saturation, hiss), \`multitap\` (four taps with diffusion).

Reverbs: \`fdn\` (feedback delay network, size and decay in seconds), \`plate\` (bright, dense, classic vocal plate).

Dynamics: \`compressor\` (with knee, makeup, and lookahead), \`limiter\` (ceiling in dB, optional true peak), \`gate\`, \`transient\` (attack and sustain shaping).

EQ and color: \`eq\` (six parametric bands, addressed \`b0freq\`, \`b0gain\`, \`b0q\` through \`b5...\`), \`saturator\` (four curves, tone tilt).

Modulation: \`chorus\`, \`flanger\`, \`phaser\`, \`tremolo\`, \`autopan\`, \`ringmod\`, \`freqshift\` (a true frequency shifter, inharmonic where a pitch shifter is not).

Spectral: \`pitchshift\` (semitones), \`freeze\` (hold the current spectrum), \`blur\`, \`robot\`, \`whisper\`, \`denoise\`.

Every parameter with its range, default, and curve is listed per effect in [/llm.txt](/llm.txt). Most time-based and modulation effects carry a \`mix\` parameter; dynamics default to fully wet, and \`compressor\`'s \`mix\` below 1 is parallel compression.

## Changing parameters later

\`\`\`js
lead.fx('tapeDelay', 'plate');   // index 0: tapeDelay, index 1: plate
lead.fxParam(0, 'feedback', 0.6);
lead.fxParam(1, 'mix', 0.2);

hall.fxParam(0, 'decay', 8);     // buses address their chain the same way
\`\`\`

\`fxParam(fxIndex, name, value)\` addresses an effect by its position in the chain you set. Engine parameters go through \`param()\` instead; the two surfaces never collide.

## A mixing walkthrough

\`\`\`js
const b = await Bellows.boot({ seed: 'mixdown', bpm: 100 });

const kick = b.voice('kick', { drive: 3 });
const bass = b.voice('va', { shape: 1, cutoff: 500 });
const keys = b.voice('fm', { algorithm: 5, brightness: 0.4 });

// one shared room, sent to taste
const room = b.bus([['plate', { decay: 0.6, mix: 1 }]], { level: 0.3 });
keys.send(room, 0.7);

// inserts: shape each voice at the source
bass.fx(['saturator', { drive: 3, mix: 0.5 }]);
keys.fx(['delay', { timeL: 0.375, timeR: 0.5, feedback: 0.35, mix: 0.25 }]);

// master: gentle glue, then a ceiling
b.masterFx(
  ['compressor', { threshold: -14, ratio: 2.5, attack: 0.02 }],
  ['limiter', { ceiling: -1 }],
);

kick.gain(0.9);
bass.gain(0.75);
keys.gain(0.6).pan(0.2);
\`\`\`

The habits that matter: effects on buses run wet (\`mix: 1\`) and the send amount does the blending; inserts keep their own \`mix\`; the limiter goes last and its ceiling is your true maximum. Meter the result with the [analysis](/docs/analysis) tools before deciding it is loud enough.

Effects also apply to sample players, which is where instruments start sounding like records: [Soundfonts and samples](/docs/soundfonts-and-samples) is next. To write an effect of your own, see [Custom DSP](/docs/custom-dsp).
`,
};

export default page;
