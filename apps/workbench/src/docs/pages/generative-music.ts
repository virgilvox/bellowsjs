import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'generative-music',
  title: 'Generative music',
  blurb: 'Seeded randomness, euclidean rhythm, Markov walks, L-systems, and automata.',
  prev: 'sequencing',
  next: 'theory',
  body: `
By the end of this page you can write a piece that surprises you and still plays identically on every run of the same seed.

## Seeds and named streams

\`\`\`js
const b = await Bellows.boot({ seed: 'forge-01' });

const melody = b.rng('melody');
const drums = b.rng('drums');

melody();            // uniform float in [0, 1)
melody.int(7);       // integer 0..6
melody.pick([0, 3, 4]);
melody.range(0.4, 0.9);
melody.chance(0.25); // true one time in four
melody.shuffle([0, 1, 2, 3]);
melody.gauss();      // roughly normal, mean 0
melody.weighted([4, 1, 1]); // index 0 four times as likely
\`\`\`

Nothing in the library calls \`Math.random\`. \`b.rng(label)\` forks a named stream off the boot seed: the same seed and label always produce the same sequence, and separate labels never disturb each other. Add a hat fill and your melody does not change, because the hats draw from their own stream. \`melody.fork('b-section')\` derives an independent child when one label needs sub-streams. This is the whole reproducibility story, and it is what lets [renders](/docs/rendering-and-export) equal live playback.

## Euclidean rhythm

\`\`\`js
const gatesRow = b.euclid(16, 7, 2); // 16 steps, 7 pulses, rotated left 2
b.clock.at('16n', (t, step) => {
  if (gatesRow[step % 16]) inst.note('C3', { at: t, dur: '16n' });
});
\`\`\`

\`b.euclid(steps, pulses, rotation?)\` spreads pulses as evenly as possible over steps, the true Bjorklund algorithm; E(3, 8) is the tresillo \`[1,0,0,1,0,0,1,0]\`. Note the argument order at the package root differs: the bare \`euclid(pulses, steps, rotation?)\` import puts pulses first, while the facade helper puts steps first.

## Markov chains with chord gravity

\`\`\`js
import { Markov, buildStepwiseMatrix, weightedWalk } from 'bellowsjs';

// order-2 chain trained on a phrase
const m = new Markov(2);
m.train([0, 2, 4, 2, 0, 2, 4, 5, 4, 2, 0]);
m.seed([0, 2]);
const line = m.steps(b.rng('markov'), 8); // e.g. [4,2,0,2,4,5,4,2]
\`\`\`

\`Markov\` learns transition counts from training data at every order up to its own, then walks with backoff. For melodies that respect harmony, skip training and use the stepwise walk with gravity:

\`\`\`js
const positions = [0, 1, 2, 3, 4, 5, 6]; // scale degrees
const matrix = buildStepwiseMatrix(positions, b.rng('walk'));
let pos = 0;

b.clock.at('8n', (t, step) => {
  const chordTones = new Set([0, 2, 4]); // swap per bar for real changes
  pos = weightedWalk(matrix, pos, b.rng('walk'), chordTones, 2.5);
  inst.note({ degree: positions[pos], octave: 4 }, { at: t, dur: '8n' }, scale);
});
\`\`\`

The matrix favors stepwise motion, and the gravity set multiplies the weight of chord tones by \`gravityGain\`, pulling the walk toward the harmony without ever forcing it. Change the set each bar and the melody follows your progression.

## L-systems

\`\`\`js
import { lsystem, mapToDegrees } from 'bellowsjs';

const grown = lsystem('AB', { A: 'AB', B: 'A' }, 3); // 'ABAABABA'
const degrees = mapToDegrees(grown, { A: 0, B: 4 });  // [0,4,0,0,4,0,4,0]

// stochastic rules draw from a stream
const wild = lsystem('A', {
  A: [{ out: 'AB', weight: 3 }, { out: 'A', weight: 1 }],
}, 4, b.rng('grow'));
\`\`\`

Rewriting rules grow short motifs into self-similar phrases. \`mapToDegrees\` turns symbols into scale degrees, maps a symbol to \`null\` for a rest, and skips unmapped structural symbols.

## Cellular automata

\`\`\`js
import { ElementaryCA, caRhythm } from 'bellowsjs';

const ca = new ElementaryCA(110, 16, b.rng('ca'));
const row = caRhythm(ca, 16); // 16 gates sampled from the center column
\`\`\`

An elementary CA evolves a row of cells by one of the 256 Wolfram rules. Rule 110 sits at the edge of chaos and makes patterns that repeat almost, but not quite. \`ca.step()\` advances a generation and \`ca.row\` is the current cells, so you can also read a whole row as a bar.

## Arpeggiator

\`\`\`js
import { Arpeggiator, parseChord } from 'bellowsjs';

const arp = new Arpeggiator({ mode: 'updown', octaves: 2 });
arp.setNotes(parseChord('Am').midi(3));

b.clock.at('16n', (t) => {
  inst.note(arp.next(), { at: t, dur: '16n' });
});
\`\`\`

Modes: \`up\`, \`down\`, \`updown\`, \`downup\`, \`order\`, and \`random\` (which needs \`arp.next(rng)\`). \`setNotes\` keeps the playback position, so live chord changes do not restart the pattern.

## Pattern combinators

\`\`\`js
import { seq, stack, gates, fromArray, every, sometimes, fast, slow, rev } from 'bellowsjs';

const bass = seq(0, 0, 3, [4, 5]);        // flattens one level: 0 0 3 4 5
const hats = gates(b.euclid(8, 5));
const varied = every(4, rev, bass);        // reversed on cycles 0, 4, 8...
const spiced = sometimes(0.3, (v) => v + 12, bass, b.rng('spice'));

b.clock.at('8n', (t, step) => {
  inst.note({ degree: spiced.at(step), octave: 2 }, { at: t, dur: '8n' }, scale);
  if (hats.at(step)) hat.note('F#4', { at: t, dur: '16n', vel: 0.5 });
});
\`\`\`

Patterns are step-indexed and cyclic: \`p.at(step)\` wraps at \`p.length\`. \`stack\` layers patterns, \`fast\` and \`slow\` change the cycle length by decimating or holding, \`rev\` reverses within a cycle, and \`sometimes\` draws its random mask once so every query of the same step agrees. One footnote: the package root exports \`rotate(arr, n)\` for plain arrays (handy on euclid rows); it is not the pattern combinator.

## A complete seeded piece

\`\`\`js
import { Bellows } from 'bellowsjs';

const b = await Bellows.boot({ seed: 'aurora-7', bpm: 92 });

const pad = b.voice('additive', { decay: 4, rolloff: 0.6 });
const lead = b.voice('pluck', { decay: 3 });
const kick = b.voice('kick', { decay: 0.4 });
const hat = b.voice('hat', { decay: 0.05 });

const hall = b.bus([['fdn', { decay: 5, mix: 1 }]], { level: 0.35 });
pad.send(hall, 0.6);
lead.send(hall, 0.4);
pad.gain(0.5);

const scale = b.scale('E minor');
const chords = [0, 5, 3, 4]; // i VI iv v, one per bar
const kicks = b.euclid(16, 5);
const hats = b.euclid(16, 9, 1);
const melody = b.rng('melody');

b.clock.at('16n', (t, step) => {
  const s = step % 16;
  const bar = Math.floor(step / 16) % chords.length;
  const root = chords[bar];

  if (s === 0) {
    for (const off of [0, 2, 4]) {
      pad.note({ degree: root + off, octave: 3 }, { at: t, dur: '1m', vel: 0.5 }, scale);
    }
  }
  if (kicks[s]) kick.note('C2', { at: t, dur: '16n', vel: 0.9 });
  if (hats[s]) hat.note('F#4', { at: t, dur: '16n', vel: melody.range(0.3, 0.6) });

  if (s % 2 === 0 && melody.chance(0.7)) {
    const degree = root + melody.pick([0, 2, 4, 7]);
    lead.note({ degree, octave: 4 }, { at: t, dur: '8n', vel: melody.range(0.5, 0.9) }, scale);
  }
});

b.start();
\`\`\`

Every choice the piece makes flows from \`'aurora-7'\`: reload the page and the same music plays, note for note. Change one character of the seed for a sibling piece with the same bones. Because the only mutable state is derived from \`step\` and the \`melody\` stream, \`await b.render({ bars: 8 })\` produces exactly what a fresh load would play; the fine print lives in [Rendering and export](/docs/rendering-and-export). The harmonic scaffolding here is hand-rolled; the [Theory](/docs/theory) page shows the library doing that work for you.
`,
};

export default page;
