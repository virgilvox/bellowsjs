import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'theory',
  title: 'Theory',
  blurb: 'Scales, chords, roman numerals, voice leading, and negative harmony.',
  prev: 'generative-music',
  next: 'tuning',
  body: `
By the end of this page you can build a chord progression from roman numerals and voice it like a keyboard player would.

## Scales

\`\`\`js
import { Scale } from 'bellowsjs';

const dorian = new Scale('D', 'dorian');   // or b.scale('D dorian')

dorian.degreeToMidi(0, 3);  // 50, D3: degree 0 is the root
dorian.degreeToMidi(2, 3);  // 53, F3
dorian.degreeToMidi(-1, 4); // 60, C4: negatives walk below the root
dorian.quantize(61);        // 60: nearest scale tone, ties resolve down
dorian.contains(61);        // false
dorian.degrees(1, 3);       // [50,52,53,55,57,59,60]: one octave from octave 3
dorian.intervals;           // [0,2,3,5,7,9,10]
dorian.length;              // 7
\`\`\`

A \`Scale\` is a root plus an interval set. The root can be a pitch class name (\`'F#'\`), a full note name (\`'C4'\`, which also sets the default octave), or a number. Thirty-four names ship, from the church modes through harmonic and melodic minor, pentatonics, blues, bebop, whole tone, octatonic, and a set of Japanese and eastern European scales; the exact list is in [/llm.txt](/llm.txt). Degrees wrap octaves, which is why generative walks on degrees never leave the key.

## Chords

\`\`\`js
import { parseChord, chordName, detectChord, chord } from 'bellowsjs';

const ch = parseChord('F#m7b5');
ch.root;       // 6
ch.type;       // 'm7b5'
ch.intervals;  // [0,3,6,10]
ch.midi(3);    // [54,57,60,64]: root placed in octave 3

chordName(chord(6, 'm7b5')); // 'F#m7b5'
detectChord([0, 4, 7]);      // 'C'
detectChord([2, 5, 9]);      // 'Dm'
\`\`\`

\`parseChord\` reads the usual symbols; \`detectChord\` names a set of pitch classes, treating the first element as the bass, and returns null when nothing matches exactly. Twenty-four chord types ship in \`CHORD_TYPES\`, from triads through altered dominants. \`ch.midi(octave)\` is the bridge to sound: feed the array to \`inst.chord()\`.

## Diatonic sets

\`\`\`js
import { diatonicTriads, diatonicSevenths } from 'bellowsjs';

const cmaj = new Scale('C', 'major');
diatonicTriads(cmaj).map((c) => chordName(c));
// ['C','Dm','Em','F','G','Am','Bdim']
diatonicSevenths(cmaj).map((c) => chordName(c));
// ['Cmaj7','Dm7','Em7','Fmaj7','G7','Am7','Bm7b5']
\`\`\`

One chord per scale degree, stacked in thirds from the scale itself. Index with a degree number and you have functional harmony as an array lookup.

## Roman numerals, both directions

\`\`\`js
import { romanToChord, chordToRoman } from 'bellowsjs';

const five = romanToChord('V7', cmaj);   // G7
five.midi(3);                            // [55,59,62,65]
romanToChord('bVII', cmaj);              // borrowed Bb
chordToRoman(parseChord('Dm'), cmaj);    // 'ii'
\`\`\`

\`romanToChord\` understands quality suffixes (\`'viio7'\`, \`'IVsus4'\`), chromatic roots (\`'bVII'\`), and infers major or minor from case when the suffix does not say. \`chordToRoman\` inverts it, using lowercase for minor, \`o\` for diminished, and \`+\` for augmented. Write progressions as strings and translate them per key.

## Voice leading

\`\`\`js
import { voiceLead, invert, negativeHarmony } from 'bellowsjs';

voiceLead([60, 64, 67], [parseChord('F').midi(4)]);
// [60,65,69]: C4 F4 A4, minimal motion from C major

invert([60, 64, 67], 1);   // [64,67,72]: first inversion
negativeHarmony(64, 60);   // 63: E reflects to Eb around the C axis
negativeHarmony(67, 60);   // 60: G reflects to C
\`\`\`

\`voiceLead(prev, candidates, options?)\` searches every candidate chord over its inversions and octave placements and returns the voicing with the least total finger movement, penalizing crossings and doublings. Pass an empty \`prev\` and the first chord is voiced near the center of the range (defaults C3 to C6, settable via \`{ low, high }\`). \`negativeHarmony(midi, keyRoot)\` reflects a note around the axis between the key's root and fifth, the trick that maps a G7 in C to an Fm6 shape.

## A progression walkthrough

\`\`\`js
const b = await Bellows.boot({ seed: 'cadence' });
const inst = b.voice('additive', { decay: 3 });
const key = b.scale('A minor');

const numerals = ['i', 'iv', 'V7', 'i'];
let voicing = [];

b.clock.at('1m', (t, step) => {
  const ch = romanToChord(numerals[step % numerals.length], key);
  voicing = voiceLead(voicing, [ch.midi(4)]);
  inst.chord(voicing, { at: t, dur: '1m', vel: 0.6 });
});
b.start();
\`\`\`

Each bar parses one numeral in A minor and voice-leads from wherever the hands were. The first pass plays Am as C4 E4 A4, then Dm arrives as D4 F4 A4 (one common tone, two steps), E7 as D4 E4 G#4 B4, and back to Am as C4 E4 A4 C5. No voicing was written by hand. For progressions the library invents itself, \`buildProgression(rng, bars)\` emits one scale degree per bar with functional-harmony weighting and a cadence at the end; feed it \`b.rng('prog')\` and it is as reproducible as everything else in [Generative music](/docs/generative-music).

Pitch so far has been 12-note equal temperament. It does not have to be: [Tuning](/docs/tuning) is next.
`,
};

export default page;
