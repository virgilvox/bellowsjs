import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'playing-notes',
  title: 'Playing notes',
  blurb: 'Boot the engine, then notes, durations, velocity, holds, and chords.',
  prev: 'getting-started',
  next: 'engines',
  body: `
By the end of this page you can play any pitch, for any length, at any loudness, on any instrument channel.

## Booting

\`\`\`js
import { Bellows } from 'bellowsjs';

const b = await Bellows.boot({ seed: 'forge-01', bpm: 96 });
\`\`\`

\`Bellows.boot(opts)\` accepts \`seed\` (the reproducibility anchor for every random stream), \`bpm\` and \`meter\` (transport defaults, 120 and 4/4), \`masterGain\`, an existing \`context\` if you already own an AudioContext, and \`workletUrl\` for hosts whose CSP blocks blob URLs. Boot from a click handler; see [the user gesture rule](/docs/getting-started).

## Instrument channels

\`\`\`js
const lead = b.voice('fm');
const bass = b.voice('va', { shape: 1, cutoff: 400 }, { polyphony: 4 });
\`\`\`

\`b.voice(engineId, params?, opts?)\` creates a channel in the kernel and returns an \`Instrument\` handle. Params are numbers, set at creation here and live later with \`param()\`. The engine ids live on the [Engines](/docs/engines) page.

## Every way to name a pitch

\`\`\`js
lead.note(60);                       // midi number, C4
lead.note('C#4');                    // note name
lead.note({ hz: 432 });              // raw frequency
lead.note({ degree: 2, octave: 3 }); // scale degree, C major by default

const dorian = b.scale('D dorian');
lead.note({ degree: 2, octave: 3 }, { dur: '8n' }, dorian); // degree in D dorian
\`\`\`

A \`NoteValue\` is a midi number, a name like \`'C#4'\`, an \`{ hz }\` object, or a \`{ degree, octave }\` pair resolved through a scale (the third argument to \`note\`, C major when omitted) and the active tuning. Degrees wrap, so degree 7 in a seven-note scale is the root an octave up, and negative degrees walk below the root. Frequencies given as \`{ hz }\` bypass tuning entirely; everything else flows through it, which is what makes [Tuning](/docs/tuning) a one-line switch.

## Durations are musical time

\`\`\`js
lead.note('A3', { dur: '8n' });          // eighth note
lead.note('A3', { dur: '4n.' });         // dotted quarter
lead.note('A3', { dur: '8t' });          // eighth triplet
lead.note('A3', { dur: '3/8' });         // three eighths of a whole note
lead.note('A3', { dur: 2 });             // plain number: two beats
lead.note('A3', { dur: '1m' });          // one measure
lead.note('A3', { dur: { seconds: 1.5 } }); // wall-clock escape hatch
\`\`\`

Durations follow the transport, so \`'8n'\` stretches when you lower the bpm and tracks tempo ramps exactly. The full grammar: \`'1n'\` \`'2n'\` \`'4n'\` \`'8n'\` \`'16n'\` \`'32n'\`, dotted with \`.\` (or the legacy \`d\`), triplets with \`t\`, measures with \`m\`, fractions of a whole note like \`'3/8'\`, and bare numbers meaning beats. \`{ seconds }\` opts out of musical time.

## Velocity and timing

\`\`\`js
lead.note('E4', { vel: 0.4 });                 // soft
lead.note('E4', { at: b.now() + 0.5, vel: 1 }); // hard, half a second from now
\`\`\`

\`vel\` runs 0 to 1 and defaults to 0.8. \`at\` is absolute context time in seconds; leave it out and the note plays a few milliseconds from now. Inside a clock callback, always pass the callback's \`t\` so notes land on the grid; that contract is the heart of [Sequencing](/docs/sequencing).

## Holds: on and off

\`\`\`js
const id = lead.on('G3', 0.9); // sustain until told otherwise
// ... later
lead.off(id);
\`\`\`

\`on(note, vel?, at?)\` starts a note with no scheduled end and returns an id; \`off(id, at?)\` releases it. This is the right shape for keyboards, [MIDI input](/docs/midi), and drones. \`allOff()\` releases everything on the channel.

## Chords

\`\`\`js
lead.chord(['C4', 'E4', 'G4'], { dur: '2n', vel: 0.7 });
\`\`\`

\`chord(notes, opts)\` plays several notes with shared options. For strums, schedule single notes with staggered \`at\` times. The [Theory](/docs/theory) page builds chord arrays for you from symbols and roman numerals.

## Channel gain and pan

\`\`\`js
bass.gain(0.7);
lead.pan(-0.3);
\`\`\`

\`gain\` scales the channel before its insert chain feeds the mix; \`pan\` runs -1 (left) to 1 (right). Per-effect routing lives on the [Effects](/docs/effects) page.
`,
};

export default page;
