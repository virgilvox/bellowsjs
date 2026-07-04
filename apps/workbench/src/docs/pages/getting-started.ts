import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'getting-started',
  title: 'Getting started',
  blurb: 'Install the library three ways and make your first sound.',
  prev: null,
  next: 'playing-notes',
  body: `
By the end of this page you will have played a note in the browser and know which of the three entry points fits your project.

bellowsjs is a browser-native audio engine for synthesis, samples, sequencing, analysis, and I/O. One AudioWorklet kernel hosts every voice and effect, musical logic runs on the main thread and compiles to sample-accurate events, and every random decision flows from a seed you choose.

## First sound in one line

\`\`\`js
import { play } from 'bellowsjs';
play('pluck', 'C4');
\`\`\`

\`play(engineId, note)\` boots a shared engine on first call and plays one note. Together with \`instrument(uri)\` for soundfonts it makes up tier 1 of the API, good for demos and for checking that your setup works.

## Way one: a script tag, no build step

Save this as an HTML file and open it. The import comes straight from a CDN.

\`\`\`html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>first sound</title>
  </head>
  <body>
    <button id="go">play</button>
    <script type="module">
      import { play } from 'https://unpkg.com/bellowsjs/dist/bellows.js';
      document.querySelector('#go').onclick = () => play('pluck', 'C4');
    </script>
  </body>
</html>
\`\`\`

The AudioWorklet kernel ships inlined and loads through a blob URL, so there is no second file to host. The note plays from a click handler, which matters, as the next section explains.

## Way two: npm and a bundler

\`\`\`
npm install bellowsjs
\`\`\`

\`\`\`js
import { Bellows } from 'bellowsjs';

const b = await Bellows.boot({ seed: 'forge-01' });
b.voice('pluck').note('C4');
\`\`\`

\`Bellows.boot()\` is tier 2: one object owning the AudioContext, the transport, the clock, and the kernel. Everything else in these docs builds on it. The \`seed\` makes every random decision in your piece reproducible; see [Generative music](/docs/generative-music).

## Way three: Node, no audio device

The DSP core has zero browser dependencies, so you can render audio in Node and write it to disk.

\`\`\`js
import { registerBuiltins, renderOffline, encodeWav, EventKind } from 'bellowsjs';
import { writeFileSync } from 'node:fs';

registerBuiltins();
const setup = [
  { type: 'createChannel', id: 0, engineId: 'pluck', params: {}, seed: 'demo' },
  { type: 'masterGain', gain: 0.9 },
  { type: 'events', events: [
    { time: 0.02, kind: EventKind.NoteOn, target: 0, a: 1, b: 220, c: 0.9 },
    { time: 0.5, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
  ] },
];
const out = renderOffline(setup, { seconds: 2, sampleRate: 44100 });
const wav = encodeWav([out.left, out.right], out.sampleRate, { bitDepth: 16 });
writeFileSync('pluck.wav', Buffer.from(wav));
\`\`\`

This is the raw message-stream form. In the browser you rarely touch it, because \`b.render()\` builds the stream for you; [Rendering and export](/docs/rendering-and-export) covers both.

## The user gesture rule

Browsers keep an AudioContext suspended until the page sees a user gesture. Call \`Bellows.boot()\` or \`play()\` from a click handler and everything works. Call it at page load and you get silence until the first real interaction, at which point the context resumes on its own. When you see a booted engine and no sound, this rule is almost always why.

## Where to go next

[Playing notes](/docs/playing-notes) covers notes, durations, velocity, and chords. [Engines](/docs/engines) tours the eighteen built-in instruments. If you want the whole API surface on one page, the machine-readable reference at [/llm.txt](/llm.txt) lists every engine, effect, preset, and signature exactly, and it doubles as context you can paste into an LLM.
`,
};

export default page;
