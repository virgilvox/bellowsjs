import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'soundfonts-and-samples',
  title: 'Soundfonts and samples',
  blurb: 'Load SF2 instruments, build sample zones, and granulate your own audio.',
  prev: 'effects',
  next: 'rendering-and-export',
  body: `
By the end of this page you can play a real piano from an SF2 file and turn any recording into an instrument.

## What a soundfont is

An SF2 file is a bank of recorded instruments: samples plus the mapping that says which sample plays for which key and velocity, how it loops, and how its envelope behaves. It is the format General MIDI synths standardized on, so decades of free instruments exist in it. bellowsjs parses SF2 directly, including the generator resolution model of the spec, 24-bit samples, and stereo links.

Good sources: the free GeneralUser GS bank covers all 128 GM programs, and [polyphone.io](https://www.polyphone.io) hosts a large library of community soundfonts plus the Polyphone editor for making your own.

## Loading one

\`\`\`js
const b = await Bellows.boot({ seed: 'sf2-demo' });

// url#bank:program, fetched and parsed for you
const piano = await b.instrument('sf2:/fonts/gm.sf2#0:0');
piano.note('C4', { dur: '2n', vel: 0.7 });
piano.chord(['E3', 'G3', 'C4'], { dur: '1m', vel: 0.5 });
\`\`\`

\`b.instrument(uri)\` is the short path: the fragment picks bank 0, program 0 (piano in a GM bank). The result is an ordinary \`Instrument\`, so everything on [Playing notes](/docs/playing-notes) and [Effects](/docs/effects) applies.

When you already have the bytes, or want several programs from one file without fetching twice:

\`\`\`js
import { SoundFont } from 'bellowsjs';

const buf = await (await fetch('/fonts/gm.sf2')).arrayBuffer();
const sf = SoundFont.parse(buf);

const piano = b.sf2Instrument(sf, 0, 0);
const strings = b.sf2Instrument(sf, 0, 48);
\`\`\`

## Sampler parameters

Sample-backed instruments run on the sampler engine and share one parameter surface: \`attack\`, \`decay\`, \`sustain\`, \`release\`, \`loopXfade\` (milliseconds of crossfade across the loop seam), \`veltrack\` (how much velocity drives level, in percent), \`gain\` (dB), and \`pan\`. Set them like any engine param:

\`\`\`js
piano.param('release', 0.8);
piano.param('loopXfade', 20);
\`\`\`

## The zone model

Under every sampler instrument is a list of zones. A zone is one sample plus its playing rules:

\`\`\`js
const zones = [{
  data: monoFloat32,       // the audio
  sampleRate: 44100,
  rootKey: 60,             // plays at natural speed on this key
  keyLo: 48, keyHi: 72,    // key range this zone covers
  velLo: 0, velHi: 127,    // velocity range
  loopMode: 'none',        // or 'loop' / 'loopRelease' with loopStart/loopEnd
}];

const inst = b.samplerInstrument(zones);
inst.note('G4', { dur: '4n' });
\`\`\`

Notes off the root key repitch by playback speed, like a classic sampler. Zones can layer (overlapping key and velocity ranges), split velocities with equal-power crossfades, and cycle round robins via \`roundRobinGroup\` and \`seqPosition\`. Each zone optionally carries \`fineTune\` in cents, \`gainDb\`, \`pan\`, and its own \`env\`. \`samplerBankFromSf2(sf, bank, program).zones\` gives you a parsed preset in exactly this form when you want to inspect or edit it before registering. SFZ files load too, via \`parseSfz\` and \`samplerBankFromSfz\` with a sample loader you provide.

## Granular over your own buffers

\`\`\`js
const buf = await (await fetch('/audio/choir.wav')).arrayBuffer();
const decoded = await b.ctx.decodeAudioData(buf);
const mono = decoded.getChannelData(0);

const cloud = b.granular(mono, decoded.sampleRate, {
  grainSize: 120,  // ms
  density: 30,     // grains per second
  position: 0.3,   // where in the buffer grains start
  spray: 0.1,      // positional randomness
  spread: 0.8,     // stereo scatter
});

cloud.note('C4', { dur: '2m', vel: 0.6 });
cloud.param('position', 0.7); // scrub while it plays
\`\`\`

\`b.granular(data, sampleRate, params?)\` registers the buffer with the kernel and returns an instrument whose engine scatters up to 64 simultaneous grains over it. \`baseNote\` (default 69) sets which key plays the buffer unpitched; \`pitch\` and \`pitchJitter\` detune the cloud. Long notes plus slow \`position\` moves is the classic texture recipe.

## The soundfont panel on this site

The WORKBENCH page has a SOUNDFONT panel that does all of the above interactively: drop an \`.sf2\` file to list its presets, activate one to play it in the bench, or drop plain audio files to build a kit, with each file's root key detected by the [pitch tracker](/docs/analysis). It is a good way to audition a bank before writing any code.

Sample instruments render offline exactly like synth engines, so a piece built on a soundfont exports the same as any other: [Rendering and export](/docs/rendering-and-export) is next.
`,
};

export default page;
