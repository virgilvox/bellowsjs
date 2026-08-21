import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-theory',
  title: 'Theory on hardware',
  blurb: 'Scales, chords, tunings, the microtonal trap that sounds right and is not, and the seeded stream.',
  prev: 'emb-sequencing',
  next: 'emb-output',
  body: `
Pitch on a microcontroller is usually a formula. Somewhere in a note handler sits \`440 * powf(2.0f, (n - 69) / 12.0f)\` and that is the end of it. Here pitch is a layer: a \`Scale\` says which degrees of a key are in play, a \`Tuning\` says what frequency each degree actually is, and a phrase written once in degrees plays in either division of the octave without changing a note.

All of it is integer and small-float math over \`const\` tables. Nothing allocates, nothing throws, and nothing knows about a sample rate.

## Scale

\`\`\`cpp
#include "bellows/theory/scales.h"

bellows::Scale s;
s.Init(2, bellows::kScaleDorian);   // root pitch class 2 (D)

s.DegreeToMidi(0, 3);   // 50, D3: degree 0 is the root
s.DegreeToMidi(2, 3);   // 53, F3
s.DegreeToMidi(-1, 4);  // 60, C4: negatives walk below the root
s.Quantize(61);         // 60: nearest scale tone, ties resolve down
s.Contains(61);         // false
s.Length();             // 7
s.Intervals();          // pointer to {0,2,3,5,7,9,10} in flash

int notes[8];
const int n = s.Degrees(1, notes, 8, 3);   // one octave from octave 3
\`\`\`

Degrees wrap: past the scale length they continue into the next octave, which is what keeps a generated walk inside the key. \`Quantize\` searches outward from the note, ties resolving downward, and \`Contains\` is a shift and mask of a 12-bit membership mask.

Thirty-four scales ship, from the church modes through harmonic and melodic minor, pentatonics, blues, bebop, whole tone, octatonic, and a set of Japanese and eastern European scales. In the TypeScript that table is a record keyed by name. Here it is an enum plus one flat step array with an offset table, because a name-keyed table would force every scale's name string into every sketch that touches a scale.

The step data is 232 bytes and the offset table 35. The name table is another 300 or so of pointers and characters, and it lives in its own marked section at the bottom of the header with nothing else depending on it. A sequencer that walks \`kScaleDorian\` links not one character of \`"ukrainian dorian"\`; a sketch with a display and a scale menu calls \`ScaleName\` once and opts into the whole table. Same header, two independent chunks of \`.rodata\`, sorted out by \`-fdata-sections\` and \`--gc-sections\`.

A \`Scale\` itself is 12 bytes: a pointer into flash, a length, a root and the mask. Copy them freely.

## Chords

\`\`\`cpp
#include "bellows/theory/chords.h"

bellows::Chord ch = bellows::MakeChord(6, bellows::kChordMin7b5);
int midi[8];
const int n = ch.Midi(3, midi, 8);   // root placed in octave 3

bellows::Chord triads[8];
const int t = bellows::DiatonicTriads(s, triads, 8);
bellows::Chord five = bellows::DiatonicChord(s, 4, 4);   // seventh on degree 4

bellows::ParseChord("F#m7b5", &ch);
bellows::RomanToChord("V7", s, &ch);

char name[16];
bellows::ChordName(ch, name, 16);
bellows::ChordToRoman(ch, s, name, 16);
\`\`\`

Twenty-five interval sets, same flat-table shape as the scales and for the same reason. A \`Chord\` is a value: root pitch class, type, and up to eight semitone offsets copied inline, twelve bytes total, free to return and keep in arrays.

That inline copy matters because the diatonic builders produce chords whose intervals are not in the table at all. Stacking thirds through a scale gives whatever the scale gives, and in something like hungarian minor that is regularly a stack with no name. Those come back as \`kChordUnknown\` with their intervals intact, and they play correctly.

The integer half (building chords, stacking diatonic harmony, detecting a type from a set of pitch classes) never touches the name strings, so a sequencer that voices ii-V-I by enum links no characters. Only \`ChordName\`, \`ParseChord\` and the roman numeral functions pull the name table in.

\`DetectChord\` walks \`kChordDetectOrder\`, a 24 byte table that exists for one reason: the JS iterates \`Object.keys(CHORD_TYPES)\`, and JavaScript enumerates keys that look like array indices first, in numeric order, before the rest in insertion order. So \`"6"\`, \`"7"\`, \`"9"\`, \`"11"\` and \`"13"\` jump to the front of the record regardless of where they appear in the file. It shows up only when two roots both fit and neither is the bass, where \`{E, G, A, C}\` comes back as C6 rather than Am7. A port that quietly disagreed with the browser about a chord name would be a nasty thing to debug, so it does not.

## Tuning

\`\`\`cpp
#include "bellows/theory/tuning.h"

bellows::Tuning12 edo12;
edo12.InitEdo(12);                 // ref 440 Hz at index 69

bellows::Tuning<19> edo19;
edo19.InitEdo(19);

const float ratios[] = {1.f, 9.f/8, 5.f/4, 4.f/3, 3.f/2, 5.f/3, 15.f/8};
bellows::Tuning<7> just;
just.InitJi(ratios, 7);

bellows::Tuning<12> werck;
werck.InitCents(cents, 12);        // any cents table, any period
\`\`\`

The representation is a cents table, exactly as in the TypeScript. \`degree_cents[d]\` is the offset in cents of degree d above the reference index, one period spans \`period_cents\`, and

\`\`\`
FreqOf(ref_index + k * size + d)
  = ref_freq * 2 ^ ((k * period_cents + degree_cents[d]) / 1200)
\`\`\`

so a lookup is an integer divide, a table read and one \`Exp2\`. \`Tuning<12>\` is 68 bytes and \`Tuning<31>\` is 144.

Entries may be NaN to mark an unmapped key, which is what a Scala \`.kbm\` file expresses with a hole in its mapping. \`FreqOf\` returns NaN for those and \`IsMapped\` tells you in advance.

Fractional indices interpolate linearly in cents between the neighbouring integers, and that is the piece that makes pitch bend, glide and vibrato behave through an unequal tuning: bending a fifth up one step travels the real width of that step, not a nominal 100 cents.

One deliberate difference from the JS: \`TransposeCents\`, \`TransposeRatio\` and \`TransposeSteps\` mutate in place instead of returning a new tuning, since copying a whole table to change one float is a strange thing to ask an embedded target to do. Copy the object first if you want both.

## DegreeFreq, and the trap

\`\`\`cpp
float f = bellows::DegreeFreq(tuning, root_index, intervals, count, degree, octave);
\`\`\`

This is the bridge from a degree to a frequency. Degrees outside \`[0, count)\` wrap and shift by whole periods, so degree -1 is the top interval one period down. It is templated on the interval element type, so it takes the \`uint8_t\` table a \`Scale\` hands out, an \`int8_t\` table, or a plain \`int\` array, without \`tuning.h\` needing to know that \`scales.h\` exists.

**An interval table is expressed in steps of its own tuning, not in semitones.** This is the one thing on this page worth reading twice.

In 12-EDO a step is a semitone, so the two readings coincide and the distinction is invisible. They stop coinciding immediately in 19-EDO. A whole tone there is 3 steps and a diatonic semitone is 2, so dorian is not \`{0,2,3,5,7,9,10}\` but:

\`\`\`cpp
// dorian in 19-EDO steps: W H W W W H W, with W = 3 and H = 2
inline constexpr int kDorian19[] = {0, 3, 5, 8, 11, 14, 16};
\`\`\`

Feed the semitone table to a 19-EDO tuning and every interval comes out too small. Degree 2 is 189 cents, a whole tone, where the scale wants a 316 cent minor third. And the octave is still right, because degrees wrap by the tuning's period rather than by 12.

That is what makes it dangerous. A wrong root or a wrong reference frequency sounds wrong. This sounds plausibly in tune, in a scale you do not recognise, and is completely wrong. It is the classic microtonal bug and it is worth having a name for.

So \`bellows::Scale\`, whose tables are the 12-EDO ones from \`scales.ts\`, supplies the intervals for a 12-EDO pass, and a 19-EDO pass uses an explicit table restated in 19-EDO steps. \`04_ScalesAndTuning\` plays one phrase both ways and its header comment is the long form of this.

Why 19-EDO is worth hearing, while you are here. Its major third is 6 steps, 378.95 cents, about 7 cents flat of a pure 5:4 at 386.31; the 12-EDO third is 400 cents, about 14 cents sharp. So 19-EDO triads beat about half as fast and sound noticeably calmer. The price is a fifth of 11 steps, 694.74 cents, about 7 cents flat of a pure 701.96, and a chromatic scale with a genuinely different shape, where a sharp and its enharmonic flat are no longer the same pitch.

## The PRNG, and why a seed crosses the gap

\`\`\`cpp
#include "bellows/core/prng.h"

bellows::Rng r;
r.Init("piece::ch0::snare/noise");   // by label
r.Init(0x9e3779b9u);                 // or by number

r.NextU32();    // uint32
r.Next();       // [0, 1)
r.Bipolar();    // [-1, 1)
\`\`\`

All uint32 arithmetic, so a stream is bit-identical to the browser's for the same seed. It is one of the parity harness's exactly-compared rows rather than a tolerance row.

**There is no \`Fork()\`, and none is needed.** Forking in the TypeScript is literal string concatenation:

\`\`\`
rng(label).fork(child)  ===  rng(label + '::' + child)
\`\`\`

so write the full path at construction and you land on the same stream:

\`\`\`
JS    b.rng('piece').fork('ch0').fork('snare/noise')
C++   rng.Init("piece::ch0::snare/noise")
\`\`\`

Storing a label per \`Rng\` so that \`Fork()\` could concatenate would cost a char buffer per voice, and the caller already knows the path at the point of construction.

This is the mechanism behind the library's actual promise: a seed reproduces a piece, and it reproduces it in a browser tab and on a board. Nothing about that is magic. It is one hash function, one integer generator, and a naming convention.

Which labels the engines use is a property of the TypeScript, not of the C++. As of the port: snare forks \`'snare/noise'\`, clap forks \`'clap/noise'\`, tom forks \`'tom/noise'\`, va forks \`'va'\`, formant forks \`'vibrato'\` for its LFO only, and pluck, modal and tube take the parent stream directly. The C++ voices take one \`Rng\` and use it the way the JS uses its own, so passing the correctly labelled stream is what makes the noise match. Nothing enforces this. Pass an unlabelled \`Rng\` and you get perfectly good noise that is simply not the browser's noise.

### Labels must be ASCII

The JS hashes \`str.charCodeAt(i)\`, which is a UTF-16 code unit, and \`str.length\`, which counts code units. This hashes bytes. The two agree for every character below 0x80 and cannot agree above it, because one U+00E9 is a single \`0xE9\` code unit in the browser and two bytes (\`0xC3 0xA9\`) here.

Measured: \`"cafe"\` with an acute accent seeds \`0x14cad659\` in the JS and \`0x1ab6029e\` here. Every label in the library and every label the engines use is ASCII. Keep yours ASCII, or your seeded piece is simply a different piece from the browser's.

Related, and already handled inside \`Xmur3\`: each byte is read through \`unsigned char\`, never through plain \`char\`. Plain \`char\`'s signedness is implementation defined, signed on the x86-64 host where the parity render is built and unsigned on ARM EABI, which is every board this library targets. A byte of \`0xE9\` would have entered the mix as \`0xFFFFFFE9\` on the host and \`0x000000E9\` on the board.

## Where next

[Performance](/docs/emb-performance) is what all of this costs: flash and RAM per program, the fast-math flag and its price, why the delay line is the RAM, and the single CPU figure anyone has actually measured on a board.
`,
};

export default page;
