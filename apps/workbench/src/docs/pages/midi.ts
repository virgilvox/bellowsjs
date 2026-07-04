import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'midi',
  title: 'MIDI',
  blurb: 'Hardware input, MPE, and reading and writing standard MIDI files.',
  prev: 'analysis',
  next: 'custom-dsp',
  body: `
By the end of this page you can play any engine from a hardware keyboard and move scores in and out as standard MIDI files.

## Support matrix

Web MIDI exists in Chromium browsers and Firefox. It does not exist in Safari, on macOS or iOS, and there is no polyfill that reaches hardware. Feature-detect and degrade to an on-screen keyboard:

\`\`\`js
if (navigator.requestMIDIAccess) {
  // wire hardware input
} else {
  // Safari lands here
}
\`\`\`

MIDI files are just bytes, so the file half of this page works everywhere, including Node.

## Wiring a controller to an instrument

\`\`\`js
import { MidiInput } from 'bellowsjs';

const b = await Bellows.boot({ seed: 'live' });
const synth = b.voice('va', { cutoff: 3000 });

const ports = await MidiInput.list();      // [{ id, name }]
const input = new MidiInput(ports[0]?.id); // or a name substring, or nothing for the first port
await input.ready;

const held = new Map();
input.onNote((e) => {
  if (e.on) {
    held.set(e.note, synth.on(e.note, e.velocity));
  } else {
    const id = held.get(e.note);
    if (id !== undefined) synth.off(id);
    held.delete(e.note);
  }
});

input.onControl((e) => {
  if (e.controller === 1) synth.param('cutoff', 200 + e.value * 8000); // mod wheel
});
\`\`\`

\`MidiInput\` binds a port and emits normalized events: velocity and control values arrive 0 to 1, so they map straight onto \`vel\` and params. The \`on\`/\`off\` pair from [Playing notes](/docs/playing-notes) is the natural fit because a keyboard's note lifetime is open-ended. \`onPitchBend\` delivers bend normalized to [-1, 1). \`MidiOutput\` mirrors the API for sending. The INSTRUMENT page on this site uses this exact wiring; plug in a controller and it just appears in the MIDI panel.

## MPE in brief

\`\`\`js
const zone = input.mpeZone({ bendRange: 48 });

zone.onNoteStart((n) => { /* n.note, n.velocity, n.channel */ });
zone.onNoteChange((n) => { /* n.bend (semitones), n.pressure, n.timbre */ });
zone.onNoteEnd((n) => { /* release */ });
\`\`\`

MPE controllers (Linnstrument, Seaboard, and friends) put each finger on its own channel so bend, pressure, and timbre are per note. \`mpeZone()\` groups the channel stream back into note objects with continuous \`bend\`, \`pressure\`, and \`timbre\` fields, master-channel bend applied. Map bend onto \`{ hz }\` notes or a pitch param and each finger slides independently.

## MIDI files: parse, score, write

\`\`\`js
import { parseMidi, toScore, writeMidi } from 'bellowsjs';

const buf = await (await fetch('/midi/bach.mid')).arrayBuffer();
const parsed = parseMidi(buf);        // { format, ticksPerQuarter, tracks }
const score = toScore(parsed);        // flat notes in beats

// play it: one beat is one quarter note on the transport
const piano = await b.instrument('sf2:/fonts/gm.sf2#0:0');
b.clock.at('16n', (t, step) => {
  const beat = step / 4;
  for (const n of score) {
    if (n.startBeat >= beat && n.startBeat < beat + 0.25) {
      piano.note(n.midi, { at: t, dur: n.durBeats, vel: n.velocity });
    }
  }
});
b.start();
\`\`\`

\`toScore\` flattens tracks into \`{ midi, velocity, startBeat, durBeats, channel, track }\` notes, tempo-independent: beats are ticks divided by ticks per quarter, so the transport's bpm decides how fast it plays. Filtering per 16th-note window like this keeps scheduling incremental instead of queueing thousands of events at once.

Writing goes the other way:

\`\`\`js
const tracks = [[
  { tick: 0, type: 'noteOn', channel: 0, data: { note: 60, velocity: 100 } },
  { tick: 480, type: 'noteOff', channel: 0, data: { note: 60, velocity: 0 } },
  { tick: 480, type: 'noteOn', channel: 0, data: { note: 64, velocity: 90 } },
  { tick: 960, type: 'noteOff', channel: 0, data: { note: 64, velocity: 0 } },
  { tick: 960, type: 'endOfTrack', data: {} },
]];
const bytes = writeMidi(tracks, 480); // ArrayBuffer, tpq 480
\`\`\`

\`writeMidi(tracks, ticksPerQuarter)\` emits a standard file any DAW opens; parsing it back through \`toScore\` returns the two notes at beats 0 and 1, which makes round-trip tests one assertion long. For raw bytes from other sources, \`parseMidiMessage([0x90, 60, 100])\` decodes a single channel message without any port machinery.

That covers getting notes in from the physical world. The final page goes the other direction, extending the engine itself: [Custom DSP](/docs/custom-dsp).
`,
};

export default page;
