import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'sequencing',
  title: 'Sequencing',
  blurb: 'The clock contract, musical time, transport control, and a drum machine.',
  prev: 'presets',
  next: 'generative-music',
  body: `
By the end of this page you can put notes exactly on a grid, bend the tempo underneath them, and build a drum machine in thirty lines.

## The clock contract

\`\`\`js
const inst = b.voice('pluck');

const off = b.clock.at('16n', (t, step) => {
  inst.note('C4', { at: t, dur: '16n' });
});
b.start();

// later: off() unsubscribes the callback
\`\`\`

\`b.clock.at(subdivision, cb)\` fires your callback slightly ahead of every subdivision tick. The callback receives \`t\`, the exact tick time in context seconds, and \`step\`, the tick count from transport start. The one rule that makes everything land: always pass \`t\` to \`note({ at: t })\`. The kernel splits its render blocks at event boundaries, so a note scheduled at \`t\` starts on that exact sample, even when the main thread is busy or a background tab throttles timers. Schedule at \`b.now()\` instead and you inherit main-thread jitter.

\`step\` is your position in the pattern: \`step % 16\` walks a bar of sixteenths, \`step % 64\` a four-bar phrase.

## Musical time, the full grammar

Everywhere the API takes a duration or span (\`dur\`, \`clock.at\`, \`rampBpm\`, \`swing\`), these forms work:

| form | meaning |
|------|---------|
| \`'1n'\` \`'2n'\` \`'4n'\` \`'8n'\` \`'16n'\` \`'32n'\` | whole to thirty-second notes; \`'4n'\` is one beat |
| \`'4n.'\` or \`'4nd'\` | dotted: half again longer |
| \`'8t'\` | triplet: two thirds of the plain value |
| \`'3/8'\` | fraction of a whole note |
| \`'2m'\` | measures, honoring the transport meter |
| \`2\` | plain number: beats |
| \`'2:1:2'\` | bar:beat:sixteenth, where a position is expected |

## Transport control

\`\`\`js
b.start();         // beat zero, callbacks begin
b.pause();         // freeze position, silence held voices
b.resume();        // continue from the paused beat
b.stop();          // stop and hard-silence
\`\`\`

The transport is the single timeline every channel shares. \`pause\` keeps the musical position; \`stop\` also drops queued events. \`b.transport\` exposes the underlying object when you need \`position()\`, \`beatAt(seconds)\`, or \`secondsAt(beat)\`.

## Tempo: bpm, ramps, swing

\`\`\`js
b.bpm(140);            // jump
b.rampBpm(90, '8m');   // linear ramp over eight measures
b.swing(0.4, '8n');    // delay every offbeat eighth
\`\`\`

Tempo is a first-class curve, not a timer interval. Beat-to-seconds under a ramp is computed in closed form, so durations like \`'8n'\` stay exact while the tempo slides. \`swing(amount, subdivision)\` shifts every second tick of the subdivision late; 0 is straight, and around 0.3 to 0.5 is the classic shuffle zone.

## A drum machine

\`\`\`js
const b = await Bellows.boot({ seed: 'drum-machine', bpm: 112 });

const kick = b.voice('kick', { decay: 0.35, drive: 3 });
const snare = b.voice('snare', { tone: 0.4 });
const hat = b.voice('hat', { decay: 0.05 });

// one bar of sixteenths per row, 1 = hit
const KICK = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
const HAT = b.euclid(16, 11); // 11 hits spread evenly over 16 steps

b.clock.at('16n', (t, step) => {
  const s = step % 16;
  if (KICK[s]) kick.note('C2', { at: t, dur: '16n', vel: 0.95 });
  if (SNARE[s]) snare.note('D3', { at: t, dur: '16n', vel: s === 15 ? 0.5 : 0.85 });
  if (HAT[s]) hat.note('F#4', { at: t, dur: '16n', vel: s % 4 === 2 ? 0.8 : 0.45 });
});

b.swing(0.35, '16n');
b.start();
\`\`\`

Three channels, one callback. Each row is a plain array indexed by \`step % 16\`, so editing the pattern is editing data. The velocity accents (a softer ghost snare on step 15, louder hats on the offbeats) do more for groove than any effect will. \`b.euclid(steps, pulses, rotation?)\` returns one of these gate rows computed for you; it and its generative cousins live on the next page.

The drum engines all tune from the note you give them, so a kit is playable up and down the keyboard: \`'C2'\` is a normal kick register, and moving the snare or hat note shifts its color.

## Where next

[Generative music](/docs/generative-music) replaces the hand-written arrays with seeded generators. [Rendering and export](/docs/rendering-and-export) turns a running sequence into a wav file with one call.
`,
};

export default page;
