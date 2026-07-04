import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'tuning',
  title: 'Tuning',
  blurb: 'EDOs, just intonation, cents tables, and Scala files, switchable live.',
  prev: 'theory',
  next: 'effects',
  body: `
By the end of this page you can retune every instrument in a running piece with one assignment.

## The pitch pipeline

Every note you play resolves in two stages. First the \`NoteValue\` becomes a note index: names and midi numbers already are one, and \`{ degree, octave }\` goes through the scale. Then the index becomes a frequency through \`b.tuning\`, and only that frequency reaches the kernel. 12-note equal temperament is the default value of \`b.tuning\`, never an assumption baked in below it. Only \`{ hz }\` notes skip the pipeline.

\`\`\`js
b.freqOf('A4');          // 440 under the default tuning
b.tuning = Tuning.edo(19);
b.freqOf('A4');          // still 440: index 69 is the reference
b.freqOf(70);            // 456.35: one 19-EDO step, 63.2 cents
\`\`\`

## Equal divisions

\`\`\`js
import { Tuning } from 'bellowsjs';

Tuning.edo(12);          // standard MIDI tuning
Tuning.edo(19);          // 19 equal steps per octave
Tuning.edo(31, 440, 69); // reference frequency and index are settable
\`\`\`

\`Tuning.edo(n, refFreq?, refIndex?)\` divides the octave into n equal steps, anchored so the reference index (default 69) sounds the reference frequency (default 440). Under \`edo(19)\` your midi numbers become 19-EDO steps, so scale and chord math built for 12 tones will name different sounds; degree-based writing adapts most gracefully.

## Just intonation

\`\`\`js
const ji = Tuning.ji(
  [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8], // ratios from the base degree
  261.63,  // base frequency: middle C
  60,      // base index
);
ji.freqOf(60); // 261.63
ji.freqOf(64); // 392.44, exactly 3/2 above the base
\`\`\`

\`Tuning.ji(ratios, baseFreq?, baseIndex?, period?)\` maps successive indices to successive ratios and repeats at the period (2 for an octave). Thirds and fifths lock into pure whole-number ratios; the cost is that the intervals depend on where you are relative to the base.

## Cents tables

\`\`\`js
const quarterComma = Tuning.fromCents(
  [0, 76.0, 193.2, 310.3, 386.3, 503.4, 579.5, 696.6, 772.6, 889.7, 1006.8, 1082.9],
  1200, // period
);
\`\`\`

\`Tuning.fromCents(cents, period?, refFreq?, refIndex?)\` takes explicit offsets per degree, one period's worth, which covers historical temperaments and anything a synth manual prints as a cents table. \`NaN\` entries mark unmapped keys, and \`tuning.freqOf\` returns \`NaN\` for them so you can hear silence instead of a wrong guess.

## Scala files

\`\`\`js
import { parseScl, tuningFromScala } from 'bellowsjs';

const scl = \`! harm7.scl
!
Seven-limit just scale
 7
!
 9/8
 5/4
 4/3
 3/2
 5/3
 7/4
 2/1
\`;

const tuning = tuningFromScala(parseScl(scl));
tuning.freqOf(69); // 440: reference note 69 at 440 Hz, Scala's default
tuning.freqOf(60); // 176: degree 0 lands on the middle note, 60
\`\`\`

The Scala archive holds thousands of scales in \`.scl\` format, ratios and cents mixed freely, and \`parseScl\` reads it as written (this seven-limit scale evaluates to 203.9, 386.3, 498.0, 702.0, 884.4, 968.8, and 1200.0 cents). \`parseKbm\` reads the companion keyboard mapping format, and \`tuningFromScala(scl, kbm?)\` combines them; without a \`.kbm\`, keys map linearly with degree 0 on note 60, matching Scala's own defaults.

## Retuning live

\`\`\`js
const b = await Bellows.boot({ seed: 'retune' });
const inst = b.voice('pluck');

b.clock.at('4n', (t, step) => {
  inst.note({ degree: step % 7, octave: 4 }, { at: t, dur: '4n' }, b.scale('C major'));
});
b.start();

// any time later, mid-phrase:
b.tuning = Tuning.edo(19);
\`\`\`

\`b.tuning\` is a plain property. Assign a new \`Tuning\` and every note resolved after that moment uses it; already sounding notes keep their pitch. Since resolution happens per note on the main thread, no engine needs to know the temperament changed. The workbench TUNING panel on this site is exactly this assignment behind a dropdown.

Transposition helpers round it out: \`transposeCents\`, \`transposeRatio\`, and \`transposeSteps\` each return a new shifted tuning, so an orchestra-wide A442 is \`b.tuning = Tuning.default12.transposeRatio(442 / 440)\`.
`,
};

export default page;
