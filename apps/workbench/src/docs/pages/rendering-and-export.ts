import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'rendering-and-export',
  title: 'Rendering and export',
  blurb: 'Offline renders that equal live playback, wav files, and Opus encoding.',
  prev: 'soundfonts-and-samples',
  next: 'analysis',
  body: `
By the end of this page you can turn a running piece into a downloadable file, in the browser or in CI.

## b.render: the piece, replayed offline

\`\`\`js
const audio = await b.render({ bars: 8 });
audio.left;        // Float32Array
audio.right;       // Float32Array
audio.sampleRate;  // 44100 unless you passed sampleRate

const wavBuf = audio.wav(24); // ArrayBuffer: 16, 24, or 32 bit
\`\`\`

\`b.render({ bars | beats | seconds, sampleRate? })\` does not record what the speakers played. It rebuilds the piece: every structural call you made (voices, effect chains, buses, sample banks) was recorded as a kernel message, and every \`clock.at\` callback re-runs against an offline transport, tick by tick, with the same \`t\` and \`step\` values live playback would produce. The event stream renders through a fresh kernel faster than real time, tempo ramps and swing included.

## The fresh-stream rule

During a render, \`b.rng(label)\` hands your callbacks fresh streams seeded exactly as they were at boot. So a render equals what a fresh page load of the same seed would play, provided two things are true: every random choice flows through \`b.rng()\` (never \`Math.random\`), and any other mutable state in your callbacks is derived from \`step\` or reset at a known step. A counter you increment across calls carries its live value into the render; a value computed from \`step\` and a named stream cannot drift. The [seeded piece example](/docs/generative-music) is built to this rule.

## Downloading in the browser

\`\`\`js
const audio = await b.render({ bars: 16 });
const url = URL.createObjectURL(new Blob([audio.wav(16)], { type: 'audio/wav' }));
const a = document.createElement('a');
a.href = url;
a.download = 'piece.wav';
a.click();
URL.revokeObjectURL(url);
\`\`\`

Rendering runs on the main thread and does not interrupt live playback, so you can keep listening while the file builds.

## Node: renderOffline

\`\`\`js
import { registerBuiltins, renderOffline, encodeWav, EventKind } from 'bellowsjs';
import { writeFileSync } from 'node:fs';

registerBuiltins();

const setup = [
  { type: 'createChannel', id: 0, engineId: 'pluck', params: {}, seed: 's' },
  { type: 'masterGain', gain: 0.9 },
  { type: 'events', events: [
    { time: 0.02, kind: EventKind.NoteOn, target: 0, a: 1, b: 220, c: 0.9 },
    { time: 0.5, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
  ] },
];

const out = renderOffline(setup, { seconds: 2, sampleRate: 44100 });
writeFileSync('out.wav', Buffer.from(encodeWav([out.left, out.right], 44100, { bitDepth: 16 })));
\`\`\`

There is no AudioContext in Node, so this is the message-stream form: the same kernel the worklet runs, driven by a plain array. \`createChannel\` makes an instrument slot, \`events\` carries timestamped kernel events where \`time\` is seconds, \`a\` is a note id, \`b\` is frequency in Hz, and \`c\` is velocity. Call \`registerBuiltins()\` once first. Output is bit-identical on every run, which is why the library's own regression suite diffs renders against golden files in CI. Higher-level Node scores are straightforward: compute frequencies with the [theory](/docs/theory) and [tuning](/docs/tuning) helpers, then emit event pairs.

## Opus, where available

\`\`\`js
import { canEncode, encodeAudio } from 'bellowsjs';

if (await canEncode('opus')) {
  const audio = await b.render({ bars: 16 });
  const enc = await encodeAudio([audio.left, audio.right], audio.sampleRate, {
    codec: 'opus',
    bitrate: 128000,
  });
  const blob = new Blob([enc.data], { type: enc.mimeType }); // audio/ogg; codecs=opus
}
\`\`\`

Where the WebCodecs \`AudioEncoder\` exists (Chromium, recent Firefox), \`encodeAudio\` produces a complete Ogg Opus file, muxed by the library. Always feature-detect with \`canEncode\`; WAV export works everywhere and is the fallback the workbench EXPORT panel uses.

Once you have rendered audio as Float32Arrays, you can also measure it: pitch, tempo, key, and loudness are one page over at [Analysis](/docs/analysis).
`,
};

export default page;
